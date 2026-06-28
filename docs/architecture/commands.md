<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Commands

> Referenced from `CLAUDE.md`. Run scripts as `bun <script>`. Full list is in `package.json`; below are only the ones with non-obvious semantics.

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
