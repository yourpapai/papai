// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { QueueItem, CoalescedItem } from '../../src/message-queue/types.js'

describe('QueueItem interface', () => {
  test('accepts valid queue item', () => {
    const item: QueueItem = {
      text: 'Hello',
      userId: '123',
      username: 'alice',
      storageContextId: '456',
      contextType: 'dm',
      newAttachmentIds: [],
      voiceStagedIds: [],
    }
    expect(item.text).toBe('Hello')
    expect(item.storageContextId).toBe('456')
    expect(item.contextType).toBe('dm')
  })
})

describe('CoalescedItem interface', () => {
  test('accepts valid coalesced item', () => {
    const mockReply = {
      text: async (): Promise<void> => {},
      formatted: async (): Promise<void> => {},
      file: async (): Promise<void> => {},
      typing: (): void => {},
      buttons: (): Promise<undefined> => Promise.resolve(undefined),
    }
    const item: CoalescedItem = {
      text: 'Hello',
      userId: '123',
      username: 'alice',
      storageContextId: '456',
      contextType: 'dm',
      newAttachmentIds: [],
      voiceStagedIds: [],
      reply: mockReply,
      turnId: 'test-turn-id',
    }
    expect(item.text).toBe('Hello')
    expect(item.reply).toBe(mockReply)
  })
})
