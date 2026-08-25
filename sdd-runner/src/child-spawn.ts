// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

import { readEvents } from './events.js'
import type { AgentUsage } from './events.js'
import type { OrchestratorDeps, StageContext } from './gate-digest.js'
import { logPathFor } from './gate-digest.js'
import { saveRunState } from './run-state.js'
import type { RunState } from './run-state.js'

/** D8 spawn bookkeeping: record spawns and settlements durably, recover flight state on resume. */
export interface SpawnRecorder {
  /** Seam callback: fire-and-persist once when the nested run dir is known. */
  readonly onRunDirReady: (runDir: string) => void
  /** Whether `onRunDirReady` already fired (suppresses the post-flight fallback emit). */
  readonly recorded: () => boolean
  /** The early `running`-status save, for the caller to await after the flight. */
  readonly persisted: () => Promise<unknown>
}

/**
 * D8 crash-durability: recording the spawn only after a nested run resolves
 * loses the runId to any parent crash mid-child — resume would re-spawn a
 * duplicate over the same change folder and collide with the orphan. So the
 * `child_spawned { child, runId }` line (synchronous append) and a persisted
 * `running` child status land the moment the nested run dir is known, before
 * the flight does any work; once per flight.
 */
export function spawnRecorderOf(
  deps: OrchestratorDeps,
  state: RunState,
  ctx: StageContext,
  childId: string,
): SpawnRecorder {
  let recorded = false
  let persist: Promise<unknown> = Promise.resolve()
  return {
    onRunDirReady: (runDir: string): void => {
      if (recorded) return
      recorded = true
      ctx.emit({ altitude: 'L2', type: 'child_spawned', child: childId, runId: path.basename(runDir) })
      state.children = { ...state.children, [childId]: { status: 'running' } }
      persist = saveRunState(state, deps.now?.() ?? new Date())
    },
    recorded: (): boolean => recorded,
    persisted: (): Promise<unknown> => persist,
  }
}

/**
 * D8 resume recovery: a `running` child from an earlier parent pass (halted
 * at its own gate, or a parent crash mid-flight); its runId is the last
 * recorded `child_spawned` line for that child. Legacy lines without a
 * runId yield null and the caller falls back to a fresh spawn.
 */
export function lastSpawnedHandleOf(state: RunState, childId: string): { readonly runId: string } | null {
  for (const event of readEvents(logPathFor(state)).reverse()) {
    if (event.type === 'child_spawned' && event.child === childId && event.runId !== undefined) {
      return { runId: event.runId }
    }
  }
  return null
}

/**
 * D8 crash-window recovery: the `child_spawned` append is synchronous while
 * its `running`-status save is not, so a spawn line can outlive the save. The
 * child's open flight — the last post-plan `child_spawned` for it, not yet
 * closed by its own `child_done` — is the durable record that a nested run
 * already exists; resume re-observes it instead of re-spawning a duplicate.
 * A `plan` event resets the fold, so stale flights of a superseded plan never
 * win; legacy spawn lines without a runId cannot be re-observed.
 */
export function openFlightHandleOf(state: RunState, childId: string): { readonly runId: string } | null {
  let open: { readonly runId: string } | null = null
  for (const event of readEvents(logPathFor(state))) {
    if (event.type === 'plan') open = null
    if (event.type === 'child_spawned' && event.child === childId && event.runId !== undefined) {
      open = { runId: event.runId }
    }
    if (event.type === 'child_done' && event.child === childId) open = null
  }
  return open
}

/**
 * D8 settlement idempotency: whether the child's current flight already
 * carries its `child_done` — the append can land before a crash loses the
 * matching status save, and a second line would double-count the flight's
 * usage in the D10 ledger. A new `child_spawned` re-arms it (a retried child
 * settles — and spends — again).
 */
export function flightSettledFor(state: RunState, childId: string): boolean {
  let settled = false
  for (const event of readEvents(logPathFor(state))) {
    if (event.type === 'child_spawned' && event.child === childId) settled = false
    if (event.type === 'child_done' && event.child === childId) settled = true
  }
  return settled
}

/**
 * D8 resume decision: the handle a not-yet-done child re-observes instead of
 * re-spawning — the last recorded spawn while its status reads `running`
 * (gate-pending or a crash mid-flight, settlement replayed idempotently),
 * else its open post-plan flight (a spawn whose `running`-status save was
 * lost to a crash in the append/save window). Null means a fresh spawn.
 */
export function resumeHandleOf(state: RunState, childId: string): { readonly runId: string } | null {
  if (state.children?.[childId]?.status === 'running') {
    const observed = lastSpawnedHandleOf(state, childId)
    if (observed !== null) return observed
  }
  return openFlightHandleOf(state, childId)
}

/**
 * D8 settlement recording: appends the flight's `child_done` (with usage when
 * priced) at most once — the append is synchronous while the status save is
 * not, so a crash in that window leaves a line the resume's settlement
 * replay must not duplicate, or the flight's usage would double-count in the
 * D10 ledger.
 */
export function emitChildDoneOnce(
  ctx: StageContext,
  state: RunState,
  childId: string,
  outcome: 'done' | 'failed',
  usage: AgentUsage | undefined,
): void {
  if (flightSettledFor(state, childId)) return
  ctx.emit({
    altitude: 'L2',
    type: 'child_done',
    child: childId,
    outcome,
    ...(usage === undefined ? {} : { usage }),
  })
}
