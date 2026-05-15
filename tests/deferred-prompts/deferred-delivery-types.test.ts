// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { DeferredAudience } from '../../src/chat/types.js'
import type { DeferredPromptDelivery } from '../../src/deferred-prompts/types.js'

describe('deferred delivery domain types', () => {
  test('supports personal delivery with mention targets', () => {
    const audience: DeferredAudience = 'personal'
    const delivery: DeferredPromptDelivery = {
      contextId: '-1001',
      contextType: 'group',
      threadId: '42',
      audience,
      mentionUserIds: ['u1'],
      createdByUserId: 'u1',
      createdByUsername: 'ki',
    }

    expect(delivery.audience).toBe('personal')
    expect(delivery.mentionUserIds).toEqual(['u1'])
  })

  test('supports shared delivery with no mention targets', () => {
    const delivery: DeferredPromptDelivery = {
      contextId: '-1001',
      contextType: 'group',
      threadId: null,
      audience: 'shared',
      mentionUserIds: [],
      createdByUserId: 'u1',
      createdByUsername: null,
    }

    expect(delivery.audience).toBe('shared')
    expect(delivery.threadId).toBeNull()
  })

  test('supports dm delivery', () => {
    const delivery: DeferredPromptDelivery = {
      contextId: 'user-1',
      contextType: 'dm',
      threadId: null,
      audience: 'personal',
      mentionUserIds: [],
      createdByUserId: 'user-1',
      createdByUsername: null,
    }

    expect(delivery.contextType).toBe('dm')
  })
})
