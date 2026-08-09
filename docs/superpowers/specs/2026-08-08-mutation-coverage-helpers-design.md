<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation coverage: `client/shared/helpers.ts`

## Summary

Raise the Stryker mutation score of `client/shared/helpers.ts` from the measured
`0.8712` (141 killed / 162 total, 21 survived) to at least `0.9` by adding
exact-equality tests for the killable surviving-mutant classes, and by formally
declaring the genuinely-equivalent mutants that no test can kill. Every decision
below is grounded in the measured report at
`reports/paired/client__shared__helpers.ts.stryker-report.json`, not speculation.

## Why this file

`client/shared/helpers.ts` is a dependency-free pure-formatting module consumed
by the admin/dashboard surfaces (`formatTime`, `formatDateTime`, `formatUptime`,
`formatTokens`, `escapeHtml`, `fmtNum`, `fmtBytes`, `formatDuration`,
`hasSeriesData`, `levelName`, `levelClass`). It is a high-leverage target:

- Pure functions with deterministic string output → exact-equality assertions
  are unambiguous and the tests-only ceiling is high.
- Two companion suites already cover it (`tests/client/shared/helpers.test.ts`
  and `tests/client/debug/helpers.test.ts`), so the surviving mutants are real
  test gaps, not coverage holes from a missing suite.
- The measured survivors cluster into a small number of recognizable classes
  (boundary conditions, untested units, redundant guards) that are cheap to
  close.

## Non-goals

- Editing anything under `src/`, `client/`, `plugins/`, or `scripts/`. This is
  strictly test-only; the runner's diff-guard enforces it.
- Modifying `scripts/mutation/baseline.json` (the runner owns it).
- Refactoring `helpers.ts` to remove the equivalent mutants (e.g. the dead
  `formatTime` ternary branch). That is a source change out of scope here; the
  equivalents are declared as accepted residuals instead.
- Touching `tests/client/debug/helpers.test.ts`. The companion for this file is
  `tests/client/shared/helpers.test.ts`; new assertions are added there.
- Killing the locale-dependent `formatTime` mutants by environment-fragile
  exact-equality assertions (see Accepted residuals).

## Gap analysis

Measured by `bun test:mutate:file client/shared/helpers.ts`. The 21 surviving
mutants group into 12 classes. Verdict `kill` = a test can distinguish the
mutant from the original; `equiv` = the mutant is observably identical to the
original in this runtime, so no test can kill it.

| # | Class | Location (line) | Mutant ids | Mutator(s) | Verdict | Root cause |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `formatTime` dead ternary — both branches `new Date(ts)` | L27 C13–C35 | 28, 29, 30, 31 | ConditionalExpression, EqualityOperator, StringLiteral | equiv | Branches byte-identical; condition is dead code |
| 2 | `formatTime` redundant locale options object | L28–L33 | 33 | ObjectLiteral | equiv | `toLocaleTimeString('en-GB', {})` == full options in this ICU (verified across 8 edge timestamps incl. midnight/noon/23:59:59) |
| 3 | `fmtNum` redundant null/undefined guard | L66 C7–C36 | 74, 75, 76, 78 | ConditionalExpression, LogicalOperator | equiv | `null`/`undefined` are non-finite, so the L68 `!Number.isFinite` guard returns `'—'` regardless |
| 4 | `escapeHtml` `&` → `&amp;` never exercised | L62 C29–C36 | 66 | StringLiteral | kill | No existing `escapeHtml` input contains `&` |
| 5 | `fmtNum` ignores caller-supplied `dp` | L71 C36–C65 | 95 | ObjectLiteral | kill | Tests only use default `dp=2`; `dp > 3` exposes `maximumFractionDigits` |
| 6 | `fmtBytes` `< 1024` strict boundary | L76 C7–C15 | 107 | EqualityOperator | kill | `b === 1024` never tested |
| 7 | `fmtBytes` `GB`/`TB` unit literals unused | L77 C30–C40 | 113, 114 | StringLiteral | kill | No test reaches the GB/TB units |
| 8 | `fmtBytes` loop `v >= 1024` boundary | L83 C12–C21 | 122 | EqualityOperator | kill | No test lands `v` on exactly 1024 |
| 9 | `fmtBytes` loop `i < units.length - 1` cap | L83 C25–C45 | 124, 125, 127 | ConditionalExpression, EqualityOperator, ArithmeticOperator | kill | No test exceeds the TB tier (petabyte-scale overflow) |
| 10 | `fmtBytes` `v < 10` decimal boundary | L84 C23–C29 | 131 | EqualityOperator | kill | No test lands `v` on exactly 10 |
| 11 | `formatDuration` `ms < 0` zero boundary | L88 C31–C37 | 139 | EqualityOperator | kill | `ms === 0` never tested |
| 12 | `formatDuration` `ms < 1000` exact-1000 boundary | L89 C7–C16 | 144 | EqualityOperator | kill | `ms === 1000` never tested |

Killable mutants: 12 (classes 4–12). Equivalent mutants: 9 (classes 1–3).

## Design — tests to add

Each new test maps one-to-one onto a killable gap class (4–12). Every assertion
is exact `toBe(...)` with a value computed from the real function in this
runtime (`TZ=UTC`, Bun) — no `startsWith`/`endsWith`/`toContain`/regex. Inputs
are chosen to be the *minimal* distinguishing case and to isolate a single
class (a test for class N does not accidentally kill class M).

| Test | Asserts | Kills | Distinguishing input rationale |
| --- | --- | --- | --- |
| `escapeHtml` escapes `&` to `&amp;` | `escapeHtml('x&y')` === `'x&amp;y'` | 66 | Only a `&` in the input reaches the `'&amp;'` replacement |
| `fmtNum` honors an explicit large `dp` | `fmtNum(1.123456, 5)` === `'1.12346'` | 95 | `dp=5` > default `maximumFractionDigits` (3); mutant `{}` truncates to `'1.123'` |
| `fmtBytes` boundary `b === 1024` → KB tier | `fmtBytes(1024)` === `'1.0 KB'` | 107 | Mutant `b <= 1024` returns `'1024 B'` |
| `fmtBytes` reaches the GB tier | `fmtBytes(50 * 1024 ** 3)` === `'50 GB'` | 113 | Mutant `''` unit renders `'50 '` |
| `fmtBytes` reaches the TB tier | `fmtBytes(2 * 1024 ** 4)` === `'2.0 TB'` | 114 | Mutant `''` unit renders `'2.0 '` |
| `fmtBytes` loop `v === 1024` boundary | `fmtBytes(1048576)` === `'1.0 MB'` | 122 | Mutant `v > 1024` stops a tier early → `'1024 KB'` |
| `fmtBytes` caps at TB on petabyte input | `fmtBytes(1024 ** 5)` === `'1024 TB'` | 124, 125, 127 | Mutants overflow index → `'1.0 undefined'` |
| `fmtBytes` `v === 10` decimal boundary | `fmtBytes(10240)` === `'10 KB'` | 131 | Mutant `v <= 10` renders `'10.0 KB'` |
| `formatDuration` zero is `0ms` | `formatDuration(0)` === `'0ms'` | 139 | Mutant `ms <= 0` returns `'—'` |
| `formatDuration` exact 1000ms is `1s` | `formatDuration(1000)` === `'1s'` | 144 | Mutant `ms <= 1000` returns `'1000ms'` |

The GB/TB pair shares a `describe('fmtBytes unit tiers')` block but each tier
is its own `test(...)` (two assertions, one per mutant literal).

## Verification

1. `bun test tests/client/shared/helpers.test.ts` is green.
2. `bun test:mutate:file client/shared/helpers.ts` re-measured: 12 of the 21
   survivors are killed; measured score rises to `153/162 ≈ 0.9444 ≥ 0.9`.
3. The 9 equivalent mutants (ids 28, 29, 30, 31, 33, 74, 75, 76, 78) remain the
   *exact* surviving set, matching the `residuals[].mutantIds` declared in
   `result.json`.

## Accepted residuals

Declared as equivalent and left in place. Each has a per-loc justification in
`result.json`. Summary:

- **`formatTime` L27 ternary (ids 28, 29, 30, 31):** the conditional
  `typeof ts === 'string' ? new Date(ts) : new Date(ts)` has two identical
  branches, so any mutation of the condition is behavior-preserving. This is
  dead code only a `client/` edit could remove.
- **`formatTime` L28–L33 options object (id 33):** `d.toLocaleTimeString('en-GB',
  {})` produces the same `HH:MM:SS` string as the explicit
  `{ hour12, hour, minute, second }` options under Bun's ICU (verified across 8
  edge timestamps). No test the runner executes can distinguish it; an exact
  equality assertion would still pass under the mutant.
- **`fmtNum` L66 null/undefined guard (ids 74, 75, 76, 78):** `null` and
  `undefined` both fail `Number.isFinite`, so the later `!Number.isFinite(n)`
  guard on L68 returns `'—'` regardless of whether the L66 short-circuit fires.
  The `n === ''` operand is *not* residual-redundant (it alone prevents `''`
  from falling through to the string branch) but it is not mutated by any of
  these four ids.
