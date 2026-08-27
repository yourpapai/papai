// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { z } from 'zod'

import { loadRunState, saveRunState } from './run-state.js'

/**
 * Calm stop seam (design D6): a stop request is honored at the next stage or
 * round boundary — in-flight agents run to completion, artifacts and the
 * event log stay consistent, and the run records a stopped-but-resumable
 * status. Two sources feed it: the TUI stop key in-process (`request`) and
 * the `sdd stop` verb from another process via the cross-process marker file
 * (`stop-requested`), which beats signals because it survives process
 * boundaries and targets the run you meant.
 */

/** Process-ownership record (stop-dead-runs D1): `{ pid, startedAt }` in the run dir. */
export const HolderRecordSchema = z.object({
  pid: z.number().int().positive(),
  startedAt: z.string().min(1),
})

export type HolderRecord = z.infer<typeof HolderRecordSchema>

export function holderPath(runDir: string): string {
  return path.join(runDir, 'holder.json')
}

/** A process driving a run records itself before stage work begins. */
export function writeHolder(runDir: string, pid: number = process.pid, now: Date = new Date()): void {
  const record: HolderRecord = { pid, startedAt: now.toISOString() }
  writeFileSync(holderPath(runDir), `${JSON.stringify(record, null, 2)}\n`)
}

/** Clean exit gives the ownership record back; a crash leaves it behind. */
export function removeHolder(runDir: string): void {
  if (existsSync(holderPath(runDir))) rmSync(holderPath(runDir))
}

/** The parsed record, or null when absent or corrupt — never throws. */
export function readHolder(runDir: string): HolderRecord | null {
  let raw: string
  try {
    raw = readFileSync(holderPath(runDir), 'utf8')
  } catch {
    return null
  }
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(raw)
  } catch {
    return null
  }
  const parsed = HolderRecordSchema.safeParse(parsedJson)
  return parsed.success ? parsed.data : null
}

export type IsAlive = (pid: number) => boolean

export type KillFn = (pid: number, signal: 0) => void

/**
 * `kill(pid, 0)` liveness: success and EPERM (another user's live process)
 * mean alive; ESRCH and anything else mean not provably alive.
 */
export function pidIsAlive(pid: number, kill: KillFn = (target, signal) => process.kill(target, signal)): boolean {
  try {
    kill(pid, 0)
    return true
  } catch (error) {
    return error instanceof Error && (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Does a live process own this run? A missing or corrupt holder (crash or
 * pre-holder legacy run) reads as dead — absence never implies a live owner.
 */
export function runHasLiveOwner(runDir: string, isAlive: IsAlive = pidIsAlive): boolean {
  const holder = readHolder(runDir)
  return holder !== null && isAlive(holder.pid)
}

export type StopRunResult =
  | { readonly kind: 'no-op'; readonly runId: string; readonly status: string; readonly gatePending: boolean }
  | { readonly kind: 'marker-requested'; readonly runId: string }
  | { readonly kind: 'settled'; readonly runId: string; readonly to: 'stopped' | 'aborted' }

export interface StopRunDeps {
  readonly isAlive?: IsAlive
  readonly now?: () => Date
}

/**
 * The one liveness-aware stop entry (stop-dead-runs D2): a live owner gets
 * today's calm-stop marker (honored at its next boundary); a dead run settles
 * immediately — honest per-stage state (D3: `depth === null` and no recorded
 * plan means intake never classified, nothing to resume → aborted; otherwise
 * stopped — a plan parent carries `state.plan` and is resumable without a
 * depth) and a stale marker is consumed so a later resume is clean.
 * Non-running and gate-pending runs are no-ops.
 */
export async function stopRun(workDir: string, runId: string, deps: StopRunDeps = {}): Promise<StopRunResult> {
  const state = await loadRunState(workDir, runId)
  const gatePending = state.gate !== null
  if (state.status !== 'running' || gatePending) {
    return { kind: 'no-op', runId, status: state.status, gatePending }
  }
  if (runHasLiveOwner(state.runDir, deps.isAlive ?? pidIsAlive)) {
    requestCalmStop(state.runDir)
    return { kind: 'marker-requested', runId }
  }
  const to = state.depth === null && state.plan === undefined ? 'aborted' : 'stopped'
  const now = deps.now ?? ((): Date => new Date())
  await saveRunState({ ...state, status: to }, now())
  const settled = createStopMarkerSeam(state.runDir)
  settled.consumeMarker()
  return { kind: 'settled', runId, to }
}

/** Outcome → the operator line both stop surfaces print (D4). */
export function stopRunMessage(result: StopRunResult): string {
  if (result.kind === 'marker-requested') {
    return `calm stop requested for ${result.runId} — honored at the next boundary`
  }
  if (result.kind === 'settled') {
    return result.to === 'stopped'
      ? `run ${result.runId} has no live process — settled as stopped · resumable via sdd ${result.runId}`
      : `run ${result.runId} has no live process — settled as aborted · nothing to resume, start fresh: sdd <task-file>`
  }
  if (result.gatePending) {
    return `run ${result.runId} awaits a gate decision — nothing to stop`
  }
  return `run ${result.runId} is ${result.status} — nothing to stop`
}

export function stopMarkerPath(runDir: string): string {
  return path.join(runDir, 'stop-requested')
}

/** `sdd stop [id]`: another process asks this run to stop at its next boundary. */
export function requestCalmStop(runDir: string): void {
  writeFileSync(stopMarkerPath(runDir), `${new Date().toISOString()}\n`)
}

export type StopReason = 'marker' | 'key'

export interface CalmStopController {
  /** Why work must stop, or null while the run may carry on. */
  requested: () => StopReason | null
  /** True once a stop has been asked for (marker or in-process key). */
  stopRequested: () => boolean
  /** In-process stop request (TUI `q` / first Ctrl-C). */
  request: () => void
  /** Consume the marker when the stop is honored so a later resume is clean. */
  consumeMarker: () => void
  /** Release everything (timer/handlers) so the process is free to exit. */
  dispose: () => void
}

export function createStopMarkerSeam(runDir: string): CalmStopController {
  let reason: StopReason | null = null
  const checkMarker = (): boolean => {
    if (reason !== null) return true
    if (existsSync(stopMarkerPath(runDir))) {
      reason = 'marker'
      return true
    }
    return false
  }
  return {
    requested: () => {
      checkMarker()
      return reason
    },
    stopRequested: checkMarker,
    request: (): void => {
      reason ??= 'key'
    },
    consumeMarker: (): void => {
      if (existsSync(stopMarkerPath(runDir))) rmSync(stopMarkerPath(runDir))
    },
    dispose: (): void => {
      reason = null
    },
  }
}
