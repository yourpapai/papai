// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { GitHubUserSchema } from '../../../../plugins/task-provider-github/schemas/user.js'

describe('GitHubUserSchema', () => {
  const validUser = {
    login: 'octocat',
    id: 583231,
    avatar_url: 'https://avatars.githubusercontent.com/u/583231?v=4',
    html_url: 'https://github.com/octocat',
    type: 'User',
    site_admin: false,
    node_id: 'MDQ6VXNlcjU4MzIzMQ==',
  }

  test('accepts a representative user payload', () => {
    const result = GitHubUserSchema.parse(validUser)
    expect(result.login).toBe('octocat')
    expect(result.id).toBe(583231)
    expect(result.type).toBe('User')
  })

  test('accepts a bot account', () => {
    const result = GitHubUserSchema.parse({ ...validUser, login: 'dependabot[bot]', type: 'Bot' })
    expect(result.type).toBe('Bot')
  })

  test('missing login rejects', () => {
    const { login: _, ...invalid } = validUser
    expect(() => GitHubUserSchema.parse(invalid)).toThrow()
  })

  test('missing id rejects', () => {
    const { id: _, ...invalid } = validUser
    expect(() => GitHubUserSchema.parse(invalid)).toThrow()
  })

  test('missing avatar_url rejects', () => {
    const { avatar_url: _, ...invalid } = validUser
    expect(() => GitHubUserSchema.parse(invalid)).toThrow()
  })

  test('missing html_url rejects', () => {
    const { html_url: _, ...invalid } = validUser
    expect(() => GitHubUserSchema.parse(invalid)).toThrow()
  })

  test('missing type rejects', () => {
    const { type: _, ...invalid } = validUser
    expect(() => GitHubUserSchema.parse(invalid)).toThrow()
  })

  test('login as number rejects', () => {
    expect(() => GitHubUserSchema.parse({ ...validUser, login: 42 })).toThrow()
  })

  test('id as string rejects', () => {
    expect(() => GitHubUserSchema.parse({ ...validUser, id: '583231' })).toThrow()
  })

  test('id as non-integer rejects', () => {
    expect(() => GitHubUserSchema.parse({ ...validUser, id: 1.5 })).toThrow()
  })

  test('type as number rejects', () => {
    expect(() => GitHubUserSchema.parse({ ...validUser, type: 1 })).toThrow()
  })

  test('extra fields stripped', () => {
    const result = GitHubUserSchema.parse(validUser)
    expect('site_admin' in result).toBe(false)
    expect('node_id' in result).toBe(false)
  })
})
