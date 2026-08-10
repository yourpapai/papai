<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation Coverage — `src/recurrence.ts` Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. This is a
> test-only effort; there is **no** production-code change.

**Goal:** Raise the `src/recurrence.ts` mutation score from **0.5417** to **≥ 0.9** by adding
exact-equality assertions to `tests/recurrence.test.ts`. Spec:
`docs/superpowers/specs/2026-08-06-mutation-coverage-recurrence-design.md`.

**Architecture:** `describeCompiledRecurrence` (in `src/recurrence.ts`) is a pure string
formatter; every surviving mutant is observable as a change in the full returned description,
so each new test asserts `toBe('<exact full string>')`.

## Global Constraints

- **Test-only.** Edit only `tests/recurrence.test.ts` (and the two docs files already
  written). Do **not** touch `src/`, `client/`, `plugins/`, `scripts/`, or
  `scripts/mutation/baseline.json`.
- Runtime Bun; tests use `bun:test` (`import { describe, expect, it } from 'bun:test'`).
- **Every new assertion is an exact `toBe(...)`** on the full description string — never
  `toContain` / `startsWith` / `endsWith`. Each expected string was verified empirically
  against the unmutated function before being committed.
- New tests are **appended**; existing tests are left unchanged (additive diff).
- One `it()` per mutant class (one-to-one with the spec's gap table). Where a single behaviour
  cleanly kills several mutants of one class, they share one `it()`.
- No comments added to the test file (repo convention).

## Measure (already complete)

- [x] `bun test:mutate:file src/recurrence.ts` → `killed=78 survived=52 noCoverage=14
      score=0.5416666666666666`; report at
      `reports/paired/src__recurrence.ts.stryker-report.json`.
- [x] Enumerated all 66 surviving/no-coverage mutants with ids, mutators, and `line:col`.

## Tasks (one per mutant class → one test each)

- [ ] **Task 1 — weekday rendering (TU/TH/SA/SU + day join + `weekly` word).** Add `it()`
      with `FREQ=WEEKLY;BYDAY=TU,TH,SA,SU;BYHOUR=9;BYMINUTE=0`, `dtstartUtc`
      `2026-04-21T09:00:00Z`, tz `UTC`, asserting `toBe('weekly at 09:00 UTC on Tuesday,
      Thursday, Saturday, Sunday')`. Kills mutants 2, 4, 6, 7, 38, 127.
- [ ] **Task 2 — interval>1 plural prefix (weeks) + INTERVAL parsing.** `FREQ=WEEKLY;
      INTERVAL=2;BYHOUR=9;BYMINUTE=0` @ `…09:00Z` / `UTC` → `toBe('every 2 weeks at 09:00
      UTC')`. Kills 44, 46, 54, 57, 58, 72, 74, 75, 76.
- [ ] **Task 3 — MINUTELY singular + singular `??` vs `&&` + FREQ-case normalisation.**
      `FREQ=MINUTELY;BYHOUR=9;BYMINUTE=0` @ `…09:00Z` / `UTC` → `toBe('every minute at 09:00
      UTC')`. Kills 36, 42, 60, 69.
- [ ] **Task 4 — SECONDLY singular word.** `FREQ=SECONDLY;BYHOUR=9;BYMINUTE=0` @ `…09:00Z` /
      `UTC` → `toBe('every second at 09:00 UTC')`. Kills 43.
- [ ] **Task 5 — unknown-frequency singular fallback.** `FREQ=BOGUS;BYHOUR=9;BYMINUTE=0` @
      `…09:00Z` / `UTC` → `toBe('bogus at 09:00 UTC')`. Kills 61.
- [ ] **Task 6 — unknown-frequency plural fallback.** `FREQ=BOGUS;INTERVAL=2;BYHOUR=9;
      BYMINUTE=0` @ `…09:00Z` / `UTC` → `toBe('every 2 bogus at 09:00 UTC')`. Kills 59.
- [ ] **Task 7 — missing FREQ part (optional chaining + push guard).** `BYHOUR=9;BYMINUTE=0`
      @ `…09:00Z` / `UTC` → `toBe('at 09:00 UTC')`. Kills 70, 77 (both mutants throw on this
      input; a thrown error fails the `toBe`, marking the mutant killed).
- [ ] **Task 8 — `hour12: false` afternoon fallback.** `FREQ=DAILY` @
      `2026-04-21T14:00:00Z` / `UTC` → `toBe('daily at 14:00 UTC')`. Kills 84 (hour12→true
      renders `02` for 14:00).
- [ ] **Task 9 — time-list `.sort()`.** `FREQ=DAILY;BYHOUR=17,9;BYMINUTE=0` @ `…09:00Z` /
      `UTC` → `toBe('daily at 09:00, 17:00 UTC')`. Kills 113.
- [ ] **Task 10 — BYMONTH single month (yearly word + key + block + arrows + template).**
      `FREQ=YEARLY;BYMONTH=1;BYHOUR=9;BYMINUTE=0` @ `2026-01-15T09:00:00Z` / `UTC` →
      `toBe('yearly at 09:00 UTC in January')`. Kills 40, 68, 134, 136, 138, 139, 140, 141.
- [ ] **Task 11 — BYMONTH multi-month split/join.** `FREQ=YEARLY;BYMONTH=1,3;BYHOUR=9;
      BYMINUTE=0` @ `…` / `UTC` → `toBe('yearly at 09:00 UTC in January, March')`. Kills
      137, 142.
- [ ] **Task 12 — MONTH_NAMES table (array + Jan..Dec).** `FREQ=YEARLY;
      BYMONTH=1,2,3,4,5,6,7,8,9,10,11,12;BYHOUR=9;BYMINUTE=0` @ `…` / `UTC` → `toBe('yearly
      at 09:00 UTC in January, February, March, April, May, June, July, August, September,
      October, November, December')`. Kills 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21.
- [ ] **Task 13 — MONTHLY singular word.** `FREQ=MONTHLY;BYMONTHDAY=15;BYHOUR=10;BYMINUTE=0`
      @ `2026-04-15T10:00:00Z` / `America/New_York` → `toBe('monthly at 10:00 America/New_York
      on day 15 of the month')`. Kills 39.
- [ ] **Task 14 — HOURLY singular word.** `FREQ=HOURLY;BYMINUTE=0,15,30,45` @ `…09:00Z` /
      `UTC` → `toBe('hourly at 09:00, 09:15, 09:30, 09:45 UTC')`. Kills 41.
- [ ] **Task 15 — interval>1 days.** `FREQ=DAILY;INTERVAL=2;BYHOUR=8;BYMINUTE=30` @
      `…08:30Z` / `UTC` → `toBe('every 2 days at 08:30 UTC')`. Kills 45.
- [ ] **Task 16 — interval>1 months.** `FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=15;BYHOUR=10;
      BYMINUTE=0` @ `…10:00Z` / `UTC` → `toBe('every 2 months at 10:00 UTC on day 15 of the
      month')`. Kills 47.
- [ ] **Task 17 — interval>1 years.** `FREQ=YEARLY;INTERVAL=2;BYMONTH=6;BYHOUR=9;BYMINUTE=0`
      @ `2026-06-15T09:00:00Z` / `UTC` → `toBe('every 2 years at 09:00 UTC in June')`. Kills
      48.
- [ ] **Task 18 — interval>1 hours.** `FREQ=HOURLY;INTERVAL=2;BYMINUTE=0` @ `…09:00Z` /
      `UTC` → `toBe('every 2 hours at 09:00 UTC')`. Kills 49.
- [ ] **Task 19 — interval>1 minutes.** `FREQ=MINUTELY;INTERVAL=2;BYMINUTE=0` @ `…09:00Z` /
      `UTC` → `toBe('every 2 minutes at 09:00 UTC')`. Kills 50.
- [ ] **Task 20 — interval>1 seconds.** `FREQ=SECONDLY;INTERVAL=2;BYMINUTE=0` @ `…09:00Z` /
      `UTC` → `toBe('every 2 seconds at 09:00 UTC')`. Kills 51.
- [ ] **Task 21 — `parseRruleParts` malformed-part guard.** `BYHOUR=9;BYMINUTE=0;FREQQ` @
      `…09:00Z` / `UTC` → `toBe('at 09:00 UTC')`. The guard skips the no-`=` part `FREQQ`;
      mutants 29 and 31 instead register it under key `FREQ`, surfacing the bogus prefix.
      Kills 29, 31.

## Residuals (accepted — no test can kill)

- [x] **id 9 (L22)** `MONTH_NAMES[0] = ''` — 1-based placeholder. `BYMONTH` values are 1-12
      (validated upstream by the `RecurrenceSpec` Zod schema), so index 0 is never read by any
      valid `CompiledRecurrence`; only reachable via invalid `BYMONTH=0`, which the producer
      never emits.
- [x] **id 73 (L84)** INTERVAL ternary `cond → false` yields `NaN` (not `1`) when `INTERVAL`
      is absent. `interval` is consumed solely by `interval > 1` (L70); both `NaN > 1` and
      `1 > 1` are false, so the plural branch is never taken and the singular path ignores
      `interval`. Output is byte-identical for every input.
- [x] **id 86 (L95)** optional chaining on the hour `find`. `Intl.DateTimeFormat` with
      `hour: '2-digit'` always emits an `hour` part, so `find(p => p.type === 'hour')` never
      returns `undefined`; the `?.` can never short-circuit. No input can remove the hour part.
- [x] **id 88 (L95)** `p.type === 'hour' → true`. `find(p => true)` returns the first part.
      The format options are hardcoded (`'en-US'`, `hour`+`minute`, `hour12: false`), and
      `formatToParts` yields `[hour, literal, minute]`, so the first part is always the hour
      part — identical to the original predicate. Locale/options cannot vary per call.
- [x] **id 92 (L95)** `?? '0'` hour fallback. Fires only when `find(...)?.value` is nullish;
      the hour part's `value` is always a non-empty formatted string, so the left operand is
      never nullish. The `'0'` is dead code.
- [x] **id 94 (L96)** optional chaining on the minute `find` — symmetric to id 86; a minute
      part is always emitted (`minute: '2-digit'`).
- [x] **id 100 (L96)** `?? '0'` minute fallback — symmetric to id 92; dead code.

## Verification

- [ ] `bun test tests/recurrence.test.ts` → all green.
- [ ] `bun test:mutate:file src/recurrence.ts` → `killed=137 score≈0.9514`; only residual ids
      (9, 73, 86, 88, 92, 94, 100) remain non-killed in the report.
- [ ] `git status` shows changes only under `tests/` and `docs/superpowers/` (diff-gate).
