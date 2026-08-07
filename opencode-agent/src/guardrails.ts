// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { branchNameFor, issueNumberFromBranch } from './git.js'

/** Author associations GitHub reports for accounts with write access. */
export const MAINTAINER_ASSOCIATIONS: ReadonlySet<string> = new Set(['OWNER', 'MEMBER', 'COLLABORATOR'])

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
  /** `repository.default_branch`; `null` when the payload omitted it. */
  defaultBranch: string | null
}

export type TriggerEvent = IssueTriggerEvent | CiTriggerEvent

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
  }),
  repository: z.object({ default_branch: z.string().min(1).optional() }).optional(),
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
    defaultBranch: repository?.default_branch ?? null,
  }
}

/**
 * Normalizes a raw webhook payload. Returns `null` when the payload carries
 * nothing the pipeline acts on — an unrelated branch, a run with no branch, a
 * dispatch with no issue — which the caller treats as "nothing to do".
 */
export const parseTriggerEvent = (eventName: string, payload: unknown): TriggerEvent | null =>
  eventName === 'workflow_run' || eventName === 'check_suite'
    ? parseCiEvent(eventName, payload)
    : parseIssueEvent(eventName, payload)

export type GuardrailCode =
  | 'UNSUPPORTED_EVENT'
  | 'UNSUPPORTED_ACTION'
  | 'PULL_REQUEST'
  | 'BOT_SENDER'
  | 'SELF_RECURSION'
  | 'NOT_MAINTAINER'
  | 'CI_GREEN'
  | 'CI_SELF'
  | 'CI_FOREIGN_BRANCH'

export type GuardrailDecision = { allowed: true } | { allowed: false; code: GuardrailCode; reason: string }

export interface GuardrailOptions {
  /**
   * Login treated as "the agent itself". Any issue event it raises is dropped
   * so the agent's own comments cannot re-trigger the pipeline.
   */
  selfLogin: string
  /** Name of this pipeline's own workflow, so its failures do not feed itself. */
  selfWorkflowName: string
}

const SUPPORTED_ISSUE_ACTIONS: Record<string, ReadonlySet<string>> = {
  issues: new Set(['opened']),
  issue_comment: new Set(['created']),
}

const deny = (code: GuardrailCode, reason: string): GuardrailDecision => ({ allowed: false, code, reason })

const checkIssueShape = (event: IssueTriggerEvent): GuardrailDecision | null => {
  const actions = SUPPORTED_ISSUE_ACTIONS[event.eventName]
  if (actions === undefined) return deny('UNSUPPORTED_EVENT', `Event ${event.eventName} is not handled`)
  if (!actions.has(event.action)) {
    return deny('UNSUPPORTED_ACTION', `Action ${event.eventName}.${event.action} is not handled`)
  }
  if (event.isPullRequest) return deny('PULL_REQUEST', 'Comment target is a pull request, not an issue')
  return null
}

const evaluateIssueGuardrails = (event: IssueTriggerEvent, options: GuardrailOptions): GuardrailDecision => {
  const structural = checkIssueShape(event)
  if (structural !== null) return structural

  if (event.senderType.toLowerCase() === 'bot') {
    return deny('BOT_SENDER', `Sender ${event.senderLogin} is a Bot account`)
  }
  if (event.senderLogin.toLowerCase() === options.selfLogin.toLowerCase()) {
    return deny('SELF_RECURSION', `Sender ${event.senderLogin} is the agent identity`)
  }
  if (!MAINTAINER_ASSOCIATIONS.has(event.authorAssociation.toUpperCase())) {
    return deny('NOT_MAINTAINER', `Author association ${event.authorAssociation} lacks maintainer rights`)
  }

  return { allowed: true }
}

/**
 * A red check run only earns a fix attempt when it is red, belongs to a branch
 * this pipeline owns, and did not come from the pipeline's own workflow — that
 * last one is the recursion guard, since a failing agent job would otherwise
 * trigger an agent job.
 */
const evaluateCiGuardrails = (event: CiTriggerEvent, options: GuardrailOptions): GuardrailDecision => {
  if (event.conclusion !== 'failure') return deny('CI_GREEN', `Run concluded ${event.conclusion}, not failure`)
  if (event.workflowName === options.selfWorkflowName) {
    return deny('CI_SELF', 'Run belongs to the agent pipeline itself')
  }
  if (event.branch !== branchNameFor(event.issueNumber)) {
    return deny('CI_FOREIGN_BRANCH', `Branch ${event.branch} is not owned by the agent`)
  }
  return { allowed: true }
}

/** Applies every abort rule for the event's kind, in the order a reviewer expects. */
export const evaluateGuardrails = (event: TriggerEvent, options: GuardrailOptions): GuardrailDecision =>
  event.kind === 'issue' ? evaluateIssueGuardrails(event, options) : evaluateCiGuardrails(event, options)
