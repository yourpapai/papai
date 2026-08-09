<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Plan — mutation coverage for `plugins/task-provider-youtrack/helpers.ts`

Reference spec: `docs/superpowers/specs/2026-08-08-mutation-coverage-youtrack-helpers-design.md`.

## Goal

Raise Stryker score from **0.7464** to **>= 0.9** (measured **0.9783**) using
test-only edits to `tests/plugins/task-provider-youtrack/helpers.test.ts`.
Survivors after the work equal exactly `{13, 33, 48}`.

## Global constraints

- Test-only: touch only `tests/...` and `docs/superpowers/...` plus the single
  `.review-loop/result.json`. Never edit `src/`, `client/`, `plugins/`,
  `scripts/`, or `scripts/mutation/baseline.json`.
- Every new assertion uses exact equality (`toBe`). Error messages are captured
  into a variable and compared with `expect(message).toBe(exact)` — never
  substring `.toThrow('...')` for new assertions.
- One focused test per mutant class; legacy substring assertions are left as-is.
- SPDX header on any new file (here and the spec, HTML-comment form for `.md`).
- Verify with `bun test <companion>` green, then re-run the mutation file run and
  confirm the survivor set before writing `result.json`.

## Tasks

- [x] Measure: `bun test:mutate:file plugins/task-provider-youtrack/helpers.ts`
      → 101 killed / 2 timeout / 31 survived / 4 noCoverage, score 0.7464.
- [x] Spec written (gap table maps every surviving id to a kill strategy).
- [x] Plan written (this file).

### Tests to add (companion: `tests/plugins/task-provider-youtrack/helpers.test.ts`)

- [x] **C1** empty guard — `parseDuration('')` throws `'Duration cannot be empty'`
      (ids 3, 5, 6, 7).
- [x] **C2** trim — `parseDuration('   ')` throws `'Duration cannot be empty'`;
      `parseDuration('  PT2H  ')` === `'PT2H'` (id 1).
- [x] **C3** ISO `^PT` anchor — `parseDuration('5pt')` throws
      `'Unsupported duration format: "5pt"'` (id 10).
- [x] **C4** hours integer quantifier — `parseDuration('12h')` === `'PT12H'`
      (id 18).
- [x] **C5** hours decimal quantifier — `parseDuration('1.25h')` === `'PT1H15M'`
      (id 21).
- [x] **C6** hours-minutes `^` anchor — `parseDuration('x2h')` throws
      `'Unsupported duration format: "x2h"'` (id 16).
- [x] **C7** hours-minutes `$` anchor — `parseDuration('2hx')` throws
      `'Unsupported duration format: "2hx"'` (id 17).
- [x] **C8** minutes-only `^` anchor — `parseDuration('x30m')` throws
      `'Unsupported duration format: "x30m"'` (id 38).
- [x] **C9** minutes-only `$` anchor — `parseDuration('30mx')` throws
      `'Unsupported duration format: "30mx"'` (id 39).
- [x] **C10** iso `^` anchor — `isoToMinutes('xPT2H')` throws
      `'Invalid ISO-8601 duration: "xPT2H"'` (id 71). Imported `isoToMinutes`.
- [x] **C11** iso `$` anchor — `isoToMinutes('PT2Hx')` throws
      `'Invalid ISO-8601 duration: "PT2Hx"'` (id 72).
- [x] **C12** iso hours quantifier — `isoToMinutes('PT12H')` === `720` (id 74).
- [x] **C13** iso null guard — `isoToMinutes('xyz')` throws
      `'Invalid ISO-8601 duration: "xyz"'` (id 82).
- [x] **C14/C15** iso coalescing + arithmetic — `isoToMinutes('PT2H')` === `120`;
      `isoToMinutes('PT30M')` === `30` (ids 92, 93, 94, 95, 97).
- [x] **C16** iso `+ mins` — `isoToMinutes('PT1H30M')` === `90` (id 96).
- [x] **C17** paginate maxPages arithmetic — `paginate(cfg, '/p', {}, schema, 1, 5, 3)`
      returns the one-item fetched page, not `[]`; assert `result.length === 1`
      and `callCount === 1` (id 105).
- [x] **C18** resolveWorkItemTypeId global path — no `projectId`; assert
      `new URL(call).pathname` === `/api/admin/timeTrackingSettings/workItemTypes`
      (ids 119, 120, 121).
- [x] **C19** resolveWorkItemTypeId project path — with `'PROJECT-1'`; assert
      pathname === `/api/admin/projects/PROJECT-1/timeTrackingSettings/workItemTypes`
      (ids 118, 120, 122).
- [x] **C20** resolveWorkItemTypeId `fields` query — assert
      `searchParams.get('fields')` === `'id,name'` (ids 124, 125, 126).
- [x] **C21** resolveWorkItemTypeId HTTP method literal — assert fetch
      `init.method` === `'GET'` (id 123; the L150:43 `'GET'` literal, observable
      only via the mocked fetch init since the analytics scope is `no_analytics`).

### Residuals to declare (equivalent / dead code)

- [x] **R1** id 13 — `/\s+/gu`→`/\s/gu`, no-op for empty replacement.
- [x] **R2** id 33 — `hoursMinutesMatch[1] ?? '0'`, group 1 mandatory → dead.
- [x] **R3** id 48 — `minutesOnlyMatch[1] ?? '0'`, group 1 mandatory → dead.

## Verification gate

- [x] `bun test tests/plugins/task-provider-youtrack/helpers.test.ts` — 56 pass,
      0 fail.
- [x] `bun test:mutate:file plugins/task-provider-youtrack/helpers.ts` — score
      **0.9783** (>= 0.9); survivor id set === `{13, 33, 48}`.
- [x] Write `.review-loop/result.json` with specPath, planPath, testPaths,
      residuals (each with `loc`, `why`, exact `mutantIds`), notes.
