// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { renderCiExhausted } from './budget-notices.js'
import { branchNameFor } from './git.js'
import type { PhaseInput } from './phase-context.js'
import { postAndAppend } from './run-post.js'
import { canTransition, markCiBudgetReported, transition } from './transitions.js'
import { skip } from './trigger-outcome.js'
import type { TriggerOutcome } from './trigger-outcome.js'

/**
 * What a red check run buys, before any phase handler runs.
 *
 * Split out of `triggers.ts` — which was at the file-length limit — rather than
 * compressed into it, because this half answers a different question from the
 * commands and comments next door. Those ask what a human meant; this one asks
 * whether there is a live, pushed branch worth spending a repair round on, and
 * every one of its exits is deliberately quiet.
 */

/**
 * A red CI run either buys a fix attempt or, once the budget is spent, buys the
 * maintainer a notice — exactly once. Neither, if the phase has no pushed branch
 * to repair, or if the pull request it would be fixing is no longer live.
 *
 * Silence on a spent budget is the failure mode: CI events arrive on their own
 * schedule with nobody reading the Actions log, so an agent that quietly stops
 * fixing looks identical to one still working. Repeating the notice on every
 * later red run would be the opposite mistake, which is what `ciBudgetReported`
 * prevents — and `handleDeliver` clears that flag when it opens a *new* pull
 * request, so "exactly once" is once per pull request rather than once per issue.
 */
export const applyCiTrigger = async (input: PhaseInput): Promise<TriggerOutcome> => {
  const { state, deps, thread } = input

  const refused = refuseUnfixablePhase(input)
  if (refused !== null) return refused

  const spent = state.ciAttempts >= deps.config.maxCiAttempts
  const reason = `Spent the CI-fix budget (${state.ciAttempts} of ${deps.config.maxCiAttempts} attempts).`

  // Decided already, so do not pay for a pull-request lookup to re-decide it.
  // Safe to short-circuit on because the flag is per pull request: a delivery
  // that opens a fresh one hands the budget back, so this cannot outlive the
  // checks that spent it the way it used to.
  if (spent && state.ciBudgetReported) {
    return { state, halt: skip(state, `${reason} Already reported.`), answer: false }
  }

  const settled = await settledPullRequest(input)
  if (settled !== null) return settled

  if (!spent) return enterCiFix(input)

  const marked = markCiBudgetReported(state)
  deps.log.warn({ issue: state.issueId, ciAttempts: state.ciAttempts }, 'CI-fix budget spent')
  await postAndAppend(thread, input, renderCiExhausted(reason, state.prUrl), marked)

  // `reported: true` is about this run's comment, not about `ciBudgetReported`
  // — the two happen to coincide here, and stay separate everywhere else.
  return { state: marked, halt: { status: 'failed', reason, state: marked, reported: true }, answer: false }
}

/**
 * Drops a red run in a phase the transition table does not admit `CI_FAILED`
 * from — before the pull-request lookup, because no answer it could give would
 * change this.
 *
 * Asked of `canTransition` rather than of a second list of phases here, so the
 * set cannot drift from the table that enforces it; the table itself carries the
 * reasoning for which phases are in and which are out.
 *
 * Logged at `warn`, matching `refuseCommand` and `refuseExhausted` next door,
 * because this used to be the quietest path in the pipeline: the refusal fell
 * out of `moveOrSkip` as an ordinary skip whose only trace was a `reason` string
 * nobody reads, so a red run in `PR_DELIVERY` or `FAILED` left no record
 * anywhere at all. It stays a `log` and not a comment for the reason
 * {@link settledPullRequest} sets out at length — CI fires on every push and
 * re-run, and a comment per red run is spam — and here that argument is
 * stronger, not weaker: the phases that refuse are the ones where either
 * nothing is pushed yet or the issue is already parked under a failure comment
 * telling the maintainer what to do.
 */
const refuseUnfixablePhase = (input: PhaseInput): TriggerOutcome | null => {
  const { state, deps } = input
  if (canTransition(state.phase, 'CI_FAILED')) return null

  deps.log.warn({ issue: state.issueId, phase: state.phase }, 'Refused a red CI run')

  return { state, halt: skip(state, `A red CI run is not actionable in ${state.phase}`), answer: false }
}

/**
 * Applies the move the phase gate has already proved legal.
 *
 * No `try`/`catch` around the `transition`, unlike `moveOrSkip` in
 * `triggers.ts`: {@link refuseUnfixablePhase} asked the same table this call
 * consults, so a throw here would mean the two disagree, and swallowing that
 * into a silent skip is what hid the missing `PR_DELIVERY` row in the first
 * place.
 */
const enterCiFix = (input: PhaseInput): TriggerOutcome => {
  const { state, deps } = input
  const next = transition(state, 'CI_FAILED')
  deps.log.info({ source: 'a red CI run', from: state.phase, to: next.phase }, 'Applied trigger')

  return { state: next, halt: null, answer: false }
}

/**
 * Drops a red run whose pull request is no longer live.
 *
 * A merged branch's checks keep firing — a later push, a re-run, a flake — and
 * a fix round buys nothing: its commits land on a branch nobody will merge
 * again. A closed-unmerged one is the same with a maintainer's decision on top,
 * and no pull request at all leaves a fix with nowhere to go. None of the three
 * should spend a CI-fix attempt, and the delivery phase already refuses to open
 * a replacement for any of them.
 *
 * Deliberately silent, unlike the spent-budget notice above. That one breaks
 * silence because a maintainer is waiting on work that has stopped; here the
 * work has landed or been rejected, the issue is already `COMPLETE`, and CI
 * fires on every push — so a comment per red run would be pure spam.
 */
const settledPullRequest = async (input: PhaseInput): Promise<TriggerOutcome | null> => {
  const { state, deps } = input

  const pr = await deps.github.findPullRequest(branchNameFor(state.issueId))
  if (pr !== null && pr.state === 'open') return null

  const reason =
    pr === null
      ? 'The branch has no pull request, so a CI fix has nowhere to go'
      : `Pull request #${pr.number} is ${pr.state}, so there is nothing left to fix`
  deps.log.info({ issue: state.issueId, pr: pr?.number, prState: pr?.state }, 'Red run on a settled pull request')

  return { state, halt: skip(state, reason), answer: false }
}
