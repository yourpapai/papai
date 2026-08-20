<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# YouTrack `custom-field-values.ts` Mutation Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise the paired mutation score of `plugins/task-provider-youtrack/custom-field-values.ts` from 0 (0 killed / 14 survived / 81 no-coverage, 95 mutants) to ≥ 0.9 by adding a pure unit-test companion file. No source changes.

**Architecture:** One new test file, `tests/plugins/task-provider-youtrack/custom-field-values.test.ts` (standard companion mirror path — auto-discovered by the paired runner's test-resolver, no `overrides.json` edit). All assertions go through the single public export `mapReadOnlyCustomFields`; private helpers are exercised by crafting `value` shapes on a field named `'Team'` (not in the exclusion set). Tests are characterization tests on existing correct code: they PASS immediately; the mutation run in Task 3 is the effectiveness oracle.

**Tech Stack:** Bun test runner (`bun:test`), TypeScript (strict), Stryker via `bun test:mutate:file`. No fetch mocks, no DI, no store.

**Spec:** `docs/superpowers/specs/2026-08-04-youtrack-custom-field-values-mutation-design.md` (approved).

## Global Constraints

- Strict TypeScript; use `.js` extension in relative import paths.
- Test files must start with the SPDX license header block (enforced by the `license-headers` commit hook):
  ```ts
  // SPDX-License-Identifier: BUSL-1.1
  // Copyright (c) 2026 Dmitriy Lazarev
  // Use of this software is governed by the Business Source License 1.1.
  // See LICENSE in the project root for details.
  ```
- No comments in code beyond the license header; no lint-disable or type-ignore comments (hook-blocked).
- Assertions use `toEqual` on the full returned array (deep equality distinguishes `5` from `'5'`, kills `ObjectLiteral {}` mutants, and locks entry order); use `toBeUndefined()` for the empty-shape contract.
- Do NOT edit `scripts/mutation/baseline.json` — the CI `mutation-baseline` job re-seeds the floor on master (per-key max). The PR gate is regression-only.
- Do NOT modify `plugins/task-provider-youtrack/custom-field-values.ts` or any other source file.
- Commit message style follows recent history: `test(youtrack): ...` / `docs: ...` (see `git log --oneline`).

## File Structure

- Create: `tests/plugins/task-provider-youtrack/custom-field-values.test.ts` — the only code artifact. Holds all five describe blocks from the spec (filter/shape, primitives/null, object ladder, array branch, stringify tail).

Reference files (read-only):
- `plugins/task-provider-youtrack/custom-field-values.ts` — unit under test (57 lines).
- `plugins/task-provider-youtrack/constants.ts:14` — `YOUTRACK_DUE_DATE_FIELD_NAME = 'Due Date'`.
- `plugins/task-provider-youtrack/schemas/custom-fields.ts` — `CustomFieldValueSchema` union; test fixtures use `$type: 'SimpleIssueCustomField'` (value `string | number | boolean`, optional) for scalar cases and `$type: 'Custom'` (matches the `UnknownIssueCustomFieldSchema` fallback: `$type: string`, `value: unknown`) for object/array/function/circular cases.
- `src/providers/domain-types.ts:61` — `TaskCustomField = { name: string; value: string | number | boolean | string[] | null }`.

---

### Task 1: Filter/shape contract + primitive/null handling (spec §1–2)

**Files:**
- Create: `tests/plugins/task-provider-youtrack/custom-field-values.test.ts`
- Test: `tests/plugins/task-provider-youtrack/custom-field-values.test.ts`

**Interfaces:**
- Consumes: `mapReadOnlyCustomFields(customFields: readonly AnyCustomField[] | undefined): TaskCustomField[] | undefined` from `plugins/task-provider-youtrack/custom-field-values.js`; `YOUTRACK_DUE_DATE_FIELD_NAME: string` from `plugins/task-provider-youtrack/constants.js`.
- Produces: the test file Task 2 appends two describe blocks to (same file, same imports).

- [ ] **Step 1: Create the test file with the filter/shape and primitive describe blocks**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { YOUTRACK_DUE_DATE_FIELD_NAME } from '../../../plugins/task-provider-youtrack/constants.js'
import { mapReadOnlyCustomFields } from '../../../plugins/task-provider-youtrack/custom-field-values.js'

describe('mapReadOnlyCustomFields filter and shape', () => {
  test('returns undefined for undefined input', () => {
    expect(mapReadOnlyCustomFields(undefined)).toBeUndefined()
  })

  test('returns undefined for an empty array', () => {
    expect(mapReadOnlyCustomFields([])).toBeUndefined()
  })

  test('returns undefined when every field is excluded', () => {
    expect(
      mapReadOnlyCustomFields([{ $type: 'SimpleIssueCustomField', name: 'State', value: 'Open' }]),
    ).toBeUndefined()
  })

  test('drops State, Priority, Assignee and the due-date field, keeps generic fields', () => {
    const result = mapReadOnlyCustomFields([
      { $type: 'SimpleIssueCustomField', name: 'State', value: 'Open' },
      { $type: 'SimpleIssueCustomField', name: 'Priority', value: 'High' },
      { $type: 'SimpleIssueCustomField', name: 'Assignee', value: 'admin' },
      { $type: 'SimpleIssueCustomField', name: YOUTRACK_DUE_DATE_FIELD_NAME, value: '2026-08-10' },
      { $type: 'SimpleIssueCustomField', name: 'Team', value: 'Core' },
    ])
    expect(result).toEqual([{ name: 'Team', value: 'Core' }])
  })

  test('preserves input order and exact { name, value } shape for generic fields', () => {
    const result = mapReadOnlyCustomFields([
      { $type: 'SimpleIssueCustomField', name: 'Team B', value: 'Beta' },
      { $type: 'SimpleIssueCustomField', name: 'Team A', value: 'Alpha' },
    ])
    expect(result).toEqual([
      { name: 'Team B', value: 'Beta' },
      { name: 'Team A', value: 'Alpha' },
    ])
  })
})

describe('mapReadOnlyCustomFields primitive and null values', () => {
  test('maps null value to null', () => {
    const result = mapReadOnlyCustomFields([{ $type: 'Custom', name: 'Team', value: null }])
    expect(result).toEqual([{ name: 'Team', value: null }])
  })

  test('maps a missing value to null', () => {
    const result = mapReadOnlyCustomFields([{ $type: 'SimpleIssueCustomField', name: 'Team' }])
    expect(result).toEqual([{ name: 'Team', value: null }])
  })

  test('passes string values through', () => {
    const result = mapReadOnlyCustomFields([{ $type: 'SimpleIssueCustomField', name: 'Team', value: 'abc' }])
    expect(result).toEqual([{ name: 'Team', value: 'abc' }])
  })

  test('passes number values through without stringifying', () => {
    const result = mapReadOnlyCustomFields([{ $type: 'SimpleIssueCustomField', name: 'Team', value: 5 }])
    expect(result).toEqual([{ name: 'Team', value: 5 }])
  })

  test('passes boolean values through without stringifying', () => {
    const result = mapReadOnlyCustomFields([{ $type: 'SimpleIssueCustomField', name: 'Team', value: false }])
    expect(result).toEqual([{ name: 'Team', value: false }])
  })
})
```

Note on the null case: it uses `$type: 'Custom'` because the `SimpleIssueCustomField` union member types `value` as `string | number | boolean | undefined`, while the unknown-shape member accepts `unknown` — so `null` typechecks without a cast. This kills the `value === null || value === undefined` `||`→`&&` mutant (under it, `null` falls through the ladder and stringifies to `'null'`).

- [ ] **Step 2: Run the new tests**

Run: `bun test tests/plugins/task-provider-youtrack/custom-field-values.test.ts`
Expected: PASS — 10 tests, 0 failures. (Characterization tests on existing correct code; they pass immediately by design.)

- [ ] **Step 3: Verify typecheck and lint**

Run: `bun run typecheck && bun run lint`
Expected: both exit 0, no errors in the new file.

- [ ] **Step 4: Commit**

```bash
git add tests/plugins/task-provider-youtrack/custom-field-values.test.ts
git commit -m "test(youtrack): cover custom-field-values filter and primitive mapping"
```

---

### Task 2: Object fallback ladder, array branch, stringify tail (spec §3–5)

**Files:**
- Modify: `tests/plugins/task-provider-youtrack/custom-field-values.test.ts` (append three describe blocks at the end of the file)
- Test: `tests/plugins/task-provider-youtrack/custom-field-values.test.ts`

**Interfaces:**
- Consumes: the test file created in Task 1 (same imports; no new imports needed).
- Produces: complete companion test set consumed by the paired mutation runner in Task 3 via the mirror-path resolver (`plugins/task-provider-youtrack/custom-field-values.ts` → `tests/plugins/task-provider-youtrack/custom-field-values.test.ts`).

- [ ] **Step 1: Append the object-ladder, array, and stringify describe blocks**

```ts
describe('mapReadOnlyCustomFields object fallback ladder', () => {
  test('prefers text over name and login', () => {
    const result = mapReadOnlyCustomFields([
      { $type: 'Custom', name: 'Team', value: { text: 'T', name: 'N', login: 'L' } },
    ])
    expect(result).toEqual([{ name: 'Team', value: 'T' }])
  })

  test('prefers name over login when text is absent', () => {
    const result = mapReadOnlyCustomFields([{ $type: 'Custom', name: 'Team', value: { name: 'N', login: 'L' } }])
    expect(result).toEqual([{ name: 'Team', value: 'N' }])
  })

  test('uses login when text and name are absent', () => {
    const result = mapReadOnlyCustomFields([{ $type: 'Custom', name: 'Team', value: { login: 'L' } }])
    expect(result).toEqual([{ name: 'Team', value: 'L' }])
  })

  test('ignores non-string properties and falls through to stringify', () => {
    const result = mapReadOnlyCustomFields([{ $type: 'Custom', name: 'Team', value: { name: 42 } }])
    expect(result).toEqual([{ name: 'Team', value: '{"name":42}' }])
  })
})

describe('mapReadOnlyCustomFields array values', () => {
  test('passes string arrays through', () => {
    const result = mapReadOnlyCustomFields([{ $type: 'Custom', name: 'Team', value: ['a', 'b'] }])
    expect(result).toEqual([{ name: 'Team', value: ['a', 'b'] }])
  })

  test('maps object items, keeps strings, drops null and non-string entries', () => {
    const result = mapReadOnlyCustomFields([{ $type: 'Custom', name: 'Team', value: [{ name: 'A' }, 'b', null, 42] }])
    expect(result).toEqual([{ name: 'Team', value: ['A', 'b'] }])
  })

  test('falls back to login for array items without a name', () => {
    const result = mapReadOnlyCustomFields([{ $type: 'Custom', name: 'Team', value: [{ login: 'L' }] }])
    expect(result).toEqual([{ name: 'Team', value: ['L'] }])
  })
})

describe('mapReadOnlyCustomFields stringify tail', () => {
  test('stringifies plain objects without text, name or login', () => {
    const result = mapReadOnlyCustomFields([{ $type: 'Custom', name: 'Team', value: { foo: 'bar' } }])
    expect(result).toEqual([{ name: 'Team', value: '{"foo":"bar"}' }])
  })

  test('maps unstringifiable function values to the complex-value placeholder', () => {
    const result = mapReadOnlyCustomFields([{ $type: 'Custom', name: 'Team', value: () => undefined }])
    expect(result).toEqual([{ name: 'Team', value: '[complex value]' }])
  })

  test('maps circular structures to the complex-value placeholder', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    const result = mapReadOnlyCustomFields([{ $type: 'Custom', name: 'Team', value: circular }])
    expect(result).toEqual([{ name: 'Team', value: '[complex value]' }])
  })
})
```

These kill: the three negated `!== undefined` ladder guards (priority order), the `typeof prop === 'string'` mutant (42 would be returned as the number `42` instead of the stringified object), the L15 `isRecord` arrow-body survivor (ladder collapses to stringify), the array map/ternary/filter mutants (`42` would survive the filter under the `typeof item !== 'string'` mutant), the L42 `??` mutant (login fallback in array items), the L23 `??` mutant (function → `undefined` instead of the placeholder), and the catch-path mutants (circular input).

- [ ] **Step 2: Run the full test file**

Run: `bun test tests/plugins/task-provider-youtrack/custom-field-values.test.ts`
Expected: PASS — 20 tests, 0 failures.

- [ ] **Step 3: Verify typecheck and lint**

Run: `bun run typecheck && bun run lint`
Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
git add tests/plugins/task-provider-youtrack/custom-field-values.test.ts
git commit -m "test(youtrack): cover custom-field-values fallback ladder and stringify tail"
```

---

### Task 3: Paired mutation measurement, survivor triage, full verification

**Files:**
- Modify: `tests/plugins/task-provider-youtrack/custom-field-values.test.ts` (only if triage requires an additional kill test)
- Modify: `docs/superpowers/specs/2026-08-04-youtrack-custom-field-values-mutation-design.md` (only to sync the achieved score, per repo precedent `2846346bf`)
- Test: `tests/plugins/task-provider-youtrack/custom-field-values.test.ts`

**Interfaces:**
- Consumes: the complete companion test file from Tasks 1–2; `scripts/mutation/paired-run.ts` CLI (`bun test:mutate:file`).
- Produces: the achieved paired score recorded in the spec; the terminal state other cycles compare against. `scripts/mutation/baseline.json` is NOT edited (CI master seed re-applies the floor per-key max).

- [ ] **Step 1: Run the official paired measurement**

Run: `bun test:mutate:file plugins/task-provider-youtrack/custom-field-values.ts 2>&1 | tail -5`
Expected: `killed` ≥ 88 of 95, `noCoverage` = 0, score ≥ 0.9. The only accepted survivors are the two predicted equivalents:
- L15 `isRecord`: `&&`→`||` — `getStringProperty` is only reachable with records/arrays/functions (null/undefined/primitives returned earlier), where both operators agree.
- L41 array null-guard: `||`→`&&` — under the mutant a `null` item falls into the ternary and still resolves to `undefined` via `getStringProperty(null, ...)`, so it is filtered identically.

- [ ] **Step 2: Triage any unexpected survivor**

If the survivor set matches the two predicted equivalents and score ≥ 0.9: proceed to Step 3.

Otherwise, for each unexpected survivor, read its mutator/line from `reports/paired/plugins__task-provider-youtrack__custom-field-values.ts.stryker-report.json`:

Run: `bun -e "const r = await Bun.file('reports/paired/plugins__task-provider-youtrack__custom-field-values.ts.stryker-report.json').json(); for (const m of r.files['plugins/task-provider-youtrack/custom-field-values.ts'].mutants.filter((m) => m.status === 'Survived' || m.status === 'NoCoverage')) console.log(m.status, m.mutatorName, 'L' + m.location.start.line, JSON.stringify(m.replacement ?? ''))"`

Add a focused kill test to `tests/plugins/task-provider-youtrack/custom-field-values.test.ts` in the describe block matching the survivor's cluster (or justify it as a third equivalent by extending the accepted-survivor list in the spec). Re-run Step 1 until only accepted equivalents remain.

- [ ] **Step 3: Sync the spec with the achieved score**

Update the `### Expected outcome` section of `docs/superpowers/specs/2026-08-04-youtrack-custom-field-values-mutation-design.md`: replace the prediction paragraph's final sentence with the achieved numbers, e.g. `Achieved (2026-08-04): killed=NN survived=2 noCoverage=0, score=0.NN; survivors are the two predicted equivalents (L15 isRecord, L41 array null-guard).` Keep the prediction text intact above it.

- [ ] **Step 4: Full regression verification**

Run: `bun test && bun run typecheck && bun run lint`
Expected: full suite green (the new file is additive; no existing suite shares state with it — no fetch mocks, no module mocks, no globals), typecheck and lint exit 0.

- [ ] **Step 5: Commit**

```bash
git add tests/plugins/task-provider-youtrack/custom-field-values.test.ts docs/superpowers/specs/2026-08-04-youtrack-custom-field-values-mutation-design.md
git commit -m "docs: sync spec with achieved custom-field-values mutation score"
```

If Step 2 added no test changes and Step 3's spec edit is the only change, stage just the spec file.
