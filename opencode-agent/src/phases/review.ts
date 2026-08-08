// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { PLAN_MARKER, renderArtifact, REPORT_MARKER, requireArtifact } from '../artifacts.js'
import { missingPlanError } from '../errors.js'
import { branchNameFor } from '../git.js'
import { fence } from '../markdown.js'
import type { PhaseHandler, PhaseInput, PhaseOutcome } from '../phase-context.js'
import { renderPresentation } from '../pull-request-body.js'
import type { ReviewOutcome, ReviewRunResult } from '../review-runner.js'
import type { AgentState } from '../types.js'

/**
 * The `review-loop/` workspace, as a phase of its own.
 *
 * It used to run inside phase 3, between the implementation commit and the
 * push, which made three separate problems out of one arrangement: a review that
 * broke discarded an implementation that had not, every task paid the loop's
 * wall clock before anybody saw a diff, and `/retry` re-ran the model turn that
 * had already succeeded. Here the branch is pushed, the pull request is open,
 * and a failure costs the review and nothing else — `resumeFrom` names
 * `CODE_REVIEW`, so `/retry` re-runs exactly this and re-implements nothing.
 *
 * This phase drives that workspace through `review-runner.ts` and does not
 * reimplement a thinner version of it; `check-loop.ts` exists only for CI
 * fixing, which the workspace does not cover.
 */
export const handleReview: PhaseHandler = async (input): Promise<PhaseOutcome> => {
  const { deps, state } = input
  // The plan, exactly as the implementation phase reads it: the loop reviews
  // the work against what was approved, not against the issue's prose.
  const plan = requireArtifact(input.thread, await deps.selfLogin(), PLAN_MARKER, () => missingPlanError(state.issueId))

  // Not optional, and this is the difference from the review that used to run
  // inside phase 3: that one always had the tree it had just written, while this
  // one usually runs in a job that implemented nothing at all, where the remote
  // branch is the only copy. `ensureBranch` fast-forwards an existing remote
  // branch and cuts a fresh one otherwise, so the same call serves both.
  const branch = branchNameFor(state.issueId)
  await deps.git.ensureBranch(branch, await deps.baseBranch())

  const review = await deps.runReview(plan)

  // A clean tree is a **result**, not a failure: it means the loop found nothing
  // to change, which is the outcome a reviewer most wants to hear. So it is
  // reported and the phase still completes — and nothing is pushed, because
  // there is nothing to push.
  const committed = await deps.git.commitAll(reviewMessage(state.issueId))
  if (committed) await deps.git.push(branch)

  deps.log.info({ issue: state.issueId, branch, review: review.outcome, committed }, 'Review finished')

  const report = renderReport(review, committed)
  await refreshPullRequest(input, report)

  return { signal: 'REVIEW_DONE', comment: report, blocks: [reportBlock(report, state)] }
}

/**
 * Brings the pull request back in step with what the review just found.
 *
 * The report is handed over rather than read back out of the thread, because
 * `postAndAppend` runs in the orchestrator *after* this handler returns: a
 * handler cannot see its own block, so a renderer that scanned for one would
 * present the implementation report on a pull request the review has since
 * changed. One renderer for delivery and for here — see `pull-request-body.ts`.
 *
 * The `null` branch is unreachable by construction: `COMPLETE` is the only phase
 * `REVIEW_REQUESTED` moves from, and `commands.ts` refuses `/review` there
 * without a pull request. It is narrowed rather than asserted because that is a
 * rule in another module, and a warn beats a crash if it ever loosens.
 */
const refreshPullRequest = async (input: PhaseInput, report: string): Promise<void> => {
  const { deps, state } = input
  if (state.prNumber === null) {
    deps.log.warn({ issue: state.issueId }, 'Reviewed an issue with no pull request to refresh')
    return
  }

  await deps.github.updatePullRequest(state.prNumber, renderPresentation(input.issue, state, report))
}

/**
 * The review report replaces the implementation one under `AGENT_REPORT`.
 *
 * `findArtifact` takes the newest block of a marker, so this is what a later
 * delivery refresh will present — which is what keeps the pull request body and
 * the issue thread telling the same story. It carries `planRevision` for the
 * reason the implementation report does: the figure records which plan the work
 * was measured against, and no signal bumps a report counter.
 */
const reportBlock = (report: string, state: AgentState): string =>
  renderArtifact(REPORT_MARKER, report, state.planRevision)

const reviewMessage = (issueNumber: number): string =>
  `fix(agent): apply review-loop findings for issue #${issueNumber}\n\nRefs #${issueNumber}`

const REVIEW_LINE: Record<ReviewOutcome, (exitCode: number) => string> = {
  passed: () => '✅ clean',
  failed: (exitCode) => `❌ exited ${exitCode}`,
  // Not a failure: this repository simply has no review loop configured, and
  // saying "❌" for that would report every run elsewhere as permanently red.
  unavailable: () => '— not configured for this repository',
}

/**
 * A red loop is reported and does not block, exactly as it did inside phase 3.
 *
 * CI on the pull request is the gate, and the CI-fix loop is what acts on it; a
 * finding the loop could not fix is something for a human to read, not a reason
 * to park an issue whose work is already pushed.
 */
const renderReport = (review: ReviewRunResult, committed: boolean): string => {
  const lines = [
    '### Review report',
    '',
    `- Review loop: ${REVIEW_LINE[review.outcome](review.exitCode)}`,
    `- Findings applied: ${committed ? 'pushed as further commits on the branch' : 'nothing to apply'}`,
  ]

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
