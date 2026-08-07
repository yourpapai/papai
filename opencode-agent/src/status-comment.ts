// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { PipelineConfig } from './config.js'
import { branchNameFor } from './git.js'
import { phaseHeading, PRESENTATION, presentationFor } from './presentation.js'
import type { PresentationKey, RunStance } from './presentation.js'
import type { ProgressSnapshot } from './progress.js'
import type { AgentState, Phase } from './types.js'

/**
 * What the run's live status comment says. Pure: every input arrives as an
 * argument, including the clock, so the whole rendering is testable as a value
 * and the channel that edits it has nothing to decide but *when*.
 *
 * Comments in this pipeline are terminal by construction — they are written from
 * a finished `PhaseOutcome` — so nothing could ever say "round 2 of 4" or "still
 * working" without adding a comment per tick. This is the one surface that can,
 * and it is the entire comment budget the feedback plan allows itself: one
 * comment per run, edited, never a second.
 *
 * It deliberately carries **no `AGENT_STATE` block**. `findLatestState` restores
 * from the newest agent comment carrying one, so a second writer of that block
 * is a second source of truth; the phase-end comments stay the only state
 * channel, and this comment is invisible to the restore scan.
 *
 * It also carries no free model text. Every field here is a phase, a count or a
 * status: the activity line comes from `ProgressSnapshot`, which has nowhere for
 * tool input, tool output or model prose to land, so the rule that progress
 * reporting carries names and counts only holds by construction rather than by
 * care — and this surface is a public issue, not a log.
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
 * Fewer rows than there are phases, on purpose: `PLAN_REVIEW` is the execution
 * plan waiting to be approved rather than a sixth thing that happens, and
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
  { title: 'Execution plan', key: 'EXECUTION_PLAN' },
  { title: 'Implementation', key: 'REVIEW_AND_MUTATE' },
  { title: 'Pull request', key: 'PR_DELIVERY' },
]

/** Rows that carry an artefact revision, by index into {@link RUN_STEPS}. */
const SPEC_STEP = 1
const PLAN_STEP = 2

/**
 * Which row a phase sits on. `null` for the two phases that are not a step —
 * `COMPLETE` is past the end and `FAILED` is wherever it broke.
 *
 * A `Record<Phase, …>` so a phase added later fails to compile until it has been
 * placed, the same property `PRESENTATION` has.
 */
const STEP_OF: Record<Phase, number | null> = {
  INIT_OR_CLARIFY: 0,
  DESIGN_SPEC: 1,
  EXECUTION_PLAN: 2,
  PLAN_REVIEW: 2,
  REVIEW_AND_MUTATE: 3,
  PR_DELIVERY: 4,
  CI_FIX: 4,
  COMPLETE: null,
  FAILED: null,
}

/** Everything the status comment is a function of. */
export interface StatusView {
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
 */
const stepIndex = (state: AgentState): number => {
  const direct = STEP_OF[state.phase]
  if (direct !== null) return direct
  if (state.phase === 'FAILED') return STEP_OF[state.resumeFrom ?? 'INIT_OR_CLARIFY'] ?? 0
  if (state.prUrl !== null) return RUN_STEPS.length

  if (state.planRevision > 0) return PLAN_STEP
  return state.specRevision > 0 ? SPEC_STEP : 0
}

/**
 * Behind, on, or ahead of the current step.
 *
 * The three marks are this table's own vocabulary and have no row in
 * `presentation.ts`, because "a step that is behind us" is not a state an issue
 * can be found in. The mark on the row the run *stopped* on is the exception and
 * is read from there — ❌ for a failure, 🛑 for a cancelled issue, the waiting
 * phase's own glyph for a run parked in front of a human — so the status comment
 * and the label sitting on the issue beside it cannot say different things.
 */
const stepMark = (index: number, current: number, view: StatusView): string => {
  if (index < current) return '✅'
  if (index > current) return '⬜'
  return view.live ? '⏳ **now**' : presentationFor(view.state, 'waiting').glyph
}

/**
 * The revision this row's artefact is on.
 *
 * Read from `specRevision` and `planRevision`, never recounted: the two counters
 * were split apart precisely because one number could not honestly label two
 * artefacts, and a table that re-derived them would be the second place that
 * went wrong.
 */
const revisionNote = (index: number, state: AgentState): string => {
  if (index === SPEC_STEP && state.specRevision > 0) return ` · revision ${state.specRevision}`
  if (index === PLAN_STEP && state.planRevision > 0) return ` · revision ${state.planRevision}`
  return ''
}

const table = (view: StatusView): readonly string[] => {
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
 * that changes every minute changes the whole body every minute, and the same
 * section asks for edits to be skipped when the body has not changed. The two
 * cannot both be had — a quiet twenty-minute model call would cost twenty edits
 * saying nothing but a new minute count, which is precisely the case the
 * suppression exists for. A start time and GitHub's own "edited N minutes ago"
 * answer "how long has this been going" between them, and cost nothing.
 */
const jobLine = (view: StatusView): string =>
  `**Job:** [this run](${view.runUrl}) · started ${clockUtc(view.startedMs)} UTC`

const branchLine = (state: AgentState): string =>
  `**Branch:** \`${branchNameFor(state.issueId)}\` · **Pull request:** ${state.prUrl ?? '_not opened yet_'}`

/**
 * What the issue has spent, live.
 *
 * `tokensSpent` is authoritative but only moves when a comment is posted, and
 * the point of this surface is the stretch *between* two comments — so the
 * heartbeat's running total, added to what the issue carried into this job, is
 * the fresher figure for exactly as long as no phase has ended. Whichever is
 * larger is the one that has seen more of the run; neither can double-count the
 * other, because `carriedTokens` is captured once, before this job spends
 * anything.
 */
const spentTokens = (view: StatusView): number => {
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
const attemptLine = (view: StatusView): string => {
  const { state, config } = view
  if (state.phase === 'CI_FIX') {
    return `attempt ${state.ciAttempts} of ${config.maxCiAttempts} on this pull request`
  }
  // `attempts` counts failures already suffered, so the run in flight is the
  // next one — which is the number the failure comment would print if it broke
  // here.
  return `attempt ${state.attempts + 1} of ${config.maxAttempts}`
}

const budgetLine = (view: StatusView): string =>
  `**Budget:** ${count(spentTokens(view))} of ${count(view.config.maxTokens)} tokens · ${attemptLine(view)}`

const doingLine = (progress: ProgressSnapshot): string =>
  `**Doing:** ${progress.lastAction} · ${progress.toolCalls} tool calls`

/**
 * The whole comment.
 *
 * The heading's glyph and headline come from the presentation table and nothing
 * else: "🛠️ Implementing" would be a third name for a phase that already has a
 * label suffix and a headline, and inventing one per renderer is the defect that
 * table exists to prevent.
 */
export const renderStatus = (view: StatusView): string => {
  const stance: RunStance = view.live ? 'working' : 'waiting'
  const { headline } = presentationFor(view.state, stance)
  const activity = view.live && view.progress !== null ? [doingLine(view.progress)] : []

  return [
    phaseHeading(view.state, stance, view.live ? `${headline} — run in progress` : headline),
    '',
    jobLine(view),
    branchLine(view.state),
    '',
    ...table(view),
    '',
    ...activity,
    budgetLine(view),
  ].join('\n')
}
