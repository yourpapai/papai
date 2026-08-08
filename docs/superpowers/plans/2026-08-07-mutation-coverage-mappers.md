<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Plan — mutation coverage for `plugins/task-provider-kaneo/mappers.ts`

Reference spec:
`docs/superpowers/specs/2026-08-07-mutation-coverage-mappers-design.md`.

## Goal

Raise the file's mutation score from 0.317 to its tests-only ceiling
(**0.762**, measured) by adding `tests/plugins/task-provider-kaneo/mappers.test.ts`,
then declare the 15 unkillable residuals so the runner marks the file
**capped**. The 0.9 target is unreachable without a `plugins/` edit.

## Global constraints

- **Test-only.** Touch only `tests/` and `docs/superpowers/` (plus the single
  `.review-loop/result.json`). Never edit `src/`, `client/`, `plugins/`,
  `scripts/`, or `scripts/mutation/baseline.json`.
- **Exact equality.** Every assertion uses `toBe(...)` (or `toBe` on a captured
  object/array reference, or `expect('k' in o).toBe(bool)`). No
  `startsWith` / `endsWith` / `toContain` where a full value is knowable.
- **Type-honest inputs only.** The repo linter (`typescript/no-unsafe-type-assertion`,
  enforced via `pedantic` + `denyWarnings`) rejects the `as unknown as` casts
  that would be needed to feed `Date` / number values into the strictly-typed
  mapper parameters. No `lint-disable` / `type-ignore` comments (hook policy).
  Consequence: only `string` / `null` / `undefined` inputs are used, which
  means the `Date` branches and the `typeof === 'string'`→true mutants are
  unreachable / indistinguishable and become residuals.
- **SPDX header** on the new test file (BUSL-1.1 `.ts` style).
- One focused test per mutant class; the two date helpers are exercised
  indirectly through the exported mappers that call them.

## Tasks

- [x] MEASURE — before score 0.317 (20/63), survivors enumerated.
- [x] SPEC — design doc written.
- [x] PLAN — this file.
- [x] **G4** — `mapCreateTaskResponse` maps every field; string
      `startDate`/`dueDate`/`createdAt` pass through unchanged. Kills
      ids 14, 15, 19, 21, 23, 24, 25.
- [x] **G7 (details)** — `mapTaskDetails` maps every field incl. `relations`
      (captured reference). Kills ids 30, 31.
- [x] **G7 (list)** — `mapTaskListItem` maps fields; null dueDate passes
      through. Kills ids 32, 33.
- [x] **G8 (present)** — `mapProject` includes a non-empty description (exact
      string). Kills ids 42, 43, 44, 50, 52, 54, 56.
- [x] **G8 (absent)** — `mapProject` omits description for null / undefined /
      `''` via `'description' in result` is `false`. Kills ids 45, 46, 47, 48,
      49, 51, 53, 55.
- [x] **G7 (comment)** — `mapComment` maps fields. Kills ids 57, 58.
- [x] **self-containment** — direct tests for `mapLabel`, `mapColumn`,
      `mapTaskSearchResult`, `mapGlobalSearchTaskResults` (reinforces
      already-killed mutants; keeps the companion self-contained).
- [x] **VERIFY** — `bun test tests/plugins/task-provider-kaneo/mappers.test.ts`
      green (15 pass); oxlint + tsgo clean.
- [x] **RE-MEASURE** — score 0.7619 (48 killed / 10 survived / 5 noCoverage);
      survivors exactly `{2, 3, 4, 6, 8, 12, 13, 16, 17, 18, 20, 22, 26, 27, 37}`.
- [x] **RESIDUALS** — write `.review-loop/result.json` with the 15 residual
      mutant ids.

## Accepted residuals (tests-only ceiling = 0.762)

| Class | Loc | ids | Reason |
|-------|-----|-----|--------|
| G1 | `toDateString:24` | 2, 3, 4, 6 | Equivalent: line-27 fall-through also returns `null`. |
| G2 | `toDateString:25` | 8 | Equivalent for typed inputs: line 25 only sees strings (null/undefined exit at :24). |
| G3 | `toDateString:26` | 12, 13 | Unreachable via typed API; needs `Date` (blocked by lint). |
| G6 | `toOptionalDateString:31` | 16, 17, 18, 20 | Equivalent: line-34 fall-through also returns `undefined`. |
| G5a | `toOptionalDateString:32` | 22 | Equivalent for typed input: `createdAt` is a required string. |
| G5b | `toOptionalDateString:33` | 26, 27 | Unreachable via typed API; `createdAt` required string. |
| G9 | `mapGlobalSearchTaskResults:92` | 37 | Dead code after schema double-parse. |

All require `plugins/` edits (export/loosen the helpers, delete the redundant
guards, or drop the dead fallback) and are declared, not fixed.
