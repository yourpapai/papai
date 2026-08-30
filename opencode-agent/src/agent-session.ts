// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { UsageBuckets } from '../../sdd-runner/src/usage-aggregate.js'
import type { RateLimitStanding } from './rate-limit-windows.js'
import type { CostSource } from './run-spend.js'

/**
 * The seam every model backend implements — a *session* the pipeline holds:
 * an id, a lifetime, a stop, a teardown.
 *
 * Extracted from `opencode-adapter.ts` when the claude backend arrived behind
 * the same interface, so a second adapter could implement the seam without a
 * claude session being typed as an `OpenCodeAgent` — a lie at every new import
 * site. `opencode-adapter.ts` re-exports it as the `OpenCodeAgent` alias, so
 * not one existing import changes; new modules and tests use the neutral name.
 * The arrangement is `phase-names.ts`'s: split from a module, re-exported by
 * it, so callers keep naming one module for the vocabulary.
 */

/**
 * The figure `AGENT_MAX_TOKENS` is enforced on: every token that entered the
 * conversation once.
 *
 * Here rather than in either adapter because both must answer the same
 * question — the seam that declares {@link AgentSession.tokensUsed} is the
 * thing that gets to say what it counts. Written out separately, they didn't:
 * the claude route summed all four buckets while the OpenCode route summed
 * three, so one configured ceiling meant two different budgets and the same
 * issue stopped in wildly different places depending on its backend.
 *
 * **Cache reads are excluded, and that is the whole point.** A cache read is
 * the conversation re-sent to the provider on the next step of a turn, and a
 * provider's `result` line has already summed it across every step. Counting
 * it makes the figure grow as *steps × context* — the same content charged
 * once per assistant step — so a ceiling over it stops a run for thinking hard
 * rather than for spending much. Issue #385 parked at 6,835,879 of 5,000,000
 * having cost $9.23 and used a tenth of a five-hour window. Cache reads stay in
 * the *price*, where their own rate makes them cheap and honest; this is the
 * `sdk-contract.ts` doctrine ("a cache bucket feeds the price instead") carried
 * to both routes at last.
 *
 * **Cache writes are included** because they are content entering the context
 * for the first time — the same thing an uncached `input` token is, billed
 * above the input rate. A cache entry that expires is re-paid, so the count is
 * not perfectly deduplicated; that repeat is bounded by the cache's lifetime
 * rather than by the step count, which is exactly why it does not compound the
 * way a cache read does.
 *
 * An absent optional bucket counts as zero. That is deliberately *not* the
 * answer the price gives the same envelope — `run-spend.ts` refuses to price a
 * bucket the backend never reported — because a ceiling must return a number
 * and a guardrail that could fail to measure is a guardrail that has silently
 * stopped bounding anything.
 */
export const countedTokens = (buckets: UsageBuckets): number =>
  Math.round(buckets.input + buckets.output + (buckets.reasoning ?? 0) + (buckets.cacheWrite ?? 0))

export interface AgentPromptRequest {
  prompt: string
  system?: string
  /** OpenCode agent profile (`build`, `plan`, …). */
  agent?: string
  /** Per-call tool allow/deny overrides passed straight through to the SDK. */
  tools?: Record<string, boolean>
}

export interface AgentPromptResult {
  text: string
  sessionId: string
}

/**
 * What a session spent, and what its provider says about its own limits.
 *
 * Beside `tokensUsed()` rather than replacing it, and that is the whole design
 * of this seam. The ceiling reads tokens because token counts are always right;
 * this reads money and standing, both of which a backend may decline to report.
 * A budget that could fail to price a model is a budget that has quietly stopped
 * bounding it (`types.ts` records the incident), so the guardrail's path stays
 * exactly as it was and everything that can answer "unknown" lives here.
 *
 * One method rather than two because both halves are observed by the same
 * adapter over the same stream and read by the same reporter at the same
 * instant. Two thunks would be two samples of one accumulating state, and two
 * figures that can disagree are worse than one — the reconciliation bug
 * `run-detail.ts` still carries a note about.
 */
export interface RunSpend {
  /**
   * What this session cost in USD, or `null` when nothing could price it.
   *
   * Never `0` for unknown. A `0` that reads as a real figure is the failure this
   * whole surface exists to avoid.
   */
  readonly usd: number | null
  /** Which rung of the cost ladder answered, for the run log. */
  readonly source: CostSource
  /**
   * The provider's rate-limit standing per window, or empty when it reported
   * none — a route that is not a Claude subscription, or a stream that carried
   * no such line. Empty means "nothing to say", never "no limits".
   */
  readonly windows: readonly RateLimitStanding[]
}

/** A live model-backend session bound to one workspace directory. */
export interface AgentSession {
  readonly sessionId: string
  prompt(request: AgentPromptRequest): Promise<AgentPromptResult>
  /**
   * Tokens this session has consumed. Zero when the backend cannot say — a
   * budget is a guardrail on the work, not part of it, so a shape it fails to
   * recognise must not turn every phase into a failure.
   */
  tokensUsed(): Promise<number>
  /**
   * What this session cost and what its provider says about its limits.
   *
   * Reporting, not enforcement: every field may degrade to unknown, and nothing
   * here may fail a phase. See {@link RunSpend}.
   */
  spend(): Promise<RunSpend>
  /**
   * Stops whatever the model is running, and says whether the stop landed.
   *
   * The one boundary in this pipeline that is best-effort **and** reports.
   * Measured against a live backend: an abort kills the running tool child and
   * leaves an `opencode serve` up, while `close()` — a bare SIGTERM to one pid
   * on POSIX — kills the server and leaves the tool child running, reparented
   * to init. So this is the stop and `close()` is the leak, and the two are
   * not each other's fallback. On the claude route the same split holds by
   * construction: `abort()` kills the CLI's whole process group, `close()`
   * terminates anything abandoned and reaps.
   *
   * A refused abort must not become the run's failure — the stop it belongs to is
   * already out of time and cannot afford a second thing to go wrong — but unlike
   * the feedback channels it cannot swallow the answer either: the salvage stages
   * a working tree, and staging one whose writer may still be running is the only
   * thing that path must never do. Hence `boolean` rather than `void`.
   */
  abort(): Promise<boolean>
  close(): Promise<void>
}
