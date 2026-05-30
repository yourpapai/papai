// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { toScopedContextId, toScopedThreadContextId } from '../../src/chat/scoped-context.js'
import { getDrizzleDb } from '../../src/db/drizzle.js'
import { groupMembers, groupUserObservations, platformInstances, userConfig, users } from '../../src/db/schema.js'
import { groupBlockForSubject, userBlockForSubject } from '../../src/stats/per-table-subject.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const seedPlatform = (id: string): void => {
  getDrizzleDb()
    .insert(platformInstances)
    .values({ id, type: 'telegram', config: '{}', status: 'active' })
    .onConflictDoNothing()
    .run()
}

describe('userBlockForSubject', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns null when no users row exists', () => {
    expect(userBlockForSubject('nobody')).toBeNull()
  })

  test('returns flags for an existing user without leaking PII', () => {
    seedPlatform('legacy-single')

    getDrizzleDb()
      .insert(users)
      .values({
        platformUserId: 'u1',
        platformInstanceId: 'legacy-single',
        username: 'alice',
        addedAt: '2026-01-01T00:00:00Z',
        addedBy: 'admin',
      })
      .run()
    getDrizzleDb()
      .insert(userConfig)
      .values({ userId: 'u1', key: 'plugin:task-provider-kaneo:provider:workspaceId', value: 'ws-1' })
      .run()

    const result = userBlockForSubject('u1')

    expect(result).not.toBeNull()
    expect(result?.addedAt).toBe('2026-01-01T00:00:00Z')
    expect(result?.addedByPresent).toBe(true)
    expect(result?.kaneoWorkspacePresent).toBe(true)
  })

  test('returns scoped user stats for the matching platform instance', () => {
    const scopedUserId = toScopedContextId({ platformInstanceId: 'telegram-main', nativeContextId: 'u1' })
    seedPlatform('telegram-main')
    seedPlatform('discord-main')

    getDrizzleDb()
      .insert(users)
      .values([
        {
          platformUserId: 'u1',
          platformInstanceId: 'telegram-main',
          addedAt: '2026-01-01T00:00:00Z',
          addedBy: 'admin',
        },
        {
          platformUserId: 'u1',
          platformInstanceId: 'discord-main',
          addedAt: '2026-02-01T00:00:00Z',
          addedBy: '',
        },
      ])
      .run()
    getDrizzleDb()
      .insert(userConfig)
      .values({ userId: scopedUserId, key: 'plugin:task-provider-kaneo:provider:workspaceId', value: 'ws-scoped' })
      .run()

    const result = userBlockForSubject(scopedUserId)

    expect(result).toEqual({
      addedAt: '2026-01-01T00:00:00Z',
      addedByPresent: true,
      kaneoWorkspacePresent: true,
    })
  })

  test('does not treat thread-scoped contexts as user rows', () => {
    const threadScopedId = toScopedThreadContextId({
      platformInstanceId: 'telegram-main',
      nativeContextId: 'u1',
      threadId: 'topic-1',
    })
    seedPlatform('telegram-main')

    getDrizzleDb()
      .insert(users)
      .values({
        platformUserId: 'u1',
        platformInstanceId: 'telegram-main',
        addedAt: '2026-01-01T00:00:00Z',
        addedBy: 'admin',
      })
      .run()

    expect(userBlockForSubject(threadScopedId)).toBeNull()
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
