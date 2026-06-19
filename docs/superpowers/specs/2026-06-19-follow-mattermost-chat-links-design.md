<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Follow Mattermost chat links (`fetch_chat_link` tool)

**Status:** Approved design — ready for implementation planning
**Date:** 2026-06-19
**Scope:** Mattermost only (first slice)

## Problem

A user shares a Mattermost permalink with the bot — e.g. _"make a task from this thread
`https://mm.example.com/eng/pl/abc123`"_ — and the bot must follow the link to read the
linked message, or the whole thread, and act on it (create a task, summarize, etc.).

`web_fetch` **cannot** do this. It is strictly anonymous public-web fetch: it rejects URLs
with credentials, blocks private/internal IPs (SSRF guard), and sends no auth. A Mattermost
permalink points at an auth-gated server typically on a private network. Following chat links
is therefore a **separate, platform-API-authenticated capability**.

### Feasibility note (why Mattermost first)

| Platform    | Fetch by link?   | Reason                                                                                                                              |
| ----------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Mattermost  | Yes              | Bot token + REST. Permalink `…/<team>/pl/<postId>` → `GET /posts/<id>` (already used) and `GET /posts/<id>/thread` (not yet wired). |
| Discord     | Likely (future)  | Message links resolvable via discord.js where the bot has access.                                                                   |
| Telegram    | Infeasible       | Bot API has no method to fetch an arbitrary message by link/ID.                                                                     |
| Kontur Talk | Unknown (future) | API not yet investigated.                                                                                                           |

This spec covers **Mattermost only**. The design extracts shared helpers so a later move to a
generalized multi-platform reader is cheap.

## Decisions (locked)

- **Platform:** Mattermost only first.
- **Trigger:** LLM tool only (no auto-detect/prefetch). The model calls the tool when a user
  pastes a permalink and asks the bot to act on it.
- **Granularity:** one tool; a `scope` param chooses single-post vs. full-thread. The LLM
  reasons over the returned content (large threads handled by existing result-compaction).
- **Access model:** verify the **requesting user's** channel membership before returning any
  content (prevents leaking content from channels the bot — but not the user — can see).
- **Return shape:** structured ordered messages `{ author display name, timestamp, text }`
  with the root post flagged **and the linked post flagged**; author IDs resolved to display
  names (deduped/cached).
- **Linked-post handling:** a permalink can point at a thread root _or_ a reply within a thread.
  With `scope: 'thread'` the resolver always returns the **whole** thread (root + all replies),
  and marks which message the link pointed at via a top-level `linkedPostId` + an `isLinked` flag
  — so the model has full context yet still knows the user's specific target. With `scope: 'post'`
  it returns only the linked post, whether that is a root or a reply.
- **Integration approach (B):** a dedicated resolver module + a gated tool, reading instance
  config from the instances store. No `ChatProvider` interface change.
- **Default `scope`:** `'thread'`.
- **Safety cap:** ~100 posts per response, with a `truncated` flag when exceeded.
- **Tool classification:** `domain: 'history'`, `risk: 'open-world'`.

## Flow

```
user pastes permalink + asks → LLM calls fetch_chat_link(url, scope)
  → parse permalink → postId            (identifiers only; never fetch the user URL)
  → load instance config (baseUrl, bot token) for THIS conversation's instance
  → GET /posts/<postId>                  (→ channel_id, root_id)
  → GET /channels/<channel_id>/members/<requesterUserId>   ← membership gate
        not a member → access-denied failure (no content leaked)
  → scope='post'  : return that post (root or reply, as linked)
    scope='thread': GET /posts/<root_id || postId>/thread → whole thread, ordered
  → resolve author ids → display names (deduped/cached)
  → return structured messages (root + linked post flagged)
```

**Key safety property:** the user-supplied URL is **parsed for identifiers only**. All HTTP
goes to the _configured instance `baseUrl`_ with the bot token — never to the host embedded in
the link. This sidesteps SSRF entirely and is the core reason `web_fetch` cannot be reused.

## Files

### New

- `src/chat/mattermost/api-fetch.ts` — `makeMattermostApiFetch(baseUrl, token): MattermostApiFetch`.
  Extracts the closure currently inlined as the provider's private `apiFetch`
  (`src/chat/mattermost/index.ts:288`). The provider is refactored to delegate to it.
  `MattermostApiFetch` is already exported from `file-helpers.ts:20`.
- `src/chat/mattermost/link-resolver.ts` — permalink parsing, REST flow, membership gate,
  identity resolution, output shaping. Dependency-injection friendly (accepts injected
  `apiFetch`/`fetch` for tests).
- `src/tools/fetch-chat-link.ts` — `makeFetchChatLinkTool(...)`: input schema, `execute`
  delegating to the resolver, structured failure results.

### Edited

- `src/tools/types.ts` — add `platformInstanceId?: string` to `MakeToolsOptions`.
- `src/llm-orchestrator-tools.ts` — populate `platformInstanceId` in `getOrCreateDescriptors`
  via `parseScopedContextId(contextId)?.platformInstanceId` (`contextId` already in scope at
  `~:67`).
- `src/tools/provider-independent-tools-builder.ts` — gate + register the tool.
- `src/tools/tool-metadata.ts` — classification entry `fetch_chat_link: { domain: 'history', risk: 'open-world' }`.
- `src/system-prompt.ts` — permission-aware usage hint.

## Tool definition

- **Name:** `fetch_chat_link`
- **Input:** `{ url: string, scope: 'post' | 'thread' = 'thread' }`
- **Gating** (in `provider-independent-tools-builder.ts`): registered only when **all** hold:
  - `storageContextId` present (to derive `platformInstanceId`),
  - `chatUserId` present (required for the membership gate),
  - `getPlatformInstance(platformInstanceId)?.type === 'mattermost'`.
    (`getPlatformInstance` is a cheap indexed SQLite read; tool descriptors are cached.)
- **Classification:** `{ domain: 'history', risk: 'open-world' }`. Under the `read-only` /
  `non-destructive` presets this resolves to **ask**, consistent with `web_fetch`.

## Resolver module

- **Parse:** `…/<team>/pl/<postId>` via `/\/pl\/([a-z0-9]+)/i`. Validate the link host equals the
  instance `baseUrl` host; a cross-server / wrong-instance link → invalid-input failure. _Only
  the `postId` is used downstream._
- **Config:** `getPlatformInstance(platformInstanceId)` → `config.baseUrl`, `config.token`,
  `type` (decrypted by the store). Build `apiFetch = makeMattermostApiFetch(baseUrl, token)`.
- **Post:** `GET /api/v4/posts/<postId>`, parsed by the exported `MattermostPostSchema`
  (`schema.ts:18`) → `channel_id`, `root_id`.
- **Membership gate:** `GET /api/v4/channels/<channel_id>/members/<chatUserId>`. Any non-2xx ⇒
  **access-denied** failure with an identical message whether the channel is missing or the user
  is simply not a member (so existence is never leaked).
- **Fetch:** `scope='post'` → the single linked post (root or reply). `scope='thread'` →
  `GET /api/v4/posts/<root_id || postId>/thread` → `PostList { order, posts }`, the whole thread
  ordered by `order`. The originally linked `postId` is always retained so the matching message
  can be flagged.
- **Identity:** resolve each distinct `user_id` → display name via the existing id→label path
  (reused from `label-helpers` / reply-context), deduped and cached within the call.
- **Output:**
  ```ts
  {
    source: 'mattermost',
    channelId: string,
    rootPostId: string,
    linkedPostId: string,   // the post the permalink pointed at (root or a reply)
    scope: 'post' | 'thread',
    messages: Array<{
      authorId: string,
      author: string,      // display name
      timestamp: string,   // ISO 8601
      text: string,
      isRoot: boolean,     // the thread's root post
      isLinked: boolean,   // the post the permalink pointed at
    }>,
    truncated?: boolean,    // true when the ~100-post cap is hit
  }
  ```
  Oversize results are further handled by the existing result-compaction path.

## Failure results

All via the standard `buildToolFailureResult` wrapper.

| Case                                               | Result                     | Retryable |
| -------------------------------------------------- | -------------------------- | --------- |
| URL not a Mattermost permalink, or host ≠ instance | invalid-input              | no        |
| Requester not a member (or channel not found)      | access-denied — no content | no        |
| Post not found / bot lacks access                  | not-found                  | no        |
| Network / 5xx / timeout                            | transient error            | yes       |

## Logging & usage

The standard tool wrapper records `tool_call_events`. Logs carry `contextId`, `postId`,
`channelId`, `scope`, and outcome — **never** the bot token or message bodies.

## Testing

- **Resolver unit tests** (`setMockFetch`/`restoreFetch`): permalink parse + host validation;
  single post fetch; membership allow vs. deny (assert deny returns no content); single-post
  vs. thread ordering; **link to a reply with `scope: 'thread'` returns the whole thread with
  `isLinked` set on the reply and `linkedPostId` populated**; `isRoot`/`isLinked` coincide when
  the link points at the root; identity dedupe/caching; each failure mapping; the truncation cap.
- **Tool tests:** `schemaValidates()` for the input schema (accept/reject); `getToolExecutor()`
  for execute happy-path + failure shapes.
- **Gating tests:** present for a Mattermost instance with `chatUserId`; absent for non-Mattermost
  instances, missing `chatUserId`, or missing storage context.
- **Provider refactor:** the existing Mattermost provider suite must stay green after the
  `apiFetch` extraction.

## Out of scope (future)

- Discord / Telegram / Kontur Talk support (Telegram's Bot API can't fetch arbitrary messages
  by link).
- Auto-detect / prefetch of links in incoming messages.
- Server-side in-thread filtering (by author / keyword / around-the-linked-post window).
- Relaying file attachments found in fetched posts.
- A generalized provider-agnostic `ChatLinkReader` service (revisit when adding a second platform).
