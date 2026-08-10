<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Chat history search, fetch & context lookup — Phase 1

**Date:** 2026-07-26
**Status:** Design approved, pending spec review

## Problem

papai has no general capability for the agent to search past chat messages,
fetch a specific message by id, or read the conversation around a message.

What exists today is narrow:

- The `ChatProvider` interface (`src/chat/types.ts:244-277`) exposes **no**
  message-history read methods — only inbound `onMessage`, outbound
  `sendMessage`, label/admin resolvers, and `renderContext`. No platform
  adapter fetches arbitrary history.
- `lookup_group_history` (`src/tools/lookup-group-history.ts`) only searches
  the **LLM's own cached conversation turns** of the parent group, and only
  from a thread context. It is not platform-message search.
- `message_metadata` already stores observed messages
  (`src/db/schema.ts:170-187`: `messageId, contextId, authorId,
  authorUsername, text, replyToMessageId, timestamp, expiresAt`) with a
  **1-week TTL**, and already powers `getCachedMessage` and `buildReplyChain`
  for incoming-message reply context (`src/reply-context.ts`). But:
  - it has **no search index** (no FTS),
  - it is **not exposed to the agent** as a tool,
  - caching is **uneven** — only Telegram caches every observed message
    (`src/chat/telegram/message-extraction.ts:117`) and Mattermost caches
    only file-bearing messages (`src/chat/mattermost/file-helpers.ts:148`);
    Discord and Kontur Talk do not cache at all,
  - it is **thread-scoped only** (`src/chat/context-scope.ts:43`), so it
    cannot answer group-wide questions,
  - it is **in-memory primary** (`src/message-cache/cache.ts:23,54`) — the
    design assumes the whole working set fits in memory, which holds at one
    week but cannot hold unbounded history.

## Goal

Give the LLM agent on-demand tools to **search** past observed chat messages,
**fetch** a specific message by id, and read the **context around** a message
— built on the existing `message_metadata` store, unified across all
platforms, with group-wide visibility in groups (DM-scoped in DMs) and
unlimited retention.

This is **Phase 1 (FTS5 keyword search)**. A deferred Phase 2 will add a
semantic/embedding layer on top without rework (see "Out of scope").

## Decisions (locked during brainstorm)

| Decision | Choice |
| --- | --- |
| Access pattern | Agent tool (on-demand); the LLM decides when to pull history |
| Data source | Observed cache only — no platform on-demand history fetch |
| Cache coverage | All platforms, unified into one inbound chokepoint |
| Visibility scope | Group-wide in groups (across threads + main), DM-scoped in DMs |
| Retention | Unlimited / no expiry (`message_metadata` becomes a durable store) |
| Search mechanism | FTS5 keyword (Phase 1); semantic hybrid deferred to Phase 2 |

## Non-goals

- **No platform on-demand history fetch.** Discord/Mattermost REST history
  reads are not added. The store contains only messages the bot observed
  arriving. (Telegram bots cannot read arbitrary history regardless.)
- **No semantic/embedding search in Phase 1.** Deferred to Phase 2; the FTS5
  layer is shaped so it slots on without rework.
- **No user-facing `/history` command and no auto-enrichment** of incoming
  messages. Access is agent-tool-only.
- **No message edit/delete detection**, no opportunistic parent-message
  backfill on reply, no true send-time timestamps (only arrival time; see §3).
- **No cross-group search.** Tools bind to the current context's scope.
- **No guest-mode access by default** (reading group history is
  privacy-sensitive; admins may opt in via `tool_prefs`).

## Design

### 1. Architectural shift — DB-primary, unlimited retention

Today `message_cache` is **in-memory primary, DB backup, 1-week TTL**:
`initializeMessageCache` (`src/message-cache/cache.ts:23`) loads every
non-expired row into a `Map` at startup, and `getCachedMessage`
(`src/message-cache/cache.ts:54`) reads only that `Map` (with an in-memory
TTL check at `cache.ts:60`). That model assumes the working set fits in
memory — true at one week, false at unlimited retention.

Phase 1 inverts the layering:

- **`message_metadata` (SQLite) becomes the source of truth** for all reads.
- **The in-memory `Map` is retired.** `getCachedMessage` and `buildReplyChain`
  become DB-backed reads. Local SQLite reads are sub-millisecond, so the hot
  reply-context path (every incoming reply walks the chain via
  `src/reply-context.ts`) is unaffected.
- The exported names `getCachedMessage` / `buildReplyChain` keep their
  signatures so `src/reply-context.ts`, the Telegram/Mattermost reply-context
  helpers, and the participant roster need no edits — only the implementation
  under them changes.
- `initializeMessageCache` (startup restore into memory) is removed.
  `getMessageCacheSnapshot` is either removed or repurposed to report DB row
  counts.

This shift is a necessary, not optional, consequence of the unlimited
retention decision.

### 2. Data model & migration

One new migration, `070_message_metadata_history_search` (next after
`069_alert_matched_task_ids`). Three changes to `message_metadata`:

1. **Add `group_context_id TEXT` (nullable)** + index
   `idx_message_metadata_group_ctx`. Populated for every group-context row
   via the same `getScopeKey('group', …)` derivation the attachments table
   uses; `NULL` for DM rows. Enables group-wide visibility.
2. **Make `expires_at` nullable; stop enforcing expiry.** Keep the column
   (avoids a destructive migration). New rows write `NULL`; backfill existing
   rows to `NULL`. Remove `cleanupExpiredMessages`
   (`src/message-cache/persistence.ts:93`) and `sweepExpiredMessages`
   (`src/message-cache/cache.ts`) from the scheduler. Retire `ONE_WEEK_MS`
   (`src/message-cache/types.ts:7`) from the read path.
3. **Add the FTS5 external-content table**, mirroring `018_memos` and
   `053_long_term_memory`:

   ```sql
   CREATE VIRTUAL TABLE message_metadata_fts USING fts5(
     text, content='message_metadata', content_rowid='rowid'
   );
   ```

   Standard FTS5 external-content sync **triggers** (`AFTER INSERT`, `AFTER
   DELETE`, `AFTER UPDATE`) keep the FTS table in sync, including for ad-hoc
   DB writes. Existing rows are backfilled into the FTS table during the
   migration. Only `text` is indexed; author/timestamp/thread filter through
   the content-table columns, not the FTS index.

### 3. Caching unification — one inbound chokepoint

Replace the two scattered `cacheMessage` call sites
(`src/chat/telegram/message-extraction.ts:117`,
`src/chat/mattermost/file-helpers.ts:148`) with a **single call in the shared
inbound path** — `src/bot.ts`, in the normal (non-command) message handler,
after authorization and once the thread-scoped `storageContextId` is
resolved. Both legacy call sites become dead code and are removed (dedup).

Per observed `IncomingMessage`, the call writes:

| field | source |
| --- | --- |
| `messageId` | `msg.messageId` |
| `contextId` | thread-scoped `storageContextId` (matches existing scope model) |
| `group_context_id` | `getScopeKey('group', { storageContextId, chatUserId, contextType })` for groups; `NULL` for DMs |
| `authorId` / `authorUsername` | `msg.user.id` / `msg.user.username` |
| `text` | `msg.text` |
| `replyToMessageId` | `msg.replyToMessageId` |
| `timestamp` | `Date.now()` (arrival time) |

The FTS triggers update the search index on the same write, so indexing is
free.

**Not cached (intentional):**

- **Command messages** (`/config`, `/stop`, …). They take the command path
  and may carry sensitive content (auth codes). Only conversational messages
  reaching the LLM queue become history.
- **Interactions** (button callbacks). They are not chat messages.

**Scope resolution at query time** (shared by all three tools):

- **DM** → `WHERE group_context_id IS NULL AND context_id = ?`.
- **Group** → `WHERE group_context_id = ?` (the group's config-context id,
  resolved from the current thread-scoped `storageContextId` via the same
  `getScopeKey` derivation used at write time — keeping write/read scope
  symmetric, no skew).

**Edge cases baked in:**

- Missing `messageId` → skip caching (no throw).
- **Arrival-time timestamps**: adapters do not uniformly expose original send
  time in `IncomingMessage`. Arrival time is consistent across platforms and
  monotonic, so FTS ranking and context-window ordering use it. True send
  times are a later `IncomingMessage` extension.
- Re-arrivals with the same `(contextId, messageId)` PK upsert via the
  existing `onConflictDoUpdate` (`src/message-cache/persistence.ts:61`).
  Message **edits** are not detected (no edit events wired) — noted as a
  follow-up.

### 4. Read layer — new `src/message-cache/store.ts`

`chain.ts` and the retired in-memory `Map` collapse into a new
`store.ts` of DB-backed reads. Every query carries the caller's scope
(`group_context_id` for groups, `context_id` for DMs), so **no cross-context
leakage is possible at the data layer**. Functions:

- `getMessage(scope, messageId)` — single fetch, scope-checked.
- `searchMessages(scope, query, { author?, contextId?, since?, until? }, limit)`
  — FTS5 `MATCH` against `message_metadata_fts`, sanitized as `keywordSearchMemos`
  does (escape FTS5 special chars; fall back to prefix token), scope + filters
  applied on the content-table columns, ranked by `bm25()`, `LIMIT n`. The
  optional `contextId` filter narrows to one thread-scoped context within the
  group.
- `getMessageContext(scope, messageId, before, after, mode)` — temporal /
  thread / reply-chain window (see §5 tool).
- `buildReplyChain(contextId, messageId)` — moved here from `chain.ts`,
  DB-backed, same return shape (`{ chain, isComplete, brokenAt }`) and
  cycle-detection semantics.

### 5. Tools — three, registered provider-independently

Registered in `src/tools/provider-independent-tools-builder.ts` alongside
`lookup_group_history`, available in **both DM and group** (unlike
`lookup_group_history`, which is thread-in-group-only).

1. **`search_chat_history`**
   - Input: `query: string`, `limit?: int (default 5, max 20)`, `author?:
     string`, `since?: ISO8601`, `until?: ISO8601`, `contextId?: string`
     (narrow to one thread-scoped context within the group — e.g. a value
     returned in a prior result).
   - Output: `{ results: [{ messageId, authorUsername, text, timestamp,
     contextId, replyToMessageId? }], total, mode: 'keyword' }` (echoes
     `search_memos`' shape; `contextId` is the thread-scoped storage id on
     each row, which distinguishes threads within a group).
2. **`get_message`**
   - Input: `messageId: string`.
   - Output: the message, or `{ not_found: true }`. Out-of-scope IDs return
     `not_found` (no existence leak).
3. **`get_message_context`**
   - Input: `messageId: string`, `before?: int (default 5)`, `after?: int
     (default 5)`, `mode?: 'temporal' | 'thread' | 'reply_chain' (default
     'temporal')`.
   - Output: `{ target, before: [...], after: [...], replyChain?: [...] }`.
     `temporal` = N messages each side by timestamp within scope; `thread` =
     same `context_id`; `reply_chain` = reuses `buildReplyChain`.

`get_message` and `get_message_context` are kept separate rather than folding
a window into `get_message` — distinct intents ("fetch this exact one" vs
"show the conversation around it") matching the original request.

Oversized result sets are handled by the existing `wrap-compaction` layer +
`expand_result` pager (`provider-independent-tools-builder.ts` registers
`expand_result` in `normal` mode); no special truncation logic in the new
tools.

### 6. Gating, permissions, privacy

- **Scope**: tools bind to the current `storageContextId`; data-layer scope
  checks are the backstop. No cross-group access.
- **Domain/risk** (`src/tools/tool-metadata.ts`): reuse the `history` domain
  (`read('history')`, same as `lookup_group_history` at `tool-metadata.ts:172`)
  → default-allow, low-risk. `src/tools/core-capabilities.ts` gets parallel
  tokens (`history.search` / `history.fetch` / `history.context`) alongside
  `history.lookup` (`core-capabilities.ts:81`).
- **Guest mode**: **not** in the guest read-only toolset by default. Admins
  may opt in via `tool_prefs`. Conservative default; easily relaxed later.
- **Privacy**: `message_metadata` holds raw chat text (PII-sensitive). It is
  exposed only within the same scope to the agent serving that context;
  `/stats` already aggregates it anonymity-compliantly
  (`src/stats/per-table-content.ts:61`, byte sizes/counts only — never
  content). No new external egress — search is local SQLite.

### 7. Retention, purge, observability

- The expiry sweep is removed (§2). `message_metadata` retains indefinitely.
- **Admin purge path (minimal, included):** a super-admin
  `POST /settings/api/admin/contexts/:id/message-history` (and a `clear-all`
  variant) deletes rows for a scope — a safety valve for unbounded growth.
  No user-facing purge in Phase 1.
- **Growth is already observable**: `/stats` surfaces
  `messageMetadataPerSubject` / `messageMetadataForSubject`, so growth needs
  no new instrumentation.

### 8. Error handling & logging

- Empty/missing → `search` returns `{ results: [], total: 0, mode: 'keyword'
  }`; `get_message` / `get_message_context` return `{ not_found: true }`.
  Out-of-scope IDs return `not_found` (no existence leak).
- Malformed FTS5 `MATCH` → catch, fall back to sanitized literal/prefix
  query (mirror `keywordSearchMemos`). Never throws to the LLM;
  `wrapToolExecution` normalizes regardless.
- DB failures → structured tool-failure result + `error`-level pino log.
- **Logging discipline**: `debug` entry/params, `info` success with
  counts/lengths only, `warn` on empty/blocked, `error` on DB failures.
  **Never log message text** — consistent with the `/stats` anonymity
  contract.

## Testing

TDD per `tests/CLAUDE.md` and the write-hook pipeline.

- **`store.ts` unit tests**: search with filters + `bm25` ranking; scope
  isolation (context A cannot see context B's messages); context-window
  boundary edges (before/after counts, mode variants); reply-chain cycle
  detection on DB reads.
- **Tool tests** (`schemaValidates` / `getToolExecutor` from
  `tests/utils/test-helpers.ts`): each tool's scope enforcement, not_found /
  empty paths, limit clamping, FTS fallback on malformed input.
- **Migration test**: FTS backfilled from existing rows; `group_context_id`
  derivation matches `getScopeKey` for groups and is `NULL` for DMs.
- **Integration**: cache via the `bot.ts` path → `search_chat_history`
  returns the message; cross-context isolation end-to-end; an incoming reply
  still produces the same reply-context chain (regression — read path is now
  DB-backed).
- Existing reply-context tests stay green (signatures unchanged).

## Constraints respected

- `message_metadata` is thread-scoped typed-column SQLite
  (`src/db/schema.ts:170-187`); no crypto plumbing needed.
- Write/read scope use the same `getScopeKey('group', …)` derivation,
  matching the attachments precedent and `ENTITY_SCOPES`
  (`src/chat/context-scope.ts`).
- FTS5 is already proven in-repo (`018_memos`, `053_long_term_memory`); the
  hybrid semantic pattern is already proven in `search_memos` and
  long-term-memory's recall cascade — de-risking both this phase and Phase 2.
- The `/stats` anonymity contract is preserved (content never leaves the
  scope-local agent surface; stats remain aggregate-only).

## Out of scope / follow-ups (later phases)

- **Phase 2 — semantic/embedding search (Approach B).** Add an embedding
  column + async embedding-writer per cached message + cosine-similarity
  search + "auto" cascade, mirroring `search_memos`. Slots onto the FTS5
  layer with no rework. Gets its own spec → plan → implementation cycle.
- **Platform on-demand history backfill** (Discord/Mattermost REST) — the
  deferred "Hybrid" data-source option.
- **User-facing `/history` command & auto-enrichment** of incoming messages.
- **Opportunistic parent-message backfill** on reply; **message edit/delete
  detection**; **true send-time timestamps**; cross-group search.
