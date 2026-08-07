// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { parseSlashCommand } from './commands.js'
import type { ParsedCommand } from './commands.js'
import { evaluateGuardrails } from './guardrails.js'
import type { TriggerEvent } from './guardrails.js'
import { classifyComment } from './intent.js'
import type { IssueContext, PhaseDeps, PhaseHandler, PhaseInput, PhaseOutcome } from './phase-context.js'
import { handleAnswer } from './phases/answer.js'
import { handleCiFix } from './phases/ci-fix.js'
import { handleDeliver } from './phases/deliver.js'
import { handleImplement } from './phases/implement.js'
import { handlePlan } from './phases/plan.js'
import { handleTriage } from './phases/triage.js'
import { postAndAppend, renderCiExhausted, renderExhausted, renderFailure, renderSettled } from './run-report.js'
import { findLatestState, initialState, markCiBudgetReported, transition } from './state-manager.js'
import { errorMessage, WAITING_PHASES } from './types.js'
import type { AgentState, Phase, TransitionSignal } from './types.js'

/**
 * Phases the pipeline can act on unattended. A phase with no handler is a
 * waiting state: the run stops there until a maintainer comments.
 */
const HANDLERS: Partial<Record<Phase, PhaseHandler>> = {
  INIT_OR_CLARIFY: handleTriage,
  EXECUTION_PLAN: handlePlan,
  REVIEW_AND_MUTATE: handleImplement,
  PR_DELIVERY: handleDeliver,
  CI_FIX: handleCiFix,
}

/**
 * Signals that hand control back to a human even though the resulting phase has
 * a handler. Without this, asking a clarifying question would immediately
 * re-enter triage and ask again, forever.
 */
const PAUSE_SIGNALS: ReadonlySet<TransitionSignal> = new Set<TransitionSignal>(['NEEDS_CLARIFICATION', 'ANSWERED'])

export type RunStatus = 'skipped' | 'waiting' | 'completed' | 'failed'

export interface RunResult {
  status: RunStatus
  reason: string
  state: AgentState | null
}

export interface RunOptions {
  event: TriggerEvent
  deps: PhaseDeps
}

/**
 * One CI job = one call. Restores state from the issue thread, turns the
 * trigger into a state move, then runs phase handlers back-to-back until the
 * machine reaches a waiting state, COMPLETE, or a failure.
 */
export const runPipeline = async (options: RunOptions): Promise<RunResult> => {
  const { event, deps } = options

  const guard = evaluateGuardrails(event, {
    selfLogin: deps.config.selfLogin,
    selfWorkflowName: deps.config.selfWorkflowName,
  })
  if (!guard.allowed) {
    deps.log.warn({ code: guard.code, event: event.eventName }, 'Trigger rejected by guardrails')
    return { status: 'skipped', reason: guard.reason, state: null }
  }

  const thread = await deps.github.listIssueComments(event.issueNumber)
  const restored = findLatestState(thread, deps.config.selfLogin) ?? initialState(event.issueNumber)
  const issue = await resolveIssue(event, deps)
  const command = event.kind === 'issue' ? parseSlashCommand(event.commentBody) : null

  const base: PhaseInput = { state: restored, issue, trigger: event, command, thread, deps }
  const entry = await applyTrigger(base)
  if (entry.halt !== null) return entry.halt

  return driveMachine({ ...base, state: entry.state, answer: entry.answer, posted: false })
}

/** The issue's title and body, from the payload when present, else the API. */
const resolveIssue = (event: TriggerEvent, deps: PhaseDeps): Promise<IssueContext> => {
  if (event.kind === 'issue') {
    return Promise.resolve({ number: event.issueNumber, title: event.issueTitle, body: event.issueBody })
  }
  return deps.github.getIssue(event.issueNumber)
}

interface TriggerOutcome {
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
const applyTrigger = (input: PhaseInput): Promise<TriggerOutcome> => {
  const { state, trigger, command, deps } = input

  if (trigger.kind === 'ci') return applyCiTrigger(input)
  if (command !== null) return Promise.resolve(applyCommand(state, command, deps))
  if (state.phase === 'INIT_OR_CLARIFY') return Promise.resolve({ state, halt: null, answer: false })
  if (!WAITING_PHASES.has(state.phase)) {
    return Promise.resolve({ state, halt: skip(state, `No actionable command while in ${state.phase}`), answer: false })
  }

  return applyIntent(input)
}

/**
 * A red CI run either buys a fix attempt or, once the budget is spent, buys the
 * maintainer a notice — exactly once.
 *
 * Silence here is the failure mode: CI events arrive on their own schedule with
 * nobody reading the Actions log, so an agent that quietly stops fixing looks
 * identical to one still working. Repeating the notice on every later red run
 * would be the opposite mistake, which is what `ciBudgetReported` prevents.
 */
const applyCiTrigger = async (input: PhaseInput): Promise<TriggerOutcome> => {
  const { state, deps, thread } = input
  if (state.ciAttempts < deps.config.maxCiAttempts) {
    return moveOrSkip(state, 'CI_FAILED', deps, 'a red CI run')
  }

  const reason = `Spent the CI-fix budget (${state.ciAttempts} of ${deps.config.maxCiAttempts} attempts).`
  if (state.ciBudgetReported) {
    return { state, halt: skip(state, `${reason} Already reported.`), answer: false }
  }

  const reported = markCiBudgetReported(state)
  deps.log.warn({ issue: state.issueId, ciAttempts: state.ciAttempts }, 'CI-fix budget spent')
  await postAndAppend(thread, input, renderCiExhausted(reason, state.prUrl), reported)

  return { state: reported, halt: { status: 'failed', reason, state: reported }, answer: false }
}

const applyCommand = (state: AgentState, command: ParsedCommand, deps: PhaseDeps): TriggerOutcome => {
  if (command.command === '/ask') return { state, halt: null, answer: true }

  const signal = COMMAND_SIGNALS[command.command]
  if (signal === undefined) return { state, halt: skip(state, `Unknown command ${command.command}`), answer: false }
  return moveOrSkip(state, signal, deps, command.command)
}

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

interface MachineInput extends PhaseInput {
  answer: boolean
  /** Whether this run has already written a state block to the thread. */
  posted: boolean
}

/**
 * Runs handlers back-to-back. Recursion rather than a loop: each step's result
 * feeds the next call's state and thread, and the repo forbids awaiting inside
 * a loop body. The cascade ends at a phase with no handler.
 */
const driveMachine = async (input: MachineInput): Promise<RunResult> => {
  const { deps, state, thread } = input

  const handler = input.answer ? handleAnswer : HANDLERS[state.phase]
  if (handler === undefined) return settle(input)

  if (state.attempts >= deps.config.maxAttempts) return exhausted(input)

  const attempt = await runHandler(handler, input)
  if (!attempt.ok) return failRun(input, attempt.error)

  const { signal, comment, blocks, patch } = attempt.outcome
  const next = transition(state, signal, patch ?? {})
  const grown = await postAndAppend(thread, input, comment, next, blocks)

  if (PAUSE_SIGNALS.has(signal)) {
    return { status: 'waiting', reason: `Waiting for a maintainer in ${next.phase}`, state: next }
  }

  return driveMachine({ ...input, answer: false, state: next, thread: grown, posted: true })
}

/**
 * Ends a run at a phase with no handler.
 *
 * If nothing has been posted yet, the trigger moved the state and no handler
 * ran to write it down — `/cancel` is the case that matters. A state that is
 * never posted never happened: the next event would restore the old phase and
 * the cancel would silently undo itself. So the terminal path posts too.
 */
const settle = async (input: MachineInput): Promise<RunResult> => {
  const { state, thread, posted } = input

  if (!posted) await postAndAppend(thread, input, renderSettled(state), state)

  return state.phase === 'COMPLETE'
    ? { status: 'completed', reason: 'Pipeline finished', state }
    : { status: 'waiting', reason: `Waiting for a maintainer in ${state.phase}`, state }
}

/** Reports the retry budget on the issue instead of failing in silence. */
const exhausted = async (input: MachineInput): Promise<RunResult> => {
  const { state, deps, thread } = input
  const reason = `Retry budget exhausted (${state.attempts} of ${deps.config.maxAttempts} attempts)`

  await postAndAppend(thread, input, renderExhausted(reason), state)

  return { status: 'failed', reason, state }
}

type HandlerAttempt = { ok: true; outcome: PhaseOutcome } | { ok: false; error: unknown }

const runHandler = async (handler: PhaseHandler, input: PhaseInput): Promise<HandlerAttempt> => {
  try {
    return { ok: true, outcome: await handler(input) }
  } catch (error) {
    return { ok: false, error }
  }
}

/**
 * Records the failure on the issue and parks the state in FAILED with
 * `resumeFrom` set, so `/retry` re-enters the exact phase that broke instead of
 * replaying the whole pipeline.
 */
const failRun = async (input: MachineInput, error: unknown): Promise<RunResult> => {
  const { state, deps, thread } = input
  const message = errorMessage(error)
  deps.log.error({ issue: state.issueId, phase: state.phase, error: message }, 'Phase handler failed')

  const failed = transition(state, 'FAILED', { lastError: message })
  await postAndAppend(thread, input, renderFailure(state.phase, message, failed, deps), failed)

  return { status: 'failed', reason: message, state: failed }
}

const skip = (state: AgentState, reason: string): RunResult => ({ status: 'skipped', reason, state })
