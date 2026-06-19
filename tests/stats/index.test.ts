// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { toScopedContextId, toScopedThreadContextId } from '../../src/chat/scoped-context.js'
import { getDrizzleDb } from '../../src/db/drizzle.js'
import { platformInstances } from '../../src/db/instance-schema.js'
import { authorizedGroups, groupMembers, llmUsageEvents, userConfig, users } from '../../src/db/schema.js'
import { clearStatsCacheForTesting, getGlobalStats, getSubjectStats } from '../../src/stats/index.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('getSubjectStats', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    clearStatsCacheForTesting()
  })

  test('returns null for unknown subject', () => {
    expect(getSubjectStats('nobody')).toBeNull()
  })

  test('returns populated SubjectStats with userBlock for a DM subject', () => {
    getDrizzleDb()
      .insert(platformInstances)
      .values({ id: 'legacy-single', type: 'telegram', config: '{}', status: 'active' })
      .run()
    getDrizzleDb()
      .insert(users)
      .values([{ platformUserId: 'u1', platformInstanceId: 'legacy-single', addedBy: 'admin', username: 'alice' }])
      .run()
    getDrizzleDb()
      .insert(llmUsageEvents)
      .values([
        {
          eventId: 'e1',
          occurredAt: 1000,
          storageContextId: 'u1',
          contextType: 'dm',
          chatUserId: 'u1',
          model: 'm',
          modelRole: 'main',
          inputTokens: 50,
          outputTokens: 25,
          durationMs: 1,
        },
      ])
      .run()

    const result = getSubjectStats('u1')
    expect(result).not.toBeNull()
    expect(result?.storageContextId).toBe('u1')
    expect(result?.contextType).toBe('dm')
    expect(result?.chatUserId).toBe('u1')
    expect(result?.displayName).toBeNull()
    expect(result?.userBlock).not.toBeNull()
    expect(result?.groupBlock).toBeNull()
    expect(result?.llmUsage.rowCount).toBe(1)
    expect(result?.llmUsage.inputTokensTotal).toBe(50)
  })

  test('returns DM stats for a scoped user before usage rows exist', () => {
    const scopedUserId = toScopedContextId({ platformInstanceId: 'telegram-main', nativeContextId: 'u1' })
    getDrizzleDb()
      .insert(platformInstances)
      .values({ id: 'telegram-main', type: 'telegram', config: '{}', status: 'active' })
      .run()
    getDrizzleDb()
      .insert(users)
      .values({ platformUserId: 'u1', platformInstanceId: 'telegram-main', addedBy: 'admin', username: 'alice' })
      .run()
    getDrizzleDb()
      .insert(userConfig)
      .values({ userId: scopedUserId, key: 'plugin:task-provider-kaneo:provider:workspaceId', value: 'workspace-1' })
      .run()

    const result = getSubjectStats(scopedUserId)

    expect(result).not.toBeNull()
    expect(result?.contextType).toBe('dm')
    expect(result?.chatUserId).toBe('u1')
    expect(result?.llmUsage.rowCount).toBe(0)
    expect(result?.userBlock?.kaneoWorkspacePresent).toBe(true)
  })

  test('does not classify thread-scoped user contexts as DMs from users', () => {
    const threadScopedUserId = toScopedThreadContextId({
      platformInstanceId: 'telegram-main',
      nativeContextId: 'u1',
      threadId: 'topic-1',
    })
    getDrizzleDb()
      .insert(platformInstances)
      .values({ id: 'telegram-main', type: 'telegram', config: '{}', status: 'active' })
      .run()
    getDrizzleDb()
      .insert(users)
      .values([
        { platformUserId: 'u1', platformInstanceId: 'telegram-main', addedBy: 'admin', username: 'alice' },
        { platformUserId: threadScopedUserId, platformInstanceId: 'telegram-main', addedBy: 'admin' },
      ])
      .run()

    expect(getSubjectStats(threadScopedUserId)).toBeNull()
  })

  test('returns SubjectStats with groupBlock present for a group subject', () => {
    getDrizzleDb()
      .insert(authorizedGroups)
      .values([{ groupId: 'g1', addedBy: 'admin' }])
      .run()
    getDrizzleDb()
      .insert(groupMembers)
      .values([{ groupId: 'g1', userId: 'u1', addedBy: 'admin' }])
      .run()

    const result = getSubjectStats('g1')
    expect(result).not.toBeNull()
    expect(result?.contextType).toBe('group')
    expect(result?.userBlock).toBeNull()
    expect(result?.groupBlock).not.toBeNull()
    expect(result?.groupBlock?.memberCount).toBe(1)
  })
})

describe('getGlobalStats', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    clearStatsCacheForTesting()
  })

  test('returns shape with all top-level keys', () => {
    const result = getGlobalStats()
    expect(result.subjects).toBeDefined()
    expect(result.active).toBeDefined()
    expect(result.distributions).toBeDefined()
    expect(result.storage).toBeDefined()
    expect(result.identityMix).toBeDefined()
    expect(result.surfaceMix).toBeDefined()
    expect(result.webFetches).toBeDefined()
    expect(result.toolMix).toBeDefined()
    expect(result.tokenUsageByDay).toBeDefined()
    expect(Array.isArray(result.tokenUsageByDay)).toBe(true)
    expect(typeof result.generatedAt).toBe('number')
  })

  test('caches result across back-to-back default calls', () => {
    const a = getGlobalStats()
    const b = getGlobalStats()
    expect(a).toBe(b)
  })

  test('noCache option recomputes every call', () => {
    const a = getGlobalStats({ noCache: true })
    const b = getGlobalStats({ noCache: true })
    expect(a).not.toBe(b)
  })

  test('cache invalidated when window parameter changes', () => {
    const a = getGlobalStats({ window: '7d' })
    const b = getGlobalStats({ window: '30d' })
    expect(a).not.toBe(b)
    expect(a.window).toBe('7d')
    expect(b.window).toBe('30d')
  })
})
