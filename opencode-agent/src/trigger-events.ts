// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { issueNumberFromBranch } from './git.js'
import type { PendingPullRequestEvent, PullRequestTriggerEvent } from './pr-trigger.js'

/**
 * What a raw webhook payload becomes, and the parse that makes it so.
 *
 * Split from `guardrails.ts` when the pull-request door arrived, along the seam
 * that file always had: *what an event is* and *whether the pipeline may act on
 * it* are two questions, and only the second is a policy. The split is what lets
 * `pr-trigger.ts` finish a parse — a pull-request comment names no issue until
 * an API call says which one — without importing the policy layer that will
 * judge the finished event, which would be a cycle. Every shape here comes from
 * a `safeParse` naming only the fields the pipeline reads; nothing is trusted by
 * being present on a payload.
 */

/** A human acting on the issue thread. Subject to the maintainer guardrails. */
export interface IssueTriggerEvent {
  kind: 'issue'
  eventName: string
  action: string
  senderLogin: string
  senderType: string
  authorAssociation: string
  issueNumber: number
  issueTitle: string
  issueBody: string
  isPullRequest: boolean
  commentBody: string | null
  /**
   * Id of the comment that raised this run; `null` for `issues.opened`, which
   * has no comment to address.
   *
   * The schema below has always parsed it and this function always threw it
   * away, which left the pipeline unable to address the one place the person
   * waiting is actually looking. Carried now so feedback can land there rather
   * than on the issue as a whole.
   */
  commentId: number | null
  repositoryOwner: string | null
  /** `repository.default_branch`; `null` when the payload omitted it. */
  defaultBranch: string | null
}

/**
 * A completed check run on a branch the agent owns. Not subject to the
 * maintainer guardrails — nobody "sent" it — but gated on the branch belonging
 * to this pipeline.
 */
export interface CiTriggerEvent {
  kind: 'ci'
  eventName: string
  action: string
  branch: string
  issueNumber: number
  conclusion: string
  workflowName: string
  runUrl: string
  /**
   * Whether the run that went red was on a branch of **this** repository.
   *
   * `head_branch` is attacker-controlled: a fork's branch name reaches this
   * payload verbatim, so anyone can open a pull request from a branch called
   * `agent/issue-42` and have its failing CI look, to every other field here,
   * exactly like the agent's own branch going red.
   */
  fromThisRepository: boolean
  /** `repository.default_branch`; `null` when the payload omitted it. */
  defaultBranch: string | null
}

export type TriggerEvent = IssueTriggerEvent | CiTriggerEvent | PullRequestTriggerEvent

/** What {@link parseTriggerEvent} yields: an event, or one still short an issue. */
export type ParsedTrigger = TriggerEvent | PendingPullRequestEvent

const issuePayloadSchema = z.object({
  action: z.string().default(''),
  sender: z.object({ login: z.string().min(1), type: z.string().default('User') }),
  issue: z.object({
    number: z.number().int().positive(),
    title: z.string().default(''),
    body: z.string().nullable().default(null),
    author_association: z.string().default('NONE'),
    pull_request: z.unknown().optional(),
  }),
  comment: z
    .object({
      id: z.number().int(),
      body: z.string().nullable().default(null),
      author_association: z.string().default('NONE'),
    })
    .optional(),
  repository: z
    .object({
      owner: z.object({ login: z.string() }),
      name: z.string(),
      // Not defaulted: an absent default branch has to stay visibly absent so
      // config resolution falls through to git instead of inheriting a guess.
      default_branch: z.string().min(1).optional(),
    })
    .optional(),
})

const ciPayloadSchema = z.object({
  action: z.string().default(''),
  workflow_run: z.object({
    name: z.string().default(''),
    head_branch: z.string().nullable().default(null),
    conclusion: z.string().nullable().default(null),
    html_url: z.string().default(''),
    // Absent on a payload shape that predates this check, and absent is not
    // trusted: `fromThisRepository` below resolves it to `false`.
    head_repository: z.object({ full_name: z.string().default('') }).optional(),
  }),
  repository: z.object({ default_branch: z.string().min(1).optional(), full_name: z.string().default('') }).optional(),
})

/**
 * The narrower half of {@link issuePayloadSchema}: the payload that can carry a
 * typed command on a pull request. `action` is a literal and `comment` is
 * required, so everything else pull-request-shaped fails here and falls through
 * to the issue path, where `UNSUPPORTED_ACTION` and the `PULL_REQUEST` denial
 * have always covered it — an `issue_comment.edited` must not buy a lookup to
 * resolve a comment nobody typed now.
 */
const pullRequestPayloadSchema = z.object({
  action: z.literal('created'),
  sender: z.object({ login: z.string().min(1), type: z.string().default('User') }),
  issue: z.object({
    number: z.number().int().positive(),
    author_association: z.string().default('NONE'),
    pull_request: z.unknown(),
  }),
  comment: z.object({
    id: z.number().int(),
    body: z.string().nullable().default(null),
    author_association: z.string().default('NONE'),
  }),
  repository: z.object({ full_name: z.string().default(''), default_branch: z.string().min(1).optional() }).optional(),
})

const parseIssueEvent = (eventName: string, payload: unknown): IssueTriggerEvent | null => {
  const parsed = issuePayloadSchema.safeParse(payload)
  if (!parsed.success) return null

  const { action, sender, issue, comment, repository } = parsed.data
  return {
    kind: 'issue',
    eventName,
    action,
    senderLogin: sender.login,
    senderType: sender.type,
    // For a comment event the *commenter's* rights decide, not the issue author's.
    authorAssociation: comment === undefined ? issue.author_association : comment.author_association,
    issueNumber: issue.number,
    issueTitle: issue.title,
    issueBody: issue.body ?? '',
    isPullRequest: issue.pull_request !== undefined && issue.pull_request !== null,
    commentBody: comment === undefined ? null : comment.body,
    commentId: comment === undefined ? null : comment.id,
    repositoryOwner: repository === undefined ? null : repository.owner.login,
    defaultBranch: repository?.default_branch ?? null,
  }
}

const parseCiEvent = (eventName: string, payload: unknown): CiTriggerEvent | null => {
  const parsed = ciPayloadSchema.safeParse(payload)
  if (!parsed.success) return null

  const { action, workflow_run: run, repository } = parsed.data
  const branch = run.head_branch
  if (branch === null) return null

  const issueNumber = issueNumberFromBranch(branch)
  if (issueNumber === null) return null

  return {
    kind: 'ci',
    eventName,
    action,
    branch,
    issueNumber,
    conclusion: run.conclusion ?? 'unknown',
    workflowName: run.name,
    runUrl: run.html_url,
    // Compared, never defaulted to true: two absent names would otherwise be
    // "equal" and wave through the very payload this exists to catch.
    fromThisRepository:
      run.head_repository !== undefined &&
      repository !== undefined &&
      run.head_repository.full_name.length > 0 &&
      run.head_repository.full_name === repository.full_name,
    defaultBranch: repository?.default_branch ?? null,
  }
}

/**
 * `null` for anything that is not a comment typed on a pull request. The schema
 * requires the `pull_request` key, so an issue comment fails it outright; an
 * explicit `null` there is the one shape that reaches the second check.
 */
const parsePullRequestEvent = (eventName: string, payload: unknown): PendingPullRequestEvent | null => {
  const parsed = pullRequestPayloadSchema.safeParse(payload)
  if (!parsed.success) return null

  const { action, sender, issue, comment, repository } = parsed.data
  if (issue.pull_request === null) return null

  const fullName = repository === undefined ? '' : repository.full_name
  return {
    kind: 'pending-pull-request',
    eventName,
    action,
    senderLogin: sender.login,
    senderType: sender.type,
    // The commenter's rights, as on the issue path: the pull request's own
    // author has nothing to do with who may command the agent from it.
    authorAssociation: comment.author_association,
    prNumber: issue.number,
    commentBody: comment.body ?? '',
    commentId: comment.id,
    // Empty reads as absent: an unnameable repository loses the fork comparison
    // rather than tying with a head whose name is also missing.
    repositoryFullName: fullName.length === 0 ? null : fullName,
    defaultBranch: repository?.default_branch ?? null,
  }
}

/**
 * Normalizes a raw webhook payload. Returns `null` when the payload carries
 * nothing the pipeline acts on — an unrelated branch, a run with no branch, a
 * dispatch with no issue — which the caller treats as "nothing to do".
 *
 * A pull-request comment is tried first and yields a
 * {@link PendingPullRequestEvent}, the one shape this function cannot finish:
 * the issue it belongs to is only knowable from the API.
 */
export const parseTriggerEvent = (eventName: string, payload: unknown): ParsedTrigger | null => {
  if (eventName === 'workflow_run' || eventName === 'check_suite') return parseCiEvent(eventName, payload)
  return parseIssueOrPullRequest(eventName, payload)
}

const parseIssueOrPullRequest = (eventName: string, payload: unknown): ParsedTrigger | null =>
  (eventName === 'issue_comment' ? parsePullRequestEvent(eventName, payload) : null) ??
  parseIssueEvent(eventName, payload)
