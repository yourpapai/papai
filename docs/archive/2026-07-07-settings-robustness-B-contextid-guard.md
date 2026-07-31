<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Settings Robustness — Workstream B: stale-`contextId` guard sweep — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `if (id !== contextId) return` stale-response guard to every per-context `load(id)` that lacks it, so a slow response for a previously-selected context can never overwrite the current context's state (or cause a Save to write the wrong context).

**Architecture:** Apply the exact guard pattern already used by the 9 correctly-guarded sections (e.g. `MembersSection`, `IdentitySection`, `CodingIdentitySection`) to 10 more sections. The guard is transparent to existing single-context tests; one deterministic race regression test (via a reactive-prop fixture) proves the pattern.

**Tech Stack:** Svelte 5 runes; strict TypeScript (`.js` imports); Bun + Svelte `mount` + happy-dom client tests; `oxfmt`/`oxlint`.

**Spec:** [`../specs/2026-07-07-settings-section-robustness-design.md`](../specs/2026-07-07-settings-section-robustness-design.md) (Workstream B)

**Client tests run with:** `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' <path>`; full suite `bun run test:client`. The 2 pre-existing `MemorySection` failures on `master` are unrelated/out of scope.

---

## The Guard Pattern (apply verbatim in every task below)

Every target `load(id)` has this shape: reset error/loading, `await` one or more fetches, write reactive state, `catch` sets the error var, `finally` resets loading. The guard adds **three** things:

1. `if (id !== contextId) return` immediately **after** the awaited fetch(es) resolve and **before** the first reactive-state write;
2. `if (id === contextId)` around the `catch` error assignment;
3. `if (id === contextId)` around the `finally` loading reset.

**Worked example — `GroupProviderSection.svelte:31` — before:**

```typescript
async function load(id: string): Promise<void> {
  loadError = null
  saveError = null
  status = null
  loading = true
  try {
    const result = await fetchGroupTaskInstance(id)
    data = result
    const currentId = result.taskInstanceId
    selected =
      currentId !== null && result.available.some((a) => a.id === currentId)
        ? currentId
        : (result.available[0]?.id ?? '')
  } catch (err) {
    loadError = err
  } finally {
    loading = false
  }
}
```

**after:**

```typescript
async function load(id: string): Promise<void> {
  loadError = null
  saveError = null
  status = null
  loading = true
  try {
    const result = await fetchGroupTaskInstance(id)
    if (id !== contextId) return
    data = result
    const currentId = result.taskInstanceId
    selected =
      currentId !== null && result.available.some((a) => a.id === currentId)
        ? currentId
        : (result.available[0]?.id ?? '')
  } catch (err) {
    if (id === contextId) loadError = err
  } finally {
    if (id === contextId) loading = false
  }
}
```

Each per-section task names the section's error variable (`error` vs `loadError`) and load-fn line; apply the identical three-part guard. `contextId` is the component prop in every section.

## Coverage decision (stated explicitly — no silent cap)

Writing a deterministic race test per section requires a bespoke reactive-prop fixture + section-specific fetch fixtures — 10 near-duplicate fragile fixtures. Instead: **Task 1 builds one full race regression test for `GroupProviderSection`** proving the guard genuinely prevents stale overwrite; **every other section's task applies the identical guard and verifies its existing test file still passes** (the guard is a no-op for single-context tests, so green = no regression). This is standard for a mechanical sweep of an already-proven pattern.

---

## Task 1: `GroupProviderSection` guard + race regression test

**Files:**

- Modify: `client/settings/sections/GroupProviderSection.svelte:31`
- Create: `tests/client/settings/sections/GroupProviderRaceFixture.svelte`
- Create: `tests/client/settings/sections/section-race-harness.svelte.ts`
- Test: `tests/client/settings/sections/GroupProviderSection.test.ts`

- [ ] **Step 1: Create the reactive contextId harness**

`tests/client/settings/sections/section-race-harness.svelte.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// A settable, reactive contextId used by race-test fixtures to simulate the
// top-bar context switcher changing contexts on a live-mounted section.
export const raceState = $state<{ contextId: string }>({ contextId: '' })
```

`tests/client/settings/sections/GroupProviderRaceFixture.svelte`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import GroupProviderSection from '../../../../client/settings/sections/GroupProviderSection.svelte'
  import { raceState } from './section-race-harness.svelte.js'
</script>

<GroupProviderSection contextId={raceState.contextId} />
```

- [ ] **Step 2: Write the failing race test**

Append to `tests/client/settings/sections/GroupProviderSection.test.ts` (imports: add `import GroupProviderRaceFixture from './GroupProviderRaceFixture.svelte'` and `import { raceState } from './section-race-harness.svelte.js'` at the top; reuse the file's existing `json`/`drain`):

```typescript
test('a slow load for a previous context does not overwrite the current context', async () => {
  let resolveA: ((r: Response) => void) | undefined
  setMockFetch((url: string) => {
    if (url.includes('contextId=ctxA')) return new Promise<Response>((res) => (resolveA = res))
    return Promise.resolve(
      json({
        contextId: 'ctxB',
        taskInstanceId: 'kaneo-b',
        available: [{ id: 'kaneo-b', type: 'kaneo', status: 'active' }],
        canProvision: false,
      }),
    )
  })
  raceState.contextId = 'ctxA'
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  const component = mount(GroupProviderRaceFixture, { target, props: {} })
  await drain() // ctxA load is pending
  raceState.contextId = 'ctxB'
  await drain() // ctxB loads fast and renders
  resolveA?.(
    json({
      contextId: 'ctxA',
      taskInstanceId: 'kaneo-a',
      available: [{ id: 'kaneo-a', type: 'kaneo', status: 'active' }],
      canProvision: false,
    }),
  )
  await drain() // ctxA resolves late — guard must discard it
  const sel = target.querySelector<HTMLSelectElement>('[data-testid="group-task-instance"]')!
  expect(sel.value).toBe('kaneo-b')
  raceState.contextId = ''
  void unmount(component)
})
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/sections/GroupProviderSection.test.ts`
Expected: FAIL — without the guard, the late `ctxA` response overwrites `selected`, so `sel.value` is `'kaneo-a'`, not `'kaneo-b'`.

- [ ] **Step 4: Apply the Guard Pattern to `GroupProviderSection.svelte:31`**

Apply the exact before→after shown in "The Guard Pattern" section above (error var is `loadError`).

- [ ] **Step 5: Run the test and confirm it passes**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/sections/GroupProviderSection.test.ts`
Expected: PASS (the new race test plus all existing GroupProvider tests).

- [ ] **Step 6: Typecheck, format, commit**

```bash
bun run typecheck && bun run format
git add client/settings/sections/GroupProviderSection.svelte tests/client/settings/sections/GroupProviderSection.test.ts tests/client/settings/sections/GroupProviderRaceFixture.svelte tests/client/settings/sections/section-race-harness.svelte.ts
git commit -m "fix(settings): guard GroupProvider load against stale contextId"
```

---

## Tasks 2–10: apply the guard to the remaining sections

Each task is identical in shape: apply the three-part Guard Pattern to the named `load(id)`, then run that section's existing client test file and confirm it still passes (green = the guard is transparent to single-context tests). Then typecheck, format, and commit. Read each `load(id)` first to place `if (id !== contextId) return` after its awaited fetch(es) and before the first reactive-state write; use the section's own error-variable name in the `catch`/`finally` guards.

For every task below, the verification + commit steps are:

```bash
# verify (replace <TestFile> with the section's test path)
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' <TestFile>
# expect: all pass
bun run typecheck && bun run format
git add <SectionFile> <TestFile-if-changed>
git commit -m "fix(settings): guard <Section> load against stale contextId"
```

If a section has **no** existing test file, run the whole suite (`bun run test:client`) and confirm no new failures (only the 2 pre-existing `MemorySection` ones).

- [ ] **Task 2 — `AiOutputSection.svelte`** · `load(id)` at `:36` · error var `error` · test `tests/client/settings/sections/AiOutputSection.test.ts`. Apply Guard Pattern (guard after the awaited fetch, `if (id === contextId) error = err` in catch, `if (id === contextId) loading = false` in finally).

- [ ] **Task 3 — `KaneoAccessSection.svelte`** · `load(id)` at `:25` · error var `error` · test `tests/client/settings/sections/KaneoAccessSection.test.ts`.

- [ ] **Task 4 — `McpSection.svelte`** · `load(id)` at `:72` · error var `error` · test `tests/client/settings/sections/McpSection.test.ts`.

- [ ] **Task 5 — `PluginsSection.svelte`** · `load(id)` at `:51` · error var `error` · test `tests/client/settings/sections/PluginsSection.test.ts`.

- [ ] **Task 6 — `ProfileSection.svelte`** · `load(id)` at `:29` · error var `error` · test `tests/client/settings/sections/ProfileSection.test.ts`.

- [ ] **Task 7 — `ReposSection.svelte`** · `load(id)` at `:44` · error var `error` · test `tests/client/settings/repos-section.test.ts` (kebab path).

- [ ] **Task 8 — `TaskProviderSection.svelte`** · `load(id)` at `:43` · error var `error` (typed `unknown`) · test `tests/client/settings/sections/TaskProviderSection.test.ts`. NOTE: `load` fetches config + context-task-instance in a `Promise.all` — place the guard after the `await Promise.all([...])`.

- [ ] **Task 9 — `ToolsSection.svelte`** · `load(id)` at `:96` · error var `error` · test `tests/client/settings/sections/ToolsSection.test.ts`.

- [ ] **Task 10 — `ReleaseSubscriptionSection.svelte` (complete the partial guard)** · `load(id)` at `:33` · error var `loadError` · test `tests/client/settings/sections/ReleaseSubscriptionSection.test.ts`. This file already guards the group-scope success write at `:38` but leaves the personal-scope write unguarded. Read `load` and ensure **every** reactive-state write (both the personal and group branches) is preceded by an `if (id !== contextId) return`, and the `catch`/`finally` use `if (id === contextId)`. Do not remove the existing group-scope guard.

---

## Task 11 (optional, included per full-sweep intent): `AdminPluginsApprovalSection`

**Files:** Modify `client/settings/sections/admin/AdminPluginsApprovalSection.svelte:31`

This admin section closes over a `catalogContextId` prop instead of an id param, and its `load()` never re-checks the prop after awaiting. Capture the prop at the top of `load()` and compare after the await:

- [ ] **Step 1:** Read `load()` (`:31`). At its start capture `const id = catalogContextId`. After the awaited fetch(es), add `if (id !== catalogContextId) return` before the first state write, and guard the `catch`/`finally` error/loading writes with `if (id === catalogContextId)`.
- [ ] **Step 2:** `bun run typecheck && bun run format`; run `bun run test:client` (no new failures).
- [ ] **Step 3:** Commit: `git commit -am "fix(settings): guard AdminPluginsApproval load against stale catalogContextId"`.

---

## Final verification

- [ ] `bun run test:client` — green except the 2 pre-existing `MemorySection` failures.
- [ ] `bun run typecheck` — clean.
- [ ] `git status --short` — clean.
