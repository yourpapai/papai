<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation coverage — `plugins/task-provider-youtrack/helpers.ts`

## Summary

Raise the Stryker mutation score of `plugins/task-provider-youtrack/helpers.ts`
from **0.7464** (101 killed + 2 timeout of 138 mutants) to **>= 0.9** by adding
behaviour-anchored, exact-equality tests to the existing companion file
`tests/plugins/task-provider-youtrack/helpers.test.ts`. No production code is
touched. The three genuinely unkillable survivors (two dead-code nullish
fallbacks and one no-op regex quantifier drop) are declared as accepted
residuals.

## Why this file

`helpers.ts` is the pure utility core of the YouTrack task provider: duration
parsing (`parseDuration` / `minutesToIso` / `isoToMinutes`), `$top/$skip`
pagination (`paginate`), and work-item-type resolution (`resolveWorkItemTypeId`).
It is imported transitively by every YouTrack operation, so a regression in a
duration-conversion arithmetic operator or a pagination boundary check would
silently corrupt every time-tracking / issue write the bot performs. The file
already has a companion test, but the measured score (0.7464) is the lowest of
the high-traffic YouTrack modules still under 0.9, making it the highest-ROI
mutation target.

## Non-goals

- Editing anything under `src/`, `client/`, `plugins/`, or `scripts/`.
- Refactoring `helpers.ts` itself (e.g. removing the dead-code fallbacks). That
  would raise the ceiling but is forbidden by the test-only diff gate; the dead
  fallbacks are declared as residuals instead.
- Raising coverage of the sibling YouTrack files; only `helpers.ts` is in scope.
- Changing the existing assertions; new assertions are added, legacy substring
  `.toThrow(...)` calls are left untouched.

## Gap analysis

Measured by `bun test:mutate:file plugins/task-provider-youtrack/helpers.ts`
(report: `reports/paired/plugins__task-provider-youtrack__helpers.ts.stryker-report.json`).
Totals: **Killed 101, Timeout 2, Survived 31, NoCoverage 4** of 138. Score
`(101 + 2) / 138 = 0.7464` (Stryker counts timeout as killed).

Surviving mutant classes (one row per class):

| # | Class | Mutant ids | Loc | Replacement / behaviour | Killable? |
|---|-------|------------|-----|-------------------------|-----------|
| C1 | `parseDuration` empty-string guard | 3, 5, 6, 7 | L21–22 | `if (trimmed === '')` → `false`; `''`→junk; throw block→`{}`; message→`""` | Yes — assert `parseDuration('')` throws exact `'Duration cannot be empty'` |
| C2 | `parseDuration` leading/trailing trim | 1 | L20 | `input.trim()` → `input` | Yes — `parseDuration('  PT2H  ')` === `'PT2H'` and whitespace-only throws the empty message |
| C3 | `parseDuration` `^PT` ISO anchor | 10 | L26 | `/^PT/iu` → `/PT/iu` (drop `^`) | Yes — `parseDuration('5pt')` throws `'Unsupported duration format: "5pt"'` |
| C4 | `parseDuration` hours-minutes regex integer quantifier | 18 | L36 | `\d+`→`\d` (hours) | Yes — `parseDuration('12h')` === `'PT12H'` |
| C5 | `parseDuration` hours-minutes regex decimal quantifier | 21 | L36 | `\.\d+`→`\.\d` (decimal hours) | Yes — `parseDuration('1.25h')` === `'PT1H15M'` |
| C6 | `parseDuration` hours-minutes regex `^` anchor | 16 | L36 | drop `^` | Yes — `parseDuration('x2h')` throws `'Unsupported duration format: "x2h"'` |
| C7 | `parseDuration` hours-minutes regex `$` anchor | 17 | L36 | drop `$` | Yes — `parseDuration('2hx')` throws `'Unsupported duration format: "2hx"'` |
| C8 | `parseDuration` minutes-only regex `^` anchor | 38 | L45 | drop `^` | Yes — `parseDuration('x30m')` throws `'Unsupported duration format: "x30m"'` |
| C9 | `parseDuration` minutes-only regex `$` anchor | 39 | L45 | drop `$` | Yes — `parseDuration('30mx')` throws `'Unsupported duration format: "30mx"'` |
| C10 | `isoToMinutes` regex `^` anchor | 71 | L71 | drop `^` | Yes — `isoToMinutes('xPT2H')` throws `'Invalid ISO-8601 duration: "xPT2H"'` |
| C11 | `isoToMinutes` regex `$` anchor | 72 | L71 | drop `$` | Yes — `isoToMinutes('PT2Hx')` throws `'Invalid ISO-8601 duration: "PT2Hx"'` |
| C12 | `isoToMinutes` regex hours quantifier | 74 | L71 | `\d+`→`\d` | Yes — `isoToMinutes('PT12H')` === `720` |
| C13 | `isoToMinutes` null-guard condition | 82 | L72 | `match === null` → `false` (then `match[1]` on null throws `TypeError`) | Yes — `isoToMinutes('xyz')` throws `'Invalid ISO-8601 duration: "xyz"'` |
| C14 | `isoToMinutes` hours coalescing/arithmetic | 92, 93, 97 | L75,77 | `??`→`&&`; `'0'`→`""`; `*`→`/` | Yes — `isoToMinutes('PT2H')` === `120` |
| C15 | `isoToMinutes` minutes coalescing/arithmetic | 94, 95 | L76,77 | `??`→`&&`; `'0'`→`""` | Yes — covered by `isoToMinutes('PT2H')` === `120` and `'PT30M'` === `30` |
| C16 | `isoToMinutes` `+ mins` operator | 96 | L77 | `+ mins`→`- mins` | Yes — `isoToMinutes('PT1H30M')` === `90` |
| C17 | `paginate` maxPages arithmetic with non-zero `initialSkip` | 105 | L111 | `skip - initialSkip` → `skip + initialSkip` | Yes — `paginate(..., maxPages=1, pageSize=5, initialSkip=3)` returns the fetched page instead of `[]` |
| C18 | `resolveWorkItemTypeId` path: no `projectId` | 119, 120, 121 | L146–147 | cond→`false`; `===`→`!==`; global path→`""` | Yes — assert URL pathname === `/api/admin/timeTrackingSettings/workItemTypes` |
| C19 | `resolveWorkItemTypeId` path: with `projectId` | 118, 120, 122 | L146,148 | cond→`true`; project template→`""` | Yes — assert pathname === `/api/admin/projects/PROJECT-1/timeTrackingSettings/workItemTypes` |
| C20 | `resolveWorkItemTypeId` `fields` query construction | 124, 125, 126 | L150 | query object→`{}`; `'id,name'`→`""` | Yes — assert `searchParams.get('fields')` === `'id,name'` |
| C21 | `resolveWorkItemTypeId` HTTP method literal | 123 | L150 | `'GET'`→`""` | Yes — assert fetch `init.method` === `'GET'` |

Accepted residuals (equivalent / dead-code, no test can kill — see
"Accepted residuals"):

| # | Class | Mutant ids | Loc | Why unkillable |
|---|-------|------------|-----|----------------|
| R1 | `parseDuration` whitespace-collapse quantifier | 13 | L35 | `/\s+/gu`→`/\s/gu`; both replace every whitespace run with `''`, identical output for all inputs |
| R2 | `parseDuration` hours fallback literal | 33 | L38 | `hoursMinutesMatch[1] ?? '0'` — group 1 `(\d+(?:\.\d+)?)` is mandatory on match, so `[1]` is never `undefined`; the fallback is dead code |
| R3 | `parseDuration` minutes fallback literal | 48 | L47 | `minutesOnlyMatch[1] ?? '0'` — group 1 `(\d+)` is mandatory on match, so `[1]` is never `undefined`; the fallback is dead code |

## Design — tests to add

All new assertions use exact equality (`toBe`) on fully-knowable values; error
messages are captured and compared with `toBe`, never substring-matched. Each
class maps to one focused test (a class may bundle mutants that share a killing
input). The four ISO/regex-anchor classes that need distinct inputs (C6–C9) get
one test each; C4 and C5 get one test each because their killing inputs differ.

| Test (new) | Kills classes | Implementation sketch |
|------------|---------------|------------------------|
| `parseDuration('')` throws `'Duration cannot be empty'` | C1 | capture error, `expect(message).toBe('Duration cannot be empty')` |
| `parseDuration('   ')` throws `'Duration cannot be empty'`; `parseDuration('  PT2H  ')` === `'PT2H'` | C2 (+C1) | trim only matters at the empty guard and the `^PT` test |
| `parseDuration('5pt')` throws `'Unsupported duration format: "5pt"'` | C3 | `PT` not at start |
| `parseDuration('12h')` === `'PT12H'` | C4 | two-digit hours |
| `parseDuration('1.25h')` === `'PT1H15M'` | C5 | two-digit decimal hours |
| `parseDuration('x2h')` throws `'Unsupported duration format: "x2h"'` | C6 | prefix junk |
| `parseDuration('2hx')` throws `'Unsupported duration format: "2hx"'` | C7 | suffix junk |
| `parseDuration('x30m')` throws `'Unsupported duration format: "x30m"'` | C8 | prefix junk on minutes |
| `parseDuration('30mx')` throws `'Unsupported duration format: "30mx"'` | C9 | suffix junk on minutes |
| `isoToMinutes('xPT2H')` throws `'Invalid ISO-8601 duration: "xPT2H"'` | C10 | `PT` not at start |
| `isoToMinutes('PT2Hx')` throws `'Invalid ISO-8601 duration: "PT2Hx"'` | C11 | trailing junk |
| `isoToMinutes('PT12H')` === `720` | C12 | two-digit hours |
| `isoToMinutes('xyz')` throws `'Invalid ISO-8601 duration: "xyz"'` | C13 | `match === null` path |
| `isoToMinutes('PT2H')` === `120`; `isoToMinutes('PT30M')` === `30` | C14, C15 | hours defined/absent exercise both coalescing branches |
| `isoToMinutes('PT1H30M')` === `90` | C16 | `+ mins` vs `- mins` |
| `paginate(..., 1, 5, 3)` returns the one fetched item (not `[]`) | C17 | non-zero `initialSkip` distinguishes `skip - initialSkip` from `skip + initialSkip` |
| `resolveWorkItemTypeId(config, 'Development')` URL pathname === global path | C18 | no `projectId` |
| `resolveWorkItemTypeId(config, 'Bug fixing', 'PROJECT-1')` URL pathname === project path | C19 | with `projectId` |
| `resolveWorkItemTypeId(...)` `searchParams.get('fields')` === `'id,name'` | C20 | query construction |
| `resolveWorkItemTypeId(...)` fetch `init.method` === `'GET'` | C21 | HTTP method literal |

Projected post-fix score: `(101 + 2 + 32) / 138 = 135 / 138 = 0.9783` with
exactly three survivors `{13, 33, 48}` — confirmed by re-measurement (see
Verification).

## Verification

1. `bun test tests/plugins/task-provider-youtrack/helpers.test.ts` — **56 pass**
   (34 legacy + 22 new), 0 fail.
2. `bun test:mutate:file plugins/task-provider-youtrack/helpers.ts` — measured
   **killed=133, timeout=2, survived=1, noCoverage=2**, score **0.9783** (>= 0.9).
   Survivor id set: **`{13, 33, 48}`** — exactly the declared residuals.

## Accepted residuals

- **R1 — mutant 13** (`plugins/task-provider-youtrack/helpers.ts:35:36`).
  `trimmed.replace(/\s+/gu, '')` vs `trimmed.replace(/\s/gu, '')`. Replacing
  every whitespace *run* with the empty string produces the same output as
  replacing each whitespace *character* with the empty string for every possible
  input; the `+` is observable only with a non-empty replacement, which this
  call site never uses. Genuinely equivalent — no test can distinguish.
- **R2 — mutant 33** (`plugins/task-provider-youtrack/helpers.ts:38:54`). The
  `?? '0'` fallback guards `hoursMinutesMatch[1]`, but capture group 1
  `(\d+(?:\.\d+)?)` is non-optional inside the matched regex, so the index is
  always a defined string when the `if (hoursMinutesMatch !== null)` branch runs.
  The fallback is dead code; Stryker marks it `NoCoverage` because no execution
  reaches the undefined branch. Only a `src/` edit (dropping the `?? '0'`) could
  remove the mutant.
- **R3 — mutant 48** (`plugins/task-provider-youtrack/helpers.ts:47:52`). Same
  shape as R2 for `minutesOnlyMatch[1]` whose group 1 `(\d+)` is mandatory on
  match. Dead-code `NoCoverage`; unreachable by any test.
