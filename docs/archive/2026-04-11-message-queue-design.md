<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Message Queue Design: Per-Context Sequential Processing

## Overview

Implement a per-context message queue system to fix stale-read bugs when multiple messages arrive simultaneously, with support for message coalescing (debounced message batching).

## Problem Statement

The current architecture has a stale-read bug on shared state:

```
T0: Message A starts, reads history=[U1, A1]
T1: Message B starts, reads history=[U1, A1, U2] (sees U2 but not A2)
T2: Message A completes, appends A2
T3: Message B completes, appends B2
```

Both LLM calls use different snapshots of history — message B is missing A's assistant response. Both assistant responses get appended. This is a **stale-read** bug, not array corruption. Bun's single-threaded event loop makes `cache.history.push()` atomic, but `await callLlm(...)` yields control, allowing interleaving.

## Goals

1. Ensure one message processed at a time per context (sequential processing)
2. Coalesce rapid-fire messages (same user, ≤500ms) into a single prompt
3. Preserve forward message metadata in coalesced text (deferred to v2)
4. Flush buffers on graceful shutdown (survive normal restarts)

## Architecture

### New Module: `src/message-queue/`

```
src/
├── message-queue/
│   ├── index.ts           # Public exports: enqueueMessage, flushOnShutdown
│   ├── types.ts           # QueueItem, QueueState interfaces
│   ├── queue.ts           # MessageQueue class
│   └── registry.ts        # QueueRegistry, per-context management
```

### Components

| Component       | Responsibility                                                                       |
| --------------- | ------------------------------------------------------------------------------------ |
| `MessageQueue`  | Buffer messages, manage 500ms debounce timer, flush coalesced text, accumulate files |
| `QueueRegistry` | Map of storageContextId → MessageQueue, handles queue lifecycle                      |
| `QueueItem`     | Internal structure holding message + metadata + files for buffering                  |

### Storage Context Key

The queue must use `auth.storageContextId` (computed by `getThreadScopedStorageContextId` in auth.ts), NOT `msg.contextId`:

| Context    | Key                |
| ---------- | ------------------ |
| DM         | `userId`           |
| Group main | `groupId`          |
| Thread     | `groupId:threadId` |

### Integration Points

1. **Entry Point**: Modify `src/bot.ts` → `handleMessage()` to wrap `deps.processMessage()` call with queue
2. **Message Handlers**: Queue drains to existing `processMessage()` via handler callback
3. **Shutdown**: Flush all active buffers on graceful shutdown (SIGTERM/SIGINT)
4. **Lifecycle**: Queues auto-create on first message, cleanup on inactivity

## Data Flow

### State Machine

```
      ┌─────────────┐
      │   IDLE      │◄─────────────────┐
      └──────┬──────┘                  │
             │                          │
    ┌────────▼────────┐                 │
    │ Message arrives │                 │
    │ (typing shown)  │                 │
    └────────┬────────┘                 │
             │                          │
             ▼                          │
    ┌─────────────────┐◄──────────┐     │
    │  BUFFERING      │           │     │
    │ (500ms timer    │           │     │
    │   running)      │           │     │
    └────────┬────────┘           │     │
             │                    │     │
    ┌────────▼────────┐          │     │
    │ Another message?  │──yes────┘     │
    └────────┬────────┘               │
             │ no                       │
             │                          │
     ┌───────┴────────┐                │
     │ Different user │                │
     │ in main chat?  │──yes───────────┼──► PROCESSING
     └───────┬────────┘                │     (flush now)
             │ no                      │
             ▼                         │
    ┌─────────────────┐                │
    │   PROCESSING    │────────────────┘
    │ (call handler,   │
    │  await completion)│
    └────────┬────────┘
             │
             ▼
    ┌─────────────────┐
    │ More messages?  │──yes──► BUFFERING
    └────────┬────────┘
             │ no
             ▼
         Return to IDLE
```

### State Transitions

1. **IDLE → BUFFERING**: First message arrives, typing indicator shown, start 500ms debounce
2. **BUFFERING → BUFFERING**: Additional messages arrive within 500ms, append to buffer/accumulate files, reset timer
3. **BUFFERING → PROCESSING** (debounce expires): Flush buffered messages as single text with accumulated files
4. **BUFFERING → PROCESSING** (different user in main chat): Flush immediately, bypass timer
5. **PROCESSING → BUFFERING**: More messages arrived during processing, show typing, start new debounce
6. **PROCESSING → IDLE**: Handler completes, no buffered messages

## Coalescing Rules

### Context-Aware Coalescing

| Storage Context | Key                | Multiple users? | Same User ≤500ms | Different User ≤500ms                               | Attribution           |
| --------------- | ------------------ | --------------- | ---------------- | --------------------------------------------------- | --------------------- |
| DM              | `userId`           | No              | Coalesce         | N/A                                                 | No                    |
| Group main      | `groupId`          | Yes             | Coalesce         | **Flush immediately** (text-only, still sequential) | No                    |
| Thread          | `groupId:threadId` | Yes             | Coalesce         | **Coalesce with attribution**                       | Yes (username prefix) |

**Important:** The "different user flush" rule only affects **text merging**, not execution order. All messages sharing the same `storageContextId` are processed sequentially regardless of user.

### Coalesced Message Formats

```typescript
// DM - normal messages
'Hello there\n\nAlso check this'

// Group main chat - normal messages (same user)
'Hello there\n\nAlso check this'

// Group main chat - different users (flushed separately, not coalesced)
// Processed as two separate queue items

// Thread - same user
'[@bob]: Hello there\n\n[@bob]: Also check this'

// Thread - different users
"[@alice]: What's the status?\n\n[@bob]: It's ready for review"
```

**Note:** Same-user thread attribution is verbose but correct. The LLM can handle it. Optimization to omit duplicate usernames is deferred to v2.

### Flush Triggers

1. **Debounce timer expires** (500ms) → process buffered messages
2. **Different user in main chat** → flush immediately, start new queue item (text coalescing only)
3. **Graceful shutdown** → flush all active buffers immediately

**Note:** Commands (`/` prefix) naturally bypass the queue because they're handled via `chat.registerCommand()`, not through `handleMessage` → `processMessage`.

## File Handling

When coalescing messages, files from multiple messages are **accumulated**, not overwritten:

```typescript
// Message 1: "Check this" + file1.jpg
// Message 2: "Also this" + file2.jpg
// Result: Coalesced text + [file1.jpg, file2.jpg]
```

The queue accumulates files in a list during buffering. The handler callback manages the file relay:

```typescript
// Handler callback in enqueueMessage
;async (coalescedItem) => {
  // Store accumulated files before processing
  storeIncomingFiles(coalescedItem.storageContextId, coalescedItem.files)
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
  }
}
```

## Error Handling

### Queue-Level Errors

| Scenario                          | Behavior                                                  | Recovery                       |
| --------------------------------- | --------------------------------------------------------- | ------------------------------ |
| Handler throws error              | Propagate error to caller, release processing lock        | Next message proceeds normally |
| Debounce timer cleanup fails      | Silent fail                                               | No action needed               |
| Memory pressure (too many queues) | Expire idle queues (reuse `SESSION_TTL_MS` from cache.ts) | Cleanup runs periodically      |
| Graceful shutdown                 | Flush all active buffers immediately (skip debounce)      | Normal exit                    |
| Crash                             | Lose messages in 500ms buffer                             | Acceptable — user can resend   |

### Error Propagation

The queue does NOT add error handling beyond ensuring the processing lock is released. `processMessage` already has comprehensive error handling:

- Catches errors
- Sends user-facing messages
- Rolls back history on failure

Queue responsibility: Release the processing lock so the next message can proceed.

### Edge Cases

1. **Rapid messages >500ms apart** - processed as separate queue items
2. **User sends 10 messages in 2 seconds** - first coalesces (500ms), rest queued sequentially
3. **Bot restart during processing** - in-flight message may be lost (acceptable)
4. **Graceful shutdown** - all buffers flushed immediately
5. **Crash during debounce** - messages in 500ms window lost (acceptable)

## Integration

### Files to Modify

| File                            | Changes                                                               |
| ------------------------------- | --------------------------------------------------------------------- |
| `src/bot.ts`                    | Wrap `deps.processMessage()` call inside `handleMessage()` with queue |
| `src/message-queue/index.ts`    | New - public exports                                                  |
| `src/message-queue/types.ts`    | New - QueueItem, QueueState interfaces                                |
| `src/message-queue/queue.ts`    | New - MessageQueue class                                              |
| `src/message-queue/registry.ts` | New - QueueRegistry                                                   |
| `src/index.ts`                  | Add graceful shutdown hook to flush buffers                           |

### enqueueMessage Return Semantics

`enqueueMessage` is **fire-and-forget** — it resolves immediately after buffering the message. This preserves multi-context concurrency (slow LLM in context A doesn't block unrelated context B).

**Consequences:**

- Errors during processing are handled internally by the handler callback
- `message:replied` emission must move into the handler callback (not caller)

### Integration Pattern

**In `bot.ts` - inside `handleMessage()`:**

```typescript
// Before:
reply.typing()
const prompt = buildPromptWithReplyContext(msg)
const start = Date.now()
try {
  await deps.processMessage(reply, auth.storageContextId, msg.user.username, prompt)
} finally {
  emit('message:replied', {
    userId: msg.user.id,
    contextId: msg.contextId,
    duration: Date.now() - start,
  })
}

// After:
import { enqueueMessage } from './message-queue/index.js'
import { storeIncomingFiles, clearIncomingFiles } from './file-relay.js'

const queueItem = {
  text: buildPromptWithReplyContext(msg),
  userId: msg.user.id,
  username: msg.user.username,
  storageContextId: auth.storageContextId, // NOT msg.contextId
  contextType: msg.contextType, // 'dm' or 'group'
  files: msg.files ?? [],
}

// Fire-and-forget: resolves immediately after buffering
enqueueMessage(queueItem, reply, async (coalescedItem) => {
  const start = Date.now()
  reply.typing() // Re-show typing when processing starts

  // Store accumulated files before processing
  storeIncomingFiles(coalescedItem.storageContextId, coalescedItem.files)

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

    // Emit metrics (moved from caller to handler callback)
    emit('message:replied', {
      userId: coalescedItem.userId,
      contextId: coalescedItem.storageContextId,
      duration: Date.now() - start,
    })
  }
})
```

**Graceful Shutdown in `index.ts`:**

```typescript
import { flushOnShutdown } from './message-queue/index.js'

// Before stopping chat provider:
process.on('SIGTERM', async () => {
  // Flush buffers with 5s timeout, abandon in-flight LLM calls
  await flushOnShutdown({ timeoutMs: 5000 })
  await chat.stop()
  process.exit(0)
})

process.on('SIGINT', async () => {
  await flushOnShutdown({ timeoutMs: 5000 })
  await chat.stop()
  process.exit(0)
})
```

**Notes:**

- `flushOnShutdown` flushes buffered messages to handlers (skip debounce)
- In-flight LLM calls are abandoned (nothing to flush there)
- Hard timeout prevents indefinite blocking

## Data Types

```typescript
// types.ts
interface QueueItem {
  text: string
  userId: string
  username: string | null
  storageContextId: string // NOT contextId - use storageContextId
  contextType: 'dm' | 'group' // Needed for coalescing strategy
  files: IncomingFile[]
}

interface CoalescedItem {
  text: string
  userId: string // Needed for metrics emission
  username: string | null
  storageContextId: string
  files: IncomingFile[]
  reply: ReplyFn // Last message's reply function
}

interface QueueState {
  items: QueueItem[]
  processing: boolean
  timer: ReturnType<typeof setTimeout> | null // Portable for Bun/Node
  lastUserId: string | null
  files: IncomingFile[] // Accumulated files
}

// Internal to MessageQueue - tracks reply functions separately
interface InternalQueueState extends QueueState {
  replies: ReplyFn[] // Tracked alongside items, parallel array
}
```

## Typing Indicator Behavior

1. **On enqueue**: `reply.typing()` shown immediately (user gets feedback)
2. **During debounce**: Typing continues (platform may require periodic refresh)
3. **On flush**: Re-show `reply.typing()` when processing starts (handler callback)

This ensures users see typing indicator within milliseconds of sending, even during the 500ms debounce.

## Reply Function Lifecycle

When coalescing multiple messages, the **last message's `reply` function** is used for the response:

- Carries correct platform context (chatId, threadId)
- Targets the correct destination (especially important for threads)
- First messages' reply functions are discarded after buffering

**Implementation:** Reply functions are tracked in a parallel array alongside QueueItems in the internal state, but only the last one is used in `CoalescedItem`.

## Success Criteria

1. ✅ Simultaneous messages from the same user are processed sequentially (no stale reads)
2. ✅ Messages arriving within 500ms from the same user are coalesced
3. ✅ Different users in main chat don't block each other (they're still sequential per context, but text isn't merged)
4. ✅ Pending messages flushed on graceful shutdown
5. ✅ Files from coalesced messages are accumulated, not overwritten
6. ✅ Typing indicator shown immediately on message arrival
7. ✅ Queue uses last message's reply function for responses
8. ✅ Multi-context concurrency preserved (fire-and-forget enqueue)
9. ✅ Metrics emission works correctly with queue

## Future Enhancements (Out of Scope)

- **Forward metadata** (v2): Add forward detection to `IncomingMessage` type and adapters
- **Forward attribution** (v2): Include `[Forwarded from @user in Chat]:` in coalesced text
- **Priority queue** for urgent messages
- **Queue depth limits** with user feedback
- **Per-user rate limiting**
- **Queue metrics and monitoring**
- **Omit duplicate usernames** in thread attribution when all messages from same user
