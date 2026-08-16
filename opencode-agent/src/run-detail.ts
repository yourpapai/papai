// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { PipelineConfig } from './config.js'
import { branchNameFor } from './git.js'
import { PRESENTATION, presentationFor } from './presentation.js'
import type { PresentationKey } from './presentation.js'
import type { ProgressSnapshot } from './progress.js'
import type { AgentState, Phase } from './types.js'

/**
 * The run, as a table and three lines: how far it got, what it cost, and where
 * to watch it.
 *
 * Split from `status-comment.ts` when sections landed there and pushed it past
 * `max-lines`, along the seam the two halves already had: that file decides
 * *what a reply is made of* — a heading, the phase reports, this — and this one
 * decides *how a run describes itself*. They change for different reasons. A
 * new phase or a new budget adds a row here; a change to how reports are
 * arranged touches only the other.
 *
 * Everything is a phase, a count or a status. There is nowhere for tool input,
 * tool output or model prose to land, so the rule that progress reporting
 * carries names and counts only holds by construction rather than by care —
 * and this surface is a public issue, not a log.
 */

/** One row of the progress table. */
interface RunStep {
  title: string
  /** Whose glyph the row wears. Never a glyph of its own — see the note below. */
  key: PresentationKey
}

/**
 * The run, as five milestones.
 *
 * Fewer rows than there are phases, on purpose: `PLAN_REVIEW` is the plan
 * waiting to be approved rather than a sixth thing that happens, and
 * `CI_FIX` is repair work on the pull request row. A table with a row per phase
 * would be a state-machine diagram, and the question this answers is "how far
 * along is my issue".
 *
 * The titles live here rather than in `presentation.ts` because this is their
 * only reader, so this *is* the one place — and the glyphs beside them are read
 * back out of `PRESENTATION`, so no phase acquires a second face here.
 */
const RUN_STEPS: readonly RunStep[] = [
  { title: 'Triage', key: 'INIT_OR_CLARIFY:working' },
  { title: 'Design spec', key: 'DESIGN_SPEC' },
  { title: 'Planning', key: 'PLANNING' },
  { title: 'Implementation', key: 'REVIEW_AND_MUTATE' },
  { title: 'Pull request', key: 'PR_DELIVERY' },
]

/** Rows that carry an artefact revision, by index into {@link RUN_STEPS}. */
const SPEC_STEP = 1
const PLAN_STEP = 2

/**
 * Which row a phase sits on. `null` for the three phases that are not a step —
 * `COMPLETE` is past the end, and `FAILED` and `INCOMPLETE` are each wherever the
 * run stopped, which their `resumeFrom` names rather than their phase.
 *
 * A `Record<Phase, …>` so a phase added later fails to compile until it has been
 * placed, the same property `PRESENTATION` has.
 */
const STEP_OF: Record<Phase, number | null> = {
  INIT_OR_CLARIFY: 0,
  DESIGN_SPEC: 1,
  PLANNING: 2,
  PLAN_REVIEW: 2,
  REVIEW_AND_MUTATE: 3,
  PR_DELIVERY: 4,
  // Both of these are work *on* the pull request rather than a sixth milestone:
  // the branch is pushed and the pull request open before either can start.
  CODE_REVIEW: 4,
  CI_FIX: 4,
  // The archive door (D7) runs after delivery, on the base branch — past the
  // pipeline's milestones, like COMPLETE.
  ARCHIVE: null,
  COMPLETE: null,
  FAILED: null,
  INCOMPLETE: null,
}

/** Phases whose row is the one they are parked *before*, read from `resumeFrom`. */
const PARKED_PHASES: ReadonlySet<Phase> = new Set<Phase>(['FAILED', 'INCOMPLETE'])

/** Everything the run detail is a function of. */
export interface RunDetailView {
  state: AgentState
  /** What the model is doing, or `null` before a heartbeat has said. */
  progress: ProgressSnapshot | null
  /** Whether the run still holds the issue. False once it has ended. */
  live: boolean
  runUrl: string
  startedMs: number
  /** What this issue had spent before the job started — see {@link spentTokens}. */
  carriedTokens: number
  config: Pick<PipelineConfig, 'maxTokens' | 'maxAttempts' | 'maxCiAttempts'>
}

/**
 * How far the run has got, as an index into {@link RUN_STEPS}.
 *
 * A cancelled `COMPLETE` is the awkward case: the phase says only that the
 * conversation is over, not where it stopped. The artefacts do say — a plan
 * exists or it does not — so the row it stops on is read off those rather than
 * claiming every step finished on an issue somebody cancelled during triage.
 *
 * The two parked phases are the easy case, and they share one branch because they
 * carry the same field for the same purpose: `resumeFrom` is the phase the run
 * would re-enter, so it is also the row the table should mark. A `⏸️` on
 * "Implementation" says where a `/continue` picks up.
 */
const stepIndex = (state: AgentState): number => {
  const direct = STEP_OF[state.phase]
  if (direct !== null) return direct
  if (PARKED_PHASES.has(state.phase)) return STEP_OF[state.resumeFrom ?? 'INIT_OR_CLARIFY'] ?? 0
  if (state.prUrl !== null) return RUN_STEPS.length

  if (state.planRevision > 0) return PLAN_STEP
  return state.changeName === null ? 0 : SPEC_STEP
}

/**
 * Behind, on, or ahead of the current step.
 *
 * The three marks are this table's own vocabulary and have no row in
 * `presentation.ts`, because "a step that is behind us" is not a state an issue
 * can be found in. The mark on the row the run *stopped* on is the exception and
 * is read from there — ❌ for a failure, 🛑 for a cancelled issue, the waiting
 * phase's own glyph for a run parked in front of a human — so the run detail
 * and the label sitting on the issue beside it cannot say different things.
 */
const stepMark = (index: number, current: number, view: RunDetailView): string => {
  if (index < current) return '✅'
  if (index > current) return '⬜'
  return view.live ? '⏳ **now**' : presentationFor(view.state, 'waiting').glyph
}

/**
 * The revision this row's artefact is on.
 *
 * Only the plan row carries a revision now: under the OpenSpec rework the
 * proposal lives in the `openspec/changes/<name>/` folder whose history *is*
 * its revision (a rendered digest says so), so the "Design spec" row reports no
 * counter. `planRevision` remains the machine's plan-identity token, read here
 * for the row it has always labelled.
 */
const revisionNote = (index: number, state: AgentState): string => {
  if (index === PLAN_STEP && state.planRevision > 0) return ` · revision ${state.planRevision}`
  return ''
}

const table = (view: RunDetailView): readonly string[] => {
  const current = stepIndex(view.state)

  return [
    '| Phase | |',
    '| --- | --- |',
    ...RUN_STEPS.map(
      (step, index) =>
        `| ${PRESENTATION[step.key].glyph} ${step.title} | ${stepMark(index, current, view)}${revisionNote(index, view.state)} |`,
    ),
  ]
}

const count = (value: number): string => value.toLocaleString('en-US')

/** `HH:MM`, in UTC, because a runner's local time is not the reader's. */
const clockUtc = (ms: number): string => new Date(ms).toISOString().slice(11, 16)

/**
 * When the run started, and where to watch it.
 *
 * Deliberately *not* "6m elapsed", which the plan's sketch carried: a figure
 * that changes every minute is a figure nobody can diff two runs by, and
 * GitHub's own "N minutes ago" on the comment answers "how long has this been
 * going" for free.
 */
const jobLine = (view: RunDetailView): string =>
  `**Job:** [this run](${view.runUrl}) · started ${clockUtc(view.startedMs)} UTC`

const branchLine = (state: AgentState): string =>
  `**Branch:** \`${branchNameFor(state.issueId)}\` · **Pull request:** ${state.prUrl ?? '_not opened yet_'}`

/**
 * What the issue has spent.
 *
 * `tokensSpent` is authoritative but only moves when a phase ends, so while a
 * run is live the heartbeat's running total — added to what the issue carried
 * into this job — is the fresher figure. Whichever is larger has seen more of
 * the run; neither can double-count the other, because `carriedTokens` is
 * captured once, before this job spends anything.
 */
const spentTokens = (view: RunDetailView): number => {
  const observed = view.progress
  if (observed === null) return view.state.tokensSpent

  return Math.max(view.state.tokensSpent, view.carriedTokens + observed.tokens)
}

/**
 * Which budget the run is working against.
 *
 * `ciAttempts` is counted per pull request rather than per issue, so the CI line
 * has to say so: the same "attempt 2 of 3" on a second pull request would be a
 * different two attempts, and a maintainer reading it as a per-issue count would
 * conclude the agent had given up when it had not started.
 */
const attemptLine = (view: RunDetailView): string => {
  const { state, config } = view
  if (state.phase === 'CI_FIX') {
    return `attempt ${state.ciAttempts} of ${config.maxCiAttempts} on this pull request`
  }
  // `attempts` counts failures already suffered, so the run in flight is the
  // next one — which is the number the failure comment would print if it broke
  // here.
  return `attempt ${state.attempts + 1} of ${config.maxAttempts}`
}

const budgetLine = (view: RunDetailView): string =>
  `**Budget:** ${count(spentTokens(view))} of ${count(view.config.maxTokens)} tokens · ${attemptLine(view)}`

const doingLine = (progress: ProgressSnapshot): string =>
  `**Doing:** ${progress.lastAction} · ${progress.toolCalls} tool calls`

/** The summary heading, kept here so the one reader and the one writer agree. */
export const RUN_DETAIL_SUMMARY = 'Run detail'

/**
 * The run's own account of itself, collapsed.
 *
 * Collapsed because it is a summary of a finished run rather than the thing the
 * maintainer opened the comment to read — the phase reports above it are that —
 * and because `renderThread` cuts the body just below it, so nothing here has to
 * earn a slot in the window the model reads the conversation through.
 */
export const renderRunDetail = (view: RunDetailView): readonly string[] => {
  const activity = view.live && view.progress !== null ? [doingLine(view.progress)] : []

  return [
    `<details><summary>${RUN_DETAIL_SUMMARY}</summary>`,
    '',
    jobLine(view),
    branchLine(view.state),
    '',
    ...table(view),
    '',
    ...activity,
    budgetLine(view),
    '',
    '</details>',
  ]
}
