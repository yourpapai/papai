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
import {
  postAndAppend,
  renderAnswerFailure,
  renderExhausted,
  renderFailure,
  renderOverBudget,
  renderSettled,
} from './run-report.js'
import { findLatestState, initialState, transition } from './state-manager.js'
import { applyTrigger } from './triggers.js'
import { errorMessage } from './types.js'
import type { AgentState, Phase, RunResult, TransitionSignal } from './types.js'

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
    selfLogin: await deps.selfLogin(),
    selfWorkflowName: deps.config.selfWorkflowName,
  })
  if (!guard.allowed) {
    deps.log.warn({ code: guard.code, event: event.eventName }, 'Trigger rejected by guardrails')
    return { status: 'skipped', reason: guard.reason, state: null }
  }

  const thread = await deps.github.listIssueComments(event.issueNumber)
  const restored = findLatestState(thread, await deps.selfLogin(), event.issueNumber) ?? initialState(event.issueNumber)
  const issue = await resolveIssue(event, deps)
  const command = event.kind === 'issue' ? parseSlashCommand(event.commentBody) : null

  const base: PhaseInput = { state: restored, issue, trigger: event, command, thread, deps }
  const entry = await applyTrigger(base)
  if (entry.halt !== null) return entry.halt

  return driveMachine({
    ...base,
    state: entry.state,
    answer: entry.answer,
    posted: false,
    // Captured once. This job's session total is cumulative across the phases it
    // runs, so adding it to the *restored* figure gives a monotonic total;
    // adding it to each phase's own would count the earlier phases again.
    carriedTokens: restored.tokensSpent,
  })
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
  /** Tokens this issue had spent before this job started. */
  carriedTokens: number
}

/** Everything this issue has spent, prior jobs included. */
const totalTokens = async (input: MachineInput): Promise<number> =>
  input.carriedTokens + (await input.deps.tokensUsed())

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

  // Before the handler, not after: the point of a ceiling is to stop the next
  // expensive thing, and checking afterwards would let every phase overspend
  // once. Checked per phase rather than per prompt because a phase is the
  // granularity at which spend is knowable — the review loop's subprocesses run
  // in their own sessions, which this total cannot see.
  const spent = await totalTokens(input)
  if (spent >= deps.config.maxTokens) return overBudget(input, spent)

  const attempt = await runHandler(handler, input)
  if (!attempt.ok) return input.answer ? failAnswer(input, attempt.error) : failRun(input, attempt.error)

  const { outcome, next } = attempt
  const grown = await postAndAppend(thread, input, outcome.comment, next, outcome.blocks)

  if (PAUSE_SIGNALS.has(outcome.signal)) {
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

/**
 * Stops an issue that has spent its token budget.
 *
 * Shaped like {@link exhausted} — post on the issue, leave the phase alone, and
 * report a failed run — because a guardrail that stops in silence reads as an
 * agent that lost interest.
 */
const overBudget = async (input: MachineInput, spent: number): Promise<RunResult> => {
  const { state, deps, thread } = input
  const reason = `Token budget spent (${spent} of ${deps.config.maxTokens} tokens for this issue)`
  deps.log.warn({ issue: state.issueId, spent, limit: deps.config.maxTokens }, 'Stopping: token budget spent')

  await postAndAppend(thread, input, renderOverBudget(spent, deps.config.maxTokens), { ...state, tokensSpent: spent })

  return { status: 'failed', reason, state: { ...state, tokensSpent: spent } }
}

type HandlerAttempt = { ok: true; outcome: PhaseOutcome; next: AgentState } | { ok: false; error: unknown }

/**
 * Runs one handler and applies its signal, both inside the same guard.
 *
 * The `transition` used to sit outside it, on the caller's happy path. A
 * handler reporting a signal its phase does not accept therefore threw straight
 * out of `driveMachine`, past `runPipeline` and `runCli`, and `main` printed a
 * stack trace and exited 1 — with the model turn already paid for and not a
 * word posted on the issue. That is how `/ask` failed outside the three phases
 * whose transition rows happened to name `ANSWERED`. Inside the guard, any
 * future handler/phase mismatch is reported on the issue like any other phase
 * failure, which is the only place a maintainer will ever see it.
 */
const runHandler = async (handler: PhaseHandler, input: MachineInput): Promise<HandlerAttempt> => {
  try {
    const outcome = await handler(input)
    const patch = { ...outcome.patch, tokensSpent: await totalTokens(input) }
    return { ok: true, outcome, next: transition(input.state, outcome.signal, patch) }
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

/**
 * Reports a failed answer without moving the machine, and without spending an
 * attempt.
 *
 * A question is a side conversation about work that lives elsewhere: the phase
 * records where the *work* is, so parking a delivered pull request or an
 * in-flight implementation in FAILED because a model turn about it broke is a
 * lie about what happened. In COMPLETE it was not even reachable — the FAILED
 * guard in `canTransition` refuses that move — so {@link failRun}'s own
 * `transition` threw and took the whole runner with it.
 *
 * The retry budget is left alone for the same reason: `attempts` counts
 * consecutive failures to make progress on the issue, and a question makes
 * none either way. Leaving `resumeFrom` alone is what makes the notice honest.
 * Answering in a waiting phase used to record `resumeFrom: 'DESIGN_SPEC'`, and
 * the `/retry` the failure comment invited then resumed into a phase with no
 * handler and re-parked with "Parked in `DESIGN_SPEC`" — one attempt poorer for
 * a round trip that did nothing.
 */
const failAnswer = async (input: MachineInput, error: unknown): Promise<RunResult> => {
  const { state, deps, thread } = input
  const message = errorMessage(error)
  deps.log.error({ issue: state.issueId, phase: state.phase, error: message }, 'Answering a question failed')

  await postAndAppend(thread, input, renderAnswerFailure(state.phase, message), state)

  return { status: 'failed', reason: message, state }
}
