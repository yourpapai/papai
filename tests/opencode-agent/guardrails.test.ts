// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { parseSlashCommand, SLASH_COMMANDS } from '../../opencode-agent/src/commands.js'
import type { SlashCommand } from '../../opencode-agent/src/commands.js'
import type { PullRequestHead } from '../../opencode-agent/src/github-pulls.js'
import { evaluateGuardrails } from '../../opencode-agent/src/guardrails.js'
import type { Logger } from '../../opencode-agent/src/logger.js'
import { resolvePullRequestTrigger } from '../../opencode-agent/src/pr-trigger.js'
import type { PendingPullRequestEvent, PullRequestTriggerEvent } from '../../opencode-agent/src/pr-trigger.js'
import { parseTriggerEvent } from '../../opencode-agent/src/trigger-events.js'
import type { CiTriggerEvent, IssueTriggerEvent } from '../../opencode-agent/src/trigger-events.js'

const OPTIONS = { selfLogin: 'agent-bot', selfWorkflowName: 'OpenCode Issue Agent' }

const silentLogger = (): Logger => ({
  debug: (): void => {},
  info: (): void => {},
  warn: (): void => {},
  error: (): void => {},
})

const issuePayload = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  action: 'opened',
  sender: { login: 'maintainer', type: 'User' },
  issue: { number: 42, title: 'Add retries', body: 'Please add retries.', author_association: 'COLLABORATOR' },
  repository: { owner: { login: 'acme' }, name: 'widgets', default_branch: 'main' },
  ...overrides,
})

const issueEvent = (overrides: Partial<IssueTriggerEvent> = {}): IssueTriggerEvent => ({
  kind: 'issue',
  eventName: 'issues',
  action: 'opened',
  senderLogin: 'maintainer',
  senderType: 'User',
  authorAssociation: 'COLLABORATOR',
  issueNumber: 42,
  issueTitle: 'Add retries',
  issueBody: 'Please add retries.',
  isPullRequest: false,
  commentBody: null,
  commentId: null,
  repositoryOwner: 'acme',
  defaultBranch: 'main',
  ...overrides,
})

/** The `issue_comment.created` payload GitHub sends for a comment on a pull request. */
const pullRequestPayload = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  action: 'created',
  sender: { login: 'maintainer', type: 'User' },
  issue: {
    number: 7,
    title: 'Add retries (#42)',
    body: 'Closes #42',
    author_association: 'NONE',
    pull_request: { url: 'https://api.github.test/pulls/7' },
  },
  comment: { id: 99, body: '/review', author_association: 'COLLABORATOR' },
  repository: { owner: { login: 'acme' }, name: 'widgets', full_name: 'acme/widgets', default_branch: 'main' },
  ...overrides,
})

const pendingPullRequest = (overrides: Partial<PendingPullRequestEvent> = {}): PendingPullRequestEvent => ({
  kind: 'pending-pull-request',
  eventName: 'issue_comment',
  action: 'created',
  senderLogin: 'maintainer',
  senderType: 'User',
  authorAssociation: 'COLLABORATOR',
  prNumber: 7,
  commentBody: '/review',
  commentId: 99,
  repositoryFullName: 'acme/widgets',
  defaultBranch: 'main',
  ...overrides,
})

const pullRequestEvent = (overrides: Partial<PullRequestTriggerEvent> = {}): PullRequestTriggerEvent => ({
  kind: 'pull-request',
  eventName: 'issue_comment',
  action: 'created',
  senderLogin: 'maintainer',
  senderType: 'User',
  authorAssociation: 'COLLABORATOR',
  issueNumber: 42,
  prNumber: 7,
  commentBody: '/review',
  commentId: 99,
  defaultBranch: 'main',
  ...overrides,
})

const ciEvent = (overrides: Partial<CiTriggerEvent> = {}): CiTriggerEvent => ({
  kind: 'ci',
  eventName: 'workflow_run',
  action: 'completed',
  branch: 'agent/issue-42',
  issueNumber: 42,
  conclusion: 'failure',
  workflowName: 'CI',
  runUrl: 'https://example.test/run/1',
  runId: 32652877782,
  fromThisRepository: true,
  defaultBranch: 'main',
  ...overrides,
})

describe('parseTriggerEvent — issue events', () => {
  test('normalizes an issues.opened payload', () => {
    expect(parseTriggerEvent('issues', issuePayload())).toEqual(issueEvent())
  })

  test('prefers the comment author association on issue_comment', () => {
    const payload = issuePayload({
      action: 'created',
      issue: { number: 42, title: 't', body: 'b', author_association: 'OWNER' },
      comment: { id: 9, body: '/approve', author_association: 'NONE' },
    })

    const parsed = parseTriggerEvent('issue_comment', payload)

    expect(parsed).toMatchObject({ kind: 'issue', authorAssociation: 'NONE', commentBody: '/approve' })
  })

  test('carries the id of the comment that triggered the run', () => {
    // The schema always parsed it; the parser threw it away, so the pipeline
    // could not address the one place the person waiting is looking.
    const payload = issuePayload({
      action: 'created',
      comment: { id: 8811, body: 'looks right', author_association: 'OWNER' },
    })

    expect(parseTriggerEvent('issue_comment', payload)).toMatchObject({ commentId: 8811 })
  })

  test('reports no comment id for an issues.opened event', () => {
    // There is no comment to address, and a fabricated id would be pointed at
    // somebody else's. Feedback falls back to the issue itself.
    expect(parseTriggerEvent('issues', issuePayload())).toMatchObject({ commentId: null })
  })

  test('flags a comment on a pull request', () => {
    const payload = issuePayload({
      issue: { number: 5, title: 't', body: null, author_association: 'OWNER', pull_request: { url: 'x' } },
    })

    expect(parseTriggerEvent('issue_comment', payload)).toMatchObject({ isPullRequest: true })
  })

  test('reports no default branch when the payload omitted the repository', () => {
    // The parser used to substitute "main" here, which reached config as if
    // GitHub had said it and pre-empted every other way of finding the answer.
    const { repository: _dropped, ...withoutRepository } = issuePayload()

    expect(parseTriggerEvent('issues', withoutRepository)).toMatchObject({ defaultBranch: null })
  })

  test('returns null when the payload carries no issue', () => {
    expect(parseTriggerEvent('workflow_dispatch', { action: 'x', sender: { login: 'a' } })).toBeNull()
    expect(parseTriggerEvent('issues', 'not an object')).toBeNull()
  })
})

describe('parseTriggerEvent — CI events', () => {
  const ciPayload = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    action: 'completed',
    workflow_run: {
      name: 'CI',
      head_branch: 'agent/issue-42',
      conclusion: 'failure',
      html_url: 'https://example.test/run/1',
      id: 32652877782,
      head_repository: { full_name: 'acme/widgets' },
    },
    repository: { default_branch: 'main', full_name: 'acme/widgets' },
    ...overrides,
  })

  /** The same payload as a fork would produce: its own branch name, its own repo. */
  const forkPayload = (branch = 'agent/issue-42'): Record<string, unknown> =>
    ciPayload({
      workflow_run: {
        name: 'CI',
        head_branch: branch,
        conclusion: 'failure',
        html_url: 'u',
        id: 32652877782,
        head_repository: { full_name: 'attacker/widgets' },
      },
    })

  test('recovers the issue number from the agent branch', () => {
    expect(parseTriggerEvent('workflow_run', ciPayload())).toEqual(ciEvent())
  })

  test('carries the id of the run that went red, beside its URL', () => {
    // `runUrl` is what reports render; `runId` is what the Actions API is
    // addressed by. Recovering an id by scraping the URL is the thing the
    // no-scraping rule forbids, so the payload's own `id` must ride along.
    expect(parseTriggerEvent('workflow_run', ciPayload())).toMatchObject({ runId: 32652877782 })
  })

  test('reports no default branch when a run payload omitted the repository', () => {
    const { repository: _dropped, ...withoutRepository } = ciPayload()

    expect(parseTriggerEvent('workflow_run', withoutRepository)).toMatchObject({ defaultBranch: null })
  })

  test.each([['main'], ['feature/thing'], ['agent/issue-abc'], ['agent/issue-']])(
    'returns null for unrelated branch %p',
    (branch) => {
      const payload = ciPayload({
        workflow_run: { name: 'CI', head_branch: branch, conclusion: 'failure', html_url: 'u', id: 32652877782 },
      })

      expect(parseTriggerEvent('workflow_run', payload)).toBeNull()
    },
  )

  test('returns null when the run has no branch', () => {
    const payload = ciPayload({
      workflow_run: { name: 'CI', head_branch: null, conclusion: 'failure', html_url: 'u', id: 32652877782 },
    })

    expect(parseTriggerEvent('workflow_run', payload)).toBeNull()
  })

  test('marks a run from a fork as not being from this repository', () => {
    expect(parseTriggerEvent('workflow_run', forkPayload())).toMatchObject({ fromThisRepository: false })
  })

  test.each([
    [
      'no head_repository at all',
      ciPayload({
        workflow_run: {
          name: 'CI',
          head_branch: 'agent/issue-42',
          conclusion: 'failure',
          html_url: 'u',
          id: 32652877782,
        },
      }),
    ],
    [
      'no repository at all',
      {
        action: 'completed',
        workflow_run: {
          name: 'CI',
          id: 32652877782,
          head_branch: 'agent/issue-42',
          conclusion: 'failure',
          html_url: 'u',
          head_repository: { full_name: 'acme/widgets' },
        },
      },
    ],
    [
      'both names empty',
      ciPayload({
        workflow_run: {
          name: 'CI',
          id: 32652877782,
          head_branch: 'agent/issue-42',
          conclusion: 'failure',
          html_url: 'u',
          head_repository: { full_name: '' },
        },
        repository: { full_name: '' },
      }),
    ],
  ])('treats %s as not from this repository', (_label, payload) => {
    // Absent is not trusted, and two empty names are not "equal": defaulting
    // either way would wave through exactly the payload this exists to catch.
    expect(parseTriggerEvent('workflow_run', payload)).toMatchObject({ fromThisRepository: false })
  })
})

describe('parseTriggerEvent — pull-request comments', () => {
  test('normalizes one as pending, with no issue number to be had', () => {
    // `github.event.issue.number` on this payload is the **pull request**, and
    // every block of state lives on the issue — so the parse can only get as far
    // as saying which pull request was commented on.
    expect(parseTriggerEvent('issue_comment', pullRequestPayload())).toEqual(pendingPullRequest())
  })

  test('leaves an ordinary issue comment on the issue path', () => {
    const payload = issuePayload({
      action: 'created',
      comment: { id: 9, body: '/review', author_association: 'OWNER' },
    })

    expect(parseTriggerEvent('issue_comment', payload)).toMatchObject({ kind: 'issue', isPullRequest: false })
  })

  test.each([['edited'], ['deleted']])('falls through to the issue path for action %p', (action) => {
    // The pull-request door opens for exactly the event and action that can
    // carry a typed command. Everything else pull-request-shaped stays where it
    // has always been refused — `PULL_REQUEST` and `UNSUPPORTED_ACTION` — rather
    // than costing an API call to resolve a comment nobody typed now.
    expect(parseTriggerEvent('issue_comment', pullRequestPayload({ action }))).toMatchObject({
      kind: 'issue',
      isPullRequest: true,
    })
  })

  test('falls through to the issue path for an explicitly null pull_request', () => {
    // The schema requires the key, so an ordinary issue comment fails it
    // outright; a `null` value is the one shape that gets past the schema and
    // has to be turned down by the parser.
    const payload = pullRequestPayload({
      issue: { number: 7, title: 't', body: 'b', author_association: 'OWNER', pull_request: null },
    })

    expect(parseTriggerEvent('issue_comment', payload)).toMatchObject({ kind: 'issue', isPullRequest: false })
  })

  test('falls through to the issue path when the payload carries no comment', () => {
    const { comment: _dropped, ...withoutComment } = pullRequestPayload()

    expect(parseTriggerEvent('issue_comment', withoutComment)).toMatchObject({ kind: 'issue', isPullRequest: true })
  })

  test('reports no repository name when the payload omitted one', () => {
    // Not defaulted, for the reason `fromThisRepository` is not: the fork guard
    // compares this against the head repository, and a name invented here would
    // wave through exactly the payload it exists to catch.
    const { repository: _dropped, ...withoutRepository } = pullRequestPayload()

    expect(parseTriggerEvent('issue_comment', withoutRepository)).toMatchObject({
      kind: 'pending-pull-request',
      repositoryFullName: null,
      defaultBranch: null,
    })
  })

  test('reads an empty comment body as no command at all', () => {
    const payload = pullRequestPayload({ comment: { id: 99, body: null, author_association: 'OWNER' } })

    expect(parseTriggerEvent('issue_comment', payload)).toMatchObject({ commentBody: '' })
  })
})

describe('resolvePullRequestTrigger', () => {
  const head = (overrides: Partial<PullRequestHead> = {}): PullRequestHead => ({
    ref: 'agent/issue-42',
    repoFullName: 'acme/widgets',
    state: 'open',
    ...overrides,
  })

  /** A head lookup that counts its calls, so "no API call at all" is provable. */
  const lookup = (
    answer: PullRequestHead,
  ): { calls: () => number; github: { getPullRequestHead: (prNumber: number) => Promise<PullRequestHead> } } => {
    let calls = 0
    return {
      calls: () => calls,
      github: {
        getPullRequestHead: (): Promise<PullRequestHead> => {
          calls += 1
          return Promise.resolve(answer)
        },
      },
    }
  }

  test('resolves the comment to the issue the branch names', async () => {
    const api = lookup(head())

    const resolved = await resolvePullRequestTrigger(pendingPullRequest(), api.github, silentLogger())

    expect(resolved).toEqual(pullRequestEvent())
  })

  test.each([['looks good to me'], ['nice, ship it'], ['']])('drops %p with no API call at all', async (body) => {
    // The cheap filter that keeps every ordinary code-review comment free.
    // Every pull request in a repository gets them; without this, every one of
    // them would cost a pull-request lookup before being thrown away.
    const api = lookup(head())

    expect(
      await resolvePullRequestTrigger(pendingPullRequest({ commentBody: body }), api.github, silentLogger()),
    ).toBeNull()
    expect(api.calls()).toBe(0)
  })

  test.each([['/approve'], ['/ask why that file?'], ['/retry'], ['/cancel']])(
    'resolves %p, because the pull request is where an issue with one is driven from',
    async (body) => {
      // The door used to admit `/review` alone. It cannot any more: commands
      // typed on the issue are refused once a pull request exists, so a
      // narrowing here would leave these with nowhere to be typed at all.
      const api = lookup(head())

      const resolved = await resolvePullRequestTrigger(
        pendingPullRequest({ commentBody: body }),
        api.github,
        silentLogger(),
      )

      expect(resolved).toMatchObject({ kind: 'pull-request', issueNumber: 42 })
    },
  )

  test('ignores a /review inside a fenced block, exactly as the issue path does', async () => {
    const api = lookup(head())
    const body = 'Try this:\n```\n/review\n```\n'

    expect(
      await resolvePullRequestTrigger(pendingPullRequest({ commentBody: body }), api.github, silentLogger()),
    ).toBeNull()
    expect(api.calls()).toBe(0)
  })

  test('reads a /review that a maintainer wrote under some prose', async () => {
    const api = lookup(head())
    const body = 'this deserves another pass\n\n/review'

    const resolved = await resolvePullRequestTrigger(
      pendingPullRequest({ commentBody: body }),
      api.github,
      silentLogger(),
    )

    expect(resolved).toMatchObject({ kind: 'pull-request', issueNumber: 42 })
  })

  test('refuses a fork whose branch is named like the agent’s', async () => {
    // The same attack `CI_FOREIGN_REPOSITORY` exists for: `head.ref` reaches
    // this payload verbatim from a fork, so anyone who can open a pull request
    // can name a branch `agent/issue-42` and have it look, to every other field,
    // exactly like the agent's own — then type `/review` and buy a privileged
    // job that prompts the model, spends the issue's budget and pushes commits.
    const api = lookup(head({ repoFullName: 'attacker/widgets' }))

    expect(await resolvePullRequestTrigger(pendingPullRequest(), api.github, silentLogger())).toBeNull()
  })

  test('refuses when the payload named no repository to compare against', async () => {
    const api = lookup(head())

    expect(
      await resolvePullRequestTrigger(pendingPullRequest({ repositoryFullName: null }), api.github, silentLogger()),
    ).toBeNull()
  })

  test.each<PullRequestHead['state']>(['closed', 'merged'])('refuses a %s pull request', async (state) => {
    const api = lookup(head({ state }))

    expect(await resolvePullRequestTrigger(pendingPullRequest(), api.github, silentLogger())).toBeNull()
  })

  test.each([['main'], ['feature/thing'], ['agent/issue-abc'], ['agent/issue-']])(
    'refuses a pull request from branch %p',
    async (ref) => {
      const api = lookup(head({ ref }))

      expect(await resolvePullRequestTrigger(pendingPullRequest(), api.github, silentLogger())).toBeNull()
    },
  )
})

describe('evaluateGuardrails — pull-request comments', () => {
  test('allows a maintainer’s /review', () => {
    expect(evaluateGuardrails(pullRequestEvent(), OPTIONS)).toEqual({ allowed: true })
  })

  test.each(['OWNER', 'MEMBER', 'COLLABORATOR'])('allows association %s', (association) => {
    expect(evaluateGuardrails(pullRequestEvent({ authorAssociation: association }), OPTIONS).allowed).toBe(true)
  })

  test.each(['CONTRIBUTOR', 'FIRST_TIME_CONTRIBUTOR', 'NONE', ''])('rejects association %s', (association) => {
    // The same code the issue path uses, so the same `confused` reaction lands
    // on the comment: a pull-request comment is a human write with the same
    // reach, and a rule that held on one door and not the other would be a hole.
    expect(evaluateGuardrails(pullRequestEvent({ authorAssociation: association }), OPTIONS)).toMatchObject({
      allowed: false,
      code: 'NOT_MAINTAINER',
    })
  })

  test('rejects a Bot sender even when it has maintainer rights', () => {
    expect(
      evaluateGuardrails(pullRequestEvent({ senderType: 'Bot', authorAssociation: 'OWNER' }), OPTIONS),
    ).toMatchObject({ code: 'BOT_SENDER' })
  })

  test('rejects the agent identity to stop a comment loop', () => {
    expect(
      evaluateGuardrails(pullRequestEvent({ senderLogin: 'Agent-Bot', authorAssociation: 'OWNER' }), OPTIONS),
    ).toMatchObject({ code: 'SELF_RECURSION' })
  })
})

describe('evaluateGuardrails — a run from another repository', () => {
  test('rejects it, however much the rest of the payload looks right', () => {
    // `head_branch` carries a fork's branch name verbatim, so anyone able to
    // open a pull request could name a branch `agent/issue-42`, let its checks
    // go red, and start a privileged job that prompts the model, spends the
    // issue's token budget and pushes to a real agent branch.
    const event = ciEvent({ fromThisRepository: false })

    expect(evaluateGuardrails(event, OPTIONS)).toMatchObject({ allowed: false, code: 'CI_FOREIGN_REPOSITORY' })
  })

  test('names the branch it rejected, so the log says which one', () => {
    const decision = evaluateGuardrails(ciEvent({ fromThisRepository: false }), OPTIONS)

    expect(JSON.stringify(decision)).toContain('agent/issue-42')
  })
})

describe('evaluateGuardrails — issue events', () => {
  test('allows a maintainer opening an issue', () => {
    expect(evaluateGuardrails(issueEvent(), OPTIONS)).toEqual({ allowed: true })
  })

  test.each(['OWNER', 'MEMBER', 'COLLABORATOR'])('allows association %s', (association) => {
    expect(evaluateGuardrails(issueEvent({ authorAssociation: association }), OPTIONS).allowed).toBe(true)
  })

  test.each(['CONTRIBUTOR', 'FIRST_TIME_CONTRIBUTOR', 'NONE', ''])('rejects association %s', (association) => {
    expect(evaluateGuardrails(issueEvent({ authorAssociation: association }), OPTIONS)).toMatchObject({
      allowed: false,
      code: 'NOT_MAINTAINER',
    })
  })

  test('rejects a Bot sender even when it has maintainer rights', () => {
    expect(evaluateGuardrails(issueEvent({ senderType: 'Bot', authorAssociation: 'OWNER' }), OPTIONS)).toMatchObject({
      code: 'BOT_SENDER',
    })
  })

  test('rejects the agent identity to stop a comment loop', () => {
    expect(
      evaluateGuardrails(issueEvent({ senderLogin: 'Agent-Bot', authorAssociation: 'OWNER' }), OPTIONS),
    ).toMatchObject({ code: 'SELF_RECURSION' })
  })

  test('accepts a plain comment, so a clarifying reply reaches the pipeline', () => {
    const event = issueEvent({ eventName: 'issue_comment', action: 'created', commentBody: 'the HTTP client' })

    expect(evaluateGuardrails(event, OPTIONS)).toEqual({ allowed: true })
  })

  test.each([
    [{ eventName: 'push' }, 'UNSUPPORTED_EVENT'],
    [{ action: 'edited' }, 'UNSUPPORTED_ACTION'],
    [{ eventName: 'issue_comment', action: 'created', isPullRequest: true }, 'PULL_REQUEST'],
  ])('rejects %p as %s', (overrides, code) => {
    expect(evaluateGuardrails(issueEvent(overrides), OPTIONS)).toMatchObject({ allowed: false, code })
  })
})

describe('evaluateGuardrails — CI events', () => {
  test('allows a red run on an agent branch', () => {
    expect(evaluateGuardrails(ciEvent(), OPTIONS)).toEqual({ allowed: true })
  })

  test.each(['success', 'cancelled', 'skipped', 'unknown'])('ignores a run that concluded %s', (conclusion) => {
    expect(evaluateGuardrails(ciEvent({ conclusion }), OPTIONS)).toMatchObject({ allowed: false, code: 'CI_GREEN' })
  })

  test('ignores the agent pipeline failing, so it cannot feed itself', () => {
    expect(evaluateGuardrails(ciEvent({ workflowName: 'OpenCode Issue Agent' }), OPTIONS)).toMatchObject({
      code: 'CI_SELF',
    })
  })

  test('ignores a branch the agent does not own', () => {
    expect(evaluateGuardrails(ciEvent({ branch: 'agent/issue-7', issueNumber: 42 }), OPTIONS)).toMatchObject({
      code: 'CI_FOREIGN_BRANCH',
    })
  })
})

const RECOGNIZED: Array<[string, SlashCommand, string]> = [
  ['/approve', '/approve', ''],
  ['/approve ship it', '/approve', 'ship it'],
  ['  /retry  ', '/retry', ''],
  ['/CANCEL', '/cancel', ''],
  ['looks good\n/approve', '/approve', ''],
  ['/changes use the existing helper', '/changes', 'use the existing helper'],
  ['/ask why that file?', '/ask', 'why that file?'],
]

describe('parseSlashCommand', () => {
  test.each(RECOGNIZED)('parses %p', (body, command, argument) => {
    expect(parseSlashCommand(body)).toEqual({ command, argument })
  })

  test('keeps a multi-line argument', () => {
    expect(parseSlashCommand('/changes drop step 2\n\nand rename the helper')).toEqual({
      command: '/changes',
      argument: 'drop step 2\n\nand rename the helper',
    })
  })

  test.each([['no command here'], ['please reply with /approve when ready'], ['/approved'], ['//approve']])(
    'ignores %p',
    (body) => {
      expect(parseSlashCommand(body)).toBeNull()
    },
  )

  test('ignores commands inside a fenced code block', () => {
    expect(parseSlashCommand('Example:\n```\n/approve\n```\n')).toBeNull()
  })

  test('reads a command after a closed fence', () => {
    expect(parseSlashCommand('```\n/cancel\n```\n/approve')?.command).toBe('/approve')
  })

  test('returns null for a null body', () => {
    expect(parseSlashCommand(null)).toBeNull()
  })

  test('exposes exactly the documented command surface', () => {
    expect([...SLASH_COMMANDS]).toEqual([
      '/approve',
      '/changes',
      '/ask',
      '/retry',
      '/cancel',
      '/review',
      '/continue',
      '/sync',
      '/fix',
    ])
  })
})
