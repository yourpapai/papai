// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ParsedCommand } from './commands.js'
import { branchNameFor } from './git.js'
import { classifyComment } from './intent.js'
import type { PhaseDeps, PhaseInput } from './phase-context.js'
import { postAndAppend, renderCiExhausted, renderExhausted, renderRefusedCommand } from './run-report.js'
import { canTransition, markCiBudgetReported, transition } from './state-manager.js'
import { totalTokens, withinBudget } from './token-budget.js'
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
 * of the signals it can produce — and the CI paths above have their own,
 * deliberately quieter, reporting.
 */
const refuseCommand = async (input: PhaseInput, command: string, reason: string): Promise<TriggerOutcome> => {
  const { state, thread, deps } = input
  deps.log.warn({ issue: state.issueId, phase: state.phase, command }, 'Refused a slash command')

  await postAndAppend(thread, input, renderRefusedCommand(command, state.phase, acceptedCommands(state.phase)), state)

  return { state, halt: skip(state, reason), answer: false }
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

  return { state, halt: { status: 'failed', reason, state }, answer: false }
}

/** The commands `phase` would actually accept, straight from the transition table. */
const acceptedCommands = (phase: Phase): readonly string[] => [
  ...Object.entries(COMMAND_SIGNALS)
    .filter(([, signal]) => canTransition(phase, signal))
    .map(([command]) => command),
  '/ask',
]

/**
 * Reads a plain comment as an intent, and decides first whether that reading is
 * affordable.
 *
 * Classifying costs a model turn, and it is the one turn in the pipeline whose
 * spend can never be written down. State is persisted only by posting a comment,
 * and the `none` branch below deliberately posts nothing — replying to every
 * "thanks!" would be spam — so a session that reported 40,000 tokens for the
 * classification vanishes with the runner. The ceiling is therefore asked
 * *before* the turn rather than after it: over budget there is nothing any
 * classification could buy, since every branch here leads either to a handler or
 * to the answer path and `stopIfOverBudget` refuses both. Handing the comment
 * straight to the answer path lets that one check report it, in the wording it
 * already has, without a second stop in this layer and without paying to learn
 * what to say — otherwise a maxed-out issue keeps buying a classification per
 * comment for as long as anyone keeps commenting on it.
 *
 * That leaves one leak, knowingly: a run **under** budget whose classifier
 * answers `none` still spends a turn nothing records. Closing it needs a way to
 * persist state without posting — an `updateComment` on the last state block —
 * which is a larger design change than a stray few thousand tokens per no-op
 * comment justifies. The bound it erodes is per issue and human-paced, and every
 * other branch folds the classification in, because `deps.tokensUsed()` reports
 * the whole job's session and whatever the run goes on to post writes that total.
 */
const applyIntent = async (input: PhaseInput): Promise<TriggerOutcome> => {
  const { state, trigger, deps } = input
  const body = trigger.kind === 'issue' ? trigger.commentBody : null
  if (body === null || body.trim().length === 0) {
    return { state, halt: skip(state, 'Empty comment'), answer: false }
  }

  const spent = await totalTokens(deps, state.tokensSpent)
  if (!withinBudget(spent, deps.config)) {
    deps.log.warn(
      { issue: state.issueId, phase: state.phase, spent, limit: deps.config.maxTokens },
      'Over budget: not paying to classify the comment',
    )
    return { state, halt: null, answer: true }
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
