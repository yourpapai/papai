// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ProgressTracker } from './progress.js'

/**
 * Draining the OpenCode event stream into whatever is watching it.
 *
 * Split from `progress.ts` when the stall record pushed that file past
 * `max-lines`, along the seam it already had: that module decides what a running
 * turn *means* — a line, a count, a provider that will not answer — and this one
 * owns a *stream*, which has a lifetime, a teardown and a way of outliving the
 * server that feeds it. The dependency is one-directional, as it was when the
 * heartbeat was split off: this reads the tracker only through `ProgressTracker`.
 */

export interface EventFollower {
  /** Resolves when the stream ends, however it ends. Never rejects. */
  done: Promise<void>
  /** Asks the stream to finish. Safe to call more than once. */
  stop: () => void
}

/**
 * Drains an event stream into a tracker until it ends or is stopped.
 *
 * `for await` rather than the repo's `sequence.ts` helpers, which iterate a
 * collection already in hand: this consumes an open stream of unknown length,
 * which is the one case the no-`await`-in-a-loop rule exempts.
 *
 * `done` never rejects. The stream dies whenever the OpenCode server does —
 * including during an ordinary `close()` — and a teardown race must not become
 * an unhandled rejection that fails a run whose work is already finished.
 *
 * `stop` exists because a stream is not guaranteed to notice that its server is
 * gone. The SDK's SSE client reconnects for ever by default, so "wait for the
 * events to run out" is not a teardown step a caller can rely on; it has to be
 * able to say stop and move on.
 */
export const followEvents = (source: AsyncIterable<unknown>, tracker: ProgressTracker): EventFollower => {
  const iterator = source[Symbol.asyncIterator]()
  let stopped = false

  const drain = async (): Promise<void> => {
    try {
      for await (const event of { [Symbol.asyncIterator]: () => iterator }) {
        if (stopped) break
        tracker.observe(event)
      }
    } catch {
      // The stream ending badly tells us nothing the caller can act on.
    }
  }

  return {
    done: drain(),
    stop: (): void => {
      stopped = true
      // Unblocks a `next()` that is waiting on a socket nobody will write to.
      void iterator.return?.(undefined)
    },
  }
}
