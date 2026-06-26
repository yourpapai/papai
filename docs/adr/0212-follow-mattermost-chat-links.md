<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0212: Follow Mattermost Chat Links

## Status

Implemented

## Date

2026-06-19

## Context

When a user shares a Mattermost permalink with the bot — e.g. _"make a task from this thread `https://mm.example.com/eng/pl/abc123`"_ — the bot must follow the link, read the linked message (or its whole thread), and act on it. `web_fetch` cannot do this: it is strictly anonymous public-web fetch, rejects credential-bearing URLs, blocks private/internal IPs as an SSRF guard, and sends no auth. A Mattermost permalink points at an auth-gated server, typically on a private network, so following chat links is a **separate, platform-API-authenticated capability**.

The 2026-06-19 design (`docs/superpowers/specs/2026-06-19-follow-mattermost-chat-links-design.md`) scoped this to **Mattermost only** (the only platform where the bot token + REST can resolve a permalink; Telegram's Bot API has no method to fetch an arbitrary message by link). The design extracted a shared authenticated-fetch helper so a later move to a generalized multi-platform reader is cheap, and locked an LLM-only trigger (no auto-detect/prefetch), a `scope` param (`post` | `thread`, default `thread`), a per-requester channel-membership gate, structured name-resolved output, a 100-post safety cap, and `open-world`/`history` tool classification.

The implementation plan (`docs/superpowers/plans/2026-06-19-follow-mattermost-chat-links.md`) decomposed the work into ten TDD tasks and recorded one intentional deviation from the spec: the spec's edits to `src/tools/types.ts` (add `platformInstanceId`) and `src/llm-orchestrator-tools.ts` were dropped because `platformInstanceId` is derivable from the scoped `contextId` via `parseScopedContextId` directly inside the tool builder, so gating lives entirely in `provider-independent-tools-builder.ts`.

## Decision Drivers

- **SSRF safety**: the user-supplied URL must never be fetched; only its post id is extracted, and all HTTP goes to the configured instance `baseUrl` with the bot token.
- **Authorization fidelity**: content must not leak from channels the bot — but not the requesting user — can see; the requester's access is verified before any content is returned.
- **No `ChatProvider` interface change**: keep the new capability inside the Mattermost module + tool layer; avoid speculative generality while only one platform is feasible.
- **Reuse over duplication**: the provider's inlined authenticated fetch should be extracted once and shared by the provider and the resolver.
- **Consistency with the tool-permission model**: the tool must flow through the existing capability/context gating and `open-world` risk presets like `web_fetch`.

## Considered Options

### Option A — Reuse `web_fetch`

- **Pros:** zero new code; already rate-limited, cached, and SSRF-guarded.
- **Cons:** rejects credentials, blocks private IPs, sends no auth; cannot reach an auth-gated Mattermost on a private network. Fundamentally the wrong trust domain.

### Option B — Dedicated resolver module + gated LLM tool (chosen)

- **Pros:** SSRF surface stays empty (URL parsed for identifiers only); per-requester membership gate; structured, name-resolved output; reusable `makeMattermostApiFetch`; no provider-interface change.
- **Cons:** more code; Mattermost-only first; extra REST round-trips per call.

### Option C — Extend `ChatProvider` with a `resolveChatLink` capability

- **Pros:** provider-agnostic from the start; uniform gating surface.
- **Cons:** speculative generality — only Mattermost is feasible today (Telegram can't fetch by link); forces every adapter to stub; larger blast radius across the chat layer.

## Decision

Adopt **Option B**: a dedicated Mattermost resolver module plus a capability-gated `fetch_chat_link` LLM tool, reading instance config from the instances store. No `ChatProvider` interface change.

### Key choices

- **Parse, don't fetch.** `parseMattermostPermalink(url, baseUrl)` returns the post id only when the link's host equals the instance `baseUrl` host and the path is `/pl/<postId>`; otherwise `null` (→ `invalid-input`). The URL is never fetched.
- **Authenticated fetch extracted.** `makeMattermostApiFetch(baseUrl, token)` (`src/chat/mattermost/api-fetch.ts`) builds the authenticated REST closure and throws a status-carrying `MattermostApiError`; the provider is refactored to delegate to it.
- **Per-requester access gate.** `assertRequesterAccess` checks the requester's explicit channel membership (`GET /channels/<id>/members/<requesterUserId>`); 403/404 mean no membership, while 429/5xx are classified as transient errors rather than masked as denials. A non-member is still allowed through when the channel is public (`type === 'O'`), mirroring Mattermost's `read_public_channels` model; otherwise the denial is `accessDenied` — never framed as the bot lacking access.
- **Post vs. thread.** `scope: 'post'` returns the single linked post (root or reply); `scope: 'thread'` fetches `GET /posts/<root_id||postId>/thread`, orders by `create_at`, and caps at `MAX_THREAD_POSTS = 100` with a `truncated` flag. The linked post is always retained and flagged via `linkedPostId` + `isLinked`; the root via `isRoot`.
- **Identity resolution.** `resolveAuthorLabels` resolves each distinct `user_id` → display name via the existing `resolveMattermostUserLabel`, deduped within the call and bounded by `p-limit(5)`.
- **Failure mapping.** `ChatLinkError` carries an `AppError`: foreign host / non-permalink → `invalid-input`; post 403/404 → `notFound`; membership denial → `accessDenied`; 429 → `rateLimited`; other → `networkError`. Consumed by the standard `buildToolFailureResult` wrapper.
- **Tool surface.** `makeFetchChatLinkTool(platformInstanceId, requesterUserId, deps)` (`src/tools/fetch-chat-link.ts`) is a thin AI SDK `tool()` over the resolver with DI for tests; input `{ url, scope = 'thread' }`.
- **Gating + classification.** `addFetchChatLinkTool` (`src/tools/provider-independent-tools-builder.ts`) registers the tool only when `chatUserId` and a scoped `contextId` are present and `getPlatformInstance(parseScopedContextId(contextId).platformInstanceId).type === 'mattermost'`. Classified `fetch_chat_link: { domain: 'history', operation: 'read', risk: 'open-world' }` (`src/tools/tool-metadata.ts`), so it lands in `ask` under the `read-only`/`non-destructive` presets, consistent with `web_fetch`.
- **System prompt + live status.** A permission-aware `CHAT_LINK` fragment (`src/system-prompt.ts`) appears only when `fetch_chat_link` is enabled; a `fetch_chat_link` live-status label (`src/live-status/tool-status-labels.ts`) shows the link host during the fetch.

## Consequences

### Positive

- Users can paste a permalink and ask the bot to act on the linked message or thread; structured, name-resolved output feeds task creation and summarization.
- SSRF is sidestepped: the user URL is parsed for identifiers only and all HTTP targets the configured instance `baseUrl` with the bot token.
- The per-requester access gate prevents leaking content from channels the bot — but not the user — can see; the public-channel carve-out matches Mattermost's own read model.
- `makeMattermostApiFetch` is shared by the provider and the resolver; `MattermostApiError`'s status enables precise failure classification.
- The 100-post cap + `truncated` flag bound the response; existing result-compaction handles oversize results.

### Negative

- **Mattermost-only.** Discord/Telegram/Kontur Talk users get no equivalent (Telegram's Bot API cannot fetch an arbitrary message by link); the generalized `ChatLinkReader` is deferred.
- **Extra REST round-trips per call** (post → membership → optional thread → N user lookups), bounded by `p-limit(5)` but still latency on large threads.
- **Identity resolution is per-call** (no cross-call cache); a thread with many distinct authors issues up to N user-lookup calls.

### Risks

- **Public-channel refinement widens access** to any `O`-type channel in the workspace; if a workspace treats `O`-type channels as restricted this could surface content the requester shouldn't see. Mitigated by mirroring Mattermost's `read_public_channels` model, but it is an implementation addition beyond the spec's failure table.
- **Bot-token trust.** The bot token performs the fetch; the membership gate is the only guard that the requester is authorized. A misconfigured or over-permissioned bot token could expose channels if the gate were bypassed.

## Related Decisions

- ADR-0063: Web Fetch MVP — the SSRF-guarded anonymous public-web fetch this tool deliberately does **not** reuse.
- ADR-0014: Multi-Chat Provider Abstraction — the chat provider model; the resolver reads through the instances store rather than extending the `ChatProvider` interface.
- ADR-0163: Mattermost Mention-Prefixed Command Syntax — the Mattermost adapter boundary this work builds alongside.
- ADR-0119: File Attachments Implementation — the durable attachment workspace and file-to-task relay this parallels (structured content → task).

## Implementation Notes

Key files (confirmed present):

- `src/chat/mattermost/api-fetch.ts` — `makeMattermostApiFetch(baseUrl, token)` + `MattermostApiError` (status-carrying); the provider delegates its private `apiFetch` to it.
- `src/chat/mattermost/link-resolver.ts` — `parseMattermostPermalink`, `resolveChatLink`, `ChatLinkError`, `MAX_THREAD_POSTS = 100`, `fetchThreadPosts`, `resolveAuthorLabels` (`p-limit(5)`), `assertRequesterAccess` (membership + open-channel).
- `src/chat/mattermost/schema.ts` — `MattermostThreadPostSchema` (extends `MattermostPostSchema` with `create_at`) and `MattermostPostListSchema` (`{ order, posts }`); `ChannelInfoSchema` is reused for the open-channel check.
- `src/tools/fetch-chat-link.ts` — `makeFetchChatLinkTool(platformInstanceId, requesterUserId, deps)`; AI SDK `tool()` with DI for the resolver.
- `src/tools/tool-metadata.ts:173` — `fetch_chat_link: { domain: 'history', operation: 'read', risk: 'open-world' }`.
- `src/tools/provider-independent-tools-builder.ts` — `addFetchChatLinkTool` gates on `chatUserId` + `parseScopedContextId(contextId)` + `getPlatformInstance(...).type === 'mattermost'`.
- `src/system-prompt.ts` — `CHAT_LINK` fragment, `requiredTools: ['fetch_chat_link']`.
- `src/live-status/tool-status-labels.ts` — `fetch_chat_link` live-status label (added beyond the plan/spec, consistent with the live-status system).

Divergences from the plan/spec:

- **Dropped spec edits** (intentional, noted in the plan): `src/tools/types.ts` and `src/llm-orchestrator-tools.ts` are unchanged; `platformInstanceId` is derived via `parseScopedContextId` in the builder.
- **Open-channel public-access refinement** (implementation addition): `assertRequesterAccess` allows a non-member requester through when the channel is public (`type === 'O'`), and classifies transient membership-probe errors (429/5xx) rather than masking them as denials. The spec's failure table had no public-channel carve-out; the shipped denial uses `accessDenied` (matching the spec table), while the plan's intermediate Task 4 used `notFound`.
- **Live-status label** added for `fetch_chat_link` (not in the plan/spec).
