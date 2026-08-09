<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation Coverage — `src/recurring-utils.ts` Design

**Date:** 2026-08-08
**Status:** Approved
**Scope:** Test-only mutation-coverage improvement for `src/recurring-utils.ts`

## Summary

`src/recurring-utils.ts` exports six small, pure helpers (`parseLabels`,
`parseTriggerType`, `toRecord`, `computeNextRun`, `computeMissedDates`,
`buildCompiled`) that translate between the raw Drizzle `recurring_tasks` row
shape and the domain `RecurringTaskRecord` / `CompiledRecurrence` types. The
file currently scores **0.6** (killed=33, survived=21, noCoverage=1 out of 55
mutants) against its paired test set.

Every surviving mutant lives in a branch or coercion that is only exercised
*indirectly* through the higher-level `recurring.js` lifecycle (which the
existing `tests/recurring.test.ts` covers end-to-end). No companion test file
imports the helpers directly, so the branch-narrowing and string-coercion
mutants slip through. This spec adds a dedicated companion test file
(`tests/recurring-utils.test.ts`) that drives each helper directly with the
exact inputs that distinguish the original from each mutant.

## Why this file

The helpers are the single translation layer between persisted rows and the
in-memory domain model used by the scheduler, the tools, and the stats
endpoints. A mutation that flips `catchUp` parsing or the empty-`labels` guard
silently corrupts every recurring task read from the database. Direct,
input-pinned tests are the cheapest way to lock the coercion semantics down.

## Non-goals

- Editing anything under `src/`, `client/`, `plugins/`, or `scripts/`.
- Editing `scripts/mutation/baseline.json` (the runner owns the ratchet).
- Refactoring `recurring-utils.ts` itself — the implementation is correct; only
  its test coverage is thin.
- Raising coverage of the transitive callers (`recurring.js`, scheduler). Those
  are out of scope for this file's mutation score.

## Gap analysis

Measured with `bun test:mutate:file src/recurring-utils.ts` against the paired
test set (117 covering test files resolved via the coverage map). Surviving
mutants grouped by the branch they mutate:

| Class | Location | Mutant ids (status) | Why it survives |
|-------|----------|---------------------|-----------------|
| A. `parseLabels` empty-string/null guard | line 13 `if (raw === null \|\| raw === '') return []` | 2, 3, 6, 8, 9 (Survived); 4 (Survived, **equivalent**) | No test passes `''` (or `null`) to `parseLabels` and asserts `[]`. The `''` literal, the `\|\|`/`&&` swap, and the returned `[]` literal all go unchecked. |
| B. `parseLabels` non-array guard | line 15 `if (!Array.isArray(parsed)) return []` | 12 (Survived), 13 (NoCoverage) | No test feeds a JSON value that parses to a non-array (`{}`, `5`, `"x"`). |
| C. `parseLabels` string-element filter | line 16 `parsed.filter((v) => typeof v === 'string')` | 14, 16 (Survived) | No test includes non-string elements (`1`, `true`) that the filter must drop. |
| D. `toRecord` `catchUp` coercion | line 39 `catchUp: row.catchUp === '1'` | 33, 34, 35, 36 (Survived) | Existing tests assert `enabled` but never `catchUp`; the `=== '1'` comparison and the `'1'` literal are unguarded. |
| E. `computeNextRun` null branch | line 48 `return next === null ? null : next.toISOString()` | 39 (Survived) | No test feeds a compiled recurrence whose `nextOccurrence` is `null` (an exhausted `COUNT`/past `UNTIL` rule). |
| F. `computeMissedDates` `fromDate` branch | line 52 `fromDate === null ? new Date(0) : new Date(fromDate)` | 42, 44 (Survived); 43 (Survived, **equivalent**) | No test passes a non-null `fromDate` whose `new Date(fromDate)` differs from `new Date(0)`, so the ternary and `===`/`!==` swaps are invisible. |
| G. `computeMissedDates` ISO mapping | line 54 `.map((d) => d.toISOString())` | 45 (Survived) | No test asserts the exact ISO string of a returned missed date, so the arrow-body swap to `() => undefined` is invisible. |
| H. `buildCompiled` null guard | line 62 `if (rrule === null \|\| dtstartUtc === null) return null` | 49, 50, 52 (Survived) | No test passes exactly one `null` argument (`rrule` null + `dtstartUtc` set, and vice-versa), so the `\|\|`→`&&` swap and each side's `=== null`→`false` swap survive. |

**Totals:** 22 survivors (21 Survived + 1 NoCoverage). 20 are killable with
direct tests; 2 are equivalent (see *Accepted residuals*).

## Design — tests to add

All tests live in a new companion file `tests/recurring-utils.test.ts` and
target the helpers directly. Each test maps 1:1 onto one gap class. Every
assertion uses exact equality (`toBe` for scalars, `toEqual` for arrays/objects)
on values that are fully knowable (no `startsWith` / `toContain`).

| Test (class) | Target helper & input | Exact assertion(s) | Kills |
|--------------|----------------------|--------------------|-------|
| A — empty guard | `parseLabels('')` and `parseLabels(null)` | `toBe([])` via `toEqual([])` | 2, 3, 6, 8, 9 |
| B — non-array guard | `parseLabels('{}')`, `parseLabels('5')` | `toEqual([])` | 12, 13 |
| C — string filter | `parseLabels('["a",1,true,"b"]')` | `toEqual(['a','b'])` | 14, 16 |
| D — catchUp coercion | `toRecord({...catchUp:'1'})` and `{...catchUp:'0'}` | `.catchUp` `toBe(true)` / `toBe(false)` | 33, 34, 35, 36 |
| E — null next | `computeNextRun(exhaustedCompiled, futureDate)` | `toBe(null)` | 39 |
| F — fromDate branch | `computeMissedDates(countCompiled, '2026-01-02T12:00:00.000Z')` | `toEqual(['2026-01-03T00:00:00.000Z'])` | 42, 44 |
| G — ISO mapping | `computeMissedDates(countCompiled, '2026-01-02T12:00:00.000Z')[0]` | `toBe('2026-01-03T00:00:00.000Z')` | 45 |
| H — null guard | `buildCompiled(null, dtstart, tz)` and `buildCompiled(rrule, null, tz)` | `toBe(null)` | 49, 50, 52 |

Design notes:

- The `computeMissedDates` tests use a `COUNT`-bounded daily rule
  (`FREQ=DAILY;COUNT=3`, `dtstartUtc 2026-01-01T00:00:00.000Z`, `UTC`). Its three
  occurrences (`2026-01-01`, `02`, `03`) are all in the past relative to today,
  so the result is fully deterministic and independent of the wall-clock `before`
  used internally. Probed empirically: with `fromDate 2026-01-02T12:00:00.000Z`
  the original returns exactly `['2026-01-03T00:00:00.000Z']`, while the
  branch-swap mutants (which use `new Date(0)`) return all three occurrences.
- The `computeNextRun` test uses a `COUNT=2` daily rule whose occurrences are
  both in the past; with an `after` date beyond the last occurrence,
  `nextOccurrence` returns `null`, so the original returns `null` and the
  conditional-swap mutant throws on `null.toISOString()`.
- The `toRecord` tests build the full required row inline (the helper only reads
  fields, no DB), varying only `catchUp`.

## Verification

1. `bun test tests/recurring-utils.test.ts` — all new tests green against the
   unmutated source.
2. `bun test:mutate:file src/recurring-utils.ts` — re-measure; expect the 20
   killable mutants above to flip to `Killed`, leaving only the 2 accepted
   residuals (ids 4 and 43). The measured score should rise from 0.6 to ~0.96
   (53/55 killed), capped below 0.9 only by the two equivalent mutants — which
   the residual declaration covers (capped-path success).

## Accepted residuals

Two surviving mutants are **equivalent** and cannot be killed by any test
without editing `src/`. They are declared as residuals in `result.json`:

1. **Mutant id 4** — `parseLabels` line 13, `raw === null` → `false`. With the
   condition flipped off, a `null` input falls through to `JSON.parse(null)`,
   which coerces `null` → `"null"` → parses to `null`, and the next line's
   `!Array.isArray(null)` guard returns `[]` anyway. Identical observable
   output for every input (`null`, `''`, valid JSON). Equivalent.

2. **Mutant id 43** — `computeMissedDates` line 52, `fromDate === null` →
   `false`, i.e. always `new Date(fromDate)`. For `null` the `Date` constructor
   applies `ToNumber(null) = +0`, so `new Date(null)` produces the same epoch
   value as the original's `new Date(0)`; for any non-null string both branches
   take `new Date(fromDate)` identically. No input distinguishes them.
   Equivalent.
