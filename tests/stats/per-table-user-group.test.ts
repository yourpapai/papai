// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { groupMembers, groupUserObservations, users } from '../../src/db/schema.js'
import { groupBlockForSubject, userBlockForSubject } from '../../src/stats/per-table-subject.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('userBlockForSubject', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns null when no users row exists', () => {
    expect(userBlockForSubject('nobody')).toBeNull()
  })

  test('returns flags for an existing user without leaking PII', () => {
    getDrizzleDb()
      .insert(users)
      .values({
        platformUserId: 'u1',
        username: 'alice',
        addedAt: '2026-01-01T00:00:00Z',
        addedBy: 'admin',
        kaneoWorkspaceId: 'ws-1',
      })
      .run()

    const result = userBlockForSubject('u1')

    expect(result).not.toBeNull()
    expect(result?.addedAt).toBe('2026-01-01T00:00:00Z')
    expect(result?.addedByPresent).toBe(true)
    expect(result?.kaneoWorkspacePresent).toBe(true)
  })
})

describe('groupBlockForSubject', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns null when group has no members and no observations', () => {
    expect(groupBlockForSubject('group:0')).toBeNull()
  })

  test('aggregates member count, distinct added_by, and observation count', () => {
    getDrizzleDb()
      .insert(groupMembers)
      .values([
        { groupId: 'group:1', userId: 'u1', addedBy: 'admin' },
        { groupId: 'group:1', userId: 'u2', addedBy: 'admin' },
        { groupId: 'group:1', userId: 'u3', addedBy: 'someone-else' },
      ])
      .run()
    getDrizzleDb()
      .insert(groupUserObservations)
      .values([
        {
          provider: 'telegram',
          contextId: 'group:1',
          userId: 'u1',
          displayLabel: 'A',
          lastSeenAt: '2026-01-01T00:00:00Z',
        },
        {
          provider: 'telegram',
          contextId: 'group:1',
          userId: 'u2',
          displayLabel: 'B',
          lastSeenAt: '2026-01-02T00:00:00Z',
        },
      ])
      .run()

    const result = groupBlockForSubject('group:1')

    expect(result).not.toBeNull()
    expect(result?.memberCount).toBe(3)
    expect(result?.distinctAddedBy).toBe(2)
    expect(result?.observationCount).toBe(2)
  })
})
