<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: CI line-coverage floor (ratchet)

**Status:** proposed

**Date:** 2026-07-24

## Context

The tier expansion roadmap (`2026-07-23-tier-expansion-roadmap-design.md`) built
a machine-checked scenario catalog and process-real smoke lane, but the repo has
no gate on **code coverage**. `test:coverage` (`bun test --coverage`) exists yet
runs nowhere in CI, and `bunfig.toml` carries no coverage config. A measured
baseline of the in-process suite (unit + integration; `tests/stories`, `tests/e2e`,
`tests/client`, `tests/visual` are excluded by `bunfig.toml`'s `pathIgnorePatterns`)
is **92.33% line / 91.20% function** over production code (`src/` + `plugins/`;
`coverageSkipTestFiles` defaults to `true`, so test files are not counted).

Without a floor, a global refactor can silently drop whole modules out of test
without any red signal. This spec adds a coverage floor that (a) fails CI on any
decline below a committed floor and (b) ratchets the floor upward as coverage
improves.

Scope note: this floor measures the **in-process suite only** — the same suite
that runs today as the `test` check inside `scripts/check.sh`. Measuring the
refactor-resilient tiers (T0 stories, T1/T2) is a separate effort
(`2026-07-24-t0-story-runner-coverage-design.md`, forthcoming).

## Goals

- Production-code (`src/` + `plugins/`) coverage of the in-process suite cannot
  silently decline below a committed floor.
- The floor ratchets upward — it never moves down, and rises as coverage grows.
- Zero extra suite runs in CI (coverage piggybacks the run that already happens).
- Local `check:full` and every non-coverage `bun test` invocation are unaffected.

## Non-goals

- Coverage of the T0 story lane or the T1/T2 Docker tiers (separate specs).
- Per-file coverage floors (a possible future ratchet refinement).
- Branch/statement gating (function + line only for now).
- Mutation-score gating (separate effort; the disabled `mutation-testing` job).

## Design

### 1. `bunfig.toml` `[test]` additions (native enforcement)

```toml
coverageThreshold = { lines = 0.90, functions = 0.90 }
coverageReporter  = ["text", "lcov"]
coverageDir       = "reports/coverage"
```

- `coverageThreshold` makes `bun test --coverage` exit non-zero when below the
  floor. Committed floor starts at `0.90 / 0.90` — a low-flake epsilon below the
  92.33 / 91.20 baseline. The ratchet script (below) re-tightens it from stable
  green runs.
- **`coverage = true` is deliberately NOT set.** Coverage stays opt-in and is
  enabled only where `--coverage` is passed (the CI `test` branch). Consequently
  the `stories`, `e2e`, `smoke`, and `test:client` runs, and local
  `check:full --parallel`, never trigger the threshold.
- `coverageSkipTestFiles` is left at its default (`true`) so the floor reflects
  production code only.

### 2. `scripts/check.sh` — CI branch of the `test` check

The `test` check already runs serially in CI (the `[ "${CI:-}" = "true" ]`
branch, to avoid OOM under `--parallel`). Add `--coverage` there only:

```bash
if [ "${CI:-}" = "true" ]; then
  bun test --coverage --timeout 15000 >"$TMPDIR/$fname.out" 2>&1 || exit_code=$?
else
  bun test --parallel --timeout 15000 >"$TMPDIR/$fname.out" 2>&1 || exit_code=$?
fi
```

The local `--parallel` branch is unchanged: coverage under worker-per-file
`--parallel` is unreliable and would slow local checks. Result: the floor is
enforced exactly once, inside the existing `check` job, with **no additional
suite run**.

### 3. Ratchet mechanism — `scripts/coverage/ratchet.ts` + `coverage:ratchet`

Bun's `coverageThreshold` is static, so "no decline + ratchet up" needs a helper.

- **Enforcement is bun-native.** CI fails when coverage < committed floor. CI
  never writes to the repo.
- **Ratcheting up is an explicit local command.** After a green run a developer
  runs `bun coverage:ratchet`, which:
  1. parses `reports/coverage/lcov.info` for aggregate line and function %,
  2. if measured (minus a small epsilon, e.g. 0.5 pt) exceeds the committed
     `coverageThreshold` values, rewrites those two numbers in `bunfig.toml`,
  3. prints the diff for the developer to commit.
  The floor only ever moves up; it is never lowered by the script.
- A `--check` mode (parse lcov, compare, exit non-zero if below) exists for local
  parity with CI and clearer messages, but CI relies on bun-native enforcement.

### 4. Coverage artifact (nice-to-have)

The `check` job uploads `reports/coverage/lcov.info` (mirroring the `stories`
job's report upload), so per-run coverage is inspectable and trend is visible.

### 5. Docs

Add a short subsection to `tests/CLAUDE.md`: coverage is gated in CI, the floor
lives in `bunfig.toml`, and `bun coverage:ratchet` raises it from a green run.

## Dependencies

- **Item 5 (fix 3 failing tests) is a hard prerequisite for locking the exact
  ratchet baseline.** The suite currently has 3 failing tests, so a clean 100%-green
  coverage number is not yet available. Plan: land this mechanism now with the
  provisional `0.90 / 0.90` floor; run `bun coverage:ratchet` to lock the tightened
  floor only after Item 5 lands green.

## Risks & mitigations

- **Flake at a tight floor** → committed floor starts at `0.90 / 0.90` (well below
  baseline); ratchet only from stable green runs.
- **CI memory** → coverage instrumentation adds RAM to the already-parallel
  12-check bundle; `check.sh` already documents OOM sensitivity on 4-vCPU runners.
  Monitor the `check` job after landing; fall back to a dedicated serial job if it
  destabilizes.
- **Partial local coverage runs** → `bun test --coverage <subset>` now "fails" the
  threshold on a subset. Expected; documented in `tests/CLAUDE.md`.
- **Non-determinism in which files load** (skipped Docker tests, conditional
  imports) can nudge the aggregate; the epsilon in the ratchet absorbs this.

## Testing / verification

- `bun test --coverage` locally exits 0 at/above the floor; temporarily raising the
  floor above actual makes it exit non-zero (proves the gate bites).
- `bun run check:full` locally (parallel, no `--coverage`) is unchanged and green.
- `bun coverage:ratchet` on a green run bumps the floor upward and is a no-op when
  coverage has not improved.
- The `check` CI job uploads a non-empty `lcov.info`.
