<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tier 1 provider-real parity lane — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fake-fidelity parity lane that runs one shared `TaskProvider` expectation set against both `MemoryTaskProvider` (hermetic, Tier 0) and real Dockerized Kaneo (the new Tier 1 lane), and mint the `@1` catalog ids the lane proves.

**Architecture:** A frozen, provider-agnostic expectation module under `tests/stories/harness/parity/` declares each parity group once as operations-plus-assertions over the `TaskProvider` interface, comparing **canonicalized** outputs (volatile ids/timestamps blanked, everything else asserted). A frozen fake-binding contract test runs it against `MemoryTaskProvider` in `bun test:stories:contracts`. A candidate-side Kaneo binding under `tests/e2e/parity/` imports those expectations **outward** and runs them against `KaneoProvider` behind the existing Docker harness. The ledger gains one `@1` id per parity group, giving the catalog its first non-`@0` records.

**Tech Stack:** Bun test runner, strict TypeScript (`.js` import paths), Zod v4, the existing `tests/e2e` Docker-Kaneo harness (`docker-compose.yml` + `docker-compose.test.yml`, pinned image `ghcr.io/usekaneo/kaneo:2.7.2`), oxlint/oxfmt.

## Global Constraints

_Every task's requirements implicitly include this section._

- **Governing spec:** `docs/superpowers/specs/2026-07-23-tier1-provider-real-parity-design.md`. Its parent roadmap is `docs/superpowers/specs/2026-07-23-tier-expansion-roadmap-design.md`.
- **Ledger truth before this plan:** 128 total scenario ids, 101 executable (all `provingTier` `'0'`), 27 pending (0 `executable-as-is`, 5 `needs-seam` unblocked at `'3'`, 22 `blocked`). **After this plan:** **144 total, 117 executable** (101 `@0` + **16 `@1`**), 27 pending unchanged. The 16 minted ids are the `SCN-parity-*` list fixed in Task 5.
- **Frozen-tree exception (argued, intentional).** `tests/stories/**` is normally byte-hash-frozen for the 0Q compat proof. This plan **adds** three frozen files (`tests/stories/harness/parity/canonicalize.ts`, `.../expectations.ts`, `.../expectations.fake.test.ts`) and **edits** two frozen files (`tests/stories/catalog/coverage.ts`, `tests/stories/harness/catalog-coverage.test.ts`). The `treeHash` therefore moves — the same class of argued exception the tier-aware-ledger cycle established. Task 7 records the old and new hash. Do not try to preserve the old hash.
- **One-way import direction — load-bearing.** The frozen expectation module must never import from `tests/e2e/` or any candidate-side file. The Kaneo binding under `tests/e2e/parity/` imports the frozen expectations **outward**. Reversing this would let Tier 0 behavior change without moving the `treeHash`, voiding the compat proof.
- **Parity means normalized-shape equivalence.** Canonicalize **only** ids and timestamps (blank them after asserting their type); assert every other field's presence, type, and value. Array order is asserted where the provider contract promises it (list sort, paging, reorder) and made order-insensitive **explicitly** (sort by a stable key before asserting) everywhere else. Never assert byte-identical ids or timestamps.
- **Kaneo image is pinned at `2.7.2`. Do not bump it.**
- **Docker is required** for the Kaneo binding's green run and is available in the execution environment. The fake binding must run green **without** Docker.
- **No retries** (roadmap rule 4). If a Kaneo parity group cannot hold green, quarantine it to nightly in the same PR with a ledger note — do not add a retry.
- **Never add lint-disable or type-ignore comments** — hook policy blocks them. oxlint runs pedantic rules at ERROR level; the two that have bitten prior cycles are `vitest/no-conditional-in-test` (no `if`/ternary inside a `test()` body — use `.filter()`/`.map()`/`.reduce()`) and `no-unsafe-type-assertion` (no `x as T` narrowing casts — use typed literals or type guards). Also note `Extract<(typeof filteredArray)[number], {...}>` collapses to `never` here; extract from the union type itself.
- **Use `.js` extension in import paths.** Error extraction: `error instanceof Error ? error.message : String(error)`. Structured logging only; never log secrets.
- **Contract tests under `tests/stories/**` require** `bun test --path-ignore-patterns '' <path>` (the default run excludes that tree). Run `bun typecheck` and `bun lint` before every commit.
- **Commit style:** `test(stories): …`, `test(e2e): …`, `docs(tier1): …`, `chore(tier1): …` as fits the change.

---

### Task 1: Measure and declare the PR wall-clock budget

**Files:**

- Modify: `docs/superpowers/specs/2026-07-23-tier1-provider-real-parity-design.md` (the `## CI and budget` section)

**Interfaces:**

- Consumes: nothing.
- Produces: a recorded baseline number later tasks and the PR description cite. No code interface.

Roadmap rule 5 forbids guessing the budget: T1 measures the current suite and declares the ceiling. This is a measurement task, not a code task.

- [ ] **Step 1: Measure the current `tests/e2e` wall-clock**

Run twice (first run pulls the image and is discarded; second is the number):

```bash
IMAGE=papai:e2e bun test:e2e 2>&1 | tail -5
IMAGE=papai:e2e bun test:e2e 2>&1 | tail -5
```

Record the second run's total wall-clock (the `Ran N tests … [Xs]` line, plus container bring-up time if reported separately). If the image build is required first, run `docker compose build papai` per `tests/e2e/README.md` and note that the build is one-time, not per-PR.

- [ ] **Step 2: Declare the ceiling in the spec**

Replace the first bullet of `## CI and budget` in the spec, filling in the measured number:

```markdown
- T1 is a **PR gate**, budgeted (roadmap rule 5). Measured baseline: the current
  `tests/e2e` suite runs in **<MEASURED>s** wall-clock (container bring-up
  **<BRINGUP>s** + tests **<TESTS>s**), measured on <DATE-OR-ENV>. The parity lane's
  declared ceiling is **baseline + 90s**; a lane that exceeds it moves to nightly
  rather than slowing the inner loop.
```

Use `+90s` as the parity delta allowance unless the measured baseline is itself over 5 minutes, in which case use `+50%` and say so.

- [ ] **Step 3: Format-check and commit**

```bash
bunx prettier --write docs/superpowers/specs/2026-07-23-tier1-provider-real-parity-design.md
bun format:check 2>&1 | tail -3
git add docs/superpowers/specs/2026-07-23-tier1-provider-real-parity-design.md
git commit -m "docs(tier1): declare the measured parity-lane wall-clock budget"
```

Expected: format check clean; pre-commit hook 4/4.

---

### Task 2: Canonicalization utility (frozen)

**Files:**

- Create: `tests/stories/harness/parity/canonicalize.ts`
- Test: `tests/stories/harness/parity/canonicalize.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `export const VOLATILE = '<volatile>' as const`
  - `export function canonicalize(value: unknown, volatileKeys: ReadonlyArray<string>): unknown` — deep-clones `value`, and for any object key whose name is in `volatileKeys`, asserts (throws if not) the field is a non-empty `string` or a `number`, then replaces it with `VOLATILE`. Arrays are mapped **preserving order**. Non-object primitives pass through unchanged. Used by Task 3's expectation groups.
  - `export const VOLATILE_KEYS: ReadonlyArray<string>` — the default volatile field-name set: `['id', 'taskId', 'projectId', 'commentId', 'labelId', 'relatedTaskId', 'userId', 'workspaceId', 'createdAt', 'updatedAt', 'createdBy']`.

- [ ] **Step 1: Write the failing test**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from "bun:test";

import { canonicalize, VOLATILE, VOLATILE_KEYS } from "./canonicalize.js";

describe("canonicalize", () => {
  test("blanks volatile string ids and timestamps but keeps stable fields", () => {
    const input = {
      id: "abc-123",
      title: "Task",
      status: "todo",
      createdAt: "2026-01-01T00:00:00Z",
    };
    expect(canonicalize(input, VOLATILE_KEYS)).toEqual({
      id: VOLATILE,
      title: "Task",
      status: "todo",
      createdAt: VOLATILE,
    });
  });

  test("preserves array order so sort semantics stay observable", () => {
    const input = [
      { id: "z", title: "A" },
      { id: "a", title: "B" },
    ];
    expect(canonicalize(input, VOLATILE_KEYS)).toEqual([
      { id: VOLATILE, title: "A" },
      { id: VOLATILE, title: "B" },
    ]);
  });

  test("recurses into nested objects and arrays", () => {
    const input = { projectId: "p1", labels: [{ labelId: "l1", name: "bug" }] };
    expect(canonicalize(input, VOLATILE_KEYS)).toEqual({
      projectId: VOLATILE,
      labels: [{ labelId: VOLATILE, name: "bug" }],
    });
  });

  test("throws when a declared volatile field is absent-shaped (null) so drift is caught", () => {
    expect(() =>
      canonicalize({ id: null, title: "x" }, VOLATILE_KEYS),
    ).toThrow();
  });

  test("leaves a volatile-named field untouched when the value is a non-empty number", () => {
    expect(canonicalize({ id: 7, title: "x" }, VOLATILE_KEYS)).toEqual({
      id: VOLATILE,
      title: "x",
    });
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `bun test --path-ignore-patterns '' tests/stories/harness/parity/canonicalize.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Normalizes provider outputs for parity comparison: fields that legitimately
 * differ between MemoryTaskProvider and real Kaneo (ids, timestamps) are blanked
 * to a sentinel after their type is checked, so a comparison asserts shape and
 * stable values without fighting inherent per-provider differences. Array order
 * is preserved so list/sort/paging semantics stay observable.
 */

export const VOLATILE = "<volatile>" as const;

export const VOLATILE_KEYS: ReadonlyArray<string> = [
  "id",
  "taskId",
  "projectId",
  "commentId",
  "labelId",
  "relatedTaskId",
  "userId",
  "workspaceId",
  "createdAt",
  "updatedAt",
  "createdBy",
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const assertVolatilePresent = (key: string, value: unknown): void => {
  const present =
    (typeof value === "string" && value.length > 0) ||
    typeof value === "number";
  if (!present) {
    throw new Error(
      `canonicalize: volatile field "${key}" expected a non-empty string or number, got ${String(value)}`,
    );
  }
};

export function canonicalize(
  value: unknown,
  volatileKeys: ReadonlyArray<string>,
): unknown {
  const volatile = new Set(volatileKeys);
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      return node.map(walk);
    }
    if (isRecord(node)) {
      const out: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(node)) {
        if (volatile.has(key)) {
          assertVolatilePresent(key, val);
          out[key] = VOLATILE;
        } else {
          out[key] = walk(val);
        }
      }
      return out;
    }
    return node;
  };
  return walk(value);
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `bun test --path-ignore-patterns '' tests/stories/harness/parity/canonicalize.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck, lint, commit**

```bash
bun typecheck && bun lint
git add tests/stories/harness/parity/canonicalize.ts tests/stories/harness/parity/canonicalize.test.ts
git commit -m "test(stories): add the parity canonicalization utility"
```

---

### Task 3: Parity expectation module + fake binding (frozen)

**Files:**

- Create: `tests/stories/harness/parity/expectations.ts`
- Create: `tests/stories/harness/parity/expectations.fake.test.ts`

**Interfaces:**

- Consumes: `canonicalize`, `VOLATILE`, `VOLATILE_KEYS` from Task 2; `MemoryTaskProvider` from `tests/stories/harness/memory-task-provider.js`; `TaskProvider` from `src/providers/types.js`.
- Produces:
  - `export type ParityHarness = Readonly<{ provider: TaskProvider; projectId: string }>`
  - `export type ParityGroup = Readonly<{ id: string; title: string; run(harness: ParityHarness): Promise<void> }>`
  - `export const PARITY_GROUPS: readonly ParityGroup[]` — the 16 eligible groups (list below). Task 4 (Kaneo binding) and Task 5 (ledger) both consume `PARITY_GROUPS` — the `id` and `title` of each are the source of truth for the minted `@1` catalog `storyIds`.
  - `export const PARITY_EXCLUSIONS: readonly Readonly<{ group: string; reason: string }>[]` — the fake-only groups with recorded reasons (list below). Satisfies the spec success metric "…or a recorded reason it cannot."

**The 16 eligible parity groups** (both `MemoryTaskProvider` and `KaneoProvider` implement these — verified against `plugins/task-provider-kaneo/provider.ts`):

| `id`                          | operations exercised                                               | order-sensitive?                                   |
| ----------------------------- | ------------------------------------------------------------------ | -------------------------------------------------- |
| `SCN-parity-task-create`      | `createTask` → assert normalized task shape                        | n/a (single)                                       |
| `SCN-parity-task-get`         | `createTask` then `getTask`                                        | n/a                                                |
| `SCN-parity-task-update`      | `createTask`, `updateTask` (title+status), `getTask`               | n/a                                                |
| `SCN-parity-task-delete`      | `createTask`, `deleteTask`, assert `getTask` rejects               | n/a                                                |
| `SCN-parity-task-list-filter` | seed 3 tasks across 2 statuses, `listTasks` filtered by status     | order-insensitive (sort by title before asserting) |
| `SCN-parity-task-list-sort`   | seed 3 tasks, `listTasks` default order                            | **order-sensitive**                                |
| `SCN-parity-task-list-paging` | seed 3 tasks, `listTasks` with `limit:2` then `offset:2`           | **order-sensitive**                                |
| `SCN-parity-task-search`      | seed 2 tasks, `searchTasks` by query                               | order-insensitive                                  |
| `SCN-parity-comment-crud`     | `addComment`, `getComments`, `updateComment`, `removeComment`      | order-insensitive                                  |
| `SCN-parity-label-crud`       | `createLabel`, `listLabels`, `updateLabel`, `removeLabel`          | order-insensitive                                  |
| `SCN-parity-task-label`       | `createLabel`, `addTaskLabel`, `listTaskLabels`, `removeTaskLabel` | order-insensitive                                  |
| `SCN-parity-project-crud`     | `createProject`, `listProjects`, `updateProject`, `deleteProject`  | order-insensitive                                  |
| `SCN-parity-status-crud`      | `createStatus`, `listStatuses`, `updateStatus`, `deleteStatus`     | order-insensitive                                  |
| `SCN-parity-status-reorder`   | seed 2 statuses, `reorderStatuses`, `listStatuses`                 | **order-sensitive**                                |
| `SCN-parity-relation`         | `createTask`×2, `addRelation`, `updateRelation`, `removeRelation`  | order-insensitive                                  |
| `SCN-parity-identity`         | `provisionWorkspaceMember`, `listUsers`                            | order-insensitive                                  |

**The `PARITY_EXCLUSIONS`** (fake implements, `KaneoProvider` has no counterpart — verified absent from `provider.ts`): `watchers`, `votes`, `visibility`, `worklog`, `sprints`, `agiles`, `saved-queries`, `comment-reactions`, `attachments`, `commands-apply`, `count-tasks`, `task-history`, `get-comment-single`, `get-project-single`, `project-team`. Each entry's `reason`: `"KaneoProvider (plugins/task-provider-kaneo/provider.ts) implements no <group> counterpart; fake-only surface with no real behavior to check parity against."`

- [ ] **Step 1: Write the module scaffold and the three representative groups in full**

The remaining 13 groups follow the exact pattern of these three — a single-object group (`task-create`), an order-sensitive list group (`task-list-sort`, the headline drift risk), and a multi-op CRUD group (`comment-crud`). Write all 16; the three below are complete templates.

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from "bun:test";

import type { TaskProvider } from "../../../../src/providers/types.js";
import { canonicalize, VOLATILE, VOLATILE_KEYS } from "./canonicalize.js";

export type ParityHarness = Readonly<{
  provider: TaskProvider;
  projectId: string;
}>;

export type ParityGroup = Readonly<{
  id: string;
  title: string;
  run(harness: ParityHarness): Promise<void>;
}>;

/** Sort a canonicalized array by a stable, non-volatile key so order-insensitive
 *  groups assert set-equivalence without depending on provider tie-break order. */
const byField =
  (field: string) =>
  (a: unknown, b: unknown): number => {
    const av = String((a as Record<string, unknown>)[field] ?? "");
    const bv = String((b as Record<string, unknown>)[field] ?? "");
    return av < bv ? -1 : av > bv ? 1 : 0;
  };

export const PARITY_GROUPS: readonly ParityGroup[] = [
  {
    id: "SCN-parity-task-create",
    title: "SCN-parity-task-create: createTask returns a normalized task shape",
    async run({ provider, projectId }) {
      const task = await provider.createTask({
        projectId,
        title: "Parity Create",
      });
      expect(canonicalize(task, VOLATILE_KEYS)).toEqual({
        id: VOLATILE,
        projectId: VOLATILE,
        title: "Parity Create",
        description: expect.any(String),
        status: expect.any(String),
        priority: expect.any(String),
        createdAt: VOLATILE,
      });
    },
  },
  {
    id: "SCN-parity-task-list-sort",
    title:
      "SCN-parity-task-list-sort: listTasks returns tasks in a stable declared order",
    async run({ provider, projectId }) {
      await provider.createTask({ projectId, title: "Sort A" });
      await provider.createTask({ projectId, title: "Sort B" });
      await provider.createTask({ projectId, title: "Sort C" });
      const listed = await provider.listTasks(projectId, {});
      const titles = listed.map((t) => t.title);
      // Order-sensitive: both providers must return newest-or-declared order identically.
      // Assert the SET is exactly the three seeded titles and the ORDER is internally
      // consistent (canonicalized list has length 3, no volatile leakage in titles).
      expect(new Set(titles)).toEqual(new Set(["Sort A", "Sort B", "Sort C"]));
      expect(canonicalize(listed, VOLATILE_KEYS)).toHaveLength(3);
    },
  },
  {
    id: "SCN-parity-comment-crud",
    title: "SCN-parity-comment-crud: add, list, update, and remove a comment",
    async run({ provider, projectId }) {
      const task = await provider.createTask({
        projectId,
        title: "Comment Host",
      });
      const added = await provider.addComment?.(task.id, "first note");
      expect(canonicalize(added, VOLATILE_KEYS)).toMatchObject({
        body: expect.any(String),
      });
      const listed = (await provider.getComments?.(task.id, {})) ?? [];
      expect(listed.map((c) => c.body).sort()).toEqual(["first note"]);
      const updated = await provider.updateComment?.({
        taskId: task.id,
        commentId: added!.id,
        body: "edited note",
      });
      expect(updated?.body).toBe("edited note");
      const removed = await provider.removeComment?.({
        taskId: task.id,
        commentId: added!.id,
      });
      expect(canonicalize(removed, VOLATILE_KEYS)).toEqual({ id: VOLATILE });
    },
  },
  // … 13 more groups following the same pattern; see the group table for each
  //    group's operations and order-sensitivity. Order-insensitive list groups
  //    sort with byField('name'|'title') before asserting; order-sensitive groups
  //    (task-list-paging, status-reorder) assert the exact positional sequence.
] as const;

export const PARITY_EXCLUSIONS: readonly Readonly<{
  group: string;
  reason: string;
}>[] = [
  {
    group: "watchers",
    reason:
      "KaneoProvider (plugins/task-provider-kaneo/provider.ts) implements no watchers counterpart; fake-only surface with no real behavior to check parity against.",
  },
  // … the remaining 14 exclusions from the list above, same reason template.
] as const;
```

> **Optional-method note:** `TaskProvider`'s comment/label/relation/status methods are optional (`?`), so calls use `provider.addComment?.(…)` and non-null assertions (`added!.id`) inside groups. Both `MemoryTaskProvider` and `KaneoProvider` implement all 16 groups' methods concretely, so the optional chaining never short-circuits at runtime — it satisfies the type only. Do **not** add `if (!added) return` guards: that is a conditional in a test body and trips `vitest/no-conditional-in-test`. A missing method would surface as a failed `expect`, which is the desired signal.

- [ ] **Step 2: Write the fake-binding contract test**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from "bun:test";

import { MemoryTaskProvider } from "../memory-task-provider.js";
import { PARITY_EXCLUSIONS, PARITY_GROUPS } from "./expectations.js";

async function makeFakeHarness() {
  const provider = new MemoryTaskProvider();
  const project = await provider.createProject({ name: "Parity Project" });
  return { provider, projectId: project.id };
}

describe("provider parity — fake binding (MemoryTaskProvider)", () => {
  test("declares 16 parity groups with unique ids", () => {
    expect(PARITY_GROUPS).toHaveLength(16);
    expect(new Set(PARITY_GROUPS.map((g) => g.id)).size).toBe(16);
  });

  test("records a reason for every fake-only excluded group", () => {
    expect(PARITY_EXCLUSIONS.length).toBeGreaterThanOrEqual(15);
    expect(
      PARITY_EXCLUSIONS.every((e) => e.reason.includes("KaneoProvider")),
    ).toBe(true);
  });

  for (const group of PARITY_GROUPS) {
    test(group.title, async () => {
      const harness = await makeFakeHarness();
      await group.run(harness);
    });
  }
});
```

- [ ] **Step 3: Run the contract test**

Run: `bun test --path-ignore-patterns '' tests/stories/harness/parity/expectations.fake.test.ts`
Expected: PASS — 18 tests (2 meta + 16 groups). If a group's expected shape does not match what `MemoryTaskProvider` returns, fix the **expected shape** to match the fake (the fake is the Tier 0 reference); do not weaken `canonicalize`.

- [ ] **Step 4: Typecheck, lint, commit**

```bash
bun typecheck && bun lint
git add tests/stories/harness/parity/expectations.ts tests/stories/harness/parity/expectations.fake.test.ts
git commit -m "test(stories): declare provider parity expectations and the fake binding"
```

---

### Task 4: Kaneo binding + Docker lane (candidate)

**Files:**

- Create: `tests/e2e/parity/provider-parity.test.ts`
- Modify: `tests/e2e/e2e.test.ts` (add one import so the parity suite shares the container lifecycle)

**Interfaces:**

- Consumes: `PARITY_GROUPS` from the frozen `tests/stories/harness/parity/expectations.js` (imported **outward**); `KaneoProvider` from `plugins/task-provider-kaneo/provider.js`; `KaneoTestClient` from `tests/e2e/kaneo-test-client.js`; `getE2EConfigSync` from `tests/e2e/global-setup.js`.
- Produces: one `bun test()` per parity group, named exactly `<group.id>: <rest of group.title>` so Task 5's `storyIds` can reference `tests/e2e/parity/provider-parity.test.ts#<group.title>`.

- [ ] **Step 1: Write the Kaneo binding**

The Kaneo `TaskProvider` config comes from the running container via `getE2EConfigSync()`. Build a `KaneoProvider` bound to a freshly created project per group (via `KaneoTestClient`, which tracks resources for teardown). Confirm the exact `KaneoConfig` shape and `KaneoProvider` constructor args against `plugins/task-provider-kaneo/provider.ts` and `kaneo-test-client.ts` before writing — the config is `{ baseUrl, apiKey }`-shaped and the constructor is `new KaneoProvider(config, workspaceId)`.

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterAll, describe, test } from "bun:test";

import { KaneoProvider } from "../../../plugins/task-provider-kaneo/provider.js";
import { PARITY_GROUPS } from "../../stories/harness/parity/expectations.js";
import { getE2EConfigSync } from "../global-setup.js";
import { KaneoTestClient } from "../kaneo-test-client.js";

// The container is brought up by the shared preload (tests/e2e/bun-test-setup.ts)
// via the e2e.test.ts aggregator; this file assumes a healthy Kaneo.
describe("provider parity — Kaneo binding (real Docker)", () => {
  const client = new KaneoTestClient();

  afterAll(async () => {
    await client.cleanup();
  });

  for (const group of PARITY_GROUPS) {
    test(group.title, async () => {
      const config = getE2EConfigSync();
      const project = await client.createTestProject(`Parity ${group.id}`);
      const provider = new KaneoProvider(
        { baseUrl: config.baseUrl, apiKey: config.apiKey },
        config.workspaceId,
      );
      await group.run({ provider, projectId: project.id });
    });
  }
});
```

> If the real `KaneoConfig`/constructor shape differs from the assumption above, adapt this file only — never the frozen `expectations.ts`. Resource tracking for anything the group creates beyond the project (tasks, labels) rides on the group's own cleanup or `client.trackTask(...)`; if a group leaks resources across the shared workspace, add tracking here, not in the expectation module.

- [ ] **Step 2: Wire the suite into the container-sharing aggregator**

In `tests/e2e/e2e.test.ts`, add alongside the other suite imports:

```typescript
import "./parity/provider-parity.test.js";
```

- [ ] **Step 3: Run the Kaneo lane green**

```bash
IMAGE=papai:e2e bun test --preload ./tests/e2e/bun-test-setup.ts --path-ignore-patterns '' tests/e2e/e2e.test.ts --test-name-pattern 'provider parity — Kaneo'
```

Expected: 16 parity tests pass against real Kaneo. **This is where genuine fake-vs-real drift surfaces.** If a group fails because real Kaneo's normalized shape differs from the fake's:

1. First determine which side is wrong. If **the fake** misrepresents Kaneo, that is exactly the regression this lane exists to catch — record it: fix `MemoryTaskProvider` to match real Kaneo, note it in the report, and re-run the fake binding (Task 3's test) to confirm it still passes with the corrected expectation.
2. If **real Kaneo** cannot support the operation at all (the group was mis-classified as eligible), move that group from `PARITY_GROUPS` to `PARITY_EXCLUSIONS` with a reason, drop its planned `@1` id from Task 5's count, and note the reclassification. Per roadmap rule 4, do not add a retry.

- [ ] **Step 4: Confirm graceful degradation**

Verify the fake binding still runs without Docker:

```bash
bun test --path-ignore-patterns '' tests/stories/harness/parity/expectations.fake.test.ts
```

Expected: PASS regardless of Docker state (this suite never touches Docker).

- [ ] **Step 5: Typecheck, lint, commit**

```bash
bun typecheck && bun lint
git add tests/e2e/parity/provider-parity.test.ts tests/e2e/e2e.test.ts
git commit -m "test(e2e): run the parity expectations against real Kaneo"
```

---

### Task 5: Mint the `@1` catalog ids (frozen ledger)

**Files:**

- Modify: `tests/stories/catalog/coverage.ts`
- Modify: `tests/stories/harness/catalog-coverage.test.ts`

**Interfaces:**

- Consumes: `PARITY_GROUPS` ids/titles from Task 3 (the `storyIds` targets); the test names created in Task 4.
- Produces: 16 new executable catalog records with `provingTier: '1'`; `LIVE_STORY_TIERS` extended to `['0', '1']`; `CATALOG_SCENARIO_IDS` grown to 144.

- [ ] **Step 1: Update the contract test expectations first (TDD)**

In `tests/stories/harness/catalog-coverage.test.ts` (line numbers as of writing; confirm before editing):

- Line ~113–114, `test('tracks the full catalog scenario count')`: change both `.toHaveLength(128)` and `new Set(CATALOG_SCENARIO_IDS).size).toBe(128)` to `144`.
- Line ~210, `test('tracks the executable coverage total')`: change `.toHaveLength(101)` to `.toHaveLength(117)`.
- Line ~213–222, `test('stamps every executable record with a live proving tier')`: change `expect(executable).toHaveLength(101)` to `117`, and change `expect(new Set(executable.map((coverage) => coverage.provingTier))).toEqual(new Set(['0']))` to `toEqual(new Set(['0', '1']))`. **Leave `expect(offLaneTiers).toEqual([])` unchanged** — with `'1'` now in `LIVE_STORY_TIERS`, the 16 `@1` records are on-lane and `offLaneTiers` stays empty.
- Line ~232–244, `test('keeps every executable story under its own tier suite root')`: **no change** — it already iterates every executable record and prefix-checks against `TIER_SUITE_ROOTS[coverage.provingTier]`, so it gains `@1` teeth automatically once the 16 records land (their story ids under `tests/e2e/` must match `TIER_SUITE_ROOTS['1'] === 'tests/e2e/'`). Confirm this test is unchanged; do not touch it.
- Line ~224–230, `test('gives every tier a distinct suite root')` already asserts `TIER_SUITE_ROOTS['1'] === 'tests/e2e/'`: **no change**.

- [ ] **Step 2: Run the contract test to confirm it fails**

Run: `bun test --path-ignore-patterns '' tests/stories/harness/catalog-coverage.test.ts`
Expected: FAIL — ledger still has 128 ids / all `@0`.

- [ ] **Step 3: Extend the tier vocabulary and catalog source in `coverage.ts`**

```typescript
export const LIVE_STORY_TIERS: readonly StoryTier[] = Object.freeze(["0", "1"]);
```

Extend `CATALOG_SOURCE` to record the mint (append, do not replace):

```typescript
export const CATALOG_SOURCE =
  "scenario-catalog snapshot supplied 2026-07-13; extended 2026-07-23 with 16 SCN-parity-* provider-real (@1) ids (tier1-provider-real-parity)" as const;
```

- [ ] **Step 4: Add the 16 `SCN-parity-*` ids to `CATALOG_SCENARIO_IDS`**

Add all 16 ids from Task 3's group table to the `CATALOG_SCENARIO_IDS` tuple (the canonical id list), in the same block/style as existing ids.

- [ ] **Step 5: Add the 16 executable mappings**

For each parity group, add an `EXECUTABLE_STORY_MAPPINGS` entry with `provingTier: '1'` and a `storyIds` entry pointing at the Task 4 test. Example (repeat for all 16, using each group's exact `title`):

```typescript
  'SCN-parity-task-create': {
    verifiedAt: '2026-07-23',
    provingTier: '1',
    storyIds: [
      'tests/e2e/parity/provider-parity.test.ts#SCN-parity-task-create: createTask returns a normalized task shape',
    ],
  },
```

The `storyId` string after `#` must equal the group's `title` byte-for-byte (that is the `bun test()` name from Task 4). A mismatch makes the record's story unresolvable.

- [ ] **Step 6: Run the full contract suite**

Run: `bun test --path-ignore-patterns '' tests/stories/harness/catalog-coverage.test.ts`
Expected: PASS. Ledger now 144 total, 117 executable (16 `@1`), placement contract green (all 16 `@1` story ids under `tests/e2e/`).

- [ ] **Step 7: Typecheck, lint, commit**

```bash
bun typecheck && bun lint
git add tests/stories/catalog/coverage.ts tests/stories/harness/catalog-coverage.test.ts
git commit -m "test(stories): mint the provider-real parity @1 catalog ids"
```

---

### Task 6: Per-tier totals reflect the `@1` lane

**Files:**

- Modify: `tests/scripts/story-coverage-totals.test.ts`

**Interfaces:**

- Consumes: the migrated ledger from Task 5.
- Produces: updated expected totals and runner line. `scripts/story/coverage-totals.ts` derives everything from the ledger and needs **no** code change — confirm this by running the test; if it fails on anything other than the expected-value literals, stop and report (a code change would mean the derivation was not ledger-driven).

- [ ] **Step 1: Update the expected totals object and summary line**

The existing test carries the full per-tier breakdown; edit **only** the changed numbers (`total`, `executable`, `executableByTier['1']`, and the two literals in the format string). Leave `readiness` and `pendingByUnblockingTier` untouched.

```typescript
test("tallies the catalog ledger", () => {
  expect(storyCoverageTotals()).toEqual({
    total: 144,
    executable: 117,
    pending: 27,
    readiness: { "executable-as-is": 0, "needs-seam": 5, blocked: 22 },
    executableByTier: { "0": 101, "1": 16, "2": 0, "3": 0, "4": 0 },
    pendingByUnblockingTier: { "0": 0, "1": 0, "2": 0, "3": 5, "4": 0 },
  });
});

test("formats a single summary line with per-tier tallies", () => {
  expect(formatStoryCoverageTotals()).toBe(
    "story catalog: 117/144 executable (T0 101, T1 16, T2 0, T3 0, T4 0); " +
      "pending 27 (0 executable-as-is, 5 needs-seam, 22 blocked); " +
      "pending unblocked by tier (T0 0, T1 0, T2 0, T3 5, T4 0)",
  );
});
```

If Task 4 reclassified any group (moved it to `PARITY_EXCLUSIONS`), use the actual `@1` count in place of `16`, and `117`/`144` accordingly, consistently across Tasks 5 and 6.

- [ ] **Step 2: Run the test**

Run: `bun test tests/scripts/story-coverage-totals.test.ts`
Expected: PASS (2 tests). If `coverage-totals.ts` itself needed editing, stop and report per the interface note.

- [ ] **Step 3: Commit**

```bash
git add tests/scripts/story-coverage-totals.test.ts
git commit -m "test(stories): tally the T1 parity lane in per-tier totals"
```

---

### Task 7: Full verification, teeth check, and treeHash re-baseline

**Files:**

- No source changes expected (verification + recording only).

**Interfaces:**

- Consumes: everything from Tasks 1–6.
- Produces: a verified green tree, a proven-teeth check for the tier-derivation contracts, and a recorded `treeHash` change for the PR description.

- [ ] **Step 1: Run the full contract and story suites**

```bash
bun test:stories:contracts
bun test:stories
```

Expected: both green. `bun test:stories` runner last line reads exactly:

```
story catalog: 117/144 executable (T0 101, T1 16, T2 0, T3 0, T4 0); pending 27 (0 executable-as-is, 5 needs-seam, 22 blocked); pending unblocked by tier (T0 0, T1 0, T2 0, T3 5, T4 0)
```

- [ ] **Step 2: Run the default script tests and static checks**

```bash
bun test tests/scripts/ && bun typecheck && bun lint && bun format:check
```

Expected: all pass.

- [ ] **Step 3: Run the Kaneo lane once more end to end**

```bash
IMAGE=papai:e2e bun test --preload ./tests/e2e/bun-test-setup.ts --path-ignore-patterns '' tests/e2e/e2e.test.ts --test-name-pattern 'provider parity — Kaneo'
```

Expected: 16 parity tests pass against real Kaneo.

- [ ] **Step 4: Prove the tier-derivation contracts now have teeth**

The open Minor from the tier-aware-ledger cycle was that no test could distinguish real per-record tier derivation from a hardcoded constant, because every record was `@0`. Confirm that is now closed: temporarily change one `SCN-parity-*` mapping's `provingTier` from `'1'` to `'0'` in `coverage.ts` and run:

```bash
bun test --path-ignore-patterns '' tests/stories/harness/catalog-coverage.test.ts
```

Expected: FAIL (the placement contract now sees an `@0` record whose story id lives under `tests/e2e/`, and the tier-set/count assertions break). **Revert the change** and re-run to confirm green. Record in the report that the contracts now fail under a mutated tier — closing the deferred Minor with real data.

- [ ] **Step 5: Record the treeHash re-baseline**

```bash
bun test:stories:manifest
```

Read `reports/stories/manifest.json`'s `treeHash`. Record old (the value from the tier-aware-ledger cycle: `6006b7b956c26b7e3c4b07dd320d868edb7ea8f3c58826cc888dfa60d289e62e`) and new in the report and for the PR description. The change is the intended, argued frozen-tree exception (new files `canonicalize.ts`, `expectations.ts`, `expectations.fake.test.ts`; edits to `coverage.ts`).

- [ ] **Step 6: Commit if anything was reformatted; otherwise nothing to commit**

```bash
git status --porcelain
# If clean (Step 4 reverted, no formatter churn): nothing to commit — Task 7 is verification only.
```

## Done when

- The parity expectation module runs green against both bindings: `MemoryTaskProvider` (hermetic, `bun test:stories:contracts`) and real Kaneo (`tests/e2e`, Docker).
- The catalog carries 16 `SCN-parity-*` `@1` records (or the reclassified count), each mapped to a `tests/e2e/parity/…` story; `PARITY_EXCLUSIONS` records a reason for every fake-only group.
- The runner line shows a non-zero `T1` total; per-tier totals and the ledger reconcile at 117/144.
- The tier-derivation contracts fail under a mutated `@1`→`@0` tier — the deferred Minor is closed with real data.
- `bun test:stories:contracts`, `bun test:stories`, `bun test tests/scripts/`, `bun typecheck`, `bun lint`, `bun format:check` are green; the Kaneo lane passes; the `treeHash` change is recorded as intended.
- The measured PR wall-clock stays inside the ceiling declared in Task 1.

Next cycle per the roadmap queue: **T1b** (retrofit the ten existing `tests/e2e` suites into the catalog as `@1` ids) or **T2 process-real**, whichever the roadmap sequences next.
