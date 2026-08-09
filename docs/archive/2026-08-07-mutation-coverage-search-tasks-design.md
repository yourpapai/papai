<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation coverage — `plugins/task-provider-kaneo/search-tasks.ts`

## Summary

Raise the per-file Stryker mutation score for
`plugins/task-provider-kaneo/search-tasks.ts` from **0.6327** (31 killed / 49)
to the tests-only ceiling by extending its companion test file. The ceiling
lands at **0.8163** (40 killed / 49): nine mutants are genuinely unkillable from
`tests/` alone and are declared as residuals, so the file is reported as
**capped** under the mutation-improve capped path (score improved + declared
residual mutant ids exactly equal the runner-measured survivors).

## Why this file

Selected by the mutation-improve SELECT phase as the highest-ROI baseline entry
below threshold. The module is small (108 lines), fully exported-surface
testable, and its companion suite (`tests/plugins/task-provider-kaneo/search-tasks.test.ts`)
already exercises the happy path — leaving schema-shape, defaulting, pagination,
error-propagation, and logging mutants under-asserted.

## Non-goals

- Editing anything under `src/`, `client/`, `plugins/`, or `scripts/` (test-only
  iteration; the IMPROVE phase diff-guard forbids it).
- Refactoring `search-tasks.ts` to make its module-load `logger.child(...)`
  injectable/lazy — that is the one `src/` change which would unblock the
  logging residuals, and it is out of scope here.
- Changing `scripts/mutation/baseline.json` (the runner owns the ratchet).
- Improving the sibling suites (`activation`, `index`, `provision`) that are
  paired into the run.

## Gap analysis

Measured baseline (`bun test:mutate:file plugins/task-provider-kaneo/search-tasks.ts`):
`killed=31 survived=14 noCoverage=4 score=0.6326530612244898`. The 18 surviving
mutants group into ten classes:

| # | Class | Stryker ids | Location | Status after measure |
| --- | --- | --- | --- | --- |
| 1 | `TaskResultSchema` pick-mask fields (`id`/`title`/`number`/`status`/`projectId` flipped to `false`) | 3, 4, 5, 6, 8 | L18–L23 | Survived |
| 2 | `flattenGroupedTaskSearchResults` number nullish-default (`??` → `&&`) | 13 | L37 | Survived |
| 3 | `flattenGroupedTaskSearchResults` userId nullish-default (`''` → `"Stryker was here!"`) | 16 | L41 | Survived |
| 4 | `filterAndPaginate…` offset-only slice removed (`.slice(start)` → `filteredTasks`) | 32 | L59 | Survived |
| 5 | `searchTasks` catch-block body removed (`{…}` → `{}`) | 46 | L104–L107 | NoCoverage |
| 6 | Module-load `logger.child({ scope })` scope object + string | 0, 1 | L14 | Survived |
| 7 | `log.debug(…)` entry payload object + message string | 36, 37 | L79 | Survived |
| 8 | `log.info(…)` success payload object + message string | 44, 45 | L102 | Survived |
| 9 | `log.error(…)` failure payload object + message string | 47, 48 | L105 | NoCoverage |
| 10 | Defensive `priority` fallback `'no-priority'` (parse-failure branch) | 14 | L39 | NoCoverage |

## Design — tests to add

Each killable class gets exactly one new test in the companion file
(`tests/plugins/task-provider-kaneo/search-tasks.test.ts`), mapped one-to-one
onto the gap rows above. Every assertion uses exact equality (`toBe` / `toEqual`);
no `startsWith`/`endsWith`/`toContain` for knowable values.

| Class | Test added | Mutants killed | How it kills |
| --- | --- | --- | --- |
| 1 — pick-mask | `TaskResultSchema retains every picked source field` | 3, 4, 5, 6, 8 | `safeParse` a fully-populated object and assert each field via `toBe`; dropping any picked field yields `undefined` and fails the exact assertion. |
| 2 — number default | `flattenGroupedTaskSearchResults preserves number and defaults null number to 0` | 13 | Call the exported helper with `number: 42` (assert `42`) and `number: null` (assert `0`); the `?? → &&` mutant yields `0` and `null` respectively. |
| 3 — userId default | `flattenGroupedTaskSearchResults defaults null userId to empty string` | 16 | Call the helper with `userId: null` and assert `''`; the string-literal mutant yields `"Stryker was here!"`. |
| 4 — offset slice | `applies offset without limit when filtering by assigneeId` | 32 | `searchTasks({ assigneeId, offset: 1 })` with two matching tasks; original keeps the second, the method-removal mutant returns both → length mismatch. |
| 5 — catch propagation | `rethrows a classified error when the search request fails` | 46 | Mock a 500 response and assert `rejects.toThrow('Kaneo API GET request failed with status 500')`; empty-catch mutant swallows the error and resolves `undefined`. |

### Residual classes (no test — see Accepted residuals)

Classes 6–10 are declared as residuals. The logging classes (6–9) cannot be
killed from `tests/` in this harness: `search-tasks.ts` evaluates
`const log = logger.child({ scope: 'kaneo:search-tasks' })` at module load, and
Stryker runs every paired test file in a single shared process where sibling
suites statically import the module first — so `log` is permanently bound to the
real pino logger before any test-level mock can intercept. Class 10 is dead code
in the integrated path and is blocked from direct testing by the repo's
`no-unsafe-type-assertion` lint rule. See *Accepted residuals*.

## Verification

- `bun test tests/plugins/task-provider-kaneo/search-tasks.test.ts` → 12 pass.
- `bun test tests/plugins/task-provider-kaneo/` → 373 pass, 0 fail.
- `oxlint --config .oxlintrc.json tests/plugins/task-provider-kaneo/search-tasks.test.ts` → clean.
- `bun test:mutate:file plugins/task-provider-kaneo/search-tasks.ts` →
  `killed=40 survived=8 noCoverage=1 score=0.8163265306122449`; surviving ids are
  exactly `["0","1","14","36","37","44","45","47","48"]`.

## Accepted residuals

Nine mutants survive and are declared in `result.json`. Per-loc reasoning lives
in the residuals entries; summary:

- **0, 1, 36, 37, 44, 45, 47, 48** — logging payloads/scope. Unkillable by
  tests-only because of the shared-process module-load binding described above;
  killing requires a `src/` edit (lazy/DI logger).
- **14** — `'no-priority'` defensive fallback at L39. Unreachable through
  `searchTasks` (response is validated by `GlobalSearchResponseSchema`
  upstream), and a direct `flattenGroupedTaskSearchResults` call with an invalid
  priority requires a type assertion that `no-unsafe-type-assertion` forbids.
