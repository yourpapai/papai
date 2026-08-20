// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { unreachable } from './errors.js'
import { branchNameFor } from './git.js'
import type { PullRequestRefusal, PullRequestTriggerEvent } from './pr-trigger.js'
import type { CiTriggerEvent, IssueTriggerEvent, PrMergedTriggerEvent, TriggerEvent } from './trigger-events.js'

/**
 * Whether the pipeline may act on an event it has already understood.
 *
 * The shapes and the parse live in `trigger-events.ts`; what is left here is
 * policy, which is the half that has to be mirrored in the workflow's own `if:`
 * so an event this would reject never boots a runner with the API keys mounted.
 */

/** Author associations GitHub reports for accounts with write access. */
export const MAINTAINER_ASSOCIATIONS: ReadonlySet<string> = new Set(['OWNER', 'MEMBER', 'COLLABORATOR'])

/**
 * Every reason a trigger is dropped, in one vocabulary.
 *
 * The `PR_*` half is decided a layer earlier, in `pr-trigger.ts`, because
 * resolving a pull-request comment to its issue is what discovers those facts —
 * and a run refused there never reaches {@link evaluateGuardrails} at all. They
 * are named here anyway: "why was this event dropped?" is one question, and an
 * answer split across two vocabularies is one a reader has to know to ask twice.
 */
export type GuardrailCode =
  | 'UNSUPPORTED_EVENT'
  | 'UNSUPPORTED_ACTION'
  | 'PULL_REQUEST'
  | 'BOT_SENDER'
  | 'SELF_RECURSION'
  | 'NOT_MAINTAINER'
  | 'CI_GREEN'
  | 'CI_SELF'
  | 'CI_FOREIGN_REPOSITORY'
  | 'CI_FOREIGN_BRANCH'
  | PullRequestRefusal

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
  // Still the blanket refusal it always was, and it now covers exactly what is
  // left: a pull-request comment `resolvePullRequestTrigger` did not claim —
  // the wrong action, no comment at all, or a `/review` the resolver turned down
  // — falls back to this parse and is refused here as it has always been.
  if (event.isPullRequest) return deny('PULL_REQUEST', 'Comment target is a pull request, not an issue')
  return null
}

/** What every human-authored event carries, whichever door it arrived through. */
interface SenderFields {
  senderLogin: string
  senderType: string
  authorAssociation: string
}

/**
 * The three rules that apply to anything a person typed.
 *
 * Shared verbatim by the issue path and the pull-request one rather than
 * restated for each: a `/review` typed on a pull request is a human write with
 * exactly the reach an `/approve` on an issue has — it prompts the model, spends
 * the issue's token budget and pushes commits — so a rule that held on one door
 * and not on the other would be a hole in whichever was written second.
 */
const checkSender = (event: SenderFields, options: GuardrailOptions): GuardrailDecision => {
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

const evaluateIssueGuardrails = (event: IssueTriggerEvent, options: GuardrailOptions): GuardrailDecision => {
  const structural = checkIssueShape(event)
  return structural ?? checkSender(event, options)
}

/**
 * A red check run only earns a fix attempt when it is red, came from this
 * repository, belongs to a branch this pipeline owns, and did not come from the
 * pipeline's own workflow — that last one is the recursion guard, since a
 * failing agent job would otherwise trigger an agent job.
 *
 * The repository check is the one that is not about tidiness. `head_branch`
 * comes from the run that failed, and a pull request opened from a fork carries
 * that fork's branch name: name it `agent/issue-42`, let its checks go red, and
 * every other test here passes. Without this, anyone who can open a pull request
 * can start a privileged job that prompts the model, spends the issue's token
 * budget and pushes a commit to a real agent branch.
 *
 * Mirrored in the workflow's own `if:`, so the runner never boots with the API
 * keys mounted for an event this would reject anyway.
 */
const evaluateCiGuardrails = (event: CiTriggerEvent, options: GuardrailOptions): GuardrailDecision => {
  if (event.conclusion !== 'failure') return deny('CI_GREEN', `Run concluded ${event.conclusion}, not failure`)
  if (!event.fromThisRepository) {
    return deny('CI_FOREIGN_REPOSITORY', `Run on ${event.branch} came from another repository, not this one`)
  }
  if (event.workflowName === options.selfWorkflowName) {
    return deny('CI_SELF', 'Run belongs to the agent pipeline itself')
  }
  if (event.branch !== branchNameFor(event.issueNumber)) {
    return deny('CI_FOREIGN_BRANCH', `Branch ${event.branch} is not owned by the agent`)
  }
  return { allowed: true }
}

/**
 * A resolved pull-request comment is nothing but a human write.
 *
 * Everything structural about it was settled before this, and had to be in order
 * to know which issue the run is even about: `parseTriggerEvent` admits only an
 * `issue_comment` carrying a comment on a pull request, and
 * `resolvePullRequestTrigger` then settles the `/review`, the repository the
 * branch lives in, that pull request's state, and the branch name itself.
 *
 * The **action** is the one thing nothing here checks, unlike the issue path's
 * `SUPPORTED_ISSUE_ACTIONS`: the workflow's `on: issue_comment: types:
 * [created]` is the only constraint, and the `if:` arm mirrors that filter
 * rather than an in-process rule. There is no gap today — no other action
 * reaches this pipeline — but it is a constraint held in YAML alone, which is
 * worth knowing before anyone widens that `types:` list.
 *
 * What is left is the sender,
 * asked in the same words the issue path asks it — including the `confused`
 * reaction `NOT_MAINTAINER` earns, which is placed by `runPipeline` on the code
 * rather than on the kind and so needs nothing here to stay true.
 */
const evaluatePullRequestGuardrails = (event: PullRequestTriggerEvent, options: GuardrailOptions): GuardrailDecision =>
  checkSender(event, options)

/**
 * A merged pull request is a system event — nobody typed a command — so the
 * sender rules do not apply. The one structural guard the archive door (D7)
 * needs is the foreign-repo check, for the same reason the CI path needs it:
 * `head.ref` is attacker-controlled, and a fork whose branch is named
 * `agent/issue-42` must not archive into this repository.
 */
const evaluatePrMergedGuardrails = (event: PrMergedTriggerEvent): GuardrailDecision => {
  if (!event.fromThisRepository) {
    return deny('PR_FOREIGN_REPOSITORY', 'Merged pull request came from another repository, not this one')
  }
  return { allowed: true }
}

/**
 * Applies every abort rule for the event's kind, in the order a reviewer
 * expects.
 *
 * A `switch` rather than the ternary this was: with four kinds, a fallthrough
 * arm silently buckets whichever one is added next into the rules written for
 * another, and an exhaustive switch makes that a compile error instead.
 */
export const evaluateGuardrails = (event: TriggerEvent, options: GuardrailOptions): GuardrailDecision => {
  switch (event.kind) {
    case 'issue':
      return evaluateIssueGuardrails(event, options)
    case 'ci':
      return evaluateCiGuardrails(event, options)
    case 'pull-request':
      return evaluatePullRequestGuardrails(event, options)
    case 'pr-merged':
      return evaluatePrMergedGuardrails(event)
    default:
      return unreachable(event)
  }
}
