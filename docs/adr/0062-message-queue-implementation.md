<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0062: Per-Context Message Queue with Debounced Coalescing

## Status

Implemented

## Date

2026-04-11

## Context

The bot processes messages by calling the LLM via `processMessage()`, which is an async operation. When multiple messages arrive for the same storage context (DM, group, or thread) in rapid succession, each message independently reads conversation history before the previous one has completed. This creates a stale-read race condition:

```
T0: Message A starts, reads history=[U1, A1]
T1: Message B starts, reads history=[U1, A1, U2] (sees U2 but not A2)
T2: Message A completes, appends A2
T3: Message B completes, appends B2
```

Bun's single-threaded event loop makes `cache.history.push()` atomic, but `await callLlm(...)` yields control, allowing interleaving. Both LLM calls operate on different snapshots of history — message B never sees A's assistant response.

This was not a concurrency bug (no data corruption) but a logical consistency issue where the LLM produced responses based on incomplete conversation context.

## Decision Drivers

- Must guarantee sequential processing per storage context (no stale reads)
- Must preserve multi-context concurrency (slow LLM in context A must not block context B)
- Should coalesce rapid-fire messages from the same user (reduce redundant LLM calls)
- Must handle file accumulation across coalesced messages
- Must flush pending buffers on graceful shutdown
- Must show typing indicator immediately on message arrival

## Considered Options

### Option 1: Mutex per storage context

- **Pros:** Minimal code change, simple lock/unlock pattern
- **Cons:** No coalescing — each message still triggers a separate LLM call, no typing improvement, users must wait for sequential processing of every message

### Option 2: Global message queue with round-robin dispatch

- **Pros:** Centralized control, easy to monitor
- **Cons:** Single point of contention, unrelated contexts block each other, adds complexity without addressing the core per-context race

### Option 3: Per-context queue with debounced coalescing

- **Pros:** Fixes stale reads, reduces LLM calls via coalescing, preserves multi-context concurrency via fire-and-forget enqueue, handles files and typing correctly
- **Cons:** More code (new module), 500ms debounce window means slightly delayed processing, messages in buffer lost on crash

### Option 4: Rewrite history management to use compare-and-swap

- **Pros:** No queue needed, atomic history updates
- **Cons:** Requires restructuring the entire history + LLM pipeline, does not address redundant LLM calls from rapid messages, much larger refactor

## Decision

We implemented **Option 3**: a per-context message queue with 500ms debounced coalescing.

### Architecture

```
src/message-queue/
├── types.ts       # QueueItem, CoalescedItem interfaces
├── queue.ts       # MessageQueue class (buffer, debounce, flush)
├── registry.ts    # QueueRegistry (storageContextId → queue map, TTL cleanup)
└── index.ts       # Public API: enqueueMessage, flushOnShutdown, cleanupExpiredQueues
```

### Key Design Decisions

1. **Fire-and-forget enqueue** — `enqueueMessage()` returns immediately after buffering. This preserves multi-context concurrency (slow LLM in context A does not block context B).

2. **500ms debounce timer** — Messages arriving within 500ms from the same user in the same context are coalesced into a single LLM call. Timer resets on each new message.

3. **Different-user immediate flush** — In group main chat (non-thread), a message from a different user triggers an immediate flush of the buffered messages before buffering the new one. In threads, different-user messages are coalesced with `[@username]:` attribution.

4. **Handler chain for sequential processing** — The `handlerChain` promise chain ensures that even when timer-based flushes overlap, handler invocations are sequential. This prevents the original stale-read race condition.

5. **File accumulation** — Files from multiple coalesced messages are accumulated into a single array and stored via `storeIncomingFiles()` before processing.

6. **Last reply wins** — When coalescing, the last message's `reply` function is used for the response, ensuring correct platform context (chatId, threadId).

7. **Graceful shutdown** — `flushOnShutdown()` force-flushes all active queues with a configurable timeout (default 5s), racing against a hard deadline to prevent indefinite blocking.

### Coalescing Rules

| Context    | Key                | Same User ≤500ms          | Different User ≤500ms                |
| ---------- | ------------------ | ------------------------- | ------------------------------------ |
| DM         | `userId`           | Coalesce (`\n\n`)         | N/A                                  |
| Group main | `groupId`          | Coalesce (`\n`)           | Flush immediately (separate process) |
| Thread     | `groupId:threadId` | Coalesce with attribution | Coalesce with attribution            |

### Divergences from Original Plan

The implementation diverges from the plan in these areas:

1. **`CoalescedItem` includes `contextType`** — The plan's `CoalescedItem` did not include `contextType`; the implementation does, enabling the handler to make context-aware decisions.
2. **`cleanupExpiredQueues()` exported** — The plan did not include a periodic cleanup export; the implementation exposes it for the scheduler.
3. **`QueueItem.contextType` is `ContextType`** — The plan used `'dm' | 'group'` string literal union; the implementation uses the existing `ContextType` type from `chat/types.ts`.
4. **`readonly` properties on interfaces** — Implementation uses `readonly` modifiers and `readonly IncomingFile[]` for immutability.
5. **`handlerChain` promise chain** — Not in the plan; added to ensure sequential handler execution without a `processing` boolean flag.
6. **Coalescing join strategy** — DMs use `\n\n` (double newline), groups use `\n` (single newline). The plan used `\n\n` uniformly.
7. **Thread detection** — The plan checked `storageContextId.includes(':')`; the implementation also checks `contextType === 'group'` for more precise thread detection.
8. **`flushOnShutdown` timeout racing** — The plan had a simpler loop; the implementation uses `raceWithTimeout()` to ensure the hard deadline is respected.
9. **Different-user flush returns coalesced item** — `enqueue()` returns the flushed `CoalescedItem` when a different-user trigger fires, and the caller (`enqueueMessage`) dispatches it to the handler immediately.

## Rationale

The per-context queue with coalescing is the right granularity: it fixes the stale-read bug at its source (one LLM call at a time per shared history) while avoiding the bottleneck of a global queue. The 500ms debounce window is a practical trade-off — fast enough to feel responsive, long enough to catch rapid-fire messages from users who split their thoughts across multiple sends.

Fire-and-forget enqueue is critical for the multi-context use case: the bot serves multiple users and groups simultaneously, and a global await would serialize everything.

## Consequences

### Positive

- Stale-read race condition eliminated — one LLM call per context at a time
- Reduced LLM costs and latency via message coalescing
- Multi-context concurrency preserved (fire-and-forget pattern)
- Files accumulated correctly across coalesced messages
- Typing indicator shown immediately on message arrival
- Graceful shutdown preserves pending messages
- Idle queues cleaned up after 30 minutes (reuses `SESSION_TTL_MS`)

### Negative

- 500ms processing delay on first message (debounce window)
- Messages in the debounce buffer are lost on crash (acceptable — user can resend)
- More code to maintain (4 new source files, test files, integration tests)
- Handler must be set per queue (slightly awkward API, but works for single-handler use case)

### Risks

- **Timer accuracy** — Bun's `setTimeout` is not guaranteed to fire at exactly 500ms under heavy load. Mitigation: the `handlerChain` ensures sequential processing regardless of timer jitter.
- **Memory growth** — Many active contexts create many queue instances. Mitigation: `cleanupExpiredQueues()` runs periodically and removes queues idle for 30+ minutes.
- **Thread detection heuristic** — `storageContextId.includes(':')` assumes thread IDs always contain `:`. Mitigation: this matches the established `getThreadScopedStorageContextId()` format.

## Implementation Notes

- `enqueueMessage()` is called from `bot.ts:177` via `handleMessage()`
- The handler callback delegates to `processCoalescedMessage()` which wraps `deps.processMessage()`
- `cleanupExpiredQueues()` is called by the centralized scheduler
- `flushOnShutdown()` is called from `index.ts` signal handlers (SIGTERM/SIGINT)
- Bot tests mock `enqueueMessage` to process synchronously

## Related Decisions

- ADR-0014: Multi-Chat Provider Abstraction — established the `ChatProvider` and `ReplyFn` patterns used by the queue
- ADR-0059: Thread-Aware Group Chat — defined the `storageContextId` format (`groupId:threadId`) that the queue uses for thread detection
- ADR-0036: Centralized Scheduler Utility — scheduler calls `cleanupExpiredQueues()` periodically

## References

- Design: `docs/superpowers/specs/2026-04-11-message-queue-design.md`
- Plan: `docs/superpowers/plans/2026-04-11-message-queue-implementation.md`
