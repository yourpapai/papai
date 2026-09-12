// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { commandApplies } from './commands.js'
import type { ParsedCommand } from './commands.js'
import { react } from './feedback.js'
import type { PhaseInput } from './phase-context.js'
import { postAndAppend } from './run-post.js'
import { renderFollowUpUsage } from './run-report.js'
import { skip } from './trigger-outcome.js'
import type { TriggerOutcome } from './trigger-outcome.js'

/**
 * The non-moving side operations, decided before the signal lookup.
 *
 * Their own module since `/follow-up` (issue #441) joined: `triggers.ts` had
 * split twice before along seams its length demanded — the red-CI path into
 * `ci-trigger.ts`, plain prose into `comment-intent.ts` — and the three
 * commands that ask nothing of the transition table are the same kind of
 * thing, decided by the same shape, so they live together.
 *
 * `/ask` is always available: answering asks nothing of the state machine, so
 * there is no phase in which it can be the wrong thing to do. The machine now
 * agrees — `ANSWERED` is a non-moving signal accepted in every phase. It did
 * not use to: it lived in three rows of the transition table while this line
 * let `/ask` through everywhere, so a question in COMPLETE, FAILED or any
 * mid-pipeline phase paid for the model turn and then crashed the runner on
 * an `InvalidTransitionError` nobody on the issue ever saw.
 *
 * `/sync` is that shape's sibling — no `COMMAND_SIGNALS` entry, so the
 * transition table is never consulted and no phase, park or resume question
 * exists to answer. `COMPLETE`, `FAILED` and `INCOMPLETE` all take it, which
 * is the point: a branch that fell behind its base is repaired from wherever
 * it was left, with or without a pull request — issue #323 is why the "with"
 * half matters, a drift park before any pull request existed whose only
 * machine remedy this gate used to refuse. The predicate is the one
 * `acceptedCommands` reads, so the gate and the offer cannot drift; before
 * capture there is no branch to merge base into, and the refusal is the
 * ordinary wrong-command one listing what does apply.
 *
 * `/follow-up` is `/sync`'s shape with teeth: the same non-moving dispatch —
 * a flag on the outcome, no phase, no transition row — gated on delivery
 * reached, which is `/follow-up`'s own predicate row and deliberately not
 * `/sync`'s branch-existence rule. Outside the predicate it falls through to
 * the signal lookup and `triggers.ts`'s `refuseUnknown`, whose wording names
 * the delivered pull request the command is asking for. An empty argument is
 * refused with usage here rather than spent on a size-gate turn that has
 * nothing to assess — the one branch that posts, which is why it enters
 * through {@link refuseIfUsageMissing} from the async command body.
 */

/**
 * The dispatch: which side operation this command is, or `null` when it is
 * none — a command with a signal, or a side operation outside its predicate,
 * both of which the caller's next layers own.
 */
export const sideOperation = (input: PhaseInput, command: ParsedCommand): TriggerOutcome | null => {
  const { state } = input
  if (command.command === '/ask') return { state, halt: null, answer: true }
  if (command.command === '/sync') {
    if (commandApplies('/sync', state)) return { state, halt: null, answer: false, sync: true }
    return null
  }
  if (command.command === '/follow-up') {
    if (!commandApplies('/follow-up', state)) return null
    return { state, halt: null, answer: false, followUp: true }
  }
  return null
}

/**
 * The reply to a `/follow-up` with nothing to assess.
 *
 * The size gate is a model turn, and an empty argument is nothing to assess —
 * the usage note is the whole answer. Not `refuseCommand`'s frame: the
 * delivered state accepts the command perfectly well, and its
 * accepted-commands list would name `/follow-up` while refusing it.
 */
const refuseFollowUpUsage = async (input: PhaseInput): Promise<TriggerOutcome> => {
  const { state, thread, deps } = input
  deps.log.warn(
    { issue: state.issueId, pr: state.prNumber, command: '/follow-up' },
    'Refused an argument-less /follow-up',
  )
  await react(deps, input.trigger, 'confused')
  await postAndAppend(thread, input, renderFollowUpUsage(), state)
  return {
    state,
    halt: skip(state, '/follow-up needs an argument: what to change on the pull request', true),
    answer: false,
  }
}

/**
 * The usage gate the async command body asks before dispatching: an
 * argument-less `/follow-up` where the command would otherwise dispatch is
 * answered with the usage note. `null` is "nothing to refuse here" — either
 * the command is not `/follow-up`, it is outside the predicate (the
 * wrong-command door owns that refusal and its wording), or there is an
 * argument to assess.
 */
export const refuseIfUsageMissing = (input: PhaseInput, command: ParsedCommand): Promise<TriggerOutcome> | null => {
  if (command.command !== '/follow-up') return null
  if (!commandApplies('/follow-up', input.state)) return null
  if (command.argument.length > 0) return null
  return refuseFollowUpUsage(input)
}
