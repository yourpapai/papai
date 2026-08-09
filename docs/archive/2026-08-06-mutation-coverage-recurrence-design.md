<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation Coverage — `src/recurrence.ts` Design

**Date:** 2026-08-06
**Status:** Approved for planning
**Target file:** `src/recurrence.ts` (`describeCompiledRecurrence` only — the re-exported
`nextOccurrence` / `occurrencesBetween` / `recurrenceSpecToRrule` live in
`src/recurrence/recurrence.js` and are out of scope)
**Before score:** 0.5417 (killed=78 survived=52 noCoverage=14, total=144)
**Target score:** ≥ 0.9

## Summary

`describeCompiledRecurrence` renders a human-readable, English description of a compiled
RRULE. Its existing companion suite (`tests/recurrence.test.ts`) only asserts a handful of
branches with a mix of loose `toContain` and a few exact `toBe` checks, so 66 of 144 mutants
survive. The survivors cluster into a small number of behavioural classes — untested weekday
codes, the month-name table, the `INTERVAL>1` plural path, unknown-frequency fallbacks, the
`BYMONTH` rendering block, and a few `Intl.DateTimeFormat` edge cases — every one of which is
observable through an exact-equality assertion on the full returned string. This spec adds one
focused `it()` per mutant class (21 tests) to raise the score to **~0.95** and enumerates the
small set of genuinely-equivalent residuals.

## Why this file

`recurrence.ts` is a pure, deterministic string formatter (no I/O, no clocks, no DI), so it is
an ideal mutation-coverage target: every behaviour is observable as an exact output string, and
each surviving mutant maps cleanly to a missing exact-equality assertion. Improving it
strengthens the regression guard for the task-recurrence UX surface without touching production
code.

## Non-goals

- **No production-code changes.** `src/`, `client/`, `plugins/`, `scripts/` are untouched; the
  diff gate restricts edits to `tests/` and `docs/superpowers/`.
- **No edits to `scripts/mutation/baseline.json`** (the runner owns the ratchet).
- No new test files; the existing companion `tests/recurrence.test.ts` is extended in place.
- No coverage of the sibling module `src/recurrence/recurrence.ts` (separate baseline entry).
- Existing tests are left as-is (they pass); only new `it()` blocks are appended so the diff
  stays additive and reviewable.

## Gap analysis

Measured via `bun test:mutate:file src/recurrence.ts`; report at
`reports/paired/src__recurrence.ts.stryker-report.json`. 52 `Survived` + 14 `NoCoverage` = 66
non-killed mutants. They group into the classes below. Mutant ids are Stryker ids from the
report; locations are `line:col` in `src/recurrence.ts`.

| # | Class (behaviour) | Mutant ids | Loc | Root cause / why it survives |
|---|---|---|---|---|
| 1 | `DAY_NAMES` for untested weekday codes (TU/TH/SA/SU) + `BYDAY` join separator + `weekly` singular word | 2, 4, 6, 7, 38, 127 | 13/15/17/18, 51, 105 | Only MO/WE/FR are exercised, and via `toContain` — so emptying the other day values, or the `', '` join, or the `'weekly'` word, does not break any assertion. |
| 2 | `INTERVAL>1` plural-prefix machinery: `FREQ_PLURAL_UNIT` object, `'every '` template, `??`→`&&`, `interval>1` guard, weeks value, INTERVAL ternary/key/radix | 44, 46, 54, 57, 58, 72, 74, 75, 76 | 59-67, 70, 84 | No test sets `INTERVAL>1`, so the entire plural branch (`freqPrefix` interval path + the INTERVAL-parsing ternary on L84) is uncovered. |
| 3 | `MINUTELY`/`SECONDLY` singular words + `FREQ_SINGULAR` object + singular `??`→`&&` + FREQ-case normalisation | 36, 42, 43, 60, 69 | 49-57, 55, 56, 71, 83 | Only DAILY (exact) and a couple of freqs via `toContain` are asserted; MINUTELY/SECONDLY table values (`'every minute'`/`'every second'`, which differ from the lowercased freq) and the `??` vs `&&` distinction are never observed. |
| 4 | Unknown-frequency singular fallback (`freq.toLowerCase()` on L71) | 61 | 71 | L71 fallback only runs when `FREQ_SINGULAR[freq]` is undefined; no test passes an unknown FREQ. |
| 5 | Unknown-frequency plural fallback (`freq.toLowerCase()`→`toUpperCase` on L70) | 59 | 70 | L70 fallback only runs for unknown FREQ **and** `INTERVAL>1`; no test combines both. |
| 6 | Missing `FREQ` part: optional chaining on L83 + `freq !== undefined` push guard on L86 | 70, 77 | 83, 86 | Every test supplies `FREQ=...`; an RRULE without a `FREQ` part (valid input the function handles) is never asserted. |
| 7 | `Intl.DateTimeFormat` `hour12: false` (afternoon fallback hours) | 84 | 93 | The fallback local-hour (no `BYHOUR`) is only probed at hours where 12h and 24h formatting agree (morning); an afternoon hour that differs is never asserted. |
| 8 | Time-list `.sort()` (cartesian product of hours×minutes) | 113 | 99 | All multi-time tests supply hours already in ascending order, so skipping `.sort()` is unobservable. |
| 9 | `BYMONTH` single-month rendering: `parts['BYMONTH']` key, block, `parseInt` arrow, map arrow, `??`→`&&`, `'in …'` template, yearly word | 40, 68, 134, 136, 138, 139, 140, 141 | 82, 112-115, 53 | No `BYMONTH` test exists; the whole month-name branch is uncovered. |
| 10 | `BYMONTH` multi-month: `split(',')` separator + `names.join(', ')` | 137, 142 | 113, 115 | Single-month input makes `split(',')` vs `split('')` and `join(', ')` vs `join('')` indistinguishable; needs ≥2 months. |
| 11 | `MONTH_NAMES` table (array literal + January…December) | 8, 10-21 | 21-35 | Same as #9 — uncovered until a `BYMONTH` test renders month names. |
| 12 | `MONTHLY` singular word | 39 | 52 | Monthly test asserts only `toContain('day 15')`; the `'monthly'` word itself is unasserted. |
| 13 | `HOURLY` singular word | 41 | 54 | Hourly test asserts only the time substrings via `toContain`; the `'hourly'` word is unasserted. |
| 14 | `INTERVAL>1` plural value — days | 45 | 60 | Needs `FREQ=DAILY;INTERVAL>1`. |
| 15 | `INTERVAL>1` plural value — months | 47 | 62 | Needs `FREQ=MONTHLY;INTERVAL>1`. |
| 16 | `INTERVAL>1` plural value — years | 48 | 63 | Needs `FREQ=YEARLY;INTERVAL>1`. |
| 17 | `INTERVAL>1` plural value — hours | 49 | 64 | Needs `FREQ=HOURLY;INTERVAL>1`. |
| 18 | `INTERVAL>1` plural value — minutes | 50 | 65 | Needs `FREQ=MINUTELY;INTERVAL>1`. |
| 19 | `INTERVAL>1` plural value — seconds | 51 | 66 | Needs `FREQ=SECONDLY;INTERVAL>1`. |
| 20 | `parseRruleParts` malformed-part guard (`idx === -1`) | 29, 31 | 43 | Every supplied RRULE is well-formed (`KEY=VALUE` per part); a part with no `=` — which the guard skips — is never fed in. |
| — | *(residual classes — see "Accepted residuals")* | 9, 73, 86, 88, 92, 94, 100 | — | Genuinely equivalent / unreachable; no test can kill them. |

## Design — tests to add

Each class maps **one-to-one** to a single new `it()` in `tests/recurrence.test.ts`. Every
assertion is an exact `toBe(...)` on the full returned description string (verified empirically
against the unmutated function before writing).

| Test (class #) | RRULE / fixture | Exact expected output | Kills |
|---|---|---|---|
| T1 (#1) weekday rendering | `FREQ=WEEKLY;BYDAY=TU,TH,SA,SU;BYHOUR=9;BYMINUTE=0` @ `2026-04-21T09:00:00Z`, `UTC` | `'weekly at 09:00 UTC on Tuesday, Thursday, Saturday, Sunday'` | 2,4,6,7,38,127 |
| T2 (#2) interval>1 plural prefix (weeks) | `FREQ=WEEKLY;INTERVAL=2;BYHOUR=9;BYMINUTE=0` @ `…09:00Z`, `UTC` | `'every 2 weeks at 09:00 UTC'` | 44,46,54,57,58,72,74,75,76 |
| T3 (#3) MINUTELY singular + fallback semantics | `FREQ=MINUTELY;BYHOUR=9;BYMINUTE=0` @ `…09:00Z`, `UTC` | `'every minute at 09:00 UTC'` | 36,42,60,69 |
| T4 (#3) SECONDLY singular word | `FREQ=SECONDLY;BYHOUR=9;BYMINUTE=0` @ `…09:00Z`, `UTC` | `'every second at 09:00 UTC'` | 43 |
| T5 (#4) unknown freq singular fallback | `FREQ=BOGUS;BYHOUR=9;BYMINUTE=0` @ `…09:00Z`, `UTC` | `'bogus at 09:00 UTC'` | 61 |
| T6 (#5) unknown freq plural fallback | `FREQ=BOGUS;INTERVAL=2;BYHOUR=9;BYMINUTE=0` @ `…09:00Z`, `UTC` | `'every 2 bogus at 09:00 UTC'` | 59 |
| T7 (#6) missing FREQ part | `BYHOUR=9;BYMINUTE=0` @ `…09:00Z`, `UTC` | `'at 09:00 UTC'` | 70,77 |
| T8 (#7) hour12:false afternoon fallback | `FREQ=DAILY` @ `2026-04-21T14:00:00Z`, `UTC` | `'daily at 14:00 UTC'` | 84 |
| T9 (#8) time-list sort | `FREQ=DAILY;BYHOUR=17,9;BYMINUTE=0` @ `…09:00Z`, `UTC` | `'daily at 09:00, 17:00 UTC'` | 113 |
| T10 (#9) BYMONTH single (yearly) | `FREQ=YEARLY;BYMONTH=1;BYHOUR=9;BYMINUTE=0` @ `2026-01-15T09:00:00Z`, `UTC` | `'yearly at 09:00 UTC in January'` | 40,68,134,136,138,139,140,141 |
| T11 (#10) BYMONTH multi split/join | `FREQ=YEARLY;BYMONTH=1,3;BYHOUR=9;BYMINUTE=0` @ `…`, `UTC` | `'yearly at 09:00 UTC in January, March'` | 137,142 |
| T12 (#11) MONTH_NAMES table | `FREQ=YEARLY;BYMONTH=1,2,3,4,5,6,7,8,9,10,11,12;BYHOUR=9;BYMINUTE=0` @ `…`, `UTC` | `'yearly at 09:00 UTC in January, February, March, April, May, June, July, August, September, October, November, December'` | 8,10-21 |
| T13 (#12) MONTHLY word | `FREQ=MONTHLY;BYMONTHDAY=15;BYHOUR=10;BYMINUTE=0` @ `…10:00Z`, `America/New_York` | `'monthly at 10:00 America/New_York on day 15 of the month'` | 39 |
| T14 (#13) HOURLY word | `FREQ=HOURLY;BYMINUTE=0,15,30,45` @ `…09:00Z`, `UTC` | `'hourly at 09:00, 09:15, 09:30, 09:45 UTC'` | 41 |
| T15 (#14) interval>1 days | `FREQ=DAILY;INTERVAL=2;BYHOUR=8;BYMINUTE=30` @ `…08:30Z`, `UTC` | `'every 2 days at 08:30 UTC'` | 45 |
| T16 (#15) interval>1 months | `FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=15;BYHOUR=10;BYMINUTE=0` @ `…10:00Z`, `UTC` | `'every 2 months at 10:00 UTC on day 15 of the month'` | 47 |
| T17 (#16) interval>1 years | `FREQ=YEARLY;INTERVAL=2;BYMONTH=6;BYHOUR=9;BYMINUTE=0` @ `2026-06-15T09:00:00Z`, `UTC` | `'every 2 years at 09:00 UTC in June'` | 48 |
| T18 (#17) interval>1 hours | `FREQ=HOURLY;INTERVAL=2;BYMINUTE=0` @ `…09:00Z`, `UTC` | `'every 2 hours at 09:00 UTC'` | 49 |
| T19 (#18) interval>1 minutes | `FREQ=MINUTELY;INTERVAL=2;BYMINUTE=0` @ `…09:00Z`, `UTC` | `'every 2 minutes at 09:00 UTC'` | 50 |
| T20 (#19) interval>1 seconds | `FREQ=SECONDLY;INTERVAL=2;BYMINUTE=0` @ `…09:00Z`, `UTC` | `'every 2 seconds at 09:00 UTC'` | 51 |
| T21 (#20) malformed-part guard | `BYHOUR=9;BYMINUTE=0;FREQQ` @ `…09:00Z`, `UTC` | `'at 09:00 UTC'` | 29,31 |

**Projected after-score:** killed = 78 + 59 = **137**, non-killed = 7 (residuals),
total = 144 → **score = 137/144 = 0.9514** (≥ 0.9 target).

## Verification

1. `bun test tests/recurrence.test.ts` is green (all 8 existing + 21 new `it()`s).
2. `bun test:mutate:file src/recurrence.ts` reports `killed=137 survived/noCoverage=7
   score≈0.9514`, and `reports/paired/src__recurrence.ts.stryker-report.json` shows only the
   7 residual ids (9, 73, 86, 88, 92, 94, 100) as non-killed.
3. No file under `src/`, `client/`, `plugins/`, `scripts/`, or `scripts/mutation/baseline.json`
   is modified (diff-gate).

## Accepted residuals

Seven mutants survive and genuinely cannot be killed (each is observationally equivalent or
unreachable for every valid `CompiledRecurrence`). See the plan's "Residuals" task for full
per-loc reasoning. Summary:

| id | Loc | Why equivalent |
|---|---|---|
| 9 | 22 | `MONTH_NAMES[0] = ''` — 1-based placeholder; BYMONTH is 1-12 (validated upstream), so index 0 is never read by valid input. |
| 73 | 84 | INTERVAL ternary `cond→false` yields `NaN` instead of `1` when INTERVAL is absent, but `interval` is consumed only by `interval > 1`; `NaN > 1` and `1 > 1` are both false, so output is identical. |
| 86 | 95 | Optional chaining on the hour-`find`; `hour: '2-digit'` always emits an hour part, so `find` never returns `undefined` and `?.` never short-circuits. |
| 88 | 95 | `p.type === 'hour' → true` makes `find` return the first part; the fixed format (`en-US`, hour+minute, `hour12:false`) always yields `[hour, literal, minute]`, so the first part is the hour part. |
| 92 | 95 | `?? '0'` hour fallback is dead — the hour part's `value` is always a non-empty string, so the left operand is never nullish. |
| 94 | 96 | Optional chaining on the minute-`find`; symmetric to id 86 — a minute part is always emitted. |
| 100 | 96 | `?? '0'` minute fallback is dead — symmetric to id 92. |
