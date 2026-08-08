// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { PLAN_MARKER, renderArtifact, REPORT_MARKER, requireArtifact } from '../artifacts.js'
import { missingPlanError, noChangesError } from '../errors.js'
import { branchNameFor } from '../git.js'
import { composeSystemPrompt } from '../obra-skills.js'
import type { PhaseHandler, PhaseOutcome } from '../phase-context.js'
import { buildImplementPrompt } from '../prompts.js'
import type { AgentState } from '../types.js'
import { mintEnvelope } from './envelope.js'

const IMPLEMENT_INSTRUCTIONS = [
  'Implement the approved plan in the working tree, test-first.',
  'Never weaken or delete a test to make a check pass, and never add lint-disable or type-ignore comments.',
  'Leave committing, pushing and pull-request creation to the pipeline.',
].join('\n')

/**
 * Phase 3. Applies the plan, commits it **and pushes**. It does not review.
 *
 * Pushing here rather than in phase 4 is deliberate: an Actions job's working
 * tree dies with the job, so a commit that is not pushed by the end of the phase
 * that made it cannot be recovered by any later retry. That argument is stronger
 * now than when it was written, because the push happens as early as it possibly
 * can — the `review-loop/` workspace used to run between this phase's commit and
 * its push, so a review that timed out, left the tree uncommittable, or was
 * killed with the job discarded an implementation that had succeeded, and the
 * `/retry` that followed paid for a second model turn to redo it.
 *
 * The review is `CODE_REVIEW` now, entered by `/review` on the delivered pull
 * request. Do not grow it back in here: two independently expensive operations
 * with two independent failure modes sharing one phase, one job and one resume
 * point is the whole of what that split undid.
 */
export const handleImplement: PhaseHandler = async (input): Promise<PhaseOutcome> => {
  const { deps, state } = input
  const plan = requireArtifact(input.thread, await deps.selfLogin(), PLAN_MARKER, () => missingPlanError(state.issueId))

  const branch = branchNameFor(state.issueId)
  await deps.git.ensureBranch(branch, await deps.baseBranch())

  const envelope = mintEnvelope()
  const agent = await deps.agent()
  await agent.prompt({
    system: composeSystemPrompt({
      phase: 'REVIEW_AND_MUTATE',
      skills: await deps.skills('REVIEW_AND_MUTATE'),
      repoRoot: deps.config.repoRoot,
      nonce: envelope.nonce,
      instructions: IMPLEMENT_INSTRUCTIONS,
    }),
    prompt: buildImplementPrompt(envelope, state.issueId, plan),
    agent: 'build',
  })

  // `commitAll` reports a clean tree itself, which is the same question a
  // separate `hasChanges` probe asked one `git status` earlier — two reads of a
  // tree that a long model turn had just finished writing to, free to disagree
  // and with no rule for which one won.
  if (!(await deps.git.commitAll(implementMessage(state.issueId)))) throw noChangesError(state.issueId)

  await deps.git.push(branch)
  deps.log.info({ issue: state.issueId, branch }, 'Implementation pushed')

  const report = renderReport()
  return { signal: 'CHANGES_COMMITTED', comment: report, blocks: [reportBlock(report, state)] }
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

const implementMessage = (issueNumber: number): string =>
  `feat(agent): implement issue #${issueNumber}\n\nRefs #${issueNumber}`

/**
 * What this phase has to say, which is now mostly what it has **not** done.
 *
 * The report block this becomes is what the pull request body carries, so the
 * statement that nothing has reviewed the diff is read where a reviewer is
 * looking at it. Naming `/review` there is the only way anybody learns the
 * command exists; the run is otherwise indistinguishable from one where the
 * review passed silently.
 */
const renderReport = (): string =>
  [
    '### Implementation report',
    '',
    'The approved plan is implemented, committed and pushed to the branch.',
    '',
    '- Review loop: not run — it is a separate step now',
    '',
    'Reply `/review` on the issue and I will run the `review-loop/` workspace over this branch and push ' +
      'whatever it finds as further commits.',
  ].join('\n')
