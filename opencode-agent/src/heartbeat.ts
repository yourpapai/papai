// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Logger } from './logger.js'
import type { ProgressSnapshot } from './progress.js'

/**
 * The heartbeat half of progress reporting: "is it still alive".
 *
 * `progress.ts` says what its two halves are for — events answer *what
 * happened*, the heartbeat answers *is it still alive* — and this is that
 * second half, in a file of its own once the transcript sink pushed the first
 * past `max-lines`. It knows nothing about events, and reads the tracker only
 * through the `snapshot` it is handed.
 */

export interface HeartbeatOptions {
  everyMs: number
  log: Logger
  snapshot: () => ProgressSnapshot
  /** Injected so a test does not spend real minutes proving this ticks. */
  schedule?: (tick: () => void, everyMs: number) => { cancel: () => void }
  /**
   * A second reader of the same tick, when one is wired — the stall bound.
   *
   * The heartbeat owns the only clock a running turn has, and the stall
   * watcher needs exactly that cadence: a health question asked while the
   * turn is outstanding, on a timer that already exists. Routing a reader
   * rather than duplicating the timer keeps one clock in the pipeline and
   * keeps the two readers from ever disagreeing about what a turn has done.
   *
   * The log half stays **first and unconditional**: the reader exists to stop
   * the turn, and the line saying the job was not stuck is the one thing the
   * tick already owed a CI reader. Nothing here awaits the reader either —
   * the heartbeat's job is to fire on time, not to wait for whatever the
   * tick is being reported to.
   */
  reader?: () => void
}

const realSchedule = (tick: () => void, everyMs: number): { cancel: () => void } => {
  const timer = setInterval(tick, everyMs)
  return {
    cancel: (): void => {
      clearInterval(timer)
    },
  }
}

/**
 * Says "still going, and here is what it has done so far" at a fixed interval
 * while `work` is outstanding.
 *
 * This is the half that actually answers the finding. Events only fire when
 * something happens, and the worst case — a single model call that thinks for
 * twenty minutes — produces no events at all, which is exactly the stretch that
 * reads as a hang. A tick that fires regardless is the only thing that
 * distinguishes "slow" from "dead" in a log.
 *
 * Must wrap the deadline rather than sit inside it: if the deadline rejects
 * while the underlying call is still pending, an inner heartbeat's cleanup
 * would never run and the interval would keep the process alive past the end of
 * the job.
 */
export const withHeartbeat = async <T>(work: Promise<T>, options: HeartbeatOptions): Promise<T> => {
  if (options.everyMs <= 0) return work

  const started = Date.now()
  const schedule = options.schedule ?? realSchedule
  const timer = schedule(() => {
    options.log.info(
      { elapsedMs: Date.now() - started, ...options.snapshot() },
      'Still waiting on the model; the job is not stuck',
    )
    // Second, and never instead of the line above: the reader may reject the
    // turn this tick belongs to, and the line is the one thing the tick owed a
    // CI reader regardless of what the stall watcher concludes.
    options.reader?.()
  }, options.everyMs)

  try {
    return await work
  } finally {
    timer.cancel()
  }
}
