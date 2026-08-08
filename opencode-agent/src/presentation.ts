// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { AgentState } from './types.js'

/**
 * How the pipeline presents itself: one glyph, one label, one headline and one
 * statement of whose turn it is, per state a maintainer can find an issue in.
 *
 * One table, because the recurring defect in this workspace is a fix that closes
 * an instance and leaves the class open, and a phase→glyph mapping written out
 * by hand in each of nine renderers is that defect waiting to happen. Everything
 * that speaks about a phase — the label reconciler, the waiting comment, and the
 * status comment when it lands — reads from here, so a phase added to `PHASES`
 * later fails to compile until it has been given a row.
 *
 * The glyph is decoration and never the only carrier of meaning: the headline
 * sits beside it in every rendering and the label is plain text, so a screen
 * reader that announces "clipboard, design spec is waiting for you" loses
 * nothing by dropping the first word.
 */

/**
 * Who the issue is waiting on.
 *
 * `nobody` is not "no answer": a delivered or cancelled issue is finished, and
 * saying so is what keeps it out of the `needs-you` filter.
 */
export type WhoseTurn = 'agent' | 'you' | 'nobody'

/**
 * Whether the agent is working on this state or has handed it back.
 *
 * The second half of the key, and it exists because `INIT_OR_CLARIFY` is both a
 * working state and a waiting state — it is where the agent sits after asking
 * clarifying questions. Keying on the phase alone would force every reader to
 * re-derive that distinction, which is the class of bug this table exists to
 * prevent, so it goes in the key instead.
 */
export type RunStance = 'working' | 'waiting'

/**
 * A label this pipeline owns, named by its suffix.
 *
 * The suffix rather than the whole name, because `AGENT_LABEL_PREFIX` is
 * configurable: this pipeline runs in repositories with their own label
 * conventions, so a row cannot own the part of the name the operator chooses.
 * `labels.ts` qualifies these; nothing here knows the prefix.
 */
export interface LabelSpec {
  suffix: string
  /** Six hex digits, no `#` — the shape GitHub's label API takes. */
  color: string
}

export interface PhasePresentation {
  glyph: string
  label: LabelSpec
  whoseTurn: WhoseTurn
  headline: string
}

/** Blue for the states the agent owns, amber for the ones waiting on a human. */
const BLUE = '1d76db'
const AMBER = 'd4a72c'
const GREEN = '0e8a16'
const RED = 'd73a4a'
const GREY = '6a737d'

/**
 * The two orthogonal markers, and the part worth shipping even if the per-phase
 * labels were dropped.
 *
 * They answer the two questions a list view is actually asked — "is something
 * happening right now" and "which of my issues are blocked on me" — neither of
 * which a per-phase label answers without the reader knowing the state machine.
 */
export const WORKING_LABEL: LabelSpec = { suffix: 'working', color: BLUE }
export const NEEDS_YOU_LABEL: LabelSpec = { suffix: 'needs-you', color: AMBER }

/**
 * Every row of the table, as a closed union.
 *
 * Two phases carry a suffix because two phases are genuinely two states:
 * `INIT_OR_CLARIFY` splits on whether the agent is reading the issue or waiting
 * on the answers it asked for, and `COMPLETE` splits on `state.prUrl` exactly as
 * `renderClosing` already does — a delivered issue and a cancelled one are not
 * the same outcome and must not carry the same label.
 */
export const PRESENTATION_KEYS = [
  'INIT_OR_CLARIFY:working',
  'INIT_OR_CLARIFY:waiting',
  'DESIGN_SPEC',
  'EXECUTION_PLAN',
  'PLAN_REVIEW',
  'REVIEW_AND_MUTATE',
  'PR_DELIVERY',
  'CODE_REVIEW',
  'CI_FIX',
  'COMPLETE:delivered',
  'COMPLETE:cancelled',
  'FAILED',
] as const

export type PresentationKey = (typeof PRESENTATION_KEYS)[number]

/** A `Record` over the closed union, so a row that is missing cannot compile. */
export const PRESENTATION: Record<PresentationKey, PhasePresentation> = {
  'INIT_OR_CLARIFY:working': {
    glyph: '🔍',
    label: { suffix: 'triaging', color: BLUE },
    whoseTurn: 'agent',
    headline: 'Reading the issue',
  },
  'INIT_OR_CLARIFY:waiting': {
    glyph: '❓',
    label: { suffix: 'clarifying', color: AMBER },
    whoseTurn: 'you',
    headline: 'Waiting on your answers',
  },
  DESIGN_SPEC: {
    glyph: '📋',
    label: { suffix: 'spec-review', color: AMBER },
    whoseTurn: 'you',
    headline: 'Design spec is waiting for you',
  },
  EXECUTION_PLAN: {
    glyph: '🗺️',
    label: { suffix: 'planning', color: BLUE },
    whoseTurn: 'agent',
    headline: 'Breaking the spec into steps',
  },
  PLAN_REVIEW: {
    glyph: '🧭',
    label: { suffix: 'plan-review', color: AMBER },
    whoseTurn: 'you',
    headline: 'Plan is waiting for you',
  },
  REVIEW_AND_MUTATE: {
    glyph: '🛠️',
    label: { suffix: 'implementing', color: BLUE },
    whoseTurn: 'agent',
    headline: 'Writing and reviewing the code',
  },
  PR_DELIVERY: {
    glyph: '📦',
    label: { suffix: 'delivering', color: BLUE },
    whoseTurn: 'agent',
    headline: 'Opening the pull request',
  },
  // The agent's turn, not the maintainer's, although a maintainer's `/review`
  // is what starts it: the command and the handler are one job, so the issue is
  // held throughout and `needs-you` would be wrong for the whole of it.
  CODE_REVIEW: {
    glyph: '🔬',
    label: { suffix: 'reviewing', color: BLUE },
    whoseTurn: 'agent',
    headline: 'Reviewing the pull request',
  },
  CI_FIX: {
    glyph: '🚑',
    label: { suffix: 'ci-fixing', color: BLUE },
    whoseTurn: 'agent',
    headline: 'Repairing red checks',
  },
  'COMPLETE:delivered': {
    glyph: '✅',
    label: { suffix: 'done', color: GREEN },
    whoseTurn: 'nobody',
    headline: 'Delivered',
  },
  'COMPLETE:cancelled': {
    glyph: '🛑',
    label: { suffix: 'stopped', color: GREY },
    whoseTurn: 'nobody',
    headline: 'Stopped',
  },
  // Whose turn is **you**: a failed run is parked with a resume point and stays
  // there until somebody replies `/retry` or `/cancel`. The same is true of an
  // over-budget stop, which parks in this very phase.
  FAILED: {
    glyph: '❌',
    label: { suffix: 'failed', color: RED },
    whoseTurn: 'you',
    headline: 'Run failed',
  },
}

/**
 * The row a state and a stance name.
 *
 * The fall-through is the load-bearing line: once the two splitting phases are
 * narrowed away, `state.phase` is the remaining union of `Phase`, and it only
 * satisfies {@link PresentationKey} while every one of those literals has a row.
 * A phase added to `PHASES` and forgotten here is therefore a compile error at
 * this `return`, not a lookup that quietly hands back `undefined` at run time.
 */
export const presentationKey = (state: AgentState, stance: RunStance): PresentationKey => {
  if (state.phase === 'INIT_OR_CLARIFY') {
    return stance === 'working' ? 'INIT_OR_CLARIFY:working' : 'INIT_OR_CLARIFY:waiting'
  }
  if (state.phase === 'COMPLETE') return state.prUrl === null ? 'COMPLETE:cancelled' : 'COMPLETE:delivered'

  return state.phase
}

/** How this state should be presented right now. Total by construction. */
export const presentationFor = (state: AgentState, stance: RunStance): PhasePresentation =>
  PRESENTATION[presentationKey(state, stance)]

/**
 * The second vocabulary: what just happened to this **run**.
 *
 * Deliberately not the table above, and not folded into it. That one is keyed on
 * a *phase* — where the issue is — while "the retry budget is spent", "I could
 * not answer that" and "that command does not apply here" are keyed on an
 * outcome, and every one of them can happen in several phases and leave the
 * phase exactly where it was. Forcing them through a phase key would either
 * invent phases that do not exist or make one row mean two things, which is the
 * failure the phase table is itself built to avoid.
 *
 * Two renderers are deliberately **absent** and read the phase table instead:
 * `renderClosing`'s delivered and cancelled headings are `COMPLETE:delivered`
 * and `COMPLETE:cancelled` — the same two states the label reconciler is naming
 * on the same comment, so a second copy of ✅ and 🛑 here could only ever drift
 * away from the label sitting beside them.
 */
export const OUTCOME_KEYS = [
  'RUN_FAILED',
  'ANSWER_FAILED',
  'RETRIES_SPENT',
  'TOKENS_SPENT',
  'ANSWER_TOKENS_SPENT',
  'CI_GAVE_UP',
  'REVIEWS_SPENT',
  'COMMAND_REFUSED',
] as const

export type OutcomeKey = (typeof OUTCOME_KEYS)[number]

/**
 * A `Record` over the closed union, for the reason {@link PRESENTATION} is one.
 *
 * The distinctions here are the point, not the glyphs:
 *
 * - ❌ means the work **broke**. ⛔ means a **bound was reached** and nothing
 *   broke at all — which is the whole argument for the budget notices being
 *   separate renderers in the first place, and it would be undone by giving a
 *   spent ceiling the same glyph as a crash.
 * - ⚠️ is a failed *answer*: the model turn broke but nothing moved, no attempt
 *   was spent and the issue is exactly where it was. ❌ there would tell a
 *   maintainer their delivered pull request had failed.
 * - 🚑 is `CI_FIX`'s own glyph from the phase table, reused on purpose: this is
 *   that story ending, and the maintainer has been watching 🚑 on the issue for
 *   however many rounds it took to give up.
 * - 😕 matches the reaction `refuseCommand` places on the very same comment, so
 *   the emoji on the maintainer's comment and the heading of the reply agree.
 */
export const OUTCOME_GLYPHS: Record<OutcomeKey, string> = {
  RUN_FAILED: '❌',
  ANSWER_FAILED: '⚠️',
  RETRIES_SPENT: '⛔',
  TOKENS_SPENT: '⛔',
  ANSWER_TOKENS_SPENT: '⛔',
  CI_GAVE_UP: '🚑',
  REVIEWS_SPENT: '⛔',
  COMMAND_REFUSED: '😕',
}

/**
 * The heading of a comment, glyph included.
 *
 * Every renderer builds its first line through this or through
 * {@link phaseHeading}, so writing a glyph inline is not something a new one
 * falls into by accident — it has to go out of its way, past a function that is
 * already imported, to invent a vocabulary of its own.
 */
export const outcomeHeading = (key: OutcomeKey, text: string): string => `### ${OUTCOME_GLYPHS[key]} ${text}`

/** The same, for a comment that speaks about where the issue is. */
export const phaseHeading = (state: AgentState, stance: RunStance, text: string): string =>
  `### ${presentationFor(state, stance).glyph} ${text}`
