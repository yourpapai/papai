// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { MachineInput, PhaseHandler, PhaseOutcome } from './phase-context.js'
import { failAnswer, failRun } from './phase-failure.js'
import { handleAnswer } from './phases/answer.js'
import { handleCiFix } from './phases/ci-fix.js'
import { handleDeliver } from './phases/deliver.js'
import { handleImplement } from './phases/implement.js'
import { handlePlan } from './phases/plan.js'
import { handleReview } from './phases/review.js'
import { handleTriage } from './phases/triage.js'
import { postAndAppend, renderSettled } from './run-report.js'
import type { RunResult } from './run-result.js'
import { transition } from './state-manager.js'
import { recordSpend, stopIfOverBudget } from './token-budget.js'
import type { AgentState, Phase, TransitionSignal } from './types.js'

/**
 * The phase cascade: running handlers back-to-back until the machine reaches a
 * waiting state, `COMPLETE`, or a failure.
 *
 * Split from `orchestrator.ts`, which keeps the frame around this — the
 * guardrails, the acknowledgement whose two ends bracket the whole run, the
 * label and status channels, and turning an event into the state move that
 * enters here. The two halves answer different questions, the same seam
 * `triggers.ts` was split along, and the file reached `max-lines` the day a
 * third trigger kind and a reaction lifetime landed in it at once.
 */

/**
 * Phases the pipeline can act on unattended. A phase with no handler is a
 * waiting state: the run stops there until a maintainer comments.
 */
const HANDLERS: Partial<Record<Phase, PhaseHandler>> = {
  INIT_OR_CLARIFY: handleTriage,
  PLANNING: handlePlan,
  REVIEW_AND_MUTATE: handleImplement,
  PR_DELIVERY: handleDeliver,
  CODE_REVIEW: handleReview,
  CI_FIX: handleCiFix,
}

/**
 * Signals that hand control back to a human even though the resulting phase has
 * a handler. Without this, asking a clarifying question would immediately
 * re-enter triage and ask again, forever.
 */
const PAUSE_SIGNALS: ReadonlySet<TransitionSignal> = new Set<TransitionSignal>(['NEEDS_CLARIFICATION', 'ANSWERED'])

/**
 * Whether the cascade would actually run a handler for `phase`.
 *
 * Exported so `orchestrator.ts` can decide whether a run is going to do any
 * work before it puts `agent:working` on the issue and opens a status comment.
 * A predicate over this table rather than a second list over there: the marker
 * claiming a run is in flight and the machine's own next step have to be one
 * answer, and two tables agreeing is a coincidence rather than a property.
 */
export const hasHandler = (phase: Phase): boolean => HANDLERS[phase] !== undefined

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
export const driveMachine = async (input: MachineInput): Promise<RunResult> => {
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
