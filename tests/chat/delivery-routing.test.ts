// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { resolveDeliveryPlatformInstanceId } from '../../src/chat/delivery-routing.js'
import { toScopedContextId, toScopedThreadContextId } from '../../src/chat/scoped-context.js'
import { dmTarget, type DeferredDeliveryTarget } from '../../src/chat/types.js'
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
    const scopedMainContextId = toScopedContextId({ platformInstanceId: 'telegram-secondary', nativeContextId: '-1001' })
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
