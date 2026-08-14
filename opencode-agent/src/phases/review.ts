// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { renderArtifact, REPORT_MARKER } from '../artifacts.js'
import { branchNameFor } from '../git.js'
import { fence } from '../markdown.js'
import type { PhaseHandler, PhaseInput, PhaseOutcome } from '../phase-context.js'
import { renderPresentation } from '../pull-request-body.js'
import type { ReviewOutcome, ReviewRunResult } from '../review-runner.js'
import { errorMessage } from '../types.js'
import type { AgentState } from '../types.js'
import { createPush } from './review-push.js'

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
  // Not optional, and this is the difference from the review that used to run
  // inside phase 3: that one always had the tree it had just written, while this
  // one usually runs in a job that implemented nothing at all, where the remote
  // branch is the only copy. `ensureBranch` fast-forwards an existing remote
  // branch and cuts a fresh one otherwise, so the same call serves both.
  //
  // It comes **first**, before the plan is read: the folder that plan is in is
  // on this branch and nowhere else, and the job's workspace starts on the base
  // branch (`actions/checkout` takes no ref — switching branches is this
  // pipeline's job, not the workflow's). Reading it a line earlier read the base
  // branch's `openspec/changes/`, where this change does not exist.
  const branch = branchNameFor(state.issueId)
  await deps.git.ensureBranch(branch, await deps.baseBranch())

  // The plan, exactly as the implementation phase reads it: the loop reviews
  // the work against what was approved, read from the folder's `tasks.md`
  // (design D1) rather than a block on the issue.
  const plan = await planFromFolder(input)

  const { review, applied } = await runAndKeep(input, plan, branch)

  const verdict = reviewLine(review)
  const report = renderReport(review, applied, verdict)
  await refreshPullRequest(input, report)
  // No pointer comment beside this any more. `noteReview` existed for exactly one
  // reason — a `/review` typed on the pull request had its report posted to the
  // issue, so the page the maintainer was reading needed a line saying where the
  // verdict went. Under D4 the report is posted here, on this pull request, and a
  // note pointing at the issue would send a reader to a page that no longer has
  // it. The module went with it.
  return { signal: 'REVIEW_DONE', comment: report, blocks: [reportBlock(report, state)] }
}

/**
 * Runs the loop and keeps whatever it produced, however it ended.
 *
 * A clean tree is a **result**, not a failure: it means the loop found nothing
 * to change, which is the outcome a reviewer most wants to hear.
 *
 * But a clean tree is *also* what the loop leaves behind when it found plenty:
 * it commits its fixes in its own worktree and merges them into this checkout
 * itself, so `commitAll` — which reports only what *this process* staged —
 * answers `null` for both. Reading that as "nothing to apply" is what left every
 * finding the loop ever made unpushed, on a branch in a checkout that dies with
 * the job. So the question is asked of the **branch**: did `HEAD` move, by
 * anyone's hand, since before the loop ran.
 *
 * `commitAll` still runs, for whatever the loop left uncommitted, and this phase
 * deliberately does nothing with the totals it hands back: `changedLines` sizes
 * the recommendation to run *this*, so a review updating it would have the hint
 * describe the diff after the second pass it was arguing for.
 */
const runAndKeep = async (
  input: PhaseInput,
  plan: string,
  branch: string,
): Promise<{ review: ReviewRunResult; applied: boolean }> => {
  const { deps, state } = input

  // Opened before the loop, because what it measures is the loop: the branch as
  // it stood before any finding was applied.
  const durable = createPush(input, branch)
  const review = await deps.runReview(plan, durable.onFixMerged)
  // Every push the loop's markers asked for, before anything reads the branch:
  // they are issued on a chain rather than awaited at the call site, so that a
  // fix becomes durable as it lands rather than at the end of the hour.
  await durable.settled()

  const staged = await deps.git.commitAll(reviewMessage(state.issueId))
  const applied = await durable.push(staged.kind === 'committed')

  deps.log.info(
    { issue: state.issueId, branch, review: review.outcome, applied, staged: staged !== null },
    'Review finished',
  )

  return { review, applied }
}

/**
 * The approved plan, read from the folder's `tasks.md` (design D1).
 *
 * Same read the implementation phase makes: the loop reviews the work against
 * what was approved, not against the issue's prose, and the approved plan lives
 * on the branch now rather than in an `AGENT_PLAN` block on the issue.
 */
const planFromFolder = async (input: PhaseInput): Promise<string> => {
  const { deps, state } = input
  if (state.changeName === null) throw new Error('CODE_REVIEW reached without a changeName on the state')
  const tasksPath = (await deps.openspec.instructions('tasks', state.changeName)).resolvedOutputPath
  return deps.readFile(tasksPath)
}

/**
 * Brings the pull request back in step with what the review just found, and is
 * this module's one door to GitHub — so, per the workspace rule, it swallows
 * everything.
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
 *
 * Best-effort, and the asymmetry with `handleDeliver` is the point: there the
 * very same `updatePullRequest` **is** the work, so a rejection is correctly
 * fatal and correctly resumed from `PR_DELIVERY`. Here the work is already done
 * and pushed — the loop has run, its findings are commits on the branch — and
 * this call only re-renders a body around them. Letting it throw parked the
 * issue in `FAILED` with `resumeFrom: CODE_REVIEW`, so the `/retry` the failure
 * comment invites re-ran the *entire* review loop, every `opencode run`
 * subprocess of it and another round off `AGENT_MAX_REVIEW_ATTEMPTS`, to repair
 * a decoration. The cost is the one `labels.ts` states and accepts: a bug in
 * here degrades to the same `warn` as a 403, so the test that proves the write
 * happens is what stands in for the crash that no longer does.
 */
const refreshPullRequest = async (input: PhaseInput, report: string): Promise<void> => {
  const { deps, state } = input
  if (state.prNumber === null) {
    deps.log.warn({ issue: state.issueId }, 'Reviewed an issue with no pull request to refresh')
    return
  }

  try {
    await deps.github.updatePullRequest(state.prNumber, renderPresentation(input.issue, state, report))
  } catch (error) {
    deps.log.warn(
      { issue: state.issueId, pr: state.prNumber, error: errorMessage(error) },
      'Could not refresh the pull request after the review; its findings are pushed either way',
    )
  }
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

const REVIEW_LINE: Record<ReviewOutcome, (review: ReviewRunResult) => string> = {
  passed: () => '✅ clean',
  // The exit code alone was the whole verdict here, and it is the one thing
  // nobody can act on: a build gate, a runner deadline, a missing binary and an
  // unresolvable plan path are all `exited 1`. `describeFailure` names which,
  // and the fallback keeps the old wording for a failure it cannot classify.
  failed: (review) => `❌ ${review.failure ?? `exited ${review.exitCode}`}`,
  // Not a failure: this repository simply has no review loop configured, and
  // saying "❌" for that would report every run elsewhere as permanently red.
  unavailable: () => '— not configured for this repository',
}

/**
 * The one verdict on the loop, read by the report and by the pull-request note.
 *
 * A function rather than two lookups of {@link REVIEW_LINE}, because the two
 * readers are in different modules and the note's shape is "hand it the string"
 * for exactly this reason: one table with two readers cannot disagree with
 * itself, and a second table over `ReviewOutcome` eventually would.
 */
const reviewLine = (review: ReviewRunResult): string => REVIEW_LINE[review.outcome](review)

/**
 * A red loop is reported and does not block, exactly as it did inside phase 3.
 *
 * CI on the pull request is the gate, and the CI-fix loop is what acts on it; a
 * finding the loop could not fix is something for a human to read, not a reason
 * to park an issue whose work is already pushed.
 */
const renderReport = (review: ReviewRunResult, applied: boolean, verdict: string): string => {
  const lines = [
    '### Review report',
    '',
    `- Review loop: ${verdict}`,
    `- Findings applied: ${applied ? 'pushed as further commits on the branch' : 'nothing to apply'}`,
  ]

  // Said once more, in its own line, when the loop broke *and* kept something:
  // the verdict above reads as the loop's own summary of the review, and a
  // reader who sees findings on the branch needs to know they are partial.
  if (review.outcome === 'failed' && applied) {
    lines.push('', 'The loop stopped early — what it had already fixed is on the branch, the rest is not.')
  }

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
