// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { DeferredDeliveryTarget } from '../../src/chat/types.js'

describe('proactive send contract', () => {
  test('telegram group personal target can carry mention metadata', () => {
    const target: DeferredDeliveryTarget = {
      contextId: '-1001',
      contextType: 'group',
      threadId: '42',
      audience: 'personal',
      mentionUserIds: ['12345'],
      createdByUserId: '12345',
      createdByUsername: 'ki',
    }

    expect(target.threadId).toBe('42')
    expect(target.mentionUserIds).toEqual(['12345'])
  })

  test('mattermost shared group target carries no mention ids', () => {
    const target: DeferredDeliveryTarget = {
      contextId: 'chan-1',
      contextType: 'group',
      threadId: 'root-1',
      audience: 'shared',
      mentionUserIds: [],
      createdByUserId: 'u1',
      createdByUsername: 'ki',
    }

    expect(target.audience).toBe('shared')
    expect(target.mentionUserIds).toEqual([])
  })

  test('discord personal group target keeps explicit mention ids', () => {
    const target: DeferredDeliveryTarget = {
      contextId: '123456789012345678',
      contextType: 'group',
      threadId: null,
      audience: 'personal',
      mentionUserIds: ['998877665544332211'],
      createdByUserId: '998877665544332211',
      createdByUsername: 'ki',
    }

    expect(target.mentionUserIds).toEqual(['998877665544332211'])
  })

  test('dm target has no thread and no mentions', () => {
    const target: DeferredDeliveryTarget = {
      contextId: 'user-123',
      contextType: 'dm',
      threadId: null,
      audience: 'personal',
      mentionUserIds: [],
      createdByUserId: 'user-123',
      createdByUsername: null,
    }

    expect(target.contextType).toBe('dm')
    expect(target.threadId).toBeNull()
    expect(target.mentionUserIds).toHaveLength(0)
  })
})
