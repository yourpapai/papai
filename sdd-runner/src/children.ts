// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { propagateChildStop } from './child-stop.js'
import { slugify } from './config.js'
import { readEvents } from './events.js'
import type { OrchestratorDeps, RunStartResult, StageContext } from './gate-digest.js'
import { logPathFor, presentGateAt } from './gate-digest.js'
import { PLAN_REVIEW_SURROGATE } from './gate-prelude.js'
import { materializeChildFiles, planDigest, topoSortChildren } from './plan.js'
import { PlanSchema } from './plan.js'
import type { PlanChild, PlanFsDeps } from './plan.js'
import { settleStoppedResult } from './resume-flow.js'
import { loadRunState, saveRunState } from './run-state.js'
import type { RunState } from './run-state.js'
import type { CalmStopController } from './stop-controller.js'
import { aggregateUsage } from './usage-aggregate.js'
import { buildResolveCost } from './usage-aggregate.js'
import { childUsageOf } from './usage-aggregate.js'
import { treeSpend } from './usage-aggregate.js'
import type { TreeSpend } from './usage-aggregate.js'

export interface PlanBranchOptions {
  /** Injected fs seam (D7): hermetic materialization under test. */
  readonly fs?: PlanFsDeps
}

const DEFAULT_FS: PlanFsDeps = { mkdir, writeFile, readdir, unlink }

/** D4 row text: `<child-id> — <instruction first line>` plus deps/capabilities. */
export function gateRowText(child: PlanChild): string {
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
    children: rowsOf(ordered),
  })
}

/** D4 rows: `C<n>` ids numbered in topo order, one per child. */
/** D4 rows for a topo-ordered plan: `C<n>` ids numbered in order, one per child. */
export function rowsOf(ordered: readonly PlanChild[]): { readonly id: string; readonly text: string }[] {
  return ordered.map((child, index) => ({ id: `C${index + 1}`, text: gateRowText(child) }))
}

/** Injected nested-run seam (D7): the orchestrator supplies the real runStart. */
export type RunChildRun = (
  child: PlanChild,
  taskFile: string,
  spendBaselineUsd: number,
  onRunDirReady?: (childRunDir: string) => void,
) => Promise<{ readonly runId: string }>

export interface RunChildrenOptions {
  readonly runChildRun: RunChildRun
  /** Parent calm-stop seam (D11): honored at child boundaries and propagated in flight. */
  readonly stop?: CalmStopController
}

/** D11 calm settlement: consume the parent marker, record `stopped`, stay resumable. */
function calmSettle(deps: OrchestratorDeps, state: RunState, stop: CalmStopController): Promise<RunChildrenResult> {
  const pending: { readonly runId: string; readonly halted: 'stopped' } = {
    runId: state.runId,
    halted: 'stopped',
  }
  return settleStoppedResult(deps, state, stop, pending)
}

function assertStopPresent(stop: CalmStopController | undefined): asserts stop is CalmStopController {
  if (stop === undefined) throw new Error('calm stop requested without a stop seam')
}

export type RunChildrenResult =
  | { readonly halted: 'gate-pending'; readonly childRunId: string }
  | { readonly halted: 'stopped'; readonly child: string; readonly childStatus: string }
  | { readonly runId: string; readonly halted: 'stopped' }
  | { readonly halted: 'completed' }

/** Load the current plan sidecar — the single source of full child records (D3). */
async function planChildrenOf(ctx: StageContext): Promise<readonly PlanChild[]> {
  const raw = await readFile(path.join(ctx.sidecarDir, 'plan.json'), 'utf8')
  return PlanSchema.parse(JSON.parse(raw)).children
}

/**
 * D9 failure stop: a child ending non-completed halts the loop immediately.
 * The child books `failed`, the parent persists `stopped` (resumable at this
 * child), and the operator line names the blocking child and its status.
 */
async function stopAtFailedChild(
  deps: OrchestratorDeps,
  state: RunState,
  ctx: StageContext,
  childId: string,
  childStatus: string,
): Promise<RunChildrenResult> {
  ctx.emit({ altitude: 'L2', type: 'child_done', child: childId, outcome: 'failed' })
  state.children = { ...state.children, [childId]: { status: 'failed' } }
  state.status = 'stopped'
  await saveRunState(state, deps.now?.() ?? new Date())
  deps.stdout?.(`child ${childId} ended '${childStatus}' — parent stopped (resumable)`)
  return { halted: 'stopped', child: childId, childStatus }
}

/**
 * D10 budget guard: halt before the next `child_spawned` when the aggregate
 * tree spend is unknown or already meets the single budget. The parent
 * persists `stopped` (resumable once the ledger is known/under budget).
 */
async function stopAtBudgetGuard(
  deps: OrchestratorDeps,
  state: RunState,
  childId: string,
  spend: TreeSpend,
): Promise<RunChildrenResult> {
  state.status = 'stopped'
  await saveRunState(state, deps.now?.() ?? new Date())
  const shape = spend.costKnown ? `$${spend.spentUsd.toFixed(2)}` : 'unknown'
  deps.stdout?.(
    `budget guard: tree spend ${shape} vs budget $${deps.config.budget.toFixed(2)} — parent stopped before child ${childId} (resumable)`,
  )
  return { halted: 'stopped', child: childId, childStatus: 'budget-guard' }
}

/** D8 completion bookkeeping: child_done with aggregated usage, child marked done, parent persisted. */
async function settleCompletedChild(
  deps: OrchestratorDeps,
  state: RunState,
  ctx: StageContext,
  childId: string,
  childRunDir: string,
  resolve: Parameters<typeof aggregateUsage>[1],
): Promise<void> {
  const usage = childUsageOf(childRunDir, resolve)
  ctx.emit({
    altitude: 'L2',
    type: 'child_done',
    child: childId,
    outcome: 'done',
    ...(usage === undefined ? {} : { usage }),
  })
  state.children = { ...state.children, [childId]: { status: 'done' } }
  await saveRunState(state, deps.now?.() ?? new Date())
}

/**
 * Post-flight observation (D8/D9/D11): calm-stop wins — a not-completed
 * child is recorded `running` (like the gate-pending branch) so a parent
 * resume re-observes its spawned runId instead of re-spawning a duplicate
 * over the same change folder; then done/gate/failure.
 */
async function settleObservedChild(
  deps: OrchestratorDeps,
  state: RunState,
  ctx: StageContext,
  stop: CalmStopController | undefined,
  childId: string,
  handle: { readonly runId: string },
  resolve: Parameters<typeof aggregateUsage>[1],
  next: () => Promise<RunChildrenResult>,
): Promise<RunChildrenResult> {
  const childState = await loadRunState(deps.config.workDir, handle.runId).catch(() => null)
  const completed = childState !== null && childState.status === 'completed'
  if (stop?.stopRequested() === true) {
    assertStopPresent(stop)
    if (completed) {
      await settleCompletedChild(deps, state, ctx, childId, childState.runDir, resolve)
    } else {
      state.children = { ...state.children, [childId]: { status: 'running' } }
      await saveRunState(state, deps.now?.() ?? new Date())
    }
    return calmSettle(deps, state, stop)
  }
  if (childState === null) return stopAtFailedChild(deps, state, ctx, childId, 'unloadable')
  if (completed) {
    await settleCompletedChild(deps, state, ctx, childId, childState.runDir, resolve)
    return next()
  }
  if (childState.gate !== null) {
    state.children = { ...state.children, [childId]: { status: 'running' } }
    await saveRunState(state, deps.now?.() ?? new Date())
    deps.stdout?.(`child ${childId} awaits its gate (run ${handle.runId}) — settle it, then resume the parent`)
    deps.stdout?.(`sdd ${handle.runId}`)
    return { halted: 'gate-pending', childRunId: handle.runId }
  }
  return stopAtFailedChild(deps, state, ctx, childId, childState.status)
}

/**
 * D8 resume recovery: a `running` child halted at its own gate in an earlier
 * parent pass; its runId is the last recorded `child_spawned` line for that
 * child. Legacy lines without a runId yield null and the caller falls back
 * to a fresh spawn.
 */
function lastSpawnedHandleOf(state: RunState, childId: string): { readonly runId: string } | null {
  for (const event of readEvents(logPathFor(state)).reverse()) {
    if (event.type === 'child_spawned' && event.child === childId && event.runId !== undefined) {
      return { runId: event.runId }
    }
  }
  return null
}

/**
 * Sequential topo execution loop (D8): walks `state.plan.childIds` in order,
 * one child in flight, skipping children already `done` and re-observing a
 * `running` child (recovered from its last `child_spawned` runId) instead of
 * re-spawning it. Before each spawn
 * the D10 budget guard fail-closes on unknown-or-exceeded tree spend and the
 * D11 calm-stop seam is honored. A completed child emits `child_spawned`
 * then `child_done` with usage aggregated from the child's own event log; a
 * gate-pending child surfaces its `sdd <runId>` line; a failed child stops
 * the loop (D9). The walk's end marks the parent `completed` exactly when
 * every child reads `done`.
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
  const runAt = async (index: number): Promise<RunChildrenResult> => {
    const childId = childIds[index]
    if (childId === undefined) {
      state.status = 'completed'
      await saveRunState(state, deps.now?.() ?? new Date())
      return { halted: 'completed' }
    }
    if (state.children?.[childId]?.status === 'done') return runAt(index + 1)
    const stop = options.stop
    if (state.children?.[childId]?.status === 'running') {
      const observed = lastSpawnedHandleOf(state, childId)
      if (observed !== null) {
        return settleObservedChild(deps, state, ctx, stop, childId, observed, resolve, () => runAt(index + 1))
      }
    }
    if (stop !== undefined && stop.stopRequested()) return calmSettle(deps, state, stop)
    const spend = treeSpend(readEvents(logPathFor(state)))
    if (!spend.costKnown || spend.spentUsd >= deps.config.budget) {
      return stopAtBudgetGuard(deps, state, childId, spend)
    }
    const child = children.find((entry) => entry.id === childId)
    if (child === undefined) throw new Error(`plan sidecar has no child ${childId}`)
    const taskFile = path.join(state.runDir, 'children', `${index + 1}-${slugify(childId)}.md`)
    const handle =
      stop === undefined
        ? await options.runChildRun(child, taskFile, spend.spentUsd)
        : await propagateChildStop({ runChildRun: options.runChildRun, stop }, child, taskFile, spend.spentUsd)
    ctx.emit({ altitude: 'L2', type: 'child_spawned', child: childId, runId: handle.runId })
    return settleObservedChild(deps, state, ctx, stop, childId, handle, resolve, () => runAt(index + 1))
  }
  return runAt(0)
}
