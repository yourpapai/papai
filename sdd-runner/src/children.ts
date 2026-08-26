// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { calmSettle, completedFailedChildHandleOf, settleObservedChild, stopAtBudgetGuard } from './child-settle.js'
import type { RunChildrenOptions, RunChildrenResult } from './child-settle.js'
import { resumeHandleOf, spawnRecorderOf, stopAtLiveChildHolder } from './child-spawn.js'
import { propagateChildStop } from './child-stop.js'
import { slugify } from './config.js'
import { readEvents } from './events.js'
import type { OrchestratorDeps, RunStartResult, StageContext } from './gate-digest.js'
import { logPathFor, presentGateAt } from './gate-digest.js'
import { PLAN_REVIEW_SURROGATE } from './gate-prelude.js'
import { materializeChildFiles, planDigest, topoSortChildren } from './plan.js'
import { PlanSchema } from './plan.js'
import type { PlanChild, PlanFsDeps } from './plan.js'
import { saveRunState } from './run-state.js'
import type { RunState } from './run-state.js'
import { buildResolveCost } from './usage-aggregate.js'
import type { ResolveCostFn } from './usage-aggregate.js'
import { treeSpend } from './usage-aggregate.js'

export type { RunChildRun, RunChildrenOptions, RunChildrenResult } from './child-settle.js'

export interface PlanBranchOptions {
  /** Injected fs seam (D7): hermetic materialization under test. */
  readonly fs?: PlanFsDeps
  /** Gate version to present at — replan tails re-present at `version + 1`. */
  readonly version?: number
  /** Skip the plan policy — a settled replan round never re-runs the ladder. */
  readonly skipPolicy?: boolean
}

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
  await materializeChildFiles({ children: ordered }, state.runDir, options.fs)
  const digest = planDigest(ordered)
  ctx.emit({ altitude: 'L2', type: 'plan', childCount: ordered.length, digest })
  state.plan = { childIds: ordered.map((child) => child.id), digest }
  const seeded: Record<string, { status: 'pending' }> = {}
  for (const child of ordered) seeded[child.id] = { status: 'pending' }
  state.children = seeded
  await saveRunState(state, deps.now?.() ?? new Date())
  return presentGateAt(deps, state, ctx, PLAN_REVIEW_SURROGATE, options.version ?? 1, 'plan', {
    children: rowsOf(ordered),
    skipPolicy: options.skipPolicy,
  })
}

/** D4 rows for a topo-ordered plan: `C<n>` ids numbered in order, one per child. */
export function rowsOf(ordered: readonly PlanChild[]): { readonly id: string; readonly text: string }[] {
  return ordered.map((child, index) => ({ id: `C${index + 1}`, text: gateRowText(child) }))
}

/** Load the current plan sidecar — the single source of full child records (D3). */
export async function planChildrenOf(ctx: StageContext): Promise<readonly PlanChild[]> {
  const raw = await readFile(path.join(ctx.sidecarDir, 'plan.json'), 'utf8')
  return PlanSchema.parse(JSON.parse(raw)).children
}

/**
 * D8 spawn tail: durably-recorded spawn of one child over its task file —
 * the `child_spawned { child, runId }` line plus a persisted `running` child
 * status land the moment the nested run dir is known (before the flight) —
 * then settlement of the observed flight. The calm-stop seam is propagated
 * in flight (D11).
 */
async function spawnAndSettle(
  deps: OrchestratorDeps,
  state: RunState,
  ctx: StageContext,
  options: RunChildrenOptions,
  child: PlanChild,
  index: number,
  committed: number,
  resolve: ResolveCostFn,
  next: () => Promise<RunChildrenResult>,
): Promise<RunChildrenResult> {
  const taskFile = path.join(state.runDir, 'children', `${index + 1}-${slugify(child.id)}.md`)
  const spawn = spawnRecorderOf(deps, state, ctx, child.id)
  const handle =
    options.stop === undefined
      ? await options.runChildRun(child, taskFile, committed, spawn.onRunDirReady)
      : await propagateChildStop(
          { runChildRun: options.runChildRun, stop: options.stop, onChildRunDir: spawn.onRunDirReady },
          child,
          taskFile,
          committed,
        )
  await spawn.persisted()
  if (!spawn.recorded()) {
    ctx.emit({ altitude: 'L2', type: 'child_spawned', child: child.id, runId: handle.runId })
  }
  return settleObservedChild(deps, state, ctx, options.stop, child.id, handle, resolve, next)
}

/**
 * Sequential topo execution loop (D8): walks `state.plan.childIds` in order,
 * one child in flight, skipping children already `done` and re-observing —
 * instead of re-spawning — any child whose log records a live flight (see
 * `resumeHandleOf`), or whose `failed`-marked last spawned run has since
 * completed (see `completedFailedChildHandleOf`). Before each spawn the D10
 * budget guard fail-closes on unknown-or-exceeded tree spend, the D11
 * calm-stop seam is honored, and a still-non-terminal child run surfaces its
 * `sdd <runId>` line instead of a re-spawn over the session id it holds.
 * Each spawn is recorded durably — the `child_spawned { child, runId }` line
 * plus a persisted `running` child status — the moment the nested run dir is
 * known (before the flight), so a parent crash mid-child resumes by
 * re-observing that runId instead of re-spawning a duplicate; a seam that
 * never reports a run dir falls back to recording it after the flight. A
 * completed child then emits `child_done` with usage aggregated from the
 * child's own event log; a gate-pending child surfaces its `sdd <runId>`
 * line; a failed child stops the loop (D9). The walk's end marks the parent
 * `completed` exactly when every child reads `done`.
 */
export async function runChildren(
  deps: OrchestratorDeps,
  state: RunState,
  ctx: StageContext,
  options: RunChildrenOptions,
): Promise<RunChildrenResult> {
  const children = await planChildrenOf(ctx)
  if (state.plan === undefined) throw new Error('runChildren requires a recorded plan')
  const childIds = state.plan.childIds
  const resolve = deps.resolveCost ?? (await buildResolveCost())
  const runAt = async (index: number): Promise<RunChildrenResult> => {
    const childId = childIds[index]
    if (childId === undefined) {
      state.status = 'completed'
      await saveRunState(state, deps.now?.() ?? new Date())
      return { halted: 'completed' }
    }
    if (state.children?.[childId]?.status === 'done') return runAt(index + 1)
    const stop = options.stop
    const resumed = resumeHandleOf(state, childId)
    if (resumed !== null)
      return settleObservedChild(deps, state, ctx, stop, childId, resumed, resolve, () => runAt(index + 1))
    const adopted = await completedFailedChildHandleOf(deps, state, childId)
    if (adopted !== null)
      return settleObservedChild(deps, state, ctx, stop, childId, adopted, resolve, () => runAt(index + 1))
    if (stop !== undefined && stop.stopRequested()) return calmSettle(deps, state, stop)
    const spend = treeSpend(readEvents(logPathFor(state)), resolve)
    const committed = (state.spendBaselineUsd ?? 0) + spend.spentUsd
    if (!spend.costKnown || committed >= deps.config.budget) {
      return stopAtBudgetGuard(deps, state, childId, { ...spend, spentUsd: committed })
    }
    const holder = await stopAtLiveChildHolder(deps, state, childId)
    if (holder !== null) return { halted: 'stopped', child: childId, childStatus: holder.status }
    const child = children.find((entry) => entry.id === childId)
    if (child === undefined) throw new Error(`plan sidecar has no child ${childId}`)
    return spawnAndSettle(deps, state, ctx, options, child, index, committed, resolve, () => runAt(index + 1))
  }
  return runAt(0)
}
