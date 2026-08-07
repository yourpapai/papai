// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { findArtifact, REPORT_MARKER } from '../artifacts.js'
import { react } from '../feedback.js'
import { branchNameFor } from '../git.js'
import type { PullRequestPresentation, PullRequestRef, PullRequestStatus } from '../github.js'
import type { PhaseHandler, PhaseInput, PhaseOutcome } from '../phase-context.js'
import type { AgentState } from '../types.js'

/**
 * Phase 4. Opens the pull request, refreshes the open one when a retry
 * re-enters this phase, or reports that the branch's pull request has already
 * been settled and stands down.
 *
 * Purely API-side — phase 3 already pushed the branch. That split is what makes
 * this phase resumable at all: it needs nothing from a working tree, so it
 * behaves identically in the job that implemented the work and in a fresh
 * runner three retries later.
 */
export const handleDeliver: PhaseHandler = async (input): Promise<PhaseOutcome> => {
  const { deps, state } = input
  const branch = branchNameFor(state.issueId)

  const existing = await deps.github.findPullRequest(branch)
  const settled = settledOutcome(existing)
  if (settled !== null) {
    deps.log.info({ issue: state.issueId, branch, pr: existing?.number, state: existing?.state }, 'Delivery stood down')
    return settled
  }

  // Rendered once and used by both live paths, so a reused pull request
  // presents exactly what a freshly opened one would.
  const presentation = await renderPresentation(input)
  const pr =
    existing === null
      ? await openPullRequest(input, branch, presentation)
      : await refresh(input, existing, presentation)

  deps.log.info({ issue: state.issueId, branch, pr: pr.number, reused: existing !== null }, 'Pull request ready')

  // 🚀 here rather than at the end of the run, because here is the only place
  // that knows the difference between a delivery and a stand-down: the settled
  // branch above reports the same `PR_OPENED` signal and reaches the same
  // `COMPLETE`, having opened and refreshed nothing. Both live paths below it
  // have produced a pull request, and the cascade goes straight to `COMPLETE`
  // from here, so "a run that finished having delivered one" is exactly this
  // line. Best-effort like every reaction — `react` cannot throw.
  await react(deps, input.trigger, 'rocket')

  return {
    signal: 'PR_OPENED',
    comment: renderDelivery(pr, existing !== null),
    patch: { prUrl: pr.url, prNumber: pr.number, ...(existing === null ? FRESH_CI_BUDGET : {}) },
  }
}

/**
 * The CI-fix budget, handed back to a pull request whose checks have not spent
 * any of it.
 *
 * `ciAttempts` and `ciBudgetReported` count rounds against *a pull request*, not
 * against the issue, and nothing used to reset either — `ciAttempts` was even
 * documented as "Never reset". So an issue that burned its rounds on one pull
 * request, said "I have stopped trying to fix CI", and then delivered a second
 * one got no CI fixing at all on the new one, and said nothing about it either:
 * `applyCiTrigger` short-circuits on `ciBudgetReported` before it even looks the
 * pull request up, so the give-up notice could not repeat and no fix round could
 * start. The remedy the notice suggests — push a fix yourself — is precisely
 * what leads here, through a maintainer reopening the work and the pipeline
 * delivering again.
 *
 * Applied on `existing === null` only, which is this phase's own distinction
 * between opening a pull request and refreshing one. A refreshed pull request is
 * the same pull request whose checks spent the budget, on the same branch and
 * the same commits; handing it a clean slate would let one red branch bounce off
 * the agent for as long as anyone keeps replying `/retry`, which is the runaway
 * `AGENT_MAX_CI_ATTEMPTS` exists to bound.
 */
const FRESH_CI_BUDGET: Partial<AgentState> = { ciAttempts: 0, ciBudgetReported: false }

/**
 * Ends delivery when the branch's pull request is no longer live.
 *
 * Neither outcome should produce a second pull request. A merged one means the
 * work landed; an unmerged closed one means a maintainer rejected it, and
 * re-opening the same diff would override that decision. Both would otherwise
 * come back from an open-only lookup as `null` — "no pull request" — and be
 * delivered again from a branch with nothing left to merge.
 */
const settledOutcome = (pr: PullRequestStatus | null): PhaseOutcome | null =>
  pr === null || pr.state === 'open'
    ? null
    : { signal: 'PR_OPENED', comment: renderSettled(pr), patch: { prUrl: pr.url, prNumber: pr.number } }

const SETTLED_REPORT: Record<'merged' | 'closed', (pr: PullRequestStatus) => readonly string[]> = {
  merged: (pr) => [
    '### Already merged',
    '',
    `Pull request ${pr.url} carried this work and has already merged, so there is nothing left to deliver.`,
  ],
  closed: (pr) => [
    '### Pull request was closed',
    '',
    `Pull request ${pr.url} was closed without merging, so I am not opening a replacement for the same branch.`,
    'Reopen it if you want me to carry on, or open a fresh issue for a different approach.',
  ],
}

const renderSettled = (pr: PullRequestStatus): string =>
  SETTLED_REPORT[pr.state === 'merged' ? 'merged' : 'closed'](pr).join('\n')

const openPullRequest = async (
  input: PhaseInput,
  branch: string,
  presentation: PullRequestPresentation,
): Promise<PullRequestRef> =>
  input.deps.github.createPullRequest({ head: branch, base: await input.deps.baseBranch(), ...presentation })

/** Brings a reused pull request back in step with the issue as it reads now. */
const refresh = async (
  input: PhaseInput,
  pr: PullRequestStatus,
  presentation: PullRequestPresentation,
): Promise<PullRequestRef> => {
  await input.deps.github.updatePullRequest(pr.number, presentation)
  return pr
}

const renderPresentation = async (input: PhaseInput): Promise<PullRequestPresentation> => {
  const report = findArtifact(input.thread, await input.deps.selfLogin(), REPORT_MARKER)

  return {
    title: `${input.issue.title} (#${input.state.issueId})`,
    body: [
      `Closes #${input.state.issueId}`,
      '',
      'Generated by the OpenCode issue agent from the design spec and execution plan approved on the issue.',
      '',
      report === null ? '_No implementation report was recorded._' : report.text,
    ].join('\n'),
  }
}

const renderDelivery = (pr: PullRequestRef, reused: boolean): string =>
  [
    '### Pull request ready',
    '',
    `${reused ? 'Refreshed' : 'Opened'} pull request: ${pr.url}`,
    '',
    'If its checks go red I will pick that up automatically and push a fix.',
    'This issue closes when the pull request merges.',
  ].join('\n')
