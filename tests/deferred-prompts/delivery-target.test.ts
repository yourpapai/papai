// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { toScopedContextId } from '../../src/chat/scoped-context.js'
import { rowToDeliveryTarget } from '../../src/deferred-prompts/delivery-target.js'

describe('rowToDeliveryTarget', () => {
  test('reconstructs scoped thread storage while preserving native delivery ids', () => {
    const scopedMainContextId = toScopedContextId({
      platformInstanceId: 'telegram-secondary',
      nativeContextId: '-1001',
    })
    const target = rowToDeliveryTarget({
      createdByUserId: toScopedContextId({ platformInstanceId: 'telegram-secondary', nativeContextId: 'user-1' }),
      createdByUsername: 'alice',
      deliveryContextId: scopedMainContextId,
      deliveryContextType: 'group',
      deliveryThreadId: '42',
      audience: 'personal',
      mentionUserIds: JSON.stringify([
        toScopedContextId({ platformInstanceId: 'telegram-secondary', nativeContextId: 'user-1' }),
      ]),
    })

    expect(target.contextId).toBe('-1001')
    expect(target.storageContextId).toBe(`${scopedMainContextId}:thread:NDI`)
    expect(target.threadId).toBe('42')
    expect(target.createdByUserId).toBe('user-1')
    expect(target.mentionUserIds).toEqual(['user-1'])
  })
})
