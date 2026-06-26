// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { deleteRepo, listRepos, upsertRepo } from '../../src/coding-repos/store.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const CTX = 'pi:telegram:ctx:u1'

describe('coding-repos store', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })
  afterEach(() => {
    // isolation is handled by setupTestDb resetting the DB per test
  })

  test('upsert + list round-trip', () => {
    const id = upsertRepo(
      CTX,
      { name: 'demo', repoUrl: 'https://github.com/acme/demo.git', baseBranch: 'main', permissionPreset: 'cautious' },
      'u1',
    )
    expect(listRepos(CTX).map((r) => r.name)).toEqual(['demo'])
    expect(typeof id).toBe('string')
  })

  test('rejects non-https url', () => {
    expect(() =>
      upsertRepo(CTX, { name: 'x', repoUrl: 'http://h/r.git', baseBranch: 'main', permissionPreset: 'cautious' }, 'u1'),
    ).toThrow()
  })

  test('rejects empty name', () => {
    expect(() =>
      upsertRepo(CTX, { name: '', repoUrl: 'https://h/r.git', baseBranch: 'main', permissionPreset: 'cautious' }, 'u1'),
    ).toThrow()
  })

  test('name is unique per context; upsert by name replaces', () => {
    upsertRepo(
      CTX,
      { name: 'demo', repoUrl: 'https://github.com/a/b.git', baseBranch: 'main', permissionPreset: 'cautious' },
      'u1',
    )
    upsertRepo(
      CTX,
      { name: 'demo', repoUrl: 'https://github.com/a/c.git', baseBranch: 'dev', permissionPreset: 'autonomous' },
      'u1',
    )
    expect(listRepos(CTX)).toHaveLength(1)
    const repos = listRepos(CTX)
    expect(repos[0]?.baseBranch).toBe('dev')
  })

  test('delete + context isolation', () => {
    const id = upsertRepo(
      CTX,
      { name: 'demo', repoUrl: 'https://github.com/a/b.git', baseBranch: 'main', permissionPreset: 'cautious' },
      'u1',
    )
    deleteRepo(CTX, id, 'u1')
    expect(listRepos(CTX)).toEqual([])
    upsertRepo(
      CTX,
      { name: 'demo', repoUrl: 'https://github.com/a/b.git', baseBranch: 'main', permissionPreset: 'cautious' },
      'u1',
    )
    expect(listRepos('pi:telegram:ctx:u2')).toEqual([])
  })
})
