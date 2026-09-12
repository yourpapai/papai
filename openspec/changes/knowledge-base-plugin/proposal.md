<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Proposal: knowledge-base plugin

## Why

Papai has no grounded Q&A — the general LLM answers without a vetted corpus. This change adds a first-party plugin (`plugins/knowledge-base/`) that answers support questions from a curated corpus (README, curated KB file, LLM-judged channel threads) via tiered vector retrieval and source-cited LLM answers, giving every papai group a grounded knowledge base while reusing papai's chat routing, LLM proxy, and plugin lifecycle.

## What Changes

- New plugin `plugins/knowledge-base/` (`apiVersion: 1`, `storageScope: 'group'`) with `contributes.tools`/`jobs`/`configRequirements`. Activates on all platform instances (Telegram, Mattermost, Discord, Kontur Talk); eligibility per-config-context (group-shared), live turns thread-isolated, feedback per-user.
- **Indexing** — chunk/normalize/scrub pipeline over configured sources (curated KB, optional GitLab README via `providerRuntime.httpFetch`, distilled threads), float32 BLOB embeddings via Vercel AI SDK, SQLite `chunks` store, scheduled reindex job (30 min).
- **Retrieval** — tiered cosine search (high: readme + curated KB; low: distilled threads) with `RETRIEVAL_MIN_SCORE` gate, top-k=6, dimension guard; exposed as `ask_knowledge_base` plugin tool.
- **Answer synthesis** — grounded prompt with tier labels, `[n]` citations and truncation to 4k chars; guardrails: `:no-bot:` opt-out, self-exclusion (note: `processed_posts` reply-claim dedup is a Non-Goal per below — standalone Mattermost bot loop only).
- **Distillation** — channel thread archive + LLM judge (`KB_MIN_VALUE_SCORE`) → `channel`-tier chunks via scheduled `distill` job; `feedback` table reserved.
- Settings UI section for sources and thresholds (see `docs/architecture/plugins.md`).

## Capabilities

### New Capabilities

- `knowledge-base`: grounded Q&A over a per-config-context corpus with tiered retrieval, citation, and opt-out. Without it papai stays ungrounded or requires a separate deployment; behavior (README + curated KB prioritized over judged threads, never fabricating) stays missing. `context-vault` (`docs/architecture/context-vault.md`, `plugins/context-vault/`) stores pushed OpenSpec summaries, not a chunked RAG corpus with judging — separate capability needed. `synthetic-web-search` covers public web, not curated local docs. Governed by `docs/architecture/plugins.md` + `docs/architecture/tools.md`.
- `knowledge-base/indexing`: chunk/embed/index lifecycle and reindex/distill scheduling. Without it the corpus is never built or refreshed — retrieval serves empty or stale results. No existing module covers chunking/embed-batching; extends `scheduler` permission and the drizzle/SQLite pattern in `docs/architecture/overview.md`.

### Modified Capabilities

- None — `openspec/specs/` is currently empty; no existing REQUIREMENTS change. Docs affected: `docs/architecture/plugins.md`, `docs/architecture/tools.md`, `docs/architecture/behaviors.md`, `docs/architecture/overview.md`.

## Impact

- Code: new `plugins/knowledge-base/`; drizzle migration (`chunks`, `thread_archive`, `cursors`, `feedback`); plugin config via `configRequirements` (generic `/settings/api/plugins/config` + `/settings/api/admin/plugin-config`, not custom routes); vector helpers (float32 BLOB encode/decode, cosine) + chunk/normalize/scrub pipeline. No **BREAKING** API; new `tool_prefs` domain defaults to `allow`.
- Dependencies: none new — `ai`/`@ai-sdk/openai-compatible`, `zod`, `pino`, existing `scheduler` cover needs; embeddings reuse current LLM provider.
- Systems: LLM proxy usage grows (embed/chat per reindex/judge/ask), bounded by `EMBED_BATCH=32` and `p-limit(3)`.

## Non-goals

- Auto-escalation with `@mention` of responsibles (`RESPONSIBLES.md`/`MAINTAINER_USERNAMES`) — declined; human triage stays.
- Reaction feedback loop (`✅/❌/🤷`) driving quality tuning and Wiki ingestion — feedback stored, not acted on.
- Standalone `ws`/`mm/client.ts` Mattermost crawl of `helpChannelId` — papai uses `ChatRouter` instances instead; one bot, not per-channel.
- Multi-host GitLab crawling outside `providerAllowedHosts` or horizontal SQLite scaling (inherits single-writer SQLite limit, ADR-0005).
