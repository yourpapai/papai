// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { emitChildDoneOnce, lastSpawnedHandleOf } from './child-spawn.js'
import type { OrchestratorDeps, StageContext } from './gate-digest.js'
import type { PlanChild } from './plan.js'
import { settleStoppedResult } from './resume-flow.js'
import { loadRunState, runDirOf, saveRunState } from './run-state.js'
import type { RunState } from './run-state.js'
import type { CalmStopController } from './stop-controller.js'
import { aggregateUsage } from './usage-aggregate.js'
import { childUsageOf } from './usage-aggregate.js'
import type { TreeSpend } from './usage-aggregate.js'

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

export type RunChildrenResult =
  | { readonly halted: 'gate-pending'; readonly childRunId: string }
  | { readonly halted: 'stopped'; readonly child: string; readonly childStatus: string }
  | { readonly runId: string; readonly halted: 'stopped' }
  | { readonly halted: 'completed' }

/** D11 calm settlement: consume the parent marker, record `stopped`, stay resumable. */
export function calmSettle(
  deps: OrchestratorDeps,
  state: RunState,
  stop: CalmStopController,
): Promise<RunChildrenResult> {
  const pending: { readonly runId: string; readonly halted: 'stopped' } = {
    runId: state.runId,
    halted: 'stopped',
  }
  return settleStoppedResult(deps, state, stop, pending)
}

function assertStopPresent(stop: CalmStopController | undefined): asserts stop is CalmStopController {
  if (stop === undefined) throw new Error('calm stop requested without a stop seam')
}

/**
 * D9 failure stop: a child ending non-completed halts the loop immediately.
 * The child books `failed`, the parent persists `stopped` (resumable at this
 * child), and the operator line names the blocking child and its status. A
 * readable child log prices the failed `child_done` so the D10 ledger stays
 * known across resumes — the spawn record's runId recovers the run dir even
 * when the child state is unloadable; an unreadable child log (no run dir)
 * stays usage-less and fails closed.
 */
async function stopAtFailedChild(
  deps: OrchestratorDeps,
  state: RunState,
  ctx: StageContext,
  childId: string,
  childStatus: string,
  childRunDir: string | undefined,
  resolve: Parameters<typeof aggregateUsage>[1],
): Promise<RunChildrenResult> {
  const usage = childRunDir === undefined ? undefined : childUsageOf(childRunDir, resolve)
  emitChildDoneOnce(ctx, state, childId, 'failed', usage)
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
export async function stopAtBudgetGuard(
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

/** D8 completion bookkeeping: the flight's `child_done` (superseding any stale `failed` line) with aggregated usage, child marked done, parent persisted. */
async function settleCompletedChild(
  deps: OrchestratorDeps,
  state: RunState,
  ctx: StageContext,
  childId: string,
  childRunDir: string,
  resolve: Parameters<typeof aggregateUsage>[1],
): Promise<void> {
  const usage = childUsageOf(childRunDir, resolve)
  emitChildDoneOnce(ctx, state, childId, 'done', usage)
  state.children = { ...state.children, [childId]: { status: 'done' } }
  await saveRunState(state, deps.now?.() ?? new Date())
}

/**
 * Post-flight observation (D8/D9/D11): calm-stop wins — a not-completed
 * child is recorded `running` (like the gate-pending branch) so a parent
 * resume re-observes its spawned runId instead of re-spawning a duplicate
 * over the same change folder; then done/gate/failure.
 */
export async function settleObservedChild(
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
  if (childState === null) {
    return stopAtFailedChild(
      deps,
      state,
      ctx,
      childId,
      'unloadable',
      runDirOf(deps.config.workDir, handle.runId),
      resolve,
    )
  }
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
  return stopAtFailedChild(deps, state, ctx, childId, childState.status, childState.runDir, resolve)
}

/**
 * D9 ledger sync: a `failed`-marked child whose last spawned run has since
 * been resumed to `completed` — the operator recovery `stopAtLiveChildHolder`
 * prints ("resume or settle it, then resume the parent") — is re-observed
 * for adoption as done instead of re-spawning a duplicate over the change
 * folder that flight already produced. Only `failed` adopts: a `pending`
 * child's closed flight is a stale spawn of a superseded plan.
 */
export async function completedFailedChildHandleOf(
  deps: OrchestratorDeps,
  state: RunState,
  childId: string,
): Promise<{ readonly runId: string } | null> {
  if (state.children?.[childId]?.status !== 'failed') return null
  const handle = lastSpawnedHandleOf(state, childId)
  if (handle === null) return null
  const childState = await loadRunState(deps.config.workDir, handle.runId).catch(() => null)
  return childState !== null && childState.status === 'completed' ? handle : null
}
