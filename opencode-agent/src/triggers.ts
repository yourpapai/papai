// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { applyCiTrigger } from './ci-trigger.js'
import { acceptedCommands, COMMAND_SIGNALS } from './commands.js'
import type { ParsedCommand } from './commands.js'
import { applyClarifyIntent, applyIntent, readAndSkip } from './comment-intent.js'
import { react } from './feedback.js'
import type { PhaseInput } from './phase-context.js'
import { postAndAppend, renderExhausted, renderRefusedCommand } from './run-report.js'
import { canTransition } from './state-manager.js'
import { moveOrSkip, skip } from './trigger-outcome.js'
import type { TriggerOutcome } from './trigger-outcome.js'
import { WAITING_PHASES } from './types.js'

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
 * A red CI run enters `CI_FIX`. An explicit slash command wins outright. A
 * plain maintainer comment is classified, because "review and refine" is a
 * conversation, not a command language — but the two phases that classify want
 * opposite defaults, so they read the same verdict through different branches.
 * On a waiting phase, {@link applyIntent} defaults to *question*, the only
 * reading that cannot destroy approved work. In `INIT_OR_CLARIFY` there is no
 * approved work yet and the comment is probably an answer the agent asked for,
 * so {@link applyClarifyIntent} defaults the other way — see there.
 */
export const applyTrigger = (input: PhaseInput): Promise<TriggerOutcome> => {
  const { state, trigger, command } = input

  if (trigger.kind === 'ci') return applyCiTrigger(input)
  if (command !== null) return applyCommand(input, command)
  if (state.phase === 'INIT_OR_CLARIFY') return applyClarifyIntent(input)
  if (!WAITING_PHASES.has(state.phase)) return readAndSkip(input, `No actionable command while in ${state.phase}`)

  return applyIntent(input)
}

const applyCommand = (input: PhaseInput, command: ParsedCommand): Promise<TriggerOutcome> => {
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

  // Before the move, not after it — see `refuseExhausted` below. Asked of the
  // transition table rather than of `state.phase` directly, so this cannot start
  // answering for a `/retry` the phase was going to turn down anyway: a retry
  // that does not apply here is a wrong-command refusal, not a spent budget.
  if (signal === 'RETRY' && canTransition(state.phase, signal) && state.attempts >= deps.config.maxAttempts) {
    return refuseExhausted(input)
  }

  const outcome = moveOrSkip(state, signal, deps, command.command)
  if (outcome.halt === null) return Promise.resolve(outcome)

  return refuseCommand(input, command.command, outcome.halt.reason)
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
  await postAndAppend(thread, input, renderRefusedCommand(command, state.phase, acceptedCommands(state.phase)), state)

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
