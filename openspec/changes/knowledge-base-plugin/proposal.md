# Knowledge Base Plugin

## Goal
Add a first-party plugin `knowledge-base` that periodically indexes a configured chat channel (Mattermost first, per the issue) for question/answer exchanges, builds a durable knowledge base in plugin KV storage, and exposes it to the LLM via a `kb_search` tool so the bot can answer recurring questions from channel history. This complements (does not replace) the existing long-term memory (`src/long-term-memory/`), which stores per-scope facts; the KB is a shared, channel-sourced Q&A corpus.

## Framework gap found during exploration
Plugin scheduled jobs today receive only `{ pluginId, contextId, taskProvider? }` (`src/plugins/runtime-types.ts:84`, `src/plugins/tool-runtime.ts:155`). An indexer job needs HTTP fetch (to call the Mattermost REST API), KV (to persist entries and the crawl cursor), and config access (channel id, credentials). So the framework must be extended first:

- `src/plugins/runtime-types.ts` — extend `PluginScheduledJobRuntimeContext` with optional, permission-gated fields: `kv` (requires `storage`), `adminConfig`, `contextConfig`, and `httpFetch` (requires `http`, reusing the existing allowlist + public-URL enforcement in `src/plugins/provider-runtime.ts`).
- `src/plugins/tool-runtime.ts` — build these facades in `buildPluginScheduledJobRuntimeContext`, gated exactly like the tool-runtime path; fail closed when the permission is absent. Job-runtime `contextId` is the group config-context id, so KV keys resolve consistently with the plugin's declared `storageScope`.
- `src/plugins/contributions.ts` — thread any needed deps through `runPluginScheduledJob`.
- Tests in `tests/plugins/` covering: facades present only with the matching permission, httpFetch allowlist enforcement in the job path, and job isolation per context.

## The plugin: `plugins/knowledge-base/`

### Manifest (`plugin.json`)
- `permissions`: `["storage", "scheduler", "http"]`, `storageScope: "group"` (KB is shared across a group's threads).
- `contributes`: `tools: ["kb_search"]`, `jobs: ["index_channel"]`, `promptFragments: ["kb-hint"]`.
- `configRequirements`:
  - admin scope: `mm_base_url` (required; host feeds the allowlist via `providerAllowedHostsFromConfig`, admin-trusted tier so self-hosted/LAN MM works), `mm_bot_token` (required, sensitive).
  - context scope: `source_channel_id` (required — the channel to index), `max_entries` (optional, default 500).

### Files
- `plugins/knowledge-base/plugin.json`
- `plugins/knowledge-base/index.ts` — factory, activation, registrations.
- `plugins/knowledge-base/fetch.ts` — Mattermost REST v4 paging (`GET /api/v4/channels/{id}/posts`, `since=<cursor>`), token auth header, bounded pages per run.
- `plugins/knowledge-base/extract.ts` — pure heuristic Q&A detection (testable): a root post is a question when it contains `?` or starts with question words; the answer is the reply by a *different* author with the most reactions, else the latest such reply. Threads with no qualifying reply are skipped.
- `plugins/knowledge-base/store.ts` — KV layout: `kb:cursor` (last indexed post create_at), `kb:entry:<rootPostId>` = `{question, answer, questionAuthor, answerAuthor, createdAt}`, `kb:index` = ordered id list; append with cap from `max_entries`, evicting oldest.
- `plugins/knowledge-base/search.ts` — pure scoring: tokenize query, rank entries by term hits over question+answer (question hits weighted higher), return top N with authors/date.

### Behavior
- Job `index_channel` (default interval 15 min): reads config at execute time (dual-scope pattern), fetches new posts since the cursor, extracts Q&A pairs, appends to KV, advances the cursor only on success. Fetch/extract errors are logged (`warn`) and swallowed — the job never throws; the cursor stays put so the next run retries. First run on a context indexes only a bounded backfill window (e.g. last 200 posts) to avoid a huge initial crawl.
- Tool `plugin_knowledge_base__kb_search(query, limit?)`: keyword-scored top-N entries, formatted as Q/A pairs with attribution; returns a friendly "no entries yet" message when the KB is empty or the plugin is unconfigured.
- Prompt fragment `kb-hint` (<2,000 chars): tells the LLM to consult `kb_search` when a user asks something the indexed channel may have answered before.

## Explicit assumptions (stated, not asked)
1. **Mattermost-only MVP** via REST API v4, matching the issue's "for example in MM". Other platforms can follow by swapping `fetch.ts`.
2. **Heuristic extraction, not LLM extraction** — the plugin API exposes no LLM facade, so detection is rule-based (question mark/question words + cross-author reply, reaction-weighted).
3. **Keyword search, no embeddings** — plugin KV is the only storage available to plugins, so ranking is term-frequency based; no vector index in this change.
4. Read-only: the plugin never posts into the source channel.

## Verification
- Unit tests under `tests/plugins/knowledge-base/` for `extract.ts` (question detection, reaction-weighted answer pick, skip cases) and `search.ts` (ranking, empty KB, limit), plus store tests for cursor advance/cap eviction with an in-memory KV stub.
- Framework tests for the extended scheduled-job runtime context (permission gating, allowlist enforcement).
- Mock `httpFetch` responses for the job's fetch/extract/store happy path and failure-keeps-cursor path.
- Run `bun test tests/plugins`, `bun lint`, `bun typecheck`.
- Update `docs/architecture/plugins.md` and `docs/plugins/developer-guide.md` scheduled-jobs section to document the new job-runtime facades.
