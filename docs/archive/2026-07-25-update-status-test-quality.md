<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# update-status.ts test-quality improvement — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise `src/tools/update-status.ts`'s paired mutation score from 24.5% to ~47% by adding schema *acceptance* tests that kill the 11 schema-refine-logic survivors.

**Architecture:** Pure test additions to `tests/tools/update-status.test.ts`. The current suite verifies the `.refine()` "at least one field" rule only in the *rejection* direction; 5 new tests verify the *acceptance* direction (per-field + all-fields). No source changes, no test restructuring. The remaining survivors (log payloads, confirmation branch, description strings) are log-only or cosmetic and are intentionally accepted — killing them needs Option B (delayed-import + tracked-logger log assertions) for brittle, low-value gains.

**Tech Stack:** Bun test runner, Zod v4 schemas (`.refine()` runs under `safeParse`), the repo's `schemaValidates` helper, Stryker paired runner (`bun test:mutate:file`).

**Source spec:** `docs/superpowers/specs/2026-07-25-update-status-test-quality-design.md`

## Global Constraints

- Work on branch `mutation-testing-revive` only.
- Runtime: **Bun** (never `npm`/`yarn`).
- Never add lint-disable / type-ignore comments — fix the underlying issue.
- `tests/tools/update-status.test.ts` follows the existing style: `bun:test` imports, `createMockProvider()`, `schemaValidates` from `tests/utils/test-helpers.ts`, one `test(...)` per case.
- **Do not** modify `src/tools/update-status.ts`. **Do not** add log/description-string assertions (out of scope — see spec).
- The one comment block at the top of the new tests is spec-mandated (documents accepted survivors) — it is the only comment added.

## File Structure

- **Modify** `tests/tools/update-status.test.ts` — append 5 `test(...)` cases + the spec-mandated comment inside the existing `describe('makeUpdateStatusTool')` block, immediately after the last existing test ("validates at least one field is provided") and before the describe's closing brace.

No other files change.

---

### Task 1: Add schema-acceptance tests and verify they kill the refine-logic mutants

**Files:**
- Modify: `tests/tools/update-status.test.ts` (insert after the "validates at least one field is provided" test, before the describe closing `}`).

**Interfaces:**
- Consumes: `schemaValidates(tool, data)` from `tests/utils/test-helpers.ts` (returns `inputSchema.safeParse(data).success`, including `.refine()`); `createMockProvider()` from `tests/tools/mock-provider.ts`; `makeUpdateStatusTool(provider)` from `src/tools/update-status.ts`.
- Produces: 5 passing acceptance tests; a mutation score of ~0.47 (23/49) with survivors reduced from 37 to ~26.

- [ ] **Step 1: Read the current end of the test file to anchor the edit**

Run: `sed -n '114,131p' tests/tools/update-status.test.ts`
Expected: see the "validates at least one field is provided" test (lines ~126-130) followed by the describe closing `})`/`}`.

- [ ] **Step 2: Insert the 5 acceptance tests + spec-mandated comment**

Replace this block at the end of the describe:

```typescript
  test('validates at least one field is provided', () => {
    const provider = createMockProvider()
    const tool = makeUpdateStatusTool(provider)
    expect(schemaValidates(tool, { projectId: 'proj-1', statusId: 'col-1' })).toBe(false)
  })
})
```

with:

```typescript
  test('validates at least one field is provided', () => {
    const provider = createMockProvider()
    const tool = makeUpdateStatusTool(provider)
    expect(schemaValidates(tool, { projectId: 'proj-1', statusId: 'col-1' })).toBe(false)
  })

  // Positive-direction coverage for the .refine() "at least one field" rule.
  // Log-payload / description-string / confirmation-branch mutants are intentionally
  // not chased here — see docs/superpowers/specs/2026-07-25-update-status-test-quality-design.md.
  test('accepts input with only name set', () => {
    const provider = createMockProvider()
    const tool = makeUpdateStatusTool(provider)
    expect(schemaValidates(tool, { projectId: 'proj-1', statusId: 'col-1', name: 'New' })).toBe(true)
  })

  test('accepts input with only icon set', () => {
    const provider = createMockProvider()
    const tool = makeUpdateStatusTool(provider)
    expect(schemaValidates(tool, { projectId: 'proj-1', statusId: 'col-1', icon: 'flag' })).toBe(true)
  })

  test('accepts input with only color set', () => {
    const provider = createMockProvider()
    const tool = makeUpdateStatusTool(provider)
    expect(schemaValidates(tool, { projectId: 'proj-1', statusId: 'col-1', color: '#ffffff' })).toBe(true)
  })

  test('accepts input with only isFinal set', () => {
    const provider = createMockProvider()
    const tool = makeUpdateStatusTool(provider)
    expect(schemaValidates(tool, { projectId: 'proj-1', statusId: 'col-1', isFinal: true })).toBe(true)
  })

  test('accepts input with all updatable fields', () => {
    const provider = createMockProvider()
    const tool = makeUpdateStatusTool(provider)
    expect(
      schemaValidates(tool, {
        projectId: 'proj-1',
        statusId: 'col-1',
        name: 'New',
        icon: 'flag',
        color: '#ffffff',
        isFinal: true,
      }),
    ).toBe(true)
  })
})
```

- [ ] **Step 3: Run the test file — all 12 must pass**

Run: `bun test tests/tools/update-status.test.ts`
Expected: `12 pass, 0 fail` (7 existing + 5 new). If any new test fails, the refine predicate is stricter than documented — fix the **test data**, do not weaken the schema.

- [ ] **Step 4: Lint + typecheck — green**

Run: `bun run lint && bun run typecheck`
Expected: both exit 0 (test-only change; no schema impact).

- [ ] **Step 5: Run the paired mutation test to prove the new tests kill mutants**

Run: `bun test:mutate:file src/tools/update-status.ts`
Expected: the summary line shows roughly `killed=23 survived=26 noCoverage=0 score≈0.47` (was `killed=12 survived=37 score=0.245`). Survivors must drop by ~11 (the refine-logic cluster). If survivors drop by noticeably fewer than 11, a mutant category was mis-assumed — re-read `reports/paired/src__tools__update-status.ts.stryker-report.json` survivors and extend the per-field tests before committing.

- [ ] **Step 6: Confirm only the test file changed**

Run: `git status --short`
Expected: only `tests/tools/update-status.test.ts` (plus gitignored `reports/paired/*` artifacts, which do not appear). If anything else is modified, do not commit it.

- [ ] **Step 7: Commit**

```bash
git add tests/tools/update-status.test.ts
git commit -m "test(update-status): cover schema refine acceptance direction

The .refine() 'at least one field' rule was tested only for rejection.
Add 5 acceptance tests (per-field + all-fields) that kill the 11
schema-refine-logic survivors, raising the paired mutation score from
24.5% to ~47%.

Log-payload / description-string / confirmation-branch mutants remain
accepted survivors (log-equivalent or cosmetic) — see
docs/superpowers/specs/2026-07-25-update-status-test-quality-design.md"
```

---

## Done criteria

- 5 new schema-acceptance tests pass alongside the existing 7.
- `bun run lint` / `bun run typecheck` green.
- `bun test:mutate:file src/tools/update-status.ts` score ≈ 0.47 with survivors reduced by ~11 (from 37 to ~26).
- Only `tests/tools/update-status.test.ts` changed.

## Out of scope

Source changes to `update-status.ts`, log-payload assertions (Option B), description/message-string assertions (Option C), and any other tool's tests.
