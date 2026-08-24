// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { GitHubCommentSchema, type GitHubComment } from '../../../../plugins/task-provider-github/schemas/comment.js'

describe('GitHubCommentSchema', () => {
  const validComment = {
    id: 1,
    body: 'Me too',
    user: {
      login: 'octocat',
      id: 583231,
      avatar_url: 'https://avatars.githubusercontent.com/u/583231?v=4',
      html_url: 'https://github.com/octocat',
      type: 'User',
    },
    created_at: '2011-04-14T16:00:49Z',
    updated_at: '2011-04-14T16:00:49Z',
    html_url: 'https://github.com/octocat/Hello-World/issues/1347#issuecomment-1',
    issue_url: 'https://api.github.com/repos/octocat/Hello-World/issues/1347',
    author_association: 'NONE',
    node_id: 'MDEyOklzc3VlQ29tbWVudDE=',
    reactions: {
      url: '…',
      total_count: 5,
      '+1': 1,
      '-1': 0,
      laugh: 0,
      hooray: 0,
      confused: 0,
      heart: 1,
      rocket: 1,
      eyes: 2,
    },
  }

  test('accepts a full comment payload and exports inferred type', () => {
    const parsed: GitHubComment = GitHubCommentSchema.parse(validComment)
    expect(parsed.id).toBe(1)
    expect(parsed.body).toBe('Me too')
    expect(parsed.user?.login).toBe('octocat')
    expect(parsed.author_association).toBe('NONE')
  })

  test('user as null accepts (ghost commenter)', () => {
    expect(GitHubCommentSchema.parse({ ...validComment, user: null }).user).toBeNull()
  })

  test('id as string rejects', () => {
    expect(() => GitHubCommentSchema.parse({ ...validComment, id: '1' })).toThrow()
  })

  test('id as non-integer number rejects', () => {
    expect(() => GitHubCommentSchema.parse({ ...validComment, id: 1.5 })).toThrow()
  })

  test('body as number rejects', () => {
    expect(() => GitHubCommentSchema.parse({ ...validComment, body: 42 })).toThrow()
  })

  test('body as null rejects (comment bodies are always present upstream)', () => {
    expect(() => GitHubCommentSchema.parse({ ...validComment, body: null })).toThrow()
  })

  test('malformed user object rejects', () => {
    expect(() => GitHubCommentSchema.parse({ ...validComment, user: { login: 'octocat' } })).toThrow()
  })

  test('user as string rejects', () => {
    expect(() => GitHubCommentSchema.parse({ ...validComment, user: 'octocat' })).toThrow()
  })

  test('missing user rejects', () => {
    const { user: _, ...invalid } = validComment
    expect(() => GitHubCommentSchema.parse(invalid)).toThrow()
  })

  test('created_at as number rejects', () => {
    expect(() => GitHubCommentSchema.parse({ ...validComment, created_at: 1312116623000 })).toThrow()
  })

  test('missing updated_at rejects', () => {
    const { updated_at: _, ...invalid } = validComment
    expect(() => GitHubCommentSchema.parse(invalid)).toThrow()
  })

  test('missing html_url rejects', () => {
    const { html_url: _, ...invalid } = validComment
    expect(() => GitHubCommentSchema.parse(invalid)).toThrow()
  })

  test('missing issue_url rejects', () => {
    const { issue_url: _, ...invalid } = validComment
    expect(() => GitHubCommentSchema.parse(invalid)).toThrow()
  })

  test('author_association as number rejects', () => {
    expect(() => GitHubCommentSchema.parse({ ...validComment, author_association: 7 })).toThrow()
  })

  test('extra fields stripped', () => {
    const result = GitHubCommentSchema.parse(validComment)
    expect('node_id' in result).toBe(false)
    expect('reactions' in result).toBe(false)
  })
})
