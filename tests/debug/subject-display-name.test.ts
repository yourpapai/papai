// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { users } from '../../src/db/schema.js'
import { resolveDmDisplayNames } from '../../src/debug/subject-display-name.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('resolveDmDisplayNames', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns empty map when no DM subjects are passed', () => {
    const result = resolveDmDisplayNames([])

    expect(result.size).toBe(0)
  })

  test('returns empty map when only group subjects are passed', () => {
    const result = resolveDmDisplayNames([{ storageContextId: 'group:123', contextType: 'group' }])

    expect(result.size).toBe(0)
  })

  test('resolves DM display names from users.username', () => {
    getDrizzleDb()
      .insert(users)
      .values([
        { platformUserId: 'u1', username: 'alice', addedBy: 'test' },
        { platformUserId: 'u2', username: 'bob', addedBy: 'test' },
      ])
      .run()

    const result = resolveDmDisplayNames([
      { storageContextId: 'u1', contextType: 'dm' },
      { storageContextId: 'u2', contextType: 'dm' },
    ])

    expect(result.get('u1')).toBe('alice')
    expect(result.get('u2')).toBe('bob')
  })

  test('returns null for DM subjects with no users row', () => {
    const result = resolveDmDisplayNames([{ storageContextId: 'unknown', contextType: 'dm' }])

    expect(result.size).toBe(0)
  })

  test('ignores group subjects when DM subjects are mixed in', () => {
    getDrizzleDb()
      .insert(users)
      .values([{ platformUserId: 'u1', username: 'alice', addedBy: 'test' }])
      .run()

    const result = resolveDmDisplayNames([
      { storageContextId: 'u1', contextType: 'dm' },
      { storageContextId: 'group:42', contextType: 'group' },
    ])

    expect(result.get('u1')).toBe('alice')
    expect(result.has('group:42')).toBe(false)
  })
})
