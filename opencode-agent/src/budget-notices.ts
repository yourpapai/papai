// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { outcomeHeading } from './outcomes.js'
import type { Phase } from './types.js'

/**
 * What a **bound reached** says on the issue, as opposed to what a failure says.
 *
 * Split out of `run-report.ts` when a fourth one would not fit beside the
 * others, and along a seam `presentation.ts` had already named: ❌ means the work
 * broke, ⛔ means nothing broke at all and a ceiling stopped the run. That is the
 * whole argument for these being separate renderers rather than one parametrised
 * failure comment, and it is the same argument for them being a module.
 *
 * Every one of them is written against the same trap. A notice about a ceiling
 * is read by somebody deciding what to do next, so it may only offer a remedy
 * that works: `renderOverBudget` used to invite a `/retry` the pipeline then
 * refused, and `renderExhausted` used to invite one the budget it was announcing
 * had just made impossible. Each now names the variable to raise, and the
 * command that works once it has been.
 *
 * These carry no heading of their own — `outcomeHeading` and the outcome table in
 * `outcomes.ts` own the glyphs — and `tests/opencode-agent/markdown.test.ts` asserts
 * that for this file as well as for `run-report.ts`, because a rule enforced only on
 * the file the renderers used to live in stops being a rule the moment they move.
 */

/**
 * The retry-budget notice.
 *
 * It used to end "Fix the underlying problem, then reply `/retry`", advice the
 * pipeline itself made impossible to follow: the budget is spent, so that
 * `/retry` is refused and lands straight back on this comment. What is true is
 * that the failure stays parked with its resume point intact, so raising the
 * ceiling makes the very same `/retry` work — and that is what the notice
 * offers, the way {@link renderOverBudget} names `AGENT_MAX_TOKENS` instead of
 * inviting a retry that cannot help either.
 */
export const renderExhausted = (reason: string): string =>
  [
    outcomeHeading('RETRIES_SPENT', 'Giving up'),
    '',
    reason,
    '',
    'The failure is still parked with its resume point, so raising `AGENT_MAX_ATTEMPTS` in the workflow and ' +
      'replying `/retry` picks it up from exactly where it broke.',
    'Otherwise take it from here yourself, or reply `/cancel` to stop.',
  ].join('\n')

/**
 * The CI-fix equivalent, and the one that matters more.
 *
 * A red check arrives asynchronously with nobody watching the Actions log, so a
 * silent give-up looks exactly like an agent still working on it. Posted once —
 * `ciBudgetReported` stops every later red run repeating it.
 */
export const renderCiExhausted = (reason: string, prUrl: string | null): string =>
  [
    outcomeHeading('CI_GAVE_UP', 'I have stopped trying to fix CI'),
    '',
    reason,
    '',
    prUrl === null ? 'The pull request is still open.' : `The pull request is still open: ${prUrl}`,
    'Its checks are red and I will not attempt another fix — take a look, or push a fix yourself.',
  ].join('\n')

/**
 * The review-budget notice, and the reason it is not {@link renderExhausted}.
 *
 * That one offers `/retry`, which resumes a parked failure. Nothing is parked
 * here: the issue is `COMPLETE` with its pull request open and its branch
 * pushed, and `/retry` in `COMPLETE` is refused outright. The one thing that
 * makes another review possible is a bigger `AGENT_MAX_REVIEW_ATTEMPTS`, and
 * naming the wrong variable sends a maintainer to raise a bound that was never
 * the one that stopped them.
 *
 * Not repeat-guarded the way {@link renderCiExhausted} is, and it needs no flag:
 * this notice answers a command somebody typed, so it repeats exactly as often
 * as a maintainer asks — which is the acknowledgement, not spam.
 */
export const renderReviewsExhausted = (reason: string, prUrl: string | null): string =>
  [
    outcomeHeading('REVIEWS_SPENT', 'I have stopped reviewing this pull request'),
    '',
    reason,
    '',
    prUrl === null ? 'The pull request is still open.' : `The pull request is still open: ${prUrl}`,
    'The review loop spawns its own model runs, which the token budget cannot see, so this is the bound that ' +
      'stops it. Raise `AGENT_MAX_REVIEW_ATTEMPTS` in the workflow and reply `/review` again, or review it ' +
      'yourself from here.',
  ].join('\n')

/** Both token-budget notices open on the same fact, so they state it identically. */
const tokenLine = (spent: number, limit: number): string =>
  `This issue has used ${spent.toLocaleString('en-US')} model tokens of the ${limit.toLocaleString('en-US')} it is allowed.`

/**
 * The token-budget notice, naming the phase the stop parked in.
 *
 * Every claim here has to survive the state block posted beside it, and this
 * one did not. It read "raise `AGENT_MAX_TOKENS` in the workflow to continue"
 * while the stop left the issue in the handler phase a trigger had just moved
 * it into — a phase no event re-enters at any ceiling, so the advice led
 * nowhere and `/cancel` was the only thing that still worked. Its other line,
 * "so `/retry` will stop here again", was misleading in a second way: `/retry`
 * was not being refused over tokens at all, it was refused because the phase
 * was not `FAILED`.
 *
 * Now the stop parks in `FAILED` with a resume point, so the two commands the
 * notice names really do compose: raise the ceiling, reply `/retry`, and
 * `resumeFrom` runs. Naming the phase is not decoration — it tells a maintainer
 * deciding whether to bother that the branch is already pushed and only
 * delivery is left, or that nothing has been written yet.
 *
 * Still distinct from {@link renderExhausted}, which offers the same `/retry`
 * against the other ceiling: getting the variable name wrong sends someone to
 * raise a bound that was never the one that stopped them.
 */
export const renderOverBudget = (spent: number, limit: number, resumeFrom: Phase): string =>
  [
    outcomeHeading('TOKENS_SPENT', 'Token budget spent'),
    '',
    tokenLine(spent, limit),
    '',
    `I have parked this in \`FAILED\`, resuming from \`${resumeFrom}\`, so nothing already done is lost.`,
    'The count carries across every job this issue has run, so a `/retry` on the same ceiling stops right back ' +
      `here. Raise \`AGENT_MAX_TOKENS\` in the workflow **first**, then reply \`/retry\` and I pick \`${resumeFrom}\` ` +
      'back up.',
    'Otherwise open a fresh issue for the remaining work, or reply `/cancel` to stop.',
  ].join('\n')

/**
 * The same budget, reported for a question rather than for the work.
 *
 * Separate from {@link renderOverBudget} for the reason `renderAnswerFailure` is
 * separate from `renderFailure`: nothing was parked and nothing moved, so
 * promising a `/retry` that resumes a phase would describe a state block that
 * does not exist. What is true is narrower — the question was not put to the
 * model, and asking it again under a bigger ceiling is the whole remedy.
 */
export const renderAnswerOverBudget = (spent: number, limit: number, phase: Phase): string =>
  [
    outcomeHeading('ANSWER_TOKENS_SPENT', 'Token budget spent'),
    '',
    `${tokenLine(spent, limit)} I did not put that question to the model.`,
    '',
    `Nothing has changed: this issue is still in \`${phase}\`. Raise \`AGENT_MAX_TOKENS\` in the workflow and ask ` +
      'again.',
  ].join('\n')

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
