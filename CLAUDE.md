# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

papai is a chat bot that manages tasks via LLM tool-calling. A user sends natural-language messages through configured chat platform instances (Telegram, Mattermost, or Discord), the bot invokes a configurable OpenAI-compatible LLM (via Vercel AI SDK), executes capability-gated task-tracker tools, and replies with the result. Runtime behavior depends on the source platform instance, assigned task instance, conversation context, and per-user or group-targeted configuration stored in SQLite.

Notable current behaviors:

- Telegram and Mattermost group contexts are thread-aware via thread-scoped storage context IDs; Discord group contexts are not thread-scoped today
- chat startup runs through `ChatRouter`, which manages DB-backed platform instances and tags incoming messages/interactions with `platformInstanceId`
- `/setup` and `/config` are DM-driven and can target either personal settings or a managed group
- the bot supports incoming files, file-to-task relay, identity mapping, memo search, recurring tasks, deferred prompts, and public web fetching
- an optional local debug server serves separate `client/debug/` and `client/admin/` clients for live observability and operator/admin workflows

## Commands

All scripts can be run as `bun <script>` or `bun run <script>`.

- `bun start` — build the debug/admin clients and run the bot
- `bun start:debug` — build the debug/admin clients and run the bot with `DEBUG_SERVER=true`
- `bun build:client` — bundle the debug/admin UIs from `client/{debug,admin}/` to `public/`
- `bun storybook` — run the dashboard component harness on http://localhost:6006 (Storybook + Vite, dev-only)
- `bun build:storybook` — build the static story site to `storybook-static/` (git-ignored)
- `bun check:bundle-isolation` — rebuild the client and assert the dev-only `client/stories/**` harness never leaked into the production debug/admin bundles
- `bun review-loop:start` — run the review-loop workflow
- `bun lint` — lint with oxlint
- `bun lint:agent-strict -- <paths...>` — stricter agent-focused lint pass for selected paths
- `bun lint:fix` — lint with auto-fix
- `bun format` — format with oxfmt
- `bun format:check` — check formatting without writing
- `bun knip` — check for unused dependencies/exports
- `bun duplicates` — detect duplicate code blocks
- `bun typecheck` — TypeScript type checking
- `bun security` — run Semgrep security scan locally
- `bun security:ci` — run security scan with CI outputs
- `bun test` — run the curated main unit/integration suites (excludes client and E2E)
- `bun test:client` — run debug/admin UI tests with happy-dom
- `bun test:watch` — run unit tests in watch mode
- `bun test:coverage` — run unit tests with coverage
- `bun test:mutate` — run mutation tests with Stryker
- `bun test:mutate:changed` — run incremental mutation tests
- `bun test:mutate:full` — force a full mutation run
- `bun test:e2e` — run Docker-backed E2E tests
- `bun test:e2e:watch` — run E2E tests in watch mode
- `bun check` — run lint/typecheck/format checks for staged files
- `bun check:full` — run the broader full check suite via `scripts/check.sh`
- `bun check:verbose` — run lint, typecheck, format:check, knip, test, and duplicates in parallel
- `bun review-loop:test` — run the review-loop workspace test suite
- `bun review-loop:typecheck` — run review-loop workspace TypeScript checks
- `bun review-loop:lint` — lint the review-loop workspace
- `bun review-loop:format:check` — check review-loop workspace formatting
- `bun fix` — auto-fix lint and format issues
- `bun changelog:preview` — preview changelog generation with git-cliff
- `bun changelog:generate` — regenerate `CHANGELOG.md`
- `bun install` — install dependencies

`bun start` and `bun start:debug` both build the debug/admin clients first. The server runs TypeScript directly under Bun; there is no separate backend build step.

## Testing

Main commands:

```bash
bun test
bun test:client
bun test:e2e
```

- `bun test` runs the curated main non-client, non-E2E suites defined in `package.json`.
- `bun test:client` runs `tests/client/` with `tests/client-setup.ts`.
- `bun test:e2e` runs the Docker-backed Kaneo end-to-end suite with `tests/e2e/bun-test-setup.ts`.

Mutation testing is available locally through Stryker, but it is not currently part of the automated repo-local write-hook pipeline.

## TDD Enforcement (Hooks)

Every `Write`, `Edit`, and `MultiEdit` on a file in `src/` or `client/` triggers an automated hook pipeline. The pipeline enforces Red → Green → Refactor by running checks sequentially and blocking when a check fails.

### Scope

Only **implementation files in `src/` or `client/`** are checked:

- path starts with `src/` or `client/`
- extension is `.ts`, `.js`, `.tsx`, or `.jsx`
- not a test file (`*.test.*` / `*.spec.*`)

Everything else passes through without the implementation pipeline. Test-file edits still verify that the changed test passes.

The `client/` tree mirrors `src/` for test resolution: `client/debug/foo.ts` maps to `tests/client/debug/foo.test.ts`.

### Pipeline

Before write:

1. write-policy gate
2. test-first gate
3. API surface snapshot

After write:

4. test tracker for newly written tests
5. import gate for test files under `tests/`
6. targeted test run plus coverage regression check
7. API surface diff check

### Additional Write Protections

The repo also blocks a few unsafe AI-editing escape hatches:

- `.oxlintrc.json` is protected from direct write-tool edits by hook policy
- inline suppression comments such as `eslint-disable`, `oxlint-disable`, `@ts-ignore`, and `@ts-nocheck` are blocked before writes complete
- bash-hook policy blocks `git stash` and `git checkout --` in the Claude/bash flow

Fix the underlying issue instead of trying to bypass linting or hook policy.

## Security

- `bun security` — local Semgrep run
- `bun security:ci` — CI-oriented Semgrep run

Security checks cover OWASP-style issues, TypeScript/JavaScript pitfalls, and AI/LLM-specific concerns such as prompt-injection-adjacent unsafe fetch behavior and accidental secret exposure.

## Required Environment Variables

Required at startup:

- `ADMIN_USER_ID`

The bot also needs central LLM credentials before it can serve any message.
They live in the admin-owned `system_config` SQLite table, seeded once from
environment variables on first start and from the DB on subsequent starts:

- `LLM_API_KEY` (seeded into `system_config.llm_apikey`)
- `LLM_BASE_URL` (seeded into `system_config.llm_baseurl`)
- `MAIN_MODEL` (seeded into `system_config.main_model`)
- `SMALL_MODEL` — optional; callsites fall back to `main_model`
- `EMBEDDING_MODEL` — optional; memo semantic search degrades to keyword-only
- `INSTANCE_CONFIG_KEY` — 32-byte AES-256-GCM key (64 hex chars) used to
  encrypt `platform_instances.config` and `task_instances.config` at rest.
  Non-hex values are SHA-256-hashed. When unset, a derived host-local
  fallback key is used and a one-shot `WARN` is logged at startup;
  production deployments must set this explicitly.

If `system_config` is missing any of the three required entries at runtime,
the bot logs `WARN` at startup and replies "the bot is not fully configured"
to incoming messages until the admin sets them via env + restart or through
`/admin#system`.

`ADMIN_USER_ID` is stored as the initial authorized `platform_user_id`, so it must match the user ID string the active chat adapter sees. For Telegram this is numeric; for Mattermost and Discord it is the platform user ID string, not a display name.

First-run env bootstrap requirements when the instance tables are empty:

- `CHAT_PROVIDER` (`telegram`, `mattermost`, or `discord`)
- `TASK_PROVIDER` (`kaneo` or `youtrack`)

Chat-provider bootstrap requirements:

- Telegram: `TELEGRAM_BOT_TOKEN`
- Mattermost: `MATTERMOST_URL`, `MATTERMOST_BOT_TOKEN`
- Discord: `DISCORD_BOT_TOKEN`

Task-provider bootstrap requirements:

- Kaneo: `KANEO_CLIENT_URL`
- YouTrack: `YOUTRACK_URL`

`CHAT_PROVIDER` and `TASK_PROVIDER` are used only by first-run env bootstrap when the instance tables are empty. After bootstrap, platform/task instance selection is read from `context_settings`, platform/task instance base config lives in `platform_instances` and `task_instances`, and per-context credentials stay in `user_config`.

Optional but important runtime flags include:

- `DEBUG_SERVER`, `DEBUG_HOSTNAME`, `DEBUG_PORT`, `DEBUG_TOKEN`
- `LOG_LEVEL`
- `DEMO_MODE`
- `KANEO_INTERNAL_URL` for internal bot-to-Kaneo traffic

When `DEBUG_SERVER=true`, the local UI is split by audience:

- `/debug` — engineer/live observability surface
- `/admin` — operator/configuration and durable records surface
- `/dashboard` — compatibility redirect to `/debug`

The admin system surface lives at `/admin#system` and includes the
credentials form backed by `GET`/`POST /admin/llm`. The admin billing
surface lives at `/admin#billing`, and the admin stats surface lives at
`/admin#stats` and uses `GET /stats/global` and `GET /stats/subject/:id`.
The admin instances surface lives at `/admin#instances` and manages
platform instances, task instances, and admin assignments through
`/api/platform-instances`, `/api/task-instances`, and `/api/admins`.
When `DEBUG_TOKEN` is set, debug/admin routes are gated by the bearer
token. When it is unset, read-only debug/admin routes remain available
without a token. `POST /admin/llm` is the special case: it returns 401
when `DEBUG_TOKEN` is unset, so production-style deployments behind a
reverse proxy keep the write surface closed by default.

#### Anonymity contract for `/stats/*`

`/stats/global` and `/stats/subject/:id` are constrained to anonymous,
aggregate-shaped data only:

- Allowed: counts, byte sizes, oldest/newest timestamps, enum
  distributions (e.g. `byStatus`, `byProvider`, `byExtension`), and
  hashed/keyed identifiers for high-cardinality strings (rrule
  patterns, web-fetch hostnames). The keying salt is the
  `stats_anonymity_salt` row in `system_config`, seeded lazily on
  first read and never rotated automatically.
- Never returned: message text, memo bodies, observation text,
  attachment filenames, raw URLs/paths, usernames or display names,
  workspace names, tags, project names, status names, RRULE text,
  any other free-form content.

Any leak of content from these routes is a release-blocking defect.

The remaining credentials live in the per-user config store and are managed through `/setup` and `/config`, not through a `/set` command.

### File Attachments (S3-compatible Object Storage)

Required when the bot needs to receive, persist, or attach files to tasks.

| Variable               | Required | Description                                                           |
| ---------------------- | -------- | --------------------------------------------------------------------- |
| `S3_BUCKET`            | Yes      | S3 bucket name where attachment objects are stored                    |
| `S3_ACCESS_KEY_ID`     | Yes      | Access key for the S3-compatible service                              |
| `S3_SECRET_ACCESS_KEY` | Yes      | Secret key for the S3-compatible service                              |
| `S3_ENDPOINT`          | No\*     | Endpoint URL. Required for non-AWS providers such as MinIO, R2, or B2 |
| `S3_REGION`            | No       | AWS region (e.g. `us-east-1`)                                         |
| `S3_PREFIX`            | No       | Optional key prefix inside the bucket                                 |
| `S3_FORCE_PATH_STYLE`  | No       | Set to `true` for MinIO                                               |

Common runtime config keys (per-user, set via `/setup` or `/config`):

- `timezone`
- `mcp_endpoints` — JSON array of external MCP server endpoints (`{ id, url (https only), label?, headers?, enabled, toolFilter? }`) whose tools are merged into the context's tool set. Registered as a preference key in `src/config-keys.ts`; editable as a free-text value through `/config`.

LLM credentials (`llm_apikey`, `llm_baseurl`, `main_model`, `small_model`,
`embedding_model`) are admin-owned and live in `system_config`, not in
`user_config` — see the "Required Environment Variables" section above.

Provider-specific per-user runtime keys:

- Kaneo: `kaneo_apikey`
- YouTrack: `youtrack_token`

## Architecture

```text
User (Telegram/Mattermost/Discord)
  -> ChatRouter
  -> source ChatProvider instance
  -> bot.ts
     -> group-settings selector / config editor / setup wizard interception
     -> message queue + reply-context enrichment + file relay
     -> llm-orchestrator.ts
        -> await makeTools(provider, { storageContextId, chatUserId, mode, contextType })
        -> wrapped tool execution with structured failure results
        -> provider adapters / web fetch / memo / recurring / deferred / MCP tools
     -> reply via ReplyFn
Optional: debug server + debug/admin clients
```

### Main Modules

- `src/index.ts` — startup, env validation, DB initialization, instance bootstrap, chat router startup, scheduler/poller start, optional debug server start
- `src/bot.ts` — command registration, auth checks, interception flow, queueing, interaction routing
- `src/chat/types.ts` — `ChatProvider`, `ReplyFn`, `IncomingMessage`, `IncomingInteraction`, context-rendering types
- `src/chat/registry.ts` — chat provider registry (`telegram`, `mattermost`, `discord`)
- `src/chat/router.ts` — `ChatRouter` runtime fan-out over active platform instances; tags incoming messages/interactions with `platformInstanceId` and routes proactive sends back to the source instance
- `src/chat/startup.ts` — command-menu registration when supported by provider capabilities
- `src/chat/interaction-router.ts` — config-editor, group-selector, and wizard callback routing
- `src/config.ts` — per-user config store
- `src/conversation.ts` / `src/history.ts` / `src/memory.ts` — history, summary, and fact management
- `src/attachments/` — durable attachment workspace: ingest, S3 blob store, metadata, manifest, and resolver
- `src/message-queue/` — message coalescing and orderly orchestrator dispatch
- `src/group-settings/` — DM selection of personal vs group settings target
- `src/identity/` — chat-to-provider identity mapping and “me” resolution
- `src/tools/` — context-aware, capability-gated tool assembly and tool wrappers
- `src/providers/` — Kaneo and YouTrack normalized provider implementations
- `src/web/` — safe public HTTP(S) fetch, extraction, distillation, rate limiting, cache
- `src/debug/`, `client/debug/`, and `client/admin/` — optional debug server plus split `/debug` and `/admin` UIs. `/debug` is the engineer-facing live observability surface. `/admin` is the operator-facing configuration and durable-records surface. Billing at `/admin#billing` reads from `src/debug/billing.ts` and decorates subjects with `resolveSubjectDisplayNames` in `src/debug/subject-display-name.ts` (DM names from `users.username`, group names from `known_group_contexts.displayName` with `:threadId` suffix stripped). The credentials form lives in the System section at `/admin#system`; `src/debug/admin-llm.ts` serves `GET`/`POST /admin/llm`, writes through `setSystemConfig()`, and masks `llm_apikey` values server-side. The Instances section at `/admin#instances` is backed by `src/debug/instance-routes.ts` and manages platform instances, task instances, and admin assignments.
- `src/usage/` — LLM and tool-call usage recorders + read helpers. Subscribes to the in-process event bus and writes one row per LLM turn into `llm_usage_events` (Phase 2) and one row per tool execution into `tool_call_events` (Phase 4). `event_id` on both tables is a deterministic SHA-256 hash so the recorder is safe to move to a queue/retry path later. Both tables carry inert outbox columns (`forwarded_at`, `forward_attempts`, `forward_error`) for a future metering-vendor forwarder.
- `src/stats/` — anonymous DB-wide statistics: per-subject and global aggregate queries fed straight from SQLite via Drizzle. The orchestrator (`src/stats/index.ts`) exposes `getSubjectStats()` and `getGlobalStats()`, caches the global view for 60s, and is consumed by the admin Stats surface at `/admin#stats` through `/stats/*`. These routes are bearer-token gated only when `DEBUG_TOKEN` is configured. All free-form, high-cardinality identifiers (rrule patterns, web-fetch hostnames) are keyed-hashed using the `stats_anonymity_salt` row in `system_config`; see the anonymity contract under "Required Environment Variables".
- `src/plugins/` — trusted local plugin system. Discovers plugin packages under `plugins/<plugin-id>/`, validates `plugin.json` against a Zod manifest schema, persists admin approval and per-context opt-in to SQLite (migration `039_plugins`), and activates approved plugins on startup through a frozen `PluginContext` facade. Plugins contribute tools, prompt fragments, commands, and scheduled jobs via `ctx.registration.*`; eligible contributions are merged into the live tool set, system prompt, command registry, and scheduler per context. The `/plugin` admin command (DM, bot-admin only) manages discovery, approval, rejection, and per-context enable/disable. See `docs/plugins/developer-guide.md`.
- `src/instances/` — DB-backed platform and task instance data model: AES-256-GCM encryption helper (`encryption.ts`), per-table CRUD stores (`platform-store.ts`, `task-store.ts`, `context-store.ts`, `admin-store.ts`), and one-shot env→DB bootstrap (`bootstrap.ts`). After migration `040_platform_instances`, the DB is the source of truth for chat/task provider instance configuration; env vars are only consulted when the instance tables are empty. `INSTANCE_CONFIG_KEY` controls the at-rest encryption key. Runtime task-provider construction goes through `TaskProviderResolver`, and chat startup goes through `ChatRouter`.
- `src/mcp/` — Model Context Protocol adapter. Connects to external MCP servers and exposes their tools to the LLM as Vercel AI SDK tools. Two sources: per-context user endpoints from the `mcp_endpoints` config key (`user-endpoints.ts`) and plugin-declared servers from a manifest's `mcp` field (`plugin-endpoints.ts`). `McpConnectionPool`/`mcpPool` (`client-pool.ts`) pools connections with retry and idle eviction; `convertMcpToolsToToolSet()` (`tool-adapter.ts`) wraps remote tools. `makeTools()` merges these tools and swallows all MCP failures so a dead server never breaks the pipeline. Only `streamable-http` is runtime-supported; `stdio` is schema-reserved. See `src/mcp/CLAUDE.md`.

## Plugin System

Trusted, repository-local first-party plugins only — no sandbox, no marketplace, no npm install, no hot reload, no plugin secret store, and no raw provider/DB/env/network access.

### Layout

- Plugin packages live at `plugins/<plugin-id>/` (lowercase kebab-case ID; manifest `id` must match the directory name).
- Each plugin has a `plugin.json` (validated by `pluginManifestSchema` in `src/plugins/types.ts`) and an entry point such as `index.ts` whose default export is a factory `() => { activate(ctx), deactivate?(ctx) }`.
- Plugin API version is pinned by `PLUGIN_API_VERSION` (currently `1`); manifests declaring a different `apiVersion` are rejected as incompatible.
- Beyond `contributes.{tools,promptFragments,commands,jobs}`, a manifest may also declare `contributes.configKeys`, a single `contributes.taskProviderTypes` entry (requires the `provider.task` permission, plus `providerCapabilities`/`providerConfigSchema`/`providerAllowedHosts`/`providerConfigValidator`), and an optional `mcp` block (`McpPluginConfig`) that points the plugin at an external MCP server whose tools are exposed under the `plugin_` namespace. See `src/mcp/CLAUDE.md`.

### Lifecycle

1. **Discover** — startup scans `plugins/`, hashes manifest + entry point content, and records each plugin in `plugin_admin_state` with state `discovered`.
2. **Approve** — bot admin runs `/plugin approve <id>` (DM-only). Approval is keyed to the manifest hash; any change to manifest or entry source clears approval and reverts the plugin to `discovered`.
3. **Activate** — on next startup, approved plugins are imported with a per-plugin activation timeout (`activationTimeoutMs`, 100–10000ms, default 5000) and bounded `p-limit` concurrency. Activation failures are isolated; `plugin_runtime_events` records `activated`/`deactivated`/`error` rows.
4. **Enable per context** — once active, a plugin must be enabled for a personal or managed-group `contextId` via `/plugin enable <id> [context-id]`, the `plg:` inline buttons in `/config`, or `defaultEnabled: true` in the manifest. Per-context state lives in `plugin_context_state`.
5. **Eligibility** — `getPluginContextEligibility(pluginId, contextId)` returns `inactive`, `disabled`, `config_missing`, `capability_missing`, or `eligible`. Missing required `configRequirements` or missing capabilities on the context's assigned platform/task instance is per-context only; it hides the plugin's tools and prompt fragments for that context without breaking activation globally.

### Storage

Migration `039_plugins` creates four SQLite tables:

| Table                   | Purpose                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------- |
| `plugin_admin_state`    | Per-plugin admin approval, state, approving admin, approved/last-seen manifest hash, compatibility note. |
| `plugin_context_state`  | Per-(plugin, context) enable flag.                                                                       |
| `plugin_kv`             | Per-(plugin, context, key) string KV, gated by the `storage` permission.                                 |
| `plugin_runtime_events` | Recent runtime events (activation, deactivation, error) for diagnostics in `/plugin info`.               |

Runtime state values (`active`, `incompatible`, `config_missing`, `error`) are recomputed in memory; only approval-related state is persisted.

### Plugin Context Facade

Activation receives a frozen `PluginContext` exposing only:

- `ctx.pluginId`, `ctx.contextId` (activation runs against `__system__`), `ctx.permissions`
- `ctx.log.{debug,info,warn,error}(data, msg)` — pino child logger scoped by `pluginId`. Never log secrets.
- `ctx.kv.{get,set,delete,list}` — context-scoped string KV, only when the `storage` permission is declared. Without it, all KV calls throw. KV is not a secret store.
- `ctx.adminConfig.get(key)` — read-only admin-scoped plugin config declared in `configRequirements`.
- `ctx.providerRuntime` — HTTP helper for provider plugins when `provider.task` or `http` is declared; every hop must match `providerAllowedHosts` and pass public URL checks.
- `ctx.identity` — available when `identity` is declared and the plugin declares exactly one task provider type.
- `ctx.registration.{registerTool,registerPromptFragment,registerCommand,registerScheduledJob,registerTaskProviderType}` — registrations are rejected unless declared in `contributes.{tools,promptFragments,commands,jobs,taskProviderTypes}`.

Plugins never receive a raw `TaskProvider`, `ChatProvider`, DB handle, or `process.env`. Tool executions receive a request-scoped `PluginToolRuntimeContext` with `pluginId`, `storageContextId`, `chatUserId`, a permission-gated task-provider facade, optional `identity`, rate-limit helper, and plugin/context KV.

### Contribution Naming

- LLM-facing tool name: `plugin_<sanitized-plugin-id>__<tool-name>` (e.g., `plugin_hello_world__greet`).
- Command name: `plugin_<sanitized-plugin-id>_<command-name>`, registered through the same `ChatProvider.registerCommand` path as core commands.
- Scheduled job owner: `plugin:<pluginId>:<jobName>`, executed only for contexts where the plugin is enabled and eligible.
- Prompt fragments are synchronous strings or sync functions; appended to the system prompt with a 2,000-char-per-fragment / 8,000-char-total budget.

### Permissions (MVP)

`storage`, `scheduler`, `commands`, `chat.send`, `tasks.read`, `tasks.write`, `provider.task`, `identity`, and `http`. Runtime gating exists for storage, task reads/writes, provider HTTP runtime, contributed task-provider registration, and identity facade exposure. Raw chat sending, raw provider access, raw DB access, and arbitrary unallowlisted network access are not exposed.

### Admin Command

`/plugin` is DM-only and bot-admin-only. Subcommands: `list`, `info <id>`, `approve <id>`, `reject <id>`, `enable <id> [context-id]`, `disable <id> [context-id]`. Approve/reject take effect on next startup; enable/disable take effect on the next tool/prompt assembly.

## Available Tools

Tool exposure is capability-gated and also depends on context (`dm` vs `group`, `normal` vs `proactive`, presence of a storage context, and provider identity support).

### Core Tools

- `create_task`
- `update_task`
- `search_tasks`
- `list_tasks`
- `get_task`
- `get_current_time`

### Capability-Gated Provider Tools

- task deletion: `delete_task`
- task counting: `count_tasks`
- relations: `add_task_relation`, `update_task_relation`, `remove_task_relation`
- comments: `get_comments`, `add_comment`, `update_comment`, `remove_comment`, `add_comment_reaction`, `remove_comment_reaction`
- projects: `list_projects`, `create_project`, `update_project`, `delete_project`, `list_project_team`, `add_project_member`, `remove_project_member`
- labels: `list_labels`, `create_label`, `update_label`, `remove_label`, `add_task_label`, `remove_task_label`
- statuses: `list_statuses`, `create_status`, `update_status`, `delete_status`, `reorder_statuses`
- work items: `list_work`, `log_work`, `update_work`, `remove_work`
- attachments: `list_attachments`, `upload_attachment`, `remove_attachment`
- collaboration: `list_watchers`, `add_watcher`, `remove_watcher`, `add_vote`, `remove_vote`, `set_visibility`, `find_user`

### User / Context Tools

- memos: `save_memo`, `search_memos`, `list_memos`, `archive_memos`, `promote_memo`
- recurring tasks: `create_recurring_task`, `list_recurring_tasks`, `update_recurring_task`, `pause_recurring_task`, `resume_recurring_task`, `skip_recurring_task`, `delete_recurring_task`
- deferred prompts: `create_deferred_prompt`, `list_deferred_prompts`, `get_deferred_prompt`, `update_deferred_prompt`, `cancel_deferred_prompt`
- instructions: `save_instruction`, `list_instructions`, `delete_instruction`
- group history: `lookup_group_history`
- web: `web_fetch`
- identity: `set_my_identity`, `clear_my_identity`

Current phase-five provider features such as sprints, activities, saved queries, and agiles are available at the provider layer but do not yet have corresponding tool wrappers.

### User-Configurable Tool Access

Beyond capability + context gating, each personal or managed-group context can disable
tools. Preferences are an opt-out denylist (default: all enabled) stored as JSON under a
reserved `tool_prefs` config key and applied as the final filter in `makeTools()`. The
system prompt (`src/system-prompt.ts`) is composed from tool-gated fragments so it never
instructs the agent to use a disabled tool, and appends an "Unavailable tools" line for
partially-disabled domains. Managed via the "🧰 Tools" section of `/config`.

### MCP-Sourced Tools

When a context configures `mcp_endpoints`, or an enabled plugin declares an `mcp` server,
`makeTools()` also merges tools fetched from those external MCP servers. User-endpoint tools
are named `mcp_<server>__<tool>`; plugin-sourced MCP tools use the `plugin_<server>__<tool>`
namespace. These tools are subject to the same per-context denylist as builtins. See
`src/mcp/CLAUDE.md`.

## Logging

Logging is mandatory and uses pino with structured metadata-first calls.

- `debug` — function entry, parameters, internal state, outbound request setup
- `info` — successful high-value operations
- `warn` — invalid input, degraded handling, blocked confirmation, expected recoverable issues
- `error` — caught exceptions and failed external calls

Never log tokens, API keys, session cookies, or other sensitive user data.

## Testing Notes

See `tests/CLAUDE.md` for detailed helper and mocking guidance.

Important current points:

- prefer DI over `mock.module()` where the module already supports it
- helper functions such as `schemaValidates()`, `getToolExecutor()`, `setMockFetch()`, and `restoreFetch()` live in `tests/utils/test-helpers.ts`
- `tests/mock-reset.ts` resets common mocked modules before each test and restores spies after each test
- the repo still contains a mix of DI-first and legacy delayed-import/mock suites; follow the existing local pattern when touching those files unless you are intentionally refactoring the test style

## Key Conventions

- Runtime: **Bun**
- Validation: **Zod v4**
- LLM integration: **Vercel AI SDK**
- Chat platforms: **Grammy**, Mattermost REST/WebSocket, **discord.js**
- Strict TypeScript
- Use `.js` extension in import paths
- Error extraction: `error instanceof Error ? error.message : String(error)`
- Use `p-limit` for bounded concurrency instead of unbounded `Promise.all` over remote operations
- Never add lint-disable or type-ignore comments; hook policy blocks them and the underlying issue must be fixed instead
- If a `max-lines` or `max-lines-per-function` lint rule fails, treat it as a design signal: split the file or extract smaller focused functions instead of deleting blank lines, compressing formatting, or otherwise gaming the limit

## Path-Scoped Conventions

Detailed conventions live in path-scoped `CLAUDE.md` files:

| Path                      | Covers                                                                 |
| ------------------------- | ---------------------------------------------------------------------- |
| `src/providers/CLAUDE.md` | normalized provider interface, capabilities, provider-layer rules      |
| `src/tools/CLAUDE.md`     | tool assembly, execution wrapping, confirmations, context gating       |
| `src/commands/CLAUDE.md`  | command handler rules and DM/group setup flow                          |
| `src/chat/CLAUDE.md`      | chat provider interface, capabilities, context rendering, interactions |
| `src/mcp/CLAUDE.md`       | external MCP server adapter, connection pooling, tool namespacing      |
| `tests/CLAUDE.md`         | helpers, mocks, mock reset, E2E test guidance                          |
| `review-loop/CLAUDE.md`   | review-loop workspace structure, scripts, storage, and TDD rules       |

Plugin authors should also consult `docs/plugins/developer-guide.md` (manifest schema, factory contract, context API, permissions) and the working example under `docs/plugins/examples/hello-world/`.

The `codeindex` MCP server now lives in a separate project at `~/Projects/papai/codeindex/`. See its `CLAUDE.md` for structure and scripts.

## Pi Workflow

When the current harness supports `obra/superpowers` skills, preserve that workflow instead of replacing it with unrelated agent packages.

- Load `using-superpowers` at the start of the session before taking action.
- Load any other applicable `obra/superpowers` skill before responding, editing files, or running commands.
- Do not rely on memory of skill contents; load the current skill text each time.

## Codebase Search Protocol

When working inside this project, prefer the `codeindex` MCP server tools for structural code queries.

### Tool selection

| When                                                      | Use                                                     |
| --------------------------------------------------------- | ------------------------------------------------------- |
| You know the exact symbol, export name, or qualified name | `code_symbol` with `limit: 5`                           |
| Keyword, concept, or exploratory search                   | `code_search` with `scopeTiers: ["exported", "member"]` |
| You found a symbol and need callers/references/dependents | `code_impact`                                           |
| Stale data suspected after edits                          | `code_index` with `mode: "incremental"`                 |

### Query-shaping tips

- Use `kinds` to narrow results to specific declarations (e.g., `["function_declaration", "class_declaration", "interface_declaration"]`).
- Use `scopeTiers` to skip local-variable noise. Prefer `["exported", "member"]` unless local symbols are intentionally needed.
- Use `code_symbol` for names you know (e.g., `resolveMattermostUserId`, `src/chat/mattermost/index#MattermostChatProvider>resolveUserId`).
- Use `code_search` for concepts (e.g., `mattermost user identity`, `task provider resolver`).

### Fallback

1. **Fallback** — Use `grep` or `glob` ONLY for files outside the indexed source tree (config files, markdown, `.json`, non-JS/TS assets).
2. **Last resort** — Use `read` on individual files when `codeindex` returns no results and the file is known to exist.

### Do not

- Do NOT use `grep` to search for symbol definitions or usage inside `src/` or `client/`.
- Do NOT use `glob` with `src/**/*.ts` to discover symbols by filename.
- Do NOT use `task explore` for structural codebase navigation when the repository is indexed.
- Do NOT run the codeindex CLI directly in conversation; use the MCP tools instead.

### Auto-reindexing

This repository includes an auto-reindex plugin. After `write`/`edit`/`multiedit` calls on files under `src/` or `client/`, incremental reindexing happens automatically. If you suspect stale data, call `code_index` with mode `incremental` explicitly.
