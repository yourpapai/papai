<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0035: Message Reply and Quote Context Awareness

## Status

Accepted

## Context

When users reply to or quote previous messages in chat conversations, the AI agent currently receives only the plain text of the reply, losing critical context about what the user is referencing. This leads to:

1. **Ambiguous queries** — "Can you update it?" requires the agent to guess what "it" refers to
2. **Broken conversation flow** — The agent responds as a new top-level message instead of continuing the thread
3. **Missing context** — The agent cannot see the quoted text or the message being replied to

Additionally, neither Telegram Bot API nor Mattermost WebSocket provides complete reply chain information natively:

- **Telegram**: Only provides the immediate parent via `reply_to_message`, not the full chain
- **Mattermost**: Only provides `root_id` for threading, not the full chain of intermediate messages

This requires building a custom message caching infrastructure to track reply relationships and reconstruct conversation context.

## Decision Drivers

- **Context awareness**: Bot must understand what message the user is replying to
- **Thread continuity**: Bot responses should continue the conversation thread naturally
- **Platform abstraction**: Solution must work across Telegram and Mattermost with different native capabilities
- **Performance**: Context retrieval must not block message processing
- **Resource efficiency**: Cache must have bounded growth to prevent memory issues
- **Persistence**: Message cache must survive bot restarts

## Considered Options

### Option 1: Middleware-based injection

Intercept and modify message text to inject context before bot processing.

- **Pros**: Simple integration, no bot changes needed
- **Cons**: Loses structured metadata needed for threading, harder to control formatting, pollutes message text
- **Verdict**: Rejected — loses critical threading information and creates formatting complexity

### Option 2: Persistent reply graph database

Store all reply relationships in a dedicated graph database for complex traversal.

- **Pros**: Powerful querying, handles complex thread structures
- **Cons**: Overkill for current needs, significant schema changes, additional infrastructure
- **Verdict**: Rejected — too complex for the current use case

### Option 3: Hybrid approach with local message cache + provider-level context extraction (Accepted)

Build provider-agnostic message cache infrastructure with SQLite persistence, extract reply context at provider level, and enrich LLM prompts with structured context.

- **Pros**: Provider-agnostic, supports both platforms, maintains structured data, bounded growth with TTL
- **Cons**: Requires new infrastructure component, cache misses for messages before bot joined
- **Verdict**: Accepted — best balance of capability and complexity

## Decision

Implement a **Message Reply & Quote Context** feature using a hybrid approach with three key components:

### 1. Message Cache Infrastructure

Create a provider-agnostic message cache (`src/message-cache/`) with:

- **In-memory Map** for fast lookups
- **1-week TTL** for automatic eviction
- **SQLite persistence** via background sync (reuses existing `queueMicrotask` pattern)
- **Chain builder** that walks backward through cached messages using `replyToMessageId`
- **Cycle detection** to prevent infinite loops

### 2. ReplyContext Data Model

Add rich context types to support both platforms:

```typescript
export type ReplyContext = {
  messageId: string // Platform-specific ID being replied to
  authorId?: string // Original message author
  authorUsername?: string | null
  text?: string // Content of message being replied to
  quotedText?: string // Specific quoted text (Telegram only)
  threadId?: string // Platform thread/topic ID
  chain?: string[] // Full reply chain (oldest → newest)
  chainSummary?: string // Summary of earlier messages
}

export type ReplyOptions = {
  replyToMessageId?: string // Reply to specific message
  threadId?: string // Post in thread/topic
}

export type ReplyFn = {
  text: (content: string, options?: ReplyOptions) => Promise<void>
  formatted: (markdown: string, options?: ReplyOptions) => Promise<void>
  file: (file: ChatFile, options?: ReplyOptions) => Promise<void>
  // ... other methods
}
```

### 3. Provider-Level Context Extraction

**Telegram** (`src/chat/telegram/index.ts`):

- Extract `reply_to_message` and `quote` fields from Grammy context
- Cache message metadata on every incoming message
- Build `ReplyContext` with parent message text, author info, and chain summary
- Pass `reply_parameters` in responses for threading
- Support `message_thread_id` for forum topics

**Mattermost** (`src/chat/mattermost/index.ts`):

- Parse `root_id` and `parent_id` from WebSocket events
- Cache message metadata on every incoming message
- Fetch parent post via API if not in cache
- Build `ReplyContext` with thread ID and chain summary
- Pass `root_id` in POST requests for threading

### 4. Prompt Enrichment

Create `src/reply-context.ts` module:

- `buildReplyContextChain()`: Build chain and summary from message cache
- `buildPromptWithReplyContext()`: Format context for LLM consumption

Prompt format:

```
[Replying to message from {author}: "{truncated_text}"]
[Quoted text: "{quoted_text}"]
[Earlier context: {chain_summary}]

{user_message}
```

### Platform Differences

| Feature            | Telegram                      | Mattermost                     |
| ------------------ | ----------------------------- | ------------------------------ |
| Reply metadata     | `reply_to_message` object     | `root_id` / `parent_id` fields |
| Quote support      | `quote.text` field            | N/A (quotes are replies)       |
| Forum topics       | `message_thread_id`           | N/A                            |
| Parent text source | Included in update            | Fetch via API if not cached    |
| Threading API      | `reply_parameters.message_id` | `root_id` in POST body         |

## Implementation

### Database Schema (Migration 017)

```sql
CREATE TABLE message_metadata (
  message_id TEXT PRIMARY KEY,
  context_id TEXT NOT NULL,      -- chat/channel ID
  author_id TEXT,
  author_username TEXT,
  text TEXT,                     -- Full message text
  reply_to_message_id TEXT,      -- Parent message ID
  timestamp INTEGER NOT NULL,
  expires_at INTEGER NOT NULL    -- TTL: 1 week from timestamp
);

CREATE INDEX idx_message_metadata_context_id ON message_metadata(context_id);
CREATE INDEX idx_message_metadata_expires_at ON message_metadata(expires_at);
CREATE INDEX idx_message_metadata_reply_to ON message_metadata(reply_to_message_id);
```

### Files Created

- `src/message-cache/types.ts` — Type definitions
- `src/message-cache/cache.ts` — In-memory cache with TTL
- `src/message-cache/persistence.ts` — SQLite background sync
- `src/message-cache/chain.ts` — Reply chain builder
- `src/message-cache/index.ts` — Module exports
- `src/reply-context.ts` — Prompt builder module
- `tests/message-cache/` — Comprehensive test suite
- `tests/reply-context.test.ts` — Unit tests for prompt builder

### Files Modified

- `src/chat/types.ts` — Add `ReplyContext`, `ReplyOptions`, update `ReplyFn` and `IncomingMessage`
- `src/chat/telegram/index.ts` — Extract and cache reply metadata, build `ReplyContext`, threading support
- `src/chat/mattermost/index.ts` — Extract and cache reply metadata, build `ReplyContext`, threading support
- `src/bot.ts` — Use `buildPromptWithReplyContext()` before calling `processMessage`
- `src/db/schema.ts` — Add `messageMetadata` table
- `src/db/migrations/017_message_metadata.ts` — Database migration

## Consequences

### Positive

- **Context-aware responses**: Bot understands what message the user is replying to
- **Thread continuity**: Bot responses continue the conversation naturally in the correct thread
- **Ambiguity resolution**: "Can you update it?" now references the specific task being discussed
- **Provider-agnostic**: Works consistently across Telegram and Mattermost
- **Bounded resource usage**: 1-week TTL prevents unbounded cache growth
- **Persistence**: Cache survives bot restarts via SQLite
- **Graceful degradation**: Partial chains work when earlier messages are missing

### Negative

- **Cache misses**: Messages sent before bot joined cannot be retrieved
- **Additional complexity**: New infrastructure component to maintain
- **Storage overhead**: SQLite table grows with message volume (mitigated by TTL)
- **API calls for Mattermost**: May need additional API calls to fetch parent posts
- **Memory usage**: In-memory cache adds to runtime memory footprint

### Mitigations

- Graceful handling of missing messages (partial chains)
- Automatic TTL-based eviction
- Background persistence doesn't block message processing
- Fallback to API fetch for Mattermost when parent not cached

## Related Decisions

- **ADR-0014: Multi-Chat Provider Abstraction** — Provider interface supports `ReplyContext` and `ReplyOptions`
- **ADR-0016: Conversation Persistence and Context** — Message cache extends persistence patterns

## Migration Notes

Non-destructive migration adds `message_metadata` table. No data migration needed. Existing behavior preserved for messages without reply context.

Rollback: Table addition is non-destructive. Older code ignores the table if present.

## References

- Design document: `docs/plans/2026-03-26-message-reply-quote-context-design.md`
- Implementation plan: `docs/plans/2026-03-26-message-reply-quote-context-implementation.md`
- Telegram research: `docs/plans/2026-03-26-telegram-chain-history.md`
- Mattermost research: `docs/plans/2026-03-26-mattermost-chain-history.md`
- Telegram infrastructure design: `docs/plans/2026-03-26-telegram-reply-chain-infrastructure-design.md`
- Telegram infrastructure implementation: `docs/plans/2026-03-26-telegram-reply-chain-infrastructure.md`
- Mattermost implementation: `docs/plans/2026-03-26-mattermost-reply-chain-implementation.md`
- Schema: `src/db/schema.ts` (messageMetadata table)
- Migration: `src/db/migrations/017_message_metadata.ts`
