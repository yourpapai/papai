// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { GitHubRepoSchema } from '../../../../plugins/task-provider-github/schemas/repo.js'

describe('GitHubRepoSchema', () => {
  const validRepo = {
    id: 1296269,
    name: 'Hello-World',
    full_name: 'octocat/Hello-World',
    owner: {
      login: 'octocat',
      id: 583231,
      avatar_url: 'https://avatars.githubusercontent.com/u/583231?v=4',
      html_url: 'https://github.com/octocat',
      type: 'User',
    },
    html_url: 'https://github.com/octocat/Hello-World',
    private: false,
    description: 'This your first repo!',
    fork: false,
    url: 'https://api.github.com/repos/octocat/Hello-World',
  }

  test('accepts a representative repo payload', () => {
    const result = GitHubRepoSchema.parse(validRepo)
    expect(result.id).toBe(1296269)
    expect(result.full_name).toBe('octocat/Hello-World')
    expect(result.owner.login).toBe('octocat')
    expect(result.private).toBe(false)
  })

  test('accepts a private repo', () => {
    const result = GitHubRepoSchema.parse({ ...validRepo, private: true })
    expect(result.private).toBe(true)
  })

  test('accepts null description (GitHub sends null when unset)', () => {
    const result = GitHubRepoSchema.parse({ ...validRepo, description: null })
    expect(result.description).toBeNull()
  })

  test('accepts empty description', () => {
    const result = GitHubRepoSchema.parse({ ...validRepo, description: '' })
    expect(result.description).toBe('')
  })

  test('missing id rejects', () => {
    const { id: _, ...invalid } = validRepo
    expect(() => GitHubRepoSchema.parse(invalid)).toThrow()
  })

  test('missing name rejects', () => {
    const { name: _, ...invalid } = validRepo
    expect(() => GitHubRepoSchema.parse(invalid)).toThrow()
  })

  test('missing full_name rejects', () => {
    const { full_name: _, ...invalid } = validRepo
    expect(() => GitHubRepoSchema.parse(invalid)).toThrow()
  })

  test('missing owner rejects', () => {
    const { owner: _, ...invalid } = validRepo
    expect(() => GitHubRepoSchema.parse(invalid)).toThrow()
  })

  test('malformed owner rejects', () => {
    expect(() => GitHubRepoSchema.parse({ ...validRepo, owner: { login: 'no-id' } })).toThrow()
  })

  test('missing html_url rejects', () => {
    const { html_url: _, ...invalid } = validRepo
    expect(() => GitHubRepoSchema.parse(invalid)).toThrow()
  })

  test('missing private rejects', () => {
    const { private: _, ...invalid } = validRepo
    expect(() => GitHubRepoSchema.parse(invalid)).toThrow()
  })

  test('private as string rejects', () => {
    expect(() => GitHubRepoSchema.parse({ ...validRepo, private: 'false' })).toThrow()
  })

  test('missing description rejects when absent (GitHub sends null, omits never)', () => {
    const { description: _, ...invalid } = validRepo
    expect(() => GitHubRepoSchema.parse(invalid)).toThrow()
  })

  test('description as number rejects', () => {
    expect(() => GitHubRepoSchema.parse({ ...validRepo, description: 42 })).toThrow()
  })

  test('extra fields stripped', () => {
    const result = GitHubRepoSchema.parse(validRepo)
    expect('fork' in result).toBe(false)
    expect('url' in result).toBe(false)
  })
})
