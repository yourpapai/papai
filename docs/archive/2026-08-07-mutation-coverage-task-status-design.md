<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation Coverage — `plugins/task-provider-kaneo/task-status.ts`

**Date:** 2026-08-07
**Status:** Approved
**Target file:** `plugins/task-provider-kaneo/task-status.ts`
**Measured baseline:** score `0.234375` (15 killed / 64 total; 48 Survived + 1 NoCoverage)
**Target:** `>= 0.9`

## Summary

Raise the mutation score of `task-status.ts` from `0.234` as far as is
achievable with **test-only** changes in the companion file
`tests/plugins/task-provider-kaneo/task-status.test.ts`. No production code is
touched. The work adds coverage for the entirely-untested `denormalizeStatus`
export, fills in edge cases for `validateStatus` (special-character columns,
multi-whitespace normalization, the partial-match / `slugPattern` branch, and
exact error-message strings). The measured result is **0.875** (56/64 killed);
the 8 survivors are all unkillable from the companion file and are declared as
residuals (capped path). The `>= 0.9` clean target is unreachable test-only
because the surviving mutants are either genuinely equivalent or are
module-init logger side-effects that the harness pre-binds before any
companion-file mock can intercept (see *Accepted residuals*).

## Why this file

`task-status.ts` is a small but security/relevance-relevant module: it maps a
free-text status string onto a Kaneo column slug for two operations
(`validateStatus`, `denormalizeStatus`). Its current score (`0.234`) is the
lowest in the kaneo plugin and reflects that only the happy-path exact-match of
`validateStatus` is exercised — `denormalizeStatus` has **zero** test coverage
and every partial-match / slug-regex / logger mutant survives.

## Non-goals

- Editing anything under `src/`, `client/`, `plugins/`, or `scripts/`.
- Editing `scripts/mutation/baseline.json` (the runner owns it).
- Refactoring `task-status.ts` itself (e.g. de-duplicating the two slugification
  loops) — that would be a behavior-equivalent source edit and is out of scope
  for a test-only iteration.
- Killing the genuinely-equivalent residuals (see *Accepted residuals*).

## Gap analysis

The measured Stryker report (`reports/paired/plugins__task-provider-kaneo__task-status.ts.stryker-report.json`)
enumerates 49 surviving mutants (48 `Survived` + 1 `NoCoverage`). They cluster
into the classes below. Mutant ids are the Stryker `"id"` values.

| Class | Location (line) | Surviving mutant ids | Why it survives today |
|---|---|---|---|
| A. `denormalizeStatus` untested | L78–L86 | 48, 49, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63 | The export has no tests at all; every mutant in it is unreached. |
| B. Input whitespace collapse (`\s+`→`\s`) | L36 | 9 | Tests use single-space inputs only, so `\s+` and `\s` agree. |
| C. First-loop slugification (upper/lower, `\s+`, `\S+`, join string, empty body/cond) | L39–L45 | 12, 13, 14, 15, 16, 18, 20 | For clean inputs the second loop rescues an exact match, and no special-character column is fed in. |
| D. `slugPattern` gate regex | L49 | 21, 22, 23, 24, 25, 26, 27 | No input distinguishes the boundary mutations; clean inputs all pass the original pattern. |
| E. Partial-match branch (cond, body, slugify, operators) | L50–L58 | 28, 29, 30, 31, 32, 34, 35, 37, 38, 41, 42, 43 | No partial (prefix) status is ever resolved, so the whole second loop + its `startsWith` path is dormant. |
| F. Exact error message (`available.join(', ')` separator) | L63 | 46 | Existing assertions use `toContain`, which the join-mutation still satisfies. |
| G. Logger scope + debug payloads | L12, L32, L78 | 0, 1, 5, 6, 48, 49 | `mockLogger()` installs a no-op mock; no test asserts the scope string or the debug payload/message. **Accepted residual** — see *Accepted residuals*. |

## Design — tests to add

Each new test maps one-to-one onto a gap class (and kills exactly the ids in
that class). All string assertions use `toBe` (exact equality).

- **`denormalizeStatus` (Class A)** — new `describe`:
  - exact slug match returns the canonical column slug.
  - compound/compound-prefixed slug (`in-progress-2`) resolves to the canonical
    `in-progress` via the `startsWith(columnSlug + '-')` path on a non-first
    column.
  - multi-space column name (`To  Do`) with a compound input proves the loop
    slug collapses whitespace.
  - ordered columns (`[{To Do},{To}]`) distinguish the `===` branch from the
    `startsWith` branch (kills 59).
  - a column whose slug is a no-dash prefix of the input (`In` / `inertia`)
    isolates the `'-'` join string (kills 62).
  - no-match returns the input slug unchanged.
- **Input whitespace collapse (Class B)** — feed `'To  Do'` (two spaces) and
  assert the result is exactly `'to-do'`.
- **First-loop slugification (Class C)** — a column whose slug contains both a
  multi-space run **and** a non-slug character (`'In  Review?'`) plus an input
  that exactly matches its slug but fails `slugPattern`. This makes the first
  loop the only path that can succeed, so every first-loop mutant is observable.
- **`slugPattern` gate (Class D)** — targeted inputs/columns per boundary
  mutation: prefix-anchored (`##to`), suffix-anchored (`to##`), single-char
  start (`to`), one-group (`to`), repeated-group (`to-do` vs `To Do Extra`).
- **Partial-match branch (Class E)** — resolve a prefix status (`'to'`) against
  the default columns to assert `'to'`; plus targeted columns that flip each
  `startsWith`/operator mutant (`Today`, `To! Do`).
- **Exact error message (Class F)** — assert the thrown `.message` equals
  `` `Invalid status "Review". Must match one of: To Do, In Progress, Done` ``.
- **Logger instrumentation (Class G)** — **accepted residual, not killed.**
  `const log = logger.child(...)` is captured at module-initialization time.
  Under the paired Stryker run, `task-status.js` is transitively imported at
  runtime by `task-update-helpers.ts` and `task-resource.ts` (each exercised by
  its own sibling test file in the same 15-file run), so the module — and its
  `logger.child(...)` call — is evaluated against the real logger before any
  `mock.module()` the companion file installs can intercept. A delayed-import
  harness inside the companion file cannot win this race (the module is already
  cached), so the scope string and the two `debug` payloads/messages are
  unobservable from the companion test file. These mutants are behaviorally
  inert (logger output only) and are declared as residuals.

## Verification

1. `bun test tests/plugins/task-provider-kaneo/task-status.test.ts` is green (23 pass).
2. `bun test:mutate:file plugins/task-provider-kaneo/task-status.ts` reports
   `score 0.875` (56 killed / 8 survived), with the survivors being exactly the
   accepted residuals below.
3. The declared residual `mutantIds` exactly equal the measured survivor set
   `{0, 1, 5, 6, 33, 39, 48, 49}`.

## Accepted residuals

These 8 surviving mutants cannot be killed from the companion test file and are
declared as residuals:

- **`task-status.ts:12` `logger.child({ scope: 'kaneo:task-status' })` —
  ObjectLiteral → `{}` (id 0) and StringLiteral `scope` → `""` (id 1).**
  Module-init side-effect. `task-status.js` is transitively runtime-imported by
  `task-update-helpers.ts` and `task-resource.ts` (each driven by a sibling test
  file in the same paired Stryker run), so it is evaluated against the real
  logger before any `mock.module()` installed by the companion file can
  intercept. The scope is therefore unobservable from the companion file.
- **`task-status.ts:32` `validateStatus` `log.debug({ projectId, status },
  'Validating status')` — ObjectLiteral → `{}` (id 5) and StringLiteral → `""`
  (id 6).** Same module-init binding as above: `log` is the real logger's child,
  so the payload/message are unobservable. Behaviorally inert (debug log only).
- **`task-status.ts:78` `denormalizeStatus` `log.debug({ projectId, statusSlug },
  'Denormalizing status')` — ObjectLiteral → `{}` (id 48) and StringLiteral →
  `""` (id 49).** Identical reasoning to ids 5/6.
- **`task-status.ts:54` `columnSlug === normalizedStatus` → `false` (id 39).**
  Genuinely equivalent. By the time control reaches the second loop, the first
  loop has already established that no column slug exactly equals
  `normalizedStatus` (both loops compute the slug identically from the same
  `column.name` and compare against the same `normalizedStatus`). Forcing this
  operand to `false` therefore changes nothing.
- **`task-status.ts:53` column-slug `\s+` → `\s` (id 33).** Genuinely
  equivalent. The second loop is only reached when the first loop found no exact
  match, so only the `startsWith(normalizedStatus + '-')` operand can fire here.
  `\s+` and `\s` differ solely at multi-whitespace sites inside `column.name`;
  the checked prefix (`normalizedStatus + '-'`) always terminates at a single
  `-` that both regexes produce identically, so the difference always lands one
  character beyond the prefix that `startsWith` examines. No input can flip the
  result.
