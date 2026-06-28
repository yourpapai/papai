<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Architecture

> Referenced from `CLAUDE.md`. High-level flow, module map, and debug/settings server surfaces. ACP coding sessions are documented separately in `coding-sessions.md`.

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

Non-command text goes straight to the LLM queue with no interception (`src/bot.ts`) — **unless a run is already active for that context**, in which case the message is injected into the live run's steer queue (mid-run steering) instead of starting a new turn.

## Module map (one line each)

- `src/index.ts` — startup, env validation, DB init, instance bootstrap, router/scheduler/poller/debug-server start.
- `src/bot.ts` — command registration, auth, queueing, interaction routing.
- `src/chat/` — `ChatProvider` interface (`types.ts`), provider registry (`registry.ts`, `createChatProviderFromConfig`), `ChatRouter` fan-out (`router.ts`), command-menu registration (`startup.ts`), and the now-inert `interaction-router.ts`.
- `src/config.ts` / `conversation.ts` / `history.ts` / `memory.ts` — per-user config; history, short-term summary/fact (thread-isolated entity-reference cache).
- `src/long-term-memory/` — durable group-scoped memory store (`memory_records`/`memory_profiles`); background LLM extraction, semantic + FTS search, hourly maintenance. Hosts the flag-gated cross-thread memory bridge (provisional tier, capture, recall cascade, promotion — see Tools below).
- `src/chat/context-scope.ts` — declarative `ENTITY_SCOPES` registry (single source of truth for each context-owned entity's effective scope `thread`/`group`/`user`) + `getScopeKey`; reconciled against `CONTEXT_OWNED_COLUMNS` by a consistency test so scope can't be silently mislabeled.
- `src/attachments/` — durable attachment workspace (ingest, S3 blob store, metadata, manifest, resolver). Within a group, reads (`list_files`/`search_staged_files`) **and** actions (`resolve`/`upload`/`delete`) are group-discoverable across sibling threads via the denormalized `group_context_id` (writes stay thread-scoped; DMs unaffected).
- `src/message-queue/` — message coalescing + orderly orchestrator dispatch; same-thread turns are serialized (one run per thread — the former different-user fire-and-forget path now runs through `handlerChain`).
- `src/run-control/` — per-turn run registry for mid-run steering/interruption (`RunControl`/`RunRegistry`, keyed by `storageContextId`): steer-message injection via a composed AI SDK `prepareStep`, deterministic graceful stop via a `stopWhen` condition, force-abort via `AbortSignal`, completed-effect recording, and the code-generated stop summary. Lifecycle is begun/ended (in `finally`) in `processMessage`; consumed by `invokeModel`, `bot.ts` mid-run routing, and the `/stop` command. In-memory only; `normal` mode only (proactive runs get no run-control).
- `src/group-settings/` — admin group-context support for the settings UI (`admin-group-list.ts`, `admin-scope.ts`, `registry.ts` observation store, `access.ts`).
- `src/identity/` — chat→provider identity mapping and "me" resolution.
- `src/tools/` — context-aware, capability-gated tool assembly + wrappers. See `src/tools/CLAUDE.md`.
- `src/providers/` — normalized provider types/utilities. Kaneo and YouTrack are now first-party plugin-contributed providers under `plugins/`. See `src/providers/CLAUDE.md`.
- `src/web/` — safe public HTTP(S) fetch, extraction, distillation, rate limiting (keyed per-user/`chatUserId`, not per-group), cache.
- `src/instances/` — DB-backed platform/task instance model: AES-256-GCM encryption, per-table CRUD stores, env→DB bootstrap. DB is source of truth after migration `040`; env only consulted when tables empty. Construction goes through `TaskProviderResolver` / `ChatRouter`. **`context_settings.task_instance_id` is nullable** (migration `062`): the first authorized non-guest message seeds a **platform-only** row (`ensureContextPlatformInstance`, idempotent/non-clobbering, called from `bot.ts` via `maybeSeedContextAssignment`) so a context is visible in admin/settings before `/config` assigns a task instance. A null task instance means "not configured" — `TaskProviderResolver.resolve` and plugin scheduled-context selection (`getScheduledJobContextIds`) treat it the same as a missing row, and `getTaskInstance(null)` returns null.
- `src/usage/` — LLM/tool usage recorders: one row per LLM turn (`llm_usage_events`) and per tool execution (`tool_call_events`); `event_id` is a deterministic SHA-256 hash; inert outbox columns reserved for a future forwarder.
- `src/stats/` — anonymous DB-wide aggregates via Drizzle; `getSubjectStats()`/`getGlobalStats()` (global cached 60s), consumed by the `/admin#stats` read-only panel via `/stats/*`. High-cardinality identifiers keyed-hashed with `stats_anonymity_salt`. **See anonymity contract below.**
- `src/plugins/` — trusted local plugin system (see Plugin System).
- `src/mcp/` — MCP adapter: connects to external MCP servers and exposes their tools as AI SDK tools. Sources: user `mcp_endpoints` and plugin-declared `mcp` blocks. `makeTools()` swallows all MCP failures so a dead server never breaks the pipeline. Only `streamable-http` is runtime-supported. See `src/mcp/CLAUDE.md`.
- `src/settings/` — settings-UI access model: one-time auth-code issuance, token crypto, SQLite sessions with synchronizer-token CSRF, principal resolution, `requireScope` guard, rate limiting (`SETTINGS_PUBLIC_BASE_URL` via `config.ts`). Tables from migration `050_settings_auth`.
- `src/debug/` + `client/{debug,admin,settings}/` — optional debug server and three UIs (below).

## Debug/settings server surfaces

- `/debug` — engineer live-observability surface; `/admin` — **read-only** operator dashboard (Overview, Billing, Stats, Memos, Reminders, Identities — no admin controls or settings); `/dashboard` → redirects to `/debug`. Admin controls now live solely in the settings admin section (`/settings/api/admin/*`, super-admin gated): LLM creds (`POST /settings/api/admin/system`), platform/task instances (`/settings/api/admin/platform-instances`, `/settings/api/admin/task-instances`, `/settings/api/admin/admins`; apply via `POST /settings/api/admin/platform-instances/apply`), plugin config (`/settings/api/admin/plugin-config`), group authorize/remove (`/settings/api/admin/groups`). Instance rows with unreadable encrypted config are reported in an `unreadable` array and skipped at startup with warnings, not aborts.
- **`DEBUG_SERVER` gate scope:** `debugEnabled=false` only 404s the engineer live-observability subset (`DEBUG_ONLY_PATHS`: `/debug`, `/debug.js`, `/debug.css`, `/events`, `/logs`, `/logs/stats`, `/dashboard`, `/turns/*`). The operator surface (`/admin`, `/billing/*`, `/stats/*`) remains reachable with a valid dashboard session even when `DEBUG_SERVER=false`. Authorization for those routes is the session cookie, not `DEBUG_SERVER`.
- **`POST /api/notify` (own trust plane):** accepts `{ contextId, contextType?, threadId?, markdown }` and delivers a proactive chat message via `ChatRouter.sendMessage` (resolving the platform instance from `context_settings` like deferred prompts do, falling back to the platform instance encoded in the scoped storage context id when no `context_settings` row exists — `resolveDeliveryPlatformInstanceId`, so new users who only ever chatted still get proactive delivery). Authenticated by the `NOTIFY_TOKEN`/`notify_token` bearer (timing-safe SHA-256 compare) — **not** the dashboard session cookie or `DEBUG_TOKEN`. Mounted in `routeRequest` before `isAuthorizedRequest` and outside `DEBUG_ONLY_PATHS`, so it is reachable regardless of `DEBUG_SERVER` (operators/services post to it in production).

- **Settings trust domain is strictly separate from the operator domain.** `server.ts` routes `/settings`, `/settings.js`, `/settings.css`, and `/settings/api/*` **before** any `DEBUG_TOKEN` check. Per-capability handlers (`src/debug/settings/` and `settings/admin/`) each authenticate the settings session, verify the `X-Settings-CSRF` header on writes, and resolve a validated `contextId` via `requireScope`. No settings cookie ever satisfies a `DEBUG_TOKEN` route; admin handlers are thin wrappers over the same stores.
- `client/settings/` is a Svelte SPA bootstrapped from the single-use `/config` link, gating sections by role + context; data flows through Zod-validated fetchers against `/settings/api/*`.

### Anonymity contract for `/stats/*`

`/stats/global` and `/stats/subject/:id` are constrained to anonymous, aggregate-shaped data only:

- **Allowed:** counts, byte sizes, oldest/newest timestamps, enum distributions (`byStatus`, `byProvider`, `byExtension`), and hashed/keyed identifiers for high-cardinality strings (rrule patterns, web-fetch hostnames). Keying salt is the `stats_anonymity_salt` row in `system_config`, seeded lazily on first read and never auto-rotated.
- **Never returned:** message text, memo bodies, observation text, attachment filenames, raw URLs/paths, usernames or display names, workspace names, tags, project names, status names, RRULE text, any other free-form content.

Any leak of content from these routes is a **release-blocking defect**.
