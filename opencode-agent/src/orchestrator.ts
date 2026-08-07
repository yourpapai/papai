// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { parseSlashCommand } from './commands.js'
import { react } from './feedback.js'
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
import { recordSpend, stopIfOverBudget } from './token-budget.js'
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
    // The one denial with a person behind it. Every other code here is machine
    // noise — a bot, the agent's own comment, a pull request, an event shape
    // this pipeline does not handle — and reacting to those would be talking to
    // nobody. `NOT_MAINTAINER` is a write triggered by an account without write
    // access, which is the judgement call: it is bounded to one reaction on one
    // comment with no content and no notification storm, and the alternative is
    // that an outside contributor's comment vanishes into a log they cannot
    // read.
    if (guard.code === 'NOT_MAINTAINER') await react(deps, event, 'confused')
    // `reported: false` and it has to stay that way: a reaction is not an
    // account of what happened, so the issue still carries nothing about this
    // run and the workflow's fallback comment must stay in scope.
    return { status: 'skipped', reason: guard.reason, state: null, reported: false }
  }

  // Every accepted trigger, before anything else this run does — a reaction that
  // arrives after the work is worth much less than one that arrives before it,
  // and this is the only acknowledgement any trigger gets. CI events fall
  // through it silently; `reactionTarget` decides that, not this call site.
  await react(deps, event, 'eyes')

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
    return { status: 'waiting', reason: `Waiting for a maintainer in ${next.phase}`, state: next, reported: true }
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
 *
 * Which is exactly why `reported` is unconditionally true here rather than
 * `posted`: the branch that has not posted is the branch that posts, so both
 * ways out of this function leave a comment on the issue.
 */
const settle = async (input: MachineInput): Promise<RunResult> => {
  const { state, thread, posted } = input

  if (!posted) await postAndAppend(thread, input, renderSettled(state), state)

  return state.phase === 'COMPLETE'
    ? { status: 'completed', reason: 'Pipeline finished', state, reported: true }
    : { status: 'waiting', reason: `Waiting for a maintainer in ${state.phase}`, state, reported: true }
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
    return { ok: true, outcome, next: transition(input.state, outcome.signal, await recordSpend(input, outcome.patch)) }
  } catch (error) {
    return { ok: false, error }
  }
}

/**
 * Records the failure on the issue and parks the state in FAILED with
 * `resumeFrom` set, so `/retry` re-enters the exact phase that broke instead of
 * replaying the whole pipeline.
 *
 * Through `recordSpend`, exactly as the success path is. A failing phase spends
 * what it spent — the model turn is paid for long before the parse that rejects
 * its reply — and this used to write `lastError` and nothing else, so the tokens
 * went unrecorded and the next runner read `0`. That is the one path the ceiling
 * most needs to see: the state it parks in is `FAILED`, and `/retry` out of
 * `FAILED` is how an issue comes back for another expensive round.
 */
const failRun = async (input: MachineInput, error: unknown): Promise<RunResult> => {
  const { state, deps, thread } = input
  const message = errorMessage(error)
  deps.log.error({ issue: state.issueId, phase: state.phase, error: message }, 'Phase handler failed')

  const failed = transition(state, 'FAILED', await recordSpend(input, { lastError: message }))
  const report = renderFailure(state.phase, message, failed, deps.config.maxAttempts, deps.config.runUrl)
  await postAndAppend(thread, input, report, failed)

  // The comment above is what the workflow's fallback step would otherwise
  // duplicate, contradicting it: this run has moved the issue to `FAILED`, so
  // "the issue state is unchanged" is false the moment `postAndAppend` returns.
  return { status: 'failed', reason: message, state: failed, reported: true }
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
 *
 * Moving nothing is not the same as recording nothing, which is the distinction
 * this path missed: it posted the restored state verbatim, so a question that
 * reached the model and then failed on a deadline or a rejected request handed
 * the next job a total with that turn missing from it. The spend is the one
 * thing a failed answer really does change, and it is written the way every
 * other state block writes it — see {@link recordSpend}.
 */
const failAnswer = async (input: MachineInput, error: unknown): Promise<RunResult> => {
  const { state, deps, thread } = input
  const message = errorMessage(error)
  deps.log.error({ issue: state.issueId, phase: state.phase, error: message }, 'Answering a question failed')

  const carried = { ...state, ...(await recordSpend(input)) }
  await postAndAppend(thread, input, renderAnswerFailure(state.phase, message), carried)

  return { status: 'failed', reason: message, state: carried, reported: true }
}
