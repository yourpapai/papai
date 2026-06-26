<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Admin → Groups Authorization UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a bot admin authorize a group from the settings UI by typing a raw chat ID (auto-scoped) or by clicking a group the bot has already observed.

**Architecture:** Add a platform-scoped reader over `known_group_contexts`; teach the existing `/settings/api/admin/groups` POST to scope raw IDs and the GET to also return observed-but-unauthorized groups; extend the client schema/fetcher and render a pick-list in `AdminGroupsSection.svelte`.

**Tech Stack:** Bun, TypeScript (ESM, `.js` import paths), Drizzle (SQLite), Zod v4, Svelte 5 runes, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-06-04-admin-groups-authorization-ux-design.md`

**Reference facts (already verified in the codebase):**

- `KnownGroupContext = { contextId, provider, displayName, parentName: string | null, firstSeenAt, lastSeenAt, source? }` (`src/group-settings/types.ts`).
- `matchesAdminPlatformInstance(contextId: string, platformInstanceId: string | undefined): boolean` (`src/group-settings/admin-scope.ts`).
- `toScopedContextId({ platformInstanceId, nativeContextId })` and `isScopedContextId(value)` (`src/chat/scoped-context.ts`).
- `addAuthorizedGroup(groupId, addedBy)`, `isAuthorizedGroup(groupId)`, `listAuthorizedGroups()` (`src/authorized-groups.ts`).
- `authed.principal` has `platformInstanceId` and `platformUserId` (`src/settings/principal.ts`).
- Route handler `handleGroups(req, authed)` and `GroupBodySchema = z.object({ groupId: z.string().min(1) })` (`src/debug/settings/admin/system-access-routes.ts`).
- Client: `AdminGroupsResponseSchema = { groups: AdminGroupRow[] }` (`client/settings/fetcher-schemas.ts`); `fetchAdminGroups`/`addAdminGroup`/`removeAdminGroup` (`client/settings/admin-fetchers.ts`); `AdminGroupsSection.svelte`.

---

## File Structure

- **Modify** `src/group-settings/admin-group-list.ts` — add `listKnownGroupContextsForPlatform` (platform-scoped reader, no admin-observation join).
- **Modify** `src/debug/settings/admin/system-access-routes.ts` — auto-scope POST; GET returns `{ groups, observed }`.
- **Modify** `client/settings/fetcher-schemas.ts` — add `ObservedGroupSchema`; extend `AdminGroupsResponseSchema`.
- **Modify** `client/settings/sections/admin/AdminGroupsSection.svelte` — observed pick-list + relabeled manual field.
- **Tests:** `tests/group-settings/admin-group-list.test.ts` (new), `tests/debug/settings/admin/system-access-routes.test.ts`, `tests/client/settings/fetcher-schemas.test.ts`, `tests/client/settings/sections/admin/AdminGroupsSection.test.ts`.

---

## Task 1: Backend reader `listKnownGroupContextsForPlatform`

**Files:**

- Modify: `src/group-settings/admin-group-list.ts`
- Test: `tests/group-settings/admin-group-list.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/group-settings/admin-group-list.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { toScopedContextId } from '../../src/chat/scoped-context.js'
import { listKnownGroupContextsForPlatform } from '../../src/group-settings/admin-group-list.js'
import { upsertKnownGroupContext } from '../../src/group-settings/registry.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const scoped = (platformInstanceId: string, nativeContextId: string): string =>
  toScopedContextId({ platformInstanceId, nativeContextId })

describe('listKnownGroupContextsForPlatform', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns only same-instance groups, sorted by display name', () => {
    upsertKnownGroupContext({
      contextId: scoped('pi-1', 'b'),
      provider: 'mattermost',
      displayName: 'Beta',
      parentName: null,
    })
    upsertKnownGroupContext({
      contextId: scoped('pi-1', 'a'),
      provider: 'mattermost',
      displayName: 'Alpha',
      parentName: null,
    })
    upsertKnownGroupContext({
      contextId: scoped('pi-2', 'c'),
      provider: 'mattermost',
      displayName: 'Gamma',
      parentName: null,
    })

    const result = listKnownGroupContextsForPlatform('pi-1')

    expect(result.map((g) => g.displayName)).toEqual(['Alpha', 'Beta'])
    expect(result.map((g) => g.contextId)).toEqual([scoped('pi-1', 'a'), scoped('pi-1', 'b')])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/group-settings/admin-group-list.test.ts`
Expected: FAIL — `listKnownGroupContextsForPlatform` is not exported.

- [ ] **Step 3: Add the reader**

In `src/group-settings/admin-group-list.ts`, append after `listAdminGroupContextsForUser` (the imports `matchesAdminPlatformInstance`, `knownGroupContexts`, `toKnownGroupContext`, `getDrizzleDb`, `log` already exist in this file):

```typescript
export function listKnownGroupContextsForPlatform(platformInstanceId: string): KnownGroupContext[] {
  log.debug({ platformInstanceId }, 'listKnownGroupContextsForPlatform called')

  const groups = getDrizzleDb()
    .select({
      contextId: knownGroupContexts.contextId,
      provider: knownGroupContexts.provider,
      displayName: knownGroupContexts.displayName,
      parentName: knownGroupContexts.parentName,
      firstSeenAt: knownGroupContexts.firstSeenAt,
      lastSeenAt: knownGroupContexts.lastSeenAt,
    })
    .from(knownGroupContexts)
    .all()
    .map((row) => toKnownGroupContext(row))
    .filter((group) => matchesAdminPlatformInstance(group.contextId, platformInstanceId))
    .toSorted((left, right) => left.displayName.localeCompare(right.displayName))

  log.debug({ platformInstanceId, count: groups.length }, 'Listed known group contexts for platform')
  return groups
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/group-settings/admin-group-list.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/group-settings/admin-group-list.ts tests/group-settings/admin-group-list.test.ts
git commit -m "feat(group-settings): add listKnownGroupContextsForPlatform reader"
```

---

## Task 2: Auto-scope raw group IDs on POST

**Files:**

- Modify: `src/debug/settings/admin/system-access-routes.ts`
- Test: `tests/debug/settings/admin/system-access-routes.test.ts`

- [ ] **Step 1: Write the failing tests**

In `tests/debug/settings/admin/system-access-routes.test.ts`, add this import near the top (with the other imports):

```typescript
import { toScopedContextId, isScopedContextId } from '../../../../src/chat/scoped-context.js'
```

Then add these tests inside the `describe('settings admin system/access routes', …)` block (the `adminSession` is established with `{ platformInstanceId: 'pi-1', platformUserId: 'admin-1' }`):

```typescript
test('POST groups scopes a raw native id to the admin platform instance', async () => {
  const url = new URL('https://x/settings/api/admin/groups')
  const res = await handleAdminSystemAccessRoutes(
    new Request(url, {
      method: 'POST',
      headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId: 'rawchan' }),
    }),
    url,
    '/settings/api/admin/groups',
  )
  expect(res.status).toBe(200)
  const expected = toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'rawchan' })
  expect(listAuthorizedGroups().some((g) => g.group_id === expected)).toBe(true)
})

test('POST groups stores an already-scoped id unchanged', async () => {
  const scoped = toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'chan-9' })
  expect(isScopedContextId(scoped)).toBe(true)
  const url = new URL('https://x/settings/api/admin/groups')
  await handleAdminSystemAccessRoutes(
    new Request(url, {
      method: 'POST',
      headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId: scoped }),
    }),
    url,
    '/settings/api/admin/groups',
  )
  expect(listAuthorizedGroups().some((g) => g.group_id === scoped)).toBe(true)
})

test('POST groups rejects a whitespace-only id with 422', async () => {
  const url = new URL('https://x/settings/api/admin/groups')
  const res = await handleAdminSystemAccessRoutes(
    new Request(url, {
      method: 'POST',
      headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId: '   ' }),
    }),
    url,
    '/settings/api/admin/groups',
  )
  expect(res.status).toBe(422)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/debug/settings/admin/system-access-routes.test.ts`
Expected: FAIL — raw id stored verbatim (`rawchan` not scoped); whitespace stored as `200` instead of `422`.

- [ ] **Step 3: Implement auto-scope**

In `src/debug/settings/admin/system-access-routes.ts`, add to the imports:

```typescript
import { isScopedContextId, toScopedContextId } from '../../../chat/scoped-context.js'
```

Replace the POST branch inside `handleGroups` (currently `if (req.method === 'POST') { addAuthorizedGroup(body.data.groupId, authed.principal.platformUserId); return settingsJson(200, { ok: true }) }`) with:

```typescript
if (req.method === 'POST') {
  const raw = body.data.groupId.trim()
  if (raw === '') return settingsJson(422, { error: 'invalid request' })
  const groupId = isScopedContextId(raw)
    ? raw
    : toScopedContextId({ platformInstanceId: authed.principal.platformInstanceId, nativeContextId: raw })
  addAuthorizedGroup(groupId, authed.principal.platformUserId)
  return settingsJson(200, { ok: true })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/debug/settings/admin/system-access-routes.test.ts`
Expected: PASS (including the pre-existing groups tests — `g-1`/`g-del` are not scoped, so they are stored auto-scoped now; those tests assert on `listAuthorizedGroups()` membership of the raw value. Verify: the existing tests POST `groupId: 'g-1'` then check `g.group_id === 'g-1'`. Since `g-1` is **not** a scoped id, it will now be stored as `toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'g-1' })` and the assertion will FAIL.)

- [ ] **Step 5: Update the two pre-existing groups tests to expect the scoped value**

In the same test file, update the existing `admin POST groups adds group and GET reflects it` and `admin DELETE groups removes the group` tests so the expected stored id is scoped. Replace each literal `'g-1'` / `'g-del'` comparison with the scoped form. Concretely:

For `admin POST groups adds group and GET reflects it`, change the assertion block to:

```typescript
expect(postRes.status).toBe(200)
OkResponseSchema.parse(await postRes.json())
const expected = toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'g-1' })
const groups = listAuthorizedGroups()
assert(
  groups.some((g) => g.group_id === expected),
  'group g-1 should be listed (scoped) after POST',
)
```

For `admin DELETE groups removes the group`, the DELETE operates on the stored value. Change the test to delete the scoped id:

```typescript
test('admin DELETE groups removes the group', async () => {
  const scopedDel = toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'g-del' })
  const postUrl = new URL('https://x/settings/api/admin/groups')
  await handleAdminSystemAccessRoutes(
    new Request(postUrl, {
      method: 'POST',
      headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId: 'g-del' }),
    }),
    postUrl,
    '/settings/api/admin/groups',
  )
  assert(
    listAuthorizedGroups().some((g) => g.group_id === scopedDel),
    'group should exist before delete',
  )

  const deleteUrl = new URL('https://x/settings/api/admin/groups')
  const res = await handleAdminSystemAccessRoutes(
    new Request(deleteUrl, {
      method: 'DELETE',
      headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId: scopedDel }),
    }),
    deleteUrl,
    '/settings/api/admin/groups',
  )
  expect(res.status).toBe(200)
  expect(listAuthorizedGroups().some((g) => g.group_id === scopedDel)).toBe(false)
})
```

- [ ] **Step 6: Run the full file to verify green**

Run: `bun test tests/debug/settings/admin/system-access-routes.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/debug/settings/admin/system-access-routes.ts tests/debug/settings/admin/system-access-routes.test.ts
git commit -m "feat(settings): auto-scope raw group ids when authorizing a group"
```

---

## Task 3: GET returns observed-but-unauthorized groups

**Files:**

- Modify: `src/debug/settings/admin/system-access-routes.ts`
- Test: `tests/debug/settings/admin/system-access-routes.test.ts`

- [ ] **Step 1: Write the failing test**

Add these imports to the test file (with the others):

```typescript
import { upsertKnownGroupContext } from '../../../../src/group-settings/registry.js'
```

Add this test inside the `describe`:

```typescript
test('GET groups returns observed unauthorized same-instance groups only', async () => {
  const observedId = toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'obs-1' })
  const authorizedId = toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'auth-1' })
  const otherInstanceId = toScopedContextId({ platformInstanceId: 'pi-2', nativeContextId: 'obs-2' })
  upsertKnownGroupContext({ contextId: observedId, provider: 'mattermost', displayName: 'Observed', parentName: null })
  upsertKnownGroupContext({
    contextId: authorizedId,
    provider: 'mattermost',
    displayName: 'Authorized',
    parentName: null,
  })
  upsertKnownGroupContext({
    contextId: otherInstanceId,
    provider: 'mattermost',
    displayName: 'Other',
    parentName: null,
  })

  // authorize one of them via the route (already-scoped → stored as-is)
  const postUrl = new URL('https://x/settings/api/admin/groups')
  await handleAdminSystemAccessRoutes(
    new Request(postUrl, {
      method: 'POST',
      headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId: authorizedId }),
    }),
    postUrl,
    '/settings/api/admin/groups',
  )

  const url = new URL('https://x/settings/api/admin/groups')
  const res = await handleAdminSystemAccessRoutes(
    new Request(url, { method: 'GET', headers: authHeaders(adminSession) }),
    url,
    '/settings/api/admin/groups',
  )
  expect(res.status).toBe(200)
  const body = z
    .object({
      groups: z.array(z.unknown()),
      observed: z.array(
        z.object({ contextId: z.string(), displayName: z.string(), parentName: z.string().nullable() }),
      ),
    })
    .parse(await res.json())
  const observedIds = body.observed.map((o) => o.contextId)
  expect(observedIds).toContain(observedId)
  expect(observedIds).not.toContain(authorizedId)
  expect(observedIds).not.toContain(otherInstanceId)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/debug/settings/admin/system-access-routes.test.ts`
Expected: FAIL — response has no `observed` key (Zod parse throws).

- [ ] **Step 3: Implement GET observed**

In `src/debug/settings/admin/system-access-routes.ts`, add to the imports:

```typescript
import {
  addAuthorizedGroup,
  isAuthorizedGroup,
  listAuthorizedGroups,
  removeAuthorizedGroup,
} from '../../../authorized-groups.js'
import { listKnownGroupContextsForPlatform } from '../../../group-settings/admin-group-list.js'
```

(The first line replaces the existing `authorized-groups.js` import, adding `isAuthorizedGroup`.)

Replace the GET branch inside `handleGroups` (currently `return settingsJson(200, { groups: listAuthorizedGroups() })`) with:

```typescript
if (req.method === 'GET') {
  const guard = requireAdmin(authed, 'read')
  if (guard !== null) return guard
  const observed = listKnownGroupContextsForPlatform(authed.principal.platformInstanceId)
    .filter((group) => !isAuthorizedGroup(group.contextId))
    .map((group) => ({ contextId: group.contextId, displayName: group.displayName, parentName: group.parentName }))
  return settingsJson(200, { groups: listAuthorizedGroups(), observed })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/debug/settings/admin/system-access-routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/debug/settings/admin/system-access-routes.ts tests/debug/settings/admin/system-access-routes.test.ts
git commit -m "feat(settings): return observed unauthorized groups from admin groups GET"
```

---

## Task 4: Client schema for observed groups

**Files:**

- Modify: `client/settings/fetcher-schemas.ts`
- Test: `tests/client/settings/fetcher-schemas.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/client/settings/fetcher-schemas.test.ts`, add `AdminGroupsResponseSchema` to the **existing** import block from `'../../../client/settings/fetcher-schemas.js'` (the one that already imports `AdminInstancesResponseSchema`, `BootstrapSchema`, etc.) — do not add a new import line at a different path.

Add this test (a new `describe` block alongside the existing `describe('fetcher-schemas', …)`):

```typescript
describe('AdminGroupsResponseSchema', () => {
  test('parses groups plus observed entries', () => {
    const parsed = AdminGroupsResponseSchema.parse({
      groups: [{ group_id: 'pi:a:ctx:b', added_by: 'admin', added_at: '2026-06-01' }],
      observed: [{ contextId: 'pi:a:ctx:c', displayName: 'Ops', parentName: null }],
    })
    expect(parsed.observed[0]?.contextId).toBe('pi:a:ctx:c')
    expect(parsed.observed[0]?.displayName).toBe('Ops')
  })

  test('defaults observed to an empty array when absent', () => {
    const parsed = AdminGroupsResponseSchema.parse({ groups: [] })
    expect(parsed.observed).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test:client tests/client/settings/fetcher-schemas.test.ts`
Expected: FAIL — `parsed.observed` is `undefined` (schema has no `observed`).

- [ ] **Step 3: Extend the schema**

In `client/settings/fetcher-schemas.ts`, replace the `AdminGroupsResponseSchema` block (currently `export const AdminGroupsResponseSchema = z.object({ groups: z.array(AdminGroupRowSchema) })`) with:

```typescript
export const ObservedGroupSchema = z.object({
  contextId: z.string(),
  displayName: z.string(),
  parentName: z.string().nullable().default(null),
})
export const AdminGroupsResponseSchema = z.object({
  groups: z.array(AdminGroupRowSchema),
  observed: z.array(ObservedGroupSchema).default([]),
})
export type ObservedGroup = z.infer<typeof ObservedGroupSchema>
```

Keep the existing `export type AdminGroupRow` / `export type AdminGroupsResponse` lines that follow.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test:client tests/client/settings/fetcher-schemas.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/settings/fetcher-schemas.ts tests/client/settings/fetcher-schemas.test.ts
git commit -m "feat(settings): add observed groups to admin groups response schema"
```

---

## Task 5: Client pick-list and relabeled field in `AdminGroupsSection.svelte`

**Files:**

- Modify: `client/settings/sections/admin/AdminGroupsSection.svelte`
- Test: `tests/client/settings/sections/admin/AdminGroupsSection.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/client/settings/sections/admin/AdminGroupsSection.test.ts`, add this test inside the `describe('AdminGroupsSection', …)` block. It mocks a GET that includes one observed group, clicks Authorize, and asserts the POST body carries the observed `contextId`:

```typescript
test('renders observed groups and authorizes one by contextId', async () => {
  setCsrfToken('c')
  let postBody: string | undefined
  setMockFetch((url: string, init: RequestInit) => {
    if (url.includes('/admin/groups') && init.method === 'POST') {
      postBody = typeof init.body === 'string' ? init.body : undefined
      return Promise.resolve(json({ ok: true }))
    }
    return Promise.resolve(
      json({
        groups: [],
        observed: [{ contextId: 'pi:a:ctx:obs', displayName: 'Ops Room', parentName: null }],
      }),
    )
  })
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(AdminGroupsSection, { target })
  await drain()

  const authorizeBtn = target.querySelector<HTMLButtonElement>('[data-testid="group-authorize-pi:a:ctx:obs"]')!
  expect(authorizeBtn).not.toBeNull()
  expect(target.textContent).toContain('Ops Room')
  authorizeBtn.click()
  await drain()

  expect(postBody).toBe(JSON.stringify({ groupId: 'pi:a:ctx:obs' }))
  void unmount(component)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test:client tests/client/settings/sections/admin/AdminGroupsSection.test.ts`
Expected: FAIL — no element with testid `group-authorize-pi:a:ctx:obs`.

- [ ] **Step 3: Implement the pick-list and relabel**

Edit `client/settings/sections/admin/AdminGroupsSection.svelte`.

(a) Update the type import on line 8 to also import `ObservedGroup`:

```typescript
import type { AdminGroupRow, ObservedGroup } from '../../fetcher-schemas.js'
```

(b) Add observed state next to `groups` (after `let newGroupId = $state('')`):

```typescript
let observed: ObservedGroup[] = $state([])
```

(c) In `load()`, replace `groups = (await fetchAdminGroups()).groups` with:

```typescript
const res = await fetchAdminGroups()
groups = res.groups
observed = res.observed
```

(d) Add an `authorize` function after the `add` function:

```typescript
async function authorize(contextId: string): Promise<void> {
  error = null
  status = null
  try {
    await addAdminGroup({ groupId: contextId })
    await load()
    status = 'Group authorized.'
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
  }
}
```

(e) Insert the observed block immediately before the existing `<form …>` (after the status paragraphs on line 93):

```svelte
  {#if observed.length > 0}
    <div class="settings-observed">
      <h3>Observed groups</h3>
      <ul class="settings-observed__list">
        {#each observed as g (g.contextId)}
          <li class="settings-observed__item">
            <span class="settings-observed__name">{g.displayName}{g.parentName ? ` · ${g.parentName}` : ''}</span>
            <Btn variant="ghost" size="sm" testid={`group-authorize-${g.contextId}`} onClick={() => void authorize(g.contextId)}>
              {#snippet children()}Authorize{/snippet}
            </Btn>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
```

(f) Relabel the manual field: change `<Field label="Group ID">` to `<Field label="Group ID or chat ID">`, and add a help line directly after the closing `</form>` (line 104):

```svelte
  <p class="placeholder">Raw chat IDs are scoped to your platform instance automatically.</p>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test:client tests/client/settings/sections/admin/AdminGroupsSection.test.ts`
Expected: PASS (including the pre-existing tests — their mock returns `{ groups: [...] }` with no `observed`; the schema defaults `observed` to `[]`, so the pick-list is hidden and prior assertions are unaffected).

- [ ] **Step 5: Commit**

```bash
git add client/settings/sections/admin/AdminGroupsSection.svelte tests/client/settings/sections/admin/AdminGroupsSection.test.ts
git commit -m "feat(settings): observed-group pick-list and raw-id field in AdminGroupsSection"
```

---

## Task 6: Full verification

- [ ] **Step 1: Run the server suites touched**

Run: `bun test tests/group-settings/ tests/debug/settings/admin/system-access-routes.test.ts`
Expected: PASS.

- [ ] **Step 2: Run the client suites touched**

Run: `bun test:client tests/client/settings/fetcher-schemas.test.ts tests/client/settings/sections/admin/AdminGroupsSection.test.ts`
Expected: PASS.

- [ ] **Step 3: Typecheck + lint + format**

Run: `bunx tsc --noEmit` then `bun check:full`
Expected: no errors. Fix any reported issue (do not add lint-disable comments).

- [ ] **Step 4: Manual smoke (optional, documented)**

Build the client (`bun build:client`), open the settings UI as a bot admin → Admin → Groups. Confirm: observed groups list appears for groups the bot has seen; clicking Authorize moves a group into the authorized table; typing a raw channel ID in "Group ID or chat ID" and clicking Add group authorizes it (stored scoped).

---

## Self-Review Notes

- **Spec coverage:** reader (Task 1), auto-scope POST (Task 2), GET observed (Task 3), client schema (Task 4), pick-list + relabel (Task 5) — all spec sections mapped.
- **Type consistency:** `listKnownGroupContextsForPlatform(platformInstanceId)` returns `KnownGroupContext[]`; route maps to `{ contextId, displayName, parentName }`; `ObservedGroupSchema` matches that exact shape; component consumes `ObservedGroup`.
- **Behavioral side effect (called out in Task 2):** auto-scoping changes how previously-raw inputs are stored, so two existing route tests are updated to expect the scoped value. No production caller other than this route writes `authorized_groups`.
- **`parentName`:** always present as `string | null` end-to-end (server includes it; `ObservedGroupSchema` is `.nullable().default(null)`). This is the design's "omitted when null" simplified to "always present, possibly null" for a stable shape.
