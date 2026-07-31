<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Coding Credentials Clear/Reset UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Clear" control to the settings-UI "Coding sessions – AI provider" and "Coding sessions – Code host" sections so end users can reset/remove their stored credentials in Personal and Group contexts, mirroring the admin operator "Clear" for the shared key.

**Architecture:** The backend already supports clearing end-to-end: `PATCH /settings/api/coding-credentials` accepts `{ clear: true, contextId?, namespace? }`, scope-checked via `resolveContextScope(principal, 'write', contextId)` and CSRF-protected, calling `clearCodingCredentials(contextId, namespace, updatedBy)` (a real SQL `DELETE` keyed by `(contextId, namespace)`). This route branch is already covered by `tests/debug/settings/coding-credentials-routes.test.ts`. The only gap is client wiring: no fetcher and no button. We add one fetcher and a confirm-guarded Clear button to each of the two sections. No store or HTTP-route changes.

**Tech Stack:** Svelte 5 (runes: `$state`/`$derived`/`$effect`), TypeScript (`.js` import extensions), Bun test runner (`bun:test`), the shared `Confirm.svelte` + `Modal.svelte` dialog, `writeJson` fetch helper (auto-attaches CSRF).

---

## File Structure

- **Modify** `client/settings/fetchers.ts` — add `clearCodingCredentials({ contextId, namespace? })` fetcher next to `patchCodingCredentials` (~line 157). One responsibility: issue the `{ clear: true }` PATCH.
- **Modify** `tests/client/settings/coding-credentials-fetchers.test.ts` — add two tests for the new fetcher (agent-provider default + forge namespace). This is where `patchCodingCredentials`/`fetchCodingCredentials` are already tested.
- **Modify** `client/settings/sections/CodingCredentialsSection.svelte` — import `clearCodingCredentials` + `Confirm`; add `pendingClear`/`clearing` state, a `clearAll()` handler, a "Clear" button (shown only when `currentData.configured`), and a `<Confirm>` dialog.
- **Modify** `client/settings/sections/CodeHostSection.svelte` — same additions, passing `namespace: 'forge'`.

No server, store, schema, or migration changes. `.svelte` files are outside the TDD write-hook scope (`.ts/.js/.tsx/.jsx` only); `client/settings/fetchers.ts` is in scope, so its test is written first (Red → Green).

---

### Task 1: Add the `clearCodingCredentials` client fetcher (TDD)

**Files:**

- Modify: `client/settings/fetchers.ts` (after `patchCodingCredentials`, ~line 157)
- Test: `tests/client/settings/coding-credentials-fetchers.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these two tests inside the existing `describe('coding credentials fetchers', …)` block in `tests/client/settings/coding-credentials-fetchers.test.ts`, and add `clearCodingCredentials` to the import on line 8 (`import { clearCodingCredentials, fetchCodingCredentials, patchCodingCredentials, setCsrfToken } from '../../../client/settings/fetchers.js'`):

```typescript
test('clearCodingCredentials PATCHes clear:true for the default namespace', async () => {
  installFetch({ ok: true })
  await clearCodingCredentials({ contextId: 'pi:telegram:ctx:u1' })
  expect(methodOf(captured[0]!.init)).toBe('PATCH')
  expect(captured[0]?.url).toBe('/settings/api/coding-credentials')
  expect(parseBody(captured[0]?.init.body)).toEqual({ contextId: 'pi:telegram:ctx:u1', clear: true })
})

test('clearCodingCredentials includes namespace for forge', async () => {
  installFetch({ ok: true })
  await clearCodingCredentials({ contextId: 'pi:telegram:ctx:u1', namespace: 'forge' })
  expect(parseBody(lastRequest().init.body)).toEqual({
    contextId: 'pi:telegram:ctx:u1',
    namespace: 'forge',
    clear: true,
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test:client tests/client/settings/coding-credentials-fetchers.test.ts`
Expected: FAIL — `clearCodingCredentials` is not exported (import/reference error).

- [ ] **Step 3: Implement the fetcher**

In `client/settings/fetchers.ts`, immediately after the `patchCodingCredentials` export (ends ~line 157), add:

```typescript
export const clearCodingCredentials = (input: { contextId: string; namespace?: string }): Promise<unknown> =>
  writeJson('/settings/api/coding-credentials', 'PATCH', { ...input, clear: true }, (b) => b)
```

(Uses the same `writeJson` helper as `patchCodingCredentials`, so CSRF is attached automatically. `JSON.stringify` omits an `undefined` `namespace`, so the default-namespace body is `{ contextId, clear: true }` — matching the route's strict `ClearBodySchema`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test:client tests/client/settings/coding-credentials-fetchers.test.ts`
Expected: PASS (all tests, including the two new ones).

- [ ] **Step 5: Commit**

```bash
git add client/settings/fetchers.ts tests/client/settings/coding-credentials-fetchers.test.ts
git commit -m "feat(settings): add clearCodingCredentials fetcher"
```

---

### Task 2: Add confirm-guarded Clear button to the AI provider section

**Files:**

- Modify: `client/settings/sections/CodingCredentialsSection.svelte`

- [ ] **Step 1: Import the fetcher and Confirm dialog**

Change the fetchers import (line 16) to include `clearCodingCredentials`:

```svelte
  import { clearCodingCredentials, fetchCodingCredentials, fetchCodingModels, patchCodingCredentials } from '../fetchers.js'
```

Add a `Confirm` import next to the other shared-UI imports (after the `Btn` import, line 9):

```svelte
  import Confirm from '../../shared/Confirm.svelte'
```

- [ ] **Step 2: Add clear state and handler**

After the `saveAll()` function (ends line 174), add:

```svelte
  let pendingClear = $state(false)
  let clearing = $state(false)

  async function clearAll(): Promise<void> {
    if (loading || saving || clearing || loadedContextId !== contextId) return
    error = null
    status = null
    clearing = true
    try {
      await clearCodingCredentials({ contextId })
      await load(contextId)
      status = 'AI provider credentials cleared.'
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      clearing = false
    }
  }
```

- [ ] **Step 3: Add the Clear button next to Save**

Replace the actions block (lines 310–319) with:

```svelte
      <div class="settings-field__actions">
        {#if currentData.configured}
          <Btn
            variant="ghost"
            size="sm"
            testid="coding-credentials-clear"
            disabled={saving || loading || clearing}
            onClick={() => (pendingClear = true)}>
            {#snippet children()}{clearing ? 'Clearing…' : 'Clear'}{/snippet}
          </Btn>
        {/if}
        <Btn
          variant="primary"
          size="sm"
          testid="coding-credentials-save"
          disabled={saving || loading || clearing}
          onClick={() => void saveAll()}>
          {#snippet children()}{saving ? 'Saving…' : 'Save'}{/snippet}
        </Btn>
      </div>
```

- [ ] **Step 4: Add the Confirm dialog before `</section>`**

Immediately before the closing `</section>` tag (line 322), add:

```svelte
  <Confirm
    open={pendingClear}
    title="Clear AI provider credentials"
    danger
    confirmLabel="Clear"
    onCancel={() => (pendingClear = false)}
    onConfirm={() => { pendingClear = false; void clearAll() }}>
    {#snippet body()}<p>Remove the stored AI provider key, agent, and model for this context? This cannot be undone.</p>{/snippet}
  </Confirm>
```

- [ ] **Step 5: Verify it typechecks and builds**

Run: `bun typecheck && bun build:client`
Expected: PASS (no type errors; client bundles).

- [ ] **Step 6: Commit**

```bash
git add client/settings/sections/CodingCredentialsSection.svelte
git commit -m "feat(settings): add Clear button to AI provider coding credentials"
```

---

### Task 3: Add confirm-guarded Clear button to the Code host section

**Files:**

- Modify: `client/settings/sections/CodeHostSection.svelte`

- [ ] **Step 1: Import the fetcher and Confirm dialog**

Change the fetchers import (line 16) to include `clearCodingCredentials`:

```svelte
  import { clearCodingCredentials, fetchCodingCredentials, patchCodingCredentials } from '../fetchers.js'
```

Add a `Confirm` import after the `Btn` import (line 9):

```svelte
  import Confirm from '../../shared/Confirm.svelte'
```

- [ ] **Step 2: Add clear state and handler**

After the `saveAll()` function (ends line 127), add:

```svelte
  let pendingClear = $state(false)
  let clearing = $state(false)

  async function clearAll(): Promise<void> {
    if (loading || saving || clearing || loadedContextId !== contextId) return
    error = null
    status = null
    clearing = true
    try {
      await clearCodingCredentials({ contextId, namespace: 'forge' })
      await load(contextId)
      status = 'Code host credentials cleared.'
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      clearing = false
    }
  }
```

- [ ] **Step 3: Add the Clear button next to Save**

Replace the actions block (lines 207–216) with:

```svelte
      <div class="settings-field__actions">
        {#if currentData.configured}
          <Btn
            variant="ghost"
            size="sm"
            testid="code-host-clear"
            disabled={saving || loading || clearing}
            onClick={() => (pendingClear = true)}>
            {#snippet children()}{clearing ? 'Clearing…' : 'Clear'}{/snippet}
          </Btn>
        {/if}
        <Btn
          variant="primary"
          size="sm"
          testid="code-host-save"
          disabled={saving || loading || clearing}
          onClick={() => void saveAll()}>
          {#snippet children()}{saving ? 'Saving…' : 'Save'}{/snippet}
        </Btn>
      </div>
```

- [ ] **Step 4: Add the Confirm dialog before `</section>`**

Immediately before the closing `</section>` tag (line 219), add:

```svelte
  <Confirm
    open={pendingClear}
    title="Clear code host credentials"
    danger
    confirmLabel="Clear"
    onCancel={() => (pendingClear = false)}
    onConfirm={() => { pendingClear = false; void clearAll() }}>
    {#snippet body()}<p>Remove the stored code host connection and token for this context? This cannot be undone.</p>{/snippet}
  </Confirm>
```

- [ ] **Step 5: Verify it typechecks and builds**

Run: `bun typecheck && bun build:client`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/settings/sections/CodeHostSection.svelte
git commit -m "feat(settings): add Clear button to code host credentials"
```

---

### Task 4: Full verification

- [ ] **Step 1: Run the client suite**

Run: `bun test:client tests/client/settings/coding-credentials-fetchers.test.ts`
Expected: PASS.

- [ ] **Step 2: Run the server route suite (regression — confirms the backend clear contract is unchanged)**

Run: `bun run test tests/debug/settings/coding-credentials-routes.test.ts`
Expected: PASS (including "PATCH with clear:true removes credentials").

- [ ] **Step 3: Typecheck + lint + build**

Run: `bun typecheck && bun lint && bun build:client`
Expected: PASS.

- [ ] **Step 4: (Manual/visual, optional) Regenerate Storybook screenshots**

The existing `Populated` stories render `configured: true`, so they now display the Clear button. If the visual harness is available, regenerate the section screenshots so the baselines include the new control; otherwise note it for a follow-up. The `Empty` stories (`configured: false`) must NOT show the Clear button — a useful assertion of the `{#if currentData.configured}` guard.

---

## Notes / Decisions

- **No `DELETE` route added.** The route already implements clear inside `PATCH` (`{ clear: true }`) and is tested; adding a `DELETE` method would only duplicate that. Reusing PATCH keeps us on the covered path.
- **Confirmation is required** (unlike the admin ghost "Clear", which is operator-only). This deletes an end user's own working credentials, so both sections gate the action behind the shared `Confirm` dialog with `danger` styling.
- **Button visibility** is gated on `currentData.configured` so the Clear button only appears when something is actually stored.
- **Permission safety is server-enforced.** The fetcher targets the same route the save uses; `resolveContextScope(principal, 'write', contextId)` already 403s a group-context clear for users without write scope — no new client-side permission logic.
