// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { parseSlashCommand } from './commands.js'
import { issueNumberFromBranch } from './git.js'
import type { GitHubApi } from './github.js'
import type { Logger } from './logger.js'

/**
 * The pull-request door: what a comment typed on a pull request *is*, and how it
 * becomes the issue it belongs to.
 *
 * State lives in hidden blocks on the **issue** and the restore scan reads the
 * issue thread, so a pull-request comment has to name its issue before anything
 * else in this pipeline can run — and the payload does not carry one:
 * `github.event.issue.number` there is the pull request. The one link is the
 * branch, exactly as it is for a red CI run: `head.ref` is `agent/issue-<n>`,
 * and `issueNumberFromBranch` already parses that shape.
 *
 * Reading `head.ref` costs an API call, which is why this is a second step
 * rather than a branch of the pure `parseTriggerEvent`, and why the order of the
 * checks below is the design rather than a preference. The two shapes live here
 * with the resolver rather than beside the other events, because what separates
 * them — a pull request number where an issue number should be — is the whole of
 * why this door needs a second step at all. `trigger-events.ts` parses the
 * payload into the first of them, as it parses the other two kinds.
 */

/**
 * What a comment typed on a pull request carries, before and after resolution.
 *
 * `prNumber` is `issue.number` on this payload; `commentBody` is never `null`,
 * an absent body being an empty one that carries no command; `commentId` is
 * never absent, because a payload with no comment is not one of these at all;
 * and `defaultBranch` is `null` when the payload omitted the repository.
 */
interface PullRequestCommentFields {
  eventName: string
  action: string
  senderLogin: string
  senderType: string
  authorAssociation: string
  prNumber: number
  commentBody: string
  commentId: number
  defaultBranch: string | null
}

/**
 * A comment on a pull request, parsed as far as a payload alone allows.
 *
 * Every block of state lives on the **issue**, and this payload names none:
 * `github.event.issue.number` here is the pull request. The one link is the
 * branch, as it is for CI, and reading it costs an API call — which is why this
 * is a stop on the way. `resolvePullRequestTrigger` finishes the job.
 */
export interface PendingPullRequestEvent extends PullRequestCommentFields {
  kind: 'pending-pull-request'
  /**
   * `repository.full_name`, or `null` when the payload omitted it.
   *
   * Not defaulted, for the reason `CiTriggerEvent.fromThisRepository` is not:
   * this is the name the head repository is compared against, and an
   * invented one would wave through the fork the comparison exists to catch.
   */
  repositoryFullName: string | null
}

/**
 * A resolved pull-request comment: a maintainer's command, on a pull request
 * whose branch names the issue this run will answer on.
 *
 * A third member of `TriggerEvent` and deliberately not a flag on
 * `IssueTriggerEvent`: `resolveIssue` reads the issue's title and body
 * straight off that shape, and this payload carries the **pull request's** — so
 * a flag hands every phase the wrong document under the right field names.
 */
export interface PullRequestTriggerEvent extends PullRequestCommentFields {
  kind: 'pull-request'
  /** The issue `head.ref` named, which is where the report and the state go. */
  issueNumber: number
}

/**
 * This door used to admit `/review` and nothing else, on the argument that a
 * wider surface turns a command naming a branch into a conversation whose answer
 * lands somewhere else.
 *
 * What changed is the other end: once a pull request exists it is the surface the
 * agent labels, reports progress on and is watched from, and `triggers.ts` now
 * refuses commands typed on the *issue* there. One command through this door and
 * a refusal through the other would leave `/retry`, `/cancel` and `/ask` with
 * nowhere at all to be typed. So the parse is "does this carry a command", and
 * which commands the state accepts is decided once, by `applyCommand`, for both
 * doors — a narrowing here would be a second, quieter answer to a question that
 * already has one.
 *
 * The cheap-filter property this ordering exists for is unchanged: a comment
 * with no command still costs one parse and no API call, which is what keeps
 * every ordinary code-review comment on every pull request free.
 */

/**
 * Why a pull-request comment got no further than this module.
 *
 * Named as guardrail codes and folded into `guardrails.ts`'s `GuardrailCode`,
 * although `evaluateGuardrails` never returns one: a refusal is a refusal, and
 * "why was this run dropped?" is a single vocabulary a reader greps for rather
 * than two. They are decided here because only this layer has the answer —
 * three of the four are facts about the pull request no payload carries.
 */
export type PullRequestRefusal = 'PR_NO_COMMAND' | 'PR_FOREIGN_REPOSITORY' | 'PR_NOT_OPEN' | 'PR_NOT_AGENT_BRANCH'

/** Records a refusal and drops the event. `null` is "nothing to do", as everywhere. */
const refuse = (log: Logger, pending: PendingPullRequestEvent, code: PullRequestRefusal, reason: string): null => {
  log.warn({ code, pr: pending.prNumber, reason }, 'Refused a pull-request comment')
  return null
}

/**
 * Resolves a pending pull-request comment, or drops it.
 *
 * In this order, and the order is the point:
 *
 * 1. **A slash command, or nothing.** Parsed with `parseSlashCommand`, which
 *    requires the command to start a line and ignores fenced blocks, so quoting
 *    the agent's own instructions does not fire it. Anything else is dropped with
 *    no API call at all — every pull request in a repository gets ordinary review
 *    comments, and this is the filter that keeps every one of them free.
 * 2. **The head, from the API**, because nothing on the payload carries it.
 * 3. **The head repository is this one, or refuse.** This is the fork guard and
 *    it is not tidiness. `head.ref` is attacker-controlled: a pull request
 *    opened from a fork whose branch is named `agent/issue-42` looks, to every
 *    other field here, exactly like the agent's own — so without this, anyone
 *    who can open a pull request could type `/review` and buy a privileged job
 *    that prompts the model, spends the issue's token budget and pushes commits
 *    to a real agent branch. `CI_FOREIGN_REPOSITORY` exists for the same attack
 *    arriving through a red check run.
 * 4. **The pull request is open, or refuse.** A merged or closed one has nothing
 *    left to review: the loop's findings would land as commits on a branch
 *    nobody will merge again, which is the same argument `settledPullRequest`
 *    makes about spending a CI-fix round there.
 * 5. **The branch names an issue, or refuse.** A pull request the agent did not
 *    open has no state block, no plan to review against and no thread to answer
 *    on.
 *
 * A failing lookup is deliberately **not** caught. Everything this pipeline
 * swallows is decoration on work that matters; this call is the opposite — it is
 * the only thing that says which issue the run is about, and the fork guard
 * reads its answer. A rejection here has to reach `runCli` and leave the job
 * red, where the workflow's fallback comment explains the silence, rather than
 * degrade into a skip indistinguishable from a comment nobody typed.
 */
export const resolvePullRequestTrigger = async (
  pending: PendingPullRequestEvent,
  github: Pick<GitHubApi, 'getPullRequestHead'>,
  log: Logger,
): Promise<PullRequestTriggerEvent | null> => {
  const command = parseSlashCommand(pending.commentBody)
  if (command === null) {
    // Not a `warn`, unlike every other exit here: this is the expected outcome
    // for almost every comment on almost every pull request, and it is what the
    // step above it buys — a log line rather than a lookup.
    log.debug({ code: 'PR_NO_COMMAND', pr: pending.prNumber }, 'Pull-request comment carries no slash command')
    return null
  }

  const head = await github.getPullRequestHead(pending.prNumber)

  if (pending.repositoryFullName === null || head.repoFullName !== pending.repositoryFullName) {
    const reason = `Pull request #${pending.prNumber} merges from ${head.repoFullName || 'an unnamed repository'}`
    return refuse(log, pending, 'PR_FOREIGN_REPOSITORY', `${reason}, not from this one`)
  }

  if (head.state !== 'open') {
    return refuse(log, pending, 'PR_NOT_OPEN', `Pull request #${pending.prNumber} is ${head.state}`)
  }

  const issueNumber = issueNumberFromBranch(head.ref)
  if (issueNumber === null) {
    return refuse(log, pending, 'PR_NOT_AGENT_BRANCH', `Branch ${head.ref} is not owned by the agent`)
  }

  const { kind: _pending, repositoryFullName: _compared, ...carried } = pending
  log.info({ pr: pending.prNumber, issue: issueNumber, branch: head.ref }, 'Resolved a pull-request comment')

  return { kind: 'pull-request', issueNumber, ...carried }
}
