// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { PipelineConfig } from './config.js'
import type { MachineInput } from './phase-context.js'
import { postAndAppend, postAnswer } from './run-post.js'
import type { RunResult } from './run-result.js'
import { renderAnswerOutOfTime, renderOutOfTime } from './time-notices.js'
import { recordSpend } from './token-budget.js'
import { transition } from './transitions.js'

/**
 * The job's own wall clock: how much of it is left, and how a run stops when it
 * cannot afford the phase in front of it.
 *
 * Deliberately shaped like `token-budget.ts`, next door, because it is the same
 * kind of thing: time is a resource with a ceiling, spent by turns, and a run that
 * reaches that ceiling has **reached a bound** rather than broken. What that file
 * does for `AGENT_MAX_TOKENS` this one does for the job's `timeout-minutes`, down
 * to where the check is asked from and what the stop leaves behind — a measurement
 * (`msToDeadline`), one exact comparison (`timeForAnotherPhase`), and a stop that
 * parks with a resume point and posts a notice naming what would make the remedy
 * work.
 *
 * Three differences, each with a reason:
 *
 *   - the bound may be **absent**. A token ceiling always exists; a job deadline is
 *     derived from two facts only an Actions runner knows, so every `--event-path`
 *     run has none and must behave exactly as it did before this existed;
 *   - the figure is **free to read**. It is a clock, not a session's usage, so
 *     there is no round trip to measure and nothing to carry between jobs — each
 *     job gets a whole one, which is also what makes `/continue` a real remedy
 *     where `/retry` under the same token ceiling is not;
 *   - the stop reports **`waiting`**, not `failed`. See {@link parkOutOfTime}.
 *
 * The stop **in front of** a phase is all this module owns, and it loses nothing by
 * construction: the phase it refuses never starts. The other stop — the clock running
 * out *inside* a turn — lives in `turn-stop.ts`, because it is a different thing
 * entirely: it aborts the model, asks for a handoff, salvages the tree with the
 * repository's hooks bypassed, and only then parks in the same phase this one does.
 * The two share `msToDeadline` and the park and nothing else, which is why the
 * notices are two renderers rather than one with a branch: this one can truthfully
 * say "nothing already done is lost" and that one cannot.
 */

/** Only the fields the clock reasons over, so a test need not build a whole config. */
export type TimeBudgetConfig = Pick<
  PipelineConfig,
  'agentTimeoutMs' | 'jobDeadlineMs' | 'teardownReserveMs' | 'wrapUpMs'
>

/**
 * Milliseconds until this job is killed by its own timeout, or `null` when there
 * is no job deadline to measure against.
 *
 * `null` rather than `Infinity`, so a caller has to decide what "no deadline"
 * means for it — and the two callers below decide differently: the stop lets the
 * run through, the per-turn bound falls back to the configured cap. A single
 * sentinel would have made those one answer by accident.
 *
 * Goes negative once the job is past its deadline, which is a real state: the
 * runner kills the process on its own schedule and nothing here is guaranteed to
 * be asked first.
 */
export const msToDeadline = (config: TimeBudgetConfig, nowMs: number): number | null =>
  config.jobDeadlineMs === null ? null : config.jobDeadlineMs - nowMs

/**
 * Whether there is time for another phase.
 *
 * One comparison, in one place, for the reason `withinBudget` is one — and the
 * boundary is exact in the same way. The teardown reserve is not time the pipeline
 * may spend and then apologise for; it is what pays for the comment, the state
 * block and the label that make a stop something other than a silence. So a phase
 * may start only with time left *over* the reserve, and "exactly the reserve" is
 * already too late: it would start the phase inside the slice that has to report
 * it stopping.
 *
 * A phase rather than a prompt, again mirroring the token ceiling: a phase is the
 * granularity at which stopping is safe, because between two phases the previous
 * one has posted and the state block on the issue is current.
 */
export const timeForAnotherPhase = (toDeadlineMs: number, config: TimeBudgetConfig): boolean =>
  toDeadlineMs > config.teardownReserveMs

/**
 * Whether there is time for another **plan step**, which is a stricter question.
 *
 * Between two steps is the best moment in this pipeline to stop: the previous step is
 * committed and pushed, the tree is clean, and the state block records the cursor —
 * so the run loses nothing at all, where the same clock reached *inside* a step costs
 * a salvage, a wrap-up window and a handoff nobody wanted to write. That is what
 * earns a fussier bound than {@link timeForAnotherPhase}.
 *
 * The threshold is not a new knob and deliberately not a guess: it is the exact point
 * where {@link turnTimeoutMs} runs out of room to express a positive work slice and
 * clamps to 1ms. Below it a step would consist entirely of being stopped — the turn
 * aborts immediately, the wrap-up has nothing to summarise, and the salvage stages a
 * tree no model touched — so the honest thing is not to start it. Above it the step
 * gets whatever the clock allows, and if that is not enough the stop *inside* the turn
 * is still there to keep what it wrote.
 *
 * Asked only where there are steps to be between. A plan with none is one
 * indivisible turn, and refusing to start it would cost the run everything the turn
 * would have written, where starting it and being interrupted salvages what it did —
 * see the walk in `phases/implement-steps.ts`.
 */
export const timeForAnotherStep = (toDeadlineMs: number, config: TimeBudgetConfig): boolean =>
  toDeadlineMs > config.teardownReserveMs + config.wrapUpMs

/**
 * The bound handed to one model turn: the per-turn cap, shrunk to fit what is left
 * of the job.
 *
 * This is the defect the finding calls D3, which was two numbers in two files kept
 * in step by hand: `AGENT_TIMEOUT_MS` defaulted to 30 minutes while the job's
 * ceiling was 90, so a turn opened at minute 75 was allowed to wait until minute
 * 105 — past a runner that dies at 90 posting nothing at all, which is the silence
 * the per-turn deadline exists to prevent. Taking the smaller of the two makes the
 * turn's bound fire *inside* the job, where the pipeline can still report it.
 *
 * A pure function rather than an inline `Math.min`, because of the floor. A
 * non-positive budget **disables** `withDeadline` — that is its documented
 * contract, for a caller with nothing to bound — so a job already inside its
 * reserve would compute `0` and hand the turn no bound whatsoever, the exact
 * opposite of what the shrinking is for. Clamped to 1ms instead: a turn that
 * cannot fit is refused at once, and a refusal is something the pipeline can post.
 *
 * **Two** slices come off, not one, and the second is what makes the stop worth
 * having: the wrap-up is a second prompt in the same session, so a turn allowed to
 * run right up to the teardown reserve leaves no room to ask it anything. A bound
 * that fired with the whole remaining budget already spent would abort, find
 * nothing left for the handoff, and salvage a tree with no account of it.
 *
 * With **no job deadline** neither slice applies and the configured cap stands
 * alone. There is no total to divide into three — `AGENT_TIMEOUT_MS` bounds one
 * turn by definition, not a run — so every `--event-path` run behaves exactly as it
 * did before either slice existed.
 */
export const turnTimeoutMs = (config: TimeBudgetConfig, nowMs: number): number => {
  const toDeadline = msToDeadline(config, nowMs)
  if (toDeadline === null) return config.agentTimeoutMs

  const forWork = toDeadline - config.teardownReserveMs - config.wrapUpMs
  return Math.max(1, Math.min(config.agentTimeoutMs, forWork))
}

/**
 * Stops a run that cannot afford the phase in front of it, or `null` when it may
 * carry on.
 *
 * Called before the handler and beside `stopIfOverBudget`, for the same reason and
 * with the same consequence: a ceiling exists to stop the next expensive thing,
 * and asking afterwards lets every phase overspend once.
 */
export const stopIfOutOfTime = (input: MachineInput): Promise<RunResult | null> => {
  const { state, deps } = input

  const toDeadline = msToDeadline(deps.config, deps.now())
  // Not `async`, unlike `stopIfOverBudget`: reading a clock costs nothing, so the
  // pass-through case has nothing to await and this stays one synchronous decision
  // in front of every phase.
  if (toDeadline === null || timeForAnotherPhase(toDeadline, deps.config)) return Promise.resolve(null)

  const reserve = deps.config.teardownReserveMs
  const reason = `Out of time for this job (${toDeadline}ms to its deadline, ${reserve}ms held back for the stop)`
  deps.log.warn({ issue: state.issueId, phase: state.phase, toDeadline, reserve }, 'Stopping: out of time for this job')

  return input.answer ? answerOutOfTime(input, toDeadline, reason) : parkOutOfTime(input, toDeadline, reason)
}

/**
 * Parks the issue in `INCOMPLETE`, with the phase it refused to start as
 * `resumeFrom`.
 *
 * Parking rather than stopping in place, for the reason `parkOverBudget` parks:
 * leaving the phase alone strands the issue in a handler phase no trigger
 * re-enters, reachable only by `/cancel`, under a notice inviting something that
 * cannot work. Where the two differ is *which* park, and that is not a detail — a
 * second kind of park in `FAILED` would need a field on the state to tell them
 * apart, consulted by every reader of `FAILED`, because the command that gets out
 * is not the same command.
 *
 * The run reports **`waiting`**, which is the second deliberate difference from
 * `parkOverBudget`'s `failed`. A token stop starts no work; this one finished some
 * and stopped in order to hand it over, so there is nothing for the Actions page to
 * go red about — and `waiting` exits 0. `reported` is `true` either way, so the
 * workflow's fallback comment stays out of scope on both.
 *
 * The spend is recorded through `recordSpend`, like every other state block this
 * pipeline writes. A stopping path that skipped it is the exact bug that rule
 * exists to prevent, and this is the worst place to be blind: `INCOMPLETE` is
 * precisely the state a `/continue` comes back out of, so a total with this job
 * missing from it is the total the *next* job hands to the token ceiling.
 * `attempts` needs no patch — `transition` carries it across `OUT_OF_TIME`, because
 * running out of time is not a failed attempt at anything.
 */
const parkOutOfTime = async (input: MachineInput, toDeadline: number, reason: string): Promise<RunResult> => {
  const { state, deps, thread } = input

  const parked = transition(state, 'OUT_OF_TIME', await recordSpend(input))
  await postAndAppend(thread, input, renderOutOfTime(toDeadline, deps.config.teardownReserveMs, state.phase), parked)

  return { status: 'waiting', reason, state: parked, reported: true }
}

/**
 * The same stop for a question, which parks nothing.
 *
 * Separate for the reasons `answerOverBudget` is separate. A question is a side
 * conversation about work that lives elsewhere: the phase records where the
 * **work** is, so `INCOMPLETE` would claim a delivered pull request was unfinished
 * because somebody asked what had changed. `resumeFrom` would then name the phase
 * the question was asked in — the waiting phases, which have no handler to resume
 * into — and in `COMPLETE` it would not even be reachable, since `OUT_OF_TIME` is
 * accepted only where a handler exists, so `transition` would throw out of the
 * pipeline and post nothing at all.
 *
 * `waiting` here too, and for the reason the park has it rather than by imitation:
 * the question was not asked, nothing broke, and the issue is waiting on the
 * maintainer to ask it again. It still records the spend, because the *classifier*
 * turn that routed a plain comment here may already have been paid for.
 */
const answerOutOfTime = async (input: MachineInput, toDeadline: number, reason: string): Promise<RunResult> => {
  const { state, deps, thread } = input
  const carried = { ...state, ...(await recordSpend(input)) }

  const notice = renderAnswerOutOfTime(toDeadline, deps.config.teardownReserveMs, state.phase)
  await postAnswer(thread, input, notice, carried)

  return { status: 'waiting', reason, state: carried, reported: true }
}
