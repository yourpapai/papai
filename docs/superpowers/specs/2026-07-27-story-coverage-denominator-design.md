<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# T0 story coverage: fix the denominator

**Date:** 2026-07-27
**Status:** approved, not implemented
**Scope:** Phase 0 prerequisite. Changes what the T0 story coverage gate measures. Changes no product code and no test coverage.

## Problem

The T0 story coverage gate reports a number that cannot be ratcheted toward a
target, for two reasons.

First, it averages over every record in the lcov, including `tests/**`. Those 29
records sit at 83.3% lines and inflate the reported figure without representing
any product code.

Second, lcov only contains records for files the run actually loaded. Files no
story ever imports produce no record at all, so they vanish from the average
instead of counting as 0%. On today's artifact that hides 206 files.

The combined effect: the gate reports coverage of the code that already ran,
which is close to a tautology. Coverage can only improve by covering more of
what was already loaded, and the largest body of untested code is invisible to
the instrument.

## Measurements

Taken from `reports/stories/coverage/lcov.info` (354 tests, 0 skipped) using the
gate's own arithmetic. The final baseline must come from a clean
`bun test:stories:coverage` run; these figures are estimates that establish
magnitude and direction.

| Measurement | Lines | Functions |
| --- | --- | --- |
| Current gate (all 720 records) | 54.90% | 47.29% |
| Dropping `tests/**` only | 53.53% | — |
| Scoped and seeded (this design) | 43.37% | 37.06% |

Record composition: 682 `src/`, 29 `tests/`, 6 `plugins/`, 2 `scripts/`, and one
leaked temp fixture (`../tmp/papai-scenario-settings-plugin-UPLZMT/index.mjs`).

`src/` and `plugins/` hold 894 `.ts` files; 688 appear in the lcov and 206 do
not. Of those 206, 22 are `*.testing.ts` and 24 transpile to nothing — disjoint
sets, 46 excluded in total. The remaining 160 are seeded as 0%, giving a
denominator of 687 measured plus 160 seeded, or 847 files.

Because the metric is an unweighted per-file mean, dropping `tests/**` moves the
figure by only 1.4 points — 29 records out of 720. Nearly the whole correction
comes from seeding.

## Decisions

### Denominator: in-scope product files only

In scope: `**/*.ts` under `src/` and `plugins/`, excluding `*.testing.ts` and
excluding files that transpile to nothing.

`*.testing.ts` files are test doubles that live under `src/` for import-path
convenience. Excluding `tests/**` while counting them would be incoherent.

Excluding files with no coverable lines is not a new carve-out. `meanMetric` in
`scripts/coverage/ratchet-lib.ts` already drops records with `found === 0` from
the mean. Seeding a type-only file as 0% would make the metric mean different
things depending on whether a file happened to be loaded. Under a per-file mean
each such file costs `1/N` permanently, and no later phase could ever remove it.

Detection uses `Bun.Transpiler`: a file whose transpiled output is empty
provably has zero coverable lines. This classifies exactly 24 files, all of them
type modules. It is a decision procedure, not a heuristic.

`client/` is deliberately not a scope root. The story lcov contains no `client/`
records and the T0 stories do not drive the SPA. This boundary is defensible but
arbitrary, and is a reasonable thing for a later phase to revisit.

### Structure: a new module, story gate only

`parseLcovTotals` is shared with `ratchet.ts`, which gates the main `floor.json`
at 0.90 and measures 92.45%. Applying the same scoping rule there would move it
to 92.50% — still passing — so the blast radius is negligible. The change is
nonetheless kept out of the main gate to match the stated scope of this phase.

Because the policy lives in its own pure module, adopting it for the main gate
later is a one-line import rather than a refactor.

Parameterizing `parseLcovTotals` was rejected. It is currently a clean parser
with good tests; threading policy into it would give one function two jobs.

### Re-baseline: hand-edited, committed with rationale

`nextFloor` is monotonic-up by construction and cannot lower a floor. Moving
`coverage-floor.json` from 0.50 down to the new measurement is therefore a
deliberate manual edit in the implementing commit, whose message must record
that the metric definition changed rather than that coverage regressed.

A `--reset` flag was rejected: it would put a documented ratchet-escape in the
toolchain, available to anyone facing a red gate.

## Architecture

### New module: `scripts/coverage/story-scope.ts`

Split into a pure core and an IO edge so the arithmetic is testable against
literal inputs.

```ts
export const STORY_SCOPE_ROOTS = ['src/', 'plugins/'] as const

/** In scope: .ts under a scope root, excluding *.testing.ts doubles. */
export function isScopedSourceFile(file: string): boolean

export type ScopedLcov = Readonly<{ lcov: string; seeded: readonly string[] }>

/** Pure. Drops out-of-scope records, appends a zero record per unloaded file. */
export function scopeLcov(lcov: string, sourceFiles: readonly string[]): ScopedLcov

/** IO edge. Globs the roots, filters by isScopedSourceFile, drops files that
 *  transpile to nothing. */
export async function discoverScopedSourceFiles(cwd: string): Promise<readonly string[]>
```

`discoverScopedSourceFiles` is injected into callers rather than imported by
`scopeLcov`, so the pure function takes a literal array in tests and never
touches disk.

Neither `src/` nor `plugins/` contains `.d.ts` or `.tsx` files, so the glob is
`**/*.ts`.

### Synthetic records

Seeded files are emitted as `LF:1 / LH:0 / FNF:1 / FNH:0`.

This is exact for `pct`: an unloaded file contributes 0 to the mean regardless
of its real line count, and `pct` is the only field the gate, the ratchet, and
the formatter consume. It does mean the pooled `found` and `hit` fields
under-report unloaded files. This is a known wart, preferred over inventing line
counts the coverage tool never produced, and must be documented in the module.

### Data flow

Upstream is unchanged: the story runner still copies and SF-normalizes the child
lcov to `reports/stories/coverage/lcov.info`. Each story-side consumer gains one
step before its existing call.

```
gateStoryCoverage:  read lcov -> discover -> scopeLcov -> evaluateStoryCoverage -> compare to floor
ratchet-stories:    read lcov -> discover -> scopeLcov -> parseLcovTotals       -> nextFloor
```

Both consumers must read through `scopeLcov`. If the gate measured the scoped
figure while the ratchet measured the unscoped one, the next green run would
raise the floor above what the gate can ever produce and the gate would fail
permanently.

`evaluateStoryCoverage` and `parseLcovTotals` keep their current signatures. The
scoping happens in the caller, so their existing tests stay valid and
`ratchet.ts` is not in the diff.

### Output

The gate line gains the scope breakdown, so the denominator is visible rather
than mysterious. The seeded count is also what later phases drive down, so it
doubles as the progress signal.

```
T0 story coverage: lines 43.37% (floor 43.00%), functions 37.06% (floor 37.00%)
  scope: 687 measured, 160 unloaded seeded as 0%, 847 files
```

## Error handling

The dangerous failure is silent. If `discoverScopedSourceFiles` returned an
empty list, seeding would no-op and the gate would quietly revert to the old
inflated figure while still printing a pass.

- A missing scope root, or a root yielding zero files, throws. A broken
  invocation must not read as good news.
- A transpile failure throws rather than being treated as "transpiles to
  nothing". That path *removes* a file from the denominator and would hide real
  debt.

## Edge cases

| Case | Resolution |
| --- | --- |
| Record in scope, file absent from disk | Keep the record. It was executed by the run that just produced the lcov. |
| Record out of scope | Dropped. Removes the leaked temp fixture and the two stray `scripts/` records. |
| File both loaded and in the discovered list | Seeded only when it has no record. No double-counting. |
| Empty lcov | Every discovered file is seeded; the figure is 0% and the gate fails. |

## Testing

New `tests/scripts/story-coverage-scope.test.ts`:

- `isScopedSourceFile`: in-scope file, out-of-scope root, `*.testing.ts`.
- `scopeLcov` against literal lcov strings: drops out-of-scope records, seeds
  unloaded files, does not double-seed a loaded file, seeds everything on empty
  input, returns a deterministically ordered `seeded` list.
- `discoverScopedSourceFiles` against a temp fixture tree containing one real
  module, one type-only module, one `*.testing.ts`, and one nested plugin file,
  plus both throw cases.

Updated: `tests/scripts/story-coverage-gate.test.ts` and
`tests/scripts/story-coverage-ratchet.test.ts` for the new wiring and the added
scope line.

Unchanged: `tests/scripts/coverage-ratchet.test.ts`, since `parseLcovTotals`
keeps its behavior and signature.

## Rollout

Steps 2 through 4 land as one commit. Step 2 without step 4 is a red gate.

1. Add `story-scope.ts` and its tests, unwired. The repo stays green.
2. Wire `gateStoryCoverage` and `ratchet-stories.ts` through `scopeLcov`, and
   update their tests.
3. Run `bun test:stories:coverage` clean to obtain the real measurement.
4. Hand-edit `coverage-floor.json` to `floor(measured - 0.005)` and commit with
   the rationale above.

## Follow-ups, out of scope here

- New `scripts/` files enter the mutation-testing per-file baseline;
  `scripts/mutation/baseline.json` needs its normal ratchet.
- `tests/CLAUDE.md:178` documents the floor's meaning and should state that the
  denominator now includes never-imported files. Without that, the next reader
  will interpret the falling number as a regression.
- Adopting `scopeLcov` in `ratchet.ts` for a single repo-wide coverage
  definition, which would move the main gate to 92.50% and require re-baselining
  `floor.json` to 0.92.
