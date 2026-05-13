import { beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import type { ReplyFn } from '../../src/chat/types.js'
import type { QueueItem } from '../../src/message-queue/types.js'
import { mockLogger } from '../utils/test-helpers.js'

type MessageQueueModule = Pick<typeof import('../../src/message-queue/index.js'), 'enqueueMessage' | 'flushOnShutdown'>

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

describe('enqueueMessage', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('should enqueue without error', async () => {
    const { enqueueMessage } = await loadMessageQueueModule()
    const item: QueueItem = {
      text: 'Hello',
      userId: '123',
      username: 'alice',
      storageContextId: `ctx1-${crypto.randomUUID()}`,
      contextType: 'dm',
      newAttachmentIds: [],
    }
    const mockReply: ReplyFn = {
      text: async () => {},
      formatted: async () => {},
      file: async () => {},
      typing: () => {},
      buttons: async () => {},
    }

    enqueueMessage(item, mockReply, async () => {})
  })
})

describe('flushOnShutdown', () => {
  test('should flush without error', async () => {
    const { flushOnShutdown } = await loadMessageQueueModule()

    await flushOnShutdown({ timeoutMs: 1000 })
  })

  test('should respect timeout even when handlers hang', async () => {
    const module: unknown = await import(`../../src/message-queue/index.js?hang-test=${crypto.randomUUID()}`)
    assert(isMessageQueueModule(module), 'Invalid module')
    const { enqueueMessage, flushOnShutdown } = module

    const mockReply: ReplyFn = {
      text: async () => {},
      formatted: async () => {},
      file: async () => {},
      typing: () => {},
      buttons: async () => {},
    }

    // Handler that never resolves
    const hangingHandler = async (): Promise<void> => {
      // Never resolves - intentionally hanging to test timeout
      await new Promise(() => {})
    }

    const item: QueueItem = {
      text: 'Test message',
      userId: '123',
      username: 'alice',
      storageContextId: `hang-test-ctx-${crypto.randomUUID()}`,
      contextType: 'dm',
      newAttachmentIds: [],
    }

    enqueueMessage(item, mockReply, hangingHandler)

    // Flush should complete within timeout despite hanging handler
    const startTime = Date.now()
    const timeoutMs = 200
    await flushOnShutdown({ timeoutMs })
    const elapsed = Date.now() - startTime

    // Should complete close to timeout, not hang indefinitely
    expect(elapsed).toBeLessThan(timeoutMs + 100)
    expect(elapsed).toBeGreaterThanOrEqual(timeoutMs - 50)
  })
})
