// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { RunChildRun } from './child-settle.js'
import type { PlanChild } from './plan.js'
import { requestCalmStop } from './stop-controller.js'
import type { CalmStopController } from './stop-controller.js'

/** Nested-run seam shape `propagateChildStop` wraps (D11). */
export interface ChildFlightSeams {
  readonly runChildRun: RunChildRun
  readonly stop: CalmStopController
  /** D8 spawn bookkeeping: notified once the child's run dir is known, before flight work continues. */
  readonly onChildRunDir?: (childRunDir: string) => void
}

/** Poll cadence for the in-flight marker propagation. */
const CHILD_STOP_WATCH_MS = 25

/**
 * D11 subtree-scoped calm-stop: while the child is in flight, watch the
 * parent's marker; once the child's run dir is known and a stop is
 * requested, write the child's stop marker so its own seam honors it at its
 * next stage/round boundary. The marker is written once per flight — the
 * child's terminal settle consumes it, and a later watcher tick must not
 * resurrect it into a stale marker. The watcher is torn down when the
 * flight ends.
 */
export async function propagateChildStop(
  seams: ChildFlightSeams,
  child: PlanChild,
  taskFile: string,
  spendBaselineUsd: number,
): Promise<{ readonly runId: string }> {
  let childRunDir: string | null = null
  let markerWritten = false
  const propagate = (): void => {
    if (!markerWritten && childRunDir !== null && seams.stop.stopRequested()) {
      requestCalmStop(childRunDir)
      markerWritten = true
    }
  }
  const watcher = setInterval(propagate, CHILD_STOP_WATCH_MS)
  const onRunDirReady = (runDir: string): void => {
    childRunDir = runDir
    seams.onChildRunDir?.(runDir)
    propagate()
  }
  try {
    return await seams.runChildRun(child, taskFile, spendBaselineUsd, onRunDirReady)
  } finally {
    clearInterval(watcher)
  }
}
