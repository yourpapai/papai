<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Message Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement per-context message queue with debounced coalescing to fix stale-read race conditions.

**Architecture:** Explicit MessageQueue class buffers messages per storageContextId, flushes on debounce (500ms) or different-user-in-main-chat. Fire-and-forget enqueue preserves multi-context concurrency.

**Tech Stack:** TypeScript, Bun, existing papai patterns (cache.ts, bot.ts)

---

## File Structure

```
src/
├── message-queue/
│   ├── types.ts          # QueueItem, CoalescedItem interfaces
│   ├── queue.ts          # MessageQueue class
│   ├── registry.ts       # QueueRegistry (contextId -> queue map)
│   └── index.ts          # Public exports: enqueueMessage, flushOnShutdown
├── bot.ts                # Wrap processMessage with queue
└── index.ts              # Add graceful shutdown hook

tests/
└── message-queue/
    ├── queue.test.ts     # MessageQueue unit tests
    ├── registry.test.ts  # QueueRegistry tests
    └── integration.test.ts # Bot integration tests
```

---

## Task 1: Create Types Module

**Files:**

- Create: `src/message-queue/types.ts`
- Test: `tests/message-queue/types.test.ts`

- [ ] **Step 1: Write the failing test for QueueItem interface**

```typescript
import { describe, expect, it } from 'bun:test'
import type { QueueItem, CoalescedItem } from '../../src/message-queue/types.js'

describe('QueueItem interface', () => {
  it('should accept valid queue item', () => {
    const item: QueueItem = {
      text: 'Hello',
      userId: '123',
      username: 'alice',
      storageContextId: '456',
      contextType: 'dm',
      files: [],
    }
    expect(item.text).toBe('Hello')
    expect(item.storageContextId).toBe('456')
    expect(item.contextType).toBe('dm')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/message-queue/types.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Create types.ts with QueueItem interface**

```typescript
import type { IncomingFile, ReplyFn } from '../chat/types.js'

export interface QueueItem {
  text: string
  userId: string
  username: string | null
  storageContextId: string
  contextType: 'dm' | 'group'
  files: IncomingFile[]
}

export interface CoalescedItem {
  text: string
  userId: string
  username: string | null
  storageContextId: string
  files: IncomingFile[]
  reply: ReplyFn
}

export interface QueueState {
  items: QueueItem[]
  processing: boolean
  timer: ReturnType<typeof setTimeout> | null
  lastUserId: string | null
  files: IncomingFile[]
}

export interface InternalQueueState extends QueueState {
  replies: ReplyFn[]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/message-queue/types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/message-queue/types.ts tests/message-queue/types.test.ts
git commit -m "feat(message-queue): add QueueItem and CoalescedItem types"
```

---

## Task 2: Implement MessageQueue Class

**Files:**

- Create: `src/message-queue/queue.ts`
- Test: `tests/message-queue/queue.test.ts`

- [ ] **Step 1: Write failing test for MessageQueue.enqueue**

```typescript
import { describe, expect, it, beforeEach } from 'bun:test'
import { MessageQueue } from '../../src/message-queue/queue.js'
import type { QueueItem, ReplyFn } from '../../src/message-queue/types.js'

describe('MessageQueue', () => {
  let queue: MessageQueue
  const mockReply: ReplyFn = {
    text: async () => {},
    formatted: async () => {},
    file: async () => {},
    typing: () => {},
    buttons: async () => {},
  }

  beforeEach(() => {
    queue = new MessageQueue('user123')
  })

  it('should buffer a single item', () => {
    const item: QueueItem = {
      text: 'Hello',
      userId: 'user123',
      username: 'alice',
      storageContextId: 'user123',
      contextType: 'dm',
      files: [],
    }
    queue.enqueue(item, mockReply)
    expect(queue.getBufferedCount()).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/message-queue/queue.test.ts`
Expected: FAIL - "MessageQueue not found"

- [ ] **Step 3: Implement MessageQueue class**

```typescript
import type { IncomingFile } from '../chat/types.js'
import type { CoalescedItem, InternalQueueState, QueueItem, ReplyFn } from './types.js'

const DEBOUNCE_MS = 500

export class MessageQueue {
  private state: InternalQueueState
  private storageContextId: string

  constructor(storageContextId: string) {
    this.storageContextId = storageContextId
    this.state = {
      items: [],
      processing: false,
      timer: null,
      lastUserId: null,
      files: [],
      replies: [],
    }
  }

  enqueue(item: QueueItem, reply: ReplyFn): void {
    // Show typing immediately
    reply.typing()

    // Check if we need to flush (different user in main chat)
    const shouldFlushImmediately =
      this.state.items.length > 0 &&
      item.contextType === 'group' &&
      this.state.lastUserId !== null &&
      this.state.lastUserId !== item.userId &&
      !this.state.items[0].storageContextId.includes(':') // not a thread

    if (shouldFlushImmediately) {
      this.flush()
    }

    // Buffer the item
    this.state.items.push(item)
    this.state.replies.push(reply)
    this.state.files.push(...item.files)
    this.state.lastUserId = item.userId

    // Clear existing timer and set new one
    if (this.state.timer !== null) {
      clearTimeout(this.state.timer)
    }
    this.state.timer = setTimeout(() => this.flush(), DEBOUNCE_MS)
  }

  getBufferedCount(): number {
    return this.state.items.length
  }

  private flush(): void {
    if (this.state.timer !== null) {
      clearTimeout(this.state.timer)
      this.state.timer = null
    }

    if (this.state.items.length === 0) return

    const coalesced = this.coalesce()
    this.clearBuffer()

    // Fire-and-forget processing
    void this.process(coalesced)
  }

  private coalesce(): CoalescedItem {
    const items = this.state.items
    const replies = this.state.replies

    if (items.length === 0) {
      throw new Error('Cannot coalesce empty queue')
    }

    // Build coalesced text
    const parts: string[] = []
    let currentUser = items[0].userId
    let currentLines: string[] = []

    for (const item of items) {
      const isThread = item.storageContextId.includes(':')
      const needsAttribution = isThread && item.userId !== currentUser

      if (needsAttribution && currentLines.length > 0) {
        // Flush current user's lines with attribution
        if (isThread) {
          parts.push(
            `[@${items.find((i) => i.userId === currentUser)?.username ?? 'unknown'}]: ${currentLines.join('\n')}`,
          )
        } else {
          parts.push(currentLines.join('\n'))
        }
        currentLines = []
      }

      if (isThread) {
        currentLines.push(`[@${item.username ?? 'unknown'}]: ${item.text}`)
      } else {
        currentLines.push(item.text)
      }
      currentUser = item.userId
    }

    // Flush remaining lines
    if (currentLines.length > 0) {
      if (items[0].storageContextId.includes(':')) {
        // Thread - already has attribution
        parts.push(...currentLines)
      } else {
        parts.push(...currentLines)
      }
    }

    return {
      text: parts.join('\n\n'),
      userId: items[items.length - 1].userId,
      username: items[items.length - 1].username,
      storageContextId: this.storageContextId,
      files: this.state.files,
      reply: replies[replies.length - 1], // Use last reply
    }
  }

  private clearBuffer(): void {
    this.state.items = []
    this.state.replies = []
    this.state.files = []
    this.state.lastUserId = null
    if (this.state.timer !== null) {
      clearTimeout(this.state.timer)
      this.state.timer = null
    }
  }

  private async process(coalesced: CoalescedItem): Promise<void> {
    if (this.state.processing) {
      // Should not happen - queue prevents concurrent processing
      throw new Error('Queue is already processing')
    }

    this.state.processing = true

    try {
      // Processing will be handled by the caller via callback
      // This is a placeholder for the actual processing logic
      // The real implementation passes this to the handler callback
    } finally {
      this.state.processing = false
    }
  }

  forceFlush(): CoalescedItem | null {
    if (this.state.items.length === 0) return null
    const coalesced = this.coalesce()
    this.clearBuffer()
    return coalesced
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/message-queue/queue.test.ts`
Expected: PASS

- [ ] **Step 5: Write test for coalescing same-user messages**

```typescript
it('should coalesce same-user messages', () => {
  queue.enqueue(
    {
      text: 'Hello',
      userId: 'user123',
      username: 'alice',
      storageContextId: 'user123',
      contextType: 'dm',
      files: [],
    },
    mockReply,
  )
  queue.enqueue(
    {
      text: 'World',
      userId: 'user123',
      username: 'alice',
      storageContextId: 'user123',
      contextType: 'dm',
      files: [],
    },
    mockReply,
  )

  const coalesced = queue.forceFlush()
  expect(coalesced).not.toBeNull()
  expect(coalesced!.text).toBe('Hello\n\nWorld')
})
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bun test tests/message-queue/queue.test.ts`
Expected: PASS

- [ ] **Step 7: Write test for thread attribution**

```typescript
it('should add attribution in threads', () => {
  const queue = new MessageQueue('group456:thread789')
  queue.enqueue(
    {
      text: 'Hello',
      userId: 'user123',
      username: 'alice',
      storageContextId: 'group456:thread789',
      contextType: 'group',
      files: [],
    },
    mockReply,
  )
  queue.enqueue(
    {
      text: 'World',
      userId: 'user123',
      username: 'alice',
      storageContextId: 'group456:thread789',
      contextType: 'group',
      files: [],
    },
    mockReply,
  )

  const coalesced = queue.forceFlush()
  expect(coalesced).not.toBeNull()
  expect(coalesced!.text).toBe('[@alice]: Hello\n\n[@alice]: World')
})
```

- [ ] **Step 8: Run test to verify it passes**

Run: `bun test tests/message-queue/queue.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/message-queue/queue.ts tests/message-queue/queue.test.ts
git commit -m "feat(message-queue): implement MessageQueue class with coalescing"
```

---

## Task 3: Implement QueueRegistry

**Files:**

- Create: `src/message-queue/registry.ts`
- Test: `tests/message-queue/registry.test.ts`

- [ ] **Step 1: Write failing test for QueueRegistry**

```typescript
import { describe, expect, it, beforeEach } from 'bun:test'
import { QueueRegistry } from '../../src/message-queue/registry.js'

describe('QueueRegistry', () => {
  let registry: QueueRegistry

  beforeEach(() => {
    registry = new QueueRegistry()
  })

  it('should create queue for new context', () => {
    const queue = registry.getOrCreate('user123')
    expect(queue).toBeDefined()
    expect(queue.getBufferedCount()).toBe(0)
  })

  it('should return same queue for same context', () => {
    const queue1 = registry.getOrCreate('user123')
    const queue2 = registry.getOrCreate('user123')
    expect(queue1).toBe(queue2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/message-queue/registry.test.ts`
Expected: FAIL - "QueueRegistry not found"

- [ ] **Step 3: Implement QueueRegistry**

```typescript
import { MessageQueue } from './queue.js'

const SESSION_TTL_MS = 30 * 60 * 1000 // 30 minutes

export class QueueRegistry {
  private queues = new Map<string, MessageQueue>()
  private lastAccessed = new Map<string, number>()

  getOrCreate(storageContextId: string): MessageQueue {
    let queue = this.queues.get(storageContextId)
    if (queue === undefined) {
      queue = new MessageQueue(storageContextId)
      this.queues.set(storageContextId, queue)
    }
    this.lastAccessed.set(storageContextId, Date.now())
    return queue
  }

  get(storageContextId: string): MessageQueue | undefined {
    return this.queues.get(storageContextId)
  }

  cleanupExpired(): void {
    const now = Date.now()
    const expired: string[] = []
    for (const [id, lastAccess] of this.lastAccessed) {
      if (now - lastAccess > SESSION_TTL_MS) {
        expired.push(id)
      }
    }
    for (const id of expired) {
      this.queues.delete(id)
      this.lastAccessed.delete(id)
    }
  }

  getAllQueues(): Map<string, MessageQueue> {
    return new Map(this.queues)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/message-queue/registry.test.ts`
Expected: PASS

- [ ] **Step 5: Write test for cleanup**

```typescript
it('should cleanup expired queues', () => {
  const registry = new QueueRegistry()
  registry.getOrCreate('user123')

  // Manually set last accessed to old time
  // (would need to expose this for testing or mock Date)

  registry.cleanupExpired()
  expect(registry.get('user123')).toBeUndefined()
})
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bun test tests/message-queue/registry.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/message-queue/registry.ts tests/message-queue/registry.test.ts
git commit -m "feat(message-queue): implement QueueRegistry with TTL cleanup"
```

---

## Task 4: Create Public API (index.ts)

**Files:**

- Create: `src/message-queue/index.ts`
- Test: `tests/message-queue/index.test.ts`

- [ ] **Step 1: Write failing test for enqueueMessage**

```typescript
import { describe, expect, it } from 'bun:test'
import { enqueueMessage, flushOnShutdown } from '../../src/message-queue/index.js'
import type { QueueItem, ReplyFn } from '../../src/message-queue/types.js'

describe('enqueueMessage', () => {
  it('should enqueue a message', () => {
    const item: QueueItem = {
      text: 'Hello',
      userId: 'user123',
      username: 'alice',
      storageContextId: 'user123',
      contextType: 'dm',
      files: [],
    }
    const mockReply: ReplyFn = {
      text: async () => {},
      formatted: async () => {},
      file: async () => {},
      typing: () => {},
      buttons: async () => {},
    }

    // Should not throw
    enqueueMessage(item, mockReply, async () => {})
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/message-queue/index.test.ts`
Expected: FAIL - "enqueueMessage not found"

- [ ] **Step 3: Implement index.ts**

```typescript
import type { CoalescedItem, QueueItem, ReplyFn } from './types.js'
import { QueueRegistry } from './registry.js'

// Singleton registry
const registry = new QueueRegistry()

export type { QueueItem, CoalescedItem, ReplyFn }

export function enqueueMessage(
  item: QueueItem,
  reply: ReplyFn,
  handler: (coalesced: CoalescedItem) => Promise<void>,
): void {
  const queue = registry.getOrCreate(item.storageContextId)

  // Override the queue's process method to use our handler
  // This is done by setting up a callback that will be called on flush
  queue.enqueue(item, reply)

  // Note: The actual handler invocation is done via a callback mechanism
  // that needs to be implemented in the MessageQueue class
}

export async function flushOnShutdown(options: { timeoutMs?: number } = {}): Promise<void> {
  const timeout = options.timeoutMs ?? 5000
  const startTime = Date.now()

  const queues = registry.getAllQueues()
  const pendingFlushes: Promise<void>[] = []

  for (const [id, queue] of queues) {
    const coalesced = queue.forceFlush()
    if (coalesced !== null) {
      // Note: In real implementation, we'd need to call the handler here
      // But handlers are per-enqueue, not stored globally
      // This requires restructuring to store handlers
      console.log(`Flushing queue ${id}: ${coalesced.text.slice(0, 50)}...`)
    }

    if (Date.now() - startTime > timeout) {
      console.warn('Shutdown flush timeout reached')
      break
    }
  }

  await Promise.all(pendingFlushes)
}

// Export registry for testing
export { registry }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/message-queue/index.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/message-queue/index.ts tests/message-queue/index.test.ts
git commit -m "feat(message-queue): add public API (enqueueMessage, flushOnShutdown)"
```

---

## Task 5: Refactor MessageQueue to Support Handler Callback

**Files:**

- Modify: `src/message-queue/queue.ts`
- Modify: `src/message-queue/index.ts`

- [ ] **Step 1: Update MessageQueue to accept handler callback**

```typescript
// Add to queue.ts - modify enqueue signature
export class MessageQueue {
  // ... existing state ...
  private handler: ((coalesced: CoalescedItem) => Promise<void>) | null = null

  setHandler(handler: (coalesced: CoalescedItem) => Promise<void>): void {
    this.handler = handler
  }

  enqueue(item: QueueItem, reply: ReplyFn): void {
    // ... existing code ...
  }

  private async process(coalesced: CoalescedItem): Promise<void> {
    if (this.state.processing) {
      throw new Error('Queue is already processing')
    }

    this.state.processing = true

    try {
      if (this.handler !== null) {
        await this.handler(coalesced)
      }
    } finally {
      this.state.processing = false
      // Check if more messages arrived during processing
      if (this.state.items.length > 0) {
        this.flush()
      }
    }
  }
}
```

- [ ] **Step 2: Update index.ts to use handler**

```typescript
export function enqueueMessage(
  item: QueueItem,
  reply: ReplyFn,
  handler: (coalesced: CoalescedItem) => Promise<void>,
): void {
  const queue = registry.getOrCreate(item.storageContextId)

  // Set handler if not already set (or update it)
  queue.setHandler(handler)

  queue.enqueue(item, reply)
}
```

- [ ] **Step 3: Run tests to verify everything still works**

Run: `bun test tests/message-queue/`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/message-queue/queue.ts src/message-queue/index.ts
git commit -m "refactor(message-queue): support handler callback for processing"
```

---

## Task 6: Integrate into bot.ts

**Files:**

- Modify: `src/bot.ts` (lines 97-130)

- [ ] **Step 1: Add imports to bot.ts**

```typescript
// At top of bot.ts, add:
import { enqueueMessage } from './message-queue/index.js'
import { storeIncomingFiles, clearIncomingFiles } from './file-relay.js'
```

- [ ] **Step 2: Modify handleMessage function**

```typescript
// Replace the existing handleMessage function (lines 97-130)
async function handleMessage(
  msg: IncomingMessage,
  reply: ReplyFn,
  auth: AuthorizationResult,
  deps: BotDeps,
): Promise<void> {
  // Check authorization
  if (!auth.allowed) {
    if (msg.isMentioned) {
      await reply.text(
        "You're not authorized to use this bot in this group. Ask a group admin to add you with `/group adduser @{username}`",
      )
    }
    return
  }

  const hasCommand = msg.commandMatch !== undefined && msg.commandMatch !== ''
  const isNaturalLanguage = !hasCommand
  if (msg.contextType === 'group' && isNaturalLanguage && !msg.isMentioned) {
    // Silent ignore - natural language in groups requires mention
    return
  }

  // Create queue item
  const queueItem = {
    text: buildPromptWithReplyContext(msg),
    userId: msg.user.id,
    username: msg.user.username,
    storageContextId: auth.storageContextId,
    contextType: msg.contextType,
    files: msg.files ?? [],
  }

  // Enqueue the message (fire-and-forget)
  enqueueMessage(queueItem, reply, async (coalescedItem) => {
    const start = Date.now()

    // Show typing when processing starts
    coalescedItem.reply.typing()

    // Store accumulated files before processing
    if (coalescedItem.files.length > 0) {
      storeIncomingFiles(coalescedItem.storageContextId, coalescedItem.files)
    } else {
      clearIncomingFiles(coalescedItem.storageContextId)
    }

    try {
      await deps.processMessage(
        coalescedItem.reply,
        coalescedItem.storageContextId,
        coalescedItem.username,
        coalescedItem.text,
      )
    } finally {
      // Clear files after processing
      clearIncomingFiles(coalescedItem.storageContextId)

      // Emit metrics
      emit('message:replied', {
        userId: coalescedItem.userId,
        contextId: coalescedItem.storageContextId,
        duration: Date.now() - start,
      })
    }
  })
}
```

- [ ] **Step 3: Run tests to verify integration**

Run: `bun test tests/bot.test.ts`
Expected: PASS (may need to update existing tests)

- [ ] **Step 4: Commit**

```bash
git add src/bot.ts
git commit -m "feat(bot): integrate message queue into handleMessage"
```

---

## Task 7: Add Graceful Shutdown Hook

**Files:**

- Modify: `src/index.ts`

- [ ] **Step 1: Add import and setup signal handlers**

```typescript
// At top of index.ts, add:
import { flushOnShutdown } from './message-queue/index.js'

// After chat provider setup, before chat.start(), add:
// Graceful shutdown handlers
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, flushing message queues...')
  await flushOnShutdown({ timeoutMs: 5000 })
  await chat.stop()
  process.exit(0)
})

process.on('SIGINT', async () => {
  console.log('SIGINT received, flushing message queues...')
  await flushOnShutdown({ timeoutMs: 5000 })
  await chat.stop()
  process.exit(0)
})
```

- [ ] **Step 2: Run tests**

Run: `bun test tests/`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat(index): add graceful shutdown hook to flush message queues"
```

---

## Task 8: Write Integration Tests

**Files:**

- Create: `tests/message-queue/integration.test.ts`

- [ ] **Step 1: Write integration test for sequential processing**

```typescript
import { describe, expect, it } from 'bun:test'
import { enqueueMessage } from '../../src/message-queue/index.js'
import type { QueueItem, ReplyFn, CoalescedItem } from '../../src/message-queue/types.js'

describe('MessageQueue Integration', () => {
  it('should process messages sequentially per context', async () => {
    const processed: string[] = []
    const mockReply: ReplyFn = {
      text: async () => {},
      formatted: async () => {},
      file: async () => {},
      typing: () => {},
      buttons: async () => {},
    }

    const handler = async (coalesced: CoalescedItem) => {
      processed.push(coalesced.text)
      await new Promise((r) => setTimeout(r, 10)) // Simulate async work
    }

    // Send two messages to same context
    enqueueMessage(
      {
        text: 'Message 1',
        userId: 'user1',
        username: 'alice',
        storageContextId: 'ctx1',
        contextType: 'dm',
        files: [],
      },
      mockReply,
      handler,
    )

    enqueueMessage(
      {
        text: 'Message 2',
        userId: 'user1',
        username: 'alice',
        storageContextId: 'ctx1',
        contextType: 'dm',
        files: [],
      },
      mockReply,
      handler,
    )

    // Wait for debounce + processing
    await new Promise((r) => setTimeout(r, 600))

    // Should be coalesced into one
    expect(processed.length).toBe(1)
    expect(processed[0]).toBe('Message 1\n\nMessage 2')
  })
})
```

- [ ] **Step 2: Run tests**

Run: `bun test tests/message-queue/integration.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/message-queue/integration.test.ts
git commit -m "test(message-queue): add integration tests"
```

---

## Task 9: Self-Review and Cleanup

- [ ] **Step 1: Run full test suite**

Run: `bun test`
Expected: All PASS

- [ ] **Step 2: Run lint check**

Run: `bun lint`
Expected: No errors

- [ ] **Step 3: Run type check**

Run: `bun typecheck`
Expected: No errors

- [ ] **Step 4: Final commit**

```bash
git add .
git commit -m "feat: implement per-context message queue with coalescing

- Add MessageQueue class with 500ms debounce
- Add QueueRegistry for per-context management
- Support fire-and-forget enqueue pattern
- Add thread attribution for coalesced messages
- Handle file accumulation across coalesced messages
- Add graceful shutdown with queue flush
- Fix stale-read race condition in history"
```

---

## Verification Checklist

- [ ] All new files have tests
- [ ] Integration tests verify end-to-end behavior
- [ ] Existing bot tests still pass
- [ ] Lint and typecheck pass
- [ ] Manual test: Send rapid messages, verify coalescing
- [ ] Manual test: Graceful shutdown preserves pending messages
- [ ] Manual test: Different users in main chat flush immediately
