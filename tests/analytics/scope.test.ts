// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { buildIdentityKeys, type IdentityInput } from '../../src/analytics/identity/scope.js'
import { toScopedContextId, toScopedThreadContextId } from '../../src/chat/scoped-context.js'

const FROZEN_KEY = Buffer.from('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex')

function scoped(group: string): string {
  return toScopedContextId({ platformInstanceId: 'platform-1', nativeContextId: group })
}

function thread(group: string, threadId: string): string {
  return toScopedThreadContextId({
    platformInstanceId: 'platform-1',
    nativeContextId: group,
    threadId,
  })
}

function input(overrides: Partial<IdentityInput>): IdentityInput {
  return {
    key: FROZEN_KEY,
    keyVersion: 'v1',
    platform: 'telegram',
    platformInstanceId: 'platform-1',
    storageContextId: scoped('dm-user-42'),
    chatUserId: 'user-42',
    actorRole: 'member',
    rawTurnId: 'turn-1',
    taskInstanceId: null,
    sessionStartMs: null,
    firstEventId: null,
    ...overrides,
  }
}

describe('scope truth table', () => {
  test('DM context produces actor, context, thread, turn, conversation, and session keys', () => {
    const keys = buildIdentityKeys(input({ storageContextId: scoped('dm-user-42') }))
    expect(keys.actor_key).not.toBeNull()
    expect(keys.context_key).not.toBeNull()
    expect(keys.thread_key).not.toBeNull()
    expect(keys.turn_key).not.toBeNull()
    expect(keys.conversation_key).toBe(keys.thread_key)
  })

  test('Telegram group thread keeps thread and conversation separate from config context', () => {
    const keys = buildIdentityKeys(
      input({
        storageContextId: thread('group-99', 'thread-7'),
        chatUserId: 'user-42',
      }),
    )
    expect(keys.context_key).not.toBeNull()
    expect(keys.thread_key).not.toBeNull()
    expect(keys.conversation_key).toBe(keys.thread_key)
    expect(keys.context_key).not.toBe(keys.thread_key)
  })

  test('Mattermost group thread behaves like Telegram group thread', () => {
    const keys = buildIdentityKeys(
      input({
        platform: 'mattermost',
        storageContextId: thread('channel-3', 'root-9'),
        chatUserId: 'user-42',
      }),
    )
    expect(keys.context_key).not.toBeNull()
    expect(keys.thread_key).not.toBeNull()
    expect(keys.conversation_key).toBe(keys.thread_key)
  })

  test('Discord group has thread_key=null', () => {
    const keys = buildIdentityKeys(
      input({
        platform: 'discord',
        storageContextId: scoped('guild-channel-1'),
        chatUserId: 'user-42',
      }),
    )
    expect(keys.thread_key).toBeNull()
    expect(keys.conversation_key).toBe(keys.context_key)
  })

  test('malformed scoped IDs produce null longitudinal keys', () => {
    const keys = buildIdentityKeys(input({ storageContextId: 'not-a-scoped-id' }))
    expect(keys.actor_key).toBeNull()
    expect(keys.context_key).toBeNull()
    expect(keys.thread_key).toBeNull()
    expect(keys.turn_key).toBeNull()
    expect(keys.conversation_key).toBeNull()
  })

  test('group config sharing: config context id equals main context id for group', () => {
    const keys = buildIdentityKeys(input({ storageContextId: thread('group-99', 'thread-7') }))
    const configOnly = buildIdentityKeys(input({ storageContextId: scoped('group-99') }))
    expect(keys.context_key).toBe(configOnly.context_key)
  })

  test('sibling thread separation: two threads in same group have different thread/conversation keys', () => {
    const a = buildIdentityKeys(input({ storageContextId: thread('group-99', 'thread-a') }))
    const b = buildIdentityKeys(input({ storageContextId: thread('group-99', 'thread-b') }))
    expect(a.thread_key).not.toBe(b.thread_key)
    expect(a.conversation_key).not.toBe(b.conversation_key)
    expect(a.context_key).toBe(b.context_key)
  })
})

describe('Discord DM and group fixtures', () => {
  test('Discord DM for one actor: conversation_key = context_key, separate DMs differ, thread_key is null', () => {
    const dmA = buildIdentityKeys(
      input({
        platform: 'discord',
        storageContextId: scoped('user-42'),
        chatUserId: 'user-42',
      }),
    )
    const dmB = buildIdentityKeys(
      input({
        platform: 'discord',
        storageContextId: scoped('user-43'),
        chatUserId: 'user-42',
      }),
    )
    expect(dmA.thread_key).toBeNull()
    expect(dmB.thread_key).toBeNull()
    expect(dmA.conversation_key).toBe(dmA.context_key)
    expect(dmB.conversation_key).toBe(dmB.context_key)
    expect(dmA.conversation_key).not.toBe(dmB.conversation_key)
  })

  test('Discord group for one actor: conversation_key = context_key, groups differ, thread_key is null', () => {
    const groupA = buildIdentityKeys(
      input({
        platform: 'discord',
        storageContextId: scoped('guild-channel-1'),
        chatUserId: 'user-42',
      }),
    )
    const groupB = buildIdentityKeys(
      input({
        platform: 'discord',
        storageContextId: scoped('guild-channel-2'),
        chatUserId: 'user-42',
      }),
    )
    expect(groupA.thread_key).toBeNull()
    expect(groupB.thread_key).toBeNull()
    expect(groupA.conversation_key).toBe(groupA.context_key)
    expect(groupB.conversation_key).toBe(groupB.context_key)
    expect(groupA.conversation_key).not.toBe(groupB.conversation_key)
  })
})

describe('guest identity', () => {
  test('guest gets no longitudinal keys', () => {
    const keys = buildIdentityKeys(input({ actorRole: 'guest' }))
    expect(keys.actor_key).toBeNull()
    expect(keys.context_key).toBeNull()
    expect(keys.thread_key).toBeNull()
    expect(keys.turn_key).toBeNull()
    expect(keys.conversation_key).toBeNull()
    expect(keys.session_key).toBeNull()
  })
})

describe('session key', () => {
  test('is null without session inputs', () => {
    const keys = buildIdentityKeys(input({}))
    expect(keys.session_key).toBeNull()
  })

  test('is produced when session inputs are supplied', () => {
    const keys = buildIdentityKeys(input({ sessionStartMs: 1700000000000, firstEventId: 'event-1' }))
    expect(keys.session_key).not.toBeNull()
  })
})
