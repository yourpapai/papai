// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { StagedTotals } from './diff-guard.js'
import { outcomeHeading } from './outcomes.js'
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
