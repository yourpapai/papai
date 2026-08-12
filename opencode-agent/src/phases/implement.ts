// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { findHandoff, renderArtifact, REPORT_MARKER } from '../artifacts.js'
import { noChangesError } from '../errors.js'
import { branchNameFor } from '../git.js'
import { IMPLEMENT_INSTRUCTIONS } from '../implement-prompts.js'
import { composeSystemPrompt } from '../obra-skills.js'
import type { PhaseHandler, PhaseInput, PhaseOutcome } from '../phase-context.js'
import { parseTaskCheckboxes, taskStepsFromCheckboxes } from '../plan-steps.js'
import { msToDeadline } from '../time-budget.js'
import { renderStoppedBetweenSteps } from '../time-notices.js'
import { stopPartWayThrough } from '../turn-stop.js'
import type { AgentState } from '../types.js'
import { mintEnvelope } from './envelope.js'
import { walkPlanSteps } from './implement-steps.js'
import type { StepWalk } from './implement-steps.js'

/**
 * Phase 3. Applies the plan **a step at a time**, committing and pushing each one.
 * It does not review.
 *
 * Pushing here rather than in phase 4 is deliberate: an Actions job's working
 * tree dies with the job, so a commit that is not pushed by the end of the phase
 * that made it cannot be recovered by any later retry. That argument is what makes
 * the step the unit of work rather than the plan — the push now happens once per
 * step, so a job killed part-way through a plan leaves every finished step on the
 * remote. `implement-steps.ts` holds the walk; what is left here is reading the plan,
 * cutting the branch, and turning the three ways a walk can end into a phase outcome.
 *
 * The review is `CODE_REVIEW` now, entered by an explicit `/review` — typed on
 * the issue, or on the delivered pull request, which resolves back to the same
 * issue before anything else runs. Do not grow it back in here: two
 * independently expensive operations with two independent failure modes sharing
 * one phase, one job and one resume point is the whole of what that split undid.
 */
export const handleImplement: PhaseHandler = async (input): Promise<PhaseOutcome> => {
  const { deps, state } = input
  if (state.changeName === null) throw new Error('REVIEW_AND_MUTATE reached without a changeName on the state')
  const tasksPath = (await deps.openspec.instructions('tasks', state.changeName)).resolvedOutputPath
  const tasksMd = await deps.readFile(tasksPath)
  const steps = taskStepsFromCheckboxes(parseTaskCheckboxes(tasksMd))

  const branch = branchNameFor(state.issueId)
  await deps.git.ensureBranch(branch, await deps.baseBranch())

  const envelope = mintEnvelope()
  // Minted and composed once per handler, then handed to every step and to the
  // wrap-up: the nonce in the system prompt has to be the one closing every
  // delimiter, and a second mint would tell the model to trust an id most of its
  // prompts do not carry — which makes every real delimiter look forged.
  const system = composeSystemPrompt({
    phase: 'REVIEW_AND_MUTATE',
    skills: await deps.skills('REVIEW_AND_MUTATE'),
    repoRoot: deps.config.repoRoot,
    nonce: envelope.nonce,
    instructions: IMPLEMENT_INSTRUCTIONS,
  })

  const walk = await walkPlanSteps({
    input,
    branch,
    plan: tasksMd,
    steps,
    // Where a previous job's stop left the plan. `0` for a fresh implementation.
    from: state.stepsDone,
    tasksPath,
    envelope,
    system,
    // A note the *previous* out-of-time run wrote about this same plan. Read through
    // `findHandoff`, which is where the revision check lives — a note about a plan
    // that has since been rewritten describes work nobody asked for any more.
    handoff: findHandoff(input.thread, await deps.selfLogin(), state.planRevision),
  })

  return settleWalk({ input, branch, system, total: steps.length, walk })
}

interface Settlement {
  input: PhaseInput
  branch: string
  /** The interrupted turn's own system prompt, which the wrap-up has to reuse. */
  system: string
  /** Steps the plan declared, which is `0` for a plan that declared none. */
  total: number
  walk: StepWalk
}

/**
 * The three ways a walk ends, as phase outcomes.
 *
 * A turn stopped by its own bound is a **ceiling reached**, not work that broke, so
 * both stops leave by the same door: the branch keeps what is on it, the issue parks
 * in `INCOMPLETE`, and `/continue` picks this phase back up on a fresh clock at the
 * step the cursor records. Every other rejection out of a step still falls through to
 * `failRun`, which is the whole reason the deadline carries a distinguishable code.
 */
const settleWalk = (settlement: Settlement): Promise<PhaseOutcome> => {
  const { input, branch, walk } = settlement

  if (walk.kind === 'interrupted' && walk.stopped !== null) {
    return stopPartWayThrough({
      input,
      branch,
      stopped: walk.stopped,
      system: settlement.system,
      step: walk.step,
      committedLines: walk.lines,
      committed: walk.commits,
      done: walk.done,
    })
  }

  if (walk.kind === 'out-of-time') return Promise.resolve(betweenSteps(settlement))

  // A plan every step of which committed nothing is the one thing that has not
  // changed: the model was asked to implement an approved plan and touched no file.
  // Asked of the whole walk rather than of one commit, because a single step
  // concluding there is nothing to do leaves the plan unfinished, not the run broken.
  if (walk.commits === 0) throw noChangesError(input.state.issueId)

  const report = renderReport(walk.repairs)
  return Promise.resolve({
    signal: 'CHANGES_COMMITTED',
    comment: report,
    blocks: [reportBlock(report, input.state)],
    // The raw count, not a verdict on it: `renderDelivery` compares it against
    // `reviewHintLines` as the config reads at delivery time, one phase later. Summed
    // over the steps of this run, where it used to be overwritten by each commit —
    // harmless with one commit per phase, an under-report by a factor of the plan's
    // length now. The cursor is cleared because the plan is done: a later re-entry
    // should walk it rather than resume past its end.
    patch: { changedLines: walk.lines, stepsDone: 0 },
  })
}

/**
 * The clean stop: out of clock with the tree committed, pushed and quiescent.
 *
 * The prize of walking the plan a step at a time, and the reason it is a different
 * outcome from either stop that came before it. No abort, no wrap-up window, no
 * salvage and no handoff — the session was idle, the branch carries every finished
 * step, and the cursor plus the plan is a better account of where things stand than
 * any note a model could write about a step it had not begun.
 *
 * The `changedLines` patch is conditional for a reason the finished path's is not: a
 * run that committed nothing must not overwrite the figure an earlier run recorded
 * for the same branch with a 0 that would read as "a small diff".
 */
const betweenSteps = (settlement: Settlement): PhaseOutcome => {
  const { walk } = settlement
  const { deps, state } = settlement.input

  return {
    signal: 'OUT_OF_TIME',
    comment: renderStoppedBetweenSteps({
      remainingMs: msToDeadline(deps.config, deps.now()) ?? 0,
      reserveMs: deps.config.teardownReserveMs,
      branch: settlement.branch,
      resumeFrom: state.phase,
      done: walk.done,
      total: settlement.total,
      lines: walk.lines,
      next: walk.step?.title ?? '',
    }),
    patch: { stepsDone: walk.done, ...(walk.commits === 0 ? {} : { changedLines: walk.lines }) },
  }
}

/**
 * The implementation report, stamped with the plan revision it implemented.
 *
 * Provenance rather than a revision of the report itself: nothing bumps a report
 * counter — `CHANGES_COMMITTED` is not one of the artefact signals — so a second
 * run over the same plan writes the same number, and what the figure answers is
 * "was this report built from the plan currently on the issue?".
 *
 * It reads `planRevision` and not `specRevision` because that is what the one
 * shared counter held here too: the plan is the last artefact posted before this
 * phase, so the shared value had just been bumped to the plan's own heading
 * number. The same figure, now by construction rather than by coincidence.
 */
const reportBlock = (report: string, state: AgentState): string =>
  renderArtifact(REPORT_MARKER, report, state.planRevision)

/**
 * What this phase has to say, which is now mostly what it has **not** done.
 *
 * The report block this becomes is what the pull request body carries, so the
 * statement that nothing has reviewed the diff is read where a reviewer is
 * looking at it. Naming `/review` there is the only way anybody learns the
 * command exists; the run is otherwise indistinguishable from one where the
 * review passed silently.
 *
 * The repair line is the same argument on a smaller scale. A commit the repository
 * refused and the model then fixed leaves nothing behind on the issue — the branch
 * carries the fix and the failure is in a job log nobody opens — so a run that paid
 * for repair turns would read exactly like one that did not. Absent at zero, which
 * is the ordinary case, so the report does not grow a line saying nothing happened.
 */
const renderReport = (repairs: number): string =>
  [
    '### Implementation report',
    '',
    'The approved plan is implemented, committed and pushed to the branch.',
    '',
    '- Review loop: not run — it is a separate step now',
    ...(repairs === 0
      ? []
      : [`- Commit checks: refused a commit ${repairs} time(s); I fixed what they reported and committed again`]),
    '',
    // Both doors, because both are open. This line said "on the issue" while the
    // pull-request one was still unbuilt, and it is the last surface that did:
    // naming a door before the workflow opens it is a promise the pipeline
    // cannot keep, and leaving it named after it opens is an offer withheld.
    'Reply `/review` — here, or on the pull request once it is open — and I will run the `review-loop/` ' +
      'workspace over this branch and push whatever it finds as further commits.',
  ].join('\n')
