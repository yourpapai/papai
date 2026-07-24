<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# T1b — tests/e2e Parity Retrofit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the behaviors currently proven only by the Kaneo-only `tests/e2e` domain suites into T1's fake-vs-Kaneo parity model — one shared `PARITY_GROUPS` set run against both `MemoryTaskProvider` (Tier 0) and real Dockerized Kaneo (`@1`) — then retire the migrated duplicates so every parity-able behavior has a single source of truth.

**Architecture:** Split the frozen `expectations.ts` into per-domain modules (`expectations/{tasks,search,comments,relations,projects,errors}.ts`) whose exported arrays are **concatenated** (not re-exported) into one `PARITY_GROUPS` in `expectations.ts`. Both bindings (`expectations.fake.test.ts`, `tests/e2e/parity/provider-parity.test.ts`) and the catalog `@1` cross-check already iterate `PARITY_GROUPS` generically, so each new group flows to fake execution, Kaneo execution, and catalog verification with no per-group machinery. 17 new groups are added in five additive waves; migrated domain tests are retired in a final sweep.

**Tech Stack:** Bun test runner; strict TypeScript (`.js` import paths); Zod v4; oxlint (typeAware) + oxfmt; Docker (Kaneo 2.7.2) for the `@1` lane.

## Global Constraints

Every task's requirements implicitly include this section. Values are copied verbatim from the spec (`docs/superpowers/specs/2026-07-24-tier1b-e2e-parity-retrofit-design.md`) and the project instructions.

- **Fake stays frozen.** Do **not** modify `MemoryTaskProvider` (`tests/stories/harness/memory-task-provider.ts`). A behavior the fake cannot echo is RESIDUE/EXCLUDE, never a reason to change the fake.
- **Parity = normalized-shape equivalence** (field presence, types, enum membership), not exact key-set equality. Use `toMatchObject` where a provider returns a superset; `toEqual` only for genuinely closed shapes. Volatile ids/timestamps canonicalize to `VOLATILE` via `canonicalize(x, VOLATILE_KEYS)`.
- **Single source of truth.** A behavior converted to a parity group is deleted from its Kaneo-only suite. Only genuinely Kaneo-specific residue stays behind, uncatalogued.
- **Never add lint-disable or type-ignore comments** — the hook policy blocks them; fix the underlying issue instead.
- **Use `.js` extension in every import path.**
- **Never log tokens, API keys, session cookies, or other sensitive data.**
- **A `max-lines` / `max-lines-per-function` failure is a design signal** — split the file or extract functions; never game the limit. (Note: `max-lines` is `off` for `tests/**` in `.oxlintrc.json`; the per-domain split here is a deliberate focus choice, not a limit workaround.)
- **`oxc/no-barrel-file` is `error`.** `expectations.ts` must remain a value module (it declares `PARITY_GROUPS`/`PARITY_EXCLUSIONS` and concatenates the domain arrays); it must **not** become a pure re-export barrel.
- **`vitest/no-conditional-in-test` / `no-conditional-expect` are `error`.** No `if` in a test/group body. Use `for...of` + bare `expect`, and the `required<T>(value, label)` helper to unwrap optional-method results.
- **oxfmt:** single quotes, no semicolons. **SPDX BUSL-1.1 header on every new file**, including markdown (HTML-comment style for `.md`).
- **Pre-commit hook = 4/4:** lint, typecheck, `format:check`, license-headers. Every commit must pass all four.
- **Branch:** `codex/tier1-provider-real` (this plan extends T1's parity lane / PR #191). If the user later chooses to split T1b onto its own branch, rebase these commits there; nothing in the plan assumes the T1 commits are unpushed.

---

## Ledger reference (used by every wave)

Each new group is exactly one `@1` executable catalog record, so after adding `k` groups the counts move together. Cumulative targets:

| After task | `PARITY_GROUPS` length `N` | `CATALOG_SCENARIO_IDS` length `T` | executable `E` | `executableByTier['1']` |
| --- | --- | --- | --- | --- |
| baseline (T1 HEAD) | 12 | 140 | 113 | 12 |
| Task 2 — tasks (+6) | 18 | 146 | 119 | 18 |
| Task 3 — search (+3) | 21 | 149 | 122 | 21 |
| Task 4 — comments (+3) | 24 | 152 | 125 | 24 |
| Task 5 — errors (+4) | 28 | 156 | 129 | 28 |
| Task 6 — relations (+1) | 29 | 157 | 130 | 29 |

`N` == `executableByTier['1']` == number of `@1` records; `T = 128 + N`; `E = 101 + N`. Pending (27), `readiness`, and `pendingByUnblockingTier` never change (new records are executable, not pending). `T0` stays 101.

**The six literal sites bumped every wave** (before → after values come from the row above):

1. `tests/stories/harness/parity/expectations.fake.test.ts` — `expect(PARITY_GROUPS).toHaveLength(N)`
2. `tests/stories/harness/parity/expectations.fake.test.ts` — `expect(new Set(PARITY_GROUPS.map((group) => group.id)).size).toBe(N)`
3. `tests/stories/harness/catalog-coverage.test.ts` — `expect(CATALOG_SCENARIO_IDS).toHaveLength(T)`
4. `tests/stories/harness/catalog-coverage.test.ts` — `expect(new Set(CATALOG_SCENARIO_IDS).size).toBe(T)`
5. `tests/stories/harness/catalog-coverage.test.ts` — the two executable totals `expect(...).toHaveLength(E)` (the `tracks the executable coverage total` test and the `stamps every executable record with a live proving tier` test)
6. `tests/scripts/story-coverage-totals.test.ts` — object literal `total: T`, `executable: E`, `executableByTier: { '0': 101, '1': N, ... }`, **and** the format string `'story catalog: E/T executable (T0 101, T1 N, T2 0, T3 0, T4 0); …'`

The `@1` cross-check (`maps every @1 parity record to its exact parity story title`, `catalog-coverage.test.ts`) uses `expect(parityRecords).toHaveLength(PARITY_GROUPS.length)` and loops `PARITY_GROUPS` — it is **generic** and needs no edit; it fails automatically if a minted storyId title drifts from its group.

**Reconciliation rule (divergence gate).** A wave's `k` is the number of its groups that land green on **both** bindings. If a group passes the fake but diverges on real Kaneo (as relation directionality did in T1), reclassify it to a `PARITY_EXCLUSIONS` entry, drop it from the wave, and subtract one from `k` — then apply the six edits at the *actual* cumulative `N`. The tables above are targets, not guarantees; the counts you write are computed from what actually landed.

---

## File Structure

**New files** (all under `tests/stories/harness/parity/`, all Tier-0 frozen tree — SPDX header required):

- `group.ts` — shared contract: `ParityHarness`, `ParityGroup`, `required<T>`. Leaf module; imports only `TaskProvider` from `src/providers/types.js`. Every domain module imports its types/helper from here.
- `expectations/tasks.ts` — `export const taskGroups: readonly ParityGroup[]` — the 6 existing task groups + 6 new (field-depth + content-edge).
- `expectations/search.ts` — `export const searchGroups` — existing `task-search` + 3 new search-variant groups.
- `expectations/comments.ts` — `export const commentGroups` — existing `comment-crud` + 3 new comment-depth/content-edge groups.
- `expectations/relations.ts` — `export const relationGroups` — existing `relation` + 1 new `relation-multiple`.
- `expectations/projects.ts` — `export const projectGroups` — existing `project-crud`, `task-label`, `identity` (no new groups).
- `expectations/errors.ts` — `export const errorGroups` — 4 new error-parity groups.

**New doc:**

- `docs/superpowers/plans/2026-07-24-tier1b-triage.md` — the Task 0 triage table (classification of all ~77 domain tests). SPDX HTML-comment header.

**Modified files:**

- `tests/stories/harness/parity/expectations.ts` — becomes the concat aggregator: imports the six domain arrays, re-exports the two types, declares `PARITY_GROUPS` (concat) and `PARITY_EXCLUSIONS`.
- `tests/stories/harness/parity/expectations.fake.test.ts` — count literals (sites 1–2) + trim the stale Task-4 arithmetic comment.
- `tests/stories/catalog/coverage.ts` — `CATALOG_SOURCE`, `CATALOG_SCENARIO_IDS` (+17 ids), `EXECUTABLE_STORY_MAPPINGS` (+17 mappings).
- `tests/stories/harness/catalog-coverage.test.ts` — count literals (sites 3–5).
- `tests/scripts/story-coverage-totals.test.ts` — totals + format string (site 6).
- `tests/e2e/{task-lifecycle,task-search,task-comments,task-relations,error-handling,label-operations,project-lifecycle,project-management,user-workflows}.test.ts` — retire migrated tests, slim to RESIDUE (Task 7).

The Kaneo binding `tests/e2e/parity/provider-parity.test.ts` and the fake binding's `for...of` loop need **no** change — they already iterate `PARITY_GROUPS`.

**No `treeHash` literal edit.** The story-tree `treeHash` is computed at runtime (`scripts/story/manifest.ts` `hashTree`); no committed baseline literal asserts it, and the Tier-0 local-literal-story contract filters `provingTier === '0'` so it never inspects the `@1` records. Adding files under the frozen tree is fine.

---

### Task 0: Triage table

**Files:**
- Create: `docs/superpowers/plans/2026-07-24-tier1b-triage.md`

**Interfaces:**
- Produces: the authoritative per-test classification consumed by every later task's "which domain tests does this subsume" decision and by Task 7's retirement list.

Produce a table with one row per domain test in the ~77-test corpus (all `tests/e2e/*.test.ts` except `docker-lifecycle.test.ts` (infra) and `e2e.test.ts` (aggregator, 0 tests)). Suite test counts to reconcile against: column-management 10, error-handling 7, label-operations 7, project-lifecycle 4, project-management 3, task-comments 12, task-lifecycle 9, task-list-compatibility 3, task-relations 10, task-search 7, user-workflows 5 = **77**.

Each row: `suite file` · `test name` · `bucket` · `target parity group id (if NEW/CORE)` · `reason (if EXCLUDE/RESIDUE/META)`. Buckets:

- **CORE** — already proven by one of T1's 12 groups (delete in Task 7, no new group).
- **NEW** — fake echoes it and Kaneo matches normalized shape → maps to one of the 17 new group ids below.
- **EXCLUDE** — genuine fake↔Kaneo divergence → a `PARITY_EXCLUSIONS` entry.
- **RESIDUE** — Kaneo-only (`kaneoApiJsonParsed` raw payload, invalid-API-key, invalid-workspace) → stays in slimmed suite, uncatalogued.
- **META** — not a provider-behavior test (the 3 `task-comments` test-target-detection tests) → untouched.

Pre-seed these known classifications (from the spec's confirmed lists) and confirm/adjust while reading each suite:

- **EXCLUDE:** column/status CRUD + reorder (all of `column-management`), label create/update (`label-operations`), list status/assignee/date filters (`task-list-compatibility`), relation directionality (blocks→blocked_by, subtask↔parent/child in `task-relations`), invalid-workspace search (`task-search`), assignee round-trip / assignee-filter (Kaneo requires a real workspace-user id; the fake accepts any string — divergent).
- **RESIDUE:** every `kaneoApiJsonParsed('/…')` raw-payload assertion, `invalid-API-key` (`error-handling`).
- **META:** the 3 `task-comments` `returns true/false when task-comments is the … test target` tests.
- **NEW → the 17 target ids** (grouped by wave below).
- **user-workflows (5):** drop as redundant — their atomic steps are covered by CORE + NEW. Migrate any genuinely-unique atom the table surfaces; otherwise mark all 5 for deletion.

- [ ] **Step 1: Write the triage doc**

Read each domain suite, fill the table, and reconcile: `CORE + NEW + EXCLUDE + RESIDUE + META == 77`. Record the running tally per suite. End the doc with a "Target counts" block restating the ledger table above (12 → 29 groups, 140 → 157 catalog ids) and a "Retirement list" section (every CORE/NEW row's exact test name, grouped by suite — Task 7 deletes exactly these).

- [ ] **Step 2: Sanity-check the target group set against the triage**

Confirm every NEW row maps to one of these 17 ids, and every id has ≥1 NEW row backing it:

```
tasks:     SCN-parity-task-dates, SCN-parity-task-full-property, SCN-parity-task-preserve-startdate,
           SCN-parity-task-null-dates, SCN-parity-task-special-chars, SCN-parity-task-long-title
search:    SCN-parity-search-all-projects, SCN-parity-search-empty, SCN-parity-search-projectid-limit
comments:  SCN-parity-comment-id-stability, SCN-parity-comment-long, SCN-parity-comment-special-chars
errors:    SCN-parity-task-errors, SCN-parity-comment-errors, SCN-parity-relation-errors,
           SCN-parity-project-label-errors
relations: SCN-parity-relation-multiple
```

If a NEW row has no home among these 17, either fold it into the nearest listed group or record it as a triage finding for the controller to resolve before Task 2. If the table's NEW count differs from 17, the ledger targets shift by the delta — note it explicitly at the top of the doc.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-07-24-tier1b-triage.md
git commit -m "docs(tier1b): triage the tests/e2e domain suites for parity retrofit"
```

---

### Task 1: Split expectations into per-domain modules (no behavior change)

Pure refactor. The 12 existing groups move verbatim into domain modules; `PARITY_GROUPS`/`PARITY_EXCLUSIONS` keep their exported identity and contents. **No count changes** — every existing test stays green with the same literals.

**Files:**
- Create: `tests/stories/harness/parity/group.ts`
- Create: `tests/stories/harness/parity/expectations/tasks.ts`, `.../search.ts`, `.../comments.ts`, `.../relations.ts`, `.../projects.ts`, `.../errors.ts`
- Modify: `tests/stories/harness/parity/expectations.ts`
- Modify: `tests/stories/harness/parity/expectations.fake.test.ts` (trim stale comment only)
- Test: `tests/stories/harness/parity/expectations.fake.test.ts`, `tests/stories/harness/catalog-coverage.test.ts`

**Interfaces:**
- Produces: `ParityHarness`, `ParityGroup`, `required` (from `group.ts`); `taskGroups`, `searchGroups`, `commentGroups`, `relationGroups`, `projectGroups`, `errorGroups` (domain arrays); `PARITY_GROUPS`, `PARITY_EXCLUSIONS` (unchanged public identity from `expectations.ts`).
- Consumes: the 12 existing group object literals currently in `expectations.ts`.

- [ ] **Step 1: Create the shared contract module**

`tests/stories/harness/parity/group.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { TaskProvider } from '../../../../src/providers/types.js'

export type ParityHarness = Readonly<{
  provider: TaskProvider
  projectId: string
}>

export type ParityGroup = Readonly<{
  id: string
  title: string
  run(harness: ParityHarness): Promise<void>
}>

/** Unwraps an optional-method result. Both MemoryTaskProvider and KaneoProvider
 *  implement every method a parity group calls, so this never throws at runtime —
 *  it only satisfies the TaskProvider optional-method type without `!`. */
export function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`parity: expected ${label} to be defined`)
  return value
}
```

- [ ] **Step 2: Create the six domain modules, moving the 12 existing groups verbatim**

Move each existing group's object literal (currently in `expectations.ts`) into its module, unchanged. Source ranges in the current `expectations.ts`: `task-create` 41–55, `task-get` 56–71, `task-update` 72–106, `task-delete` 107–116, `task-list-sort` 117–131, `task-list-paging` 132–144, `task-search` 145–156, `comment-crud` 157–172, `task-label` 173–187, `project-crud` 188–206, `relation` 207–224, `identity` 225–264.

Each module has the SPDX header and one of these import headers (import only what its groups use):

```ts
// tasks.ts
import { expect } from 'bun:test'
import { canonicalize, VOLATILE, VOLATILE_KEYS } from '../canonicalize.js'
import { type ParityGroup, required } from '../group.js'
export const taskGroups: readonly ParityGroup[] = [
  /* task-create, task-get, task-update, task-delete, task-list-sort, task-list-paging (verbatim) */
] as const
```

```ts
// search.ts
import { expect } from 'bun:test'
import type { ParityGroup } from '../group.js'
export const searchGroups: readonly ParityGroup[] = [
  /* task-search (verbatim) */
] as const
```

```ts
// comments.ts
import { expect } from 'bun:test'
import { canonicalize, VOLATILE, VOLATILE_KEYS } from '../canonicalize.js'
import { type ParityGroup, required } from '../group.js'
export const commentGroups: readonly ParityGroup[] = [
  /* comment-crud (verbatim) */
] as const
```

```ts
// relations.ts
import { expect } from 'bun:test'
import { canonicalize, VOLATILE, VOLATILE_KEYS } from '../canonicalize.js'
import type { ParityGroup } from '../group.js'
export const relationGroups: readonly ParityGroup[] = [
  /* relation (verbatim) */
] as const
```

```ts
// projects.ts
import { expect } from 'bun:test'
import { canonicalize, VOLATILE, VOLATILE_KEYS } from '../canonicalize.js'
import { type ParityGroup, required } from '../group.js'
export const projectGroups: readonly ParityGroup[] = [
  /* project-crud, task-label, identity (verbatim) */
] as const
```

```ts
// errors.ts — no existing groups yet; created empty-but-typed so the aggregator import resolves
import { expect } from 'bun:test'
import type { ParityGroup } from '../group.js'
export const errorGroups: readonly ParityGroup[] = [] as const
```

> Note: `errors.ts` starts empty. An empty array is valid; `expect` is imported now so Task 5 only appends. If oxlint flags the unused `expect` import on the empty file, omit it here and add it back in Task 5. Prefer leaving it out until Task 5 to keep this task lint-clean:
> ```ts
> // errors.ts (Task 1 form)
> import type { ParityGroup } from '../group.js'
> export const errorGroups: readonly ParityGroup[] = [] as const
> ```

- [ ] **Step 3: Rewrite `expectations.ts` as the concat aggregator**

Replace the whole file body (keep the SPDX header and update the docblock) with:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Aggregates the per-domain parity groups into one ordered PARITY_GROUPS.
 * Each domain module (./expectations/*.ts) declares its groups once as
 * operations-plus-assertions over the TaskProvider interface; the fake binding
 * (expectations.fake.test.ts) and tests/e2e/parity/ both iterate PARITY_GROUPS,
 * and the story catalog mints one @1 id per group's id/title. This file stays a
 * value module (it builds PARITY_GROUPS and PARITY_EXCLUSIONS) — not a re-export
 * barrel — so oxc/no-barrel-file does not fire.
 */

import { commentGroups } from './expectations/comments.js'
import { errorGroups } from './expectations/errors.js'
import { projectGroups } from './expectations/projects.js'
import { relationGroups } from './expectations/relations.js'
import { searchGroups } from './expectations/search.js'
import { taskGroups } from './expectations/tasks.js'
import type { ParityGroup } from './group.js'

export type { ParityGroup, ParityHarness } from './group.js'

export const PARITY_GROUPS: readonly ParityGroup[] = [
  ...taskGroups,
  ...searchGroups,
  ...commentGroups,
  ...relationGroups,
  ...projectGroups,
  ...errorGroups,
]

export const PARITY_EXCLUSIONS: readonly Readonly<{ group: string; reason: string }>[] = [
  /* the 19 existing exclusion entries, verbatim */
] as const
```

Move the 19 existing `PARITY_EXCLUSIONS` entries (current `expectations.ts` lines 267–363) into this array unchanged.

> If `oxc/no-barrel-file` fires on the two `export type … from './group.js'` re-exports: delete that line and instead update `expectations.fake.test.ts` to import `type ParityHarness` from `./group.js` directly. The value exports (`PARITY_GROUPS`, `PARITY_EXCLUSIONS`) should keep the rule satisfied, but this is the fallback.

- [ ] **Step 4: Trim the stale count-arithmetic comment in the fake binding**

In `expectations.fake.test.ts`, replace the Task-4 comment block (the lines explaining "16 - 4 = 12 groups remain; 15 + 4 = 19 exclusions") with a forward-looking, count-free note so later waves only touch numeric literals:

```ts
  // PARITY_GROUPS is the concatenation of the per-domain arrays in ./expectations/.
  // The two count assertions below track its length and PARITY_EXCLUSIONS; bump them
  // whenever a group or exclusion is added. See
  // docs/superpowers/plans/2026-07-24-tier1b-e2e-parity-retrofit.md for the retrofit.
```

Leave `toHaveLength(12)`, `.size).toBe(12)`, and `>= 19` unchanged in this task (no count change yet).

- [ ] **Step 5: Run the fake binding + catalog contract to verify no behavior/count change**

Run: `bun test tests/stories/harness/parity/expectations.fake.test.ts tests/stories/harness/catalog-coverage.test.ts`
Expected: PASS — same test count as before the split (14 fake tests: 2 count assertions + 12 groups), catalog `@1` cross-check green, all count literals still 12/140/113.

- [ ] **Step 6: Typecheck, lint, format**

Run: `bun typecheck && bun lint && bun format:check`
Expected: clean (no cycle, no barrel-file error, `.js` extensions present).

- [ ] **Step 7: Commit**

```bash
git add tests/stories/harness/parity/
git commit -m "refactor(parity): split expectations into per-domain modules"
```

---

### Task 2: Wave 1 — task field-depth + content-edge (+6)

**Files:**
- Modify: `tests/stories/harness/parity/expectations/tasks.ts`
- Modify: `tests/stories/catalog/coverage.ts`
- Modify: `tests/stories/harness/parity/expectations.fake.test.ts`
- Modify: `tests/stories/harness/catalog-coverage.test.ts`
- Modify: `tests/scripts/story-coverage-totals.test.ts`
- Test: `expectations.fake.test.ts`, `catalog-coverage.test.ts`, `tests/scripts/story-coverage-totals.test.ts`

**Interfaces:**
- Consumes: `taskGroups` array, `canonicalize`/`VOLATILE`/`VOLATILE_KEYS`, `required`, `ParityGroup`.
- Produces: 6 new `SCN-parity-task-*` groups + their `@1` catalog records. Cumulative target: `N=18, T=146, E=119`.

The `Task` type (`src/providers/domain-types.ts`) declares `description?: string | null`, `priority?: string`, `startDate?: string | null`, `dueDate?: string | null`. The fake's `createTask` echoes params (`{ ...clone(params), id, url }`), so all six round-trip on the fake. Date/description values use presence+type assertions (not literal equality) because real Kaneo may reformat a date string.

- [ ] **Step 1: Append the 6 groups to `taskGroups`**

Add inside the `taskGroups` array (after the existing 6 groups, before `] as const`):

```ts
  {
    id: 'SCN-parity-task-dates',
    title: 'SCN-parity-task-dates: createTask round-trips startDate and dueDate',
    async run({ provider, projectId }) {
      const created = await provider.createTask({
        projectId,
        title: 'Parity Dates',
        startDate: '2026-08-01',
        dueDate: '2026-08-15',
      })
      const fetched = await provider.getTask(created.id)
      expect(canonicalize(fetched, VOLATILE_KEYS)).toMatchObject({ id: VOLATILE, title: 'Parity Dates' })
      expect(fetched.startDate).toBeTypeOf('string')
      expect(fetched.startDate).not.toBe('')
      expect(fetched.dueDate).toBeTypeOf('string')
      expect(fetched.dueDate).not.toBe('')
    },
  },
  {
    id: 'SCN-parity-task-full-property',
    title: 'SCN-parity-task-full-property: createTask round-trips description and priority',
    async run({ provider, projectId }) {
      const created = await provider.createTask({
        projectId,
        title: 'Parity Full Property',
        description: 'A described task',
        priority: 'high',
      })
      const fetched = await provider.getTask(created.id)
      expect(canonicalize(fetched, VOLATILE_KEYS)).toMatchObject({ id: VOLATILE, title: 'Parity Full Property' })
      expect(fetched.description).toBeTypeOf('string')
      expect(fetched.description).not.toBe('')
      expect(fetched.priority).toBeTypeOf('string')
      expect(fetched.priority).not.toBe('')
    },
  },
  {
    id: 'SCN-parity-task-preserve-startdate',
    title: 'SCN-parity-task-preserve-startdate: updateTask title preserves an existing startDate',
    async run({ provider, projectId }) {
      const created = await provider.createTask({ projectId, title: 'Parity Preserve', startDate: '2026-09-01' })
      await provider.updateTask(created.id, { title: 'Parity Preserve Renamed' })
      const fetched = await provider.getTask(created.id)
      expect(fetched.title).toBe('Parity Preserve Renamed')
      expect(fetched.startDate).toBeTypeOf('string')
      expect(fetched.startDate).not.toBe('')
    },
  },
  {
    id: 'SCN-parity-task-null-dates',
    title: 'SCN-parity-task-null-dates: createTask without dates leaves startDate and dueDate unset',
    async run({ provider, projectId }) {
      const created = await provider.createTask({ projectId, title: 'Parity No Dates' })
      const fetched = await provider.getTask(created.id)
      // Neither binding must invent a date: the fake omits the keys; real Kaneo may
      // return null. A for...of over both values keeps the check conditional-free.
      for (const value of [fetched.startDate, fetched.dueDate]) {
        const unset = value === null || value === undefined || value === ''
        expect(unset).toBe(true)
      }
    },
  },
  {
    id: 'SCN-parity-task-special-chars',
    title: 'SCN-parity-task-special-chars: createTask round-trips special characters in the title',
    async run({ provider, projectId }) {
      const title = 'Ünïcode & <special> "chars" — 日本語 100%'
      const created = await provider.createTask({ projectId, title })
      const fetched = await provider.getTask(created.id)
      expect(fetched.title).toBe(title)
    },
  },
  {
    id: 'SCN-parity-task-long-title',
    title: 'SCN-parity-task-long-title: createTask round-trips a long title',
    async run({ provider, projectId }) {
      const title = `Parity Long ${'x'.repeat(500)}`
      const created = await provider.createTask({ projectId, title })
      const fetched = await provider.getTask(created.id)
      expect(fetched.title).toBe(title)
    },
  },
```

- [ ] **Step 2: Run the fake binding — expect it RED on the two count assertions, GREEN on the 6 new group tests**

Run: `bun test tests/stories/harness/parity/expectations.fake.test.ts`
Expected: the 6 new `SCN-parity-task-*` tests PASS; the two count assertions FAIL (`toHaveLength(12)` sees 18). This proves the groups run on the fake before you touch the ledger.

- [ ] **Step 3: Mint 6 `@1` records in `coverage.ts`**

In `CATALOG_SCENARIO_IDS`, append after `'SCN-parity-identity',` (before `] as const)`):

```ts
  // @1 — domain-retrofit parity (tier1b-e2e-parity-retrofit)
  'SCN-parity-task-dates',
  'SCN-parity-task-full-property',
  'SCN-parity-task-preserve-startdate',
  'SCN-parity-task-null-dates',
  'SCN-parity-task-special-chars',
  'SCN-parity-task-long-title',
```

In `EXECUTABLE_STORY_MAPPINGS`, append after the `'SCN-parity-identity'` mapping (before the closing `}`), one entry per group using this exact template (storyId = `tests/e2e/parity/provider-parity.test.ts#` + the group's full `title`):

```ts
  'SCN-parity-task-dates': {
    verifiedAt: '2026-07-24',
    provingTier: '1',
    storyIds: [
      'tests/e2e/parity/provider-parity.test.ts#SCN-parity-task-dates: createTask round-trips startDate and dueDate',
    ],
  },
  'SCN-parity-task-full-property': {
    verifiedAt: '2026-07-24',
    provingTier: '1',
    storyIds: [
      'tests/e2e/parity/provider-parity.test.ts#SCN-parity-task-full-property: createTask round-trips description and priority',
    ],
  },
  'SCN-parity-task-preserve-startdate': {
    verifiedAt: '2026-07-24',
    provingTier: '1',
    storyIds: [
      'tests/e2e/parity/provider-parity.test.ts#SCN-parity-task-preserve-startdate: updateTask title preserves an existing startDate',
    ],
  },
  'SCN-parity-task-null-dates': {
    verifiedAt: '2026-07-24',
    provingTier: '1',
    storyIds: [
      'tests/e2e/parity/provider-parity.test.ts#SCN-parity-task-null-dates: createTask without dates leaves startDate and dueDate unset',
    ],
  },
  'SCN-parity-task-special-chars': {
    verifiedAt: '2026-07-24',
    provingTier: '1',
    storyIds: [
      'tests/e2e/parity/provider-parity.test.ts#SCN-parity-task-special-chars: createTask round-trips special characters in the title',
    ],
  },
  'SCN-parity-task-long-title': {
    verifiedAt: '2026-07-24',
    provingTier: '1',
    storyIds: [
      'tests/e2e/parity/provider-parity.test.ts#SCN-parity-task-long-title: createTask round-trips a long title',
    ],
  },
```

- [ ] **Step 4: Bump the six literal sites to `N=18, T=146, E=119`**

- `expectations.fake.test.ts`: `toHaveLength(18)` and `.size).toBe(18)`.
- `catalog-coverage.test.ts`: `CATALOG_SCENARIO_IDS` `toHaveLength(146)` and `.size).toBe(146)`; both executable totals `toHaveLength(119)`.
- `story-coverage-totals.test.ts`: `total: 146`, `executable: 119`, `executableByTier: { '0': 101, '1': 18, '2': 0, '3': 0, '4': 0 }`, and the format string → `'story catalog: 119/146 executable (T0 101, T1 18, T2 0, T3 0, T4 0); pending 27 (0 executable-as-is, 5 needs-seam, 22 blocked); pending unblocked by tier (T0 0, T1 0, T2 0, T3 5, T4 0)'`.

- [ ] **Step 5: Run the fake + catalog + totals contracts GREEN**

Run: `bun test tests/stories/harness/parity/expectations.fake.test.ts tests/stories/harness/catalog-coverage.test.ts tests/scripts/story-coverage-totals.test.ts`
Expected: PASS. 20 fake tests (2 counts + 18 groups); the `@1` cross-check ties all 18 titles; totals line reads `119/146 … T1 18`.

- [ ] **Step 6: Typecheck, lint, format**

Run: `bun typecheck && bun lint && bun format:check`
Expected: clean.

- [ ] **Step 7 (divergence gate): run the Kaneo Docker lane for the new groups**

Run: `bun test:e2e` (brings up Kaneo 2.7.2; runs `provider-parity.test.ts` among the e2e suite).
Expected: the 6 new `SCN-parity-task-*` tests PASS against real Kaneo. **Most likely divergence:** `SCN-parity-task-full-property` — if Kaneo omits `priority` on the create response or returns it non-string (the known "priority update is broken" quirk is update-only, but confirm create), drop the two `priority` assertions and keep description-only, **or** reclassify the group to a `PARITY_EXCLUSIONS` entry (reason must mention `KaneoProvider`) and apply the reconciliation rule (subtract 1 from `k`: `N=17, T=145, E=118`). If Docker is unavailable in this environment, record that Step 7 is deferred to Task 8's full Docker run and proceed.

- [ ] **Step 8: Commit**

```bash
git add tests/stories/harness/parity/expectations/tasks.ts tests/stories/catalog/coverage.ts \
  tests/stories/harness/parity/expectations.fake.test.ts tests/stories/harness/catalog-coverage.test.ts \
  tests/scripts/story-coverage-totals.test.ts
git commit -m "test(parity): add task field-depth and content-edge groups (@1)"
```

---

### Task 3: Wave 2 — search-variant (+3) + invalid-workspace exclusion

**Files:**
- Modify: `tests/stories/harness/parity/expectations/search.ts`
- Modify: `tests/stories/harness/parity/expectations.ts` (add one `PARITY_EXCLUSIONS` entry)
- Modify: `tests/stories/catalog/coverage.ts`, `expectations.fake.test.ts`, `catalog-coverage.test.ts`, `story-coverage-totals.test.ts`

**Interfaces:**
- Consumes: `searchGroups`, `ParityGroup`. Cumulative target: `N=21, T=149, E=122`; `PARITY_EXCLUSIONS` → 20.

`searchTasks({ query, projectId?, assigneeId?, limit?, offset? })` returns `TaskSearchResult[]` (has `.title`). Use distinctive query tokens so parallel groups (each on its own fresh project, but Kaneo searches workspace-wide when `projectId` is omitted) don't collide.

- [ ] **Step 1: Append the 3 groups to `searchGroups`**

```ts
  {
    id: 'SCN-parity-search-all-projects',
    title: 'SCN-parity-search-all-projects: searchTasks without projectId matches across projects',
    async run({ provider, projectId }) {
      await provider.createTask({ projectId, title: 'Cross Project Kestrel' })
      const results = await provider.searchTasks({ query: 'Kestrel' })
      expect(results.map((result) => result.title)).toContain('Cross Project Kestrel')
    },
  },
  {
    id: 'SCN-parity-search-empty',
    title: 'SCN-parity-search-empty: searchTasks returns an empty array for a non-matching query',
    async run({ provider, projectId }) {
      await provider.createTask({ projectId, title: 'Present Task' })
      const results = await provider.searchTasks({ query: 'zzz-no-such-token-qxqx', projectId })
      expect(results).toEqual([])
    },
  },
  {
    id: 'SCN-parity-search-projectid-limit',
    title: 'SCN-parity-search-projectid-limit: searchTasks honors projectId and limit together',
    async run({ provider, projectId }) {
      await provider.createTask({ projectId, title: 'Limited Alpha' })
      await provider.createTask({ projectId, title: 'Limited Beta' })
      await provider.createTask({ projectId, title: 'Limited Gamma' })
      const results = await provider.searchTasks({ query: 'Limited', projectId, limit: 2 })
      expect(results.length).toBeLessThanOrEqual(2)
      expect(results.length).toBeGreaterThan(0)
      for (const result of results) {
        expect(result.title.startsWith('Limited')).toBe(true)
      }
    },
  },
```

- [ ] **Step 2: Add the invalid-workspace exclusion to `PARITY_EXCLUSIONS`**

Append to the `PARITY_EXCLUSIONS` array in `expectations.ts` (reason **must** contain `KaneoProvider` — the fake binding asserts every reason does):

```ts
  {
    group: 'search-invalid-workspace',
    reason:
      'KaneoProvider.searchTasks (plugins/task-provider-kaneo/provider.ts) scopes every search to a real Kaneo workspace and rejects an unknown workspace id; MemoryTaskProvider has no workspace concept and cannot reproduce the rejection, so invalid-workspace search stays a Kaneo-only residue check.',
  },
```

- [ ] **Step 3: Run the fake binding — new group tests GREEN, count assertions RED**

Run: `bun test tests/stories/harness/parity/expectations.fake.test.ts`
Expected: the 3 new search tests PASS; `toHaveLength(18)` now FAILS (sees 21).

- [ ] **Step 4: Mint 3 `@1` records + bump literals to `N=21, T=149, E=122`**

Append the 3 ids to `CATALOG_SCENARIO_IDS` and 3 mappings to `EXECUTABLE_STORY_MAPPINGS` (same template as Task 2, `verifiedAt: '2026-07-24'`, titles verbatim). Bump the six literal sites: fake `21`; catalog `149`; executable `122`; totals `total: 149, executable: 122, executableByTier['1']: 21`, format string `'122/149 executable (T0 101, T1 21, …)'`.

- [ ] **Step 5: Contracts GREEN**

Run: `bun test tests/stories/harness/parity/expectations.fake.test.ts tests/stories/harness/catalog-coverage.test.ts tests/scripts/story-coverage-totals.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck, lint, format**

Run: `bun typecheck && bun lint && bun format:check`
Expected: clean.

- [ ] **Step 7 (divergence gate): Kaneo Docker lane**

Run: `bun test:e2e`. Expected: the 3 new search tests PASS against real Kaneo. Watch `search-all-projects` (workspace-wide match must surface the seeded task) and `search-empty` (Kaneo must return no rows for a nonsense token). Reclassify + reconcile per the rule if either diverges. Defer to Task 8 if Docker is unavailable.

- [ ] **Step 8: Commit**

```bash
git add tests/stories/harness/parity/expectations/search.ts tests/stories/harness/parity/expectations.ts \
  tests/stories/catalog/coverage.ts tests/stories/harness/parity/expectations.fake.test.ts \
  tests/stories/harness/catalog-coverage.test.ts tests/scripts/story-coverage-totals.test.ts
git commit -m "test(parity): add search-variant groups and invalid-workspace exclusion (@1)"
```

---

### Task 4: Wave 3 — comment-depth + content-edge (+3)

**Files:**
- Modify: `tests/stories/harness/parity/expectations/comments.ts`
- Modify: `tests/stories/catalog/coverage.ts`, `expectations.fake.test.ts`, `catalog-coverage.test.ts`, `story-coverage-totals.test.ts`

**Interfaces:**
- Consumes: `commentGroups`, `required`, `ParityGroup`. Cumulative target: `N=24, T=152, E=125`.

- [ ] **Step 1: Append the 3 groups to `commentGroups`**

```ts
  {
    id: 'SCN-parity-comment-id-stability',
    title: 'SCN-parity-comment-id-stability: a comment keeps its id across update',
    async run({ provider, projectId }) {
      const task = await provider.createTask({ projectId, title: 'Comment Id Host' })
      const added = await provider.addComment?.(task.id, 'original')
      const addedId = required(added, 'addComment result').id
      const updated = await provider.updateComment?.({ taskId: task.id, commentId: addedId, body: 'edited' })
      expect(required(updated, 'updateComment result').id).toBe(addedId)
      const listed = (await provider.getComments?.(task.id, {})) ?? []
      expect(listed.map((comment) => comment.body)).toEqual(['edited'])
    },
  },
  {
    id: 'SCN-parity-comment-long',
    title: 'SCN-parity-comment-long: addComment round-trips a long body',
    async run({ provider, projectId }) {
      const task = await provider.createTask({ projectId, title: 'Long Comment Host' })
      const body = `note ${'y'.repeat(500)}`
      const added = await provider.addComment?.(task.id, body)
      expect(required(added, 'addComment result').body).toBe(body)
    },
  },
  {
    id: 'SCN-parity-comment-special-chars',
    title: 'SCN-parity-comment-special-chars: addComment round-trips special characters',
    async run({ provider, projectId }) {
      const task = await provider.createTask({ projectId, title: 'Special Comment Host' })
      const body = 'reply & <tag> "quote" — 日本語 100%'
      const added = await provider.addComment?.(task.id, body)
      expect(required(added, 'addComment result').body).toBe(body)
    },
  },
```

- [ ] **Step 2: Fake binding — new tests GREEN, counts RED**

Run: `bun test tests/stories/harness/parity/expectations.fake.test.ts`
Expected: 3 new comment tests PASS; count assertion FAILS (sees 24).

- [ ] **Step 3: Mint 3 `@1` records + bump literals to `N=24, T=152, E=125`**

Append 3 ids + 3 mappings (template as Task 2). Bump the six sites: fake `24`; catalog `152`; executable `125`; totals `total: 152, executable: 125, executableByTier['1']: 24`, format `'125/152 executable (T0 101, T1 24, …)'`.

- [ ] **Step 4: Contracts GREEN**

Run: `bun test tests/stories/harness/parity/expectations.fake.test.ts tests/stories/harness/catalog-coverage.test.ts tests/scripts/story-coverage-totals.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, format**

Run: `bun typecheck && bun lint && bun format:check` — clean.

- [ ] **Step 6 (divergence gate): Kaneo Docker lane**

Run: `bun test:e2e`. Expected: 3 new comment tests PASS. Watch `comment-long`/`comment-special-chars` for Kaneo body truncation/escaping (these mirror existing passing domain tests, so risk is low). Reconcile per rule if needed; defer if no Docker.

- [ ] **Step 7: Commit**

```bash
git add tests/stories/harness/parity/expectations/comments.ts tests/stories/catalog/coverage.ts \
  tests/stories/harness/parity/expectations.fake.test.ts tests/stories/harness/catalog-coverage.test.ts \
  tests/scripts/story-coverage-totals.test.ts
git commit -m "test(parity): add comment-depth and content-edge groups (@1)"
```

---

### Task 5: Wave 4 — error-parity consolidated by domain (+4)

**Files:**
- Modify: `tests/stories/harness/parity/expectations/errors.ts`
- Modify: `tests/stories/catalog/coverage.ts`, `expectations.fake.test.ts`, `catalog-coverage.test.ts`, `story-coverage-totals.test.ts`

**Interfaces:**
- Consumes: `errorGroups`, `ParityGroup`. Cumulative target: `N=28, T=156, E=129`.

Confirmed against the fake (`memory-task-provider.ts`): `getTask`/`updateTask` call `requireTask` (throw `Task not found`); `addComment` and `addRelation` call `requireTask` (throw); `updateProject` calls `requireProject` (throw `Project not found`); `removeTaskLabel` throws `Task label not found`. Real Kaneo returns 4xx/throws for the same missing entities. Both bindings reject → parity holds. Uses `?.` calls (not detached method refs) to preserve `this` binding.

- [ ] **Step 1: Populate `errorGroups`** (add `import { expect } from 'bun:test'` at the top of `errors.ts` if it was omitted in Task 1)

```ts
export const errorGroups: readonly ParityGroup[] = [
  {
    id: 'SCN-parity-task-errors',
    title: 'SCN-parity-task-errors: get, update, and delete reject for a missing task',
    async run({ provider }) {
      const missing = 'parity-missing-task'
      await expect(provider.getTask(missing)).rejects.toThrow()
      await expect(provider.updateTask(missing, { title: 'nope' })).rejects.toThrow()
      await expect(provider.deleteTask?.(missing)).rejects.toThrow()
    },
  },
  {
    id: 'SCN-parity-comment-errors',
    title: 'SCN-parity-comment-errors: commenting on a missing task rejects',
    async run({ provider }) {
      await expect(provider.addComment?.('parity-missing-task', 'orphan note')).rejects.toThrow()
    },
  },
  {
    id: 'SCN-parity-relation-errors',
    title: 'SCN-parity-relation-errors: relating a task to a missing task rejects',
    async run({ provider, projectId }) {
      const task = await provider.createTask({ projectId, title: 'Relation Error Host' })
      await expect(provider.addRelation?.(task.id, 'parity-missing-task', 'blocks')).rejects.toThrow()
    },
  },
  {
    id: 'SCN-parity-project-label-errors',
    title: 'SCN-parity-project-label-errors: updating a missing project and removing a missing label reject',
    async run({ provider, projectId }) {
      await expect(provider.updateProject?.('parity-missing-project', { name: 'nope' })).rejects.toThrow()
      const task = await provider.createTask({ projectId, title: 'Label Error Host' })
      await expect(provider.removeTaskLabel?.(task.id, 'parity-missing-label')).rejects.toThrow()
    },
  },
] as const
```

- [ ] **Step 2: Fake binding — new tests GREEN, counts RED**

Run: `bun test tests/stories/harness/parity/expectations.fake.test.ts`
Expected: 4 new error tests PASS (fake throws for every missing entity); count assertion FAILS (sees 28).

- [ ] **Step 3: Mint 4 `@1` records + bump literals to `N=28, T=156, E=129`**

Append 4 ids + 4 mappings (template as Task 2). Bump the six sites: fake `28`; catalog `156`; executable `129`; totals `total: 156, executable: 129, executableByTier['1']: 28`, format `'129/156 executable (T0 101, T1 28, …)'`.

- [ ] **Step 4: Contracts GREEN**

Run: `bun test tests/stories/harness/parity/expectations.fake.test.ts tests/stories/harness/catalog-coverage.test.ts tests/scripts/story-coverage-totals.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, format** — `bun typecheck && bun lint && bun format:check` — clean.

- [ ] **Step 6 (divergence gate): Kaneo Docker lane**

Run: `bun test:e2e`. Expected: all 4 error groups reject against real Kaneo. If Kaneo *accepts* any missing-entity op (no throw), that op is not a real error on Kaneo → remove it from its group (or reclassify the whole group to `PARITY_EXCLUSIONS`) and reconcile per the rule. Defer if no Docker.

- [ ] **Step 7: Commit**

```bash
git add tests/stories/harness/parity/expectations/errors.ts tests/stories/catalog/coverage.ts \
  tests/stories/harness/parity/expectations.fake.test.ts tests/stories/harness/catalog-coverage.test.ts \
  tests/scripts/story-coverage-totals.test.ts
git commit -m "test(parity): add consolidated error-parity groups (@1)"
```

---

### Task 6: Wave 5 — relation-basic (+1) + relation-directionality exclusion

**Files:**
- Modify: `tests/stories/harness/parity/expectations/relations.ts`
- Modify: `tests/stories/harness/parity/expectations.ts` (add one `PARITY_EXCLUSIONS` entry)
- Modify: `tests/stories/catalog/coverage.ts`, `expectations.fake.test.ts`, `catalog-coverage.test.ts`, `story-coverage-totals.test.ts`

**Interfaces:**
- Consumes: `relationGroups`, `canonicalize`/`VOLATILE`/`VOLATILE_KEYS`, `ParityGroup`. Cumulative target: `N=29, T=157, E=130`; `PARITY_EXCLUSIONS` → 21.

Uses `'related'` (symmetric) rather than `'blocks'` and asserts the two `addRelation` **return shapes** (not a re-read of stored relations), sidestepping Kaneo's inverse materialization — which is the excluded directionality behavior.

- [ ] **Step 1: Append the group to `relationGroups`**

```ts
  {
    id: 'SCN-parity-relation-multiple',
    title: 'SCN-parity-relation-multiple: a task carries multiple distinct relations',
    async run({ provider, projectId }) {
      const hub = await provider.createTask({ projectId, title: 'Relation Hub' })
      const first = await provider.createTask({ projectId, title: 'Relation Spoke One' })
      const second = await provider.createTask({ projectId, title: 'Relation Spoke Two' })
      const a = await provider.addRelation?.(hub.id, first.id, 'related')
      const b = await provider.addRelation?.(hub.id, second.id, 'related')
      expect(canonicalize(a, VOLATILE_KEYS)).toEqual({ taskId: VOLATILE, relatedTaskId: VOLATILE, type: 'related' })
      expect(canonicalize(b, VOLATILE_KEYS)).toEqual({ taskId: VOLATILE, relatedTaskId: VOLATILE, type: 'related' })
    },
  },
```

- [ ] **Step 2: Add the relation-directionality exclusion to `PARITY_EXCLUSIONS`** (reason must contain `KaneoProvider`)

```ts
  {
    group: 'relation-directionality',
    reason:
      'KaneoProvider (plugins/task-provider-kaneo/provider.ts) materializes inverse relations — a blocks edge surfaces as blocked_by on the target, and subtask/parent edges surface on both endpoints. MemoryTaskProvider stores a flat directed Map<taskId, Map<relatedTaskId, type>> with no inverse, so directional round-trips cannot reach parity; only symmetric same-shape add results are portable.',
  },
```

- [ ] **Step 3: Fake binding — new test GREEN, counts RED**

Run: `bun test tests/stories/harness/parity/expectations.fake.test.ts`
Expected: `SCN-parity-relation-multiple` PASS; count assertion FAILS (sees 29).

- [ ] **Step 4: Mint 1 `@1` record + bump literals to `N=29, T=157, E=130`**

Append 1 id + 1 mapping (template as Task 2). Bump the six sites: fake `29`; catalog `157`; executable `130`; totals `total: 157, executable: 130, executableByTier['1']: 29`, format `'130/157 executable (T0 101, T1 29, …)'`.

- [ ] **Step 5: Contracts GREEN**

Run: `bun test tests/stories/harness/parity/expectations.fake.test.ts tests/stories/harness/catalog-coverage.test.ts tests/scripts/story-coverage-totals.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck, lint, format** — `bun typecheck && bun lint && bun format:check` — clean.

- [ ] **Step 7 (divergence gate): Kaneo Docker lane**

Run: `bun test:e2e`. Expected: `relation-multiple` PASS against real Kaneo (two `related` add results, both the flat shape). Reconcile per rule if Kaneo reshapes the add response. Defer if no Docker.

- [ ] **Step 8: Commit**

```bash
git add tests/stories/harness/parity/expectations/relations.ts tests/stories/harness/parity/expectations.ts \
  tests/stories/catalog/coverage.ts tests/stories/harness/parity/expectations.fake.test.ts \
  tests/stories/harness/catalog-coverage.test.ts tests/scripts/story-coverage-totals.test.ts
git commit -m "test(parity): add relation-multiple group and directionality exclusion (@1)"
```

---

### Task 7: Retire migrated domain tests, slim suites to residue

Now that every convertible behavior is proven in `PARITY_GROUPS` on both bindings, delete the duplicates from the Kaneo-only suites so each behavior has a single source. Retirement changes **no catalog counts** (domain tests are uncatalogued); it only shrinks the e2e suite.

**Files:**
- Modify/delete tests in: `tests/e2e/task-lifecycle.test.ts`, `task-search.test.ts`, `task-comments.test.ts`, `task-relations.test.ts`, `error-handling.test.ts`, `label-operations.test.ts`, `project-lifecycle.test.ts`, `project-management.test.ts`, `user-workflows.test.ts`
- Consumes: the Task 0 triage doc's "Retirement list".

- [ ] **Step 1: Delete every CORE/NEW-classified domain test**

For each suite, delete exactly the tests the triage table marked CORE or NEW (their behavior now lives in `PARITY_GROUPS`). Keep every RESIDUE test (`kaneoApiJsonParsed` raw-payload assertions, `invalid-API-key`, invalid-workspace search) and every META test (the 3 task-comments target-detection tests). Delete all 5 `user-workflows` tests unless the triage flagged a unique atom to migrate first (if so, that atom should already be a parity group from an earlier wave).

- [ ] **Step 2: Remove now-unused imports/helpers from slimmed suites**

After deletions, remove imports and local helpers no longer referenced (oxlint `no-unused-vars` is an error). If a suite has zero remaining tests, delete the file and remove its `import './<name>.test.ts'` (or equivalent registration) from `tests/e2e/e2e.test.ts`.

- [ ] **Step 3: Run the full e2e suite (Docker) to confirm residue still passes**

Run: `bun test:e2e`
Expected: PASS — the slimmed suites run their RESIDUE tests + the full `provider-parity.test.ts` (29 groups) green against real Kaneo. Record the new e2e test total.

- [ ] **Step 4: Confirm the hermetic story lane is unaffected**

Run: `bun test:stories:contracts`
Expected: PASS — retirement touched only `tests/e2e/`, not the frozen story tree.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/
git commit -m "test(e2e): retire domain tests migrated into the parity lane"
```

---

### Task 8: Final reconciliation and verification

**Files:**
- Modify: `tests/stories/catalog/coverage.ts` (`CATALOG_SOURCE` provenance string)

- [ ] **Step 1: Update `CATALOG_SOURCE` provenance**

Set it to reflect the retrofit (use the actual final new-group count if reconciliation changed it from 17):

```ts
export const CATALOG_SOURCE =
  'scenario-catalog snapshot supplied 2026-07-13; extended 2026-07-23 with 12 SCN-parity-* provider-real (@1) ids (tier1-provider-real-parity); extended 2026-07-24 with 17 SCN-parity-* domain-retrofit (@1) ids (tier1b-e2e-parity-retrofit)' as const
```

- [ ] **Step 2: Full hermetic contract run**

Run: `bun test:stories:contracts`
Expected: PASS — runner line reads `130/157 … T1 29` (or the reconciled totals). No pending/T0 drift.

- [ ] **Step 3: Full Docker lane (the authoritative divergence gate)**

Run: `bun test:e2e`
Expected: PASS — `provider-parity.test.ts` 29/29 against real Kaneo; slimmed suites' residue green. If any parity group diverges here for the first time (a wave deferred its Docker gate), reclassify it to `PARITY_EXCLUSIONS` and apply the reconciliation rule across all six literal sites + `coverage.ts`, then re-run Steps 2–3.

- [ ] **Step 4: Re-prove the two T1 tier-contract teeth**

Confirm the guards still bite (temporarily mutate, observe failure, revert):
- corrupt one `@1` storyId title in `coverage.ts` → the `maps every @1 parity record to its exact parity story title` cross-check FAILS; revert → GREEN.
- flip one `@1` record's `provingTier` to `'0'` → the `keeps every executable story under its own tier suite root` check FAILS (story lives under `tests/e2e/`, not `tests/stories/`); revert → GREEN.

- [ ] **Step 5: Whole-suite green + gate**

Run: `bun typecheck && bun lint && bun format:check && bun test`
Expected: clean; license-headers pass on all new files (including the triage `.md`). Pre-commit 4/4.

- [ ] **Step 6: Commit + update PR artifacts**

```bash
git add tests/stories/catalog/coverage.ts
git commit -m "docs(catalog): record the tier1b domain-retrofit provenance"
```

Then update `.superpowers/sdd/progress.md` (append a T1b ledger line with the final counts) and `.superpowers/sdd/pr-body.md` (a "T1b — tests/e2e parity retrofit" section: N groups added, final totals `130/157 … T1 29`, retired domain-suite count, exclusions → 21).

- [ ] **Step 7: Finish the branch**

Use superpowers:finishing-a-development-branch to present the completion options (this work extends PR #191 on `codex/tier1-provider-real`).

---

## Self-Review

**Spec coverage:**
- Convert-to-parity (fake+Kaneo) → Tasks 2–6 add 17 groups run by both bindings. ✓
- Migrate & retire, single source → Task 7 deletes migrated duplicates. ✓
- Fake stays frozen → no task touches `memory-task-provider.ts`; presence/type assertions absorb Kaneo supersets. ✓
- Approach C (triage first) → Task 0 produces the triage table before any group. ✓
- Drop user-workflows as redundant → Task 7 Step 1. ✓
- Error-parity consolidated by domain → Task 5 (4 domain-grouped groups). ✓
- Per-domain module split → Task 1 (concat, not barrel). ✓ (Spec's max-lines rationale was void; retained as a focus split per user decision.)
- EXCLUDE (directionality, invalid-workspace) → Tasks 3 & 6 add exclusion entries with `KaneoProvider` reasons. ✓
- Ledger/catalog accounting → per-wave six-site bumps + generic cross-check. ✓
- Teeth-proofs preserved → Task 8 Step 4. ✓

**Placeholder scan:** every new group carries full code; every ledger edit carries exact before→after values; every command carries expected output; retirement references the concrete Task 0 table. No "TBD"/"add appropriate"/"similar to". ✓

**Type consistency:** `ParityGroup`/`ParityHarness`/`required` defined once in `group.ts`, imported everywhere; group `run` signatures match `ParityHarness`; `Task` fields (`startDate`/`dueDate`/`description`/`priority`) confirmed optional in `domain-types.ts`; `searchTasks` `limit` confirmed; `?.` used for optional methods to keep `this`; `required` used only to strip `undefined` (dates use null-safe `toBeTypeOf`/unset checks, never `required`). ✓

**Known reconciliation risk:** `SCN-parity-task-full-property` (priority on Kaneo create) is the most likely single reclassification; the divergence gate + reconciliation rule handle it deterministically without invalidating the plan.
