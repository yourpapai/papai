// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { parseSlashCommand, SLASH_COMMANDS } from '../../opencode-agent/src/commands.js'
import type { SlashCommand } from '../../opencode-agent/src/commands.js'
import { evaluateGuardrails, parseTriggerEvent } from '../../opencode-agent/src/guardrails.js'
import type { CiTriggerEvent, IssueTriggerEvent } from '../../opencode-agent/src/guardrails.js'

const OPTIONS = { selfLogin: 'agent-bot', selfWorkflowName: 'OpenCode Issue Agent' }

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
  repositoryOwner: 'acme',
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

  test('flags a comment on a pull request', () => {
    const payload = issuePayload({
      issue: { number: 5, title: 't', body: null, author_association: 'OWNER', pull_request: { url: 'x' } },
    })

    expect(parseTriggerEvent('issue_comment', payload)).toMatchObject({ isPullRequest: true })
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
    },
    repository: { default_branch: 'main' },
    ...overrides,
  })

  test('recovers the issue number from the agent branch', () => {
    expect(parseTriggerEvent('workflow_run', ciPayload())).toEqual(ciEvent())
  })

  test.each([['main'], ['feature/thing'], ['agent/issue-abc'], ['agent/issue-']])(
    'returns null for unrelated branch %p',
    (branch) => {
      const payload = ciPayload({
        workflow_run: { name: 'CI', head_branch: branch, conclusion: 'failure', html_url: 'u' },
      })

      expect(parseTriggerEvent('workflow_run', payload)).toBeNull()
    },
  )

  test('returns null when the run has no branch', () => {
    const payload = ciPayload({ workflow_run: { name: 'CI', head_branch: null, conclusion: 'failure', html_url: 'u' } })

    expect(parseTriggerEvent('workflow_run', payload)).toBeNull()
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
    expect([...SLASH_COMMANDS]).toEqual(['/approve', '/changes', '/ask', '/retry', '/cancel'])
  })
})
