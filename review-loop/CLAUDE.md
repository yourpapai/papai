# review-loop Workspace

## Purpose

`review-loop/` is a standalone Bun workspace for the ACP-based autonomous code-review loop runner. It spawns reviewer and fixer ACP agent subprocesses, collects reviewer issues into a durable ledger, and drives multi-round verify/fix cycles. It is local developer tooling, not a papai runtime dependency.

## Storage / Artifacts

- The default `workDir` is `.review-loop/` relative to `repoRoot` (see `config.example.json`). The directory is created on demand via `mkdir`.
- Per-run state lives at `<workDir>/runs/<runId>/state.json` (see `src/run-state.ts`).
- Progress logs and transcripts land alongside the run state (see `src/progress-log.ts`).
- `config.example.json` at the workspace root documents the expected config shape; real configs are loaded from the path passed via `--config` (defaults to `.review-loop/config.json`).

## Scripts

Run workspace commands from the repo root:

- `bun run review-loop:test`
- `bun run review-loop:typecheck`
- `bun run review-loop:lint`
- `bun run review-loop:format:check`
- `bun run review-loop:start -- --config <path> --plan <path>`

## TDD Hooks

The repo TDD resolver treats `review-loop/src/**` as gateable implementation code and maps it to `tests/review-loop/**`. New review-loop work must follow the same test-first flow used under `src/` and other repo-owned implementation paths.

## Dependencies

- `@agentclientprotocol/sdk` — ACP subprocess protocol (workspace-only).
- `p-limit` — bounded concurrency (shared with root).
- `zod` — runtime config/schema validation (shared with root).
