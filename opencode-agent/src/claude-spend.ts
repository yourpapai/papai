// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { RunSpend } from './agent-session.js'
import { modelIdForCli } from './claude-argv.js'
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
  /** Every bucket summed — what the token ceiling reads. */
  tokensTotal: number
  /**
   * Whether any usage was seen at all. Distinguishes a session that spent
   * nothing from one whose usage the pipeline failed to recognize — the second
   * must not report `$0`.
   */
  sawUsage: boolean
  /** The CLI's own cost figure, summed across the run's turns. */
  costUsdTotal: number
  /** The same spend unsummed, for repricing when the CLI reports no figure. */
  buckets: { input: number; output: number; cacheRead: number; cacheWrite: number }
  /**
   * Every rate-limit line, kept raw so {@link foldRateLimits} decides the
   * standing. Accumulated here rather than in the progress tracker because that
   * channel is a live log and this is a run's final account —
   * `claude-progress.ts` goes on ignoring the line.
   */
  rateLimitLines: ClaudeStreamLine[]
}

/**
 * The models.dev provider this route's runs are resolved under.
 *
 * A constant rather than a knob: the claude route runs the Anthropic CLI, and
 * `LLM_PROVIDER` is the *other* route's catalogue key — the id OpenCode
 * resolves its own model row under, which reaches an Anthropic turn only as a
 * name nothing on it produced. A leftover gateway id there priced a run under a
 * provider its turns never touched, and cost the catalogue rung its primary row.
 */
export const CLAUDE_CATALOGUE_PROVIDER = 'anthropic'

/**
 * The settings the catalogue is asked about for a claude-route run.
 *
 * Both halves of the reference are corrected here, and each fixes its own
 * defect: the provider, so the lookup finds Anthropic's own row instead of a
 * median across every provider publishing a model of that name; and the model
 * id, stripped by the same {@link modelIdForCli} the CLI is invoked through,
 * because a `provider/model` spelling would otherwise compose
 * `<provider>/<provider>/<model>` — which splits at the first slash into an id
 * no catalogue carries, and reports the run unpriced.
 *
 * A derived copy rather than a mutation: the settings object is the run's
 * config, read elsewhere on its own terms. Only the two fields the reference is
 * composed from are replaced, and the placeholder credential it carries stays
 * exactly as contained.
 */
export const claudePricingSettings = (settings: OpenAiSettings): OpenAiSettings => ({
  ...settings,
  provider: CLAUDE_CATALOGUE_PROVIDER,
  model: modelIdForCli(settings.model),
})

export const emptyAccounting = (): ClaudeAccounting => ({
  tokensTotal: 0,
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

  accounting.tokensTotal += line.usage.total
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
