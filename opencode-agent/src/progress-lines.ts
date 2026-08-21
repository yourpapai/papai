// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Activity } from './activity.js'

/**
 * The public lines `progress.ts` prints — the half of progress reporting that a
 * CI reader sees.
 *
 * Split from `progress.ts` when the provider transcript rows pushed that file
 * past `max-lines`, along the seam its own docblock draws: that file decides
 * *what to do* about an event (fold, feed, count, log), this one is the pure
 * rendering of the one line each kind earns. Pure functions of an
 * `Activity`, no state, no clock — which is also why the containment rule is
 * easy to hold here: names, statuses, counts and durations are all a line is
 * *made of*.
 */

/** One decimal place: `3.2s` — a duration is orientation, not measurement. */
export const formatDuration = (ms: number): string => `${(ms / 1_000).toFixed(1)}s`

/**
 * The line one tool activity earns.
 *
 * Two lines per tool call and no more: `▸ bash (running)` when it starts and
 * `✓ bash 3.2s` when it ends, with `✗` for a failed one. A completion whose
 * start was never seen carries no duration — the tracker's clock is the only
 * honest source, since `state.time.start` belongs to the server's clock.
 *
 * Plain text, with the metadata left empty: the pretty line is the message,
 * so a NDJSON renderer adds no structure and a text renderer loses nothing.
 * Names, statuses, counts and durations only — the containment rule from
 * `activity.ts` applies to the line exactly as it applied to the metadata.
 */
export const toolLine = (activity: Activity, durationMs: number | null): string => {
  const tool = String(activity.meta['tool'])
  const status = String(activity.meta['status'])
  if (status === 'running') return `▸ ${tool} (running)`
  const duration = durationMs === null ? '' : ` ${formatDuration(durationMs)}`
  return `${status === 'error' ? '✗' : '✓'} ${tool}${duration}`
}

/**
 * The line a session status earns, attempt number included when there is one.
 *
 * `● retry (attempt 3)` is the most operationally interesting status there is:
 * it says the run is being rate limited rather than merely slow. The
 * provider's own message, which the event also carries, is decoded for the
 * encrypted transcript only — never for this line.
 */
export const statusLine = (activity: Activity): string => {
  const status = String(activity.meta['status'])
  const attempt = activity.meta['attempt']
  return attempt === undefined ? `● ${status}` : `● ${status} (attempt ${attempt})`
}
