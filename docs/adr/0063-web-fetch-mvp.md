<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0063: Web Fetch MVP — Safe Public-URL Tool for LLM Enrichment

## Status

Accepted

## Date

2026-04-11

## Context

papai has no URL-aware tool. When a user shares a link and asks for a memo, task, or summary, the model cannot read the referenced page. Users must copy-paste content manually, breaking the conversational workflow.

Earlier research (`docs/research/web-fetch-research.md`) explored a broad web-fetch design with host-specific adapters, hosted fallback paths, automatic memory integration, and a large implementation footprint. That exploration was useful but too wide for a first implementation slice.

The MVP needs to solve the core user-visible problem:

1. The model can fetch a public URL safely.
2. The fetched result is clean and bounded enough for the model to use in the same turn.
3. Durable storage happens only through existing explicit tools (`save_memo`, `create_task`).

## Decision Drivers

- Must support generic `text/html`, `text/plain`, `text/markdown`, and `application/pdf` inputs
- Must be safe by default: public web only, no private-network or localhost access, bounded redirects, bounded size, bounded time
- Must fit the current codebase shape (`tools-builder.ts`, `system-prompt.ts`, typed `AppError` pattern)
- Should keep the first implementation slice small enough for focused TDD
- Must use manual DNS/IP validation for SSRF protection because Bun `fetch` does not support Node-style `agent` injection
- Must align with the existing `storageContextId`/`chatUserId` scoping model

## Considered Options

### Option 1: Full April design with adapters and hosted fallback

- **Pros:** Complete feature coverage, host-specific extraction, automatic memory integration
- **Cons:** Too large for a first slice, high implementation risk, many new config surfaces

### Option 2: Minimal passthrough fetch with no extraction or caching

- **Pros:** Tiny implementation
- **Cons:** Raw HTML/bytes are too large and noisy for the model to use effectively, no SSRF protection, no rate limiting, no caching

### Option 3: MVP with safe fetch, extraction, bounded output, caching, and rate limiting

- **Pros:** Solves the core user problem end-to-end, ships full safety boundary, fits existing patterns, small enough for focused TDD
- **Cons:** More code than a passthrough, new `src/web/` subsystem, two new DB tables, four new runtime dependencies

## Decision

We chose **Option 3**: a focused MVP that adds a `web_fetch` tool with the full safety boundary but minimal product surface.

### Architecture

```
src/web/
├── types.ts           # WebFetchResult, SafeFetchResponse, RateLimitResult
├── url-normalize.ts   # Canonicalize URLs for cache keys
├── rate-limit.ts      # 20 requests / 5 minutes / actor fixed-window counter
├── safe-fetch.ts      # Manual DNS/IP validation + redirect-aware public-web fetch
├── extract.ts         # HTML → markdown via Defuddle + linkedom
├── pdf.ts             # PDF text extraction via unpdf
├── cache.ts           # web_cache CRUD + TTL handling (15 min default)
├── distill.ts         # Small-model (or main-model fallback) distillation for oversized content
└── fetch-extract.ts   # Top-level orchestration: quota → cache → fetch → extract → distill → cache
```

### Key Design Decisions

1. **SSRF protection via manual DNS/IP validation** — Bun `fetch` does not honor Node-style `agent` hooks, so we resolve DNS first and reject loopback/private/link-local/cloud-metadata addresses using `ipaddr.js` before each fetch and redirect.

2. **Tool scoping split** — `storageContextId` for config/model lookup, `actorUserId` for per-actor rate limiting. In groups the storage context is the group/thread but the actor is the real user.

3. **Defuddle for HTML extraction** — Uses Defuddle's markdown output path directly (no separate Turndown pass). Falls back to hostname as title when extraction returns empty.

4. **Deterministic size bounds** — 8,000 character excerpt limit, 2 MB text body limit, 10 MB PDF limit. Content under 8K chars bypasses the model entirely.

5. **Model fallback for distillation** — Uses `small_model` when configured, falls back to `main_model` when not, avoiding a new setup requirement.

6. **No new config keys** — MVP reuses existing `llm_apikey`, `llm_baseurl`, `main_model`, optional `small_model`.

7. **No automatic persistence** — `web_fetch` returns an intermediate artifact. Durable storage only happens when the model explicitly calls `save_memo` or `create_task`.

8. **Typed error branch** — Dedicated `WebFetchError` union in `AppError` with 8 specific codes, each mapping to a user-facing message via `getUserMessage()`.

### Error Model

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

## Rationale

The MVP approach ships the full safety boundary (SSRF protection, size limits, rate limiting, content-type gating) that would be required in any future expansion, while keeping the product surface minimal. This avoids the risk of shipping an unsafe passthrough and then trying to bolt on security later.

The per-module DI pattern (each module accepts a `deps` parameter defaulting to production implementations) keeps the entire pipeline unit-testable without mocking at the module level.

Defuddle + linkedom for HTML extraction and unpdf for PDF extraction avoid heavyweight browser-based extraction while producing clean markdown output suitable for LLM consumption.

## Consequences

### Positive

- Model can read public URLs and use the content for memos, tasks, and answers
- Full SSRF protection prevents localhost and private-network access
- Rate limiting (20/5min/actor) prevents abuse
- 15-minute cache reduces redundant fetches
- No new user-facing config keys
- All modules DI-driven for testability
- Reuses existing error architecture (`AppError` branch)

### Negative

- Four new runtime dependencies (`defuddle`, `linkedom`, `unpdf`, `ipaddr.js`)
- Two new database tables (`web_cache`, `web_rate_limit`)
- New `src/web/` subsystem (~9 source files + tests)
- Distillation uses LLM tokens when content exceeds 8K chars
- No host-specific extraction adapters in MVP (e.g., GitHub, arXiv, YouTube)
- No hosted fallback (e.g., Jina Reader) if extraction fails

### Risks

- **Defuddle/linkedom extraction quality** — May not handle all page layouts well. Mitigation: returns `extract-failed` error, model can tell the user.
- **PDF extraction limitations** — `unpdf` may struggle with scanned/image PDFs. Mitigation: same error path, user can paste text manually.
- **Cache staleness** — 15-minute TTL is a fixed trade-off. Mitigation: configurable in future if needed.

## Implementation Notes

- Migration `020_web_fetch` creates `web_cache` and `web_rate_limit` tables
- `makeWebFetchTool(storageContextId, actorUserId)` registered in `tools-builder.ts`
- Tool gated on `storageContextId` being defined (no storage context = no web fetch)
- System prompt updated with `web_fetch` usage guidance
- `tests/web/` added to default test script in `package.json`

## Deferred Follow-ons

1. Host-specific adapters (GitHub PRs, arXiv, Reddit, Wikipedia, YouTube)
2. Hosted fallback extraction (Jina Reader)
3. URL-detection hints or preprocessing
4. Automatic fetched-content persistence into long-term memory
5. User-facing toggles or policy config
6. Stronger cache revalidation (ETag/Last-Modified)

## Related Decisions

- ADR-0014: Multi-Chat Provider Abstraction — tool scoping follows the `storageContextId`/`chatUserId` split
- ADR-0020: Error Classification Improvements — established the `AppError` typed union pattern
- ADR-0058: Provider Capability Architecture — tool registration follows the capability-gated builder pattern

## References

- Design: `docs/superpowers/specs/2026-04-11-web-fetch-mvp-design.md`
- Plan: `docs/superpowers/plans/2026-04-11-web-fetch-mvp.md`
- Research: `docs/research/web-fetch-research.md`
