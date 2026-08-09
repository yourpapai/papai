<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation Coverage — `plugins/task-provider-youtrack/due-date.ts` Design

**Date:** 2026-08-06
**Status:** Proposed
**Scope:** Test-only mutation-score recovery for `plugins/task-provider-youtrack/due-date.ts`
**Target file:** `plugins/task-provider-youtrack/due-date.ts` (67 LOC)
**Companion test:** `tests/plugins/task-provider-youtrack/due-date.test.ts`

## Summary

`due-date.ts` parses / normalizes YouTrack "Due Date" custom-field values
between three representations: bare `YYYY-MM-DD` calendar dates, ISO-8601
datetimes with timezone, and millisecond timestamps. It also filters list-task
`dueAfter` / `dueBefore` params down to a 10-character date prefix. The file is
small but branch-dense (four regexes, three throw sites, two ternary chains), so
its mutation score is sensitive to missing edge-case assertions.

The current Stryker run measures **0.6915** (65 killed / 94 total). Seven
mutants are `NoCoverage` (unreached code) and twenty-two `Survived`. This spec
adds ten focused tests — one per surviving mutant *class* — to raise the score
to **≈ 0.9255** (87 killed / 94), accepting seven genuinely-equivalent
residuals.

## Why this file

`due-date.ts` is the single conversion chokepoint for every due-date value
flowing in and out of the YouTrack provider. A mutated regex anchor or a
mutated calendar-reality guard silently corrupts task due dates (wrong day,
`NaN` timestamps, or a misleading validation message) without breaking the
happy path that the existing tests exercise. The file was selected by the
mutation-improve runner as the highest-ROI target under the baseline ratchet.

## Non-goals

- No change to `plugins/`, `src/`, `client/`, or `scripts/` — this iteration is
  strictly test-only (diff-guard enforced).
- No reformatting or restyling of the existing four happy-path tests beyond the
  minimal edits needed to add imports.
- No attempt to kill the seven accepted-equivalent residuals (see *Accepted
  residuals*); they are documented with per-loc reasoning, not pursued.
- No change to `scripts/mutation/baseline.json` — the runner owns the ratchet.

## Gap analysis

Stryker `reports/paired/plugins__task-provider-youtrack__due-date.ts.stryker-report.json`,
94 mutants total: **65 Killed, 7 NoCoverage, 22 Survived**. The 29 survivors
collapse into the classes below. Each row lists the mutant ids at that location
and *why* the existing suite misses them.

| # | Class (loc)                                       | Mutant ids            | Mutator / replacement (representative)                                  | Why it survives today                                                                                                        |
| - | ------------------------------------------------- | --------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| A | `DueDateCustomFieldSchema` object literal (L12)   | 0                     | `ObjectLiteral` → `{}`                                                  | Schema is exported but never imported by any test; empty-object mutation accepts anything.                                   |
| B | `parseDueDateValue` final fallback (L17 / L40 / L44-47) | 2, 58, 63, 64, 65 | Regex `^` dropped; `isIsoDateTimeValue` cond → `true`; throw block NoCoverage | No test feeds a value that is neither a calendar date nor an ISO datetime, so the final `throw` (L44-47) is never reached and the `^` anchor / ISO guard are never contradicted. |
| C | `isIsoDateTimeValue` leading anchor `^` (L20)     | 11                    | Regex `^` dropped                                                       | The one ISO test value is prefix-free, so dropping `^` is observationally identical.                                         |
| D | `isIsoDateTimeValue` trailing anchor `$` (L20)    | 12                    | Regex `$` dropped                                                       | The one ISO test value is suffix-free, so dropping `$` is observationally identical.                                         |
| E | `isIsoDateTimeValue` optional-seconds `?` (L20)   | 23                    | `(?::\d{2}(\.\d…)?)?` → seconds required                                | The one ISO test value includes seconds; the "minutes-only" form is never exercised.                                         |
| F | `isIsoDateTimeValue` fractional-seconds group (L20) | 27, 28              | `\d{1,3}` → `\d`; `\d` → `\D`                                           | No test value carries a sub-second component.                                                                                |
| G | `isValidDateOnlyValue` calendar-reality check (L23-26, L33-37) | 40, 42, 44, 53, 54, 55, 56, 57 | cond → `true`; `&&` → `||`; `isDateOnlyValue` cond → `false`; throw block NoCoverage | No test feeds a *date-shaped but non-calendar* value (e.g. `2024-02-30`); the reality check + L34 throw are never contradicted/executed. |
| H | `mapYouTrackDueDateValue` nullish guard (L51)     | 72                    | cond → `false`                                                          | Only a numeric timestamp is tested; `null`/`undefined` never reach the ternary.                                              |
| I | `normalizeYouTrackDueDateFilter` undefined guard (L61) | 81                | cond → `false`                                                          | Both filter fields are always supplied in the existing test; `undefined` never reaches the ternary.                          |
| J | `normalizeYouTrackDueDateFilter` date-regex `^` (L61) | 83                 | Regex `^` dropped                                                       | The supplied filter values are either a clean 10-char date (`slice===value`) or already non-matching; the `^` anchor is never contradicted. |
| — | `isValidDateOnlyValue` guard (L23)                | 37                    | `!isDateOnlyValue` cond → `false`                                       | **Equivalent** — see *Accepted residuals*.                                                                                  |
| — | `normalizeYouTrackDueDateFilter` date-regex body (L61) | 85, 86, 87, 88, 89, 90 | `\d{4}`→`\d` / `\D{4}`; `\d{2}`→`\d`/`\D{2}` (month/day)        | **Equivalent** — see *Accepted residuals*.                                                                                  |

Classes A–J are killable (22 mutants); the two `—` rows are the 7 accepted
equivalent residuals.

## Design — tests to add

One test per class (A–J), each mapped one-to-one onto a gap-analysis row. Every
assertion uses exact equality (`toBe`) on a fully-knowable value — no
`startsWith` / `endsWith` / `toContain`. Error tests catch the thrown error and
pin `message` plus every scalar field of `appError` (`type`, `code`, `field`,
`reason`) individually with `toBe`, which simultaneously kills the
`StringLiteral`→`""` mutants living inside each throw.

| Class | New test (title)                                                                          | Input / call                                                                 | Exact assertion(s)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A     | `DueDateCustomFieldSchema rejects an object missing name`                                 | `DueDateCustomFieldSchema.safeParse({}).success`                             | `toBe(false)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| B     | `parseDueDateValue rejects input that is neither a calendar date nor an ISO datetime`     | `parseDueDateValue('abc2024-03-15')`                                         | throws; `message` `toBe('Invalid dueDate: abc2024-03-15')`; `appError` `{type:'provider', code:'validation-failed', field:'dueDate', reason:'Expected YYYY-MM-DD or an ISO datetime with timezone information'}` (each field via `toBe`)                                                                                                                                                                                                                                                                                                                                                                       |
| C     | `parseDueDateValue rejects an ISO datetime with a non-date prefix`                        | `parseDueDateValue('abc2024-03-15T23:45:00+02:00')`                          | throws (same `appError` shape as B with the matching `message`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| D     | `parseDueDateValue rejects an ISO datetime with a trailing suffix`                        | `parseDueDateValue('2024-03-15T23:45:00+02:00abc')`                          | throws (same `appError` shape as B with the matching `message`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| E     | `parseDueDateValue accepts an ISO datetime without seconds`                               | `parseDueDateValue('2024-03-15T23:45+02:00')`                                | `toBe(Date.parse('2024-03-15T12:00:00.000Z'))`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| F     | `parseDueDateValue accepts an ISO datetime with three-digit fractional seconds`           | `parseDueDateValue('2024-03-15T23:45:00.123+02:00')`                         | `toBe(Date.parse('2024-03-15T12:00:00.000Z'))`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| G     | `parseDueDateValue rejects a date-shaped but non-calendar value`                          | `parseDueDateValue('2024-02-30')`                                            | throws; `message` `toBe('Invalid dueDate: 2024-02-30')`; `appError` `{type:'provider', code:'validation-failed', field:'dueDate', reason:'Expected a real calendar date in YYYY-MM-DD format'}` (each field via `toBe`)                                                                                                                                                                                                                                                                                                                                                                                         |
| H     | `mapYouTrackDueDateValue returns undefined for null and undefined`                        | `mapYouTrackDueDateValue(null)`, `mapYouTrackDueDateValue(undefined)`        | `toBe(undefined)` (each)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| I     | `normalizeYouTrackListTaskParams leaves undefined filters undefined`                      | `normalizeYouTrackListTaskParams({}).dueAfter`                               | `toBe(undefined)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| J     | `normalizeYouTrackListTaskParams slices a prefixed filter that is not a clean date`       | `normalizeYouTrackListTaskParams({ dueAfter: 'abc2024-03-15' }).dueAfter`    | `toBe('abc2024-03')`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

### How each class's mutants are killed

- **B** `'abc2024-03-15'` is neither calendar-date nor ISO, so it reaches the
  L44 throw (covers NoCoverage 63/64/65). Mutating the L17 `^` anchor (id 2)
  makes `isDateOnlyValue` true, diverting to the L34 throw whose `appError`
  `reason` differs → assertion fails. Mutating the L40 conditional to `true`
  (id 58) returns a number instead of throwing → assertion fails.
- **G** `'2024-02-30'` is date-shaped (`isDateOnlyValue` true) but
  `new Date('2024-02-30T12:00:00.000Z')` rolls to `2024-03-01`, so the
  round-trip check is false and L34 throws (covers NoCoverage 54/55/56/57).
  Mutating any of the L25 operands (`&&`→`||` id 42, cond → `true` ids 40/44)
  flips the reality check to true → returns a number; mutating the L33 guard
  to `false` (id 53) diverts to the L44 throw whose `reason` differs → fail.
- **C/D/E/F** each feed a single discriminating ISO value: prefix (C, kills
  id 11), suffix (D, id 12), no-seconds (E, id 23), `.123` fraction (F, ids
  27 & 28). Originals either parse to a known timestamp or throw with a known
  `appError`; the mutant inverts parse↔throw, breaking the `toBe`.
- **H/I/J** directly contradict the mutated ternary/regex via `null` /
  `undefined` / prefixed inputs whose exact output is fully knowable.

## Verification

1. `bun test tests/plugins/task-provider-youtrack/due-date.test.ts` → all green
   (existing 6 + new 10).
2. `bun test:mutate:file plugins/task-provider-youtrack/due-date.ts` → measured
   score ≥ 0.9 (target 87/94 ≈ 0.9255). The runner reads
   `reports/paired/plugins__task-provider-youtrack__due-date.ts.stryker-report.json`.
3. Expected post-state: 87 Killed, 0 NoCoverage, 7 Survived (the residuals
   below). No new `Survived` / `NoCoverage` classes introduced.

## Accepted residuals

Seven surviving mutants are accepted as equivalent and left in place (per-loc
reasoning repeated in the result `residuals` array):

- **id 37 — L23 `if (!isDateOnlyValue(value)) return false` → `if (false)`.**
  Equivalent. The guard short-circuits non-date-shaped input to `false`.
  Without it the function continues, but the `&&` chain still returns `false`
  for every non-date input: if `new Date(value+'T12:00:00.000Z')` is invalid,
  `!Number.isNaN(getTime())` is `false` and short-circuits before
  `.toISOString()` can throw; if the date is valid, the round-trip
  `parsed.toISOString().slice(0,10) === value` can equal `value` only when
  `value` is exactly `YYYY-MM-DD` — which is precisely the case
  `isDateOnlyValue` already admits. There is therefore no input on which the
  observable result of `isValidDateOnlyValue` (and hence `parseDueDateValue`)
  differs.
- **ids 85, 86, 87, 88, 89, 90 — L61 date-regex char-class / quantifier
  mutations** (`\d{4}`→`\d`/`\D{4}`; month/day `\d{2}`→`\d`/`\D{2}`).
  Equivalent. The L61 regex only selects between *return `value` as-is* and
  *return `value.slice(0,10)`*. For any string ≤ 10 chars, `value.slice(0,10)
  === value`, so the two branches coincide; and every one of these mutated
  patterns is anchored `^…$` and matches at most 10 characters, so no >10-char
  string can ever match. The selection is therefore observationally identical
  for all inputs. (Only the un-anchored variant id 83 — class J — is killable.)
