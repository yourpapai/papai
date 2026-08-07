// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { PLAN_MARKER, renderArtifact, REPORT_MARKER, requireArtifact } from '../artifacts.js'
import { missingPlanError, noChangesError } from '../errors.js'
import { branchNameFor } from '../git.js'
import { fence } from '../markdown.js'
import { composeSystemPrompt } from '../obra-skills.js'
import type { PhaseHandler, PhaseOutcome } from '../phase-context.js'
import { buildImplementPrompt } from '../prompts.js'
import type { ReviewOutcome, ReviewRunResult } from '../review-runner.js'
import { mintEnvelope } from './envelope.js'

const IMPLEMENT_INSTRUCTIONS = [
  'Implement the approved plan in the working tree, test-first.',
  'Never weaken or delete a test to make a check pass, and never add lint-disable or type-ignore comments.',
  'Leave committing, pushing and pull-request creation to the pipeline.',
].join('\n')

/**
 * Phase 3. Applies the plan, hands the working tree to the `review-loop/`
 * workspace, then commits **and pushes**.
 *
 * Pushing here rather than in phase 4 is deliberate: an Actions job's working
 * tree dies with the job, so a commit that is not pushed by the end of the
 * phase that made it cannot be recovered by any later retry.
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

  // Commit first so the review loop has a clean base to diff against, then let
  // it review, fix and merge its own work back into this branch.
  //
  // `commitAll` reports a clean tree itself, which is the same question a
  // separate `hasChanges` probe asked one `git status` earlier — two reads of a
  // tree that a long model turn had just finished writing to, free to disagree
  // and with no rule for which one won.
  if (!(await deps.git.commitAll(implementMessage(state.issueId)))) throw noChangesError(state.issueId)

  const review = await deps.runReview(plan)

  await deps.git.commitAll(reviewMessage(state.issueId))
  await deps.git.push(branch)

  deps.log.info({ issue: state.issueId, branch, review: review.outcome }, 'Implementation pushed')

  const report = renderReport(review)
  return {
    signal: 'CHANGES_COMMITTED',
    comment: report,
    blocks: [renderArtifact(REPORT_MARKER, report, state.revision)],
  }
}

const implementMessage = (issueNumber: number): string =>
  `feat(agent): implement issue #${issueNumber}\n\nRefs #${issueNumber}`

const reviewMessage = (issueNumber: number): string =>
  `fix(agent): apply review-loop findings for issue #${issueNumber}\n\nRefs #${issueNumber}`

const REVIEW_LINE: Record<ReviewOutcome, (exitCode: number) => string> = {
  passed: () => '✅ clean',
  failed: (exitCode) => `❌ exited ${exitCode}`,
  // Not a failure: this repository simply has no review loop configured, and
  // saying "❌" for that would report every run elsewhere as permanently red.
  unavailable: () => '— not configured for this repository',
}

const renderReport = (review: ReviewRunResult): string => {
  const lines = ['### Implementation report', '', `- Review loop: ${REVIEW_LINE[review.outcome](review.exitCode)}`]

  if (review.outcome !== 'unavailable') {
    lines.push(
      '',
      '<details><summary>review-loop summary</summary>',
      '',
      // The summary is the workspace's own output and can contain fences.
      fence(review.summary),
      '',
      '</details>',
    )
  }

  return lines.join('\n')
}
