<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Client-bundle build in the measurement path — Design

## Problem

Running the default local test suite (`bun test`) or a local coverage/check run reports **3 failing tests**, all in `tests/debug/`, all from one root cause: the client bundles are not built. `public/` holds only `mockServiceWorker.js` — the production bundles (`debug.{js,html,css}`, `admin.{js,html,css}`, `settings.{js,html,css}`) are absent. Both debug suites deliberately **fail fast** in `beforeAll` via `ensurePublicBuilt()` rather than build inside a test worker (a full client build per worker silently adds many seconds).

The three failures:

1. `tests/debug/debug-smoke.test.ts` — `ensurePublicBuilt()` throws in `beforeAll` (`Missing client bundles in public/ (debug.js, debug.html, debug.css)`).
2. `tests/debug/debug-smoke.test.ts` — a **cascade**: because `beforeAll` threw before assigning `db`, `afterAll`'s `db.close()` throws `TypeError: undefined is not an object (evaluating 'db.close')`.
3. `tests/debug/server.test.ts` — `ensurePublicBuilt()` throws in `beforeAll` (missing debug + admin + settings bundles).

**Why it matters:** these failures pollute any local measurement. Items 1–2 of this initiative add a CI line-coverage floor and wire coverage collection into the check run; you cannot trust a local coverage number or a "green suite" claim while 3 tests fail for an environmental reason. This work makes the measurement path deterministically green so downstream coverage measurement is trustworthy.

**Why CI is already fine:** `.github/workflows/ci.yml`'s `build` job runs `bun build:client` and uploads `public/` as an artifact; the `check` and `stories` jobs **download that artifact** into `public/` before running. So in CI the bundles are present, the debug suites run for real, and coverage measures them. The gap is **local** measurement runs only.

## Decision

Keep the debug suites **strict** — the missing-bundle precondition is real and the fail-fast is intentional. Instead, **build the client in the measurement path**: the local entry points that measure coverage / run the full suite build the bundles first, guarded so the build is skipped when the bundles already exist. This is the option chosen during brainstorming ("Keep strict, build in measurement path").

Rejected alternatives:

- **Graceful `describe.skipIf` when bundles are missing** — would keep ad-hoc `bun test` green, but silently drops the debug routes from local coverage and weakens the suite. Not chosen.
- **Unconditional `bun build:client` prepended to the scripts** — rebuilds every run (~seconds) and duplicates CI's build; wasteful. Not chosen.
- **A Bun global preload that builds** — the only natural preload hook is `tests/setup.ts`, which is refactor-frozen (editing it moves the 0Q story `treeHash`). Off the table.

## Architecture

A single presence-guarded build guard, invoked by the local measurement entry points. It is a no-op when the bundles already exist (including CI, where the artifact is present), and builds exactly once when they are missing.

```
bun test:coverage ─┐
                   ├─> scripts/ensure-client-built.ts ──(missing?)──> bun build:client ──> public/*.{js,html,css}
scripts/check.sh ──┘                                  ──(present?)──> no-op
```

### Component 1 — `scripts/ensure-client-built.ts` (new)

DI-shaped so the decision logic is unit-testable without running a real (slow) build.

- `REQUIRED_BUNDLES: readonly string[]` — the union both debug suites assert on:
  `['debug.js','debug.html','debug.css','admin.js','admin.html','admin.css','settings.js','settings.html','settings.css']`.
- `missingBundles(publicDir: string, required: readonly string[]): string[]` — pure fs presence check; returns the subset of `required` not present in `publicDir`.
- `type EnsureDeps = { publicDir: string; required: readonly string[]; missing: (publicDir: string, required: readonly string[]) => string[]; build: () => void; log: (message: string) => void }`
- `ensureClientBuilt(deps: EnsureDeps): 'present' | 'built'` — computes missing bundles; if none, logs a one-line "bundles present, skipping build" notice and returns `'present'`; otherwise logs which bundles are missing, calls `deps.build()`, and returns `'built'`.
- `main(): void` — wires real deps: `publicDir` = repo `public/`, `required = REQUIRED_BUNDLES`, `missing = missingBundles`, `build` = spawn `bun build:client` synchronously (inheriting stdio; throw on non-zero exit), `log` = `console.error`. Invoked when the module is run directly.

The guard checks **presence only**, not staleness. Staleness rebuild (bundle present but out of date vs `client/` sources) is explicitly out of scope: developers rebuild with `bun build:client`, and CI always builds fresh. Adding mtime/hash comparison would be YAGNI for the goal of "make measurement trustworthy."

### Component 2 — wiring the measurement path

- **`scripts/check.sh`** (not frozen; safe to edit): before the parallel check fan-out, if the active `checks` array contains `test` and the required bundles are missing, run `bun scripts/ensure-client-built.ts` synchronously. This guarantees the bundles exist before the `test` check subshell (which Item 1 extends with `--coverage`) spawns. The guard is skipped entirely in `--skip-tests` / staged fast-path runs where the `test` check is filtered out, and is a no-op in CI where the artifact is already present.
- **`package.json`**: `"test:coverage": "bun scripts/ensure-client-built.ts && bun test --coverage"` so the ad-hoc coverage command is self-sufficient.
- **`.github/workflows/ci.yml`**: **no change.** The `build` job → artifact → `check`/`stories` download flow already places bundles in `public/` before any measurement; the guard is a no-op there. Recorded here as a deliberate non-change so a plan reader does not "fix" CI.

### Component 3 — debug suites stay strict

`ensurePublicBuilt()` in both `tests/debug/debug-smoke.test.ts` and `tests/debug/server.test.ts` is unchanged. The precondition remains a hard fail-fast; ad-hoc `bun test` without a prior build still fails by design (the fix targets the measurement path, not ad-hoc runs).

### Component 4 — teardown hardening (included; separable)

`tests/debug/debug-smoke.test.ts` currently declares `let db: Database` and calls `db.close()` unconditionally in `afterAll`. When `beforeAll` throws (bundles missing) before assigning `db`, the `afterAll` teardown throws a second, confusing `TypeError`. Change the declaration to `let db: Database | undefined` and guard the teardown with `if (db !== undefined) db.close()` (explicit guard, not optional chaining — `oxc/no-optional-chaining` is an error rule). This collapses a bundle-less ad-hoc run of that file to a single clear "run `bun build:client`" message instead of two failures.

This item is **not required** for the measurement goal (with bundles present there is no cascade) and was flagged as separable during brainstorming; it is included here as strictly-correct teardown hygiene and may be dropped at spec review without affecting the rest of the design.

## Data flow

1. A local measurement command runs (`bun test:coverage`, or `bun check:full` → `check.sh` with the `test` check active).
2. The guard runs first: `missingBundles(public/, REQUIRED_BUNDLES)`.
3. If any are missing → `bun build:client` runs once, populating `public/`; if none → immediate no-op.
4. The suite runs with bundles present → the debug suites' `ensurePublicBuilt()` passes → the debug routes are exercised and measured.

## Error handling

- `build()` spawns `bun build:client` synchronously with inherited stdio; a non-zero exit throws, so a broken client build fails the measurement run loudly rather than proceeding to a misleading "3 failing tests" state.
- `missingBundles` treats a missing `public/` directory the same as missing files (all `required` reported missing) — no throw for the common "never built" case.
- Error extraction where applicable: `error instanceof Error ? error.message : String(error)`.

## Testing

- **`missingBundles`** (pure): temp dir with none / some / all required files present → asserts the exact missing subset (including the empty array when all present).
- **`ensureClientBuilt`** (DI): fake `missing` + `build` spy + `log` spy.
  - All present → returns `'present'`, `build` not called.
  - Some missing → returns `'built'`, `build` called exactly once, log names the missing bundles.
- The real `bun build:client` invocation is exercised implicitly by running `check.sh` / `bun test:coverage` locally; it is not unit-tested (slow, and it is the existing, separately-owned build entry point).
- **Component 4** is verified by the existing debug suites: with bundles present (the measurement path) both suites pass unchanged; the teardown guard only changes behavior on the already-failing bundle-less path.

## Scope

Single, focused change: one new guard script (+ its unit test), two wiring edits (`check.sh`, `package.json`), one optional 2-line test hardening, and a documented CI non-change. One implementation plan.

## Constraints

- Runtime **Bun 1.3.13**; strict TypeScript; **`.js` import extensions**.
- BUSL-1.1 license header on every new/edited `.ts` (4-line `//` form) and this `.md` (HTML comment) — else `bun check:full`'s `license-headers` check fails.
- No lint-disable / type-ignore comments; `oxc/no-optional-chaining`, `typescript/explicit-function-return-type`, and `typescript/no-explicit-any` are error rules — annotate return types, narrow `unknown`, and use explicit `undefined` guards rather than `?.`.
- Do **not** edit any refactor-frozen input: `tests/setup.ts`, `tests/mock-reset.ts`, `tests/utils/test-helpers.ts`, `tests/utils/logger-mock.ts`, `bunfig.toml`, `tests/stories/**`, `scripts/story/**`. (`scripts/check.sh` and `package.json` are not frozen.)
- Do not weaken the debug suites' `ensurePublicBuilt()` fail-fast.
