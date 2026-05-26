// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { and, eq } from 'drizzle-orm'

import { toScopedContextId } from '../../src/chat/scoped-context.js'
import { getDrizzleDb } from '../../src/db/drizzle.js'
import { groupAdminObservations, groupUserObservations, knownGroupContexts } from '../../src/db/schema.js'
import {
  findGroupUserObservation,
  findKnownGroupContext,
  listAdminGroupContextsForUser,
  upsertGroupAdminObservation,
  upsertGroupUserObservation,
  upsertKnownGroupContext,
} from '../../src/group-settings/registry.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

function getGroupContext(provider: string, contextId: string): typeof knownGroupContexts.$inferSelect | undefined {
  return getDrizzleDb()
    .select()
    .from(knownGroupContexts)
    .where(and(eq(knownGroupContexts.provider, provider), eq(knownGroupContexts.contextId, contextId)))
    .get()
}

function getAdminObservation(
  provider: string,
  contextId: string,
  userId: string,
): typeof groupAdminObservations.$inferSelect | undefined {
  return getDrizzleDb()
    .select()
    .from(groupAdminObservations)
    .where(
      and(
        eq(groupAdminObservations.provider, provider),
        eq(groupAdminObservations.contextId, contextId),
        eq(groupAdminObservations.userId, userId),
      ),
    )
    .get()
}

function getGroupUserObservation(
  provider: string,
  contextId: string,
  userId: string,
): typeof groupUserObservations.$inferSelect | undefined {
  return getDrizzleDb()
    .select()
    .from(groupUserObservations)
    .where(
      and(
        eq(groupUserObservations.provider, provider),
        eq(groupUserObservations.contextId, contextId),
        eq(groupUserObservations.userId, userId),
      ),
    )
    .get()
}

describe('group-settings registry', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('upserts known group contexts by root context id', () => {
    upsertKnownGroupContext({
      contextId: 'group-1',
      provider: 'telegram',
      displayName: 'Operations',
      parentName: 'Platform',
    })

    const row = getGroupContext('telegram', 'group-1')
    expect(row).toBeDefined()
    assert.ok(row !== undefined)
    expect(row.contextId).toBe('group-1')
    expect(row.displayName).toBe('Operations')
    expect(row.parentName).toBe('Platform')
  })

  test('stores the latest observed group user label per provider, group, and user', () => {
    upsertGroupUserObservation({
      provider: 'telegram',
      contextId: 'group-1',
      userId: 'user-1',
      username: 'alice',
      displayLabel: 'Alice Example (@alice)',
    })

    const observation = getGroupUserObservation('telegram', 'group-1', 'user-1')
    expect(observation).toBeDefined()
    assert.ok(observation !== undefined)
    expect(observation.displayLabel).toBe('Alice Example (@alice)')
    expect(observation.username).toBe('alice')
  })

  test('finds group user observations by exact provider, context, and user', () => {
    upsertGroupUserObservation({
      provider: 'telegram',
      contextId: 'group-1',
      userId: 'user-1',
      username: 'alice',
      displayLabel: 'Alice Example (@alice)',
    })
    upsertGroupUserObservation({
      provider: 'discord',
      contextId: 'group-1',
      userId: 'user-1',
      username: 'alice-discord',
      displayLabel: 'Alice Discord',
    })

    expect(findGroupUserObservation('telegram', 'group-1', 'user-1')).toEqual({
      provider: 'telegram',
      contextId: 'group-1',
      userId: 'user-1',
      username: 'alice',
      displayLabel: 'Alice Example (@alice)',
    })
  })

  test('finds known group contexts by provider and context id', () => {
    upsertKnownGroupContext({
      contextId: 'group-1',
      provider: 'telegram',
      displayName: 'Operations',
      parentName: 'Platform',
    })

    const telegramContext = findKnownGroupContext('telegram', 'group-1')

    expect(telegramContext).not.toBeNull()
    assert.ok(telegramContext !== null)
    expect(telegramContext.displayName).toBe('Operations')
    expect(findKnownGroupContext('discord', 'group-1')).toBeNull()
  })

  test('stores known group contexts separately per provider for the same context id', () => {
    upsertKnownGroupContext({
      contextId: 'shared-group',
      provider: 'telegram',
      displayName: 'Telegram Operations',
      parentName: null,
    })
    upsertKnownGroupContext({
      contextId: 'shared-group',
      provider: 'discord',
      displayName: 'Discord Operations',
      parentName: null,
    })

    const telegramContext = findKnownGroupContext('telegram', 'shared-group')
    const discordContext = findKnownGroupContext('discord', 'shared-group')

    expect(telegramContext).not.toBeNull()
    expect(discordContext).not.toBeNull()
    assert.ok(telegramContext !== null)
    assert.ok(discordContext !== null)
    expect(telegramContext.displayName).toBe('Telegram Operations')
    expect(discordContext.displayName).toBe('Discord Operations')
  })

  test('stores the latest admin observation per group and user', () => {
    upsertGroupAdminObservation({
      provider: 'telegram',
      contextId: 'group-1',
      userId: 'user-1',
      username: 'alice',
      isAdmin: true,
    })

    const observation = getAdminObservation('telegram', 'group-1', 'user-1')
    expect(observation).toBeDefined()
    assert.ok(observation !== undefined)
    expect(observation.username).toBe('alice')
    expect(observation.isAdmin).toBe(true)
  })

  test('lists admin groups for a user with a single join query', () => {
    upsertKnownGroupContext({
      contextId: 'g-1',
      provider: 'telegram',
      displayName: 'Alpha',
      parentName: null,
    })
    upsertKnownGroupContext({
      contextId: 'g-2',
      provider: 'telegram',
      displayName: 'Beta',
      parentName: null,
    })
    upsertKnownGroupContext({
      contextId: 'g-3',
      provider: 'telegram',
      displayName: 'Gamma',
      parentName: null,
    })
    upsertGroupAdminObservation({
      provider: 'telegram',
      contextId: 'g-1',
      userId: 'u-1',
      username: 'alice',
      isAdmin: true,
    })
    upsertGroupAdminObservation({
      provider: 'telegram',
      contextId: 'g-2',
      userId: 'u-1',
      username: 'alice',
      isAdmin: false,
    })
    upsertGroupAdminObservation({
      provider: 'telegram',
      contextId: 'g-3',
      userId: 'u-1',
      username: 'alice',
      isAdmin: true,
    })

    const groups = listAdminGroupContextsForUser('u-1')
    expect(groups.map((g) => g.contextId)).toEqual(['g-1', 'g-3'])
  })

  test('filters admin groups by scoped platform instance when native user ids collide', () => {
    const telegramGroupId = toScopedContextId({ platformInstanceId: 'telegram-main', nativeContextId: 'g-1' })
    const discordGroupId = toScopedContextId({ platformInstanceId: 'discord-main', nativeContextId: 'g-2' })
    upsertKnownGroupContext({
      contextId: telegramGroupId,
      provider: 'telegram',
      displayName: 'Telegram Alpha',
      parentName: null,
    })
    upsertKnownGroupContext({
      contextId: discordGroupId,
      provider: 'discord',
      displayName: 'Discord Beta',
      parentName: null,
    })
    upsertGroupAdminObservation({
      provider: 'telegram',
      contextId: telegramGroupId,
      userId: 'same-native-user',
      username: 'alice',
      isAdmin: true,
    })
    upsertGroupAdminObservation({
      provider: 'discord',
      contextId: discordGroupId,
      userId: 'same-native-user',
      username: 'alice',
      isAdmin: true,
    })

    expect(listAdminGroupContextsForUser('same-native-user', 'telegram-main').map((group) => group.contextId)).toEqual([
      telegramGroupId,
    ])
    expect(listAdminGroupContextsForUser('same-native-user', 'discord-main').map((group) => group.contextId)).toEqual([
      discordGroupId,
    ])
    expect(listAdminGroupContextsForUser('same-native-user').map((group) => group.contextId)).toEqual([
      discordGroupId,
      telegramGroupId,
    ])
  })

  test('does not expose unscoped legacy admin groups during scoped platform lookup', () => {
    upsertKnownGroupContext({
      contextId: 'legacy-group',
      provider: 'telegram',
      displayName: 'Legacy',
      parentName: null,
    })
    upsertGroupAdminObservation({
      provider: 'telegram',
      contextId: 'legacy-group',
      userId: 'same-native-user',
      username: 'alice',
      isAdmin: true,
    })

    expect(listAdminGroupContextsForUser('same-native-user', 'telegram-main')).toEqual([])
    expect(listAdminGroupContextsForUser('same-native-user').map((group) => group.contextId)).toEqual(['legacy-group'])
  })

  test('returns empty array when user has no admin groups', () => {
    upsertKnownGroupContext({
      contextId: 'g-1',
      provider: 'telegram',
      displayName: 'Alpha',
      parentName: null,
    })
    upsertGroupAdminObservation({
      provider: 'telegram',
      contextId: 'g-1',
      userId: 'u-1',
      username: 'alice',
      isAdmin: false,
    })

    expect(listAdminGroupContextsForUser('u-1')).toEqual([])
    expect(listAdminGroupContextsForUser('nonexistent')).toEqual([])
  })

  test('skips known group context upsert when lastSeenAt is within throttle window', () => {
    upsertKnownGroupContext({
      contextId: 'g-t',
      provider: 'telegram',
      displayName: 'Ops',
      parentName: null,
    })
    const first = getGroupContext('telegram', 'g-t')!

    upsertKnownGroupContext({
      contextId: 'g-t',
      provider: 'telegram',
      displayName: 'Ops',
      parentName: null,
    })
    const second = getGroupContext('telegram', 'g-t')!

    expect(second.lastSeenAt).toBe(first.lastSeenAt)
  })

  test('updates known group context when lastSeenAt is outside throttle window', () => {
    upsertKnownGroupContext({
      contextId: 'g-e',
      provider: 'telegram',
      displayName: 'Ops',
      parentName: null,
    })

    const staleTime = new Date(Date.now() - 6 * 60 * 1000).toISOString()
    getDrizzleDb()
      .update(knownGroupContexts)
      .set({ lastSeenAt: staleTime })
      .where(and(eq(knownGroupContexts.provider, 'telegram'), eq(knownGroupContexts.contextId, 'g-e')))
      .run()

    upsertKnownGroupContext({
      contextId: 'g-e',
      provider: 'telegram',
      displayName: 'Ops',
      parentName: null,
    })
    const after = getGroupContext('telegram', 'g-e')!

    expect(after.lastSeenAt > staleTime).toBe(true)
  })

  test('skips admin observation upsert when lastSeenAt is within throttle window', () => {
    upsertGroupAdminObservation({
      provider: 'telegram',
      contextId: 'g-t',
      userId: 'u-1',
      username: 'alice',
      isAdmin: true,
    })
    const first = getAdminObservation('telegram', 'g-t', 'u-1')!

    upsertGroupAdminObservation({
      provider: 'telegram',
      contextId: 'g-t',
      userId: 'u-1',
      username: 'alice',
      isAdmin: true,
    })
    const second = getAdminObservation('telegram', 'g-t', 'u-1')!

    expect(second.lastSeenAt).toBe(first.lastSeenAt)
  })

  test('writes through throttle when isAdmin changes within throttle window', () => {
    upsertGroupAdminObservation({
      provider: 'telegram',
      contextId: 'g-t',
      userId: 'u-1',
      username: 'alice',
      isAdmin: true,
    })
    const first = getAdminObservation('telegram', 'g-t', 'u-1')!

    upsertGroupAdminObservation({
      provider: 'telegram',
      contextId: 'g-t',
      userId: 'u-1',
      username: 'alice',
      isAdmin: false,
    })
    const second = getAdminObservation('telegram', 'g-t', 'u-1')!

    expect(second.isAdmin).toBe(false)
    expect(second.lastSeenAt >= first.lastSeenAt).toBe(true)
  })

  test('updates admin observation when lastSeenAt is outside throttle window', () => {
    upsertGroupAdminObservation({
      provider: 'telegram',
      contextId: 'g-e',
      userId: 'u-1',
      username: 'alice',
      isAdmin: true,
    })

    const staleTime = new Date(Date.now() - 6 * 60 * 1000).toISOString()
    getDrizzleDb()
      .update(groupAdminObservations)
      .set({ lastSeenAt: staleTime })
      .where(
        and(
          eq(groupAdminObservations.provider, 'telegram'),
          eq(groupAdminObservations.contextId, 'g-e'),
          eq(groupAdminObservations.userId, 'u-1'),
        ),
      )
      .run()

    upsertGroupAdminObservation({
      provider: 'telegram',
      contextId: 'g-e',
      userId: 'u-1',
      username: 'bob',
      isAdmin: false,
    })
    const after = getAdminObservation('telegram', 'g-e', 'u-1')!

    expect(after.lastSeenAt > staleTime).toBe(true)
    expect(after.username).toBe('bob')
    expect(after.isAdmin).toBe(false)
  })
})
