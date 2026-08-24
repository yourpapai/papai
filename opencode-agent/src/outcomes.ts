// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { PRESENTATION } from './presentation.js'

/**
 * The pipeline's **second** vocabulary: what just happened to this run.
 *
 * Split from `presentation.ts` along the line that file had already drawn in
 * words — "deliberately not the table above, and not folded into it" — when the
 * wall-clock stop brought the outcome table to ten rows and pushed the file past
 * `max-lines`. The two answer different questions and one of them is keyed on a
 * phase; keeping them in one file was never what made a renderer unable to invent
 * a glyph. That property belongs to there being *one* table per vocabulary, and it
 * still holds: `outcomeHeading` below is the only way a comment about an outcome
 * gets a first line.
 *
 * The arrow points one way, into `presentation.ts`, and only for `CI_GAVE_UP` —
 * which reuses `CI_FIX`'s own glyph on purpose.
 */

/**
 * Every outcome a comment can announce, as a closed union.
 *
 * Deliberately not the phase table, and not folded into it. That one is keyed on a
 * *phase* — where the issue is — while "the retry budget is spent", "I could not
 * answer that" and "that command does not apply here" are keyed on an outcome, and
 * every one of them can happen in several phases and leave the phase exactly where
 * it was. Forcing them through a phase key would either invent phases that do not
 * exist or make one row mean two things, the failure the phase table itself avoids.
 *
 * Two renderers are deliberately **absent** and read the phase table instead:
 * `renderClosing`'s delivered and cancelled headings are `COMPLETE:delivered` and
 * `COMPLETE:cancelled` — the same two states the label reconciler is naming on the
 * same comment, so a second copy of ✅ and 🛑 here could only ever drift away from
 * the label sitting beside them.
 */
export const OUTCOME_KEYS = [
  'RUN_FAILED',
  'ANSWER_FAILED',
  'RETRIES_SPENT',
  'TOKENS_SPENT',
  'ANSWER_TOKENS_SPENT',
  'TIME_SPENT',
  'TIME_SPENT_PART_WAY',
  'TIME_SPENT_BETWEEN_STEPS',
  'ANSWER_TIME_SPENT',
  'CI_GAVE_UP',
  'CI_SPENT',
  'REVIEWS_SPENT',
  'COMMAND_REFUSED',
] as const

export type OutcomeKey = (typeof OUTCOME_KEYS)[number]

/**
 * A `Record` over the closed union, for the reason `PRESENTATION` is one.
 *
 * The distinctions here are the point, not the glyphs:
 *
 * - ❌ means the work **broke**. ⛔ means a **bound was reached** and nothing
 *   broke at all — which is the whole argument for the budget notices being
 *   separate renderers in the first place, and it would be undone by giving a
 *   spent ceiling the same glyph as a crash. `TIME_SPENT` joins that family, and is
 *   why it is worth stating twice: a wall-clock stop used to arrive as ❌ "the model
 *   did not answer within 1800000ms", about a turn that had answered 355 times.
 *   `TIME_SPENT_PART_WAY` is that same stop reached from *inside* a turn rather than
 *   in front of one — it is a separate key because the two comments make opposite
 *   claims about what survived, and a shared one would have to hedge both.
 *   `TIME_SPENT_BETWEEN_STEPS` is the third of them and is the one stage 3 exists to
 *   make ordinary: the clock reached at a plan-step boundary, where the tree is
 *   committed, pushed and clean. It is not folded into `TIME_SPENT` even though both
 *   stop in front of work and both lose nothing, because a maintainer reading one of
 *   them is told a phase never started and reading the other is told two thirds of a
 *   plan is on the branch — and it is not folded into `TIME_SPENT_PART_WAY`, whose
 *   whole subject is what a stopped turn had half-written.
 * - ⚠️ is a failed *answer*: the model turn broke but nothing moved, no attempt
 *   was spent and the issue is exactly where it was. ❌ there would tell a
 *   maintainer their delivered pull request had failed.
 * - `CI_GAVE_UP` takes `CI_FIX`'s own glyph *from the phase table*, rather than a
 *   copy of it: this is that story ending, and the maintainer has been watching
 *   🚑 on the issue for however many rounds it took to give up.
 * - 😕 matches the reaction `refuseCommand` places on the very same comment, so
 *   the emoji on the maintainer's comment and the heading of the reply agree.
 */
export const OUTCOME_GLYPHS: Record<OutcomeKey, string> = {
  RUN_FAILED: '❌',
  ANSWER_FAILED: '⚠️',
  RETRIES_SPENT: '⛔',
  TOKENS_SPENT: '⛔',
  ANSWER_TOKENS_SPENT: '⛔',
  TIME_SPENT: '⛔',
  TIME_SPENT_PART_WAY: '⛔',
  TIME_SPENT_BETWEEN_STEPS: '⛔',
  ANSWER_TIME_SPENT: '⛔',
  CI_GAVE_UP: PRESENTATION.CI_FIX.glyph,
  CI_SPENT: '⛔',
  REVIEWS_SPENT: '⛔',
  COMMAND_REFUSED: '😕',
}

/**
 * The heading of a comment, glyph included.
 *
 * Every renderer builds its first line through this or through `phaseHeading` in
 * `presentation.ts`, so writing a glyph inline is not something a new one falls into
 * by accident — it has to go out of its way, past a function that is already
 * imported, to invent a vocabulary of its own.
 */
export const outcomeHeading = (key: OutcomeKey, text: string): string => `### ${OUTCOME_GLYPHS[key]} ${text}`
