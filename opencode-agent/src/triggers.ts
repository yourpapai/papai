// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { applyCiTrigger } from './ci-trigger.js'
import { refuseCommand, refuseExhausted, refuseFix, refuseReviews } from './command-refusals.js'
import { commandApplies, COMMAND_SIGNALS } from './commands.js'
import type { ParsedCommand } from './commands.js'
import { applyClarifyIntent, applyIntent, applySteeringIntent, readAndSkip } from './comment-intent.js'
import { commandSurface } from './feedback-target.js'
import { react } from './feedback.js'
import { branchNameFor } from './git.js'
import type { PhaseInput } from './phase-context.js'
import { postAndAppend } from './run-post.js'
import { renderCommandElsewhere } from './run-report.js'
import { refuseIfUsageMissing, sideOperation } from './side-operations.js'
import { canTransition } from './transitions.js'
import { moveOrSkip, skip } from './trigger-outcome.js'
import type { TriggerOutcome } from './trigger-outcome.js'
import { errorMessage, WAITING_PHASES } from './types.js'
import type { TransitionSignal } from './types.js'

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
  // it names the pull request and posts nothing else. The surface rule is one
  // function with one answer, and it holds the one exception (`/follow-up`,
  // issue #441) inside itself — the routing here is unchanged by it.
  if (command !== null && commandSurface(state, 'issue', command.command) === 'elsewhere') {
    return commandBelongsOnPr(input, command)
  }
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
 * `moveOrSkip` turns anything other than COMPLETE into a quiet skip: a
 * merged-PR event mid-pipeline has no archive to run, and a second merge on
 * an already-archived issue finds no `ARCHIVE` row from `COMPLETE`. No
 * comment on a skip, mirroring the CI path — machine noise.
 */
export const applyArchiveTrigger = (input: PhaseInput): TriggerOutcome => {
  const { state, deps } = input
  return moveOrSkip(state, 'PR_MERGED', deps, 'a merged pull request')
}

/**
 * The pull-request door, which takes the same commands the issue does.
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
 * Its own function rather than a branch of {@link refuseCommand}: the sentence
 * is different in kind. That one says "this phase does not accept that", which
 * here would be a lie — the command is perfectly good and would have worked
 * one page over. This one says where, and says nothing about the state. A
 * `skipped` run with `reported: true`: the issue carries this run's account —
 * it declined to act, and said so.
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

/**
 * A command with no signal that reached the signal lookup — an unknown spell,
 * or one of the signal-less commands outside its predicate: `/sync` before
 * capture, `/follow-up` before delivery. Both go through the wrong-command
 * door, which lists what does apply here — and the two known ones earn a
 * reason that says what they need rather than calling them unknown.
 */
const refuseUnknown = (input: PhaseInput, command: ParsedCommand): Promise<TriggerOutcome> => {
  const reason =
    command.command === '/sync'
      ? `${command.command} does not apply to this issue`
      : command.command === '/follow-up'
        ? `${command.command} applies to a delivered pull request`
        : `Unknown command ${command.command}`
  return refuseCommand(input, command.command, reason)
}

/**
 * The per-command ceilings, each refused before the signal is applied —
 * applied-and-regretted would park the issue in a handler phase no trigger
 * re-enters, under a notice inviting the very command that just became
 * impossible. Each is asked of the transition table first, so a command the
 * phase would refuse anyway is answered with what does apply, never with a
 * budget it never reached. `null` is "no ceiling applies; apply the signal".
 */
const refuseSpentBudget = (input: PhaseInput, signal: TransitionSignal): Promise<TriggerOutcome> | null => {
  const { state, deps } = input
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

  // And against the CI-fix ceiling a typed /fix draws on — the budget both
  // doors share, refused before the move for the reason the other two are.
  // Does not consult `ciBudgetReported`: that silence belongs to the automatic
  // door, and this answers a command somebody typed.
  if (signal === 'CI_FAILED' && canTransition(state.phase, signal) && state.ciAttempts >= deps.config.maxCiAttempts) {
    return refuseFix(input)
  }

  return null
}

const applyCommand = async (input: PhaseInput, command: ParsedCommand): Promise<TriggerOutcome> => {
  const { state, deps } = input
  // The `/follow-up` usage gate is asked before the dispatch: an empty
  // argument is nothing to assess, so the usage note is the whole answer —
  // no turn, no git. `side-operations.ts` owns both the gate and the note.
  const usage = await refuseIfUsageMissing(input, command)
  if (usage !== null) return usage

  const side = sideOperation(input, command)
  if (side !== null) return side

  const signal = COMMAND_SIGNALS[command.command]
  if (signal === undefined) return refuseUnknown(input, command)

  // The half of "does this command apply here" the transition table cannot
  // answer, asked before either budget: `/review` on a *cancelled* issue is a
  // wrong-command refusal, not a spent one, and `COMPLETE` is the one phase
  // where the two are indistinguishable from the phase alone. Refused through
  // the same door as a wrong phase, so the comment lists what does work — and
  // `acceptedCommands` consults this very predicate to build that list.
  if (!commandApplies(command.command, state)) {
    return refuseCommand(input, command.command, `${command.command} does not apply to this issue`)
  }

  const spent = await refuseSpentBudget(input, signal)
  if (spent !== null) return spent

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
