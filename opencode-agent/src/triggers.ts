// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { renderExhausted, renderReviewsExhausted } from './budget-notices.js'
import { applyCiTrigger } from './ci-trigger.js'
import { acceptedCommands, commandApplies, COMMAND_SIGNALS } from './commands.js'
import type { ParsedCommand } from './commands.js'
import { applyClarifyIntent, applyIntent, applySteeringIntent, readAndSkip } from './comment-intent.js'
import { commandSurface } from './feedback-target.js'
import { react } from './feedback.js'
import { branchNameFor } from './git.js'
import type { PhaseInput } from './phase-context.js'
import { postAndAppend, renderCommandElsewhere, renderRefusedCommand } from './run-report.js'
import { canTransition } from './transitions.js'
import { moveOrSkip, skip } from './trigger-outcome.js'
import type { TriggerOutcome } from './trigger-outcome.js'
import { errorMessage, WAITING_PHASES } from './types.js'

/**
 * Turning a trigger — a slash command, a plain comment, a red CI run — into the
 * state move the machine should make, before any phase handler runs.
 *
 * Split out of `orchestrator.ts`, which now owns only the phase cascade. The two
 * answer different questions: this one decides *whether and where* to go, that
 * one drives the handlers once the decision is made. Two halves have since gone
 * the same way, each time this file reached the length limit and each time along
 * a seam that was already there: the red-CI path into `ci-trigger.ts`, and
 * reading plain prose into `comment-intent.ts`. What is left here is applying a
 * command and the dispatch that picks between the three — the command *table*
 * moved to `commands.ts` once the waiting comment needed to read it too, since
 * this file imports `run-report.ts` and a shared derivation in either of them is
 * a cycle.
 */

/**
 * Turns the trigger into a state move.
 *
 * A red CI run enters `CI_FIX`. A comment typed on the **pull request** is the
 * one-command door — {@link applyPullRequestCommand} — and is decided before the
 * general command branch rather than inside it, because the two differ in what
 * they accept and not in what they do with it. An explicit slash command on the
 * issue wins outright. A plain maintainer comment is classified, because "review
 * and refine" is a conversation, not a command language — but the two phases
 * that classify want opposite defaults, so they read the same verdict through
 * different branches.
 * On a waiting phase, {@link applyIntent} defaults to *question*, the only
 * reading that cannot destroy approved work. In `INIT_OR_CLARIFY` there is no
 * approved work yet and the comment is probably an answer the agent asked for,
 * so {@link applyClarifyIntent} defaults the other way — see there.
 */
export const applyTrigger = (input: PhaseInput): Promise<TriggerOutcome> => {
  const { state, trigger, command } = input

  if (trigger.kind === 'ci') return applyCiTrigger(input)
  // Design D7 — the archive door: a merged PR on `agent/issue-<n>` moves
  // COMPLETE → ARCHIVE. Routed before the issue-conversation branches because
  // it is a fourth event kind, not a command — `moveOrSkip` turns the refusal
  // (anything other than COMPLETE) into the same quiet skip the CI path uses for
  // a red run that arrives in a phase with no branch to fix.
  if (trigger.kind === 'pr-merged') return Promise.resolve(applyArchiveTrigger(input))
  // Before the command branch below, not folded into it: a pull request is a
  // narrower door onto the same commands, and the narrowing is what §6.2 of the
  // plan settles. Everything after this line is the issue conversation.
  if (trigger.kind === 'pull-request') return applyPullRequestCommand(input, command)
  // Everything below here is the issue conversation, and once a pull request
  // exists the issue is no longer where this run is driven from — see
  // `feedback-target.ts`. The refusal is about the *surface*, not the command:
  // it names the pull request and posts nothing else.
  if (command !== null && commandSurface(state, 'issue') === 'elsewhere') return commandBelongsOnPr(input, command)
  if (command !== null) return applyCommand(input, command)
  if (state.phase === 'INIT_OR_CLARIFY') return applyClarifyIntent(input)
  // Design D6 — a plain comment mid-implementation is read as steering: a
  // scope-affecting change routes back to PLANNING for an artifact-update turn
  // before implementation continues. Before the generic skip below, not folded
  // into it, because implementation is the one phase where prose can change
  // scope — everywhere else a non-waiting, non-clarify phase has nothing for a
  // plain comment to act on.
  if (state.phase === 'REVIEW_AND_MUTATE') return applySteeringIntent(input)
  if (!WAITING_PHASES.has(state.phase)) return readAndSkip(input, `No actionable command while in ${state.phase}`)

  return applyIntent(input)
}

/**
 * The archive door (D7): a merged PR moves `COMPLETE` → `ARCHIVE`.
 *
 * `moveOrSkip` turns anything other than COMPLETE into a quiet skip with a
 * reason: a merged-PR event that arrives mid-pipeline, before delivery, has no
 * archive to run (the folder is still being drafted against), and a second
 * merge on an already-archived issue finds no `ARCHIVE` row from `COMPLETE` and
 * is skipped the same way. No comment is posted on a skip, mirroring the CI
 * path: the event is machine noise the issue does not need to hear about.
 */
export const applyArchiveTrigger = (input: PhaseInput): TriggerOutcome => {
  const { state, deps } = input
  return moveOrSkip(state, 'PR_MERGED', deps, 'a merged pull request')
}

/**
 * The pull-request door, which takes the same commands the issue does.
 *
 * It used to take `/review` and nothing else. That narrowing was right while the
 * issue was still the surface a maintainer drove the agent from; it is wrong now
 * that a delivered issue refuses commands and points here, because the two rules
 * together would leave `/retry`, `/cancel` and `/ask` with nowhere to be typed.
 *
 * Everything goes through {@link applyCommand}, deliberately: the `prNumber`
 * predicate, both budgets and the list a refusal offers are one seam in
 * `commands.ts` with two readers, and a pull-request door that restated any of
 * them would be a second spelling free to disagree.
 *
 * The `null` branch is unreachable by construction — `resolvePullRequestTrigger`
 * produces this kind only for a body `parseSlashCommand` read as a command — and
 * stays because a decision enforced only by whichever layer filters first is one
 * a second door quietly repeals.
 */
const applyPullRequestCommand = (input: PhaseInput, command: ParsedCommand | null): Promise<TriggerOutcome> => {
  const { state, deps } = input

  if (command === null) {
    deps.log.warn({ issue: state.issueId, pr: state.prNumber }, 'A pull-request comment carried no command')
    return Promise.resolve({ state, halt: skip(state, 'A pull-request comment carrying no command'), answer: false })
  }

  return applyCommand(input, command)
}

/**
 * The reply to a command typed on the issue after the pull request took over.
 *
 * Its own function rather than a branch of {@link refuseCommand}, for the reason
 * `refuseExhausted` is its own: the sentence is different in kind. That one says
 * "this phase does not accept that", which here would be a lie — the command is
 * perfectly good and would have worked one page over. This one says where, and
 * says nothing about the state, which has not moved.
 *
 * A `skipped` run, not a failure: nothing broke and nothing was spent. `reported`
 * is true, because the issue does carry this run's account of what it did — it
 * declined to act, and said so.
 */
const commandBelongsOnPr = async (input: PhaseInput, command: ParsedCommand): Promise<TriggerOutcome> => {
  const { state, thread, deps } = input
  deps.log.warn(
    { issue: state.issueId, pr: state.prNumber, command: command.command },
    'Refused a command typed on the issue: the pull request is where this issue is driven now',
  )

  await react(deps, input.trigger, 'confused')
  await postAndAppend(thread, input, renderCommandElsewhere(command.command, state.prUrl), state)

  return { state, halt: skip(state, `${command.command} belongs on the pull request`, true), answer: false }
}

const applyCommand = async (input: PhaseInput, command: ParsedCommand): Promise<TriggerOutcome> => {
  const { state, deps } = input
  // Always available: answering asks nothing of the state machine, so there is
  // no phase in which it can be the wrong thing to do. The machine now agrees —
  // `ANSWERED` is a non-moving signal accepted in every phase. It did not use
  // to: it lived in three rows of the transition table while this line let
  // `/ask` through everywhere, so a question in COMPLETE, FAILED or any
  // mid-pipeline phase paid for the model turn and then crashed the runner on
  // an `InvalidTransitionError` nobody on the issue ever saw.
  if (command.command === '/ask') return Promise.resolve({ state, halt: null, answer: true })

  const signal = COMMAND_SIGNALS[command.command]
  if (signal === undefined) return refuseCommand(input, command.command, `Unknown command ${command.command}`)

  // The half of "does this command apply here" the transition table cannot
  // answer, asked before either budget: `/review` on a *cancelled* issue is a
  // wrong-command refusal, not a spent one, and `COMPLETE` is the one phase
  // where the two are indistinguishable from the phase alone. Refused through
  // the same door as a wrong phase, so the comment lists what does work — and
  // `acceptedCommands` consults this very predicate to build that list.
  if (!commandApplies(command.command, state)) {
    return refuseCommand(input, command.command, `${command.command} does not apply to this issue`)
  }

  // Before the move, not after it — see `refuseExhausted` below. Asked of the
  // transition table rather than of `state.phase` directly, so this cannot start
  // answering for a `/retry` the phase was going to turn down anyway: a retry
  // that does not apply here is a wrong-command refusal, not a spent budget.
  if (signal === 'RETRY' && canTransition(state.phase, signal) && state.attempts >= deps.config.maxAttempts) {
    return refuseExhausted(input)
  }

  // The same shape against the other command with a budget, and gated on the
  // table for the same reason.
  if (
    signal === 'REVIEW_REQUESTED' &&
    canTransition(state.phase, signal) &&
    state.reviewAttempts >= deps.config.maxReviewAttempts
  ) {
    return refuseReviews(input)
  }

  const outcome = moveOrSkip(state, signal, deps, command.command)
  if (outcome.halt !== null) return refuseCommand(input, command.command, outcome.halt.reason)
  // D9 — `/cancel` gains branch + change-folder cleanup (the mis-capture's work).
  await afterCommandCleanup(input, command)
  return outcome
}

/**
 * Side effects a successful command carries beyond the state move. Today only
 * `/cancel` (D9): delete the `agent/issue-<n>` branch a mis-capture pushed, so
 * the work is gone rather than orphaned. Only when capture happened.
 */
const afterCommandCleanup = async (input: PhaseInput, command: ParsedCommand): Promise<void> => {
  if (command.command !== '/cancel' || input.state.changeName === null) return
  const { deps, state } = input
  try {
    await deps.git.deleteRemoteBranch(branchNameFor(state.issueId))
    deps.log.info({ issue: state.issueId }, 'Deleted the agent branch for /cancel')
  } catch (error) {
    deps.log.warn({ issue: state.issueId, error: errorMessage(error) }, 'Could not delete the agent branch for /cancel')
  }
}

/**
 * Answers a refused command on the issue, then skips.
 *
 * Only explicit commands come here. A classified plain comment cannot reach it
 * — `applyIntent` runs solely in the waiting phases, both of which accept both
 * of the signals it can produce, and `applyClarifyIntent` produces no signal at
 * all — and the CI paths above have their own, deliberately quieter, reporting.
 */
const refuseCommand = async (input: PhaseInput, command: string, reason: string): Promise<TriggerOutcome> => {
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
const refuseExhausted = async (input: PhaseInput): Promise<TriggerOutcome> => {
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
const refuseReviews = async (input: PhaseInput): Promise<TriggerOutcome> => {
  const { state, thread, deps } = input
  const reason = `Review budget exhausted (${state.reviewAttempts} of ${deps.config.maxReviewAttempts} reviews)`
  deps.log.warn({ issue: state.issueId, reviewAttempts: state.reviewAttempts, pr: state.prNumber }, 'Reviews spent')

  await postAndAppend(thread, input, renderReviewsExhausted(reason, state.prUrl), state)

  return { state, halt: { status: 'failed', reason, state, reported: true }, answer: false }
}
