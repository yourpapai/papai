// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { computeScore, gatherParticipants, resolveChatParticipant } from '../../../src/chat/participants/roster.js'
import { toScopedContextId, toScopedThreadContextId } from '../../../src/chat/scoped-context.js'
import { getDrizzleDb } from '../../../src/db/drizzle.js'
import { groupMembers, messageMetadata } from '../../../src/db/schema.js'
import { mockLogger, setupTestDb } from '../../utils/test-helpers.js'

// plain contextId (non-thread-scoped; config = same)
const GROUP_CTX = 'g-test'
// real scoped ids: group-level and thread-level, keyed by the same pi/ctx pair
const GROUP_SCOPED = toScopedContextId({ platformInstanceId: 'pi1', nativeContextId: 'grp1' })
const THREAD_SCOPED = toScopedThreadContextId({ platformInstanceId: 'pi1', nativeContextId: 'grp1', threadId: 't1' })

const NOW_TS = 1_000_000_000
const FAR_FUTURE = NOW_TS + 86_400 * 365

function insertMember(groupId: string, userId: string): void {
  getDrizzleDb().insert(groupMembers).values({ groupId, userId, addedBy: 'test' }).onConflictDoNothing().run()
}

function insertSender(contextId: string, messageId: string, authorId: string, username: string | null): void {
  getDrizzleDb()
    .insert(messageMetadata)
    .values({
      contextId,
      messageId,
      authorId,
      authorUsername: username,
      timestamp: NOW_TS,
      expiresAt: FAR_FUTURE,
    })
    .run()
}

describe('gatherParticipants', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns group_members for the group context id', () => {
    insertMember(GROUP_CTX, 'u1')
    insertMember(GROUP_CTX, 'u2')

    const candidates = gatherParticipants(GROUP_CTX)
    expect(candidates.map((c) => c.userId).sort()).toEqual(['u1', 'u2'])
  })

  test('returns distinct senders from message_metadata', () => {
    insertSender(GROUP_CTX, 'm1', 'u3', 'charlie')
    insertSender(GROUP_CTX, 'm2', 'u3', 'charlie')

    const candidates = gatherParticipants(GROUP_CTX)
    const userIds = candidates.map((c) => c.userId)
    expect(userIds.filter((id) => id === 'u3')).toHaveLength(1)
  })

  test('dedupes members and senders that share a userId', () => {
    insertMember(GROUP_CTX, 'u1')
    insertSender(GROUP_CTX, 'm1', 'u1', 'alice')

    const candidates = gatherParticipants(GROUP_CTX)
    expect(candidates.map((c) => c.userId)).toHaveLength(1)
  })

  test('skips message_metadata rows with null authorId', () => {
    getDrizzleDb()
      .insert(messageMetadata)
      .values({
        contextId: GROUP_CTX,
        messageId: 'm-null',
        authorId: null,
        authorUsername: null,
        timestamp: NOW_TS,
        expiresAt: FAR_FUTURE,
      })
      .run()

    const candidates = gatherParticipants(GROUP_CTX)
    expect(candidates).toHaveLength(0)
  })

  test('exposes username from message_metadata', () => {
    insertSender(GROUP_CTX, 'm1', 'u1', 'alice')
    const candidates = gatherParticipants(GROUP_CTX)
    expect(candidates[0]?.username).toBe('alice')
  })

  test('prefers username from message_metadata when member and sender share a userId', () => {
    insertSender(GROUP_CTX, 'm1', 'u1', 'alice_from_meta')
    insertMember(GROUP_CTX, 'u1')
    const candidates = gatherParticipants(GROUP_CTX)
    expect(candidates.find((c) => c.userId === 'u1')?.username).toBe('alice_from_meta')
  })

  test('uses group-level context id (strips thread suffix) for member lookup', () => {
    // member stored under GROUP_SCOPED (the config-context id); lookup via THREAD_SCOPED
    insertMember(GROUP_SCOPED, 'u-member')
    const candidates = gatherParticipants(THREAD_SCOPED)
    expect(candidates.find((c) => c.userId === 'u-member')).toBeDefined()
  })
})

describe('computeScore', () => {
  test('exact match (case-insensitive) returns 3', () => {
    expect(computeScore('alice', 'Alice', null)).toBe(3)
    expect(computeScore('alice', null, 'Alice')).toBe(3)
  })

  test('prefix match returns 2', () => {
    expect(computeScore('ali', 'Alice Smith', null)).toBe(2)
  })

  test('substring match returns 1', () => {
    expect(computeScore('ice', 'Alice', null)).toBe(1)
  })

  test('no match returns 0', () => {
    expect(computeScore('bob', 'Alice', 'alice')).toBe(0)
  })

  test('exact match on either displayName or username scores 3', () => {
    // When displayName matches exactly and username also matches exactly, score is still 3
    expect(computeScore('alice', 'alice', 'alice')).toBe(3)
  })
})

describe('resolveChatParticipant', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('resolves display name via resolveLabel, falls back to username, then userId', async () => {
    insertSender(GROUP_CTX, 'm1', 'u1', 'alice')

    const calls: string[] = []
    const resolveLabel = (userId: string): Promise<string | null> => {
      calls.push(userId)
      return Promise.resolve('Alice Smith')
    }

    const results = await resolveChatParticipant(GROUP_CTX, 'alice', resolveLabel)
    expect(results[0]?.displayName).toBe('Alice Smith')
    expect(calls).toContain('u1')
  })

  test('falls back to username when resolveLabel returns null', async () => {
    insertSender(GROUP_CTX, 'm1', 'u1', 'alice')
    const results = await resolveChatParticipant(GROUP_CTX, 'alice', () => Promise.resolve(null))
    expect(results[0]?.displayName).toBe('alice')
  })

  test('falls back to userId when resolveLabel returns null and username is null', async () => {
    insertMember(GROUP_CTX, 'u-no-username')
    const results = await resolveChatParticipant(GROUP_CTX, 'u-no-username', () => Promise.resolve(null))
    expect(results[0]?.displayName).toBe('u-no-username')
  })

  test('returns empty array when no candidate matches the query', async () => {
    insertSender(GROUP_CTX, 'm1', 'u1', 'alice')
    const results = await resolveChatParticipant(GROUP_CTX, 'zzznomatch', (id) => Promise.resolve(id))
    expect(results).toHaveLength(0)
  })

  test('ranks exact match above prefix above substring', async () => {
    // usernames drive scoring when resolveLabel returns null
    // exact match for query 'ali'
    insertSender(GROUP_CTX, 'm1', 'u-exact', 'ali')
    // prefix match
    insertSender(GROUP_CTX, 'm2', 'u-prefix', 'ali smith')
    // substring match
    insertSender(GROUP_CTX, 'm3', 'u-sub', 'xaliy')

    const results = await resolveChatParticipant(GROUP_CTX, 'ali', () => Promise.resolve(null))
    expect(results.map((r) => r.userId)).toEqual(['u-exact', 'u-prefix', 'u-sub'])
  })

  test('respects limit parameter', async () => {
    for (let i = 0; i < 5; i++) {
      insertSender(GROUP_CTX, `m${i}`, `u${i}`, `alice${i}`)
    }
    const results = await resolveChatParticipant(GROUP_CTX, 'alice', (id) => Promise.resolve(id), 2)
    expect(results).toHaveLength(2)
  })

  test('returns empty array for empty query even when candidates exist', async () => {
    insertSender(GROUP_CTX, 'm1', 'u1', 'alice')
    const results = await resolveChatParticipant(GROUP_CTX, '', () => Promise.resolve(null))
    expect(results).toHaveLength(0)
  })

  test('returns empty array for whitespace-only query even when candidates exist', async () => {
    insertSender(GROUP_CTX, 'm1', 'u1', 'alice')
    const results = await resolveChatParticipant(GROUP_CTX, '   ', () => Promise.resolve(null))
    expect(results).toHaveLength(0)
  })

  test('resolveLabel called with p-limit concurrency (all users resolved)', async () => {
    for (let i = 0; i < 12; i++) {
      insertMember(GROUP_CTX, `bulk-u${i}`)
    }
    const resolved: string[] = []
    const resolveLabel = (userId: string): Promise<string | null> => {
      resolved.push(userId)
      return Promise.resolve(`User ${userId}`)
    }
    await resolveChatParticipant(GROUP_CTX, 'bulk', resolveLabel)
    // All 12 members must be resolved despite p-limit capping concurrency
    expect(resolved).toHaveLength(12)
  })
})
