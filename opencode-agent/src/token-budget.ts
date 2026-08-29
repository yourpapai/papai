// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { RunSpend } from './agent-session.js'
import { renderAnswerOverBudget, renderOverBudget } from './budget-notices.js'
import type { PipelineConfig } from './config.js'
import type { MachineInput, PhaseDeps } from './phase-context.js'
import { postAndAppend, postAnswer } from './run-post.js'
import type { RunResult } from './run-result.js'
import { transition } from './transitions.js'
import type { AgentState } from './types.js'

/**
 * The per-issue token ceiling: what an issue has spent, and how a run stops
 * when it cannot afford the phase in front of it.
 *
 * Split out of `orchestrator.ts` the way `run-report.ts` and `triggers.ts` were,
 * and for the same reason: that file drives the phase cascade, this one decides
 * whether the cascade may take another step, and the two change for different
 * reasons. It is also the only bound that spans jobs, so it is the only one that
 * has to reason about a figure the running job did not produce.
 */

/**
 * Everything this issue has spent, prior jobs included.
 *
 * Takes the carried figure rather than reading it off the state, because the
 * state moves under the run: `carriedTokens` is captured once from the *restored*
 * block, since a job's session total is already cumulative across the phases it
 * cascades through and adding it to each phase's own figure would count the
 * earlier phases again. The trigger layer, which has no `MachineInput` and has
 * opened no session yet, passes the restored figure directly.
 */
export const totalTokens = async (deps: PhaseDeps, carried: number): Promise<number> =>
  carried + (await deps.tokensUsed())

/**
 * Whether an issue that has spent `spent` may still pay for a model turn.
 *
 * One comparison, in one place, because the boundary is exact: "spent 5,000,000
 * of 5,000,000" is spent, and a `>` here would let every ceiling buy one more
 * phase. Also asked from `triggers.ts`, which declines to pay for classifying a
 * comment it could not afford to act on.
 */
export const withinBudget = (spent: number, config: PipelineConfig): boolean => spent < config.maxTokens

/**
 * Everything a state block records spend in, however the run ended.
 *
 * All three fields together, in one place, for the reason {@link recordSpend}
 * gives below: written separately they silently disagreed, and the ceiling went
 * blind exactly where it was built to bite. The money half joins them rather
 * than getting a patch of its own so the same fix covers it by construction.
 *
 * The cost accumulates the way the tokens do — carried plus this job's — and an
 * **unpriced** job adds nothing while flipping the flag. That makes the total a
 * floor rather than a wrong number: `$12.40` with the flag set means "at least
 * $12.40", and without it means "$12.40". The flag is sticky because an unpriced
 * turn cannot be un-spent by a later priced one.
 */
const spendPatch = (
  spent: number,
  cost: RunSpend,
  carried: { usd: number; unpriced: boolean },
  patch: Partial<AgentState>,
): Partial<AgentState> => ({
  ...patch,
  tokensSpent: spent,
  usdSpent: carried.usd + (cost.usd ?? 0),
  usdUnpriced: carried.unpriced || cost.usd === null,
})

/** The carried money half of a `MachineInput`, in the shape {@link spendPatch} takes. */
const carriedCost = (input: MachineInput): { usd: number; unpriced: boolean } => ({
  usd: input.carriedUsd,
  unpriced: input.carriedUnpriced,
})

/**
 * That same patch for a caller that has not already measured — the three places
 * `orchestrator.ts` writes a state block after a job has prompted the model.
 *
 * Shared because the paths silently disagreed for as long as they were written
 * out separately: the success path patched `tokensSpent`, `failRun` transitioned
 * to `FAILED` with only `lastError`, and `failAnswer` posted the restored state
 * untouched. So a job whose session reported 250,000 tokens and whose handler
 * then threw persisted `0`, and the ceiling was blind precisely where it was
 * built to bite — the runaway it bounds is an issue bouncing through retries and
 * CI-fix rounds, and retries *are* the failure path. An issue could spend the
 * whole budget, fail, and hand the next runner a clean slate, round after round.
 * The over-budget stops below never had the bug, having been written after it;
 * they take the figure the check has already measured, so the notice and the
 * block beside it cannot quote different totals.
 */
export const recordSpend = async (input: MachineInput, patch: Partial<AgentState> = {}): Promise<Partial<AgentState>> =>
  spendPatch(await totalTokens(input.deps, input.carriedTokens), await input.deps.spend(), carriedCost(input), patch)

/**
 * Stops a run that has spent its token budget, or `null` when it may carry on.
 *
 * Called before the handler, not after: the point of a ceiling is to stop the
 * next expensive thing, and checking afterwards would let every phase overspend
 * once. Checked per phase rather than per prompt because a phase is the
 * granularity at which spend is knowable — the review loop's subprocesses run in
 * their own sessions, which this total cannot see.
 *
 * Both stops below post on the issue, because a guardrail that stops in silence
 * reads as an agent that lost interest — which is also why both report
 * `reported: true`. They are `failed` runs, so the job goes red and the
 * workflow's fallback step is in scope; without the marker it appended "The
 * issue state is unchanged; reply `/retry` once the cause is addressed" under a
 * notice that had just parked the issue in `FAILED` and asked for
 * `AGENT_MAX_TOKENS` to be raised **first**.
 */
export const stopIfOverBudget = async (input: MachineInput): Promise<RunResult | null> => {
  const { state, deps } = input

  const spent = await totalTokens(deps, input.carriedTokens)
  if (withinBudget(spent, deps.config)) return null

  const reason = `Token budget spent (${spent} of ${deps.config.maxTokens} tokens for this issue)`
  deps.log.warn(
    { issue: state.issueId, phase: state.phase, spent, limit: deps.config.maxTokens },
    'Stopping: token budget spent',
  )

  return input.answer ? answerOverBudget(input, spent, reason) : parkOverBudget(input, spent, reason)
}

/**
 * Parks the issue in `FAILED`, with the phase it refused to start as
 * `resumeFrom`.
 *
 * It used to leave the phase alone, which is the shape `refuseExhausted` in
 * `triggers.ts` takes for the retry budget — and here that shape strands the
 * issue, because unlike a `/retry` this check is not standing in front of a
 * trigger. Leaving the phase alone left it *in a handler phase*: `/approve`
 * from `DESIGN_SPEC` had already moved the state to `PLANNING` by the time
 * this stopped the run, and nothing can re-enter `PLANNING` — `/retry`
 * needs `FAILED`, a plain comment needs a waiting phase — so `/cancel` was the
 * only event left, under a notice pointing at `AGENT_MAX_TOKENS` as though
 * raising it would help. It never could: no event re-enters that phase at any
 * ceiling. Reachable on a first approval, with no failure anywhere in the story.
 *
 * A trigger-layer refusal, the answer the retry budget took, only covers half of
 * it. This check has a second firing point with no trigger involved at all:
 * mid-cascade, `REVIEW_AND_MUTATE` → `PR_DELIVERY` → `COMPLETE` inside one job,
 * where the earlier phase rightly did its work and posted and the cascade stops
 * before the next. The phase has legitimately advanced and there is no signal to
 * turn down; only parking reaches that case. So the check stays where it is, and
 * the *stop* is what carries the invariant.
 *
 * `FAILED` with a `resumeFrom` is not a new mechanism — it is exactly the one
 * `failRun` already writes and `/retry` already resumes, which is what turns the
 * notice's advice into something that works: raise `AGENT_MAX_TOKENS`, reply
 * `/retry`, and the parked phase runs. `attempts` is carried over rather than
 * incremented because running out of tokens is not a failed attempt at
 * anything; letting it spend one would collide the two budgets, since the very
 * `/retry` this notice asks for would then be turned down by the retry gate in
 * `triggers.ts`, citing a ceiling the notice never mentioned.
 */
const parkOverBudget = async (input: MachineInput, spent: number, reason: string): Promise<RunResult> => {
  const { state, deps, thread } = input

  const parked = transition(
    state,
    'FAILED',
    spendPatch(spent, await deps.spend(), carriedCost(input), { attempts: state.attempts, lastError: reason }),
  )
  await postAndAppend(thread, input, renderOverBudget(spent, deps.config.maxTokens, state.phase), parked)

  return { status: 'failed', reason, state: parked, reported: true }
}

/**
 * The same stop for a question, which parks nothing.
 *
 * Separate for the reasons `failAnswer` is separate, and one more. A question is
 * a side conversation about work that lives elsewhere: the phase records where
 * the *work* is, so `FAILED` would be a lie about a delivered pull request whose
 * maintainer only asked what changed. Worse, `resumeFrom` would then name the
 * phase the question was asked in, and those are the waiting phases — a `/retry`
 * into `DESIGN_SPEC` finds no handler and re-parks with "Parked in
 * `DESIGN_SPEC`", the exact round trip that rule exists to prevent. In
 * `COMPLETE` it would not even be reachable: that phase accepts no `FAILED`, so
 * `transition` would throw out of the pipeline and take the runner with it,
 * posting nothing at all.
 *
 * Nothing is stranded by leaving the phase alone here either, which is what lets
 * the two paths differ: `/ask` moves no state, so the phase is still the one the
 * trigger layer just accepted an event in.
 */
const answerOverBudget = async (input: MachineInput, spent: number, reason: string): Promise<RunResult> => {
  const { state, deps, thread } = input
  const carried = { ...state, ...spendPatch(spent, await deps.spend(), carriedCost(input), {}) }

  await postAnswer(thread, input, renderAnswerOverBudget(spent, deps.config.maxTokens, state.phase), carried)

  return { status: 'failed', reason, state: carried, reported: true }
}
