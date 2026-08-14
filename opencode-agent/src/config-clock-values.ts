// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { IntRange } from './config-values.js'

/**
 * Every knob that describes **one job's wall clock**, and the ranges that refuse
 * the values which cannot work.
 *
 * Split out of `config-values.ts` when that file passed `max-lines`, and the seam
 * is the one the overflow pointed at rather than an arbitrary cut: these are the
 * only knobs whose values are *about each other*. A turn is handed
 * `min(DEFAULT_TURN_TIMEOUT_MS, timeLeft − RESERVE − WRAP_UP)` where `timeLeft`
 * comes from `EPOCH_MS_RANGE` and `JOB_MINUTES_RANGE`, so a change to any one of
 * them is a question about the other five — and the prose that answers it was
 * already most of the file. `time-budget.ts` does the arithmetic; this is the
 * vocabulary it does it in.
 *
 * `config-values.ts` re-exports all of it, so no caller names this module. That is
 * the same arrangement `check-spec.ts` has, and it is deliberate: the split is
 * about where the *reasoning* lives, not about giving callers a second import to
 * choose between.
 */

/**
 * One second to two hours. Under a second no real command completes.
 *
 * The ceiling used to be justified by the job's: "an Actions job is near its own
 * ceiling well before two hours of one subprocess" was true when that ceiling was
 * 90 minutes and is not true at 300. What holds it at two hours now is the other
 * end of the knob's purpose — this is the bound a turn that will *never* answer is
 * caught by, and one large enough never to interrupt real work no longer catches
 * anything. A run that wants longer than this out of a single uninterrupted turn
 * wants a plan with steps in it instead.
 */
export const TIMEOUT_RANGE: IntRange = { min: 1_000, max: 7_200_000 }

/**
 * Ninety minutes for one model turn, and for each subprocess.
 *
 * A constant beside its range rather than a literal at the call site, because the
 * two only mean anything together — this has to be a value the range would accept
 * as an override, and the pair drifting apart is the class of bug the "default
 * would itself be accepted" test exists to catch.
 *
 * Half an hour before, which outlived the defect that chose it. The turn cap and
 * the job ceiling used to be two hand-kept numbers, and 30-against-90 was the
 * safe side of that; once `turnTimeoutMs` started deriving the turn's bound from
 * the job's own clock, the danger was gone and only the smallness was left. What
 * that cost was measurable: with the ceiling at 90 this was the *only* bound long
 * runs ever reached, and three consecutive live runs ended at the same 33 minutes
 * of wall clock — each one a single turn aborted at its cap, wrapped up and
 * parked, with an hour of paid-for runner unspent. Raising it cannot bring the
 * old defect back, because a turn is handed the **smaller** of this and what is
 * left of the job: one opened late still shrinks to fit the runner it will die
 * with, whatever this says.
 *
 * An hour after that, and ninety minutes now, because the ceiling it sits under
 * moved to 300 and this became the binding bound again — the same smallness, one
 * scale up. `min(this, time left − reserve − wrap-up)` picks *this* for the first
 * four hours of every job, so a phase that is one indivisible turn (a plan with no
 * steps; `REVIEW_AND_MUTATE`) would abort at the cap and park with most of the
 * runner unspent. Ninety leaves the job's own clock as the bound long runs
 * actually reach, which is the one that can stop, salvage and post.
 *
 * Not raised further, because this is also what a genuinely hung turn is measured
 * against: past a certain point a cap large enough never to interrupt real work is
 * a cap that no longer detects a turn that will never answer.
 */
export const DEFAULT_TURN_TIMEOUT_MS = 5_400_000

/**
 * Four hours for the whole review loop, and one minute to one day for the range.
 *
 * A separate knob from {@link DEFAULT_TURN_TIMEOUT_MS} because it answers a
 * different question. That one is the cap on a single uninterrupted model turn,
 * and its size is bounded from *above* by its second job — past a point, a cap
 * large enough never to interrupt real work no longer detects a turn that will
 * never answer. The review loop has no such second job: it is a phase made of
 * dozens of separately-bounded subprocesses, each already caught by its own
 * `agentTimeoutMs`, so the only thing this has to be is large enough not to cut
 * an honest run in half.
 *
 * Four hours is under the five the workflow's own `timeout-minutes` allows, so on
 * a runner the job's clock — not this — is what a long review actually reaches,
 * and `reviewBudget` shrinks the loop to fit whatever is left of it. It matters
 * on its own only for a run with no job deadline at all, which is every local
 * `--event-path` invocation.
 *
 * The range's floor is a minute, below which the loop cannot finish opening a
 * worktree, let alone review anything. Its ceiling is a day, matching
 * {@link JOB_MINUTES_RANGE}: a value beyond the job it runs inside cannot bound
 * anything, and one beyond a day is not a bound anybody meant to set.
 */
export const DEFAULT_REVIEW_TIMEOUT_MS = 14_400_000

export const REVIEW_TIMEOUT_RANGE: IntRange = { min: 60_000, max: 86_400_000 }

/**
 * When the job began, as epoch milliseconds, from the runner rather than from an
 * operator.
 *
 * Both ends are about a value that parses and cannot work, and here the failure is
 * total in one direction: a start time in the past — `0`, a seconds-rather-than-
 * milliseconds value, a truncated digit — puts the derived deadline permanently
 * behind the clock, so **every** run stops before it starts, reporting a ceiling
 * nobody set. The floor is 2020, comfortably before this pipeline existed and
 * comfortably after any plausible unit mix-up (`1e9` seconds reads as 1970 in
 * milliseconds). The ceiling is 2096, which catches the extra digit that would
 * otherwise disable the bound by putting the deadline beyond any job's life.
 */
export const EPOCH_MS_RANGE: IntRange = { min: 1_577_836_800_000, max: 4_000_000_000_000 }

/**
 * The job's own ceiling, in minutes, mirroring the workflow's `timeout-minutes`.
 *
 * A minute is the shortest job worth deriving a deadline from — below the
 * teardown reserve, every run parks immediately. The ceiling is a day: comfortably
 * past the six hours a *hosted* job may run, and short of the five days a
 * self-hosted runner may, which is deliberate — a self-hosted job wanting longer
 * than a day is better served raising this with a reason than having the range
 * pre-agree to it. Minutes rather than milliseconds because it is the unit
 * `timeout-minutes:` takes, and the whole point of this knob is that one value
 * feeds both.
 *
 * Note what this range does *not* police: a value over 360 on a hosted runner is
 * accepted here and ignored by GitHub, which kills the job at 360 regardless. The
 * range cannot tell the two runner kinds apart, so the workflow's own fallback is
 * where that ceiling is respected.
 */
export const JOB_MINUTES_RANGE: IntRange = { min: 1, max: 1_440 }

/**
 * The slice of the job held back so a stop can post a comment, write the state
 * block and reconcile a label.
 *
 * The observed tail for all of that is about ten seconds, so the floor is a
 * second — below which the reserve buys nothing and the stop is killed doing the
 * one thing it exists to do. The ceiling is half an hour: a reserve larger than
 * the job it is carved out of stops every run before any phase begins, which is
 * the same "a number that cannot work" failure read from the other end.
 */
export const RESERVE_RANGE: IntRange = { min: 1_000, max: 1_800_000 }

/**
 * The model's own slice of the stop: one short prompt to finish the file it is
 * part-way through and say what it tried.
 *
 * Five seconds is the floor because anything under it is a window that can only
 * ever expire, buying a second abort and no handoff. Fifteen minutes is the
 * ceiling, and it is the end that matters: this slice is taken off the *work*, so
 * a large value is a job that spends its afternoon tidying — and the wrap-up has
 * one paragraph to write, not a file to refactor.
 */
export const WRAP_UP_RANGE: IntRange = { min: 5_000, max: 900_000 }
