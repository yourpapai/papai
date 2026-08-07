// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { parseSlashCommand } from './commands.js'
import { evaluateGuardrails } from './guardrails.js'
import type { TriggerEvent } from './guardrails.js'
import type { IssueContext, PhaseDeps, PhaseHandler, PhaseInput, PhaseOutcome } from './phase-context.js'
import { handleAnswer } from './phases/answer.js'
import { handleCiFix } from './phases/ci-fix.js'
import { handleDeliver } from './phases/deliver.js'
import { handleImplement } from './phases/implement.js'
import { handlePlan } from './phases/plan.js'
import { handleTriage } from './phases/triage.js'
import { postAndAppend, renderExhausted, renderFailure, renderSettled } from './run-report.js'
import { findLatestState, initialState, transition } from './state-manager.js'
import { applyTrigger } from './triggers.js'
import { errorMessage } from './types.js'
import type { Phase, RunResult, TransitionSignal } from './types.js'

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
  const restored = findLatestState(thread, deps.config.selfLogin, event.issueNumber) ?? initialState(event.issueNumber)
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
  await postAndAppend(thread, input, renderFailure(state.phase, message, failed, deps.config.maxAttempts), failed)

  return { status: 'failed', reason: message, state: failed }
}
