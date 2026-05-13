import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { ReplyFn } from '../../src/chat/types.js'
import type { CoalescedItem } from '../../src/message-queue/types.js'
import { mockLogger } from '../utils/test-helpers.js'

type MessageQueueModule = Pick<typeof import('../../src/message-queue/index.js'), 'enqueueMessage' | 'flushOnShutdown'>

const delay = (ms: number): Promise<void> =>
  new Promise((r) => {
    setTimeout(r, ms)
  })

async function waitFor(
  condition: () => boolean,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 1500
  const intervalMs = options.intervalMs ?? 25
  const deadline = Date.now() + timeoutMs

  while (!condition()) {
    if (Date.now() >= deadline) {
      throw new Error(`Condition not met within ${timeoutMs}ms`)
    }
    await delay(intervalMs)
  }
}

function isMessageQueueModule(value: unknown): value is MessageQueueModule {
  return (
    typeof value === 'object' &&
    value !== null &&
    'enqueueMessage' in value &&
    typeof value.enqueueMessage === 'function' &&
    'flushOnShutdown' in value &&
    typeof value.flushOnShutdown === 'function'
  )
}

async function loadMessageQueueModule(): Promise<MessageQueueModule> {
  const module: unknown = await import(`../../src/message-queue/index.js?test=${crypto.randomUUID()}`)

  if (!isMessageQueueModule(module)) {
    throw new TypeError('Failed to load message queue module')
  }

  return module
}

describe('MessageQueue Integration', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('should process messages sequentially per context', async () => {
    const { enqueueMessage } = await loadMessageQueueModule()
    const storageContextId = `ctx1-${crypto.randomUUID()}`
    const processed: string[] = []
    const mockReply: ReplyFn = {
      text: async (): Promise<void> => {},
      formatted: async (): Promise<void> => {},
      file: async (): Promise<void> => {},
      typing: (): void => {},
      buttons: async (): Promise<void> => {},
    }

    const handler = async (coalesced: CoalescedItem): Promise<void> => {
      processed.push(coalesced.text)
      await delay(10)
    }

    enqueueMessage(
      {
        text: 'Message 1',
        userId: 'user1',
        username: 'alice',
        storageContextId,
        contextType: 'dm',
        newAttachmentIds: [],
      },
      mockReply,
      handler,
    )

    enqueueMessage(
      {
        text: 'Message 2',
        userId: 'user1',
        username: 'alice',
        storageContextId,
        contextType: 'dm',
        newAttachmentIds: [],
      },
      mockReply,
      handler,
    )

    await waitFor(() => processed.length === 1)

    expect(processed.length).toBe(1)
    expect(processed[0]).toBe('Message 1\n\nMessage 2')
  })

  test('should accumulate newAttachmentIds from multiple messages', async () => {
    const { enqueueMessage } = await loadMessageQueueModule()
    const storageContextId = `ctx1-${crypto.randomUUID()}`
    const collectedIds: string[] = []
    const mockReply: ReplyFn = {
      text: async (): Promise<void> => {},
      formatted: async (): Promise<void> => {},
      file: async (): Promise<void> => {},
      typing: (): void => {},
      buttons: async (): Promise<void> => {},
    }

    const handler = async (coalesced: CoalescedItem): Promise<void> => {
      collectedIds.push(...coalesced.newAttachmentIds)
      await Promise.resolve()
    }

    enqueueMessage(
      {
        text: 'First',
        userId: 'user1',
        username: 'alice',
        storageContextId,
        contextType: 'dm',
        newAttachmentIds: ['att_a'],
      },
      mockReply,
      handler,
    )

    enqueueMessage(
      {
        text: 'Second',
        userId: 'user1',
        username: 'alice',
        storageContextId,
        contextType: 'dm',
        newAttachmentIds: ['att_b'],
      },
      mockReply,
      handler,
    )

    await waitFor(() => collectedIds.length === 2)

    expect(collectedIds).toEqual(['att_a', 'att_b'])
  })

  test('should flush on shutdown', async () => {
    const { enqueueMessage, flushOnShutdown } = await loadMessageQueueModule()
    const storageContextId = `ctx1-${crypto.randomUUID()}`
    const processed: string[] = []
    const mockReply: ReplyFn = {
      text: async (): Promise<void> => {},
      formatted: async (): Promise<void> => {},
      file: async (): Promise<void> => {},
      typing: (): void => {},
      buttons: async (): Promise<void> => {},
    }

    const handler = async (coalesced: CoalescedItem): Promise<void> => {
      processed.push(coalesced.text)
      await Promise.resolve()
    }

    enqueueMessage(
      {
        text: 'Pending',
        userId: 'user1',
        username: 'alice',
        storageContextId,
        contextType: 'dm',
        newAttachmentIds: [],
      },
      mockReply,
      handler,
    )

    await flushOnShutdown({ timeoutMs: 1000 })

    expect(processed.length).toBe(1)
    expect(processed[0]).toBe('Pending')
  })

  test('should process different contexts concurrently without blocking', async () => {
    const { enqueueMessage } = await loadMessageQueueModule()
    const firstContextId = `ctx1-${crypto.randomUUID()}`
    const secondContextId = `ctx2-${crypto.randomUUID()}`
    const processed: string[] = []
    const typingSpy = mock(() => {})

    const mockReply1: ReplyFn = {
      text: async (): Promise<void> => {},
      formatted: async (): Promise<void> => {},
      file: async (): Promise<void> => {},
      typing: typingSpy,
      buttons: async (): Promise<void> => {},
    }

    const mockReply2: ReplyFn = {
      text: async (): Promise<void> => {},
      formatted: async (): Promise<void> => {},
      file: async (): Promise<void> => {},
      typing: typingSpy,
      buttons: async (): Promise<void> => {},
    }

    const handler1 = async (coalesced: CoalescedItem): Promise<void> => {
      processed.push(`ctx1: ${coalesced.text}`)
      await Promise.resolve()
    }

    const handler2 = async (coalesced: CoalescedItem): Promise<void> => {
      processed.push(`ctx2: ${coalesced.text}`)
      await Promise.resolve()
    }

    enqueueMessage(
      {
        text: 'Message for ctx1',
        userId: 'user1',
        username: 'alice',
        storageContextId: firstContextId,
        contextType: 'dm',
        newAttachmentIds: [],
      },
      mockReply1,
      handler1,
    )

    enqueueMessage(
      {
        text: 'Message for ctx2',
        userId: 'user2',
        username: 'bob',
        storageContextId: secondContextId,
        contextType: 'dm',
        newAttachmentIds: [],
      },
      mockReply2,
      handler2,
    )

    await waitFor(() => processed.length === 2)

    expect(processed.length).toBe(2)
    expect(processed).toContain('ctx1: Message for ctx1')
    expect(processed).toContain('ctx2: Message for ctx2')
  })

  test('should keep contexts isolated - messages do not interleave', async () => {
    const { enqueueMessage, flushOnShutdown } = await loadMessageQueueModule()
    const firstContextId = `ctx1-${crypto.randomUUID()}`
    const secondContextId = `ctx2-${crypto.randomUUID()}`
    const ctx1Results: string[] = []
    const ctx2Results: string[] = []
    const typingSpy = mock(() => {})

    const createMockReply = (): ReplyFn => ({
      text: async (): Promise<void> => {},
      formatted: async (): Promise<void> => {},
      file: async (): Promise<void> => {},
      typing: typingSpy,
      buttons: async (): Promise<void> => {},
    })

    const handler1 = async (coalesced: CoalescedItem): Promise<void> => {
      ctx1Results.push(coalesced.text)
      await Promise.resolve()
    }

    const handler2 = async (coalesced: CoalescedItem): Promise<void> => {
      ctx2Results.push(coalesced.text)
      await Promise.resolve()
    }

    enqueueMessage(
      {
        text: 'A1',
        userId: 'u1',
        username: 'a',
        storageContextId: firstContextId,
        contextType: 'dm',
        newAttachmentIds: [],
      },
      createMockReply(),
      handler1,
    )

    enqueueMessage(
      {
        text: 'B1',
        userId: 'u2',
        username: 'b',
        storageContextId: secondContextId,
        contextType: 'dm',
        newAttachmentIds: [],
      },
      createMockReply(),
      handler2,
    )

    enqueueMessage(
      {
        text: 'A2',
        userId: 'u1',
        username: 'a',
        storageContextId: firstContextId,
        contextType: 'dm',
        newAttachmentIds: [],
      },
      createMockReply(),
      handler1,
    )

    enqueueMessage(
      {
        text: 'B2',
        userId: 'u2',
        username: 'b',
        storageContextId: secondContextId,
        contextType: 'dm',
        newAttachmentIds: [],
      },
      createMockReply(),
      handler2,
    )

    await flushOnShutdown({ timeoutMs: 1000 })

    expect(ctx1Results.length).toBe(1)
    expect(ctx1Results[0]).toBe('A1\n\nA2')
    expect(ctx2Results.length).toBe(1)
    expect(ctx2Results[0]).toBe('B1\n\nB2')
  })

  test('should flush multiple contexts on shutdown', async () => {
    const { enqueueMessage, flushOnShutdown } = await loadMessageQueueModule()
    const contextAId = `ctxA-${crypto.randomUUID()}`
    const contextBId = `ctxB-${crypto.randomUUID()}`
    const contextCId = `ctxC-${crypto.randomUUID()}`
    const processed: string[] = []
    const typingSpy = mock(() => {})

    const createMockReply = (): ReplyFn => ({
      text: async (): Promise<void> => {},
      formatted: async (): Promise<void> => {},
      file: async (): Promise<void> => {},
      typing: typingSpy,
      buttons: async (): Promise<void> => {},
    })

    const handler = async (coalesced: CoalescedItem): Promise<void> => {
      processed.push(`${coalesced.storageContextId}: ${coalesced.text}`)
      await Promise.resolve()
    }

    enqueueMessage(
      {
        text: 'Msg1',
        userId: 'u1',
        username: 'a',
        storageContextId: contextAId,
        contextType: 'dm',
        newAttachmentIds: [],
      },
      createMockReply(),
      handler,
    )

    enqueueMessage(
      {
        text: 'Msg2',
        userId: 'u2',
        username: 'b',
        storageContextId: contextBId,
        contextType: 'dm',
        newAttachmentIds: [],
      },
      createMockReply(),
      handler,
    )

    enqueueMessage(
      {
        text: 'Msg3',
        userId: 'u3',
        username: 'c',
        storageContextId: contextCId,
        contextType: 'dm',
        newAttachmentIds: [],
      },
      createMockReply(),
      handler,
    )

    await flushOnShutdown({ timeoutMs: 1000 })

    expect(processed.length).toBe(3)
    expect(processed).toContain(`${contextAId}: Msg1`)
    expect(processed).toContain(`${contextBId}: Msg2`)
    expect(processed).toContain(`${contextCId}: Msg3`)
  })
})
