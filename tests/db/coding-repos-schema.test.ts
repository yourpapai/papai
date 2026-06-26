// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { codingSessionRepos } from '../../src/db/coding-repos-schema.js'
import { getDrizzleDb } from '../../src/db/drizzle.js'
import { setupTestDb } from '../utils/test-helpers.js'

describe('codingSessionRepos schema', () => {
  test('inserts and reads a coding repo row', async () => {
    await setupTestDb()

    getDrizzleDb()
      .insert(codingSessionRepos)
      .values({
        contextId: 'pi:telegram:ctx:user-1',
        repoId: 'repo-uuid-1',
        name: 'my-repo',
        repoUrl: 'https://github.com/acme/my-repo.git',
        baseBranch: 'main',
        permissionPreset: 'cautious',
        updatedAt: 1710000000000,
        updatedBy: 'user-1',
      })
      .run()

    const row = getDrizzleDb().select().from(codingSessionRepos).get()
    expect(row).toEqual({
      contextId: 'pi:telegram:ctx:user-1',
      repoId: 'repo-uuid-1',
      name: 'my-repo',
      repoUrl: 'https://github.com/acme/my-repo.git',
      baseBranch: 'main',
      permissionPreset: 'cautious',
      updatedAt: 1710000000000,
      updatedBy: 'user-1',
    })
  })
})
