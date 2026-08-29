# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

papai is a chat bot that manages tasks via LLM tool-calling: a user sends natural-language messages through configured chat platform instances (Telegram, Mattermost, Discord, Kontur Talk), the bot invokes a configurable OpenAI-compatible LLM (via Vercel AI SDK), executes capability-gated task-tracker tools, and replies. Runtime behavior depends on the source platform instance, assigned task instance, conversation context, and per-user/group config stored in SQLite. Full project description + non-obvious behaviors: **[`docs/architecture/behaviors.md`](docs/architecture/behaviors.md)**.

## Documentation index

Detailed reference moved out of this file to keep it short. Read the relevant doc before working in that area.

| Topic                 | Doc                                                                                          | Covers                                                                                                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project & behaviors   | [`docs/architecture/behaviors.md`](docs/architecture/behaviors.md)                           | runtime model + every non-obvious behavior (scope model, guest mode, mid-run steering, live status, announcements, …)                                                   |
| Commands & TDD hooks  | [`docs/architecture/commands.md`](docs/architecture/commands.md)                             | non-obvious `bun` script semantics; the Write/Edit TDD hook pipeline and write protections                                                                              |
| Environment variables | [`docs/architecture/environment.md`](docs/architecture/environment.md)                       | startup/required vars, central + BYOK LLM creds, bootstrap, S3, dashboard, runtime config keys                                                                          |
| Architecture          | [`docs/architecture/overview.md`](docs/architecture/overview.md)                             | request flow, module map, debug/settings server surfaces, `/stats/*` anonymity contract                                                                                 |
| Analytics operations  | [`docs/operations/analytics-runbook.md`](docs/operations/analytics-runbook.md)               | rollout stages A–E, operator commands, reconciliation schedule; incident response in `analytics-incident-runbook.md`                                                    |
| Legacy corpus porting | [`docs/operations/legacy-migration-runbook.md`](docs/operations/legacy-migration-runbook.md) | triage signals + four lanes (archive/adopt/seed/retire) for moving `docs/superpowers/` items into OpenSpec one at a time                                                |
| ACP coding sessions   | [`docs/architecture/coding-sessions.md`](docs/architecture/coding-sessions.md)               | `plugins/acp/` + magi, agent/provider picker, forge connections, operator/group guardrails, transcript viewer                                                           |
| Context Vault         | [`docs/architecture/context-vault.md`](docs/architecture/context-vault.md)                   | indexer push API, token store, reducer/summarizer, `context-vault` plugin tools, lock-file daemon singleton                                                             |
| Storybook screenshots | [`docs/architecture/storybook-screenshots.md`](docs/architecture/storybook-screenshots.md)   | agent visual-feedback loop: generate specs, shoot stories, read PNGs                                                                                                    |
| Plugin system         | [`docs/architecture/plugins.md`](docs/architecture/plugins.md)                               | layout, lifecycle, storage, context facade, permissions, attachment transformers                                                                                        |
| Tools                 | [`docs/architecture/tools.md`](docs/architecture/tools.md)                                   | capability/context gating, `tool_prefs` permissions, presets, compaction/disclosure, memory bridge                                                                      |
| SDD pipeline          | [`docs/architecture/sdd-pipeline.md`](docs/architecture/sdd-pipeline.md)                     | stages, event model, depth profiles, gate protocol, runner commands                                                                                                     |
| afk-runner            | [`docs/architecture/afk-runner.md`](docs/architecture/afk-runner.md)                         | graph kernel over xstate pure transition, fold-is-truth engine, grow-not-restore plan (C1–C7 delivered incl. the live proof), living U-ledger, closed relaxation window |

### Path-scoped `CLAUDE.md` files (read when working under that path)

| Path                         | Covers                                                                                         |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| `src/providers/CLAUDE.md`    | normalized provider interface, capabilities, provider-layer rules                              |
| `src/tools/CLAUDE.md`        | tool assembly, execution wrapping, confirmations, context gating                               |
| `src/commands/CLAUDE.md`     | command handler rules and current command surface                                              |
| `src/chat/CLAUDE.md`         | chat provider interface, capabilities, context rendering, interactions                         |
| `src/mcp/CLAUDE.md`          | external MCP server adapter, connection pooling, tool namespacing                              |
| `tests/CLAUDE.md`            | helpers, mocks, mock reset, E2E guidance                                                       |
| `review-loop/CLAUDE.md`      | review-loop workspace structure, scripts, storage, TDD rules                                   |
| `mutation-improve/CLAUDE.md` | mutation-improve workspace: select/improve pipeline, gates, repoRoot snap, storage, TDD rules  |
| `opencode-agent/CLAUDE.md`   | opencode-agent workspace (spike): GitHub Actions issue agent, phase state machine, local rules |

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
- One TypeScript, 7.x: `typescript` is a **dev dependency** — `tsc` typechecks. TS 7 ships no standalone parser (its AST reaches you only through a project served by a `tsgo` child process), so no scanner uses it: every AST scanner goes through `src/ts-ast/source-parser.ts`, an **async** in-process seam over `oxc-parser` (the parser family Bun's own transpiler uses). Parse results are error-tolerant — a corrupted file yields a partial tree and surfaces through tree-hash comparison, not a parse crash. Import node types from `oxc-parser` (it re-exports `@oxc-project/types`) and traverse with the seam's `walkNodes`/`childNodes` (built on oxc's `visitorKeys`). The parser never spawns, so the hermetic story lane's I/O guard denies every child process (`tests/CLAUDE.md`); a nightly canary typechecks against `typescript@latest` to catch caret-range drift.
- Error extraction: `error instanceof Error ? error.message : String(error)`.
- Use `p-limit` for bounded concurrency over remote ops, not unbounded `Promise.all`.
- **Never add lint-disable or type-ignore comments** — hook policy blocks them; fix the underlying issue.
- A `max-lines` / `max-lines-per-function` failure is a **design signal**: split the file or extract functions; do not game the limit by deleting blank lines or compressing formatting.
- **Smallest thing that works.** After you understand the problem, and before you write code, in order: does this need to exist at all; is it already in this codebase; does the stdlib or an installed dependency already do it; can it be one line. Only then write something new, and write the least of it that resolves the issue. A smaller diff is **not** the goal — never cut validation, error handling, security, or a test to reach one, and never keep code in one file to reach one (that is what the `max-lines` rule above is for). The same rule reaches the review-loop fixer and `opencode-agent` as `MINIMALITY_LADDER` / `MINIMALITY_RULE`, pinned equal by `tests/opencode-agent/minimality-rule.test.ts`.

## Testing Notes

See `tests/CLAUDE.md`. Prefer DI over `mock.module()` where the module supports it. Helpers (`schemaValidates()`, `getToolExecutor()`, `setMockFetch()`, `restoreFetch()`) live in `tests/utils/test-helpers.ts`; `tests/mock-reset.ts` resets common mocks per test. The repo mixes DI-first and legacy delayed-import/mock suites — follow the local pattern unless intentionally refactoring style. Mutation testing (Stryker) runs as a blocking per-file ratchet gate in CI (`test:mutate:changed` on PRs; `scripts/mutation/baseline.json` is the monotonic per-file floor, seeded on master from changed files via `test:mutate:changed --base=HEAD~1 --update-baseline` / `seedMerge`) but is not in the write-hook pipeline. The PR gate judges the **whole branch diff** every run while only **measuring** files whose content changed since the previous run; the rest carry over fingerprint-guarded scores, so a regression from an earlier commit keeps failing later pushes. `--no-score-cache` forces a full re-measure.

## Running and inspecting checks

**Run once, then read. Never re-run a check to filter its output differently.** `bun run test` persists the
whole run to `reports/test/` — log, JUnit index, and a joined `last-run.json`. Every follow-up question is a
read against that artifact, so a second question costs milliseconds instead of another full suite.

| Want                                     | Command                              |
| ---------------------------------------- | ------------------------------------ |
| the failures, with `file:line`           | `bun run test:failures`              |
| one failure's full diagnostic            | `bun run test:show <id>`             |
| a different filter over the same run     | `bun run test:log <pattern> [-C n]`  |
| what the last run was, and if it's stale | `bun run test:status`                |
| where the wall time went                 | `bun run test:slowest`               |
| just the tests a change can reach        | `bun run test:affected [--base=REF]` |

`test:affected` is a static-import heuristic — it cannot see `mock.module()` targets, computed dynamic
imports, or behaviour reached through DI seams, and it says so on every run. Use it in the loop; run the full
suite before committing.

`bun check:full` leaves the same kind of evidence: each check's output stays in `reports/checks/<name>.log`,
and a failure tells you which file to open rather than which command to run again.

Approximate costs on a 4-vCPU container, so a run can be budgeted rather than guessed: full suite ~3–4 min,
`lint` 35 s, `typecheck` 24 s, `knip` 4.6 s, `format:check` 2.9 s, `duplicates` 1.3 s. The query commands are
all sub-second. `bun run test:raw` is the unwrapped escape hatch and writes no report.

**Shared-host rules.** The wrapper picks its own mode — explicit `--serial`/`--parallel` > truthy `CI` >
1-minute load ≥ 0.75 × cores (demotes a many-core host to serial, raises the per-test timeout to 30 s, and
prints `(serial · load)` in the summary; loadavg 0, the Windows shape, never demotes) > core count — and
mirrors the child's output live to stderr whenever stdout is not a TTY, so a piped run is never silent. On a
machine shared with other agents: use `bun run test:affected` in the edit loop and run one full suite before
finishing; never run two full suites concurrently; prefer serial and budget a ≥ 20 min shell timeout for a
full run. If a shell timeout kills a run, query `bun run test:status` / `test:log` before restarting — the
persisted report may already answer. A load-induced flake is re-run file-by-file (`bun run test <paths>`)
before being called a regression.

## Pi Workflow

When the harness supports `obra/superpowers` skills, preserve that workflow for what it still owns (see the routing table). Load `using-superpowers` at session start before acting; load any other applicable skill before responding, editing, or running commands; do not rely on memory of skill contents — load the current text each time.

Planning runs on OpenSpec in this repo: code-behavior work enters through `/opsx:explore` / `/opsx:propose` and lives under `openspec/changes/<name>/`; `brainstorming` keeps non-code creative work only. A proposal must justify each capability it declares and route declined scope into Non-goals (`openspec/config.yaml` `rules.proposal`); that governs what a change **admits**, never how tasks are divided — see [Admission vs division](docs/architecture/sdd-pipeline.md#admission-vs-division).

| Trigger                                         | Route                                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------------------ |
| "Let's build / add / change X" (code behavior)  | `/opsx:explore` or `/opsx:propose` — **not** brainstorming                           |
| Non-code creative work (docs, process, writing) | brainstorming (unchanged)                                                            |
| Bug / test failure                              | systematic-debugging; if root cause becomes a change, `/opsx:propose`                |
| Inside `/opsx:apply`                            | test-driven-development, verification-before-completion                              |
| Autonomous SDD pipeline (`/sdd:auto`)           | `docs/architecture/sdd-pipeline.md`; use `/sdd:auto <task-file>` for end-to-end runs |
| Plan drifted from code                          | syncing-plan-with-code against `openspec/changes/<name>/` artifacts                  |

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

## Workflow files

`bun workflows:lint` (pinned, checksum-verified actionlint; also the `Workflow Lint` CI job). An invalid workflow is **not** a red build — GitHub rejects the file, starts no job, and every other check stays green, so this is the only thing that catches one. Suppressions live in `.github/actionlint.yaml`, path-scoped and each carrying the run that proves actionlint is wrong there. Note that `if: >-` opens a folded scalar: a `#` line inside it folds into the expression instead of being a comment, which is what broke `agent-pipeline.yml`.

The shellcheck/pyflakes integrations are deliberately **off**: they run only where those binaries happen to be installed, so leaving them on makes the gate answer differently on a laptop than on a runner — and a bad `run:` block is already a red job, which is the opposite of what this gate is for.
