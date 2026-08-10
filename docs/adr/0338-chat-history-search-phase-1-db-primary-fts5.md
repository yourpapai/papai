<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0338: Chat History Search Phase 1 — DB-Primary Message Cache with FTS5 and Agent Search Tools

## Status

Accepted

## Date

2026-07-26

## Context

papai's LLM agent could not answer questions like "who said we should deploy X?" or "what did we decide last week?" because past chat messages were not queryable. The existing `message_cache` was an **in-memory-primary** `Map` in `src/message-cache/cache.ts` with SQLite as a write-behind replica and a **1-week TTL** (`ONE_WEEK_MS`), expired by two scheduler tasks (`message-cache-sweep`, `message-cleanup`). Caching was also fragmented: Telegram cached in `src/chat/telegram/message-extraction.ts`, Mattermost in `src/chat/mattermost/file-helpers.ts`, and other platforms not at all — so history coverage was platform-dependent and thread-scoped only.

Phase 1 of chat-history search gives the agent on-demand, provider-independent tools (`search_chat_history`, `get_message`, `get_message_context`) over all observed messages, with **group-wide scope** (per the scope model in `src/chat/context-scope.ts`: live conversation state is thread-isolated, but durable assets are group-shared) and **unlimited retention**. The design is in `docs/superpowers/specs/2026-07-26-chat-history-search-phase-1-design.md`; the implementation plan is `docs/superpowers/plans/2026-07-26-chat-history-search-phase-1.md`.

## Decision Drivers

- **SQLite is already the durable store.** `message_metadata` rows survive restarts; the in-memory `Map` was a redundant cache that lost data, required a preload pass (`initializeMessageCache` → `restoreMessagesFromDb`), and duplicated TTL logic between memory and DB.
- **Keyword search needs an index.** FTS5 is already used in-repo by `memos`/`memory_records` (same external-content pattern, same `sanitizeFtsQuery` shape), so it adds no new dependency or infrastructure.
- **Group-wide visibility requires a scope column.** Thread-scoped `context_id` alone cannot express "all threads of this group"; a `group_context_id` column (via `getScopeKey`) encodes the durable-scope tier.
- **Retention is a liability, not a feature, for recall.** The 1-week TTL silently dropped history the agent was expected to recall; unlimited retention plus a super-admin purge endpoint is the honest trade for unbounded growth.
- **Every observed message must be cached on every platform.** Per-platform cache call sites guarantee gaps; caching at the single `bot.ts` chokepoint (`onIncomingMessage`) captures the full observable history. Caching in `handleMessage` was rejected because it returns early for non-mention group messages, which would exclude most group traffic.
- **Scope checks must live at the data layer.** `getMessage`/`searchMessages`/`getMessageContext` take a `MessageScope` (`group | dm`) and enforce it in SQL, so out-of-scope message ids return `not_found` with no existence leak, regardless of how the LLM phrases a query.
- **Never log message text.** All logging is counts/lengths/ids only, consistent with repo logging policy.

## Considered Options

### Option 1 — DB-primary cache + FTS5 external-content index + three tools (chosen)

Rebuild `message_metadata` (migration 070) with `group_context_id`, drop `expires_at`, add an FTS5 external-content virtual table with insert/update/delete triggers and a backfill. `cacheMessage` writes only via persistence; `getCachedMessage` reads from SQLite through a new `store.ts` read layer. One caching chokepoint in `onIncomingMessage`. Three tools wrap `searchMessages` (FTS5 + bm25 ranking), `getMessage` (scope-checked fetch), and `getMessageContext` (temporal/thread/reply_chain window). Expiry infrastructure (scheduler tasks, preload, TTL) is deleted; the debug snapshot's `size` becomes a live DB row count; a super-admin `DELETE` purge endpoint is the growth safety valve.

- **Pros:** single source of truth (no memory/DB divergence, no preload, no sweep); search over unlimited history; uniform coverage across all platforms via one chokepoint; FTS5 reuse keeps ops simple; scope enforcement in SQL is defense-in-depth.
- **Cons:** every `getCachedMessage` (reply-chain walking) is now a DB hit — acceptable for local SQLite; migration 070 rebuilds the table in place (SQLite cannot relax `NOT NULL` on `expires_at`); unbounded growth is a real operational cost mitigated only by manual purge.

### Option 2 — Keep in-memory primary, add search over the Map

Keep the `Map` as the read path and add keyword search by scanning or maintaining an in-memory index, with SQLite unchanged.

- **Pros:** no migration; no DB-read latency on the hot reply-chain path.
- **Cons:** search only covers the current process lifetime and the 1-week TTL window; duplicate TTL/purge logic remains; a second in-memory index duplicates the FTS problem; group-wide queries still need a scope key the Map lacks. Fails the unlimited-retention and durability drivers outright.

### Option 3 — External search engine (Elasticsearch / Meilisearch / vector DB)

Index messages into a dedicated search service for keyword and (later) semantic search.

- **Pros:** better ranking/scale ceiling; natural home for Phase 2 semantic search.
- **Cons:** new infrastructure to deploy, secure, and back up for a bot whose whole data tier is one SQLite file; messages would leave the local DB (privacy surface); massive overkill for per-group corpora. Semantic search was explicitly deferred to Phase 2; FTS5 covers Phase 1 keyword needs.

## Decision

Option 1 shipped, with four documented refinements over the approved spec's literal text (all preserving its intent):

1. **`expires_at` was dropped, not kept nullable.** The spec said "keep the column, write NULL," but the column was `INTEGER NOT NULL` and SQLite cannot relax that without a table rebuild; since the rebuild was needed anyway, migration 070 rebuilds `message_metadata` without the vestigial column.
2. **`getCachedMessage`/`cacheMessage` stay as thin wrappers** in `cache.ts` over `store.ts`, preserving existing import paths and the `mockMessageCache()` test surface so consumer suites stayed green without churn.
3. **Caching lives in `onIncomingMessage`, not `handleMessage`** — `handleMessage` returns early for non-mention group messages and would have excluded most group history; `onIncomingMessage` runs for every allowed observed non-command message.
4. **`buildReplyChain` stays in `chain.ts`** (reading via the now-DB-backed `getCachedMessage`) rather than moving to `store.ts`, preserving import paths.

Concretely:

1. **Migration 070** (`src/db/migrations/070_message_metadata_history_search.ts`): rebuilds `message_metadata` with `group_context_id` and without `expires_at`; creates `message_metadata_fts` (FTS5 external content over `text`), backfills it, and installs `message_metadata_ai/au/ad` sync triggers; adds group-scope and reply-to indexes.
2. **Store read layer** (`src/message-cache/store.ts`): `getMessageByContext` (thread-scoped lookup backing `getCachedMessage` + `buildReplyChain`), `getMessage` (scope-checked), `searchMessages` (FTS5 MATCH with phrase-quoting sanitizer, bm25 ranking, author/contextId/since/until filters), `getMessageContext` (temporal/thread/`reply_chain` modes), and the `MessageScope` discriminated union enforced in `scopeWhere`.
3. **Unified write chokepoint** (`src/bot.ts`): `onIncomingMessage` caches every allowed observed non-command message with `groupContextId` derived via `getScopeKey` for group contexts; legacy Telegram/Mattermost cache call sites were deleted.
4. **Tools** (`src/tools/search-chat-history.ts`, `get-message.ts`, `get-message-context.ts`): factories `makeSearchChatHistoryTool` / `makeGetMessageTool` / `makeGetMessageContextTool` keyed `snake_case`, registered in `provider-independent-tools-builder.ts` under the `history` domain with `read('history')` metadata and `history.search`/`history.fetch`/`history.context` capability tokens; not added to the hardcoded guest allowlist, so guests default off.
5. **Expiry retirement**: `message-cache-sweep`/`message-cleanup` scheduler tasks, `initializeMessageCache` preload, `restoreMessagesFromDb`, `cleanupExpiredMessages`, and `ONE_WEEK_MS` all deleted; `initializeStores` is a no-op; `getMessageCacheSnapshot().size` reports a live DB row count.
6. **Purge endpoint** (`src/debug/settings/admin/message-history-routes.ts`): super-admin-gated `DELETE /settings/api/admin/message-history` (clear all) and `DELETE /settings/api/admin/contexts/<id>/message-history` (one group scope), registered in the settings API router.

## Consequences

### Positive

- The agent can search, fetch, and window the full observed history of its scope on every platform, via three provider-independent tools.
- One source of truth: no memory/DB divergence, no preload at startup, no sweeps to schedule or fail; restart behavior is trivially correct.
- Unlimited retention removes silent history loss; the 1-week TTL and its entire expiry infrastructure (two scheduler tasks, restore/cleanup functions) is gone.
- Scope privacy is enforced in SQL (`scopeWhere` + `MessageScope`), so tool-level bugs cannot leak cross-group or cross-DM messages; out-of-scope fetches return `not_found`.
- FTS5 reuse matches the existing `memos`/`memory_records` pattern — no new dependencies, and the query sanitizer shape is already proven.
- Write coverage became platform-uniform: one chokepoint in `onIncomingMessage` replaced two platform-specific call sites that guaranteed gaps.

### Negative

- `getCachedMessage` is now a synchronous SQLite read on every reply-chain step; cheap locally, but it removed the "free" in-memory hit.
- Unbounded table growth: `message_metadata` and its FTS index grow forever unless an operator purges; there is no automatic retention policy anymore.
- Migration 070 rewrites the table (copy → drop → rename); on a large existing table this is a one-time blocking migration.
- Command messages and messages from disallowed senders are deliberately not cached, so "history" means "allowed observed non-command history" — a subtle contract tool consumers must understand.

### Risks

- FTS query injection via user/LLM-supplied `MATCH` strings is mitigated by phrase-quoting + double-quote escaping in `sanitizeFtsQuery`; any future raw-FTS feature (boolean operators, prefix queries) must revisit this sanitizer.
- `group_context_id` is only written for new rows (existing rows backfill as `NULL`, i.e. DM-scoped semantics), so pre-migration group messages are invisible to group-scope search — accepted as a bounded recall gap that ages out naturally.

## Implementation Notes

- Follow repo conventions: `.js` import extensions, Zod v4 input schemas, Vercel AI SDK `tool()`, pino with counts-only logging, no message text in logs.
- TDD per task (migration → store → expiry retirement → bot chokepoint → tools → purge route); tests live at `tests/db/migrations/070_message_metadata_history_search.test.ts`, `tests/message-cache/store.test.ts`, `tests/tools/{search-chat-history,get-message,get-message-context}.test.ts`, and `tests/debug/settings/admin/message-history-routes.test.ts`.
- The guest toolset is a hardcoded allowlist; the three history tools are simply absent from it, giving guest-default-off without a flag.

## Related Decisions

- ADR-0281: Proactive Message History Recording — the complementary write-side concern (persisting the bot's own proactive sends to `conversation_history`); this ADR covers observed incoming messages in `message_metadata`.
- Phase 2 (semantic search over embeddings) is explicitly deferred; this ADR's `MessageScope`/`SearchFilters` seam is the intended extension point.

## References

- Spec: `docs/superpowers/specs/2026-07-26-chat-history-search-phase-1-design.md`
- Plan: `docs/superpowers/plans/2026-07-26-chat-history-search-phase-1.md`
- Scope model: `src/chat/context-scope.ts`
- Behaviors doc: `docs/architecture/behaviors.md`
