// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { withDeadline } from './deadline.js'
import type { Logger } from './logger.js'
import type { OpenCodeConnection } from './opencode-adapter.js'
import { createProgressTracker, followEvents } from './progress.js'
import type { EventFollower, ProgressTracker, TranscriptSink } from './progress.js'
import { errorMessage } from './types.js'

/**
 * Draining the server's event stream into the progress log, split from
 * `opencode-adapter.ts` when the transcript option pushed that file past
 * `max-lines`. The adapter owns the session; this owns what the session's
 * events become.
 */

/** How long teardown waits for reporting to wind down before giving up on it. */
const SHUTDOWN_GRACE_MS = 5_000

/**
 * Starts draining the event stream into a tracker, and hands back the off switch.
 *
 * Detached on purpose: the stream runs for the life of the server, so awaiting
 * it inline would never return. Nothing it does can reject, and a failed
 * subscription costs the run its progress log and nothing else — this is
 * reporting, and reporting must not be able to fail the work it reports on.
 *
 * `shutdown` stops the drain and then waits for it, so a `close()` that races a
 * still-arriving event does not cut it off mid-observation. Bounded, because
 * the one thing worse than losing a progress line is teardown hanging on the
 * reporting it is trying to shut down.
 */
export const startReporting = (
  connection: OpenCodeConnection,
  sessionId: string,
  log: Logger,
  transcript?: TranscriptSink,
): { tracker: ProgressTracker; shutdown: () => Promise<void> } => {
  const tracker = createProgressTracker(sessionId, log, { transcript })
  let follower: EventFollower | null = null
  let stopped = false

  const finished = connection
    .events()
    .then(async (stream) => {
      follower = followEvents(stream, tracker)
      // `shutdown()` can win the race against a slow subscription.
      if (stopped) follower.stop()
      await follower.done
    })
    .catch((error: unknown) => {
      log.warn({ error: errorMessage(error) }, 'No progress events; the run is unaffected')
    })

  return {
    tracker,
    shutdown: async (): Promise<void> => {
      stopped = true
      follower?.stop()
      await withDeadline(finished, SHUTDOWN_GRACE_MS, () => new Error('unused')).catch(() => {
        log.debug({}, 'Progress reporting did not wind down in time; continuing teardown')
      })
    },
  }
}
