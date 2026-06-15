# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

papai is a chat bot that manages tasks via LLM tool-calling. A user sends natural-language messages through configured chat platform instances (Telegram, Mattermost, Discord, or Kontur Talk), the bot invokes a configurable OpenAI-compatible LLM (via Vercel AI SDK), executes capability-gated task-tracker tools, and replies. Runtime behavior depends on the source platform instance, assigned task instance, conversation context, and per-user or group-targeted configuration stored in SQLite.

Notable non-obvious behaviors:

- Telegram and Mattermost group contexts are thread-aware via thread-scoped storage context IDs; **Discord group contexts are not thread-scoped**.
- Chat startup runs through `ChatRouter`, which manages DB-backed platform instances and tags incoming messages/interactions with `platformInstanceId`.
- **All configuration happens in the settings web UI**, not in chat. `/config` (DM only) issues a single-use link to it; `SETTINGS_PUBLIC_BASE_URL` must be set or `/config` refuses. The `/plugin` and `/set` chat commands are retired. Chat callback config flows (`gsel:`/`cfg:`/`wizard_`/`plg:`/`tgl:`) were removed; `interaction-router.ts` is now a near-empty safe sink.
- **Telegram and Discord** treat a user's reply to the **bot's own message** in a group as equivalent to an `@mention` — the bot processes it without an explicit mention. Mattermost and Kontur Talk are not affected by this path.
- Settings-UI admin "Users" adds accept `@username`. Live resolution is tried first (`resolveSettingsUserId`); when the platform cannot resolve it (Telegram's Bot API never can for user accounts), a **pending entry** is stored (`users.platform_user_id = 'placeholder-<uuid>'`) and rebound case-insensitively to the real ID on the user's first DM (`src/auth.ts` → `resolveUserByUsername`). Group-member adds stay strict and 422 on unresolvable usernames.
- Supports incoming files, file-to-task relay, identity mapping, memo search, recurring tasks, deferred prompts, public web fetch.

## Commands

Run scripts as `bun <script>`. Full list is in `package.json`; below are only the ones with non-obvious semantics.

- `bun start` / `bun start:debug` — build debug/admin clients, then run the bot (TS runs directly under Bun, no backend build). `:debug` sets `DEBUG_SERVER=true`.
- `bun build:client` — bundle `client/{debug,admin,settings}/` to `public/` (`CLIENT_BUILD_OUTDIR` overrides the output dir; used by tests to build into a temp dir). The debug-server test suites **fail fast** if `public/` bundles are missing instead of building them — run `bun build:client` once before `bun run test` on a clean checkout.
- `bun run test` — all server-side suites; **excludes client and E2E** via `bunfig.toml`. Runs `bun test --parallel` (one worker process per file, implies `--isolate`), the project default. On a 12-core machine this is ~2.5x faster than serial. In CI (`CI=true`), `scripts/check.sh` runs the suite **serially** instead — worker-per-file on a 4-vCPU hosted runner, on top of the other concurrent checks, exhausts the VM and gets the runner shut down mid-job. Bare `bun test` (Bun's built-in runner, not the script) still runs **serially** — Bun has no `bunfig.toml` key for `--parallel`, so use `bun run test` or `bun test --parallel` for the fast path. `bun test:serial` is the explicit serial escape hatch for debugging isolation-sensitive failures. Note: tests must be isolation-clean (no cross-file shared state, no fixed-wall-clock timing assertions — poll for conditions instead) since each file runs in its own process.
- `bun test:client` — `tests/client/` with happy-dom (`tests/client-setup.ts`).
- `bun test:e2e` — Docker-backed Kaneo E2E (`tests/e2e/bun-test-setup.ts`).
- `bun test:mutate:changed` — paired mutation run vs `origin/master`; this is what CI uses.
- `bun test:mutate:file <paths...>` — fast per-file paired run (`ignoreStatic:false` + companion tests), bypasses the static-bucket artifact.
- `bun check` — staged-file lint/typecheck/format; `bun check:full` runs `scripts/check.sh`.
- `bun check:bundle-isolation` — asserts the dev-only `client/stories/**` harness never leaked into production bundles.

Other scripts (`lint`, `lint:fix`, `format`, `knip`, `duplicates`, `typecheck`, `security`, `changelog:*`, `review-loop:*`, `storybook`) do what their names imply.

## TDD Enforcement (Hooks)

Every `Write`/`Edit`/`MultiEdit` on an implementation file in `src/` or `client/` triggers an automated hook pipeline enforcing Red → Green → Refactor; it runs checks sequentially and **blocks** on failure.

**Scope** — only implementation files: path starts with `src/`/`client/`, extension `.ts`/`.js`/`.tsx`/`.jsx`, not a test (`*.test.*`/`*.spec.*`). Everything else passes through, but test-file edits still verify the changed test passes. The `client/` tree mirrors `src/` for test resolution (`client/debug/foo.ts` → `tests/client/debug/foo.test.ts`).

**Pipeline** — before write: (1) write-policy gate, (2) test-first gate, (3) API surface snapshot. After write: (4) test tracker for new tests, (5) import gate for tests under `tests/`, (6) targeted test run + coverage regression check, (7) API surface diff check.

**Write protections (blocked escape hatches):**

- `.oxlintrc.json` is protected from direct write-tool edits.
- Inline suppressions (`eslint-disable`, `oxlint-disable`, `@ts-ignore`, `@ts-nocheck`) are blocked before writes complete.
- Bash-hook policy blocks `git stash` and `git checkout --`.

Fix the underlying issue rather than bypassing linting or hook policy.

## Required Environment Variables

**Required at startup:** `ADMIN_USER_ID` — stored as the initial authorized `platform_user_id`, so it must match the user ID string the active adapter sees (numeric for Telegram; the platform user ID string, not a display name, for Mattermost/Discord/Kontur Talk).

**Central LLM credentials** live in the admin-owned `system_config` SQLite table, seeded once from env on first start and read from the DB after. If any of the three required entries is missing at runtime, the bot logs `WARN` and replies "the bot is not fully configured" until set via env+restart or `/admin#system`:

- `LLM_API_KEY` → `llm_apikey`, `LLM_BASE_URL` → `llm_baseurl`, `MAIN_MODEL` → `main_model`
- `SMALL_MODEL` — optional; callsites fall back to `main_model`
- `EMBEDDING_MODEL` — optional; memo semantic search degrades to keyword-only

**`INSTANCE_CONFIG_KEY`** — 32-byte AES-256-GCM key (64 hex chars) encrypting `platform_instances.config` and `task_instances.config` at rest. Non-hex values are treated as passphrases (scrypt-derived). When unset, a host-local fallback key is used and a one-shot `WARN` logs at startup; **production must set this explicitly**.

**First-run env bootstrap (only when the instance tables are empty):**

- `CHAT_PROVIDER` (`telegram`|`mattermost`|`discord`|`kontur-talk`), plus provider creds: Telegram `TELEGRAM_BOT_TOKEN`; Mattermost `MATTERMOST_URL`+`MATTERMOST_BOT_TOKEN`; Discord `DISCORD_BOT_TOKEN`; Kontur Talk `KONTUR_TALK_JWT_TOKEN`.
- After bootstrap, platform selection comes from `context_settings`, base config from `platform_instances`, per-context creds from `user_config`.
- **Task instances are not env-bootstrapped.** Create them via `/admin#instances`, then approve `task-provider-kaneo`/`task-provider-youtrack` in the settings UI admin Plugins area (super admin) after deploying. Removed bootstrap vars: `TASK_PROVIDER`, `YOUTRACK_URL`, and the Kaneo URLs below.

**`SETTINGS_PUBLIC_BASE_URL`** — **required** external base URL (e.g. `https://bot.example.com`); builds single-use settings links. The settings session cookie adds `Secure` only when the request is HTTPS (`X-Forwarded-Proto: https` behind a proxy, else the request URL scheme) — over plain HTTP it is omitted so the browser keeps the cookie. Unset → `/config` refuses; no in-chat fallback.

**Optional runtime flags:** `DEBUG_SERVER`, `DEBUG_HOSTNAME`, `DEBUG_PORT`, `LOG_LEVEL`, `DEMO_MODE`. `KANEO_CLIENT_URL`/`KANEO_INTERNAL_URL` are no longer bootstrap vars but are still read at runtime by the Kaneo provisioning route (`src/debug/settings/provision-routes.ts`); `KANEO_INTERNAL_URL` also carries internal bot-to-Kaneo traffic.

**File attachments (S3-compatible):** required to receive/persist/attach files. `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (required); `S3_ENDPOINT` (required for non-AWS: MinIO/R2/B2), `S3_REGION`, `S3_PREFIX`, `S3_FORCE_PATH_STYLE=true` for MinIO (optional).

**Dashboard (`DEBUG_SERVER=true`):** the dashboard requires a session cookie minted via the bot — DM `/dashboard` for a one-time sign-in link. `DASHBOARD_BASE_URL` (default `SETTINGS_PUBLIC_BASE_URL`, else `http://{DEBUG_HOSTNAME}:{DEBUG_PORT}`), `DASHBOARD_SESSION_TTL_SECONDS` (default `28800`), `DASHBOARD_CLAIM_TTL_SECONDS` (default `300`). See `docs/deployment/dashboard-access.md`.

**Per-user runtime config keys** (managed in the settings UI): `timezone`; `mcp_endpoints` (JSON array of external MCP endpoints `{ id, url (https only), label?, headers?, enabled, toolFilter? }`, registered in `src/config-keys.ts`); Kaneo `plugin:task-provider-kaneo:provider:{credential,workspaceId}`; YouTrack `plugin:task-provider-youtrack:provider:token`; AI output visibility `ai_tool_visibility` / `ai_reasoning_visibility` (`on`/`off`, default `off`) and `ai_output_detail_level` (`sanitized`/`raw`, default `sanitized`) — surfaced as enum `ConfigField`s (`kind: 'ai-output'`) in the settings UI "AI output" section, read by `getAiOutputSettings` (`src/ai-output-settings.ts`).

## Architecture

```text
User (Telegram/Mattermost/Discord/Kontur Talk)
  -> ChatRouter -> source ChatProvider instance
  -> bot.ts (message queue + reply-context enrichment + file relay)
     -> llm-orchestrator.ts
        -> await makeTools(provider, { storageContextId, chatUserId, mode, contextType })
        -> wrapped tool execution with structured failure results
        -> provider adapters / web fetch / memo / recurring / deferred / MCP tools
     -> reply via ReplyFn
Optional: debug server + debug/admin/settings clients
```

Non-command text goes straight to the LLM queue with no interception (`src/bot.ts`).

### Module map (one line each)

- `src/index.ts` — startup, env validation, DB init, instance bootstrap, router/scheduler/poller/debug-server start.
- `src/bot.ts` — command registration, auth, queueing, interaction routing.
- `src/chat/` — `ChatProvider` interface (`types.ts`), provider registry (`registry.ts`, `createChatProviderFromConfig`), `ChatRouter` fan-out (`router.ts`), command-menu registration (`startup.ts`), and the now-inert `interaction-router.ts`.
- `src/config.ts` / `conversation.ts` / `history.ts` / `memory.ts` — per-user config; history, summary, fact management.
- `src/attachments/` — durable attachment workspace (ingest, S3 blob store, metadata, manifest, resolver).
- `src/message-queue/` — message coalescing + orderly orchestrator dispatch.
- `src/group-settings/` — admin group-context support for the settings UI (`admin-group-list.ts`, `admin-scope.ts`, `registry.ts` observation store, `access.ts`).
- `src/identity/` — chat→provider identity mapping and "me" resolution.
- `src/tools/` — context-aware, capability-gated tool assembly + wrappers. See `src/tools/CLAUDE.md`.
- `src/providers/` — normalized provider types/utilities. Kaneo and YouTrack are now first-party plugin-contributed providers under `plugins/`. See `src/providers/CLAUDE.md`.
- `src/web/` — safe public HTTP(S) fetch, extraction, distillation, rate limiting, cache.
- `src/instances/` — DB-backed platform/task instance model: AES-256-GCM encryption, per-table CRUD stores, env→DB bootstrap. DB is source of truth after migration `040`; env only consulted when tables empty. Construction goes through `TaskProviderResolver` / `ChatRouter`.
- `src/usage/` — LLM/tool usage recorders: one row per LLM turn (`llm_usage_events`) and per tool execution (`tool_call_events`); `event_id` is a deterministic SHA-256 hash; inert outbox columns reserved for a future forwarder.
- `src/stats/` — anonymous DB-wide aggregates via Drizzle; `getSubjectStats()`/`getGlobalStats()` (global cached 60s), consumed by `/admin#stats` via `/stats/*`. High-cardinality identifiers keyed-hashed with `stats_anonymity_salt`. **See anonymity contract below.**
- `src/plugins/` — trusted local plugin system (see Plugin System).
- `src/mcp/` — MCP adapter: connects to external MCP servers and exposes their tools as AI SDK tools. Sources: user `mcp_endpoints` and plugin-declared `mcp` blocks. `makeTools()` swallows all MCP failures so a dead server never breaks the pipeline. Only `streamable-http` is runtime-supported. See `src/mcp/CLAUDE.md`.
- `src/settings/` — settings-UI access model: one-time auth-code issuance, token crypto, SQLite sessions with synchronizer-token CSRF, principal resolution, `requireScope` guard, rate limiting (`SETTINGS_PUBLIC_BASE_URL` via `config.ts`). Tables from migration `050_settings_auth`.
- `src/debug/` + `client/{debug,admin,settings}/` — optional debug server and three UIs (below).

### Debug/settings server surfaces

- `/debug` — engineer live-observability surface; `/admin` — operator config + durable records; `/dashboard` → redirects to `/debug`. `/admin#system` (LLM creds via `GET`/`POST /admin/llm`, `llm_apikey` masked server-side), `/admin#billing`, `/admin#stats` (`/stats/*`), `/admin#instances` (`/api/platform-instances`, `/api/task-instances`, `/api/admins`). Instance routes degrade gracefully: unreadable encrypted rows are reported in an `unreadable` array and skipped at startup with warnings, not aborts.
- **`DEBUG_SERVER` gate scope:** `debugEnabled=false` only 404s the engineer live-observability subset (`DEBUG_ONLY_PATHS`: `/debug`, `/debug.js`, `/debug.css`, `/events`, `/logs`, `/logs/stats`, `/dashboard`, `/turns/*`). The operator surfaces (`/admin`, `/billing/*`, `/stats/*`, instance routes) remain reachable with a valid dashboard session even when `DEBUG_SERVER=false`, because operators must manage LLM creds and instances in production. Authorization for those routes is the session cookie, not `DEBUG_SERVER`.
- **Settings trust domain is strictly separate from the operator domain.** `server.ts` routes `/settings`, `/settings.js`, `/settings.css`, and `/settings/api/*` **before** any `DEBUG_TOKEN` check. Per-capability handlers (`src/debug/settings/` and `settings/admin/`) each authenticate the settings session, verify the `X-Settings-CSRF` header on writes, and resolve a validated `contextId` via `requireScope`. No settings cookie ever satisfies a `DEBUG_TOKEN` route; admin handlers are thin wrappers over the same stores.
- `client/settings/` is a Svelte SPA bootstrapped from the single-use `/config` link, gating sections by role + context; data flows through Zod-validated fetchers against `/settings/api/*`.

#### Anonymity contract for `/stats/*`

`/stats/global` and `/stats/subject/:id` are constrained to anonymous, aggregate-shaped data only:

- **Allowed:** counts, byte sizes, oldest/newest timestamps, enum distributions (`byStatus`, `byProvider`, `byExtension`), and hashed/keyed identifiers for high-cardinality strings (rrule patterns, web-fetch hostnames). Keying salt is the `stats_anonymity_salt` row in `system_config`, seeded lazily on first read and never auto-rotated.
- **Never returned:** message text, memo bodies, observation text, attachment filenames, raw URLs/paths, usernames or display names, workspace names, tags, project names, status names, RRULE text, any other free-form content.

Any leak of content from these routes is a **release-blocking defect**.

## Plugin System

Trusted, repository-local first-party plugins only — no sandbox, marketplace, npm install, hot reload, secret store, or raw provider/DB/env/network access. The restricted runtime API is **not a sandbox guarantee** (plugin code runs in-process). Full reference: `docs/plugins/developer-guide.md` and the `docs/plugins/examples/hello-world/` example.

- **Layout** — `plugins/<plugin-id>/` (lowercase kebab-case; manifest `id` must match the dir). `plugin.json` validated by `pluginManifestSchema` (`src/plugins/types.ts`); entry default-exports a factory `() => { activate(ctx), deactivate?(ctx) }`. `PLUGIN_API_VERSION` is `1`; mismatched `apiVersion` is rejected.
- **Lifecycle** — (1) Discover (scan + hash → `plugin_admin_state` `discovered`; missing `plugins/` dir fails fast when `DEBUG_SERVER=true`, else WARN+degraded via `startup-guard.ts`); (2) Approve in settings UI (keyed to manifest hash — any source change clears approval); (3) Activate on next startup (per-plugin timeout `activationTimeoutMs` 100–10000ms default 5000, bounded `p-limit`, isolated failures logged to `plugin_runtime_events`); (4) Enable per `contextId` (or `defaultEnabled: true`); (5) Eligibility — `getPluginContextEligibility()` → `inactive`/`disabled`/`config_missing`/`capability_missing`/`eligible` (per-context only; never breaks global activation).
- **Storage** (migration `039_plugins`) — `plugin_admin_state`, `plugin_context_state`, `plugin_kv` (gated by `storage` permission), `plugin_runtime_events`. Only approval state is persisted; runtime state is recomputed.
- **Context facade** — frozen `PluginContext` exposes only `pluginId`/`contextId`/`permissions`, `log.*`, `kv.*` (needs `storage`), `adminConfig.get`, `providerRuntime` (needs `provider.task`/`http`; every hop must match `providerAllowedHosts` + pass public-URL checks), `identity` (needs `identity` + exactly one task provider type), and `registration.*` — `registerTool`, `registerPromptFragment`, `registerCommand`, `registerScheduledJob`, `registerAttachmentTransformer` (needs `attachments.read`), `registerTaskProviderType` (needs `provider.task`) — all rejected unless declared in `contributes.*`. Plugins never get a raw `TaskProvider`/`ChatProvider`/DB handle/`process.env`. Tool and transformer executions get a request-scoped `PluginToolRuntimeContext` that includes `contextConfig.get(key)` for context-scoped config (declared in `configRequirements` with `scope: 'context'`) and `PluginAttachmentRecord.origin`/`forwardedFrom` fields.
- **Naming** — tool `plugin_<sanitized-id>__<tool>`; command `plugin_<sanitized-id>_<command>`; scheduled-job owner `plugin:<pluginId>:<jobName>` (runs only where enabled + eligible). Prompt fragments are sync strings/functions, budgeted 2,000 chars/fragment, 8,000 total.
- **Permissions (MVP)** — `storage`, `scheduler`, `commands`, `tasks.read`, `tasks.write`, `provider.task`, `identity`, `http`, `attachments.read` (context-scoped read of stored attachment bytes/metadata via `PluginToolRuntimeContext.attachments`). Raw chat send, raw provider/DB access, and unallowlisted network access are not exposed.
- **Attachment transformers** — plugins can pre-process new attachments before the LLM turn (e.g., `audio-transcribe` transcribes voice notes); dispatch is MIME/extension/origin-filtered, eligibility-aware, timeout-isolated (per-call clamp 1000–120000 ms + 120 s per-turn budget), and failures become in-turn marker lines. Group voice notes are eagerly resolved from the staged-file store post-coalescing.
- **Admin** — discover/approve/reject/enable-disable entirely in the settings UI admin area; approve/reject take effect next startup, enable/disable on next tool/prompt assembly.

## Tools

Tool exposure is **capability-gated and context-dependent** (`dm` vs `group`, `normal` vs `proactive`, presence of a storage context, provider identity support). The full tool list is enumerated in `src/tools/` (core CRUD plus capability-gated provider tools for deletion, counting, relations, comments, projects, labels, statuses, work items, attachments, collaboration; and user/context tools for memos, recurring tasks, deferred prompts, instructions, group history, `web_fetch`, identity). Phase-five provider features (sprints, activities, saved queries, agiles) exist at the provider layer without tool wrappers yet.

**User-configurable access** — beyond capability + context gating, each personal or managed-group context assigns every tool a three-state permission stored as JSON under the reserved `tool_prefs` key (`{ domainDefaults, toolOverrides }`), applied as the final step in `makeTools()`:

- `allow` (default) — exposed normally.
- `deny` — removed from the set.
- `ask` — exposed wrapped: input schema gains a `_permission_reason` field and execution is gated on explicit per-call user permission.

The system prompt (`src/system-prompt.ts`) is composed from permission-aware fragments: never instructs the agent to use a denied tool, lists ask-gated tools with their permission requirement, and appends an "Unavailable tools" line for denied domains. Managed in the Tools section of the settings UI. MCP-sourced tools (`mcp_<server>__<tool>` for user endpoints, `plugin_<server>__<tool>` for plugin-sourced) are subject to the same per-context permissions.

**Result compaction (experimental, default OFF)** — per-context reduction flags live as JSON under the reserved `tool_context_flags` config key (read via `resolveReductionFlags` in `src/tools/feature-flags.ts`; `TOOL_CONTEXT_REDUCTION_DISABLED=true` is a global kill switch; flag writes invalidate the cached tool descriptors; managed per context in the settings UI super-admin **Feature flags** section, `/settings/api/admin/feature-flags`). With `result_compaction` ON, `prepareLlmInvocation` wraps the toolset per turn (`src/tools/compaction/wrap-compaction.ts`, applied after `applyToolPreferences`): successful tool results over 8 KB are stored in a per-context TTL/LRU store and replaced by a `_compacted` envelope (query-aware SMALL_MODEL summary, or preview-only truncation on summarizer failure); the flag-gated `expand_result` tool (registered only in `normal` mode — proactive runs never compact) pages the stored raw result. Failures, already-compacted envelopes, and non-serializable results are never compacted; flag OFF is a reference-identical pass-through.

**Progressive disclosure (experimental, default OFF)** — with `progressive_disclosure` ON (same `tool_context_flags` key; same super-admin Feature flags section), `buildFullToolSet` applies `maybeApplyDisclosure` (`src/tools/disclosure/wire.ts`) after compaction: a turn-scoped `DisclosureSession` is created, `search_tools`/`load_tool` meta-tools are injected, and `invokeModel` attaches a `prepareStep` so each step's `activeTools` is only core (`get_current_time`) ∪ meta (`search_tools`, `load_tool`, `expand_result` when registered) ∪ explicitly loaded names — full tool schemas stay registered for execution/permissions but are not serialized until loaded. `search_tools` returns ranked schema-less briefs (`semantic_tool_retrieval` ON → BYOK-aware embedding-backed retriever resolving per-context credentials, recording usage, with per-endpoint+model brief caches and lexical fallback, OFF → lexical); a latched stall fallback opens all tools after 2 steps with no real loads, or when the last 2 completed steps were nothing but `search_tools`/`load_tool` churn (`disclosure:fallback` event). The system prompt gains a TOOL DISCOVERY preamble (advertises `expand_result` only when registered). `disclosure:search`/`disclosure:load` events carry counts/lengths only. Flag OFF is a reference-identical pass-through.

## Logging

Mandatory; pino with structured metadata-first calls. `debug` — function entry/params/internal state/outbound setup; `info` — successful high-value ops; `warn` — invalid input, degraded handling, blocked confirmation, expected recoverable issues; `error` — caught exceptions and failed external calls. **Never log tokens, API keys, session cookies, or other sensitive data.**

## Key Conventions

- Runtime **Bun**; validation **Zod v4**; LLM via **Vercel AI SDK**; chat via **Grammy** / Mattermost REST+WebSocket / **discord.js**.
- Strict TypeScript; **use `.js` extension in import paths**.
- Error extraction: `error instanceof Error ? error.message : String(error)`.
- Use `p-limit` for bounded concurrency over remote ops, not unbounded `Promise.all`.
- **Never add lint-disable or type-ignore comments** — hook policy blocks them; fix the underlying issue.
- A `max-lines` / `max-lines-per-function` failure is a **design signal**: split the file or extract functions; do not game the limit by deleting blank lines or compressing formatting.

## Testing Notes

See `tests/CLAUDE.md`. Prefer DI over `mock.module()` where the module supports it. Helpers (`schemaValidates()`, `getToolExecutor()`, `setMockFetch()`, `restoreFetch()`) live in `tests/utils/test-helpers.ts`; `tests/mock-reset.ts` resets common mocks per test. The repo mixes DI-first and legacy delayed-import/mock suites — follow the local pattern unless intentionally refactoring style. Mutation testing (Stryker) is local-only, not in the write-hook pipeline.

## Path-Scoped Conventions

| Path                      | Covers                                                                 |
| ------------------------- | ---------------------------------------------------------------------- |
| `src/providers/CLAUDE.md` | normalized provider interface, capabilities, provider-layer rules      |
| `src/tools/CLAUDE.md`     | tool assembly, execution wrapping, confirmations, context gating       |
| `src/commands/CLAUDE.md`  | command handler rules and current command surface                      |
| `src/chat/CLAUDE.md`      | chat provider interface, capabilities, context rendering, interactions |
| `src/mcp/CLAUDE.md`       | external MCP server adapter, connection pooling, tool namespacing      |
| `tests/CLAUDE.md`         | helpers, mocks, mock reset, E2E guidance                               |
| `review-loop/CLAUDE.md`   | review-loop workspace structure, scripts, storage, TDD rules           |

Plugin authors: `docs/plugins/developer-guide.md` + `docs/plugins/examples/hello-world/`. The `codeindex` MCP server lives in a separate project at `~/Projects/papai/codeindex/`.

## Pi Workflow

When the harness supports `obra/superpowers` skills, preserve that workflow. Load `using-superpowers` at session start before acting; load any other applicable skill before responding, editing, or running commands; do not rely on memory of skill contents — load the current text each time.

## Codebase Search Protocol

Prefer the `codeindex` MCP server for structural code queries.

| When                                    | Use                                                     |
| --------------------------------------- | ------------------------------------------------------- |
| Exact symbol / export / qualified name  | `code_symbol` with `limit: 5`                           |
| Keyword / concept / exploratory         | `code_search` with `scopeTiers: ["exported", "member"]` |
| Found a symbol, need callers/dependents | `code_impact`                                           |
| Stale data suspected after edits        | `code_index` with `mode: "incremental"`                 |

Shape queries with `kinds` (e.g. `["function_declaration", ...]`) and `scopeTiers` (prefer `["exported", "member"]`). Fallback to `grep`/`glob` **only** for non-indexed files (config, markdown, `.json`, non-JS/TS); `read` individual files as last resort.

**Do not:** use `grep` for symbol defs/usage inside `src/`/`client/`; use `glob src/**/*.ts` to discover symbols by filename; use `task explore` for structural navigation; run the codeindex CLI directly. An auto-reindex plugin runs incremental reindexing after `write`/`edit`/`multiedit` under `src/`/`client/`; call `code_index` `incremental` explicitly if you suspect staleness.

## Security

`bun security` (local Semgrep) / `bun security:ci`. Covers OWASP-style issues, TS/JS pitfalls, and AI/LLM concerns (prompt-injection-adjacent unsafe fetch, accidental secret exposure).
