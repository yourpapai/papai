<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# BYOK Self-Serve Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any personal or group context owner enable BYOK LLM credentials themselves, removing the bot-admin enable/disable gate.

**Architecture:** Move the enable/disable capability from the bot-admin route to the existing user route `PATCH /settings/api/byok` as a discriminated "toggle" action, authorized by the already-present `resolveContextScope(...,'write',...)` (DM owner for personal, group admins for groups). The resolver and storage layer are unchanged — the `enabled` flag stays as the toggle's backing store. The admin section becomes a read-only audit overview.

**Tech Stack:** Bun + `bun:test`, Zod v4, Svelte 5 (runes), settings SPA with happy-dom client tests.

**Spec:** `docs/superpowers/specs/2026-06-24-byok-self-serve-design.md`

---

## File Structure

| File                                                     | Responsibility    | Change                                                     |
| -------------------------------------------------------- | ----------------- | ---------------------------------------------------------- |
| `src/debug/settings/byok-routes.ts`                      | User BYOK route   | Add discriminated `action: enable/disable` toggle to PATCH |
| `src/debug/settings/admin/byok-routes.ts`                | Admin BYOK route  | Remove PATCH (→ 405); keep GET                             |
| `client/settings/fetchers.ts`                            | User fetchers     | Add `toggleByok`                                           |
| `client/settings/sections/ByokSection.svelte`            | User BYOK UI      | Toggle + conditional field editor                          |
| `client/settings/sections/admin/AdminByokSection.svelte` | Admin BYOK UI     | Remove toggle column; read-only                            |
| `tests/debug/settings/byok-routes.test.ts`               | User route tests  | Add toggle auth/behavior cases                             |
| `tests/debug/settings/admin/byok-routes.test.ts`         | Admin route tests | Replace enable/disable with 405                            |
| `tests/client/settings/byok-fetchers.test.ts`            | Fetcher tests     | Add `toggleByok` case                                      |
| `tests/client/settings/byok-section.test.ts`             | User UI tests     | Toggle reveals/hides fields                                |
| `tests/client/settings/admin-byok-section.test.ts`       | Admin UI tests    | No toggle button                                           |

**Untouched:** `src/byok-llm/store.ts`, `src/byok-llm/types.ts`, `src/llm-config-resolver.ts`, `src/db/byok-llm-schema.ts`.

---

## Task 1: Add the toggle action to the user BYOK route

**Files:**

- Modify: `src/debug/settings/byok-routes.ts`
- Test: `tests/debug/settings/byok-routes.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these tests inside the `describe('settings BYOK routes', ...)` block in `tests/debug/settings/byok-routes.test.ts`. They reuse the existing `session`/`personalConfigContextId` from `beforeEach`. Add the group-seeding helper and imports at the top of the file as shown.

Add to the imports at the top of the file:

```typescript
import { getByokCredentialState } from '../../../src/byok-llm/store.js'
import { upsertKnownGroupContext, upsertGroupAdminObservation } from '../../../src/group-settings/registry.js'
```

(Note: `enableByokForContext`, `getByokLlmConfig`, `updateByokLlmConfig` are already imported; `addAuthorizedGroup`, `upsertGroupAdminObservation`, `upsertKnownGroupContext`, `toScopedContextId` may already be imported — do not duplicate. Add only the names not already present.)

Add the tests:

```typescript
test('PATCH action:enable turns BYOK on for the owner personal context', async () => {
  const url = new URL('https://x/settings/api/byok')
  const res = await handleByokRoutes(
    new Request(url, {
      method: 'PATCH',
      headers: {
        ...authHeaders(session, true),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'enable' }),
    }),
    url,
  )
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({
    ok: true,
    contextId: personalConfigContextId,
    enabled: true,
  })
  expect(getByokCredentialState(personalConfigContextId).enabled).toBe(true)
})

test('PATCH action:disable turns BYOK off for the owner personal context', async () => {
  enableByokForContext(personalConfigContextId, 'admin')
  const url = new URL('https://x/settings/api/byok')
  const res = await handleByokRoutes(
    new Request(url, {
      method: 'PATCH',
      headers: {
        ...authHeaders(session, true),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'disable' }),
    }),
    url,
  )
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({
    ok: true,
    contextId: personalConfigContextId,
    enabled: false,
  })
  expect(getByokCredentialState(personalConfigContextId).enabled).toBe(false)
})

test('PATCH action:enable for a group the principal manages turns BYOK on', async () => {
  const scopedGroupId = toScopedContextId({
    platformInstanceId: 'pi-1',
    nativeContextId: 'grp-1',
  })
  upsertKnownGroupContext({
    contextId: scopedGroupId,
    provider: 'telegram',
    displayName: 'Test Group',
    parentName: null,
  })
  upsertGroupAdminObservation({
    contextId: scopedGroupId,
    provider: 'telegram',
    userId: 'u-1',
    username: 'u-1',
    isAdmin: true,
  })
  addAuthorizedGroup(scopedGroupId, 'u-1')

  const url = new URL('https://x/settings/api/byok')
  const res = await handleByokRoutes(
    new Request(url, {
      method: 'PATCH',
      headers: {
        ...authHeaders(session, true),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'enable', contextId: scopedGroupId }),
    }),
    url,
  )
  expect(res.status).toBe(200)
})

test('PATCH action:enable for a group the principal cannot manage → 403', async () => {
  const url = new URL('https://x/settings/api/byok')
  const res = await handleByokRoutes(
    new Request(url, {
      method: 'PATCH',
      headers: {
        ...authHeaders(session, true),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'enable',
        contextId: 'unmanaged-context',
      }),
    }),
    url,
  )
  expect(res.status).toBe(403)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/debug/settings/byok-routes.test.ts`
Expected: the four new tests FAIL — `action:enable`/`disable` currently fall into the field-save branch (no `values`), so the body fails schema validation → `422`, not `200`/`403`.

- [ ] **Step 3: Implement the toggle branch**

In `src/debug/settings/byok-routes.ts`, update the store import to add the enable/disable functions:

```typescript
import {
  disableByokForContext,
  enableByokForContext,
  getByokCredentialState,
  getByokLlmConfig,
  updateByokLlmConfig,
} from '../../byok-llm/store.js'
```

Replace the `PatchBodySchema` definition (currently a single `z.object({ contextId, values })`) with a discriminated union of toggle vs save:

```typescript
const ToggleBodySchema = z.object({
  contextId: z.string().optional(),
  action: z.enum(['enable', 'disable']),
})
const SaveBodySchema = z.object({
  contextId: z.string().optional(),
  values: z.record(z.string(), z.string()),
})
const PatchBodySchema = z.union([ToggleBodySchema, SaveBodySchema])
```

In `handleByokRoutes`, inside the `req.method === 'PATCH'` block, after the `scope` is resolved and before the `getByokCredentialState`/`updateByokLlmConfig` save logic, add the toggle branch:

```typescript
if ('action' in body.data) {
  const enabled = body.data.action === 'enable'
  if (enabled) {
    enableByokForContext(scope.scope.contextId, auth.authed.principal.platformUserId)
  } else {
    disableByokForContext(scope.scope.contextId, auth.authed.principal.platformUserId)
  }
  return settingsJson(200, {
    ok: true,
    contextId: scope.scope.contextId,
    enabled,
  })
}
```

The existing save logic (the `getByokCredentialState` check that 403s when `!enabled`, then `updateByokLlmConfig`) stays exactly as-is below this branch — it now only runs for the `values` shape.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/debug/settings/byok-routes.test.ts`
Expected: PASS — all new tests green, and the existing `PATCH rejects credential update before admin enablement` test (save mode with no `enabled`) still returns `403`.

- [ ] **Step 5: Commit**

```bash
git add src/debug/settings/byok-routes.ts tests/debug/settings/byok-routes.test.ts
git commit -m "feat(byok): self-serve enable/disable toggle on user route"
```

---

## Task 2: Make the admin BYOK route read-only (PATCH → 405)

**Files:**

- Modify: `src/debug/settings/admin/byok-routes.ts`
- Test: `tests/debug/settings/admin/byok-routes.test.ts`

- [ ] **Step 1: Update the tests to expect read-only behavior**

In `tests/debug/settings/admin/byok-routes.test.ts`:

Delete these four tests entirely (they assert the removed PATCH enable/disable behavior): `admin can enable BYOK for a context`, `admin can disable BYOK for a context`, `non-admin cannot enable BYOK`, `PATCH rejects invalid body with 422`.

Delete the now-unused `getByokCredentialState` from the import on line 10 (keep `getByokLlmConfig`, `updateByokLlmConfig`), and delete the `PatchResponseSchema` constant (line 30).

Replace the deleted tests with a single new test asserting PATCH is rejected:

```typescript
test('PATCH is not allowed on the admin route', async () => {
  const url = new URL('https://x/settings/api/admin/byok')
  const res = await handleAdminByokRoutes(
    new Request(url, {
      method: 'PATCH',
      headers: {
        ...authHeaders(adminSession, true),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ contextId: 'ctx-1', enabled: true }),
    }),
    url,
  )
  expect(res.status).toBe(405)
})
```

Keep unchanged: `non-admin cannot read BYOK summaries`, `GET returns summary array without secrets`, `PATCH rejects invalid JSON with 400` — wait, the `400` test exercises the removed PATCH JSON-parse path; **delete `PATCH rejects invalid JSON with 400` as well** (PATCH no longer parses a body). Keep `unsupported method returns 405`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/debug/settings/admin/byok-routes.test.ts`
Expected: FAIL — `PATCH is not allowed` currently returns `200` (the route still handles PATCH).

- [ ] **Step 3: Remove the PATCH branch from the admin route**

Replace the body of `src/debug/settings/admin/byok-routes.ts` so PATCH is no longer handled. The full new file:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { listByokAdminSummaries } from '../../../byok-llm/store.js'
import { authenticate, settingsJson } from '../respond.js'
import { requireAdmin } from './admin-guard.js'

export async function handleAdminByokRoutes(req: Request, _url: URL): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return auth.response

  if (req.method === 'GET') {
    const guard = requireAdmin(auth.authed, 'read')
    if (guard !== null) return guard
    return settingsJson(200, { contexts: listByokAdminSummaries() })
  }

  return settingsJson(405, { error: 'method not allowed' })
}
```

This drops the `z`, `parseJsonBody`, `requireCsrf`, `disableByokForContext`, `enableByokForContext` imports and the `PatchBodySchema`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/debug/settings/admin/byok-routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/debug/settings/admin/byok-routes.ts tests/debug/settings/admin/byok-routes.test.ts
git commit -m "refactor(byok): make admin BYOK route read-only"
```

---

## Task 3: Add the `toggleByok` client fetcher

**Files:**

- Modify: `client/settings/fetchers.ts`
- Test: `tests/client/settings/byok-fetchers.test.ts`

- [ ] **Step 1: Write the failing test**

Add `toggleByok` to the import in `tests/client/settings/byok-fetchers.test.ts`:

```typescript
import { fetchByok, patchByok, setCsrfToken, toggleByok } from '../../../client/settings/fetchers.js'
```

Add this test inside `describe('BYOK fetchers', ...)`:

```typescript
test('toggleByok PATCHes an enable action as JSON', async () => {
  installFetch({ ok: true, contextId: 'ctx-1', enabled: true })

  await toggleByok({ contextId: 'ctx-1', enabled: true })

  expect(methodOf(captured[0]!.init)).toBe('PATCH')
  expect(captured[0]?.url).toBe('/settings/api/byok')
  expect(parseBody(captured[0]?.init.body)).toEqual({
    contextId: 'ctx-1',
    action: 'enable',
  })
})

test('toggleByok PATCHes a disable action as JSON', async () => {
  installFetch({ ok: true, contextId: 'ctx-1', enabled: false })

  await toggleByok({ contextId: 'ctx-1', enabled: false })

  expect(parseBody(captured[0]?.init.body)).toEqual({
    contextId: 'ctx-1',
    action: 'disable',
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/client/settings/byok-fetchers.test.ts`
Expected: FAIL — `toggleByok` is not exported (`undefined is not a function`).

- [ ] **Step 3: Implement the fetcher**

In `client/settings/fetchers.ts`, in the `// --- BYOK ---` block (right after `patchByok`), add:

```typescript
export const toggleByok = (input: { contextId: string; enabled: boolean }): Promise<unknown> =>
  writeJson(
    '/settings/api/byok',
    'PATCH',
    {
      contextId: input.contextId,
      action: input.enabled ? 'enable' : 'disable',
    },
    (b) => b,
  )
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/client/settings/byok-fetchers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/settings/fetchers.ts tests/client/settings/byok-fetchers.test.ts
git commit -m "feat(byok): add toggleByok client fetcher"
```

---

## Task 4: Add the self-serve toggle to the user BYOK section

**Files:**

- Modify: `client/settings/sections/ByokSection.svelte`
- Test: `tests/client/settings/byok-section.test.ts`

- [ ] **Step 1: Update the failing tests**

In `tests/client/settings/byok-section.test.ts`, replace the `shows a disabled placeholder when BYOK is not enabled` test with a toggle-aware version, and add a toggle-issues-request test. The `disabledPayload`/`enabledPayload`/`routeByokMock`/`capturedPatchBody` helpers already exist in this file.

Replace the existing test:

```typescript
test('shows a disabled state with no field editor and an enable toggle', async () => {
  setMockFetch(() => Promise.resolve(json(disabledPayload)))
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(ByokSection, {
    target,
    props: { contextId: 'user:1' },
  })

  await drain()

  expect(target.querySelector('#byok')).not.toBeNull()
  expect(target.querySelector('[data-testid="byok-toggle"]')).not.toBeNull()
  expect(target.querySelector('[data-testid="byok-input-llm_apikey"]')).toBeNull()
  expect(target.textContent).toContain('central')
  void unmount(component)
})
```

Add this test (uses `routeByokMock` + `capturedPatchBody` already defined in the file):

```typescript
test('enabling the toggle PATCHes an enable action', async () => {
  setCsrfToken('c')
  let payload: unknown = disabledPayload
  setMockFetch((url, init) => {
    if (url.includes('/settings/api/byok') && (init?.method ?? 'GET') === 'PATCH') {
      capturedPatchBody = typeof init?.body === 'string' ? init.body : ''
      payload = enabledPayload
      return Promise.resolve(json({ ok: true, contextId: 'user:1', enabled: true }))
    }
    return Promise.resolve(json(payload))
  })
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(ByokSection, {
    target,
    props: { contextId: 'user:1' },
  })

  await drain()
  target.querySelector<HTMLButtonElement>('[data-testid="byok-toggle"]')!.click()
  await drain()

  expect(capturedPatchBody).toBe(JSON.stringify({ contextId: 'user:1', action: 'enable' }))
  expect(target.querySelector('[data-testid="byok-input-llm_apikey"]')).not.toBeNull()
  void unmount(component)
})
```

Confirm the file already declares `let capturedPatchBody = ''` near the top (it is referenced by `routeByokMock`). If not present in scope for these tests, add `let capturedPatchBody = ''` at module scope and reset it in the existing `afterEach`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/client/settings/byok-section.test.ts`
Expected: FAIL — no `byok-toggle` element exists yet; the section still renders the old "BYOK is not enabled" placeholder.

- [ ] **Step 3: Add the toggle to the component**

In `client/settings/sections/ByokSection.svelte`:

Add `toggleByok` to the fetchers import:

```typescript
import { fetchByok, patchByok, toggleByok } from '../fetchers.js'
```

Add toggle state next to the other `$state` declarations (e.g. after `let savingKey`):

```typescript
let toggling: boolean = $state(false)
```

Add the toggle handler (place it after the `save` function):

```typescript
async function setEnabled(next: boolean): Promise<void> {
  if (loading || toggling) return
  error = null
  status = null
  toggling = true
  try {
    await toggleByok({ contextId, enabled: next })
    await load(contextId)
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
  } finally {
    toggling = false
  }
}
```

In the `PageHeader` `action` snippet, add the toggle button before the existing Refresh `IconButton` (the `Btn` component is already imported):

```svelte
    {#snippet action()}
      {#if currentData !== null}
        <Btn
          variant={currentData.enabled ? 'outline' : 'primary'}
          size="sm"
          testid="byok-toggle"
          disabled={loading || toggling}
          onClick={() => void setEnabled(!currentData.enabled)}>
          {#snippet children()}{currentData.enabled ? 'Use central credentials' : 'Use my own credentials'}{/snippet}
        </Btn>
      {/if}
      <IconButton label="Refresh" glyph="⟳" busy={loading} onClick={() => void load(contextId)} testid="byok-refresh" />
    {/snippet}
```

Replace the disabled-state placeholder branch:

```svelte
  {:else if currentData !== null && !currentData.enabled}
    <p class="placeholder">
      Using the central LLM credentials. Turn on “Use my own credentials” to configure BYOK for this context.
    </p>
```

(The rest of the template — the enabled branch with `settings-byok-fields` — is unchanged.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/client/settings/byok-section.test.ts`
Expected: PASS — both new tests green; the existing enabled-field tests still pass (they serve `enabledPayload`/`rawSecretPayload` with `enabled: true`).

- [ ] **Step 5: Commit**

```bash
git add client/settings/sections/ByokSection.svelte tests/client/settings/byok-section.test.ts
git commit -m "feat(byok): self-serve toggle in user BYOK section"
```

---

## Task 5: Make the admin BYOK section read-only

**Files:**

- Modify: `client/settings/sections/admin/AdminByokSection.svelte`
- Test: `tests/client/settings/admin-byok-section.test.ts`

- [ ] **Step 1: Update the tests**

In `tests/client/settings/admin-byok-section.test.ts`:

Delete the test `enablement action PATCHes the inverted enabled state` (it clicks the removed toggle button).

Replace it with a test asserting no toggle button renders:

```typescript
test('renders a read-only overview with no enable/disable control', async () => {
  setMockFetch(() => Promise.resolve(json(adminPayload)))
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(AdminByokSection, { target })

  await drain()

  expect(target.querySelector('[data-testid="admin-byok-toggle-user:1"]')).toBeNull()
  expect(target.textContent).toContain('user:1')
  void unmount(component)
})
```

If `capturedPatchBody` and `routeAdminByokMock` become unused after deleting the toggle test, remove them and the `capturedPatchBody = ''` reset line in `afterEach` to keep the file lint-clean. Keep `setCsrfToken('')` in `afterEach`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/client/settings/admin-byok-section.test.ts`
Expected: FAIL — the toggle button still renders, so `querySelector('[data-testid="admin-byok-toggle-user:1"]')` is non-null.

- [ ] **Step 3: Remove the toggle from the admin component**

In `client/settings/sections/admin/AdminByokSection.svelte`:

Remove the `Btn` import (line 11) — it is only used by the toggle.

Remove the `toggling` state (`let toggling: string | null = $state(null)`).

Remove the `toggle()` function entirely.

In the `columns` array, remove the trailing action column entry:

```typescript
    { key: 'action' as const, label: '', align: 'right' as const },
```

In the `ByokAdminRow` interface, remove the `action: string` property.

In the `rows` `$derived` mapping, remove the `action: row.enabled ? 'Disable' : 'Enable',` line.

In the `cell` snippet, remove the entire `{#if col.key === 'action'}` … `{:else if col.key === 'contextId'}` first branch so the snippet starts with the `contextId` branch:

```svelte
    {#snippet cell(row: ByokAdminRow, col: { key: string; label: string })}
      {#if col.key === 'contextId'}
        <IdCell value={row.contextId} />
      {:else if col.key === 'status' && row.raw.unreadable === true}
        <span class="settings-byok-admin__unreadable">Unreadable</span>
        {#if row.raw.error !== undefined}<span class="settings-byok-admin__error">{row.raw.error}</span>{/if}
      {:else}
        {String(row[col.key as keyof ByokAdminRow] ?? '')}
      {/if}
    {/snippet}
```

(`row.raw` is still needed for the unreadable branch, so keep the `raw: row` field in the row mapping and the `raw` property on the interface.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/client/settings/admin-byok-section.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/settings/sections/admin/AdminByokSection.svelte tests/client/settings/admin-byok-section.test.ts
git commit -m "refactor(byok): read-only admin BYOK overview"
```

---

## Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Build the client bundles**

Run: `bun build:client`
Expected: builds `public/` with no errors (client-facing debug-server suites require fresh bundles).

- [ ] **Step 2: Run the touched server + client suites**

Run:

```bash
bun test tests/debug/settings/byok-routes.test.ts tests/debug/settings/admin/byok-routes.test.ts
bun test:client tests/client/settings/byok-section.test.ts tests/client/settings/admin-byok-section.test.ts tests/client/settings/byok-fetchers.test.ts
```

Expected: all PASS.

- [ ] **Step 3: Run staged checks**

Run: `bun check`
Expected: lint, typecheck, format, license-headers all pass on the staged files. Fix any issue at the source (no lint-disable/ts-ignore).

- [ ] **Step 4: Run the full server suite for regressions**

Run: `bun run test`
Expected: green. Pay attention to `tests/debug/settings-api-router.test.ts` (only asserts 401-without-session for both byok routes — unaffected) and any settings-section integration tests.

- [ ] **Step 5: Final commit (if any check produced fixes)**

```bash
git add -A
git commit -m "chore(byok): verification fixes for self-serve BYOK"
```

(Skip if no changes were needed in steps 1–4.)

---

## Self-Review Notes

- **Spec coverage:** Permission move (Task 1), resolver unchanged (no task — verified untouched), user UI toggle (Tasks 3–4), admin read-only (Tasks 2, 5), testing (every task is TDD + Task 6). Scope keying unchanged (no task — confirmed in spec). All spec sections map to a task.
- **Incomplete-config → error:** unchanged resolver behavior is preserved by _not_ touching `llm-config-resolver.ts`; the existing `PATCH rejects credential update before admin enablement` test (save mode requires `enabled`) is retained, guarding the save-path 403.
- **Type/name consistency:** `toggleByok({ contextId, enabled })` defined in Task 3 is used identically in Task 4; route accepts `{ action: 'enable' | 'disable' }` (Task 1) which is exactly what `toggleByok` sends.
