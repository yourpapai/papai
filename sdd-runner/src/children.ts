// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { slugify } from './config.js'
import { readEvents } from './events.js'
import type { AgentUsage, EventInput } from './events.js'
import type { OrchestratorDeps, RunStartResult, StageContext } from './gate-digest.js'
import { presentGateAt } from './gate-digest.js'
import { PLAN_REVIEW_SURROGATE } from './gate-prelude.js'
import { materializeChildFiles, planDigest, topoSortChildren } from './plan.js'
import { PlanSchema } from './plan.js'
import type { PlanChild, PlanFsDeps } from './plan.js'
import { loadRunState, saveRunState } from './run-state.js'
import type { RunState } from './run-state.js'
import { aggregateUsage } from './usage-aggregate.js'
import { buildResolveCost } from './usage-aggregate.js'

export interface PlanBranchOptions {
  /** Injected fs seam (D7): hermetic materialization under test. */
  readonly fs?: PlanFsDeps
}

const DEFAULT_FS: PlanFsDeps = { mkdir, writeFile, readdir, unlink }

/** D4 row text: `<child-id> — <instruction first line>` plus deps/capabilities. */
function gateRowText(child: PlanChild): string {
  const firstLine = child.instruction.split('\n')[0] ?? child.instruction
  const deps = child.deps.length > 0 ? ` · deps: ${child.deps.join(', ')}` : ''
  const capabilities =
    child.capabilities === undefined || child.capabilities.length === 0
      ? ''
      : ` · capabilities: ${child.capabilities.join(', ')}`
  return `${child.id} — ${firstLine}${deps}${capabilities}`
}

/**
 * Plan branch entry (D7): materialize child task files → emit the `plan` event
 * → record `state.plan` (topo childIds + digest) and seed `state.children` →
 * persist → present the plan gate (R4-only prelude, D5). The parent never
 * creates a change folder.
 */
export async function runPlanBranch(
  deps: OrchestratorDeps,
  state: RunState,
  ctx: StageContext,
  children: readonly PlanChild[],
  options: PlanBranchOptions = {},
): Promise<RunStartResult> {
  const ordered = topoSortChildren({ children: [...children] })
  await materializeChildFiles({ children: ordered }, state.runDir, options.fs ?? DEFAULT_FS)
  const digest = planDigest(ordered)
  ctx.emit({ altitude: 'L2', type: 'plan', childCount: ordered.length, digest })
  state.plan = { childIds: ordered.map((child) => child.id), digest }
  const seeded: Record<string, { status: 'pending' }> = {}
  for (const child of ordered) seeded[child.id] = { status: 'pending' }
  state.children = seeded
  await saveRunState(state, deps.now?.() ?? new Date())
  return presentGateAt(deps, state, ctx, PLAN_REVIEW_SURROGATE, 1, 'plan', {
    children: ordered.map((child, index) => ({ id: `C${index + 1}`, text: gateRowText(child) })),
  })
}

/** Injected nested-run seam (D7): the orchestrator supplies the real runStart. */
export type RunChildRun = (child: PlanChild, taskFile: string) => Promise<{ readonly runId: string }>

export interface RunChildrenOptions {
  readonly runChildRun: RunChildRun
}

export type RunChildrenResult =
  | { readonly halted: 'gate-pending'; readonly childRunId: string }
  | { readonly halted: 'completed' }

/** Load the current plan sidecar — the single source of full child records (D3). */
async function planChildrenOf(ctx: StageContext): Promise<readonly PlanChild[]> {
  const raw = await readFile(path.join(ctx.sidecarDir, 'plan.json'), 'utf8')
  return PlanSchema.parse(JSON.parse(raw)).children
}

function childUsageOf(childRunDir: string, resolve: Parameters<typeof aggregateUsage>[1]): AgentUsage | undefined {
  try {
    const aggregated = aggregateUsage(readEvents(path.join(childRunDir, 'events.ndjson')), resolve)
    return {
      inputTokens: aggregated.inputTokens,
      outputTokens: aggregated.outputTokens,
      reasoningTokens: aggregated.reasoningTokens,
      cachedReadTokens: aggregated.cachedReadTokens,
      cachedWriteTokens: aggregated.cachedWriteTokens,
      costUsd: aggregated.costUsd,
      wallMs: aggregated.wallMs,
    }
  } catch {
    return undefined
  }
}

/**
 * Sequential topo execution loop (D8): walks `state.plan.childIds` in order,
 * one child in flight, skipping children already `done`. A completed child
 * emits `child_spawned { child, runId }` then `child_done { child, outcome:
 * 'done', usage }` with usage aggregated from the child's own event log. A
 * gate-pending child records `running`, prints its concrete `sdd <runId>`
 * line, and halts the parent `running` — resume continues at the next
 * not-done child.
 */
export async function runChildren(
  deps: OrchestratorDeps,
  state: RunState,
  ctx: StageContext,
  options: RunChildrenOptions,
): Promise<RunChildrenResult> {
  const children = await planChildrenOf(ctx)
  const childIds = state.plan?.childIds ?? []
  const resolve = deps.resolveCost ?? (await buildResolveCost())
  const emit = (event: EventInput): void => {
    ctx.emit(event)
  }
  const runAt = async (index: number): Promise<RunChildrenResult> => {
    const childId = childIds[index]
    if (childId === undefined) return { halted: 'completed' }
    if (state.children?.[childId]?.status === 'done') return runAt(index + 1)
    const child = children.find((entry) => entry.id === childId)
    if (child === undefined) throw new Error(`plan sidecar has no child ${childId}`)
    const taskFile = path.join(state.runDir, 'children', `${index + 1}-${slugify(childId)}.md`)
    const handle = await options.runChildRun(child, taskFile)
    emit({ altitude: 'L2', type: 'child_spawned', child: childId, runId: handle.runId })
    const childState = await loadRunState(deps.config.workDir, handle.runId)
    if (childState.status === 'completed') {
      const usage = childUsageOf(childState.runDir, resolve)
      emit({
        altitude: 'L2',
        type: 'child_done',
        child: childId,
        outcome: 'done',
        ...(usage === undefined ? {} : { usage }),
      })
      state.children = { ...state.children, [childId]: { status: 'done' } }
      await saveRunState(state, deps.now?.() ?? new Date())
      return runAt(index + 1)
    }
    if (childState.gate !== null) {
      state.children = { ...state.children, [childId]: { status: 'running' } }
      await saveRunState(state, deps.now?.() ?? new Date())
      deps.stdout?.(`child ${childId} awaits its gate (run ${handle.runId}) — settle it, then resume the parent`)
      deps.stdout?.(`sdd ${handle.runId}`)
      return { halted: 'gate-pending', childRunId: handle.runId }
    }
    throw new Error(`child ${childId} ended in unhandled status '${childState.status}'`)
  }
  return runAt(0)
}
