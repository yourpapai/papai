// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { MachineInput } from './phase-context.js'
import { postAndAppend, renderAnswerOverBudget, renderOverBudget } from './run-report.js'
import { transition } from './state-manager.js'
import type { RunResult } from './types.js'

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

/** Everything this issue has spent, prior jobs included. */
export const totalTokens = async (input: MachineInput): Promise<number> =>
  input.carriedTokens + (await input.deps.tokensUsed())

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
 * reads as an agent that lost interest.
 */
export const stopIfOverBudget = async (input: MachineInput): Promise<RunResult | null> => {
  const { state, deps } = input

  const spent = await totalTokens(input)
  if (spent < deps.config.maxTokens) return null

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
 * from `DESIGN_SPEC` had already moved the state to `EXECUTION_PLAN` by the time
 * this stopped the run, and nothing can re-enter `EXECUTION_PLAN` — `/retry`
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

  const parked = transition(state, 'FAILED', { attempts: state.attempts, tokensSpent: spent, lastError: reason })
  await postAndAppend(thread, input, renderOverBudget(spent, deps.config.maxTokens, state.phase), parked)

  return { status: 'failed', reason, state: parked }
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
  const carried = { ...state, tokensSpent: spent }

  await postAndAppend(thread, input, renderAnswerOverBudget(spent, deps.config.maxTokens, state.phase), carried)

  return { status: 'failed', reason, state: carried }
}
