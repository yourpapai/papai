# review-loop Workspace

## Purpose

`review-loop/` is a standalone Bun workspace for the shell-invoked autonomous code-review loop runner. It spawns reviewer and fixer `opencode run` agent subprocesses via shell calls with file-based JSON exchange, collects reviewer issues into a durable ledger, and drives multi-round verify/fix cycles. It is local developer tooling, not a papai runtime dependency.

Agent subprocess guards live in `src/spawn.ts` + `src/agent-runner.ts`: besides the wall-clock `timeout`, an optional `inactivityTimeoutMs` watchdog kills a child that produces no stdout (hung LLM stream) and reports `stalled: true`; `runAgent` retries a stall once but never retries a wall-clock timeout. Callers opt in by passing `inactivityTimeoutMs` through `RunAgentOptions` (mutation-improve wires it from `agent.inactivityTimeoutMs`; review-loop's own config does not yet).

## Storage / Artifacts

- The default `workDir` is `.review-loop/` relative to `repoRoot` (see `config.example.json`). The directory is created on demand via `mkdir`.
- `createWorktree` runs `bun install` in the fresh worktree (skipped when no `package.json`): worktrees live under the main checkout so most deps resolve by walking up to its root `node_modules`, but non-hoisted workspace deps (e.g. opencode-agent's `@octokit/rest`) do not, and the build gate fails on TS2307/import errors without the install.
- Per-run state lives at `<workDir>/runs/<runId>/state.json` (see `src/run-state.ts`).
- Progress logs and transcripts land alongside the run state (see `src/progress-log.ts`).
- `config.example.json` at the workspace root documents the expected config shape; real configs are loaded from the path passed via `--config` (defaults to `.review-loop/config.json`). The optional top-level `pricing` map (USD per 1M tokens, glob-matched against the agent model) enables estimated-cost display.

## Run Stats

`src/run-stats.ts` (pure aggregate), `src/cost.ts` (pricing lookup), and `src/diff-stats.ts` (git numstat at worker merges) feed the `LiveRenderer` footer's aggregate segments (total tokens, `~$ est`, tool calls, `+a/-r`) and the final summary's `Stats:` line. Aggregates persist to `metrics.json` (`runStats` block) and rehydrate on `--resume-run`; stats accumulation is independent of the EPIPE downgrade, and segments are hidden when zero/unpriced.

The `LiveRenderer` folds all agent progress into one live line per slot key; `commit(key, line?)` freezes a slot as a permanent scrolled line (line-handler commits on agent dispose unless `commitOnDispose: false`). Non-TTY output prints only `event()`/`commit()` lines — `slot()`/`live()` updates are suppressed.

## Scripts

Run workspace commands from the repo root:

- `bun run review-loop:test`
- `bun run review-loop:typecheck`
- `bun run review-loop:lint`
- `bun run review-loop:format:check`
- `bun run review-loop:start -- --config <path> --plan <path>`

`--plan` is plan-format-agnostic (it parses `- [ ]` checkboxes from any markdown
file resolved against the repo root). For OpenSpec-tracked work, point it at the
change's task list: `--plan openspec/changes/<name>/tasks.md`.

## TDD Hooks

The repo TDD resolver treats `review-loop/src/**` as gateable implementation code and maps it to `tests/review-loop/**`. New review-loop work must follow the same test-first flow used under `src/` and other repo-owned implementation paths.

## Dependencies

- `zod` — runtime config/schema validation (shared with root).
