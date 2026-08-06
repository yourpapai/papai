// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { parseSlashCommand } from '../../opencode-agent/src/commands.js'
import type { SlashCommand } from '../../opencode-agent/src/commands.js'
import { evaluateGuardrails, parseTriggerEvent } from '../../opencode-agent/src/guardrails.js'
import type { TriggerEvent } from '../../opencode-agent/src/guardrails.js'

const openedPayload = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  action: 'opened',
  sender: { login: 'maintainer', type: 'User' },
  issue: { number: 42, title: 'Add retries', body: 'Please add retries.', author_association: 'COLLABORATOR' },
  repository: { owner: { login: 'acme' }, name: 'widgets', default_branch: 'main' },
  ...overrides,
})

const event = (overrides: Partial<TriggerEvent> = {}): TriggerEvent => ({
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
  repositoryName: 'widgets',
  defaultBranch: 'main',
  ...overrides,
})

describe('parseTriggerEvent', () => {
  test('normalizes an issues.opened payload', () => {
    expect(parseTriggerEvent('issues', openedPayload())).toEqual(event())
  })

  test('prefers the comment author association on issue_comment', () => {
    const payload = openedPayload({
      action: 'created',
      issue: { number: 42, title: 't', body: 'b', author_association: 'NONE' },
      comment: { id: 9, body: '/approve', author_association: 'OWNER' },
    })

    const parsed = parseTriggerEvent('issue_comment', payload)

    expect(parsed?.authorAssociation).toBe('OWNER')
    expect(parsed?.commentBody).toBe('/approve')
  })

  test('flags a comment on a pull request', () => {
    const payload = openedPayload({
      issue: { number: 5, title: 't', body: null, author_association: 'OWNER', pull_request: { url: 'x' } },
    })

    expect(parseTriggerEvent('issue_comment', payload)?.isPullRequest).toBe(true)
  })

  test('treats a null issue body as empty', () => {
    const payload = openedPayload({
      issue: { number: 5, title: 't', body: null, author_association: 'OWNER' },
    })

    expect(parseTriggerEvent('issues', payload)?.issueBody).toBe('')
  })

  test('returns null when the payload carries no issue', () => {
    expect(parseTriggerEvent('workflow_dispatch', { action: 'x', sender: { login: 'a' } })).toBeNull()
    expect(parseTriggerEvent('issues', 'not an object')).toBeNull()
  })
})

describe('evaluateGuardrails', () => {
  const options = { selfLogin: 'agent-bot' }

  test('allows a maintainer opening an issue', () => {
    expect(evaluateGuardrails(event(), options)).toEqual({ allowed: true })
  })

  test.each(['OWNER', 'MEMBER', 'COLLABORATOR'])('allows association %s', (association) => {
    expect(evaluateGuardrails(event({ authorAssociation: association }), options).allowed).toBe(true)
  })

  test.each(['CONTRIBUTOR', 'FIRST_TIME_CONTRIBUTOR', 'NONE', ''])('rejects association %s', (association) => {
    const decision = evaluateGuardrails(event({ authorAssociation: association }), options)

    expect(decision).toMatchObject({ allowed: false, code: 'NOT_MAINTAINER' })
  })

  test('rejects a Bot sender even when it has maintainer rights', () => {
    const decision = evaluateGuardrails(event({ senderType: 'Bot', authorAssociation: 'OWNER' }), options)

    expect(decision).toMatchObject({ allowed: false, code: 'BOT_SENDER' })
  })

  test('rejects the agent identity to stop a comment loop', () => {
    const decision = evaluateGuardrails(event({ senderLogin: 'Agent-Bot', authorAssociation: 'OWNER' }), options)

    expect(decision).toMatchObject({ allowed: false, code: 'SELF_RECURSION' })
  })

  test('rejects an unsupported event name', () => {
    const decision = evaluateGuardrails(event({ eventName: 'push' }), options)

    expect(decision).toMatchObject({ allowed: false, code: 'UNSUPPORTED_EVENT' })
  })

  test('rejects an unsupported action on a supported event', () => {
    const decision = evaluateGuardrails(event({ action: 'edited' }), options)

    expect(decision).toMatchObject({ allowed: false, code: 'UNSUPPORTED_ACTION' })
  })

  test('rejects a pull-request comment', () => {
    const decision = evaluateGuardrails(
      event({ eventName: 'issue_comment', action: 'created', isPullRequest: true }),
      options,
    )

    expect(decision).toMatchObject({ allowed: false, code: 'PULL_REQUEST' })
  })

  test('checks the bot guard before the authorization guard', () => {
    const decision = evaluateGuardrails(event({ senderType: 'Bot', authorAssociation: 'NONE' }), options)

    expect(decision).toMatchObject({ code: 'BOT_SENDER' })
  })
})

const RECOGNIZED: Array<[string, SlashCommand]> = [
  ['/approve', '/approve'],
  ['/approve ship it', '/approve'],
  ['  /retry  ', '/retry'],
  ['/CANCEL', '/cancel'],
  ['looks good\n/approve', '/approve'],
]

describe('parseSlashCommand', () => {
  test.each(RECOGNIZED)('parses %p', (body, expected) => {
    expect(parseSlashCommand(body)).toBe(expected)
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
    expect(parseSlashCommand('```\n/cancel\n```\n/approve')).toBe('/approve')
  })

  test('returns null for a null body', () => {
    expect(parseSlashCommand(null)).toBeNull()
  })
})
