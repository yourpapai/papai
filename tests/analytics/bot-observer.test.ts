// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import {
  analyticsActorRole,
  buildAnalyticsSourceContext,
  buildAuthCheckedFact,
  buildChatMessageAcceptedFact,
  commandPropOf,
  createAuthorizedTurnSeed,
} from '../../src/analytics/bot-observer.js'
import { getThreadScopedStorageContextId } from '../../src/auth.js'
import type { AuthorizationResult } from '../../src/chat/types.js'
import { setContextSettings } from '../../src/instances/context-store.js'
import { insertTaskInstance } from '../../src/instances/task-store.js'
import { createDmMessage, mockLogger, seedCommonTestPlatformInstances, setupTestDb } from '../utils/test-helpers.js'

const TEST_PLATFORM_ID = 'test-instance'

function authOf(overrides: Partial<AuthorizationResult>): AuthorizationResult {
  return {
    allowed: true,
    isBotAdmin: false,
    isGroupAdmin: false,
    storageContextId: getThreadScopedStorageContextId('u1', 'dm', undefined, TEST_PLATFORM_ID),
    configContextId: getThreadScopedStorageContextId('u1', 'dm', undefined, TEST_PLATFORM_ID),
    ...overrides,
  }
}

describe('analyticsActorRole', () => {
  test('maps bot admin and group admin to admin without widening ActorRole', () => {
    expect(analyticsActorRole(authOf({ isBotAdmin: true }))).toBe('admin')
    expect(analyticsActorRole(authOf({ isGroupAdmin: true }))).toBe('admin')
  })

  test('maps guests and members', () => {
    expect(analyticsActorRole(authOf({ isGuest: true }))).toBe('guest')
    expect(analyticsActorRole(authOf({}))).toBe('member')
  })
})

describe('commandPropOf', () => {
  test('maps known commands to their named milestone', () => {
    expect(commandPropOf('start')).toBe('start')
    expect(commandPropOf('config')).toBe('config')
    expect(commandPropOf('stop')).toBe('stop')
  })

  test('maps coding-session commands to acp', () => {
    expect(commandPropOf('acp')).toBe('acp')
    expect(commandPropOf('plugin_acp_acp')).toBe('acp')
  })

  test('maps empty and unknown commands to none/other', () => {
    expect(commandPropOf('')).toBe('none')
    expect(commandPropOf('plugin_other_tool_sync')).toBe('other')
  })
})

describe('buildAuthCheckedFact', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()
  })

  test('granted outcomes map to bounded reasons', () => {
    const msg = createDmMessage('u1')
    const memberSource = buildAnalyticsSourceContext(msg, authOf({}), 'normal', null)
    assert.ok(memberSource !== null)
    expect(buildAuthCheckedFact(memberSource, authOf({})).outcome).toBe('granted')
    expect(buildAuthCheckedFact(memberSource, authOf({})).reason).toBe('member')
    expect(buildAuthCheckedFact(memberSource, authOf({ isBotAdmin: true })).reason).toBe('admin')
    expect(buildAuthCheckedFact(memberSource, authOf({ isGuest: true })).reason).toBe('guest_mode')
  })

  test('denied outcomes map to bounded reasons', () => {
    const msg = createDmMessage('u1')
    const source = buildAnalyticsSourceContext(msg, authOf({ allowed: false }), 'normal', null)
    assert.ok(source !== null)
    const denied = { allowed: false }
    expect(buildAuthCheckedFact(source, authOf({ ...denied, reason: 'user_blocked' })).reason).toBe('blocked')
    expect(buildAuthCheckedFact(source, authOf({ ...denied, reason: 'group_not_allowed' })).reason).toBe(
      'group_unauthorized',
    )
    expect(buildAuthCheckedFact(source, authOf({ ...denied, reason: 'group_member_not_allowed' })).reason).toBe(
      'group_unauthorized',
    )
    expect(buildAuthCheckedFact(source, authOf({ ...denied, reason: 'dm_not_allowed' })).reason).toBe('unknown_user')
    expect(buildAuthCheckedFact(source, authOf(denied)).reason).toBe('other')
  })
})

describe('buildAnalyticsSourceContext', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()
  })

  test('resolves authoritative platform instance, scopes, and role', () => {
    const msg = createDmMessage('u1')
    const source = buildAnalyticsSourceContext(msg, authOf({}), 'normal', null)
    expect(source).toEqual({
      platform: 'telegram',
      platformInstanceId: TEST_PLATFORM_ID,
      chatUserId: 'u1',
      nativeContextId: 'u1',
      storageContextId: getThreadScopedStorageContextId('u1', 'dm', undefined, TEST_PLATFORM_ID),
      configContextId: getThreadScopedStorageContextId('u1', 'dm', undefined, TEST_PLATFORM_ID),
      contextType: 'dm',
      actorRole: 'member',
      taskInstanceId: null,
      taskProvider: 'none',
      invocationMode: 'normal',
      rawTurnId: null,
    })
  })

  test('returns null when the platform instance is unknown', () => {
    const msg = { ...createDmMessage('u1'), platformInstanceId: 'missing-instance' }
    expect(buildAnalyticsSourceContext(msg, authOf({}), 'normal', null)).toBeNull()
  })

  test('maps task instance types to the bounded taskProvider enum', () => {
    const configContextId = getThreadScopedStorageContextId('u1', 'dm', undefined, TEST_PLATFORM_ID)
    insertTaskInstance({ id: 'kaneo-1', type: 'kaneo', config: { baseUrl: 'https://k.invalid' }, status: 'active' })
    insertTaskInstance({ id: 'custom-1', type: 'linear', config: {}, status: 'active' })
    const msg = createDmMessage('u1')
    setContextSettings({ contextId: configContextId, taskInstanceId: 'kaneo-1', platformInstanceId: TEST_PLATFORM_ID })
    const kaneoSource = buildAnalyticsSourceContext(msg, authOf({}), 'normal', null)
    expect(kaneoSource?.taskProvider).toBe('kaneo')
    expect(kaneoSource?.taskInstanceId).toBe('kaneo-1')
    setContextSettings({ contextId: configContextId, taskInstanceId: 'custom-1', platformInstanceId: TEST_PLATFORM_ID })
    expect(buildAnalyticsSourceContext(msg, authOf({}), 'normal', null)?.taskProvider).toBe('other')
  })
})

describe('createAuthorizedTurnSeed + buildChatMessageAcceptedFact', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()
  })

  test('seed captures one input with monotonic accept time and the fact is bounded', () => {
    const msg = { ...createDmMessage('u1'), text: 'hello world' }
    const source = buildAnalyticsSourceContext(msg, authOf({}), 'normal', null)
    assert.ok(source !== null)
    const seed = createAuthorizedTurnSeed(source, msg, 2, {
      nowMs: () => 1000,
      nowMonotonicMs: () => 500,
    })
    expect(seed.inputCount).toBe(1)
    expect(seed.inputLength).toBe(11)
    expect(seed.attachmentCount).toBe(2)
    expect(seed.acceptedAtMs).toBe(1000)
    expect(seed.acceptedAtMonotonicMs).toBe(500)
    expect(seed.sourceEventId.length).toBeGreaterThan(0)

    const fact = buildChatMessageAcceptedFact(seed, { isCommand: false, command: 'none' })
    expect(fact.type).toBe('chat_message_accepted')
    expect(fact.inputCount).toBe(1)
    expect(fact.inputLengthChars).toBe(11)
    expect(fact.attachmentCount).toBe(2)
    expect(fact.isCommand).toBe(false)
    expect(fact.command).toBe('none')
    expect(fact.occurredAtMs).toBe(1000)
  })
})
