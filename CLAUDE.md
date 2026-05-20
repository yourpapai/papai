# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

papai is a chat bot that manages tasks via LLM tool-calling. A user sends natural-language messages through a configurable chat platform (Telegram, Mattermost, or Discord), the bot invokes a configurable OpenAI-compatible LLM (via Vercel AI SDK), executes capability-gated task-tracker tools, and replies with the result. Runtime behavior depends on the active chat provider, task provider, conversation context, and per-user or group-targeted configuration stored in SQLite.

Notable current behaviors:

- Telegram and Mattermost group contexts are thread-aware via thread-scoped storage context IDs; Discord group contexts are not thread-scoped today
- `/setup` and `/config` are DM-driven and can target either personal settings or a managed group
- the bot supports incoming files, file-to-task relay, identity mapping, memo search, recurring tasks, deferred prompts, and public web fetching
- an optional local debug server serves the dashboard client built from `client/debug/`

## Commands

All scripts can be run as `bun <script>` or `bun run <script>`.

- `bun start` — build the dashboard client and run the bot
- `bun start:debug` — build the dashboard client and run the bot with `DEBUG_SERVER=true`
- `bun build:client` — bundle the debug dashboard UI from `client/debug/` to `public/`
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
- `bun test:client` — run dashboard UI tests with happy-dom
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

`bun start` and `bun start:debug` both build the dashboard client first. The server runs TypeScript directly under Bun; there is no separate backend build step.

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

- `CHAT_PROVIDER`
- `ADMIN_USER_ID`
- `TASK_PROVIDER`

The bot also needs central LLM credentials before it can serve any message.
They live in the admin-owned `system_config` SQLite table, seeded once from
environment variables on first start and from the DB on subsequent starts:

- `LLM_API_KEY` (seeded into `system_config.llm_apikey`)
- `LLM_BASE_URL` (seeded into `system_config.llm_baseurl`)
- `MAIN_MODEL` (seeded into `system_config.main_model`)
- `SMALL_MODEL` — optional; callsites fall back to `main_model`
- `EMBEDDING_MODEL` — optional; memo semantic search degrades to keyword-only

If `system_config` is missing any of the three required entries at runtime,
the bot logs `WARN` at startup and replies "the bot is not fully configured"
to incoming messages until the admin restarts with the env vars set.

`ADMIN_USER_ID` is stored as the initial authorized `platform_user_id`, so it must match the user ID string the active chat adapter sees. For Telegram this is numeric; for Mattermost and Discord it is the platform user ID string, not a display name.

Chat-provider requirements:

- Telegram: `TELEGRAM_BOT_TOKEN`
- Mattermost: `MATTERMOST_URL`, `MATTERMOST_BOT_TOKEN`
- Discord: `DISCORD_BOT_TOKEN`

Task-provider requirements:

- Kaneo: `KANEO_CLIENT_URL`
- YouTrack: `YOUTRACK_URL`

Optional but important runtime flags include:

- `DEBUG_SERVER`, `DEBUG_HOSTNAME`, `DEBUG_PORT`, `DEBUG_TOKEN`
- `LOG_LEVEL`
- `DEMO_MODE`
- `KANEO_INTERNAL_URL` for internal bot-to-Kaneo traffic

When `DEBUG_SERVER=true`, the dashboard at `/dashboard` exposes a
Billing panel with a credentials form. The `POST /admin/llm` route
requires `DEBUG_TOKEN` to be set in env (the route returns 401 if it
is unset, so production-style deployments behind a reverse proxy
keep the write surface closed by default).

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

LLM credentials (`llm_apikey`, `llm_baseurl`, `main_model`, `small_model`,
`embedding_model`) are admin-owned and live in `system_config`, not in
`user_config` — see the "Required Environment Variables" section above.

Provider-specific per-user runtime keys:

- Kaneo: `kaneo_apikey`
- YouTrack: `youtrack_token`

## Architecture

```text
User (Telegram/Mattermost/Discord)
  -> ChatProvider
  -> bot.ts
     -> group-settings selector / config editor / setup wizard interception
     -> message queue + reply-context enrichment + file relay
     -> llm-orchestrator.ts
        -> makeTools(provider, { storageContextId, chatUserId, mode, contextType })
        -> wrapped tool execution with structured failure results
        -> provider adapters / web fetch / memo / recurring / deferred tools
     -> reply via ReplyFn
Optional: debug server + dashboard client
```

### Main Modules

- `src/index.ts` — startup, env validation, DB initialization, scheduler/poller start, optional debug server start
- `src/bot.ts` — command registration, auth checks, interception flow, queueing, interaction routing
- `src/chat/types.ts` — `ChatProvider`, `ReplyFn`, `IncomingMessage`, `IncomingInteraction`, context-rendering types
- `src/chat/registry.ts` — chat provider registry (`telegram`, `mattermost`, `discord`)
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
- `src/debug/` and `client/debug/` — optional debug server and dashboard UI

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
| `tests/CLAUDE.md`         | helpers, mocks, mock reset, E2E test guidance                          |
| `review-loop/CLAUDE.md`   | review-loop workspace structure, scripts, storage, and TDD rules       |

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
