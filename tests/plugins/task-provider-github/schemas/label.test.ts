// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { GitHubRepoLabelSchema, type GitHubRepoLabel } from '../../../../plugins/task-provider-github/schemas/label.js'

describe('GitHubRepoLabelSchema', () => {
  const validLabel = {
    id: 208045946,
    node_id: 'MDU6TGFiZWwyMDgwNDU5NDY=',
    url: 'https://api.github.com/repos/octocat/Hello-World/labels/bug',
    name: 'bug',
    color: 'f29513',
    default: true,
    description: "Something isn't working",
  }

  test('accepts a canonical repo-label payload and exports inferred type', () => {
    const parsed: GitHubRepoLabel = GitHubRepoLabelSchema.parse(validLabel)
    expect(parsed.id).toBe(208045946)
    expect(parsed.name).toBe('bug')
    expect(parsed.color).toBe('f29513')
    expect(parsed.description).toBe("Something isn't working")
  })

  test('description as null accepts (unset description)', () => {
    expect(GitHubRepoLabelSchema.parse({ ...validLabel, description: null }).description).toBeNull()
  })

  test('missing description rejects', () => {
    const { description: _, ...invalid } = validLabel
    expect(() => GitHubRepoLabelSchema.parse(invalid)).toThrow()
  })

  test('description as number rejects', () => {
    expect(() => GitHubRepoLabelSchema.parse({ ...validLabel, description: 7 })).toThrow()
  })

  test('uppercase hex color rejects', () => {
    expect(() => GitHubRepoLabelSchema.parse({ ...validLabel, color: 'F29513' })).toThrow()
  })

  test('short color rejects', () => {
    expect(() => GitHubRepoLabelSchema.parse({ ...validLabel, color: 'f29' })).toThrow()
  })

  test('long color rejects', () => {
    expect(() => GitHubRepoLabelSchema.parse({ ...validLabel, color: 'f295133' })).toThrow()
  })

  test('non-hex color rejects', () => {
    expect(() => GitHubRepoLabelSchema.parse({ ...validLabel, color: 'zzzzzz' })).toThrow()
  })

  test('hash-prefixed color rejects', () => {
    expect(() => GitHubRepoLabelSchema.parse({ ...validLabel, color: '#f29513' })).toThrow()
  })

  test('missing color rejects', () => {
    const { color: _, ...invalid } = validLabel
    expect(() => GitHubRepoLabelSchema.parse(invalid)).toThrow()
  })

  test('color as number rejects', () => {
    expect(() => GitHubRepoLabelSchema.parse({ ...validLabel, color: 15844115 })).toThrow()
  })

  test('id as string rejects', () => {
    expect(() => GitHubRepoLabelSchema.parse({ ...validLabel, id: '208045946' })).toThrow()
  })

  test('id as non-integer number rejects', () => {
    expect(() => GitHubRepoLabelSchema.parse({ ...validLabel, id: 1.5 })).toThrow()
  })

  test('missing name rejects', () => {
    const { name: _, ...invalid } = validLabel
    expect(() => GitHubRepoLabelSchema.parse(invalid)).toThrow()
  })

  test('extra fields stripped', () => {
    const result = GitHubRepoLabelSchema.parse(validLabel)
    expect('node_id' in result).toBe(false)
    expect('url' in result).toBe(false)
    expect('default' in result).toBe(false)
  })
})
