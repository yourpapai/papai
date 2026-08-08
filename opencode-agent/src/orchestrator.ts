// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { parseSlashCommand } from './commands.js'
import { react, settleReaction } from './feedback.js'
import { evaluateGuardrails } from './guardrails.js'
import type { TriggerEvent } from './guardrails.js'
import { reconcileLabels, settleLabels } from './labels.js'
import type { IssueContext, MachineInput, PhaseDeps, PhaseHandler, PhaseInput, PhaseOutcome } from './phase-context.js'
import { failAnswer, failRun } from './phase-failure.js'
import { handleAnswer } from './phases/answer.js'
import { handleCiFix } from './phases/ci-fix.js'
import { handleDeliver } from './phases/deliver.js'
import { handleImplement } from './phases/implement.js'
import { handlePlan } from './phases/plan.js'
import { handleTriage } from './phases/triage.js'
import { postAndAppend, renderSettled } from './run-report.js'
import { findLatestState, initialState, transition } from './state-manager.js'
import { recordSpend, stopIfOverBudget } from './token-budget.js'
import type { TriggerOutcome } from './trigger-outcome.js'
import { applyTrigger } from './triggers.js'
import type { AgentState, Phase, RunResult, TransitionSignal } from './types.js'

/**
 * Phases the pipeline can act on unattended. A phase with no handler is a
 * waiting state: the run stops there until a maintainer comments.
 */
const HANDLERS: Partial<Record<Phase, PhaseHandler>> = {
  INIT_OR_CLARIFY: handleTriage,
  PLANNING: handlePlan,
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
  const acknowledgement = await react(deps, event, 'eyes')

  const result = await runAccepted(event, deps)

  // The other end of that acknowledgement, and the reason it is held here rather
  // than inside `runAccepted`: 👀 is placed before the run knows which of its
  // several exits it will take, so the only place guaranteed to see both the
  // handle and the outcome is the one frame that spans them. Every exit below is
  // an ordinary `return`, so there is no path that skips it — a throw is the
  // deliberate exception, and it is the crash the workflow's fallback comment
  // exists to explain, where a stale 👀 is the least of what is left behind.
  //
  // Not reporting, for the reason `finish` is not: an emoji is not an account of
  // what happened, so `result.reported` is passed through untouched.
  await settleReaction(deps, event, acknowledgement, result.status)

  return result
}

/**
 * Everything a trigger the guardrails let through does.
 *
 * Split from {@link runPipeline}, which is now the guardrail and the
 * acknowledgement, because the two halves answer different questions and the
 * function was already at the length limit before the label reconciles arrived.
 *
 * Both of those reconciles live here rather than deeper down, because both are
 * statements about the *run*: one marker goes on when work starts and comes off
 * when it ends, whatever the outcome, and neither fact is known to a phase.
 */
const runAccepted = async (event: TriggerEvent, deps: PhaseDeps): Promise<RunResult> => {
  const thread = await deps.github.listIssueComments(event.issueNumber)
  const restored = findLatestState(thread, await deps.selfLogin(), event.issueNumber) ?? initialState(event.issueNumber)
  const issue = await resolveIssue(event, deps)
  const command = event.kind === 'issue' ? parseSlashCommand(event.commentBody) : null

  const base: PhaseInput = { state: restored, issue, trigger: event, command, thread, deps }
  const entry = await applyTrigger(base)
  if (entry.halt !== null) return settleLabels(deps, entry.halt, restored)

  // Only when something is actually going to run. The closing reconcile happens
  // either way — it is also the repair — but marking a run that is about to do
  // nothing adds the marker and takes it off again within the second, which is
  // two timeline entries on an issue where the agent did nothing, and precisely
  // the churn a diff instead of a clear-and-reapply exists to avoid.
  // The status comment is opened on the same condition and for the same reason:
  // it is the whole comment budget this plan allows itself, and spending it on a
  // run that is about to do nothing is the noise the budget exists to prevent.
  if (willWork(entry)) {
    await reconcileLabels(deps, entry.state, 'working')
    await deps.status.start(entry.state)
  }

  const result = await driveMachine({
    ...base,
    state: entry.state,
    answer: entry.answer,
    posted: false,
    // Captured once. This job's session total is cumulative across the phases it
    // runs, so adding it to the *restored* figure gives a monotonic total;
    // adding it to each phase's own would count the earlier phases again.
    carriedTokens: restored.tokensSpent,
  })

  // Finalising the status comment is deliberately not reporting: `finish`
  // returns nothing, so this cannot touch `result.reported` even by accident. A
  // run that died before reaching this line leaves "run in progress" on the
  // issue, which is exactly what the workflow's fallback comment is for.
  await deps.status.finish(result)

  return settleLabels(deps, result, entry.state)
}

/**
 * Whether the cascade will actually run a handler for this entry.
 *
 * The two cases where it will not are a trigger that moved into a waiting phase
 * and `/cancel`, which reaches `COMPLETE` — both of them state moves with no
 * work behind them, and `agent:working` on either is a claim that nothing is
 * happening. Asked of the same `HANDLERS` table {@link driveMachine} looks the
 * phase up in, so the marker cannot disagree with what the machine does next.
 */
const willWork = (entry: TriggerOutcome): boolean => entry.answer || HANDLERS[entry.state.phase] !== undefined

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

  // After the budget stop, so a run that cannot afford this phase does not
  // announce it as the one in flight.
  await input.deps.status.enter(state)

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
