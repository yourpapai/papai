// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { existsSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'

/**
 * Calm stop seam (design D6): a stop request is honored at the next stage or
 * round boundary — in-flight agents run to completion, artifacts and the
 * event log stay consistent, and the run records a stopped-but-resumable
 * status. Two sources feed it: the TUI stop key in-process (`request`) and
 * the `sdd stop` verb from another process via the cross-process marker file
 * (`stop-requested`), which beats signals because it survives process
 * boundaries and targets the run you meant.
 */

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
