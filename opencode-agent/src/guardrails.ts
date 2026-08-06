// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

/** Author associations GitHub reports for accounts with write access. */
export const MAINTAINER_ASSOCIATIONS: ReadonlySet<string> = new Set(['OWNER', 'MEMBER', 'COLLABORATOR'])

const senderSchema = z.object({ login: z.string().min(1), type: z.string().default('User') })

const issueSchema = z.object({
  number: z.number().int().positive(),
  title: z.string().default(''),
  body: z.string().nullable().default(null),
  author_association: z.string().default('NONE'),
  pull_request: z.unknown().optional(),
})

const commentSchema = z.object({
  id: z.number().int(),
  body: z.string().nullable().default(null),
  author_association: z.string().default('NONE'),
})

const eventPayloadSchema = z.object({
  action: z.string().default(''),
  sender: senderSchema,
  issue: issueSchema,
  comment: commentSchema.optional(),
  repository: z
    .object({ owner: z.object({ login: z.string() }), name: z.string(), default_branch: z.string().default('main') })
    .optional(),
})

/** The normalized slice of a webhook payload the pipeline actually reads. */
export interface TriggerEvent {
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
  repositoryName: string | null
  defaultBranch: string
}

export type GuardrailCode =
  | 'UNSUPPORTED_EVENT'
  | 'UNSUPPORTED_ACTION'
  | 'PULL_REQUEST'
  | 'BOT_SENDER'
  | 'SELF_RECURSION'
  | 'NOT_MAINTAINER'

export type GuardrailDecision = { allowed: true } | { allowed: false; code: GuardrailCode; reason: string }

const SUPPORTED: Record<string, ReadonlySet<string>> = {
  issues: new Set(['opened']),
  issue_comment: new Set(['created']),
}

/**
 * Normalizes a raw webhook payload. Returns `null` when the payload does not
 * carry an issue at all (for example a `workflow_dispatch` smoke run), which the
 * caller treats as "nothing to do" rather than an error.
 */
export const parseTriggerEvent = (eventName: string, payload: unknown): TriggerEvent | null => {
  const parsed = eventPayloadSchema.safeParse(payload)
  if (!parsed.success) return null

  const { action, sender, issue, comment, repository } = parsed.data
  const association = comment === undefined ? issue.author_association : comment.author_association

  return {
    eventName,
    action,
    senderLogin: sender.login,
    senderType: sender.type,
    authorAssociation: association,
    issueNumber: issue.number,
    issueTitle: issue.title,
    issueBody: issue.body ?? '',
    isPullRequest: issue.pull_request !== undefined && issue.pull_request !== null,
    commentBody: comment === undefined ? null : comment.body,
    repositoryOwner: repository === undefined ? null : repository.owner.login,
    repositoryName: repository === undefined ? null : repository.name,
    defaultBranch: repository === undefined ? 'main' : repository.default_branch,
  }
}

export interface GuardrailOptions {
  /**
   * Login treated as "the agent itself". Any event it raises is dropped so the
   * agent's own comments cannot re-trigger the pipeline. Defaults to the
   * repository owner, per the spike spec; override via `AGENT_SELF_LOGIN` when
   * the owner is also the human maintainer driving the issue.
   */
  selfLogin: string
}

/**
 * Applies every abort rule in one place, in the order a reviewer expects to read
 * them: shape of the event, then recursion guards, then authorization.
 */
export const evaluateGuardrails = (event: TriggerEvent, options: GuardrailOptions): GuardrailDecision => {
  const structural = checkEventShape(event)
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

const checkEventShape = (event: TriggerEvent): GuardrailDecision | null => {
  const actions = SUPPORTED[event.eventName]
  if (actions === undefined) return deny('UNSUPPORTED_EVENT', `Event ${event.eventName} is not handled`)
  if (!actions.has(event.action)) {
    return deny('UNSUPPORTED_ACTION', `Action ${event.eventName}.${event.action} is not handled`)
  }
  if (event.isPullRequest) return deny('PULL_REQUEST', 'Comment target is a pull request, not an issue')
  return null
}

const deny = (code: GuardrailCode, reason: string): GuardrailDecision => ({
  allowed: false,
  code,
  reason,
})
