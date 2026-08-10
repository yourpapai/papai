<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation coverage — `plugins/task-provider-kaneo/list-tasks-query.ts`

## Summary

Lift the per-file Stryker mutation score of
`plugins/task-provider-kaneo/list-tasks-query.ts` from **0** (no companion test
exists) to **1.0** by adding a companion test file. Every one of the 10
generated mutants is killable through the function's observable behavior, so the
target (>= 0.9) is exceeded with **no accepted residuals**.

## Why this file

`buildListTasksQuery` translates a `ListTasksParams` object into the
`Record<string, string>` query-string shape consumed by the Kaneo
`GET /task/tasks/:projectId` request path. It is small but load-bearing: its
null/undefined-skipping contract is what keeps empty params out of the wire
query, and its `String(value)` coercion is what serializes numeric fields such as
`page`/`limit`. Despite that, it has zero test coverage, so Stryker reports
`killed=0 survived=0 noCoverage=10 score=0`.

## Non-goals

- Editing `plugins/`, `src/`, `client/`, or `scripts/` — this is test-only work.
- Changing `scripts/mutation/baseline.json` (the runner owns the ratchet).
- Covering `list-tasks.ts` (the caller) or `schemas/list-tasks.ts` — out of scope;
  only `list-tasks-query.ts` is the target.
- Rewriting `buildListTasksQuery`; the implementation stays byte-for-byte
  identical.

## Gap analysis

Measured with `bun test:mutate:file plugins/task-provider-kaneo/list-tasks-query.ts`.
All 10 mutants carry status `NoCoverage` (no test exercises the file). Grouped
by observable effect class:

| Class | Mutant ids | Mutator / replacement | Effect when surviving | Killed by |
| --- | --- | --- | --- | --- |
| C1 — body/loop/control-flow drops all defined values | 0, 1, 2 | `0` BlockStatement fn body -> `{}`; `1` BlockStatement for-body -> `{}`; `2` ConditionalExpression -> `true` (always `continue`) | A populated input returns `{}` instead of the stringified params | Test C1 |
| C2 — `value === undefined` arm mutated (undefined leaks) | 5, 6 (+ also 3, 4, 9) | `5` `value === undefined` -> `false`; `6` `===` -> `!==` on undefined arm | An explicit `undefined` value is retained as `"undefined"` (and/or defined values are dropped) | Test C2 |
| C3 — `value === null` arm mutated (null leaks) | 7, 8 (+ also 3, 4, 9) | `7` `value === null` -> `false`; `8` `===` -> `!==` on null arm | A `null` value is retained as `"null"` (and/or defined values are dropped) | Test C3 |
| C4 — whole condition falsified / `continue` body removed | 3, 4, 9 | `3` ConditionalExpression -> `false`; `4` `||` -> `&&` (always false); `9` BlockStatement `{ continue }` -> `{}` | Both null and undefined leak through as `"null"`/`"undefined"` | Test C2 and Test C3 together |

Note: classes C2 and C3 each absorb the C4 mutants (3, 4, 9) because the
"omit undefined" and "omit null" assertions independently kill them; the union
of the three tests covers every id exactly once or more.

## Design — tests to add

New file `tests/plugins/task-provider-kaneo/list-tasks-query.test.ts`, mapped
one-to-one onto the gap classes. Every assertion uses exact `toBe` equality on a
fully-knowable JSON-serialized string (no partial matchers).

- **Test C1 — "stringifies every defined param and keeps them in the result"**
  (kills ids 0, 1, 2, 6, 8). Input `{ status: 'open', page: 3 }`; assert
  `JSON.stringify(result)` is exactly `'{"status":"open","page":"3"}'`. The
  `page: 3 -> "3"` pin also locks the `String(value)` coercion.

- **Test C2 — "omits params whose value is explicitly undefined"**
  (kills ids 3, 4, 5, 6, 9). Input `{ status: 'open', assigneeId: undefined }`;
  assert the result serializes to exactly `'{"status":"open"}'`. `undefined`
  must be set explicitly so `Object.entries` yields the entry.

- **Test C3 — "omits params whose value is null"**
  (kills ids 3, 4, 7, 8, 9). Input `{ status: 'open', priority: null }`; assert the
  result serializes to exactly `'{"status":"open"}'`. `ListTasksParams` types
  forbid `null`, so this simulates a runtime-null caller (the exact case the
  `value === null` guard exists for) via a lint-safe
  `Object.assign({ status: 'open', priority: 'high' }, { priority: null })` —
  oxlint's `no-unsafe-type-assertion` / `no-unsafe-assignment` rules block the
  obvious `as unknown as` / `JSON.parse` casts, so the repo's "merge a null in"
  idiom is used instead. No `any`, no ignore comments.

Killed-id union across the three tests:
`{0,1,2,6,8} ∪ {3,4,5,6,9} ∪ {3,4,7,8,9} = {0,1,2,3,4,5,6,7,8,9}` — all 10.

## Verification

- `bun test tests/plugins/task-provider-kaneo/list-tasks-query.test.ts` green.
- `bun test:mutate:file plugins/task-provider-kaneo/list-tasks-query.ts` reports
  `killed=10 survived=0 noCoverage=0 score=1.0` (>= 0.9 target).

## Accepted residuals

None. Every generated mutant is reachable and distinguishable through the
function's return value, so the tests-only ceiling is 1.0 with no equivalent
mutants to declare.
