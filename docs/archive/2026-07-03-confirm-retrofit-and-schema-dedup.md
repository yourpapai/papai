<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Confirm-dialog retrofit + schema dedup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two follow-ups deferred from the MembersSection UX work: (1) dedupe the duplicated private `StoredConfigValueSchema`, and (2) retrofit every `Confirm`-dialog caller to the "keep-open + busy + inline-error" pattern MembersSection now uses, so the settings/admin app has one consistent confirmation behavior.

**Architecture:** Item A extracts one shared Zod base schema into a new module consumed by two `.ts` files. Item B is a single mechanical transformation applied to 13 `Confirm` instances across 12 Svelte sections; the transformation is defined once (the "recipe"), demonstrated in full on one reference file (CodeHostSection), then applied per-file via a parameter table. `client/shared/Confirm.svelte` already supports `busy` — no change there.

**Tech Stack:** Svelte 5 runes, Zod v4, Bun test runner (`bun run test:client`), oxlint/oxfmt.

**Source:** deferred items #3 and #4 from the final review of `docs/superpowers/plans/2026-07-03-memberssection-ux-fixes.md`. Reference implementation: `client/settings/sections/MembersSection.svelte` (`pendingRemove`/`removing`/`removeError`, `busy={removing}`, dialog-scoped error).

**Conventions (every task):**

- `.js` import extensions; NEVER add lint-disable/type-ignore comments.
- `no-conditional-in-test`: no `if` in test bodies — branch fetch mocks at module scope.
- Client tests: `bun run test:client` (plain `bun test` does not discover `tests/client/**`; the script runs the whole client suite — read the pass/fail count).
- `bun run format` before commit; the pre-commit hook runs lint + typecheck + format:check + license-headers. Run `bun run knip` where noted.

---

## Item A — Dedupe `StoredConfigValueSchema` (shared module)

`StoredConfigValueSchema` is a private (`const`, non-exported) Zod base object duplicated **byte-for-byte** in `client/settings/fetcher-schemas.ts:27` (backing `ConfigFieldSchema`, `ByokFieldSchema`, `CodingCredentialFieldSchema`, `PluginConfigFieldSchema`) and `client/settings/fetcher-schemas-admin.ts:28` (backing `ProviderTypeFieldSchema`). Two copies can drift. Recommended fix: a shared base module (keeps admin↔main decoupled).

### Task A1: Extract the shared base schema

**Files:**

- Create: `client/settings/fetcher-schemas-shared.ts`
- Modify: `client/settings/fetcher-schemas.ts`, `client/settings/fetcher-schemas-admin.ts`

- [ ] **Step 1: Create the shared module**

Create `client/settings/fetcher-schemas-shared.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

/** Shared base shape for a stored, editable config value (settings + admin field schemas). */
export const StoredConfigValueSchema = z.object({
  key: z.string(),
  label: z.string(),
  required: z.boolean(),
  sensitive: z.boolean(),
  hasValue: z.boolean(),
  value: z.string(),
  control: z.enum(['text', 'select', 'combobox']).optional(),
  options: z.array(z.string()).optional(),
})
```

- [ ] **Step 2: Consume it in `fetcher-schemas.ts`**

In `client/settings/fetcher-schemas.ts`, delete the local `const StoredConfigValueSchema = z.object({ … })` block (lines ~27-36) and add an import near the top (with the other imports):

```ts
import { StoredConfigValueSchema } from './fetcher-schemas-shared.js'
```

Leave `ConfigFieldSchema`/`ByokFieldSchema`/`CodingCredentialFieldSchema`/`PluginConfigFieldSchema` unchanged — they still reference `StoredConfigValueSchema` (now imported).

- [ ] **Step 3: Consume it in `fetcher-schemas-admin.ts`**

In `client/settings/fetcher-schemas-admin.ts`, delete its local `const StoredConfigValueSchema = z.object({ … })` block (lines ~28-37) and add:

```ts
import { StoredConfigValueSchema } from './fetcher-schemas-shared.js'
```

`ProviderTypeFieldSchema` (which does `StoredConfigValueSchema.omit({ hasValue: true, value: true })`) still works.

- [ ] **Step 4: Verify**

Run: `bun run typecheck` → clean.
Run: `bun run test:client` → all pass (schema tests in `tests/client/settings/fetcher-schemas.test.ts` and `fetcher-schemas-admin.test.ts` exercise the field schemas that build on this base).
Run: `bun run knip` → exit 0. (The new export is consumed by two `.ts` files, so knip sees it — no `knip.jsonc` entry needed, unlike the `.svelte`-consumed _types_ already listed there.)

- [ ] **Step 5: Commit**

```bash
bun run format
git add client/settings/fetcher-schemas-shared.ts client/settings/fetcher-schemas.ts client/settings/fetcher-schemas-admin.ts
git commit -m "refactor(settings): share StoredConfigValueSchema across schema modules"
```

---

## Item B — Retrofit `Confirm` callers to keep-open + busy + inline-error

### The recipe (applied identically to every retrofit task below)

Given a section with: a dialog-open state `PENDING` (a `boolean` or an `object | null`), an async confirm action calling `ACTION_FETCHER(...)` then reloading via `RELOAD()`, and a section-level `error` for messages — transform it to the MembersSection pattern:

1. **State:** add an in-flight flag `BUSY` (reuse an existing unused one where noted, else add `let BUSY = $state(false)`) and a dialog-scoped error `let CONFIRM_ERROR = $state<string | null>(null)`.
2. **On open:** wherever the trigger button sets `PENDING` (opens the dialog), also set `CONFIRM_ERROR = null`.
3. **Confirm handler:** replace the fire-and-close handler with a keep-open async that closes only on success:

```ts
async function CONFIRM_FN(): Promise<void> {
  const p = PENDING // for object-pending; omit for boolean-pending
  if (p === null || BUSY) return // boolean form: `if (!PENDING || BUSY) return`
  CONFIRM_ERROR = null
  BUSY = true
  let ok = false
  try {
    await ACTION_FETCHER(/* args from p */)
    ok = true
  } catch (err) {
    CONFIRM_ERROR = err instanceof Error ? err.message : String(err)
  } finally {
    BUSY = false
  }
  if (ok) {
    PENDING = null // boolean form: `PENDING = false`
    await RELOAD()
  }
}
```

4. **Dialog wiring:** `onConfirm={() => void CONFIRM_FN()}` and add `busy={BUSY}` to `<Confirm>`. (Do NOT set `PENDING` in `onConfirm` anymore.)
5. **Body:** inside the `{#snippet body()}`, after the existing text, add:

```svelte
{#if CONFIRM_ERROR !== null}<p class="status-error">{CONFIRM_ERROR}</p>{/if}
```

Notes: `Confirm` already no-ops backdrop/Escape/× close while `busy`, so no extra cancel-guard is needed. Keep any `status`/success message the old action set — set it in the `if (ok)` block. If the old action function is now only called from the dialog, replace it in place; if it's shared, keep it and add the keep-open wrapper.

**Guard note (settled in B1 review):** the confirm handler's entry guard should be just `BUSY` (plus any existing context/staleness check like `loadedContextId !== contextId`). Do NOT re-add a broad `loading || saving` guard — it's unnecessary because (a) the trigger button that opens the dialog is already `disabled` during in-flight ops, and (b) the `Confirm` modal is a full-viewport overlay that blocks all background interaction while open, so no new operation can start behind it. This matches MembersSection. BUT: **preserve whatever staleness/context guard the section's original action already had** (e.g. `loadedContextId !== contextId`) — don't drop those.

### Task B1 (reference): CodeHostSection — full worked example

**Files:** Modify `client/settings/sections/CodeHostSection.svelte`; Test `tests/client/settings/code-host-section.test.ts`

CodeHostSection already has `pendingClear` and an unused-for-dialog `clearing` flag and `clearAll()`. Apply the recipe with `PENDING=pendingClear` (boolean), `BUSY=clearing` (reuse), `CONFIRM_ERROR=clearError` (new), `ACTION_FETCHER=clearCodingCredentials({ contextId, namespace: 'forge' })`, `RELOAD=load(contextId)`.

- [ ] **Step 1: Failing test** — add to `tests/client/settings/code-host-section.test.ts`, following that file's existing mock style (module-level branching mock that returns 500 for the clear DELETE/POST, success for GET). Assert: after opening the clear dialog and clicking the danger confirm, the dialog (`.modal`) stays open and a `.modal .status-error` is present.

```ts
test('a failed clear keeps the confirm dialog open with an inline error', async () => {
  setCsrfToken('c')
  setMockFetch(clearErrorMock) // module-level: clear request -> 500, GET -> valid creds payload
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(CodeHostSection, { target, props: { contextId: 'ctx-1' } })
  await drain()
  target.querySelector<HTMLButtonElement>('[data-testid="code-host-clear"]')!.click()
  await drain()
  target.querySelector<HTMLButtonElement>('.modal .ui-btn--danger')!.click()
  await drain()
  expect(document.querySelector('.modal')).not.toBeNull()
  expect(document.querySelector('.modal .status-error')).not.toBeNull()
  void unmount(component)
})
```

(Define `clearErrorMock` at module scope near the file's other mocks; wire the exact clear endpoint the section calls. If the test file lacks a mount harness, mirror `MembersSection.test.ts`.)

- [ ] **Step 2: Run → fails** (`bun run test:client`): today the dialog closes on confirm and the error lands at section top, so `.modal`/`.modal .status-error` are absent.

- [ ] **Step 3: Implement.** In `CodeHostSection.svelte`:

Add `let clearError = $state<string | null>(null)` next to `pendingClear`/`clearing`. Where the "Clear" button opens the dialog (`onClick={() => (pendingClear = true)}`), also clear the error — change it to `onClick={() => { pendingClear = true; clearError = null }}`.

Replace the confirm wiring:

```svelte
  <Confirm
    open={pendingClear}
    title="Clear code host credentials"
    danger
    busy={clearing}
    confirmLabel="Clear"
    onCancel={() => (pendingClear = false)}
    onConfirm={() => void confirmClear()}>
    {#snippet body()}
      <p>Remove the stored code host connection and token for this context? This cannot be undone.</p>
      {#if clearError !== null}<p class="status-error">{clearError}</p>{/if}
    {/snippet}
  </Confirm>
```

Replace `clearAll()` with the keep-open `confirmClear()`:

```ts
async function confirmClear(): Promise<void> {
  if (clearing || loadedContextId !== contextId) return
  clearError = null
  status = null
  clearing = true
  let ok = false
  try {
    await clearCodingCredentials({ contextId, namespace: 'forge' })
    ok = true
  } catch (err) {
    clearError = err instanceof Error ? err.message : String(err)
  } finally {
    clearing = false
  }
  if (ok) {
    pendingClear = false
    status = 'Code host credentials cleared.'
    await load(contextId)
  }
}
```

(If `clearAll` is referenced anywhere else, keep it; grep first — per the survey it is only the dialog target, so replace it.)

- [ ] **Step 4: Run → passes** (`bun run test:client`); `bun run typecheck` + `bun run lint` clean.
- [ ] **Step 5: Commit**

```bash
bun run format
git add client/settings/sections/CodeHostSection.svelte tests/client/settings/code-host-section.test.ts
git commit -m "fix(settings): keep CodeHost clear dialog open with inline error"
```

### Tasks B2–B13: apply the recipe per file

Each task = apply "The recipe" above with the file's parameters, add the analogous "failure keeps dialog open" test **where the section has a test file** (reuse its mock harness; assert `.modal` + `.modal .status-error` after confirming a failing action), run `bun run test:client`/`typecheck`/`lint`, and commit `fix(settings): keep <X> confirm dialog open with inline error`. Where a section has **no** test file, skip the new test but confirm the full client suite stays green. Phase 1 = settings sections; Phase 2 = admin.

| Task | File                                                            | PENDING (open state)                                | BUSY flag                                                                 | ACTION_FETCHER                                                                                  | RELOAD              | Notes                                                                   |
| ---- | --------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------- |
| B2   | `settings/sections/PluginsSection.svelte`                       | `pendingClearKey: {pluginId,key,required}\|null`    | add `clearingKey`                                                         | `unsetPluginConfig(...)` via `clearPluginConfig(p.pluginId, p.key)`                             | its `load`          | object-pending; inline confirm arrow today                              |
| B3   | `settings/sections/MemorySection.svelte`                        | `pendingClear: boolean`                             | reuse `mutating` if dialog-exclusive, else add `clearing`                 | `clearMemory({ contextId })` via `clearRecords()`                                               | its `load`          | boolean-pending                                                         |
| B4   | `settings/sections/CodingCredentialsSection.svelte`             | `pendingClear: boolean`                             | reuse existing `clearing`                                                 | `clearCodingCredentials({ contextId })` via `clearAll()`                                        | `load(contextId)`   | mirror B1 exactly                                                       |
| B5   | `settings/sections/admin/AdminInstancesSection.svelte` (delete) | `pendingDelete: {kind,id}\|null`                    | add `deleting`                                                            | `deleteAdminPlatformInstance(id)` / `deleteAdminTaskInstance(id)`                               | `load()`            | `confirmDelete()` already async — restructure to keep-open              |
| B6   | `settings/sections/admin/AdminInstancesSection.svelte` (stop)   | `pendingStop: {kind,row}\|null`                     | add `stopping`                                                            | `toggleStatus(row)` / `toggleTaskStatus(row)`                                                   | `load()`            | second `<Confirm>` in same file — separate flags from B5                |
| B7   | `settings/sections/admin/AdminAdminsSection.svelte`             | `pendingRemoval: {userId,platformInstanceId}\|null` | add `removing`                                                            | `removeRosterAdmin(...)` via `remove(row)`                                                      | its `load`          | object-pending                                                          |
| B8   | `settings/sections/admin/AdminUsersSection.svelte`              | `pendingRemoval: string\|null`                      | add `removing`                                                            | `removeAdminUser({ userId })` via `remove(id)`                                                  | its `load`          | string-pending                                                          |
| B9   | `settings/sections/admin/AdminGroupsSection.svelte`             | `pendingRemoval: string\|null`                      | add `removing`                                                            | `removeAdminGroup({ groupId })` via `remove(id)`                                                | its `load`          | string-pending                                                          |
| B10  | `settings/sections/admin/AdminPluginsConfigSection.svelte`      | `pendingClear: {pluginId,key,required}\|null`       | add `clearing`                                                            | `unsetAdminPluginConfig({ pluginId, key })` via `clearConfig(...)`                              | its `load`          | object-pending                                                          |
| B11  | `settings/sections/admin/AdminPluginsApprovalSection.svelte`    | `pendingReject: string\|null`                       | add `rejecting`                                                           | `setPluginApproval({ pluginId, action: 'reject' })` via `confirmReject()`/`decide(id,'reject')` | its `load`          | already async — restructure to keep-open                                |
| B12  | `settings/sections/admin/AdminAnnounceSection.svelte`           | `confirming: boolean`                               | reuse existing `sending`                                                  | `sendAnnounce({ message })` via `send()`                                                        | n/a (sets `result`) | high-impact send, not delete — pattern still fits; keep `danger` if set |
| B13  | `settings/sections/admin/AdminReleaseNotesSection.svelte`       | `confirming: boolean`                               | add `broadcasting` (do NOT reuse the generic `busy` var — name collision) | `broadcastReleaseNotes()` (+ optional body save) via `confirmedBroadcast()`                     | its `load`          | high-impact send; keep the existing save-then-broadcast order           |

Per-task checklist (identical shape):

- [ ] Apply the recipe (state + open-clear + keep-open confirm fn + `busy=` + inline-error body).
- [ ] Add the failure-keeps-open test if a test file exists; else verify suite green.
- [ ] `bun run test:client` + `bun run typecheck` + `bun run lint` clean; commit.

---

## Final verification

- [ ] `bun run check:full` → 12/12 checks pass.
- [ ] Spot-check consistency: every `<Confirm>` under `client/settings/**` and `client/admin/**` now passes `busy` and renders a dialog-scoped error on failure (grep `busy=` near each `<Confirm>`), matching `MembersSection`.

## Scope / sequencing notes

- **Item A is independent** and can ship first (1 commit).
- **Item B is 13 near-identical changes**; each file is independent — safe to do in any order and to stop after any file. Suggested order: reference (B1) → settings (B2–B4) → admin (B5–B13).
- **Not in scope:** changing which actions are gated by a confirm, adding new confirmations, or altering the copy of any dialog. This is a behavior-consistency pass only.
