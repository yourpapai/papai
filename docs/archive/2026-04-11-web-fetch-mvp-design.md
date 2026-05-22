<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Web Fetch MVP Design

**Date:** 2026-04-11  
**Status:** Proposed  
**Scope:** Generic public-URL fetch as an LLM tool for same-turn memo/task enrichment

**Relationship to older docs:** This design sits alongside `docs/superpowers/specs/2026-04-08-web-fetch-design.md` and `docs/research/web-fetch-research.md`. Those April documents remain intact as the broader exploration and longer-term direction. This document narrows the first implementation slice to a clean MVP that is small enough to plan and ship safely.

## Problem Statement

papai still has no URL-aware tool, so when a user shares a link and asks for a
memo, task, or summary, the model cannot read the referenced page directly.

The April web-fetch documents explored a much broader design: multiple host
adapters, a hosted fallback path, automatic memory integration, extra config
surface, and a large initial implementation footprint. That broader design is
useful research, but it is too wide to treat as the first implementation slice.

The MVP needs to solve the core user-visible problem first:

1. The model can fetch a public URL safely.
2. The fetched result is clean and bounded enough for the model to use in the
   same turn.
3. Durable storage happens only through existing explicit tools such as
   `save_memo` and `create_task`.

## Goals

1. Add a `web_fetch` tool that the model can call when the user shares a public
   URL or refers back to one already present in conversation history.
2. Support generic `text/html`, `text/plain`, `text/markdown`, and
   `application/pdf` inputs in MVP.
3. Return a structured, bounded result that the model can use immediately for
   memo creation, task creation, or direct answers.
4. Keep the fetch path safe by default: public web only, no private-network or
   localhost access, bounded redirects, bounded size, bounded time.
5. Align with the current codebase shape, especially:
   - `makeTools()` now delegates to `src/tools/tools-builder.ts`
   - config keys are centrally typed in `src/types/config.ts`
   - system prompt construction lives in `src/system-prompt.ts`
6. Keep the first implementation slice small enough for focused TDD and local
   integration testing.

## Non-Goals

- Host-specific adapters in MVP.
- Hosted extraction fallback such as Jina Reader in MVP.
- Automatic URL preprocessing or URL-hint injection in MVP.
- Automatic long-term-memory writes from `web_fetch` in MVP.
- Crawling, search, or multi-page retrieval.
- Authenticated fetches using user cookies or tokens.
- New user-facing config keys in MVP.

## Current Reality in the Codebase

| Area                  | Current reality                                                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tool assembly         | `src/tools/index.ts` forwards to `buildTools()` in `src/tools/tools-builder.ts`.                                                                      |
| Context scoping       | The runtime distinguishes `storageContextId` from `chatUserId`; group chats share config/history context while still preserving the acting chat user. |
| Prompt wiring         | `buildSystemPrompt()` lives in `src/system-prompt.ts`, not in `llm-orchestrator.ts`.                                                                  |
| Config                | `small_model` exists today, but it is optional. Config keys are typed in `src/types/config.ts`.                                                       |
| Memory facts          | `src/memory.ts` currently persists compact facts shaped like `{ identifier, title, url }`. There is no richer fetched-content schema today.           |
| Existing fetch helper | `llm-orchestrator.ts` uses `fetchWithoutTimeout` for model-provider calls, but there is no reusable safe public-web fetch subsystem yet.              |
| Persistence           | Database tables are defined in `src/db/schema.ts` and created through numbered migrations under `src/db/migrations/`.                                 |

## MVP Design

### 1. User-visible behavior

The MVP adds a single `web_fetch` tool. The model uses it when:

- the user explicitly shares a public URL and asks about its contents, or
- the user refers back to a previously shared URL and the model needs the page
  contents to complete the request.

The tool does not persist anything by itself. Its output is an intermediate
artifact for the current reasoning chain. If the user wants a memo or task, the
model follows `web_fetch` with the existing `save_memo`, `create_task`, or
`update_task` tool calls.

That preserves the original intent of the feature: web fetch enriches the
current workflow; it is not an automatic background memory writer.

### 2. Tool registration and scoping

Add a new tool factory:

```ts
export function makeWebFetchTool(storageContextId: string, actorUserId?: string): ToolSet[string]
```

This split is intentional:

- `storageContextId` is used for config lookup and model selection because that
  is how the current runtime scopes configuration.
- `actorUserId` is used for per-actor rate limiting. In DMs it matches the
  storage context. In groups it remains the real acting user even when the
  storage context is the group or thread.

Register the tool from `src/tools/tools-builder.ts` so it follows the current
tool construction path instead of the older direct wiring shown in the April
design.

The tool is independent of the task provider capability surface, so it does not
need provider gating.

### 3. Runtime pipeline

The runtime path is:

1. `web_fetch` tool receives `{ url, goal? }`.
2. Validate the URL shape and enforce the per-actor rate limit.
3. Normalize the URL and check the fetch cache.
4. If there is no fresh cache hit, perform a safe public-web fetch.
5. Extract readable content from generic HTML/text/markdown or PDF.
6. If the extracted body is already small enough, return it directly.
7. If it is too large, distill it using:
   - `small_model` when configured
   - otherwise the existing `main_model`, per explicit product choice for MVP
8. Return a structured result to the model.

### 4. Result shape

```ts
type WebFetchResult = {
  url: string
  title: string
  summary: string
  excerpt: string
  truncated: boolean
  contentType: string
  source: 'cache' | 'fetch'
  fetchedAt: number
}
```

Design notes:

- `url` is the final URL after redirects.
- `summary` is the concise downstream input for memo/task creation.
- `excerpt` is bounded and suitable for direct quotation or follow-up reasoning.
- `truncated` tells the model whether it received a distilled or clipped view.
- `source` stays simple in MVP because there are no adapters or hosted fallback
  paths yet.

### 5. File layout

```text
src/
├── tools/
│   └── web-fetch.ts
├── web/
│   ├── fetch-extract.ts
│   ├── safe-fetch.ts
│   ├── extract.ts
│   ├── pdf.ts
│   ├── distill.ts
│   ├── cache.ts
│   ├── url-normalize.ts
│   └── rate-limit.ts
```

Minimum responsibilities:

| Module                 | Responsibility                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------- |
| `tools/web-fetch.ts`   | Vercel AI SDK wrapper, input schema, logging, error surfacing                         |
| `web/fetch-extract.ts` | Top-level orchestration of cache, fetch, extraction, and distillation                 |
| `web/safe-fetch.ts`    | Public-web-only fetch wrapper with SSRF, redirect, timeout, size, and header controls |
| `web/extract.ts`       | Generic HTML/text/markdown extraction                                                 |
| `web/pdf.ts`           | PDF text extraction                                                                   |
| `web/distill.ts`       | Optional model-based shrinking of large content                                       |
| `web/cache.ts`         | Normalized URL cache persistence and lookup                                           |
| `web/url-normalize.ts` | Canonicalization for cache keys                                                       |
| `web/rate-limit.ts`    | Per-actor request limiting                                                            |

### 6. Extraction and distillation rules

#### Generic extraction

The MVP handles only generic formats:

- `text/html` / `application/xhtml+xml` -> `defuddle` + `linkedom`, then
  `turndown` to clean markdown
- `text/plain` / `text/markdown` -> pass through with minimal normalization
- `application/pdf` -> `unpdf`, then normalize to plain markdown text

No host-specific rewriting is part of MVP.

#### Bounded output

Use deterministic size bounds in characters, not fuzzy token estimates, so the
tool behavior is explicit and testable:

- if extracted content is `<= 8_000` characters, return it directly
- otherwise distill it to:
  - a 1-3 sentence summary
  - an excerpt no longer than `8_000` characters

When `small_model` is configured, use it for distillation. When it is not
configured, fall back to `main_model` rather than failing or introducing a new
setup requirement.

## Storage and Configuration

### Database tables

Add two new tables via migration:

1. `web_cache`
2. `web_rate_limit`

The cache is global and keyed by normalized public URL, because MVP only fetches
anonymous public content. The rate-limit table is actor-scoped.

### Cache shape

The cache row stores:

- normalized URL hash
- original URL
- final URL
- title
- summary
- excerpt
- `truncated`
- `content_type`
- `fetched_at`
- `expires_at`

Use a default TTL of `15 minutes` in MVP. Full `ETag` / `Last-Modified`
revalidation is deferred; the first slice should use simple time-based expiry so
the implementation stays focused.

### Rate limiting

Use a simple, explicit fixed-window counter instead of calling it a token bucket
when it is not one. Use `20 fetches / 5 minutes / actor`.

That keeps the behavior easy to reason about and easy to test in SQLite.

### Config surface

Do not add new user-facing config keys in MVP.

Existing config is sufficient:

- `llm_apikey`
- `llm_baseurl`
- `main_model`
- optional `small_model`

This keeps `/config`, `/setup`, `CONFIG_KEYS`, and related command UX unchanged
for the first slice.

## Security Model

The MVP still ships the full safety boundary for the fetch path:

1. Allow only `http` and `https`.
2. Reject loopback, RFC1918/private, link-local, and cloud-metadata targets.
3. Handle redirects manually and re-validate each hop.
4. Enforce bounded response size with streamed counting rather than trusting
   `Content-Length` (`2 MB` for text-like responses, `10 MB` for PDFs).
5. Enforce bounded total time (`30 s`) and propagate aborts.
6. Send only minimal headers such as `User-Agent` and `Accept`.
7. Accept only the supported content types for MVP.
8. Keep logs free of headers, bodies, and conversation content.

Use an SSRF guard library rather than hand-rolling DNS and IP checks. The
research recommendation, still valid for MVP, is `ssrf-agent-guard`.

This is the core engineering risk in the feature. Adapters and fallbacks are
deferred, but the safety boundary is not.

## Error Model

The April design was right to require specific user-facing fetch failures, but
the implementation details need to match the current error architecture.

For MVP, add a dedicated `WebFetchError` branch to `AppError`:

```ts
type WebFetchError =
  | { type: 'web-fetch'; code: 'invalid-url' }
  | { type: 'web-fetch'; code: 'blocked-host' }
  | { type: 'web-fetch'; code: 'blocked-content-type' }
  | { type: 'web-fetch'; code: 'too-large' }
  | { type: 'web-fetch'; code: 'timeout' }
  | { type: 'web-fetch'; code: 'rate-limited' }
  | { type: 'web-fetch'; code: 'extract-failed' }
  | { type: 'web-fetch'; code: 'upstream-error'; status?: number }
```

This stays consistent with the repo's existing typed-error pattern and avoids
hiding fetch-specific behavior inside generic system errors.

The MVP should preserve these specific user-facing outcomes:

- invalid URL
- blocked host
- blocked content type
- too large
- timeout
- rate limited
- extraction failed
- upstream fetch failure

Each error should map cleanly through `getUserMessage()`.

## LLM Integration

### System prompt

Update `src/system-prompt.ts` with a short stable instruction telling the model
to use `web_fetch` when a user shares or refers to a public URL and it needs the
page contents to answer correctly.

Because `buildSystemPrompt()` does not receive the actual tool set, the prompt
change should be written to match the shipped product state rather than relying
on a conditional "if tool is present" hook.

### Conversation and memory

No new automatic long-term-memory integration is part of MVP.

- tool calls/results already flow through normal conversation history
- fetched summaries become durable only if the model explicitly writes them into
  a memo or task through existing tools
- `src/memory.ts` and `memory_facts` stay unchanged in MVP

## Testing Strategy

Use the cheapest boundary that proves the feature.

### Unit tests

- `tools/web-fetch`
- `web/url-normalize`
- `web/rate-limit`
- `web/cache`
- `web/safe-fetch`
- `web/extract`
- `web/pdf`
- `web/distill`
- `web/fetch-extract`

### Integration tests

Use local `Bun.serve` fixtures rather than public internet tests to cover:

- safe fetch happy path
- redirect validation
- blocked host behavior
- oversize rejection
- HTML extraction
- PDF extraction
- cache hit behavior
- distillation path for large content

### E2E

No dedicated `tests/e2e/` coverage is required for MVP by default. The first
implementation slice does not need a larger provider-real or platform-real E2E
boundary unless later implementation details introduce one.

## Deferred Follow-ons

These remain valid future work, but they are not v1 commitments:

1. Host-specific adapters such as GitHub PR, arXiv rewrite, Reddit, Wikipedia,
   Hacker News, and YouTube.
2. Hosted fallback extraction such as Jina Reader.
3. URL-detection hints or preprocessing before the model decides to call the
   tool.
4. Automatic fetched-content persistence into long-term memory.
5. User-facing toggles or policy config such as `web_fetch_enabled` or hosted
   fallback credentials.
6. Stronger cache revalidation and richer cache observability.

Those items are still represented by the April research and broad design docs.
This MVP design intentionally does not discard them; it simply removes them from
the first implementation commitment.

## References

- `docs/superpowers/specs/2026-04-08-web-fetch-design.md`
- `docs/research/web-fetch-research.md`
- `src/tools/index.ts`
- `src/tools/tools-builder.ts`
- `src/tools/types.ts`
- `src/system-prompt.ts`
- `src/config.ts`
- `src/types/config.ts`
- `src/memory.ts`
- `src/types/memory.ts`
- `src/db/schema.ts`
