// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { resolveDeliveryPlatformInstanceId } from '../../src/chat/delivery-routing.js'
import { toScopedContextId, toScopedThreadContextId } from '../../src/chat/scoped-context.js'
import { dmTarget, type ChatProvider, type DeferredDeliveryTarget } from '../../src/chat/types.js'
import { sendProactiveMessage } from '../../src/deferred-prompts/proactive-delivery.js'
import { setContextSettings } from '../../src/instances/context-store.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('resolveDeliveryPlatformInstanceId', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns context_settings platform instance for the delivery context', () => {
    setContextSettings({
      contextId: 'user-1',
      taskInstanceId: 'kaneo-default',
      platformInstanceId: 'telegram-default',
    })

    expect(resolveDeliveryPlatformInstanceId(dmTarget('user-1'))).toBe('telegram-default')
  })

  test('returns thread-scoped context_settings platform instance for threaded group delivery', () => {
    const target = {
      contextId: 'group-1',
      contextType: 'group',
      threadId: 'thread-1',
      audience: 'shared',
      mentionUserIds: [],
      createdByUserId: 'user-1',
      createdByUsername: null,
    } as const satisfies DeferredDeliveryTarget

    setContextSettings({
      contextId: 'group-1:thread-1',
      taskInstanceId: 'kaneo-default',
      platformInstanceId: 'mattermost-default',
    })

    expect(resolveDeliveryPlatformInstanceId(target)).toBe('mattermost-default')
  })

  test('routes scoped thread delivery through main scoped context settings', () => {
    const scopedMainContextId = toScopedContextId({
      platformInstanceId: 'telegram-secondary',
      nativeContextId: '-1001',
    })
    const scopedThreadContextId = toScopedThreadContextId({
      platformInstanceId: 'telegram-secondary',
      nativeContextId: '-1001',
      threadId: '42',
    })
    const target = {
      contextId: '-1001',
      storageContextId: scopedThreadContextId,
      contextType: 'group',
      threadId: '42',
      audience: 'personal',
      mentionUserIds: ['user-1'],
      createdByUserId: 'user-1',
      createdByUsername: null,
    } as const satisfies DeferredDeliveryTarget

    setContextSettings({
      contextId: scopedMainContextId,
      taskInstanceId: 'kaneo-secondary',
      platformInstanceId: 'telegram-secondary',
    })

    expect(resolveDeliveryPlatformInstanceId(target)).toBe('telegram-secondary')
  })

  test('returns null when the delivery context has no assignment', () => {
    expect(resolveDeliveryPlatformInstanceId(dmTarget('missing-user'))).toBeNull()
  })
})

describe('sendProactiveMessage', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns false without sending when the routed instance is inactive', async () => {
    setContextSettings({
      contextId: 'user-1',
      taskInstanceId: 'kaneo-default',
      platformInstanceId: 'telegram-default',
    })
    const sent: Array<{ platformInstanceId: string; target: DeferredDeliveryTarget; markdown: string }> = []
    const chat = {
      name: 'mock',
      threadCapabilities: { supportsThreads: false, canCreateThreads: false, threadScope: 'message' },
      capabilities: new Set(),
      traits: { observedGroupMessages: 'all' },
      configRequirements: [],
      registerCommand: () => {},
      onMessage: () => {},
      sendMessage: (platformInstanceId: string, target: DeferredDeliveryTarget, markdown: string): Promise<void> => {
        sent.push({ platformInstanceId, target, markdown })
        return Promise.resolve()
      },
      renderContext: () => ({ method: 'text', content: '' }),
      start: () => Promise.resolve(),
      stop: () => Promise.resolve(),
      isInstanceActive: (_platformInstanceId: string): boolean => false,
    } as const satisfies ChatProvider

    const delivered = await sendProactiveMessage(chat, dmTarget('user-1'), 'hello')

    expect(delivered).toBe(false)
    expect(sent).toEqual([])
  })

  test('returns false when send is refused after active precheck', async () => {
    setContextSettings({
      contextId: 'user-1',
      taskInstanceId: 'kaneo-default',
      platformInstanceId: 'telegram-default',
    })
    const chat = {
      name: 'mock',
      threadCapabilities: { supportsThreads: false, canCreateThreads: false, threadScope: 'message' },
      capabilities: new Set(),
      traits: { observedGroupMessages: 'all' },
      configRequirements: [],
      registerCommand: () => {},
      onMessage: () => {},
      sendMessage: (_platformInstanceId: string, _target: DeferredDeliveryTarget, _markdown: string): Promise<false> =>
        Promise.resolve(false),
      renderContext: () => ({ method: 'text', content: '' }),
      start: () => Promise.resolve(),
      stop: () => Promise.resolve(),
      isInstanceActive: (_platformInstanceId: string): boolean => true,
    } as const satisfies ChatProvider

    const delivered = await sendProactiveMessage(chat, dmTarget('user-1'), 'hello')

    expect(delivered).toBe(false)
  })
})
