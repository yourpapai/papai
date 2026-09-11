// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import type { PullRequestHead } from '../../opencode-agent/src/github-pulls.js'
import { evaluateGuardrails } from '../../opencode-agent/src/guardrails.js'
import type { Logger, LogLevel } from '../../opencode-agent/src/logger.js'
import { resolvePullRequestTrigger } from '../../opencode-agent/src/pr-trigger.js'
import type { PendingPullRequestEvent } from '../../opencode-agent/src/pr-trigger.js'
import { parseTriggerEvent } from '../../opencode-agent/src/trigger-events.js'
import type { PrMergedTriggerEvent } from '../../opencode-agent/src/trigger-events.js'

/**
 * Design D7 — the archive door.
 *
 * `pull_request.closed(merged)` on a branch the agent owns is the propose →
 * apply → archive loop's closing half: the ARCHIVE phase runs `openspec
 * archive` as a follow-up commit on master. These tests pin the door's three
 * legs — parse, guardrails (foreign-repo refusal), and issue resolution via the
 * head branch — following the existing `ci-trigger.ts` door pattern rather than
 * the comment-on-PR one (no API call: the payload carries the head branch).
 */

const merged = (over: Record<string, unknown> = {}): unknown => ({
  action: 'closed',
  pull_request: {
    merged: true,
    number: 7,
    head: { ref: 'agent/issue-42', repo: { full_name: 'acme/widgets' } },
    base: { ref: 'main' },
  },
  repository: { full_name: 'acme/widgets', default_branch: 'main' },
  sender: { login: 'maintainer', type: 'User' },
  ...over,
})

describe('the /fix comment rides the pull-request door’s existing guardrails (D6)', () => {
  /** A `/fix` typed on a pull request, parsed as far as a payload allows. */
  const pendingFix = (): PendingPullRequestEvent => ({
    kind: 'pending-pull-request',
    eventName: 'issue_comment',
    action: 'created',
    senderLogin: 'maintainer',
    senderType: 'User',
    authorAssociation: 'OWNER',
    prNumber: 7,
    commentBody: '/fix',
    commentId: 99,
    defaultBranch: 'main',
    repositoryFullName: 'acme/widgets',
  })

  const head = (overrides: Partial<PullRequestHead> = {}): PullRequestHead => ({
    ref: 'agent/issue-42',
    repoFullName: 'acme/widgets',
    state: 'open',
    ...overrides,
  })

  /** A logger that records the guardrail refusals' fields, so the code is provable. */
  const recordingLogger = (): { warnFields: Array<Record<string, unknown>>; log: Logger } => {
    const warnFields: Array<Record<string, unknown>> = []
    const at =
      (level: LogLevel) =>
      (fields: Record<string, unknown>, _message: string): void => {
        if (level === 'warn') warnFields.push({ ...fields })
      }
    return { warnFields, log: { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') } }
  }

  /** The resolver's answer, with the null branch already refused by the assert beside it. */
  const mustResolve = (
    resolved: Awaited<ReturnType<typeof resolvePullRequestTrigger>>,
  ): NonNullable<typeof resolved> => {
    if (resolved === null) throw new Error('the agent’s own open pull request must resolve')
    return resolved
  }

  it('keeps the PR_FOREIGN_REPOSITORY refusal for a fork whose branch merely looks like the agent’s', async () => {
    // The same attack the door exists for: `head.ref` is attacker-controlled,
    // so a fork's `agent/issue-42` looks like the agent's own to every other
    // field. /fix must not widen the guardrail — the refusal lands before any
    // command logic runs, so no model turn and no CI-fix attempt is spent.
    const { warnFields, log } = recordingLogger()
    const github = {
      getPullRequestHead: (): Promise<PullRequestHead> => Promise.resolve(head({ repoFullName: 'attacker/widgets' })),
    }

    const resolved = await resolvePullRequestTrigger(pendingFix(), github, log)

    expect(resolved).toBeNull()
    expect(warnFields.map((fields) => fields['code'])).toContain('PR_FOREIGN_REPOSITORY')
  })

  it('boots a job on the agent’s own open pull request exactly as /review and /sync do', async () => {
    const { log } = recordingLogger()
    const github = { getPullRequestHead: (): Promise<PullRequestHead> => Promise.resolve(head()) }

    const resolved = mustResolve(await resolvePullRequestTrigger(pendingFix(), github, log))

    expect(resolved).toMatchObject({ kind: 'pull-request', issueNumber: 42, commentBody: '/fix' })
    // The guardrail layer admits it like any maintainer command.
    expect(
      evaluateGuardrails(resolved, { selfLogin: 'agent-bot', selfWorkflowName: 'OpenCode Issue Agent' }).allowed,
    ).toBe(true)
  })
})

describe('the /follow-up baseline: a plain comment on a delivered pull request still buys nothing', () => {
  /**
   * Issue #441 adds `/follow-up` to this door. The scenario it is asked about —
   * the run delivered, the pull request open, a maintainer typing an ordinary
   * comment on it — must stay a no-op: prose widens the door to nothing. The
   * absences below are the baseline the command sits on, pinned before it
   * arrives so its implementation cannot quietly move the cheap filter.
   */

  /** A maintainer's ordinary post-delivery prose — praise and a nit, no command. */
  const pendingProse = (): PendingPullRequestEvent => ({
    kind: 'pending-pull-request',
    eventName: 'issue_comment',
    action: 'created',
    senderLogin: 'maintainer',
    senderType: 'User',
    authorAssociation: 'OWNER',
    prNumber: 7,
    commentBody: 'Lovely work. One nit: the docstring in retry.ts has a typo.',
    commentId: 100,
    defaultBranch: 'main',
    repositoryFullName: 'acme/widgets',
  })

  /** A head lookup that records its calls, so "no lookup" is provable, not assumed. */
  const lookup = (): {
    calls: number[]
    github: { getPullRequestHead: (prNumber: number) => Promise<PullRequestHead> }
  } => {
    const calls: number[] = []
    return {
      calls,
      github: {
        getPullRequestHead: (prNumber: number): Promise<PullRequestHead> => {
          calls.push(prNumber)
          return Promise.resolve({ ref: 'agent/issue-42', repoFullName: 'acme/widgets', state: 'open' })
        },
      },
    }
  }

  /** A logger that records the door's debug and warn fields, so silence is provable. */
  const recordingLogger = (): {
    debugFields: Array<Record<string, unknown>>
    warnFields: Array<Record<string, unknown>>
    log: Logger
  } => {
    const debugFields: Array<Record<string, unknown>> = []
    const warnFields: Array<Record<string, unknown>> = []
    const at =
      (level: LogLevel) =>
      (fields: Record<string, unknown>, _message: string): void => {
        if (level === 'debug') debugFields.push({ ...fields })
        if (level === 'warn') warnFields.push({ ...fields })
      }
    return {
      debugFields,
      warnFields,
      log: { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') },
    }
  }

  it('starts no run, posts no reply, and performs no pull-request lookup', async () => {
    // Delivered or not is a fact the door never learns: the drop happens at the
    // free slash-command test, before the head lookup — let alone a thread
    // read — could say. `null` is the door's "nothing to do", which the entry
    // door turns into a silent skip (pinned end to end in `cli.test.ts`). The
    // door's only voice is a warn refusal, so prose earns neither a refusal nor
    // a reply: the one trace it leaves is a debug line naming the cheap filter
    // that dropped it, never a conversation.
    const api = lookup()
    const { debugFields, warnFields, log } = recordingLogger()

    const resolved = await resolvePullRequestTrigger(pendingProse(), api.github, log)

    expect(resolved).toBeNull()
    expect(api.calls).toEqual([])
    expect(warnFields).toEqual([])
    expect(debugFields.map((fields) => fields['code'])).toContain('PR_NO_COMMAND')
  })
})

describe('the /follow-up comment rides the pull-request door’s existing guardrails (issue #441)', () => {
  /** A `/follow-up` typed on a pull request, parsed as far as a payload allows. */
  const pendingFollowUp = (): PendingPullRequestEvent => ({
    kind: 'pending-pull-request',
    eventName: 'issue_comment',
    action: 'created',
    senderLogin: 'maintainer',
    senderType: 'User',
    authorAssociation: 'OWNER',
    prNumber: 7,
    commentBody: '/follow-up tighten the retry backoff',
    commentId: 99,
    defaultBranch: 'main',
    repositoryFullName: 'acme/widgets',
  })

  const head = (overrides: Partial<PullRequestHead> = {}): PullRequestHead => ({
    ref: 'agent/issue-42',
    repoFullName: 'acme/widgets',
    state: 'open',
    ...overrides,
  })

  /** A logger that records the guardrail refusals' fields, so the code is provable. */
  const recordingLogger = (): { warnFields: Array<Record<string, unknown>>; log: Logger } => {
    const warnFields: Array<Record<string, unknown>> = []
    const at =
      (level: LogLevel) =>
      (fields: Record<string, unknown>, _message: string): void => {
        if (level === 'warn') warnFields.push({ ...fields })
      }
    return { warnFields, log: { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') } }
  }

  /** The resolver's answer, with the null branch already refused by the assert beside it. */
  const mustResolve = (
    resolved: Awaited<ReturnType<typeof resolvePullRequestTrigger>>,
  ): NonNullable<typeof resolved> => {
    if (resolved === null) throw new Error('the agent’s own open pull request must resolve')
    return resolved
  }

  it('boots a job on the agent’s own open pull request exactly as every other command does', async () => {
    const { log } = recordingLogger()
    const github = { getPullRequestHead: (): Promise<PullRequestHead> => Promise.resolve(head()) }

    const resolved = mustResolve(await resolvePullRequestTrigger(pendingFollowUp(), github, log))

    expect(resolved).toMatchObject({
      kind: 'pull-request',
      issueNumber: 42,
      commentBody: '/follow-up tighten the retry backoff',
    })
    // The guardrail layer admits it like any maintainer command — the door
    // admits the whole vocabulary, and which commands the state accepts is
    // decided once, by `applyCommand`, for both doors.
    expect(
      evaluateGuardrails(resolved, { selfLogin: 'agent-bot', selfWorkflowName: 'OpenCode Issue Agent' }).allowed,
    ).toBe(true)
  })

  it('keeps the PR_FOREIGN_REPOSITORY refusal for a fork whose branch merely looks like the agent’s', async () => {
    // `/follow-up` is the widest command through this door yet — it edits the
    // delivered branch and pushes. The fork guard sits ahead of any command
    // logic, so the refusal lands before the predicate, the size gate or any
    // model turn: `head.ref` is attacker-controlled, and a fork's
    // `agent/issue-42` looks like the agent's own to every other field.
    const { warnFields, log } = recordingLogger()
    const github = {
      getPullRequestHead: (): Promise<PullRequestHead> => Promise.resolve(head({ repoFullName: 'attacker/widgets' })),
    }

    const resolved = await resolvePullRequestTrigger(pendingFollowUp(), github, log)

    expect(resolved).toBeNull()
    expect(warnFields.map((fields) => fields['code'])).toContain('PR_FOREIGN_REPOSITORY')
  })
})

describe('parseTriggerEvent · pull_request.closed(merged) (D7)', () => {
  it('parses a merged agent-branch PR into a pr-merged event resolved via the head branch', () => {
    const event = parseTriggerEvent('pull_request', merged())
    expect(event).toMatchObject({
      kind: 'pr-merged',
      issueNumber: 42,
      prNumber: 7,
      baseBranch: 'main',
    })
  })

  it('returns null for a close that was not a merge', () => {
    const event = parseTriggerEvent(
      'pull_request',
      merged({ pull_request: { merged: false, number: 7, head: { ref: 'agent/issue-42' }, base: { ref: 'main' } } }),
    )

    expect(event).toBeNull()
  })

  it('returns null for a merged PR on a branch the agent does not own', () => {
    const event = parseTriggerEvent(
      'pull_request',
      merged({ pull_request: { merged: true, number: 7, head: { ref: 'feature/x' }, base: { ref: 'main' } } }),
    )

    expect(event).toBeNull()
  })

  it('returns null for a non-closed action', () => {
    const event = parseTriggerEvent(
      'pull_request',
      merged({
        action: 'opened',
        pull_request: { merged: false, number: 7, head: { ref: 'agent/issue-42' }, base: { ref: 'main' } },
      }),
    )

    expect(event).toBeNull()
  })
})

describe('evaluateGuardrails · pr-merged foreign-repo refusal (D7)', () => {
  const options = { selfLogin: 'agent-bot', selfWorkflowName: 'OpenCode Issue Agent' }

  const prMerged = (fromThisRepository: boolean): PrMergedTriggerEvent => ({
    kind: 'pr-merged',
    eventName: 'pull_request',
    prNumber: 7,
    issueNumber: 42,
    baseBranch: 'main',
    fromThisRepository,
    defaultBranch: 'main',
  })

  it('allows a merged PR whose head is this repository', () => {
    const decision = evaluateGuardrails(prMerged(true), options)
    expect(decision.allowed).toBe(true)
  })

  it('refuses a merged PR merged from a fork (foreign repository)', () => {
    const decision = evaluateGuardrails(prMerged(false), options)
    expect(decision.allowed).toBe(false)
    expect(decision).toMatchObject({ code: 'PR_FOREIGN_REPOSITORY' })
  })
})
