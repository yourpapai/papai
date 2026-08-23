// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { GitHubIssueSchema, type GitHubIssue } from '../../../../plugins/task-provider-github/schemas/issue.js'

describe('GitHubIssueSchema', () => {
  const validIssue = {
    id: 1,
    number: 1347,
    title: 'Found a bug',
    body: "I'm having a problem with this.",
    user: {
      login: 'octocat',
      id: 583231,
      avatar_url: 'https://avatars.githubusercontent.com/u/583231?v=4',
      html_url: 'https://github.com/octocat',
      type: 'User',
    },
    labels: [{ id: 208045946, node_id: 'MDU6TGFiZWwyMDgwNDU5NDY=', name: 'bug', color: 'f29513', default: true }],
    state: 'open',
    locked: false,
    assignee: null,
    assignees: [],
    comments: 10,
    created_at: '2011-01-26T19:01:12Z',
    updated_at: '2011-01-26T19:01:12Z',
    closed_at: null,
    state_reason: null,
    milestone: null,
    html_url: 'https://github.com/octocat/Hello-World/issues/1347',
    repository_url: 'https://api.github.com/repos/octocat/Hello-World',
  }

  test('accepts a single-issue payload (labels as objects) and exports inferred type', () => {
    const parsed: GitHubIssue = GitHubIssueSchema.parse(validIssue)
    expect(parsed.number).toBe(1347)
    expect(parsed.state).toBe('open')
  })

  test('accepts a list-endpoint payload (labels as plain strings)', () => {
    const result = GitHubIssueSchema.parse({ ...validIssue, labels: ['bug', 'help wanted'] })
    expect(result.labels).toEqual(['bug', 'help wanted'])
  })

  test('accepts mixed label forms', () => {
    const result = GitHubIssueSchema.parse({
      ...validIssue,
      labels: ['bug', { id: 208045946, name: 'priority', color: 'f29513' }],
    })
    expect(result.labels).toEqual(['bug', { id: 208045946, name: 'priority', color: 'f29513' }])
  })

  test('rejects a malformed label object', () => {
    expect(() => GitHubIssueSchema.parse({ ...validIssue, labels: [{ id: 1 }] })).toThrow()
  })

  test('body as null accepts (GitHub sends null when unset)', () => {
    const result = GitHubIssueSchema.parse({ ...validIssue, body: null })
    expect(result.body).toBeNull()
  })

  test('missing body rejects', () => {
    const { body: _, ...invalid } = validIssue
    expect(() => GitHubIssueSchema.parse(invalid)).toThrow()
  })

  test('state_reason accepts completed and not_planned', () => {
    expect(GitHubIssueSchema.parse({ ...validIssue, state: 'closed', state_reason: 'completed' }).state_reason).toBe(
      'completed',
    )
    expect(GitHubIssueSchema.parse({ ...validIssue, state: 'closed', state_reason: 'not_planned' }).state_reason).toBe(
      'not_planned',
    )
  })

  test('state_reason as null accepts', () => {
    expect(GitHubIssueSchema.parse(validIssue).state_reason).toBeNull()
  })

  test('state_reason with invalid value rejects', () => {
    expect(() => GitHubIssueSchema.parse({ ...validIssue, state_reason: 'whatever' })).toThrow()
  })

  test('closed_at as ISO string accepts, null accepts', () => {
    expect(GitHubIssueSchema.parse({ ...validIssue, closed_at: '2011-01-26T19:06:43Z' }).closed_at).toBe(
      '2011-01-26T19:06:43Z',
    )
    expect(GitHubIssueSchema.parse(validIssue).closed_at).toBeNull()
  })

  test('milestone object accepts and null accepts', () => {
    const milestone = { id: 1002604, number: 1, title: 'v1.0', state: 'open' }
    expect(GitHubIssueSchema.parse({ ...validIssue, milestone }).milestone).toMatchObject({ title: 'v1.0' })
    expect(GitHubIssueSchema.parse(validIssue).milestone).toBeNull()
  })

  test('milestone malformed rejects', () => {
    expect(() => GitHubIssueSchema.parse({ ...validIssue, milestone: { no_title: true } })).toThrow()
  })

  test('pull_request marker present accepts (PR-marked issue)', () => {
    const result = GitHubIssueSchema.parse({ ...validIssue, pull_request: { url: '…/pulls/1347' } })
    expect(result.pull_request).toBeDefined()
  })

  test('pull_request marker absent accepts (plain issue)', () => {
    const result = GitHubIssueSchema.parse(validIssue)
    expect(result.pull_request).toBeUndefined()
  })

  test('user as null accepts (ghost author)', () => {
    expect(GitHubIssueSchema.parse({ ...validIssue, user: null }).user).toBeNull()
  })

  test('missing user rejects', () => {
    const { user: _, ...invalid } = validIssue
    expect(() => GitHubIssueSchema.parse(invalid)).toThrow()
  })

  test('invalid state rejects', () => {
    expect(() => GitHubIssueSchema.parse({ ...validIssue, state: 'reopened' })).toThrow()
  })

  test('number as string rejects', () => {
    expect(() => GitHubIssueSchema.parse({ ...validIssue, number: '1347' })).toThrow()
  })

  test('missing html_url rejects', () => {
    const { html_url: _, ...invalid } = validIssue
    expect(() => GitHubIssueSchema.parse(invalid)).toThrow()
  })

  test('assignees carried as user array', () => {
    const assignee = { ...validIssue.user, login: 'hubot' }
    const result = GitHubIssueSchema.parse({ ...validIssue, assignees: [assignee] })
    expect(result.assignees[0]?.login).toBe('hubot')
  })

  test('comments count as string rejects', () => {
    expect(() => GitHubIssueSchema.parse({ ...validIssue, comments: '10' })).toThrow()
  })

  test('extra fields stripped', () => {
    const result = GitHubIssueSchema.parse(validIssue)
    expect('locked' in result).toBe(false)
    expect('repository_url' in result).toBe(false)
  })
})
