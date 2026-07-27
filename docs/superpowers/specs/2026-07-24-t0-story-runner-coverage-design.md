<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: T0 story-runner line coverage

**Status:** proposed

**Date:** 2026-07-24

## Context

The CI line-coverage floor (`2026-07-24-ci-line-coverage-floor-design.md`) gates
the **in-process suite only** — unit + integration, with `tests/stories`,
`tests/e2e`, `tests/client`, `tests/visual` excluded by `bunfig.toml`'s
`pathIgnorePatterns`. That leaves the **T0 story lane** — the hermetic,
frozen-test, sandboxed tier that is the primary instrument for proving global
refactors — with no line-coverage signal at all. Today
`scripts/story/coverage-totals.ts` reports only **catalog** coverage (how many
scenarios have executable stories), never the `src/` reachability of the T0 run.

This spec wires real line-coverage collection into the T0 story runner: the
sandboxed child emits lcov, the runner copies and normalizes it, computes the
aggregate `src/` reachability, and gates it against a committed, ratcheting floor.

## Goals

- Measure the real `src/` line/function reachability of the sandboxed, frozen
  T0 story run — the refactor-resilient tier's own coverage number.
- Gate that number against a committed floor that ratchets upward and never down.
- Collect faithfully: coverage reflects exactly what the read-only, frozen-test
  sandbox executes — no separate non-sandboxed measurement path.
- Publish the lcov as a CI artifact for inspection and trend.

## Non-goals

- Coverage of the in-process suite (Item 1 already gates that) or T1/T2 tiers.
- Per-file T0 coverage floors (possible future ratchet refinement).
- Branch/statement gating (line + function only, matching Item 1).
- Changing which scenarios are executable or how catalog coverage is computed.
- Cross-child lcov merging. The runner spawns a **single** sandboxed child over
  all story files (`test-stories.ts` calls `spawnStorySandboxedChild` once, with
  `--rerun-each` forwarded as a bun flag that bun aggregates internally), so each
  run produces exactly one `lcov.info`. A union merge across children is
  unnecessary and is not built. If the runner later shards story files across
  multiple children, a merge step is added then.

## Design

### 1. Collection — the single sandboxed child

`scripts/story/test-stories.ts` gains a `--coverage` flag (off by default). When
set, `scripts/story/child.ts` appends to the child's `bun test` command:

```
--coverage --coverage-reporter=lcov --coverage-dir=<tempRoot>/coverage
```

The coverage directory lives under `tempRoot` because the Linux Docker sandbox
mounts `appRoot` **read-only** at `/session/app`; only `tempRoot`
(`/session/tmp`) and individually bind-mounted report files are writable. The
existing host→container argument translation (`sandbox.ts`) rewrites
`--config=`/`--reporter-outfile=` prefixes; this design extends it to translate
`--coverage-dir=` so the value maps to `/session/tmp/coverage`. The child writes
`lcov.info` there, measuring the **live** `src/` resolved from the read-only
appRoot mount — so the number reflects precisely what the sandboxed, frozen-test
T0 run reaches.

Approach rejected: a dedicated single-invocation `bun test --coverage` over all
story files **outside** the sandbox. That would measure a different execution than
the gated one and bypass the frozen-tree guarantees. Collecting from inside the
real sandboxed run is the only faithful path.

### 2. Extraction + normalization

The child's `lcov.info` sits in `tempRoot/coverage`, which is removed at session
cleanup. The session copies it out **before** cleanup — mirroring the existing
`copyReports()` — to:

```
reports/stories/coverage/lcov.info
```

A single `bun test` run over all story files produces exactly one `lcov.info`
(the runner spawns one child; `--rerun-each` is a bun-internal flag). No
cross-child merge is required.

`SF` (source-file) paths are normalized to repo-relative (`src/…`) during the
copy, stripping any `/session/app/` prefix if bun emits absolute container paths.
If bun already writes paths relative to the container cwd (`/session/app`), the
normalization is a pass-through. This keeps the copied lcov host-usable and keyed
consistently for `parseLcovTotals`.

### 3. Totals, floor, and gate

The copied `lcov.info` is parsed by `parseLcovTotals()` — **reused from Item 1's
`scripts/coverage/ratchet-lib.ts`** — to produce aggregate line and function %.

The T0 floor cannot live in `bunfig.toml`'s `[test].coverageThreshold`: that key
is bun-native for the in-process suite, the story child runs under
`snapshot-bunfig.toml`, and the gate is a **post-run** comparison against the
copied lcov that bun cannot perform. The floor is therefore a small committed
file:

```jsonc
// scripts/story/coverage-floor.json
{ "lines": 0.50, "functions": 0.50 }
```

`test-stories.ts --coverage`, after copying the lcov, compares totals against
this floor and **exits non-zero when below** — the gate for the `stories` CI job.
The floor starts provisional-low (`0.50 / 0.50`) because the T0 number is
unmeasured; it is a hard gate, not epsilon-softened.

Ratcheting reuses Item 1's `nextFloor()` logic via a new
`coverage:ratchet:stories` package script that reads the copied lcov and bumps
`coverage-floor.json` upward. CI never writes; ratcheting is a local command run
after a green measured run.

### 4. CI wiring

The `stories` CI job runs `bun test:stories --coverage` (replacing the plain
call) and uploads `reports/stories/coverage/lcov.info` as an artifact, mirroring
its existing report upload. No extra job — coverage piggybacks the run that
already happens.

### 5. Docs

Add a short subsection to `tests/CLAUDE.md`: the T0 lane reports and gates its own
`src/` line coverage, the floor lives in `scripts/story/coverage-floor.json`, and
`bun coverage:ratchet:stories` raises it from a green run.

## Cross-item interactions

- **Item 1 edits `bunfig.toml`; story children use `snapshot-bunfig.toml`.**
  Item 1's `coverageThreshold` keys never leak into the T0 children, so the
  in-process floor and the T0 floor stay independent. If `test:stories:compat`
  baselines the root `bunfig.toml` bytes, Item 1's edit is a legitimate diff there
  — not snapshot drift.
- **Path translation for `--coverage-dir=<value>`.** This is a flag-with-value.
  If the sandbox argument translator only rewrites bare path arguments (not
  `--flag=path`), it must be extended to translate the coverage-dir value so it
  resolves to `/session/tmp/coverage`. The plan makes verifying this an explicit
  step.

## Dependencies

- **Item 1** — reuses `parseLcovTotals()` and `nextFloor()` from
  `scripts/coverage/ratchet-lib.ts`. Item 1's ratchet library should land first
  (or the shared library is created here and consumed by both).
- **Item 5 (fix 3 failing tests)** — a hard prerequisite for locking the exact
  T0 ratchet baseline. Land the mechanism now with the provisional `0.50` floor;
  run `bun coverage:ratchet:stories` to tighten only after Item 5 lands green and
  a first measured T0 run is available.

## Risks & mitigations

- **Coverage instrumentation slows the sandboxed children** → coverage is
  opt-in (`--coverage`); the default `test:stories` run is unaffected. Monitor the
  `stories` job wall-clock after landing.
- **lcov path drift** (container vs host, absolute vs relative) → the copy step
  normalizes every `SF` to a repo-relative path.
- **coverage-dir not writable / not translated** → directory lives under
  `tempRoot` (writable); the plan verifies arg translation before relying on it.
- **Premature tight floor blocks PRs** → floor starts at `0.50`; only the local
  ratchet raises it, and only from green measured runs.

## Testing / verification

- Unit tests for `SF` normalization: `/session/app/src/x` → `src/x`; an
  already-relative `src/x` passes through unchanged; non-`src/` prefixes are left
  intact.
- Unit test that `parseLcovTotals` on a normalized fixture yields the expected
  aggregate line/function %.
- Unit tests for the floor gate: totals below `coverage-floor.json` → non-zero
  exit; at/above → zero.
- Integration: `bun test:stories --coverage` produces a non-empty
  `reports/stories/coverage/lcov.info`; a floor set above actual makes the run
  exit non-zero (gate bites); the default `bun test:stories` is unchanged.
- `bun coverage:ratchet:stories` bumps the floor upward on a green run and is a
  no-op when T0 coverage has not improved.
