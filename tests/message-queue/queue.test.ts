import { describe, expect, it, beforeEach, mock } from 'bun:test'
import assert from 'node:assert/strict'

import type { ReplyFn } from '../../src/chat/types.js'
import { MessageQueue } from '../../src/message-queue/queue.js'
import type { CoalescedItem, QueueItem } from '../../src/message-queue/types.js'
import { mockLogger } from '../utils/logger-mock.js'

interface CapturedEvent {
  type: string
  data: Record<string, unknown>
  turnId?: string
}

function mockEventBus(events: CapturedEvent[]): void {
  void mock.module('../../src/debug/event-bus.js', () => ({
    emitUser: (type: string, _userId: string, data: Record<string, unknown>, turnId?: string): void => {
      events.push({ type, data, turnId })
    },
    emitGroup: (
      type: string,
      _groupId: string,
      data: Record<string, unknown>,
      turnId?: string,
      _threadId?: string,
    ): void => {
      events.push({ type, data, turnId })
    },
    emitGlobal: (type: string, data: Record<string, unknown>): void => {
      events.push({ type, data })
    },
    emit: (type: string, data: Record<string, unknown>): void => {
      events.push({ type, data })
    },
    subscribe: (): void => {},
    unsubscribe: (): void => {},
  }))
}

/**
 * Creates a handler that records execution order and blocks item 'A' until
 * the returned unblock function is called. Used to test sequential execution.
 */
function makeBlockingHandlerA(order: string[]): {
  handler: (item: CoalescedItem) => Promise<void>
  unblock: () => void
} {
  let unblock: () => void = () => {}
  const blocker = new Promise<void>((resolve) => {
    unblock = resolve
  })
  const handler = async (item: CoalescedItem): Promise<void> => {
    order.push(`start:${item.text}`)
    if (item.text === 'A') {
      await blocker
    }
    order.push(`end:${item.text}`)
  }
  return { handler, unblock }
}

/**
 * Creates a handler that records execution order and throws for item 'A'.
 * Used to test that the queue stays functional after a handler error.
 */
function makeThrowingHandlerA(order: string[]): (item: CoalescedItem) => Promise<void> {
  return async (item: CoalescedItem): Promise<void> => {
    order.push(`start:${item.text}`)
    if (item.text === 'A') {
      throw new Error('handler error')
    }
    order.push(`end:${item.text}`)
    await Promise.resolve()
  }
}

function createReplyFn(typingSpy: ReturnType<typeof mock>): ReplyFn {
  return {
    text: (): Promise<void> => Promise.resolve(),
    formatted: (): Promise<void> => Promise.resolve(),
    file: (): Promise<void> => Promise.resolve(),
    typing: (): void => {
      typingSpy()
    },
    buttons: (): Promise<void> => Promise.resolve(),
  }
}

describe('MessageQueue', () => {
  let queue: MessageQueue
  let typingSpy: ReturnType<typeof mock>
  let mockReply: ReplyFn

  beforeEach(() => {
    mockLogger()
    queue = new MessageQueue('user123')
    typingSpy = mock(() => {})
    mockReply = createReplyFn(typingSpy)
  })

  describe('enqueue', () => {
    it('should buffer a single item', () => {
      const item: QueueItem = {
        text: 'Hello',
        userId: 'user123',
        username: 'alice',
        storageContextId: 'user123',
        contextType: 'dm',
        newAttachmentIds: [],
      }
      queue.enqueue(item, mockReply)
      expect(queue.getBufferedCount()).toBe(1)
    })

    it('should not show typing indicator on enqueue', () => {
      const item: QueueItem = {
        text: 'Hello',
        userId: 'user123',
        username: 'alice',
        storageContextId: 'user123',
        contextType: 'dm',
        newAttachmentIds: [],
      }
      queue.enqueue(item, mockReply)
      expect(typingSpy).toHaveBeenCalledTimes(0)
    })

    it('should buffer multiple items', () => {
      queue.enqueue(
        {
          text: 'First',
          userId: 'user123',
          username: 'alice',
          storageContextId: 'user123',
          contextType: 'dm',
          newAttachmentIds: [],
        },
        mockReply,
      )
      queue.enqueue(
        {
          text: 'Second',
          userId: 'user123',
          username: 'alice',
          storageContextId: 'user123',
          contextType: 'dm',
          newAttachmentIds: [],
        },
        mockReply,
      )
      expect(queue.getBufferedCount()).toBe(2)
    })
  })

  describe('coalescing', () => {
    it('should use last message reply function for coalesced result', () => {
      const reply1 = createReplyFn(typingSpy)
      const reply2 = createReplyFn(typingSpy)

      queue.enqueue(
        {
          text: 'First message',
          userId: 'user123',
          username: 'alice',
          storageContextId: 'user123',
          contextType: 'dm',
          newAttachmentIds: [],
        },
        reply1,
      )
      queue.enqueue(
        {
          text: 'Second message',
          userId: 'user123',
          username: 'alice',
          storageContextId: 'user123',
          contextType: 'dm',
          newAttachmentIds: [],
        },
        reply2,
      )

      const flushed = queue.forceFlush()
      expect(flushed).not.toBeNull()
      assert(flushed !== null)
      // Reply should be from the last message, not the first
      expect(flushed.reply).toBe(reply2)
    })

    it('should coalesce DM messages with double newline separator', () => {
      queue.enqueue(
        {
          text: 'First message',
          userId: 'user123',
          username: 'alice',
          storageContextId: 'user123',
          contextType: 'dm',
          newAttachmentIds: [],
        },
        mockReply,
      )
      queue.enqueue(
        {
          text: 'Second message',
          userId: 'user123',
          username: 'alice',
          storageContextId: 'user123',
          contextType: 'dm',
          newAttachmentIds: [],
        },
        mockReply,
      )

      const flushed = queue.forceFlush()
      expect(flushed).not.toBeNull()
      assert(flushed !== null)
      expect(flushed.text).toBe('First message\n\nSecond message')
      expect(flushed.userId).toBe('user123')
      expect(flushed.username).toBe('alice')
      expect(flushed.storageContextId).toBe('user123')
    })

    it('should coalesce group main messages with single newline separator', () => {
      const groupQueue = new MessageQueue('group123')
      queue = groupQueue
      const reply1 = createReplyFn(typingSpy)
      const reply2 = createReplyFn(typingSpy)

      queue.enqueue(
        {
          text: 'First',
          userId: 'user123',
          username: 'alice',
          storageContextId: 'group123',
          contextType: 'group',
          newAttachmentIds: [],
        },
        reply1,
      )
      queue.enqueue(
        {
          text: 'Second',
          userId: 'user123',
          username: 'alice',
          storageContextId: 'group123',
          contextType: 'group',
          newAttachmentIds: [],
        },
        reply2,
      )

      const flushed = queue.forceFlush()
      expect(flushed).not.toBeNull()
      assert(flushed !== null)
      expect(flushed.text).toBe('First\nSecond')
    })

    it('should add username attribution in thread context', () => {
      const threadQueue = new MessageQueue('group123:thread456')
      queue = threadQueue

      queue.enqueue(
        {
          text: 'Hello from thread',
          userId: 'user123',
          username: 'alice',
          storageContextId: 'group123:thread456',
          contextType: 'group',
          newAttachmentIds: [],
        },
        mockReply,
      )

      const flushed = queue.forceFlush()
      expect(flushed).not.toBeNull()
      assert(flushed !== null)
      expect(flushed.text).toBe('[@alice]: Hello from thread')
    })

    it('should accumulate newAttachmentIds from all messages', () => {
      queue.enqueue(
        {
          text: 'First',
          userId: 'user123',
          username: 'alice',
          storageContextId: 'user123',
          contextType: 'dm',
          newAttachmentIds: ['att_1'],
        },
        mockReply,
      )
      queue.enqueue(
        {
          text: 'Second',
          userId: 'user123',
          username: 'alice',
          storageContextId: 'user123',
          contextType: 'dm',
          newAttachmentIds: ['att_2', 'att_3'],
        },
        mockReply,
      )

      const flushed = queue.forceFlush()
      expect(flushed).not.toBeNull()
      assert(flushed !== null)
      expect(flushed.newAttachmentIds).toEqual(['att_1', 'att_2', 'att_3'])
    })
  })

  describe('forceFlush', () => {
    it('should return null when queue is empty', () => {
      const flushed = queue.forceFlush()
      expect(flushed).toBeNull()
    })

    it('should clear buffered items after flush', () => {
      queue.enqueue(
        {
          text: 'Hello',
          userId: 'user123',
          username: 'alice',
          storageContextId: 'user123',
          contextType: 'dm',
          newAttachmentIds: [],
        },
        mockReply,
      )

      queue.forceFlush()
      expect(queue.getBufferedCount()).toBe(0)
    })

    it('should clear the timer on force flush', () => {
      queue.enqueue(
        {
          text: 'Hello',
          userId: 'user123',
          username: 'alice',
          storageContextId: 'user123',
          contextType: 'dm',
          newAttachmentIds: [],
        },
        mockReply,
      )

      queue.forceFlush()
    })
  })

  describe('empty state', () => {
    it('should return 0 for empty queue', () => {
      expect(queue.getBufferedCount()).toBe(0)
    })
  })

  describe('handler invocation', () => {
    it('should call handler on timer flush', async () => {
      const handlerCalls: string[] = []
      const handler = async (coalesced: CoalescedItem): Promise<void> => {
        handlerCalls.push(coalesced.text)
        await Promise.resolve()
      }

      queue.setHandler(handler)
      queue.enqueue(
        {
          text: 'Hello',
          userId: 'user123',
          username: 'alice',
          storageContextId: 'user123',
          contextType: 'dm',
          newAttachmentIds: [],
        },
        mockReply,
      )

      // Wait for debounce timer (500ms)
      await new Promise((r) => {
        setTimeout(r, 550)
      })

      expect(handlerCalls.length).toBe(1)
      expect(handlerCalls[0]).toBe('Hello')
    })

    it('should handle errors from handler gracefully', async () => {
      let handlerCallCount = 0
      const handler = async (_coalesced: CoalescedItem): Promise<void> => {
        handlerCallCount++
        await Promise.resolve()
        throw new Error('Handler failed')
      }

      queue.setHandler(handler)
      queue.enqueue(
        {
          text: 'Hello',
          userId: 'user123',
          username: 'alice',
          storageContextId: 'user123',
          contextType: 'dm',
          newAttachmentIds: [],
        },
        mockReply,
      )

      // Wait for debounce timer - should not throw
      await new Promise((r) => {
        setTimeout(r, 550)
      })

      expect(handlerCallCount).toBe(1)
    })

    it('should not call handler when queue is empty', async () => {
      const handlerCalls: string[] = []
      const handler = async (coalesced: CoalescedItem): Promise<void> => {
        handlerCalls.push(coalesced.text)
        await Promise.resolve()
      }

      queue.setHandler(handler)
      // Don't enqueue anything, just wait

      await new Promise((r) => {
        setTimeout(r, 550)
      })

      expect(handlerCalls.length).toBe(0)
    })
  })

  describe('sequential execution', () => {
    it('should not start next handler until current one completes', async () => {
      const order: string[] = []
      const { handler, unblock: unblockA } = makeBlockingHandlerA(order)

      queue.setHandler(handler)

      queue.enqueue(
        {
          text: 'A',
          userId: 'user123',
          username: 'alice',
          storageContextId: 'user123',
          contextType: 'dm',
          newAttachmentIds: [],
        },
        mockReply,
      )

      // Wait for debounce timer to fire and handler A to start
      await new Promise<void>((r) => {
        setTimeout(r, 550)
      })
      expect(order).toEqual(['start:A'])

      // Enqueue B while A is still running (unblockA not called yet)
      queue.enqueue(
        {
          text: 'B',
          userId: 'user123',
          username: 'alice',
          storageContextId: 'user123',
          contextType: 'dm',
          newAttachmentIds: [],
        },
        mockReply,
      )

      // Wait for B's debounce timer to fire
      await new Promise<void>((r) => {
        setTimeout(r, 550)
      })

      // B must NOT have started — handler A is still blocking the chain
      expect(order).toEqual(['start:A'])

      // Unblock A
      unblockA()

      // Give microtasks time to settle
      await new Promise<void>((r) => {
        setTimeout(r, 50)
      })

      // A and B ran in strict serial order, never concurrently
      expect(order).toEqual(['start:A', 'end:A', 'start:B', 'end:B'])
    }, 10000)

    it('should remain functional after a handler throws', async () => {
      const order: string[] = []
      const handler = makeThrowingHandlerA(order)

      queue.setHandler(handler)

      queue.enqueue(
        {
          text: 'A',
          userId: 'user123',
          username: 'alice',
          storageContextId: 'user123',
          contextType: 'dm',
          newAttachmentIds: [],
        },
        mockReply,
      )

      await new Promise<void>((r) => {
        setTimeout(r, 550)
      })

      queue.enqueue(
        {
          text: 'B',
          userId: 'user123',
          username: 'alice',
          storageContextId: 'user123',
          contextType: 'dm',
          newAttachmentIds: [],
        },
        mockReply,
      )

      await new Promise<void>((r) => {
        setTimeout(r, 550)
      })

      // B should have run even though A threw
      expect(order).toContain('start:B')
      expect(order).toContain('end:B')
    }, 10000)
  })

  describe('different user in main group chat', () => {
    it('should flush immediately when different user sends message in group main', () => {
      const groupQueue = new MessageQueue('group123')
      queue = groupQueue

      queue.enqueue(
        {
          text: 'Hello from alice',
          userId: 'user1',
          username: 'alice',
          storageContextId: 'group123',
          contextType: 'group',
          newAttachmentIds: [],
        },
        mockReply,
      )

      expect(queue.getBufferedCount()).toBe(1)

      const flushed = queue.enqueue(
        {
          text: 'Hello from bob',
          userId: 'user2',
          username: 'bob',
          storageContextId: 'group123',
          contextType: 'group',
          newAttachmentIds: [],
        },
        mockReply,
      )

      expect(flushed).not.toBeNull()
      assert(flushed !== null)
      expect(flushed.text).toBe('Hello from alice')
      expect(queue.getBufferedCount()).toBe(1)
    })

    it('should not flush when same user sends multiple messages', () => {
      const groupQueue = new MessageQueue('group123')
      queue = groupQueue

      const flushed1 = queue.enqueue(
        {
          text: 'First from alice',
          userId: 'user1',
          username: 'alice',
          storageContextId: 'group123',
          contextType: 'group',
          newAttachmentIds: [],
        },
        mockReply,
      )

      const flushed2 = queue.enqueue(
        {
          text: 'Second from alice',
          userId: 'user1',
          username: 'alice',
          storageContextId: 'group123',
          contextType: 'group',
          newAttachmentIds: [],
        },
        mockReply,
      )

      expect(flushed1).toBeNull()
      expect(flushed2).toBeNull()
      expect(queue.getBufferedCount()).toBe(2)
    })

    it('should flush in thread when different user sends message', () => {
      const threadQueue = new MessageQueue('group123:thread456')
      queue = threadQueue

      queue.enqueue(
        {
          text: 'First',
          userId: 'user1',
          username: 'alice',
          storageContextId: 'group123:thread456',
          contextType: 'group',
          newAttachmentIds: [],
        },
        mockReply,
      )

      const flushed = queue.enqueue(
        {
          text: 'Second',
          userId: 'user2',
          username: 'bob',
          storageContextId: 'group123:thread456',
          contextType: 'group',
          newAttachmentIds: [],
        },
        mockReply,
      )

      // Different user in thread triggers flush (same as main group chat)
      expect(flushed).not.toBeNull()
      assert(flushed !== null)
      expect(flushed.text).toBe('[@alice]: First')
      expect(flushed.userId).toBe('user1')
      expect(flushed.username).toBe('alice')
      expect(queue.getBufferedCount()).toBe(1)
    })

    it('should use last message userId and username for coalesced item in thread', () => {
      const threadQueue = new MessageQueue('group123:thread456')
      queue = threadQueue

      queue.enqueue(
        {
          text: 'First',
          userId: 'user1',
          username: 'alice',
          storageContextId: 'group123:thread456',
          contextType: 'group',
          newAttachmentIds: [],
        },
        mockReply,
      )

      queue.enqueue(
        {
          text: 'Second',
          userId: 'user2',
          username: 'bob',
          storageContextId: 'group123:thread456',
          contextType: 'group',
          newAttachmentIds: [],
        },
        mockReply,
      )

      const flushed = queue.forceFlush()
      expect(flushed).not.toBeNull()
      assert(flushed !== null)
      // userId and username should be from the LAST message (user2/bob)
      // not from the first message (user1/alice)
      expect(flushed.userId).toBe('user2')
      expect(flushed.username).toBe('bob')
    })
  })

  describe('turnId', () => {
    it('should mint a unique turnId on the coalesced item', () => {
      queue.enqueue(
        {
          text: 'Hello',
          userId: 'user123',
          username: 'alice',
          storageContextId: 'user123',
          contextType: 'dm',
          newAttachmentIds: [],
        },
        mockReply,
      )

      const flushed = queue.forceFlush()
      expect(flushed).not.toBeNull()
      assert(flushed !== null)
      expect(flushed.turnId).toBeString()
      expect(flushed.turnId.length).toBeGreaterThan(0)
    })

    it('should mint different turnIds for separate flushes', () => {
      queue.enqueue(
        {
          text: 'First',
          userId: 'user123',
          username: 'alice',
          storageContextId: 'user123',
          contextType: 'dm',
          newAttachmentIds: [],
        },
        mockReply,
      )
      const first = queue.forceFlush()
      assert(first !== null)

      queue.enqueue(
        {
          text: 'Second',
          userId: 'user123',
          username: 'alice',
          storageContextId: 'user123',
          contextType: 'dm',
          newAttachmentIds: [],
        },
        mockReply,
      )
      const second = queue.forceFlush()
      assert(second !== null)

      expect(first.turnId).not.toBe(second.turnId)
    })
  })

  describe('debug events', () => {
    let events: CapturedEvent[]

    beforeEach(() => {
      events = []
      mockEventBus(events)
    })

    it('should emit queue:enqueue when message is buffered', () => {
      queue.enqueue(
        {
          text: 'Hello',
          userId: 'user123',
          username: 'alice',
          storageContextId: 'user123',
          contextType: 'dm',
          newAttachmentIds: [],
        },
        mockReply,
      )

      const enqueueEvent = events.find((e) => e.type === 'queue:enqueue')
      expect(enqueueEvent).toBeDefined()
      assert(enqueueEvent !== undefined)
      expect(enqueueEvent.data['storageContextId']).toBe('user123')
      expect(enqueueEvent.data['userId']).toBe('user123')
      expect(enqueueEvent.data['bufferedCount']).toBe(1)
    })

    it('should emit queue:coalesce on flush', () => {
      queue.enqueue(
        {
          text: 'Hello',
          userId: 'user123',
          username: 'alice',
          storageContextId: 'user123',
          contextType: 'dm',
          newAttachmentIds: ['att_1'],
        },
        mockReply,
      )
      queue.forceFlush()

      const coalesceEvent = events.find((e) => e.type === 'queue:coalesce')
      expect(coalesceEvent).toBeDefined()
      assert(coalesceEvent !== undefined)
      expect(coalesceEvent.data['storageContextId']).toBe('user123')
      expect(coalesceEvent.data['itemCount']).toBe(1)
      expect(coalesceEvent.data['attachmentCount']).toBe(1)
    })

    it('should emit turn:start with scope and turnId on flush', () => {
      queue.enqueue(
        {
          text: 'Hello',
          userId: 'user123',
          username: 'alice',
          storageContextId: 'user123',
          contextType: 'dm',
          newAttachmentIds: [],
        },
        mockReply,
      )
      queue.forceFlush()

      const turnStartEvent = events.find((e) => e.type === 'turn:start')
      expect(turnStartEvent).toBeDefined()
      assert(turnStartEvent !== undefined)
      expect(turnStartEvent.turnId).toBeString()
      expect(turnStartEvent.turnId!.length).toBeGreaterThan(0)
      expect(turnStartEvent.data['contextType']).toBe('dm')
      expect(turnStartEvent.data['incomingMessageCount']).toBe(1)
    })

    it('should emit turn:end with status ok on successful handler', async () => {
      const handler = async (_coalesced: CoalescedItem): Promise<void> => {
        await Promise.resolve()
      }

      queue.setHandler(handler)
      queue.enqueue(
        {
          text: 'Hello',
          userId: 'user123',
          username: 'alice',
          storageContextId: 'user123',
          contextType: 'dm',
          newAttachmentIds: [],
        },
        mockReply,
      )

      await new Promise<void>((r) => {
        setTimeout(r, 550)
      })

      const turnEndEvent = events.find((e) => e.type === 'turn:end')
      expect(turnEndEvent).toBeDefined()
      assert(turnEndEvent !== undefined)
      expect(turnEndEvent.turnId).toBeString()
      expect(turnEndEvent.data['status']).toBe('ok')
      expect(turnEndEvent.data['duration']).toBeNumber()
    })

    it('should emit turn:end with status error on handler failure', async () => {
      const handler = (_coalesced: CoalescedItem): Promise<void> => {
        throw new Error('handler boom')
      }

      queue.setHandler(handler)
      queue.enqueue(
        {
          text: 'Hello',
          userId: 'user123',
          username: 'alice',
          storageContextId: 'user123',
          contextType: 'dm',
          newAttachmentIds: [],
        },
        mockReply,
      )

      await new Promise<void>((r) => {
        setTimeout(r, 550)
      })

      const turnEndEvent = events.find((e) => e.type === 'turn:end')
      expect(turnEndEvent).toBeDefined()
      assert(turnEndEvent !== undefined)
      expect(turnEndEvent.turnId).toBeString()
      expect(turnEndEvent.data['status']).toBe('error')
      expect(turnEndEvent.data['error']).toBe('handler boom')
    })
  })
})
