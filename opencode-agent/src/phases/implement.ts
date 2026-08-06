// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { missingPlanError, noChangesError } from '../errors.js'
import { branchNameFor } from '../git.js'
import { composeSystemPrompt } from '../obra-skills.js'
import type { OpenCodeAgent } from '../opencode-adapter.js'
import type { PhaseHandler, PhaseInput, PhaseOutcome } from '../phase-context.js'
import { buildImplementPrompt, buildMutationPrompt, buildRepairPrompt } from '../prompts.js'
import { formatFailures, runMutationImprove, runReviewLoop } from '../review-loop.js'
import type { MutationImproveResult, ReviewLoopResult } from '../review-loop.js'
import { findAgentSection, PLAN_HEADING } from '../thread.js'

const IMPLEMENT_INSTRUCTIONS = [
  'Implement the approved plan in the working tree, test-first.',
  'Never weaken or delete a test to make a check pass, and never add lint-disable or type-ignore comments.',
  'Leave committing, pushing and pull-request creation to the pipeline.',
].join('\n')

/**
 * Phase 3. Applies the plan, then drives the review loop and the
 * mutation-improve loop until both settle, and commits the result.
 *
 * The loops are not gates that abort the run: their outcome is reported on the
 * issue and carried into the pull request body, so a maintainer sees exactly
 * which checks were still red when the branch was pushed.
 */
export const handleImplement: PhaseHandler = async (input): Promise<PhaseOutcome> => {
  const { deps, state } = input
  const plan = findAgentSection(input.thread, deps.config.selfLogin, PLAN_HEADING)
  if (plan === null) throw missingPlanError(state.issueId)

  const branch = state.branch ?? branchNameFor(state.issueId)
  await deps.git.ensureBranch(branch, deps.config.baseBranch)

  const agent = await deps.agent()
  const system = composeSystemPrompt({
    phase: 'REVIEW_AND_MUTATE',
    skills: await deps.skills('REVIEW_AND_MUTATE'),
    repoRoot: deps.config.repoRoot,
    instructions: IMPLEMENT_INSTRUCTIONS,
  })

  await agent.prompt({
    system,
    prompt: buildImplementPrompt({ issueNumber: state.issueId, plan }),
    agent: 'build',
  })

  if (!(await deps.git.hasChanges())) throw noChangesError(state.issueId)

  const review = await runReview(input, agent, system)
  const mutation = await runMutation(input, agent, system)

  await deps.git.commitAll(commitMessage(state.issueId, review))
  deps.log.info(
    { issue: state.issueId, branch, reviewPassed: review.passed, mutationScore: mutation.finalScore },
    'Committed agent changes',
  )

  return {
    signal: 'CHANGES_COMMITTED',
    comment: renderReport(review, mutation),
    patch: { branch },
  }
}

const runReview = (input: PhaseInput, agent: OpenCodeAgent, system: string): Promise<ReviewLoopResult> =>
  runReviewLoop({
    checks: input.deps.config.checks,
    run: input.deps.runCheck,
    maxRounds: input.deps.config.maxReviewRounds,
    repair: async (failures, round) => {
      input.deps.log.warn(
        { issue: input.state.issueId, round, checks: failures.map((failure) => failure.name) },
        'Review loop repairing failed checks',
      )
      await agent.prompt({ system, prompt: buildRepairPrompt(failures, round), agent: 'build' })
    },
  })

const runMutation = (input: PhaseInput, agent: OpenCodeAgent, system: string): Promise<MutationImproveResult> =>
  runMutationImprove({
    check: input.deps.config.mutationCheck,
    run: input.deps.runCheck,
    threshold: input.deps.config.mutationThreshold,
    maxRounds: input.deps.config.maxMutationRounds,
    improve: async (report, round) => {
      input.deps.log.warn(
        { issue: input.state.issueId, round, score: report.score },
        'Mutation loop strengthening tests',
      )
      await agent.prompt({ system, prompt: buildMutationPrompt(report, round), agent: 'build' })
    },
  })

const commitMessage = (issueNumber: number, review: ReviewLoopResult): string =>
  [
    `feat(agent): implement issue #${issueNumber}`,
    '',
    `Review loop: ${review.passed ? 'green' : `red after ${review.rounds} round(s)`}.`,
    `Refs #${issueNumber}`,
  ].join('\n')

const renderReport = (review: ReviewLoopResult, mutation: MutationImproveResult): string => {
  const score = mutation.finalScore === null ? 'not reported' : `${(mutation.finalScore * 100).toFixed(1)}%`
  const lines = [
    '### Implementation report',
    '',
    `- Review loop: ${review.passed ? '✅ green' : '❌ red'} after ${review.rounds} round(s)`,
    `- Mutation score: ${score} (${mutation.passed ? '✅ above' : '❌ below'} threshold, ${mutation.rounds} round(s))`,
  ]

  if (!review.passed) {
    lines.push('', '<details><summary>Failing checks</summary>', '', formatFailures(review.failures), '', '</details>')
  }

  return lines.join('\n')
}
