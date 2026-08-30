// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { countedTokens } from './agent-session.js'
import type { RunSpend } from './agent-session.js'
import type { ClaudeStreamLine } from './claude-contract.js'
import type { Logger } from './logger.js'
import type { OpenAiSettings } from './openai-config.js'
import { foldRateLimits } from './rate-limit-windows.js'
import { resolveRunCost } from './run-spend.js'

/**
 * What a claude session's stream said about spend, accumulated as it arrives.
 *
 * Split out of `claude-adapter.ts` when that file passed `max-lines`, along the
 * seam it already had: the adapter drives a session — spawn, resume, abort,
 * teardown — and this counts what the session cost. They change for different
 * reasons, and only one of them has an opinion about money.
 *
 * Everything here is folded from `result` and `rate_limit_event` lines **as they
 * arrive**, before any teardown can race them (design D8). That ordering is the
 * whole reason this is accumulated state rather than a query: the CLI process is
 * gone by the time anyone asks.
 */
export interface ClaudeAccounting {
  /**
   * Whether any usage was seen at all. Distinguishes a session that spent
   * nothing from one whose usage the pipeline failed to recognize — the second
   * must not report `$0`.
   */
  sawUsage: boolean
  /** The CLI's own cost figure, summed across the run's turns. */
  costUsdTotal: number
  /**
   * Every bucket the run's `result` lines reported, accumulated and never
   * summed here.
   *
   * The two readers want different sums of it and must not share one: the
   * **price** charges all four at their own rates, while the **ceiling** takes
   * {@link countedTokens} over it and leaves the cache reads out. A running
   * `tokensTotal` used to sit beside this and answer the ceiling; it was a
   * second representation of the same fact, free to disagree with it, and the
   * sum it held was the wrong one.
   */
  buckets: { input: number; output: number; cacheRead: number; cacheWrite: number }
  /**
   * Every rate-limit line, kept raw so {@link foldRateLimits} decides the
   * standing. Accumulated here rather than in the progress tracker because that
   * channel is a live log and this is a run's final account —
   * `claude-progress.ts` goes on ignoring the line.
   */
  rateLimitLines: ClaudeStreamLine[]
}

export const emptyAccounting = (): ClaudeAccounting => ({
  sawUsage: false,
  costUsdTotal: 0,
  buckets: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  rateLimitLines: [],
})

/** Folds one decoded line into the run's account. Lines it does not price are ignored. */
export const recordLine = (accounting: ClaudeAccounting, line: ClaudeStreamLine): void => {
  if (line.kind === 'rate-limit-event') {
    accounting.rateLimitLines.push(line)
    return
  }
  if (line.kind !== 'result') return

  accounting.sawUsage = true
  // The CLI's own arithmetic over its own counts. On a subscription this is list
  // price for work the plan already paid for — a caveat for the render rather
  // than a reason to drop the best figure available.
  accounting.costUsdTotal += line.costUsd
  accounting.buckets.input += line.usage.input
  accounting.buckets.output += line.usage.output
  accounting.buckets.cacheRead += line.usage.cacheRead
  accounting.buckets.cacheWrite += line.usage.cacheWrite
}

/**
 * What this session has spent against the ceiling: the seam's definition over
 * the buckets accumulated so far.
 *
 * A function rather than a field for the reason the field was removed — there
 * is one place the buckets live, and every sum of them is derived at the moment
 * it is asked for.
 */
export const ceilingTokensOf = (accounting: ClaudeAccounting): number => countedTokens(accounting.buckets)

/**
 * What the run cost, and the standing its provider reported.
 *
 * A session that saw no usage at all reports **unpriced**, not `$0`: the same
 * distinction `tokensUsed()` cannot make — it must return a number, so it
 * returns `0` and warns — except that here it can be said in the answer.
 *
 * The windows are reported either way. A run that failed before spending
 * anything may still have been told how much of the week is gone, and that is
 * exactly the run whose maintainer wants to know.
 */
export const spendOf = (accounting: ClaudeAccounting, settings: OpenAiSettings, log: Logger): Promise<RunSpend> => {
  const windows = foldRateLimits(accounting.rateLimitLines)
  if (!accounting.sawUsage) return Promise.resolve({ usd: null, source: 'none', windows })

  return resolveRunCost(
    {
      backendUsd: accounting.costUsdTotal,
      buckets: {
        input: accounting.buckets.input,
        output: accounting.buckets.output,
        reasoning: 0,
        cacheRead: accounting.buckets.cacheRead,
        cacheWrite: accounting.buckets.cacheWrite,
      },
      settings,
    },
    { log },
  ).then((cost) => ({ ...cost, windows }))
}
