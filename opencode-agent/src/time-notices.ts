// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { StagedTotals } from './diff-guard.js'
import { outcomeHeading } from './outcomes.js'
import type { StepMarker } from './plan-steps.js'
import type { ProgressSnapshot } from './progress.js'
import type { Phase } from './types.js'

/**
 * What a run says when the **job's own wall clock** stopped it.
 *
 * Split from `budget-notices.ts` when a third of these would not fit beside the
 * others — which is the same reason that file was split out of `run-report.ts`, and
 * the seam is the same shape: a token ceiling, a retry ceiling and a review ceiling
 * are all counters an operator raises, while these three are about a clock nobody
 * set and a job that has to hand over mid-flight. They move for different reasons.
 *
 * The rule they inherit is `budget-notices.ts`'s and is the one to keep: a notice
 * about a ceiling is read by somebody deciding what to do next, so it may only offer
 * a remedy that works. And none of them writes a heading of its own — the outcome
 * table owns the glyphs, and `markdown.test.ts` asserts that over this file too.
 */

/** Both wall-clock notices open on the same fact, so they state it identically. */
const timeLine = (remainingMs: number, reserveMs: number): string =>
  `This job is ${minutes(remainingMs)} from its own \`timeout-minutes\` ceiling, and holds ${minutes(reserveMs)} ` +
  'back so a stop can post what it knows and record what it spent.'

/**
 * A duration a maintainer can act on. Minutes, because that is the unit the job's
 * ceiling and the reserve are both set in — "180000 ms" is the same fact in a
 * shape nobody reads. Clamped at zero: a job already past its deadline has no
 * negative time left, it has none.
 */
const minutes = (ms: number): string => `${(Math.max(0, ms) / 60_000).toFixed(1)} minutes`

/**
 * The wall-clock notice, naming the phase the stop parked in front of.
 *
 * The one in this file whose remedy is **two independent things**, and stating
 * only one of them would be the trap this module exists to avoid. `/continue`
 * works on its own, because a fresh job starts with a fresh clock and picks up
 * from `resumeFrom` — which is what makes this different from
 * {@link renderOverBudget}, where a `/retry` under the same ceiling stops right
 * back where it was. Raising `AGENT_JOB_TIMEOUT_MINUTES` is the other half, and
 * the one that matters when a phase cannot fit in a job at all; the variable is a
 * repository variable rather than a workflow value because the workflow reads it
 * for its own `timeout-minutes:` too, where a workflow-level `env` is not
 * available.
 *
 * "Nothing already done is lost" is true of this stop and is not a figure of
 * speech: the check sits *before* the handler, so the phase it names never
 * started. A turn interrupted part-way through is a different stop and is not
 * this comment.
 */
export const renderOutOfTime = (remainingMs: number, reserveMs: number, resumeFrom: Phase): string =>
  [
    outcomeHeading('TIME_SPENT', 'Out of time for this job'),
    '',
    timeLine(remainingMs, reserveMs),
    '',
    `So I stopped before starting \`${resumeFrom}\` rather than being killed part-way through it, and parked in ` +
      '`INCOMPLETE`. Nothing already done is lost — that phase never started.',
    `Reply \`/continue\` and I pick \`${resumeFrom}\` back up on a fresh job with a full clock. If it keeps ` +
      'stopping here, raise the `AGENT_JOB_TIMEOUT_MINUTES` repository variable — the workflow reads it for both ' +
      "the job's own `timeout-minutes:` and this bound — or reply `/cancel` to stop.",
  ].join('\n')

/** What the run has to say when the clock ran out **inside** a turn. */
export interface PartWayStop {
  remainingMs: number
  reserveMs: number
  /** What the turn had done when it was stopped; `null` if nothing measured it. */
  progress: ProgressSnapshot | null
  branch: string
  resumeFrom: Phase
  /** What the branch now carries, or `null` when nothing was pushed. */
  kept: StagedTotals | null
  /**
   * The one sentence beside the figure: **why** nothing was pushed when `kept` is
   * `null`, and which ceiling the commit was over when it is not.
   *
   * One field rather than two, because `kept` already discriminates them and two
   * would let a comment carry both a reason for pushing nothing and a report about
   * what it pushed.
   */
  note: string | null
  handoff: string | null
  /**
   * The plan step the turn was cut off on, or `null` for a plan with no steps.
   *
   * Stated because with one turn per step "part-way through the work" is no longer
   * specific enough to act on: the earlier steps are finished commits on the branch,
   * and the handoff below is an account of this step alone.
   */
  step: StepMarker | null
}

/**
 * The wall-clock stop reached from **inside** a turn, which is the finding itself.
 *
 * A separate renderer from {@link renderOutOfTime} rather than a branch in it,
 * because the two make opposite claims about the same word. That one can say
 * "nothing already done is lost" and mean it — the check sits in front of a handler,
 * so the phase it names never started. This one is the case where the phase *did*
 * start, a turn was cut off part-way through, and what survived is a question with a
 * real answer that is sometimes "nothing". A shared renderer would have to hedge
 * both, and a comment about a ceiling may only say things that are true.
 *
 * Three things it must state and one it must never. It states what the turn had
 * **done**, because "the model did not answer within 1800000ms" about a turn that
 * answered 355 times is the diagnostic cost this whole item was filed over. It
 * states what the branch now **carries**, with the figure, so the claim can be
 * judged rather than trusted. It carries the **handoff** where a human reads it, the
 * same text the hidden block hands the next prompt. And it must never imply work
 * survived when it did not: every degradation of the salvage lands in the `kept ===
 * null` branch, which says so in its first three words.
 */
export const renderStoppedPartWay = (stop: PartWayStop): string =>
  [
    outcomeHeading('TIME_SPENT_PART_WAY', 'Out of time part-way through the work'),
    '',
    timeLine(stop.remainingMs, stop.reserveMs),
    '',
    ...workedLine(stop.progress),
    ...stepLine(stop.step),
    keptLine(stop),
    '',
    ...handoffSection(stop.handoff),
    '',
    `Reply \`/continue\` and I pick \`${stop.resumeFrom}\` back up on a fresh job with a full clock, on top of ` +
      'whatever is on the branch. If it keeps stopping here, raise the `AGENT_JOB_TIMEOUT_MINUTES` repository ' +
      "variable — the workflow reads it for both the job's own `timeout-minutes:` and this bound — or reply " +
      '`/cancel` to stop.',
  ].join('\n')

/**
 * What the turn managed, from the heartbeat's own running totals.
 *
 * Rendered as nothing at all when there is no snapshot, rather than as zeroes: a
 * stop that could not measure the turn and a turn that did nothing are different
 * facts, and only one of them is worth printing.
 */
const workedLine = (progress: ProgressSnapshot | null): readonly string[] =>
  progress === null
    ? ['I stopped the turn part-way through rather than let the runner kill the job with nothing on the issue.', '']
    : [
        `The turn was still working when the clock ran out — ${progress.toolCalls} tool calls, ` +
          `${progress.tokens.toLocaleString('en-US')} tokens, last action “${progress.lastAction}” — so I stopped ` +
          'it rather than let the runner kill the job with nothing on the issue.',
        '',
      ]

/**
 * Which step it was on, and nothing at all when the plan has no steps.
 *
 * The earlier steps are already commits on this branch, so this sentence is what
 * separates "the plan is two fifths done and step 3 was interrupted" from "something
 * happened somewhere in the plan", which is what this notice said before the work was
 * walked a step at a time.
 */
const stepLine = (step: StepMarker | null): readonly string[] =>
  step === null
    ? []
    : [
        `It was on **step ${step.number} of ${step.total}** — “${step.title}” — so everything before it is a ` +
          'finished commit on the branch and only this one was cut off.',
        '',
      ]

const keptLine = (stop: PartWayStop): string => {
  if (stop.kept === null) return `**Nothing was pushed**, and here is why: ${stop.note ?? 'the salvage found nothing'}.`

  const size = `${stop.kept.files} files, ${stop.kept.lines.toLocaleString('en-US')} lines`
  const kept = `**Kept**: ${size}, committed and pushed to \`${stop.branch}\`.`
  return stop.note === null ? kept : `${kept} It is larger than this pipeline normally commits (${stop.note}).`
}

/**
 * The interrupted run's own account, verbatim.
 *
 * Said plainly when there is none, because a wrap-up window that expired and a
 * model that finished with nothing to say are indistinguishable from here — and an
 * empty heading reads as the second.
 */
const handoffSection = (handoff: string | null): readonly string[] =>
  handoff === null
    ? ['I got no account of where it stopped out of the model, so the branch and the plan are all a continuation has.']
    : ['#### Where it stopped', '', handoff]

/** What the run has to say when the clock ran out **between** two plan steps. */
export interface BetweenStepsStop {
  remainingMs: number
  reserveMs: number
  branch: string
  resumeFrom: Phase
  /** Steps of the plan finished, and how many it has. */
  done: number
  total: number
  /** Lines this run's finished steps committed; `0` when it stopped before the first. */
  lines: number
  /** The step it stopped in front of, which is where a `/continue` picks up. */
  next: string
}

/**
 * The third wall-clock notice, and the one stage 3 exists to make the ordinary one.
 *
 * The other two are the interesting cases: a phase refused before it started, and a
 * turn cut off mid-file. This is the boring one, which is the achievement — the clock
 * ran out at a plan-step boundary, where every finished step is a commit that has
 * already been pushed and the tree is clean. So it is the only one of the three that
 * can say **both** halves at once: work was done *and* nothing was lost. `renderOutOfTime`
 * can claim the second because nothing was done, and `renderStoppedPartWay` can never
 * claim it at all.
 *
 * A separate renderer rather than a branch in either, for the reason those two are
 * separate: a comment about a ceiling may only say things that are true, and a shared
 * renderer would have to hedge "that phase never started" against "two of five steps
 * are on the branch". It states the count, the size and the next step by name so the
 * claim can be judged rather than trusted, exactly as the part-way notice states what
 * the branch carries.
 */
export const renderStoppedBetweenSteps = (stop: BetweenStepsStop): string =>
  [
    outcomeHeading('TIME_SPENT_BETWEEN_STEPS', 'Out of time between plan steps'),
    '',
    timeLine(stop.remainingMs, stop.reserveMs),
    '',
    doneLine(stop),
    `So I stopped rather than start step ${stop.done + 1}, “${stop.next}”, with too little of the clock left to ` +
      'finish it. **Nothing is lost** — a step boundary is where this work is designed to be interrupted: the tree ' +
      'is clean, the branch has every finished step, and the state block remembers which one is next.',
    '',
    `Reply \`/continue\` and I pick \`${stop.resumeFrom}\` back up on a fresh job with a full clock, starting at ` +
      `step ${stop.done + 1}. If it keeps stopping here, raise the \`AGENT_JOB_TIMEOUT_MINUTES\` repository ` +
      "variable — the workflow reads it for both the job's own `timeout-minutes:` and this bound — or reply " +
      '`/cancel` to stop.',
  ].join('\n')

/**
 * How much of the plan is done, and what **this job** contributed to it.
 *
 * Two facts rather than one, because they come apart in both directions and a comment
 * about a ceiling may only say things that are true. A continuation refused at its
 * very first step has steps done and committed nothing — reporting "2 of 5 done, 0
 * lines" would credit this job with work an earlier one pushed — and a first job
 * refused before step 1 has neither, which is still the cheapest possible stop rather
 * than a failure.
 */
const doneLine = (stop: BetweenStepsStop): string =>
  `**${stop.done} of ${stop.total}** steps of the plan are done.` +
  (stop.lines === 0
    ? ' This job did not have the clock left to start the next one.'
    : ` This job committed ${stop.lines.toLocaleString('en-US')} lines of that and pushed each step to ` +
      `\`${stop.branch}\` as it finished.`)

/**
 * The same ceiling, reported for a question rather than for the work.
 *
 * Separate from {@link renderOutOfTime} for the reason
 * {@link renderAnswerOverBudget} is separate: nothing was parked and nothing
 * moved, so promising a `/continue` that resumes a phase would describe a state
 * block that does not exist. What is true is narrower — the question was not put
 * to the model, and asking it again on the next job is the whole remedy.
 */
export const renderAnswerOutOfTime = (remainingMs: number, reserveMs: number, phase: Phase): string =>
  [
    outcomeHeading('ANSWER_TIME_SPENT', 'Out of time for this job'),
    '',
    `${timeLine(remainingMs, reserveMs)} I did not put that question to the model.`,
    '',
    `Nothing has changed: this issue is still in \`${phase}\`. Ask again — the next job starts with a full clock ` +
      '— or raise `AGENT_JOB_TIMEOUT_MINUTES` if the runs keep landing here.',
  ].join('\n')
