// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ClaudeStreamLine, RateLimitWindow } from './claude-contract.js'

/**
 * What the provider said about its own limits, folded across a run's turns.
 *
 * Separate from `claude-contract.ts` for the reason that file gives for its own
 * split: that one says what a *line* is, this one says what a *run* concluded
 * from many of them. They change for different reasons — a line shape moves when
 * the CLI moves, this fold moves when the question "which standing does the next
 * run meet" gets a different answer.
 */

/** One window's standing at the end of a run, account-level facts folded in. */
export interface RateLimitStanding extends RateLimitWindow {
  readonly status?: string
  readonly overageStatus?: string
  readonly overageResetsAt?: number
  readonly isUsingOverage?: boolean
}

/**
 * Folds every rate-limit line a run saw into one standing per window.
 *
 * **Latest wins, per window.** A run makes many turns and every credentialed one
 * carries this line; the figure worth reporting is the last, because that is the
 * standing still true when the run ended and therefore the one the next run
 * meets. Taking the first would report a window's state from before the run
 * spent anything.
 *
 * **A window is never retired by a later line that omits it.** The account still
 * has that limit; a line that did not mention it said nothing about it, which is
 * not the same as saying it is gone. So the last figure *for that window* stands
 * — the alternative silently drops the weekly row whenever a turn reports only
 * the five-hour one.
 *
 * **First-seen order is kept** so two runs' reports read the same way round. A
 * `Map` gives that for free; the alternative sorts by name and puts `five_hour`
 * before `seven_day` for no reason a reader would recognize.
 *
 * The account-level facts — status, overage — ride onto each window of the line
 * that carried them rather than being hoisted somewhere separate: they are how
 * *that* observation should be read, and a run whose last line says
 * `allowed_warning` has said something about every window in it.
 */
export const foldRateLimits = (lines: readonly ClaudeStreamLine[]): readonly RateLimitStanding[] => {
  const standing = new Map<string, RateLimitStanding>()

  for (const line of lines) {
    if (line.kind !== 'rate-limit-event') continue
    for (const window of line.windows) {
      standing.set(window.window, {
        ...window,
        ...(line.status === undefined ? {} : { status: line.status }),
        ...(line.overageStatus === undefined ? {} : { overageStatus: line.overageStatus }),
        ...(line.overageResetsAt === undefined ? {} : { overageResetsAt: line.overageResetsAt }),
        ...(line.isUsingOverage === undefined ? {} : { isUsingOverage: line.isUsingOverage }),
      })
    }
  }

  return [...standing.values()]
}
