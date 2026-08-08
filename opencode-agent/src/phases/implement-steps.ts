// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { StagedTotals } from '../diff-guard.js'
import { isTurnDeadline } from '../errors.js'
import type { PipelineError } from '../errors.js'
import { buildImplementPrompt } from '../implement-prompts.js'
import type { PhaseInput } from '../phase-context.js'
import { stepSubject } from '../plan-steps.js'
import type { PlanStep, StepMarker } from '../plan-steps.js'
import type { UntrustedEnvelope } from '../prompts.js'
import { msToDeadline, timeForAnotherStep } from '../time-budget.js'

/**
 * Walking a plan one step at a time: a turn, a commit, a push, and then the clock.
 *
 * The finding this closes is D2 — "nothing is durable until the turn returns". The
 * implementation used to be one `agent.prompt()` for the whole plan, then one commit,
 * then one push: atomic, all or nothing, so a clock reached anywhere inside it cost
 * everything the turn had not written down. Stage 2 made that cost recoverable by
 * salvaging the tree; this makes it *small*, and usually zero, by giving the phase
 * boundaries to stop on. The argument is the one this workspace already won one level
 * up, when the review loop was moved out from between the implementation commit and
 * the push: two independently expensive operations do not share a resume point.
 *
 * Three properties are the whole module, and each is a decision:
 *
 *  - **Committed and pushed per step, not per phase.** An Actions working tree dies
 *    with the job, so a commit nobody pushed until the end of the phase is a commit
 *    the job's death takes with it. The push is the only thing that makes a step
 *    durable, so it happens the moment the step exists.
 *  - **The clock is checked in front of every step**, where the tree is clean and the
 *    state is coherent, so the ordinary stop stops being a salvage at all. See
 *    {@link timeForAnotherStep} for why the threshold is what it is, and why it is
 *    asked only when there are steps to be between.
 *  - **A plan with no steps is one step.** The fallback for every plan approved before
 *    the steps were carried as data, and it is permanent — one unit, no step number in
 *    the prompt, today's commit message, and no clock gate in front of it.
 *
 * Two bounds deliberately stay **per phase** rather than following the clock down to
 * the step, and both are decisions rather than omissions:
 *
 *  - **The token ceiling.** `stopIfOverBudget` is asked once, in front of this phase,
 *    so a walk can overshoot `AGENT_MAX_TOKENS` by the tail of one plan. Three reasons
 *    to leave it there. It costs a `tokensUsed()` round trip per step to move it, on
 *    the one path where the clock is the scarce resource. Its stop parks in `FAILED`,
 *    which mid-walk would mean a `FAILED` issue whose branch carries half a plan — a
 *    second park shape, and the notice would have to explain that `/retry` resumes a
 *    phase that is partly done. And the runaway it exists to bound is an *issue*
 *    bouncing through retries and CI rounds across many jobs, which the check in front
 *    of the next phase and the next job still catches; one job's overshoot is itself
 *    bounded by the job's own clock, which this module does check per step.
 *  - **The diff guard.** It runs per commit, so `AGENT_MAX_CHANGED_FILES` and
 *    `AGENT_MAX_CHANGED_LINES` now bound a **step** rather than a whole
 *    implementation. That is a real widening — a five-step plan may commit five times
 *    the lines one turn could — and it is the right one: the caps exist to refuse a
 *    runaway `git add --all` (a `node_modules`, a build directory, a downloaded
 *    fixture), which is a property of one staging operation and not of a plan. The
 *    total is still recorded, summed, in `changedLines`.
 *
 * No `await` in a loop body (repo lint): the walk is tail recursion, bounded by
 * `MAX_PLAN_STEPS`.
 */

export interface StepWalkInput {
  input: PhaseInput
  /** Branch the steps commit onto — already checked out by the handler. */
  branch: string
  /** The approved plan as markdown, which every step's prompt carries as context. */
  plan: string
  /** The steps to walk; empty means one turn for the whole plan. */
  steps: readonly PlanStep[]
  /** Steps of this plan a previous job already finished. */
  from: number
  /**
   * The handler's one envelope and the system prompt built from it.
   *
   * `mintEnvelope` is called once per handler, not once per step: the id in the system
   * prompt has to be the one closing every delimiter in every user prompt, and a mint
   * per step would tell the model to trust an id that appears in most of them, which
   * makes the rest look forged. The same reason the wrap-up reuses this pair.
   */
  envelope: UntrustedEnvelope
  system: string
  handoff: string | null
}

/**
 * How the walk ended, with what the run has committed either way.
 *
 * `lines` and `commits` are sums **across the steps of this run**, which is what
 * `changedLines` now means: the figure used to be overwritten per commit, which was
 * harmless while there was one commit per phase and is an under-report by a factor of
 * the plan's length now. `commits` is counted apart from `lines` because a commit of
 * zero lines is a real thing the guard reports, and "did any step commit at all?" is
 * the question `noChangesError` answers.
 *
 * `done` is absolute — steps of the plan finished, this run and every earlier one —
 * because that is what the cursor in the state block has to mean.
 */
export interface StepWalk {
  kind: 'finished' | 'out-of-time' | 'interrupted'
  lines: number
  commits: number
  done: number
  /** The step the walk stopped on, or `null` for a plan with no steps. */
  step: StepMarker | null
  /** The typed deadline failure, on `interrupted` and never otherwise. */
  stopped: PipelineError | null
}

/** One unit of work: a declared step, or `null` for the whole plan at once. */
type Unit = PlanStep | null

export const walkPlanSteps = (walk: StepWalkInput): Promise<StepWalk> => {
  const from = cursor(walk)
  const units: readonly Unit[] = walk.steps.length === 0 ? [null] : walk.steps.slice(from)
  return step({ ...walk, from }, units, 0, { lines: 0, commits: 0 })
}

/**
 * Where to start, with a cursor that names no step in this plan sent back to the top.
 *
 * A state block is attacker-editable text, and a cursor past the end of the plan would
 * leave the walk with nothing to do — reported as "finished the plan without touching
 * a single file", parked in `FAILED`, and unrecoverable, because every `/retry` would
 * reach the same conclusion. Starting over is the same answer `resumeTransition` gives
 * a hand-edited block that names no resume point, and it is safe: the steps already on
 * the branch are done, so their turns commit nothing and the walk carries on.
 */
const cursor = (walk: StepWalkInput): number => {
  if (walk.steps.length === 0 || walk.from < walk.steps.length) return walk.from

  walk.input.deps.log.warn(
    { issue: walk.input.state.issueId, stepsDone: walk.from, steps: walk.steps.length },
    'The recorded plan step is past the end of this plan; walking it from the first step',
  )
  return 0
}

interface Tally {
  lines: number
  commits: number
}

/**
 * One unit, then the rest — or a stop.
 *
 * Tail recursion rather than a loop because the repo forbids awaiting in a loop body,
 * and the same shape the phase cascade itself uses for the same reason.
 */
const step = async (walk: StepWalkInput, units: readonly Unit[], index: number, tally: Tally): Promise<StepWalk> => {
  const unit = units[index]
  if (unit === undefined) return { kind: 'finished', ...tally, done: walk.from + index, step: null, stopped: null }

  const { deps } = walk.input
  const marker = markerFor(walk, unit, index)
  const at = (kind: StepWalk['kind'], stopped: PipelineError | null): StepWalk => ({
    kind,
    ...tally,
    done: walk.from + index,
    step: marker,
    stopped,
  })

  // The gate, and it is asked only of a declared step. A plan with no steps is one
  // indivisible turn: refusing to start it would cost the run everything that turn
  // would have written, where starting it and being interrupted keeps what it wrote.
  // With steps there is a boundary to stop on, so the same clock costs nothing.
  const toDeadline = msToDeadline(deps.config, deps.now())
  if (unit !== null && toDeadline !== null && !timeForAnotherStep(toDeadline, deps.config)) {
    deps.log.warn(
      { issue: walk.input.state.issueId, step: marker?.number, of: marker?.total, toDeadline },
      'Out of time for another plan step; stopping between steps with the branch pushed',
    )
    return at('out-of-time', null)
  }

  const stopped = await promptForStep(walk, marker, unit, index === 0)
  if (stopped !== null) return at('interrupted', stopped)

  const committed = await commitStep(walk, marker)
  return step(walk, units, index + 1, {
    lines: tally.lines + (committed?.lines ?? 0),
    commits: tally.commits + (committed === null ? 0 : 1),
  })
}

/** Where this unit sits in the plan, one-based, and `null` when the plan has no steps. */
const markerFor = (walk: StepWalkInput, unit: Unit, index: number): StepMarker | null =>
  unit === null ? null : { number: walk.from + index + 1, total: walk.steps.length, title: unit.title }

/**
 * One step's turn, and `null` unless the clock stopped it part-way through.
 *
 * Every other rejection is rethrown, which is the whole reason the deadline carries a
 * distinguishable code: a rate limit, a dead provider or a bad reply is the work
 * breaking, and none of them may quietly start salvaging a half-written tree.
 *
 * The handoff goes to the **first** step of this run and to no other, because that is
 * the step it is about: a previous job's note describes how far into the step it was
 * interrupted on got, and the cursor points at exactly that step. Handing it to the
 * ones after would be a report about finished work, arriving as context for work that
 * has not started — and the whole reason the note is worth a wrap-up window is that it
 * is specific.
 */
const promptForStep = async (
  walk: StepWalkInput,
  marker: StepMarker | null,
  unit: Unit,
  first: boolean,
): Promise<PipelineError | null> => {
  const agent = await walk.input.deps.agent()

  try {
    await agent.prompt({
      system: walk.system,
      prompt: buildImplementPrompt({
        envelope: walk.envelope,
        issueNumber: walk.input.state.issueId,
        plan: walk.plan,
        step: marker === null || unit === null ? null : { ...marker, step: unit },
        handoff: first ? walk.handoff : null,
      }),
      agent: 'build',
    })
    return null
  } catch (error) {
    if (!isTurnDeadline(error)) throw error
    return error
  }
}

/**
 * Commits and pushes what one step wrote, and reports how much that was.
 *
 * `null` — a clean tree — is an ordinary outcome per step rather than a failure: a
 * step whose work was already done by an earlier one, or whose turn concluded there
 * was nothing to change, leaves the plan unfinished rather than the run broken. Only a
 * whole walk that committed *nothing* is `noChangesError`, which is where that check
 * has to live now. Nothing is pushed for a step that committed nothing, because there
 * is nothing to push.
 */
const commitStep = async (walk: StepWalkInput, marker: StepMarker | null): Promise<StagedTotals | null> => {
  const { deps } = walk.input
  const committed = await deps.git.commitAll(stepMessage(walk.input.state.issueId, marker))
  if (committed === null) return null

  await deps.git.push(walk.branch)
  deps.log.info(
    {
      issue: walk.input.state.issueId,
      branch: walk.branch,
      step: marker?.number,
      files: committed.files,
      lines: committed.lines,
    },
    'Step committed and pushed',
  )
  return committed
}

/**
 * The commit message one step earns.
 *
 * A plan with no steps keeps the message the phase has always written, character for
 * character: that path is the fallback, and a fallback that changes what it writes is
 * a fallback in name only. A step names itself, so `git log --oneline` on the branch
 * reads as the plan a maintainer approved.
 */
const stepMessage = (issueNumber: number, marker: StepMarker | null): string => {
  const subject =
    marker === null
      ? `feat(agent): implement issue #${issueNumber}`
      : `feat(agent): implement issue #${issueNumber} — step ${marker.number}/${marker.total}: ` +
        stepSubject(marker.title)

  return `${subject}\n\nRefs #${issueNumber}`
}
