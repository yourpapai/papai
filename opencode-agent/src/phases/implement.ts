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
import type { ReviewRunResult } from '../review-runner.js'
import { envelopeFor } from './envelope.js'

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
  const plan = requireArtifact(input.thread, deps.config.selfLogin, PLAN_MARKER, () => missingPlanError(state.issueId))

  const branch = branchNameFor(state.issueId)
  await deps.git.ensureBranch(branch, deps.config.baseBranch)

  const agent = await deps.agent()
  await agent.prompt({
    system: composeSystemPrompt({
      phase: 'REVIEW_AND_MUTATE',
      skills: await deps.skills('REVIEW_AND_MUTATE'),
      repoRoot: deps.config.repoRoot,
      instructions: IMPLEMENT_INSTRUCTIONS,
    }),
    prompt: buildImplementPrompt(envelopeFor(state), state.issueId, plan),
    agent: 'build',
  })

  if (!(await deps.git.hasChanges())) throw noChangesError(state.issueId)

  // Commit first so the review loop has a clean base to diff against, then let
  // it review, fix and merge its own work back into this branch.
  await deps.git.commitAll(implementMessage(state.issueId))
  const review = await deps.runReview(plan)

  await deps.git.commitAll(reviewMessage(state.issueId))
  await deps.git.push(branch)

  deps.log.info({ issue: state.issueId, branch, reviewPassed: review.passed }, 'Implementation pushed')

  const report = renderReport(review)
  return {
    signal: 'CHANGES_COMMITTED',
    comment: report,
    blocks: [renderArtifact(REPORT_MARKER, report, state.revision)],
    patch: { branch },
  }
}

const implementMessage = (issueNumber: number): string =>
  `feat(agent): implement issue #${issueNumber}\n\nRefs #${issueNumber}`

const reviewMessage = (issueNumber: number): string =>
  `fix(agent): apply review-loop findings for issue #${issueNumber}\n\nRefs #${issueNumber}`

const renderReport = (review: ReviewRunResult): string => {
  const lines = [
    '### Implementation report',
    '',
    `- Review loop: ${review.passed ? '✅ clean' : `❌ exited ${review.exitCode}`}`,
    '',
    '<details><summary>review-loop summary</summary>',
    '',
    '```',
    review.summary,
    '```',
    '',
    '</details>',
  ]

  return lines.join('\n')
}
