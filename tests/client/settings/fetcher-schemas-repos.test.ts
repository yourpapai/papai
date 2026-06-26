// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { RepoRecordSchema, ReposResponseSchema } from '../../../client/settings/fetcher-schemas-repos.js'

describe('fetcher-schemas-repos', () => {
  test('RepoRecordSchema parses a valid repo record', () => {
    const result = RepoRecordSchema.parse({
      repoId: 'r1',
      name: 'demo',
      repoUrl: 'https://github.com/acme/demo.git',
      baseBranch: 'main',
      permissionPreset: 'cautious',
    })
    expect(result.repoId).toBe('r1')
    expect(result.permissionPreset).toBe('cautious')
  })

  test('ReposResponseSchema parses repos array', () => {
    const result = ReposResponseSchema.parse({
      repos: [
        {
          repoId: 'r1',
          name: 'demo',
          repoUrl: 'https://github.com/acme/demo.git',
          baseBranch: 'main',
          permissionPreset: 'cautious',
        },
      ],
    })
    expect(result.repos).toHaveLength(1)
  })

  test('ReposResponseSchema parses empty repos array', () => {
    const result = ReposResponseSchema.parse({ repos: [] })
    expect(result.repos).toHaveLength(0)
  })

  test('RepoRecordSchema rejects missing required fields', () => {
    expect(() => RepoRecordSchema.parse({ repoId: 'r1' })).toThrow()
  })
})
