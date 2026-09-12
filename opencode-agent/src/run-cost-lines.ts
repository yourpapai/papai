// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { RateLimitStanding } from './rate-limit-windows.js'

/**
 * The two lines of the run detail that talk about money and quota.
 *
 * Split from `run-detail.ts` when they pushed it past `max-lines`, along the
 * seam that file already draws in its own header: it decides *how a run
 * describes itself* — a table of milestones, a job link, a budget — and these
 * two are the half that describes what the run *cost* rather than where it got
 * to. A new milestone touches that file; a new figure touches this one.
 *
 * Everything here is a number or a name. There is nowhere for tool input, tool
 * output or model prose to land, so the rule that this surface carries names and
 * counts only holds by construction rather than by care — the property
 * `run-detail.ts` documents for the table, extended to the figures beside it.
 */

/** `$1.87`, always two decimals — money that renders as `$1.9` reads as a bug. */
const money = (usd: number): string => `$${usd.toFixed(2)}`

/**
 * What this run cost and what the issue has cost, or nothing at all.
 *
 * The per-run figure is a **difference**, not a field: the state the run entered
 * on and the state it ended on both carry the issue's running total, so this run
 * is what lies between them. That is the whole reason the two figures cannot
 * disagree — one is defined from the other rather than measured beside it, which
 * is the reconciliation bug `run-detail.ts` still carries a note about.
 *
 * An issue nothing has ever priced renders **no line**, rather than `$0.00`. A
 * missing line beats a line that says nothing — the rule `jobLine` already
 * follows for a local run with no job to link — and `$0.00` would be a claim.
 *
 * When any turn on the issue went unpriced the total is a **floor** and says so:
 * `≥ $12.40 (some turns unpriced)`. The per-run half is dropped in that case
 * rather than qualified twice; the sentence a maintainer needs is that the issue
 * has cost at least this much, and a second hedge on the same line reads as
 * noise.
 */
export const costLine = (runUsd: number, issueUsd: number, unpriced: boolean): readonly string[] => {
  if (issueUsd === 0 && unpriced) return []
  if (unpriced) return [`**Cost:** ≥ ${money(issueUsd)} on this issue (some turns unpriced)`]
  return [`**Cost:** ${money(runUsd)} this run · ${money(issueUsd)} on this issue`]
}

/** `five_hour` → `5-hour`, and anything unrecognized straight through. */
const windowLabel = (window: string): string => {
  if (window === 'five_hour') return '5-hour'
  if (window === 'seven_day') return '7-day'
  return window
}

/**
 * When a window resets, in UTC — a runner's local time is not the reader's.
 *
 * `HH:MM` while the reset is on the reader's own day, and `DD Mon HH:MM` once it
 * is not. The bare clock is what the job line uses and is right for a five-hour
 * window, which always resets within the day; on a **weekly** window it is a
 * trap — "resets 09:44 UTC" for something five days out reads as this morning,
 * which is the opposite of what it means.
 */
const resetUtc = (epochSeconds: number, nowMs: number): string => {
  const at = new Date(epochSeconds * 1000)
  const clock = at.toISOString().slice(11, 16)
  if (at.toISOString().slice(0, 10) === new Date(nowMs).toISOString().slice(0, 10)) return `${clock} UTC`
  const day = at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  return `${day} ${clock} UTC`
}

/**
 * What is left of one window, as a percentage.
 *
 * The provider states a **consumed** share as a 0–1 fraction; remaining is its
 * complement, and this subtraction is the only place it happens. A window whose
 * share the provider did not state renders without a figure rather than with a
 * guessed one — nothing is inferred from a reset timestamp or from another
 * window.
 *
 * Clamped at zero because a plan can be over its limit (`utilization` above 1),
 * and "-4% left" is not a thing a maintainer can act on. One decimal, because
 * the provider publishes tenths and rounding 76.5 to 77 throws away the only
 * precision on the line.
 */
const remaining = (utilization: number): string => {
  const left = Math.max(0, 100 - utilization * 100)
  // A whole number renders whole. `0.0% left` on a spent window, and `50.0%` on
  // a half-used one, read as precision the provider did not publish.
  return `${Number.isInteger(left) ? String(left) : left.toFixed(1)}% left`
}

/**
 * One window as a phrase: `5-hour 76.5% left, resets 12:44 UTC`.
 *
 * Comma-separated rather than space-separated, because `76.5% left resets 12:44`
 * runs two facts together into something that reads like one broken sentence.
 */
const windowPhrase = (standing: RateLimitStanding, nowMs: number): string =>
  [
    [
      windowLabel(standing.window),
      ...(standing.utilization === undefined ? [] : [remaining(standing.utilization)]),
    ].join(' '),
    ...(standing.resetsAt === undefined ? [] : [`resets ${resetUtc(standing.resetsAt, nowMs)}`]),
    ...(standing.isUsingOverage === true ? ['on overage'] : []),
  ].join(', ')

/**
 * The provider's standing, one phrase per window it actually reported.
 *
 * No windows renders **no line**: a route that is not a Claude subscription has
 * nothing to say here, and an empty "Claude limits:" label would read as "no
 * limits" rather than as "not applicable".
 */
export const limitsLine = (windows: readonly RateLimitStanding[], nowMs: number): readonly string[] =>
  windows.length === 0 ? [] : [`**Claude limits:** ${windows.map((w) => windowPhrase(w, nowMs)).join(' · ')}`]
