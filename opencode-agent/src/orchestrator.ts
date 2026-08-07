// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { parseSlashCommand } from './commands.js'
import { evaluateGuardrails } from './guardrails.js'
import type { TriggerEvent } from './guardrails.js'
import type { IssueContext, MachineInput, PhaseDeps, PhaseHandler, PhaseInput, PhaseOutcome } from './phase-context.js'
import { handleAnswer } from './phases/answer.js'
import { handleCiFix } from './phases/ci-fix.js'
import { handleDeliver } from './phases/deliver.js'
import { handleImplement } from './phases/implement.js'
import { handlePlan } from './phases/plan.js'
import { handleTriage } from './phases/triage.js'
import { postAndAppend, renderAnswerFailure, renderFailure, renderSettled } from './run-report.js'
import { findLatestState, initialState, transition } from './state-manager.js'
import { stopIfOverBudget, totalTokens } from './token-budget.js'
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

/**
 * Runs handlers back-to-back. Recursion rather than a loop: each step's result
 * feeds the next call's state and thread, and the repo forbids awaiting inside
 * a loop body. The cascade ends at a phase with no handler.
 *
 * The **retry** budget is deliberately not checked here, unlike the token
 * budget in `token-budget.ts`. It used to be, and being inside the cascade was
 * the whole problem: by this point `applyTrigger` has applied `RETRY`, which
 * clears `resumeFrom`, so the give-up notice posted the state that had already
 * left `FAILED` and stranded the issue in a handler phase nothing re-enters.
 * `refuseExhausted` in `triggers.ts` turns the signal down instead.
 *
 * The token budget answers the same invariant from the other end, because it
 * cannot move to the trigger layer: half its firings are between two phases of
 * one job, with no signal to refuse. It stays inside the cascade and parks the
 * issue in `FAILED` with a resume point instead — see `stopIfOverBudget`.
 *
 * Not moved here, and not kept as a second check either, because there is
 * nothing left for one to catch. `attempts` only ever grows on a `FAILED`
 * transition, every forward move resets it to 0, and `RETRY` — the single
 * signal that carries a non-zero count into a phase with a handler — is now
 * gated on the budget before it is applied, so no state this pipeline writes
 * can reach a handler over the ceiling. A backstop would only fire on a
 * hand-edited state block, and the one that stood here made that case worse
 * rather than better: it posted the state unchanged, re-creating in
 * `INIT_OR_CLARIFY` the same unreachable park it was meant to report, and it
 * sat in front of the answer handler too, so `/ask` in `FAILED` past the budget
 * replied "Giving up" instead of an answer. A hand-edited count cannot run away
 * on its own — every failure still lands in `FAILED`, where the trigger gate
 * holds — so one gate, in the layer that owns the decision, is the whole rule.
 */
const driveMachine = async (input: MachineInput): Promise<RunResult> => {
  const { state, thread } = input

  const handler = input.answer ? handleAnswer : HANDLERS[state.phase]
  if (handler === undefined) return settle(input)

  // Before the handler, and it is `token-budget.ts` that decides what "stop"
  // means: over budget the run parks in FAILED naming this phase, so raising
  // `AGENT_MAX_TOKENS` and replying `/retry` resumes exactly here. Stopping in
  // place used to leave the issue in a phase no trigger re-enters.
  const stopped = await stopIfOverBudget(input)
  if (stopped !== null) return stopped

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
