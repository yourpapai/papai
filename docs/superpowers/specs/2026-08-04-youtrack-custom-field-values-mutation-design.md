<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation coverage: `plugins/task-provider-youtrack/custom-field-values.ts`

Date: 2026-08-04
Status: approved

## Goal

Raise the mutation score of
`plugins/task-provider-youtrack/custom-field-values.ts` — real paired score
**0** (0 killed / 14 survived / 81 no-coverage, 95 mutants), the worst genuine
gap found in `scripts/mutation/baseline.json` — to **≥ 0.9** with pure unit
tests. No source changes.

## Background and findings

### Target selection (baseline triage, 2026-08-04)

`scripts/mutation/baseline.json` lists many 0-score entries. Probing them with
the official paired runner (`bun test:mutate:file`) splits them into **stale
seed artifacts** and **genuine gaps**:

| File | Baseline | Paired (K/S/NC) | Verdict |
| --- | --- | --- | --- |
| `youtrack/collaboration-provider.ts` | 0 | 19/0/0 → **1.0** | Stale seed; existing integration tests already kill all 19 mutants. Nothing to do. |
| **`youtrack/custom-field-values.ts`** | 0 | 0/14/**81** → **0** | **Genuine gap — selected target.** |
| `src/tools/search-memos.ts` | 0.175 | 17/28/51 → 0.177 | Genuine gap; needs tool/store harness; deferred. |
| `youtrack/validate-config.ts` | 0 | 0/0/32 | No covering test exists; 32 mutants; deferred. |
| `youtrack/phase-five-provider.ts` | 0 | 0/0/9 | Tiny delegation layer; deferred. |
| `src/tools/update-sprint.ts` | 0.12 | 3/14/6 → 0.13 | Small; deferred. |
| `kaneo/create-task.ts` | 0 | 3/6/3 → 0.25 | Thin wrapper, 12 mutants; low value. |

### Why this file

- **Worst genuine measurement:** 95 mutants, none killed; 81 never even
  executed by the discovered test set.
- **Production-critical read path:** the sole export `mapReadOnlyCustomFields`
  feeds `mappers.ts:217`, the issue→task conversion every YouTrack task fetch
  passes through. Surviving mutants here silently corrupt the custom fields
  the LLM reads (wrong fallback branch, inverted generic-field filter,
  stringified `null`).
- **Cheapest full kill in the repo:** 57 lines of pure functions — no fetch,
  no store, no DI, no clock. Every mutant is killable with plain input/output
  assertions.
- No existing test file references the module (`grep tests/` — no hits).

Alternatives considered: `src/tools/search-memos.ts` (similar mutant count,
0.177 real, but requires the tool-executor + memo-store harness and half its
gap is uncovered error/formatting chunks — higher effort, lower kill
certainty), `youtrack/validate-config.ts` (no covering test at all, 32
mutants, smaller blast radius than the per-task read path),
`youtrack/collaboration-provider.ts` (initially selected from the baseline,
then measured at 1.0 — stale seed, excluded).

### Mutant inventory (`bun test:mutate:file plugins/task-provider-youtrack/custom-field-values.ts`, 2026-08-04)

95 mutants: **0 killed, 14 survived, 81 no-coverage** — paired score 0,
matching the baseline entry. Mutant classes, mapped to source:

- **L14 — generic-field exclusion set: 3 StringLiteral + 1 ArrayDeclaration
  (all among the 14 current survivors).**
  `new Set(['State', 'Priority', 'Assignee', YOUTRACK_DUE_DATE_FIELD_NAME])`;
  member literals and the array itself are unexercised.
- **L15 — `isRecord` guard: 1 LogicalOperator + 1 StringLiteral
  (`typeof value === 'object' && value !== null`).** The `&&`→`||` mutant is
  predicted **equivalent**: `getStringProperty` is only reachable with
  records, arrays, and functions (null/undefined/primitives return earlier),
  and for all of them both operators agree. Accepted survivor if confirmed.
- **L16–L20 — `getStringProperty`: ConditionalExpression + StringLiteral per
  branch** (`!isRecord(value)` guard, `typeof prop === 'string'` ternary,
  `'login' | 'name' | 'text'` literals).
- **L21–L27 — `stringifyUnknownValue`: 1 StringLiteral (`'[complex value]'`),
  1 `??` ConditionalExpression/LogicalOperator, catch-block mutants.**
  `JSON.stringify` returns `undefined` for functions (hits `??`), throws for
  circular structures (hits `catch`).
- **L29–L47 — `buildReadOnlyCustomFieldValue` fallback ladder: the bulk of
  the 95 (~60 mutants).** EqualityOperator/LogicalOperator on
  `value === null || value === undefined`; the `typeof` triple chain
  (string/number/boolean) with its literals; three negated
  `!== undefined` guards ordering `.text` → `.name` → `.login`;
  `Array.isArray` guard; arrow bodies, ternary, and filter predicate inside
  the array branch.
- **L49–L57 — `mapReadOnlyCustomFields`: ~15 mutants, including the
  remaining 10 current survivors.** Survivors: `?? []` (MethodExpression +
  LogicalOperator, L52), filter predicate (BooleanLiteral + ArrowFunction,
  L53), map callback (ArrowFunction, L54), function body (BlockStatement,
  L51), and the `mapped.length === 0 ? undefined : mapped` tail
  (ConditionalExpression ×2 + EqualityOperator, L56). No-coverage mutants:
  `!nonGenericFieldNames.has(...)` negation, map ObjectLiteral
  (`{ name, value }` → `{}`), and the same tail expressions.

## Design

New companion test file
`tests/plugins/task-provider-youtrack/custom-field-values.test.ts` (mirror
path → the paired runner's companion resolver discovers it automatically; no
`overrides.json` edit). Plain `bun:test` unit tests, no harness. All
assertions go through the single public export `mapReadOnlyCustomFields`;
the private helpers are exercised by crafting `value` shapes on a field named
`'Team'` (not in the exclusion set). `YOUTRACK_DUE_DATE_FIELD_NAME` is
imported from `plugins/task-provider-youtrack/constants.js` rather than
hardcoded.

### 1. Filter and shape contract (kills L14, L51–L56 survivors + no-coverage)

- `undefined` input → `undefined` (kills the negated `length === 0` mutant,
  which would return `[]`).
- `[]` → `undefined`; input whose fields are all excluded → `undefined`.
- Fields named `State`, `Priority`, `Assignee`, and
  `YOUTRACK_DUE_DATE_FIELD_NAME` are dropped; a `'Team'` field survives
  (kills the `!`-removal mutant, the empty-Set ArrayDeclaration mutant, and
  each Set-member StringLiteral mutant).
- Result entries have exactly `{ name, value }` shape (kills the
  ObjectLiteral `{}` mutant); multiple generic fields preserve input order.

### 2. Primitive and null handling (kills L30–L31)

Each case asserted on a single `'Team'` field:

- `value: null` → `null`; `value: undefined` → `null` (kills the `||`→`&&`
  mutant: `null` would fall through the ladder and stringify to `'null'`).
- `value: 'abc'` → `'abc'`; `value: 5` → `5`; `value: false` → `false`.
  `toBe` distinguishes `5` from `'5'` and `false` from `'false'`, killing the
  typeof-chain literals and LogicalOperator mutants that would reroute
  primitives into the property/stringify path.

### 3. Object fallback ladder (kills L32–L37 + getStringProperty cluster)

- `{ text: 'T', name: 'N', login: 'L' }` → `'T'` — priority order (kills the
  negated `textValue !== undefined` guard, which would return `'N'`).
- `{ name: 'N', login: 'L' }` → `'N'`; `{ login: 'L' }` → `'L'`.
- `{ name: 42 }` → falls through (non-string property rejected by
  `getStringProperty`) to the stringify tail → `'{"name":42}'` (kills the
  `typeof prop === 'string'` mutants).

### 4. Array branch (kills L38–L45)

- `['a', 'b']` → `['a', 'b']`.
- Mixed `[{ name: 'A' }, 'b', null, 42]` → `['A', 'b']` — object mapping,
  string passthrough, and the undefined-filter all asserted in one case
  (kills the map arrow-body, item ternary, and filter-predicate mutants).
- `[{ login: 'L' }]` → `['L']` (name→login fallback inside array items).

### 5. Stringify tail (kills L21–L27 + L46)

- `{ foo: 'bar' }` (no text/name/login) → `'{"foo":"bar"}'`.
- A function value → `'[complex value]'` (`JSON.stringify(fn) === undefined`
  hits the `??`; kills its removal mutant).
- A circular object (`obj.self = obj`) → `'[complex value]'` (kills the
  catch-path mutants).

### Expected outcome

Predicted killed: ~85–92 of 95 (all 81 no-coverage mutants become executed
and killed by the oracle assertions above; all 14 current survivors sit in
the L14 exclusion-set and L51–L56 wrapper clusters targeted by section 1,
plus the L15 `isRecord` arrow body killed transitively by section 3's object
ladder). Expected paired score **≥ 0.9**. Predicted accepted survivor:
the `isRecord` `&&`→`||` equivalent (L15). Any other survivor is investigated
and either killed with an additional case or justified in the plan.

## Measurement and ratchet

1. `bun test tests/plugins/task-provider-youtrack/custom-field-values.test.ts`
   — new tests pass.
2. `bun test:mutate:file plugins/task-provider-youtrack/custom-field-values.ts`
   — confirm killed/survivor counts match the prediction; kill or justify any
   unexpected survivor in the fallback-ladder clusters.
3. No `baseline.json` edit in the PR: the CI `mutation-baseline` job re-seeds
   the floor on master (per-key max) from the changed-files run. The PR gate
   is regression-only, so the improved score can only raise the floor.
4. Regression checks: repo lint/typecheck per `package.json` scripts; the
   mutation run's own dry run validates the rest of the paired test set.
   Existing youtrack suites are untouched (no shared mocks involved).

## Trade-offs and risks

- **Private behavior asserted through the public API.** The fallback ladder
  is private; tests craft `value` shapes instead of importing internals.
  Accepted: the public contract is what `mappers.ts` consumes, and the ladder
  is fully reachable through it.
- **JSON.stringify output coupling.** `'{"name":42}'` assertions depend on
  key order/serialization. Accepted: inputs are single-key object literals,
  deterministic across JS runtimes.
- **Probe vs future paired divergence.** The recorded floor comes from the
  official paired runner on master; the local paired numbers in this spec are
  the prediction baseline, not the guarantee.

## Alternatives considered

- **Fix the stale `collaboration-provider.ts` baseline entry instead.**
  Rejected as this cycle's goal: its real score is already 1.0; the floor
  self-heals on the next master seed that measures the file. No test work
  exists to do.
- **`src/tools/search-memos.ts` (0.177, 96 mutants).** Rejected for this
  cycle: comparable mutant count but needs the tool/store harness and its
  no-coverage chunks are error/formatting paths with weaker oracles. Strong
  candidate for the next cycle.
- **`youtrack/validate-config.ts` (0, 32 mutants, no covering test).**
  Rejected: smaller blast radius (activation-time validation) than the
  per-task read path; the kaneo twin's proven pattern (0.969) makes it a
  cheap follow-up.
- **Batch several zero-score plugin files in one spec.** Rejected: the repo's
  established pattern is one file per spec → plan → PR cycle with a clean
  per-file ratchet.
