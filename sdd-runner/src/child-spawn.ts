// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

import { readEvents } from './events.js'
import type { OrchestratorDeps, StageContext } from './gate-digest.js'
import { logPathFor } from './gate-digest.js'
import { saveRunState } from './run-state.js'
import type { RunState } from './run-state.js'

/** D8 spawn bookkeeping: record a spawn durably, recover its runId on resume. */
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
