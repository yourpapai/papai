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
      buttons: async (): Promise<void> => {},
    }
    const item: CoalescedItem = {
      text: 'Hello',
      userId: '123',
      username: 'alice',
      storageContextId: '456',
      contextType: 'dm',
      newAttachmentIds: [],
      reply: mockReply,
    }
    expect(item.text).toBe('Hello')
    expect(item.reply).toBe(mockReply)
  })
})
