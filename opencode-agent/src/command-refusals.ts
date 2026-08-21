// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { renderExhausted, renderReviewsExhausted } from './budget-notices.js'
import { acceptedCommands } from './commands.js'
import { react } from './feedback.js'
import type { PhaseInput } from './phase-context.js'
import { postAndAppend } from './run-post.js'
import { renderRefusedCommand } from './run-report.js'
import { skip } from './trigger-outcome.js'
import type { TriggerOutcome } from './trigger-outcome.js'

/**
 * Answering a command the machine turns down.
 *
 * Split from `triggers.ts` when the `/sync` dispatch pushed that file past
 * `max-lines`, along the seam its own doc comments had already drawn: the
 * three refusals are one family — each posts one comment and skips or fails —
 * and none of them decides anything about *which* command runs, which is the
 * question `triggers.ts` exists to answer.
 */

/**
 * Answers a refused command on the issue, then skips.
 *
 * Only explicit commands come here. A classified plain comment cannot reach it
 * — `applyIntent` runs solely in the waiting phases, both of which accept both
 * of the signals it can produce, and `applyClarifyIntent` produces no signal at
 * all — and the CI paths have their own, deliberately quieter, reporting.
 */
export const refuseCommand = async (input: PhaseInput, command: string, reason: string): Promise<TriggerOutcome> => {
  const { state, thread, deps } = input
  deps.log.warn({ issue: state.issueId, phase: state.phase, command }, 'Refused a slash command')

  // Redundancy rather than the fix, and worth one call for the timing alone:
  // the comment below is the better answer — it names what the phase *does*
  // accept, from the transition table — but it arrives after `postAndAppend`,
  // while the reaction lands before the run has done anything at all.
  await react(deps, input.trigger, 'confused')
  await postAndAppend(thread, input, renderRefusedCommand(command, state.phase, acceptedCommands(state)), state)

  return { state, halt: skip(state, reason, true), answer: false }
}

/**
 * Turns down a `/retry` the retry budget can no longer pay for, before the
 * signal is applied.
 *
 * Before, because this is the last moment the state is still the one the
 * maintainer is looking at. The ceiling used to be checked in `driveMachine`,
 * one step too late: `applyTrigger` had already applied `RETRY`, which clears
 * `resumeFrom` while carrying `attempts` across, so the give-up notice posted a
 * state that had left `FAILED` for the handler phase it was resuming into.
 * Nothing could re-enter that phase — `/retry` needs `FAILED` and a plain
 * comment needs a waiting phase — so spending the budget parked the issue
 * somewhere only `/cancel` reached, and the notice's own advice was guaranteed
 * to be refused. Refusing here leaves `FAILED` and its `resumeFrom` untouched,
 * which is what makes raising `AGENT_MAX_ATTEMPTS` and retrying a real remedy
 * rather than a suggestion.
 *
 * Beside {@link refuseCommand} rather than inside it because the two say
 * different things. That one lists the commands the phase does accept, which
 * here would name `/retry` itself — the command being refused — and its "does
 * not apply right now" is wrong twice over: the command applies perfectly, a
 * bound was reached. So this one carries the give-up wording, logs a spent
 * budget, and reports a `failed` run rather than a skipped one, exactly as the
 * check it replaces did.
 */
export const refuseExhausted = async (input: PhaseInput): Promise<TriggerOutcome> => {
  const { state, thread, deps } = input
  const reason = `Retry budget exhausted (${state.attempts} of ${deps.config.maxAttempts} attempts)`
  deps.log.warn({ issue: state.issueId, attempts: state.attempts, resumeFrom: state.resumeFrom }, 'Retry budget spent')

  await postAndAppend(thread, input, renderExhausted(reason), state)

  return { state, halt: { status: 'failed', reason, state, reported: true }, answer: false }
}

/**
 * The same refusal against the review budget, and the same "before the move"
 * reason: a `/review` applied and then regretted would park the issue in
 * `CODE_REVIEW`, a handler phase no trigger re-enters, under a notice inviting
 * the very command that had just become impossible. That is the exact shape of
 * the bug {@link refuseExhausted} was written to close, on the other ceiling.
 *
 * Beside it rather than inside it because the remedy differs: nothing is parked
 * here, so `/retry` cannot help, and `renderReviewsExhausted` names
 * `AGENT_MAX_REVIEW_ATTEMPTS` instead. `failed` rather than a skip, matching
 * both the retry notice and the CI one — a bound was reached and the run has
 * said so on the issue.
 */
export const refuseReviews = async (input: PhaseInput): Promise<TriggerOutcome> => {
  const { state, thread, deps } = input
  const reason = `Review budget exhausted (${state.reviewAttempts} of ${deps.config.maxReviewAttempts} reviews)`
  deps.log.warn({ issue: state.issueId, reviewAttempts: state.reviewAttempts, pr: state.prNumber }, 'Reviews spent')

  await postAndAppend(thread, input, renderReviewsExhausted(reason, state.prUrl), state)

  return { state, halt: { status: 'failed', reason, state, reported: true }, answer: false }
}
