// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { countedTokens } from './agent-session.js'
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
  /**
   * Whether any usage was seen at all — half of the distinction between a
   * session that spent nothing and one whose usage the pipeline failed to
   * recognize. Only the second may report unpriced.
   */
  sawUsage: boolean
  /**
   * How many turns this session was asked to run — the other half, and the one
   * fact here that the stream does not carry.
   *
   * It sits beside the stream facts rather than in the adapter's own state
   * because {@link spendOf} needs both to answer, and both are read at the same
   * instant by the same caller. That is `agent-session.ts`'s argument for
   * `RunSpend` being one method rather than two: figures that can only ever be
   * sampled together should not be sampled apart.
   *
   * Counted before the turn runs, so a turn that died mid-flight still counts.
   * A turn was attempted, so spend may exist and simply be invisible — which is
   * exactly the case that must report unpriced rather than `$0`.
   */
  turnsPrompted: number
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
  sawUsage: false,
  turnsPrompted: 0,
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
 * Three answers, not two. A session that was **never prompted** spent `$0` and
 * says so: nothing was asked of the model, so there is no spend that failed to
 * price. A session that ran a turn and reported usage nobody could read is
 * **unpriced**, which is what the `none` rung has always meant. Conflating them
 * made every over-budget stop — which refuses the phase *before* it prompts —
 * mark the issue's total as a floor, so an issue whose every turn was priced
 * reported "≥ $9.23 (some turns unpriced)".
 *
 * The windows are reported on all three. A run that failed before spending
 * anything may still have been told how much of the week is gone, and that is
 * exactly the run whose maintainer wants to know.
 */
export const spendOf = (accounting: ClaudeAccounting, settings: OpenAiSettings, log: Logger): Promise<RunSpend> => {
  const windows = foldRateLimits(accounting.rateLimitLines)
  if (accounting.turnsPrompted === 0) return Promise.resolve({ usd: 0, source: 'unspent', windows })
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
