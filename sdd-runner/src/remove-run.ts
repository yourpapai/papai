// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { rm } from 'node:fs/promises'

import { loadRunState } from './run-state.js'
import type { RunState } from './run-state.js'
import { pidIsAlive, runHasLiveOwner } from './stop-controller.js'
import type { IsAlive } from './stop-controller.js'

/**
 * Session removal (sdd-runner-session-removal): one guard plus a hard delete
 * of a single run directory. The guard never trusts the rendered row — it
 * re-reads persisted state at delete time and refuses while the run is
 * running (gate-pending and stop-requested included) or any live process
 * owns it, pointing at calm-stop (which settles ownerless runs immediately,
 * so the escape hatch always works). Nothing outside the run directory is
 * ever touched. The TOCTOU window between guard and rm is one confirmation
 * wide; a run starting concurrently recreates its directory as a fresh run,
 * so no partial-directory deletion path exists.
 */

export type RemoveRunResult =
  | { readonly kind: 'removed'; readonly runId: string }
  | { readonly kind: 'refused'; readonly runId: string; readonly reason: 'running' | 'live-owner' }

export interface RemoveRunDeps {
  /** Fresh persisted-state reader; defaults to the real `state.json` read. */
  readonly readState?: (workDir: string, runId: string) => Promise<RunState>
  /** Holder-pid liveness; defaults to `kill(pid, 0)`. */
  readonly isAlive?: IsAlive
  /** Recursive delete seam; defaults to `fs.rm(dir, { recursive: true })`. */
  readonly rm?: (target: string) => Promise<void>
}

const rmRecursive = (target: string): Promise<void> => rm(target, { recursive: true })

export async function removeRun(workDir: string, runId: string, deps: RemoveRunDeps = {}): Promise<RemoveRunResult> {
  const state = await (deps.readState ?? loadRunState)(workDir, runId)
  if (state.status === 'running') return { kind: 'refused', runId, reason: 'running' }
  if (runHasLiveOwner(state.runDir, deps.isAlive ?? pidIsAlive)) {
    return { kind: 'refused', runId, reason: 'live-owner' }
  }
  await (deps.rm ?? rmRecursive)(state.runDir)
  return { kind: 'removed', runId }
}

/** Outcome → the operator line both delete surfaces print. */
export function removeRunMessage(result: RemoveRunResult): string {
  if (result.kind === 'removed') return `run ${result.runId} deleted`
  if (result.reason === 'running') {
    return `run ${result.runId} is running (gate-pending or stop-requested included) — calm-stop it first: sdd stop ${result.runId}`
  }
  return `run ${result.runId} has a live owner process — calm-stop it first: sdd stop ${result.runId}`
}
