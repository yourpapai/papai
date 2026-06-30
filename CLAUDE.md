# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

papai is a chat bot that manages tasks via LLM tool-calling: a user sends natural-language messages through configured chat platform instances (Telegram, Mattermost, Discord, Kontur Talk), the bot invokes a configurable OpenAI-compatible LLM (via Vercel AI SDK), executes capability-gated task-tracker tools, and replies. Runtime behavior depends on the source platform instance, assigned task instance, conversation context, and per-user/group config stored in SQLite. Full project description + non-obvious behaviors: **[`docs/architecture/behaviors.md`](docs/architecture/behaviors.md)**.

## Documentation index

Detailed reference moved out of this file to keep it short. Read the relevant doc before working in that area.

| Topic                 | Doc                                                                                        | Covers                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Project & behaviors   | [`docs/architecture/behaviors.md`](docs/architecture/behaviors.md)                         | runtime model + every non-obvious behavior (scope model, guest mode, mid-run steering, live status, announcements, …) |
| Commands & TDD hooks  | [`docs/architecture/commands.md`](docs/architecture/commands.md)                           | non-obvious `bun` script semantics; the Write/Edit TDD hook pipeline and write protections                            |
| Environment variables | [`docs/architecture/environment.md`](docs/architecture/environment.md)                     | startup/required vars, central + BYOK LLM creds, bootstrap, S3, dashboard, runtime config keys                        |
| Architecture          | [`docs/architecture/overview.md`](docs/architecture/overview.md)                           | request flow, module map, debug/settings server surfaces, `/stats/*` anonymity contract                               |
| ACP coding sessions   | [`docs/architecture/coding-sessions.md`](docs/architecture/coding-sessions.md)             | `plugins/acp/` + magi, agent/provider picker, forge connections, operator/group guardrails                            |
| Storybook screenshots | [`docs/architecture/storybook-screenshots.md`](docs/architecture/storybook-screenshots.md) | agent visual-feedback loop: generate specs, shoot stories, read PNGs                                                  |
| Plugin system         | [`docs/architecture/plugins.md`](docs/architecture/plugins.md)                             | layout, lifecycle, storage, context facade, permissions, attachment transformers                                      |
| Tools                 | [`docs/architecture/tools.md`](docs/architecture/tools.md)                                 | capability/context gating, `tool_prefs` permissions, presets, compaction/disclosure, memory bridge                    |

### Path-scoped `CLAUDE.md` files (read when working under that path)

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

## Glossary

One-liners for recurring terms; full detail in the linked docs above.

- **platform instance** — a DB-backed, encrypted chat-platform configuration; `ChatRouter` fans out across instances and tags messages with `platformInstanceId`.
- **task instance** — a DB-backed, encrypted task-provider configuration (Kaneo/YouTrack); nullable per context (`null` = "not configured"). Assigned via `/config`.
- **storage context id** — scoped id keying live conversation state; thread-scoped in Telegram/Mattermost groups (not Discord).
- **config context id** — the scope key for durable assets/config; group-shared across a group's threads.
- **scope model** — live conversation state is thread-isolated; durable assets/config are group-shared; identity + web-fetch quota are per-user. Declared in `src/chat/context-scope.ts`.
- **guest mode** — per-group toggle granting unrecognized users a hardcoded read-only toolset; guests are never provisioned as members.
- **BYOK** — bring-your-own-key: per-config-context override of the central LLM creds, stored encrypted.
- **magi** — external coding-session control service the `plugins/acp/` plugin drives over HTTP.
- **forge** — a code host (GitHub/GitLab, SaaS or self-hosted) the user connects for push/PR.
- **mid-run steering** — injecting a non-command message into a live agent turn at the next tool-step boundary instead of starting a new turn.
- **`tool_prefs`** — per-context JSON assigning every tool a three-state permission (`allow`/`ask`/`deny`); resolved most-specific-wins.
- **settings UI** — the Svelte SPA at `/settings`, bootstrapped from a single-use `/config` link; **all configuration happens here**, not in chat.

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
