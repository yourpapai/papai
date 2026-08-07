// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ParsedCommand } from './commands.js'
import { branchNameFor } from './git.js'
import { classifyComment } from './intent.js'
import type { PhaseDeps, PhaseInput } from './phase-context.js'
import { postAndAppend, renderCiExhausted, renderRefusedCommand } from './run-report.js'
import { canTransition, markCiBudgetReported, transition } from './state-manager.js'
import { errorMessage, WAITING_PHASES } from './types.js'
import type { AgentState, Phase, RunResult, TransitionSignal } from './types.js'

/**
 * Turning a trigger — a slash command, a plain comment, a red CI run — into the
 * state move the machine should make, before any phase handler runs.
 *
 * Split out of `orchestrator.ts`, which now owns only the phase cascade. The two
 * answer different questions: this one decides *whether and where* to go, that
 * one drives the handlers once the decision is made.
 */

export interface TriggerOutcome {
  state: AgentState
  halt: RunResult | null
  /** Set when the trigger should be handled as a question rather than a phase. */
  answer: boolean
}

/** Slash commands, mapped to the signal they inject before handlers run. */
const COMMAND_SIGNALS: Record<string, TransitionSignal> = {
  '/approve': 'APPROVED',
  '/changes': 'CHANGES_REQUESTED',
  '/retry': 'RETRY',
  '/cancel': 'CANCELLED',
}

/**
 * Turns the trigger into a state move.
 *
 * A red CI run enters `CI_FIX`. An explicit slash command wins outright. A
 * plain maintainer comment on a waiting phase is classified, because "review
 * and refine" is a conversation, not a command language — and the classifier
 * defaults to *question*, the only reading that cannot destroy approved work.
 */
export const applyTrigger = (input: PhaseInput): Promise<TriggerOutcome> => {
  const { state, trigger, command } = input

  if (trigger.kind === 'ci') return applyCiTrigger(input)
  if (command !== null) return applyCommand(input, command)
  if (state.phase === 'INIT_OR_CLARIFY') return Promise.resolve({ state, halt: null, answer: false })
  if (!WAITING_PHASES.has(state.phase)) {
    return Promise.resolve({ state, halt: skip(state, `No actionable command while in ${state.phase}`), answer: false })
  }

  return applyIntent(input)
}

/**
 * A red CI run either buys a fix attempt or, once the budget is spent, buys the
 * maintainer a notice — exactly once. Neither, if the pull request it would be
 * fixing is no longer live.
 *
 * Silence on a spent budget is the failure mode: CI events arrive on their own
 * schedule with nobody reading the Actions log, so an agent that quietly stops
 * fixing looks identical to one still working. Repeating the notice on every
 * later red run would be the opposite mistake, which is what `ciBudgetReported`
 * prevents.
 */
const applyCiTrigger = async (input: PhaseInput): Promise<TriggerOutcome> => {
  const { state, deps, thread } = input
  const spent = state.ciAttempts >= deps.config.maxCiAttempts
  const reason = `Spent the CI-fix budget (${state.ciAttempts} of ${deps.config.maxCiAttempts} attempts).`

  // Decided already, so do not pay for a pull-request lookup to re-decide it.
  if (spent && state.ciBudgetReported) {
    return { state, halt: skip(state, `${reason} Already reported.`), answer: false }
  }

  const settled = await settledPullRequest(input)
  if (settled !== null) return settled

  if (!spent) return moveOrSkip(state, 'CI_FAILED', deps, 'a red CI run')

  const reported = markCiBudgetReported(state)
  deps.log.warn({ issue: state.issueId, ciAttempts: state.ciAttempts }, 'CI-fix budget spent')
  await postAndAppend(thread, input, renderCiExhausted(reason, state.prUrl), reported)

  return { state: reported, halt: { status: 'failed', reason, state: reported }, answer: false }
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

const applyCommand = (input: PhaseInput, command: ParsedCommand): Promise<TriggerOutcome> => {
  const { state, deps } = input
  // Always available: answering asks nothing of the state machine, so there is
  // no phase in which it can be the wrong thing to do.
  if (command.command === '/ask') return Promise.resolve({ state, halt: null, answer: true })

  const signal = COMMAND_SIGNALS[command.command]
  if (signal === undefined) return refuseCommand(input, command.command, `Unknown command ${command.command}`)

  const outcome = moveOrSkip(state, signal, deps, command.command)
  if (outcome.halt === null) return Promise.resolve(outcome)

  return refuseCommand(input, command.command, outcome.halt.reason)
}

/**
 * Answers a refused command on the issue, then skips.
 *
 * Only explicit commands come here. A classified plain comment cannot reach it
 * — `applyIntent` runs solely in the waiting phases, both of which accept both
 * of the signals it can produce — and the CI paths above have their own,
 * deliberately quieter, reporting.
 */
const refuseCommand = async (input: PhaseInput, command: string, reason: string): Promise<TriggerOutcome> => {
  const { state, thread, deps } = input
  deps.log.warn({ issue: state.issueId, phase: state.phase, command }, 'Refused a slash command')

  await postAndAppend(thread, input, renderRefusedCommand(command, state.phase, acceptedCommands(state.phase)), state)

  return { state, halt: skip(state, reason), answer: false }
}

/** The commands `phase` would actually accept, straight from the transition table. */
const acceptedCommands = (phase: Phase): readonly string[] => [
  ...Object.entries(COMMAND_SIGNALS)
    .filter(([, signal]) => canTransition(phase, signal))
    .map(([command]) => command),
  '/ask',
]

const applyIntent = async (input: PhaseInput): Promise<TriggerOutcome> => {
  const { state, trigger, deps } = input
  const body = trigger.kind === 'issue' ? trigger.commentBody : null
  if (body === null || body.trim().length === 0) {
    return { state, halt: skip(state, 'Empty comment'), answer: false }
  }

  const intent = await classifyComment({ body, phase: state.phase, deps, state })
  deps.log.info({ intent, phase: state.phase }, 'Classified maintainer comment')

  if (intent === 'none') return { state, halt: skip(state, 'Comment needs no action'), answer: false }
  if (intent === 'question') return { state, halt: null, answer: true }

  const signal: TransitionSignal = intent === 'approve' ? 'APPROVED' : 'CHANGES_REQUESTED'
  return moveOrSkip(state, signal, deps, `an implied ${intent}`)
}

const moveOrSkip = (state: AgentState, signal: TransitionSignal, deps: PhaseDeps, source: string): TriggerOutcome => {
  try {
    const next = transition(state, signal)
    deps.log.info({ source, signal, from: state.phase, to: next.phase }, 'Applied trigger')
    return { state: next, halt: null, answer: false }
  } catch (error) {
    return {
      state,
      halt: skip(state, `${source} is not valid in ${state.phase}: ${errorMessage(error)}`),
      answer: false,
    }
  }
}

const skip = (state: AgentState, reason: string): RunResult => ({ status: 'skipped', reason, state })
