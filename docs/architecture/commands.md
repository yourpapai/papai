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
- `bun run test` — all ordinary server-side suites; **excludes client, E2E, and every file under `tests/stories/**`** via `bunfig.toml`. Runs `bun test --parallel`(one worker process per file, implies`--isolate`), the project default. On a 12-core machine this is ~2.5x faster than serial. In CI (`CI=true`), `scripts/check.sh`runs the suite **serially** instead — worker-per-file on a 4-vCPU hosted runner, on top of the other concurrent checks, exhausts the VM and gets the runner shut down mid-job. Bare`bun test`(Bun's built-in runner, not the script) still runs **serially** — Bun has no`bunfig.toml`key for`--parallel`, so use `bun run test`or`bun test --parallel`for the fast path.`bun test:serial` is the explicit serial escape hatch for debugging isolation-sensitive failures. Note: tests must be isolation-clean (no cross-file shared state, no fixed-wall-clock timing assertions — poll for conditions instead) since each file runs in its own process.
- `bun test:client` — `tests/client/` with happy-dom (`tests/client-setup.ts`).
- `bun test:stories` — **Tier 0: Hermetic Full-Stack Stories**. Runs deterministic user stories through the real in-process runtime, chat routing, LLM tool loop, settings routes, task operations, and plugin lifecycle. It uses fake chat/task/LLM/HTTP transports, seed `41021` by default, and writes `reports/stories/manifest.json` plus `reports/stories/junit.xml`. Each child runs from a runner-owned session: an immutable captured `app/` snapshot, a verified read-only lock-keyed dependency snapshot, writable `tmp/`, and only pre-created report files. This fast regression tier complements rather than replaces provider-real E2E.
- `bun test:stories:contracts` — explicitly runs the unit/contract suites under `tests/stories/harness/**` without the per-scenario preload. This is the only supported replacement for the coverage intentionally removed from default Bun discovery; CI runs it before the frozen user stories through the same Linux sandbox.
- `bun test:stories:stress` — repeats each Tier 0 story ten times with randomized order and the same explicit default seed. It has no retry-on-failure behavior: every repetition is evidence, not a flaky-test retry. The scheduled/manual stress workflow runs it exactly once through the same Linux sandbox used on pull requests.
- `bun test:stories:manifest` — runs the launcher in `--manifest-only` mode: it writes only the current frozen-tree manifest to `reports/stories/manifest.json`, removes any stale JUnit report, and exits without discovering or spawning story tests. The manifest hashes raw bytes and POSIX-relative paths for every regular file under `tests/stories/**`; the enforcement surface `scripts/story/**`; and the auxiliary runner inputs `bunfig.toml`, `tests/setup.ts`, `tests/mock-reset.ts`, `tests/utils/test-helpers.ts`, and `tests/utils/logger-mock.ts`. Logical scenario IDs are extracted only from story tests and use `<path>#<literal scenario name>` for both `scenario(...)` and nested `executeScenario(...)` calls; checkpoints are sorted `then` call chains such as `then.task.exists`. Logical scenario count can therefore exceed JUnit test count.
- `BASE_REF=<baseline-sha> bun test:stories:compat` — captures the current frozen inputs once, compares those exact bytes and scenario metadata with committed Git blobs at the explicit ref, then executes the child from the immutable session `app/` snapshot: frozen story/preload/harness bytes plus captured candidate runtime inputs. The candidate runtime therefore remains the code under test, while later live-worktree mutation cannot change any child input. Baseline comparison reads only committed Git blobs and never installs or uses a historical dependency tree. `--baseline-ref=<ref>` (separated or with `=`) is the CLI equivalent and activates compatibility preflight without requiring a separate `--compat`. Compatibility mode never guesses `master` or another baseline, and commit/Bun-version/seed metadata alone do not make two manifests incompatible. Add `--manifest-only` for a preflight-only run that never starts the child and leaves no JUnit report.
- `bun test:e2e` — Docker-backed Kaneo E2E (`tests/e2e/bun-test-setup.ts`).
- `bun test:mutate:changed` — paired mutation run vs `origin/master`; this is what CI uses.
- `bun test:mutate:file <paths...>` — fast per-file paired run (`ignoreStatic:false` + companion tests), bypasses the static-bucket artifact.
- `bun check` — staged-file lint/typecheck/format; `bun check:full` runs `scripts/check.sh`.
- `bun check:bundle-isolation` — asserts the dev-only `client/stories/**` harness never leaked into production bundles.

Other scripts (`lint`, `lint:fix`, `format`, `knip`, `duplicates`, `typecheck`, `security`, `changelog:*`, `review-loop:*`, `storybook`) do what their names imply.

## Hermetic story qualification

The story launcher starts Bun with `--no-env-file` and runs it through the pinned `docker.io/oven/bun:1.3.13@sha256:87416c977a612a204eb54ab9f3927023c2a3c971f4f345a01da08ea6262ae30e` OCI image on **every** supported host (Linux, and macOS via Docker Desktop; Windows is not supported yet and fails closed with an actionable error): read-only source/dependency mounts, no network, dropped capabilities, and no-new-privileges. There is no native-sandbox fallback — before any session creation, fixture discovery, or child spawn, the launcher verifies Docker availability and that the exact pinned image runs Bun 1.3.13, and fails closed with exit code 2 when either check fails. Unsupported platforms fail closed rather than falling back to JavaScript-only isolation. The child inherits only sanitized runner variables, works from the captured `app/` snapshot, and can write only its session `tmp/` root and exact pre-created report files. Dependencies are never copied per run: the sealed lock-keyed cache entry is bind-mounted read-only at `/session/app/node_modules`, with the session `app/` tree providing an empty read-only mountpoint. The cache is keyed by raw `package.json`, raw `bun.lock`, Bun version, and the container platform (`--os`/`--cpu` from the pinned image, so a macOS host installs the Linux dependency closure); acquisition fingerprints the tree once at creation and re-checks only the seal afterwards. The candidate report manifest records the dependency key, tree fingerprint, and the runner-selected sandbox backend (always `linux-docker`) alongside frozen-harness and candidate-runtime hashes. Historical baseline manifests deliberately omit candidate-only dependency and backend evidence. The preload remains defense-in-depth diagnostics for scenarios, resource leaks, and declared HTTP routes; it is not the hermeticity boundary.

Tier 0.1 contracts and Tier 0 stories run through Linux isolation on every pull request. The scheduled/manual stress lane uses the identical backend and runs once without retries. CI verifies the Docker daemon and pinned image before it runs any story child, and retains `reports/stories/**` even after failures.

Before parsing arguments, the parent removes only its standard `manifest.json` and `junit.xml` paths so stale evidence cannot survive an invalid invocation or setup failure; caller-selected reporter paths are never deleted. Both removals are attempted independently, but any non-`ENOENT` cleanup failure refuses the run before parsing, building, or spawning. A successfully built candidate manifest is published atomically before compatibility, discovery, or child startup; a failed write or rename also removes its temporary file. The runner-owned session is removed after success, failure, spawn rejection, or forwarded termination, and only after the child plus report handling have settled. Consequently, preflight/discovery/spawn failures retain the current manifest but no JUnit report, while a started child produces a current JUnit report whether its tests pass or fail. Seed and rerun values use Bun's unsigned decimal token form (`+` and leading zeroes are accepted; whitespace, minus signs, decimals, and exponents are rejected).

Qualification freezes all of `tests/stories/**`, the listed enforcement scripts, and the auxiliary Bun/test-support inputs byte-for-byte, not just files ending in `.story.test.ts`. A refactor may change production/runtime composition, but it must not change frozen harness, fixture, preload, story, launcher, manifest, guard, test setup, or test-helper bytes while claiming compatibility with a recorded baseline. The explicit baseline commit must already contain every frozen file; an older ref fails actionably by listing them as added candidate files.

To establish a baseline on master:

1. Run `bun test:stories:contracts` and `bun test:stories`, then commit the complete harness and enforcement scripts.
2. Record that commit SHA and the `treeHash` from `reports/stories/manifest.json` (CI also retains both in the manifest artifact).
3. Rebase the refactor branch onto that exact baseline commit.
4. Run `BASE_REF=<baseline-sha> bun test:stories:compat --manifest-only` for the exact preflight proof. It reads baseline blobs directly from Git and fails with added/removed/changed paths without starting the story child. Then run `BASE_REF=<baseline-sha> bun test:stories:compat` to preflight again and execute the unchanged suite.

Neither normal nor compatibility runs retry failures. `reports/stories/**` is ignored build output and must not be committed.

## TDD Enforcement (Hooks)

Every `Write`/`Edit`/`MultiEdit` on an implementation file in `src/` or `client/` triggers an automated hook pipeline enforcing Red → Green → Refactor; it runs checks sequentially and **blocks** on failure.

**Scope** — only implementation files: path starts with `src/`/`client/`, extension `.ts`/`.js`/`.tsx`/`.jsx`, not a test (`*.test.*`/`*.spec.*`). Everything else passes through, but test-file edits still verify the changed test passes. The `client/` tree mirrors `src/` for test resolution (`client/debug/foo.ts` → `tests/client/debug/foo.test.ts`).

**Pipeline** — before write: (1) write-policy gate, (2) test-first gate, (3) API surface snapshot. After write: (4) test tracker for new tests, (5) import gate for tests under `tests/`, (6) targeted test run + coverage regression check, (7) API surface diff check.

**Write protections (blocked escape hatches):**

- `.oxlintrc.json` is protected from direct write-tool edits.
- Inline suppressions (`eslint-disable`, `oxlint-disable`, `@ts-ignore`, `@ts-nocheck`) are blocked before writes complete.
- Bash-hook policy blocks `git stash` and `git checkout --`.

Fix the underlying issue rather than bypassing linting or hook policy.
