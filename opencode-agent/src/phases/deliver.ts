// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { findArtifact, REPORT_MARKER } from '../artifacts.js'
import { isPullRequestCreationForbidden, pullRequestForbiddenError } from '../errors.js'
import { react } from '../feedback.js'
import { branchNameFor } from '../git.js'
import type { PullRequestPresentation, PullRequestRef, PullRequestStatus } from '../github-pulls.js'
import type { PhaseHandler, PhaseInput, PhaseOutcome } from '../phase-context.js'
import { renderPresentation } from '../pull-request-body.js'
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
  const presentation = renderPresentation(input.issue, state, await deliveredReport(input))
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
    comment: renderDelivery({
      pr,
      reused: existing !== null,
      changedLines: state.changedLines,
      hintLines: deps.config.reviewHintLines,
    }),
    patch: { prUrl: pr.url, prNumber: pr.number, ...(existing === null ? FRESH_PR_BUDGETS : {}) },
  }
}

/**
 * The budgets that belong to a **pull request**, handed back to one that has not
 * spent any of them.
 *
 * `ciAttempts` and `ciBudgetReported` count rounds against a pull request, not
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
 * `reviewAttempts` joins them rather than getting a reset of its own, because it
 * is the same fact about the same thing: a `/review` round is spent on the diff
 * a pull request carries, so a genuinely new pull request has never had one.
 * Naming the constant for the *class* is what keeps a future per-pull-request
 * budget from being added to the state and forgotten here.
 *
 * Applied on `existing === null` only, which is this phase's own distinction
 * between opening a pull request and refreshing one. A refreshed pull request is
 * the same pull request whose checks spent the budget, on the same branch and
 * the same commits; handing it a clean slate would let one red branch bounce off
 * the agent for as long as anyone keeps replying `/retry`, which is the runaway
 * `AGENT_MAX_CI_ATTEMPTS` exists to bound — and `AGENT_MAX_REVIEW_ATTEMPTS`
 * bounds the same loop through the other door.
 */
const FRESH_PR_BUDGETS: Partial<AgentState> = { ciAttempts: 0, ciBudgetReported: false, reviewAttempts: 0 }

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

/**
 * Opens the pull request, translating the one refusal that is not a bug.
 *
 * Only that one: every other rejection goes up untouched, because the whole
 * value of the substitution is that it names a specific cause and the specific
 * settings that undo it. Widening it to any 403 would put those instructions in
 * front of a maintainer whose token simply lacks `pull-requests: write`, and send
 * them to tick a box that was never the problem.
 */
const openPullRequest = async (
  input: PhaseInput,
  branch: string,
  presentation: PullRequestPresentation,
): Promise<PullRequestRef> => {
  const base = await input.deps.baseBranch()

  try {
    return await input.deps.github.createPullRequest({ head: branch, base, ...presentation })
  } catch (error) {
    if (!isPullRequestCreationForbidden(error)) throw error
    throw pullRequestForbiddenError(compareUrl(input, base, branch), branch)
  }
}

/**
 * Where a human opens this pull request when the API will not.
 *
 * Built from `gitRemoteBase` rather than github.com, for the reason that field
 * exists at all: an Enterprise Server install answers on its own host, and a
 * link into the wrong one is worse than no link. Both branch names are computed
 * by this pipeline — `branchNameFor` and the configured base — so neither is
 * free text needing an escape.
 */
const compareUrl = (input: PhaseInput, base: string, head: string): string => {
  const { gitRemoteBase, owner, repo } = input.deps.config
  return `${gitRemoteBase}${owner}/${repo}/compare/${base}...${head}?expand=1`
}

/** Brings a reused pull request back in step with the issue as it reads now. */
const refresh = async (
  input: PhaseInput,
  pr: PullRequestStatus,
  presentation: PullRequestPresentation,
): Promise<PullRequestRef> => {
  await input.deps.github.updatePullRequest(pr.number, presentation)
  return pr
}

/** The newest report on the thread, which is what the pull request presents. */
const deliveredReport = async (input: PhaseInput): Promise<string | null> => {
  const report = findArtifact(input.thread, await input.deps.selfLogin(), REPORT_MARKER)
  return report === null ? null : report.text
}

/** Everything the delivery comment says, gathered so no renderer fetches. */
interface DeliveryView {
  pr: PullRequestRef
  reused: boolean
  /** Lines the implementation phase committed, as the diff guard measured them. */
  changedLines: number
  /** Diff size above which this comment recommends the review, not just names it. */
  hintLines: number
}

/**
 * What a delivered pull request says on the issue.
 *
 * `/review` is stated unconditionally rather than only when the diff looks big:
 * this is the comment a maintainer reads at the moment the pull request appears,
 * and a command nobody can discover is not a feature. It is also the honest
 * description of what has and has not happened — one model turn wrote this diff
 * and nothing has reviewed it.
 */
const renderDelivery = (view: DeliveryView): string =>
  [
    '### Pull request ready',
    '',
    `${view.reused ? 'Refreshed' : 'Opened'} pull request: ${view.pr.url}`,
    '',
    'If its checks go red I will pick that up automatically and push a fix.',
    'Nothing has reviewed the diff yet — reply **`/review`** here and I will run the review loop over the ' +
      'branch and push whatever it finds.',
    ...recommendation(view),
    'This issue closes when the pull request merges.',
  ].join('\n')

/**
 * The extra line a big diff earns, on top of the one every delivery carries.
 *
 * Two figures rather than a yes: a recommendation that states what it is based
 * on can be disagreed with, and the threshold is the operator's own
 * `AGENT_REVIEW_HINT_LINES`, so naming it is how a maintainer learns which knob
 * to turn when the advice reads wrong. The comparison happens here rather than
 * at commit time for the reason `changedLines` is a count and not a flag: the
 * config that decides is the one in force when the comment is written.
 */
const recommendation = (view: DeliveryView): readonly string[] =>
  view.changedLines < view.hintLines
    ? []
    : [
        `This one is ${view.changedLines} lines, past the ${view.hintLines} I treat as worth a second pass, ` +
          'so I would run it before merging.',
      ]
