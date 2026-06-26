<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Pending Username Entries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins add Telegram (or any unresolvable) `@username` as an authorized user; the entry is stored as a `placeholder-<uuid>` row and binds to the real user ID when that user first DMs the bot.

**Architecture:** Restore the placeholder-row creation that was lost when the `/user add` chat command was retired, now triggered from the settings admin Users route. A new shared resolver helper replaces the two duplicated `resolveUserIdIfNeeded` copies; the admin users route falls back to `addPendingUser` when resolution fails, while the group-members route keeps strict behavior. The existing DM-side binding (`auth.ts` → `resolveUserByUsername`) becomes case-insensitive. The settings UI renders placeholder rows with a `pending` badge.

**Tech Stack:** Bun, TypeScript (strict, `.js` import extensions), Drizzle/SQLite, Zod v4, Svelte 5 (settings SPA), `bun:test`.

**Spec:** `docs/superpowers/specs/2026-06-10-pending-username-entries-design.md`

**Repo rules that apply to every task:** TDD hooks block implementation writes without a failing test; never add lint-disable comments; pino structured logging, never log sensitive data; `bun run test` for server suites, `bun test:client` for client suites.

---

## File Map

| File                                                             | Action | Responsibility                                                       |
| ---------------------------------------------------------------- | ------ | -------------------------------------------------------------------- |
| `src/users.ts`                                                   | Modify | `addPendingUser()` (new), case-insensitive `resolveUserByUsername()` |
| `src/debug/settings/resolve-user-id.ts`                          | Create | Shared settings-route user-ID resolution (3-way result)              |
| `src/debug/settings/admin/system-access-routes.ts`               | Modify | Use shared resolver; pending fallback on `unresolved`                |
| `src/debug/settings/group-routes.ts`                             | Modify | Use shared resolver; clearer 422 on `unresolved`                     |
| `client/settings/fetcher-schemas.ts`                             | Modify | `AddAdminUserResponseSchema` with optional `pending`                 |
| `client/settings/admin-fetchers.ts`                              | Modify | `addAdminUser` returns parsed response                               |
| `client/settings/sections/admin/AdminUsersSection.svelte`        | Modify | Pending badge, pending status message, new hint                      |
| `tests/users.test.ts`                                            | Modify | Tests for the two `src/users.ts` changes                             |
| `tests/debug/settings/resolve-user-id.test.ts`                   | Create | Tests for the shared resolver                                        |
| `tests/debug/settings/admin/system-access-routes.test.ts`        | Modify | Pending-fallback route tests                                         |
| `tests/debug/settings/group-routes.test.ts`                      | Modify | Unresolved → 422 message test                                        |
| `tests/client/settings/fetcher-schemas.test.ts`                  | Modify | Response schema test                                                 |
| `tests/client/settings/sections/admin/AdminUsersSection.test.ts` | Modify | Badge + pending message tests                                        |

---

### Task 1: `addPendingUser` + case-insensitive `resolveUserByUsername` (`src/users.ts`)

**Files:**

- Modify: `src/users.ts`
- Test: `tests/users.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/users.test.ts`. Extend the import on line 14 to include `addPendingUser`:

```typescript
import {
  addUser,
  addPendingUser,
  removeUser,
  isAuthorized,
  isDemoUser,
  resolveUserByUsername,
  listUsers,
} from '../src/users.js'
```

Append these suites at the end of the file:

```typescript
describe('addPendingUser', () => {
  beforeEach(async () => {
    await setupTestDb()
    seedCommonTestPlatformInstances()
  })

  test('creates a placeholder row with the cleaned username', () => {
    const added = addPendingUser({
      username: '@f4dev',
      platformInstanceId: TEST_PLATFORM_ID,
      addedBy: 'admin-1',
    })
    expect(added).toBe(true)
    const rows = listUsers(TEST_PLATFORM_ID).filter((u) => u.username === 'f4dev')
    expect(rows).toHaveLength(1)
    const row = requireDefined(rows[0])
    expect(row.platform_user_id.startsWith('placeholder-')).toBe(true)
    expect(row.added_by).toBe('admin-1')
  })

  test('rejects an empty username', () => {
    expect(
      addPendingUser({
        username: '@',
        platformInstanceId: TEST_PLATFORM_ID,
        addedBy: 'admin-1',
      }),
    ).toBe(false)
    expect(
      addPendingUser({
        username: '   ',
        platformInstanceId: TEST_PLATFORM_ID,
        addedBy: 'admin-1',
      }),
    ).toBe(false)
    expect(listUsers(TEST_PLATFORM_ID)).toHaveLength(0)
  })

  test('is idempotent case-insensitively', () => {
    expect(
      addPendingUser({
        username: '@F4Dev',
        platformInstanceId: TEST_PLATFORM_ID,
        addedBy: 'admin-1',
      }),
    ).toBe(true)
    expect(
      addPendingUser({
        username: 'f4dev',
        platformInstanceId: TEST_PLATFORM_ID,
        addedBy: 'admin-1',
      }),
    ).toBe(true)
    expect(listUsers(TEST_PLATFORM_ID)).toHaveLength(1)
  })

  test('does not duplicate when a real user already holds the username', () => {
    addUser({
      userId: '111',
      platformInstanceId: TEST_PLATFORM_ID,
      addedBy: 'admin-1',
      username: 'jane',
    })
    expect(
      addPendingUser({
        username: '@Jane',
        platformInstanceId: TEST_PLATFORM_ID,
        addedBy: 'admin-1',
      }),
    ).toBe(true)
    expect(listUsers(TEST_PLATFORM_ID)).toHaveLength(1)
    expect(requireDefined(listUsers(TEST_PLATFORM_ID)[0]).platform_user_id).toBe('111')
  })

  test('pending entry binds and authorizes on first contact', () => {
    addPendingUser({
      username: '@f4dev',
      platformInstanceId: TEST_PLATFORM_ID,
      addedBy: 'admin-1',
    })
    expect(resolveUserByUsername('424242', 'f4dev', TEST_PLATFORM_ID)).toBe(true)
    expect(isAuthorized('424242', TEST_PLATFORM_ID)).toBe(true)
  })
})
```

And inside the existing `describe('resolveUserByUsername', ...)` block add:

```typescript
test('binds case-insensitively', () => {
  addUser({
    userId: 'placeholder-ci',
    platformInstanceId: TEST_PLATFORM_ID,
    addedBy: '999',
    username: 'F4Dev',
  })
  expect(resolveUserByUsername('777', 'f4dev', TEST_PLATFORM_ID)).toBe(true)
  expect(isAuthorized('777', TEST_PLATFORM_ID)).toBe(true)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/users.test.ts`
Expected: FAIL — `addPendingUser` is not exported; the case-insensitive test fails because the current match is exact.

- [ ] **Step 3: Implement in `src/users.ts`**

Change the drizzle import (line 6):

```typescript
import { and, eq, inArray, or, sql } from 'drizzle-orm'
```

Add below `AddUserInput` (after line 37):

```typescript
export type AddPendingUserInput = Readonly<{
  username: string
  platformInstanceId: string
  addedBy: string
}>

const usernameMatchesInsensitive = (username: string) => sql`lower(${users.username}) = ${username.toLowerCase()}`

/**
 * Authorize a user the platform cannot resolve to an ID yet (e.g. Telegram @username).
 * Stores a placeholder row that resolveUserByUsername() rebinds on first DM contact.
 */
export function addPendingUser(input: AddPendingUserInput): boolean {
  const stripped = input.username.startsWith('@') ? input.username.slice(1) : input.username
  const username = stripped.trim()
  if (username === '') {
    log.warn({ platformInstanceId: input.platformInstanceId }, 'addPendingUser called with empty username')
    return false
  }
  const db = getDrizzleDb()
  const existing = db
    .select({ platformUserId: users.platformUserId })
    .from(users)
    .where(and(eq(users.platformInstanceId, input.platformInstanceId), usernameMatchesInsensitive(username)))
    .get()
  if (existing !== undefined) {
    log.info({ platformInstanceId: input.platformInstanceId }, 'Pending user already present')
    return true
  }
  db.insert(users)
    .values({
      platformUserId: `placeholder-${crypto.randomUUID()}`,
      platformInstanceId: input.platformInstanceId,
      username,
      addedBy: input.addedBy,
    })
    .run()
  log.info({ platformInstanceId: input.platformInstanceId }, 'Pending user added')
  return true
}
```

In `resolveUserByUsername`, replace the `where` clause (line 131):

```typescript
    .where(and(usernameMatchesInsensitive(username), eq(users.platformInstanceId, platformInstanceId)))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/users.test.ts`
Expected: PASS (all suites in the file, including pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add tests/users.test.ts src/users.ts
git commit -m "feat(users): add pending-user placeholders and case-insensitive username binding"
```

---

### Task 2: Shared settings resolver (`src/debug/settings/resolve-user-id.ts`)

**Files:**

- Create: `src/debug/settings/resolve-user-id.ts`
- Test: `tests/debug/settings/resolve-user-id.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/debug/settings/resolve-user-id.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { ChatRouter } from '../../../src/chat/router.js'
import { clearRuntimeChatRouter, setRuntimeChatRouter } from '../../../src/debug/chat-router-runtime.js'
import { resolveSettingsUserId } from '../../../src/debug/settings/resolve-user-id.js'
import { mockLogger } from '../../utils/test-helpers.js'

const PRINCIPAL = { platformUserId: 'admin-1', platformInstanceId: 'pi-1' }

const mockResolveUserId = mock((_username: string, _context?: unknown) => Promise.resolve<string | null>(null))

class MockChatRouter extends ChatRouter {
  constructor() {
    super(() => {
      throw new Error('unused test factory')
    })
  }

  override resolveUserId(username: string, context?: unknown): Promise<string | null> {
    return mockResolveUserId(username, context)
  }
}

describe('resolveSettingsUserId', () => {
  beforeEach(() => {
    mockLogger()
    mockResolveUserId.mockClear()
    mockResolveUserId.mockImplementation(() => Promise.resolve(null))
    setRuntimeChatRouter(new MockChatRouter())
  })

  afterEach(() => {
    clearRuntimeChatRouter()
  })

  test('numeric input is an id without consulting the router', async () => {
    expect(await resolveSettingsUserId('123456789', PRINCIPAL)).toEqual({
      kind: 'id',
      userId: '123456789',
    })
    expect(mockResolveUserId).not.toHaveBeenCalled()
  })

  test('numeric input with @ prefix is cleaned', async () => {
    expect(await resolveSettingsUserId('@123456789', PRINCIPAL)).toEqual({
      kind: 'id',
      userId: '123456789',
    })
  })

  test('router resolution success returns resolved id and passes dm context', async () => {
    mockResolveUserId.mockImplementation(() => Promise.resolve('42'))
    expect(await resolveSettingsUserId('@f4dev', PRINCIPAL)).toEqual({
      kind: 'resolved',
      userId: '42',
    })
    expect(mockResolveUserId).toHaveBeenCalledWith(
      '@f4dev',
      expect.objectContaining({
        contextId: 'admin-1',
        contextType: 'dm',
        platformInstanceId: 'pi-1',
      }),
    )
  })

  test('router resolution failure returns unresolved with cleaned username', async () => {
    expect(await resolveSettingsUserId('@f4dev', PRINCIPAL)).toEqual({
      kind: 'unresolved',
      username: 'f4dev',
    })
  })

  test('missing chat router returns unresolved', async () => {
    clearRuntimeChatRouter()
    expect(await resolveSettingsUserId('f4dev', PRINCIPAL)).toEqual({
      kind: 'unresolved',
      username: 'f4dev',
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/debug/settings/resolve-user-id.test.ts`
Expected: FAIL — module `src/debug/settings/resolve-user-id.js` does not exist.

- [ ] **Step 3: Implement**

Create `src/debug/settings/resolve-user-id.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getRuntimeChatRouter } from '../chat-router-runtime.js'

export type SettingsUserIdResolution =
  | { kind: 'id'; userId: string }
  | { kind: 'resolved'; userId: string }
  | { kind: 'unresolved'; username: string }

/**
 * Resolve a settings-route user input (numeric ID or @username) to a platform user ID.
 * Numeric input short-circuits; otherwise the chat router is consulted. When the
 * router is missing or cannot resolve (e.g. Telegram user @usernames, which the
 * Bot API cannot look up), the cleaned username is returned as `unresolved` so
 * callers can decide between a pending entry and an error.
 */
export async function resolveSettingsUserId(
  rawUserId: string,
  principal: Readonly<{ platformUserId: string; platformInstanceId: string }>,
): Promise<SettingsUserIdResolution> {
  const clean = rawUserId.startsWith('@') ? rawUserId.slice(1) : rawUserId
  if (/^\d+$/u.test(clean)) return { kind: 'id', userId: clean }
  const router = getRuntimeChatRouter()
  if (router === null) return { kind: 'unresolved', username: clean }
  const resolved = await router.resolveUserId(rawUserId, {
    contextId: principal.platformUserId,
    contextType: 'dm',
    platformInstanceId: principal.platformInstanceId,
  })
  if (resolved === null) return { kind: 'unresolved', username: clean }
  return { kind: 'resolved', userId: resolved }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/debug/settings/resolve-user-id.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add tests/debug/settings/resolve-user-id.test.ts src/debug/settings/resolve-user-id.ts
git commit -m "feat(settings): shared user-id resolver with unresolved outcome"
```

---

### Task 3: Pending fallback in the admin users route

**Files:**

- Modify: `src/debug/settings/admin/system-access-routes.ts` (lines 17–19, 58–74, 94–109)
- Test: `tests/debug/settings/admin/system-access-routes.test.ts`

- [ ] **Step 1: Write the failing tests**

In `tests/debug/settings/admin/system-access-routes.test.ts`, change the resolver mock (lines 24–26) so usernames containing `ghost` are unresolvable:

```typescript
const mockResolveUserId = mock((username: string, _context?: unknown) => {
  if (username.includes('ghost')) return Promise.resolve<string | null>(null)
  return Promise.resolve<string | null>(/^\d+$/u.test(username) ? username : `resolved-${username}`)
})
```

Add these tests inside the `describe` block (after the test ending on line 102):

```typescript
test('POST users with unresolvable username creates a pending entry', async () => {
  const url = new URL('https://x/settings/api/admin/users')
  const res = await handleAdminSystemAccessRoutes(
    new Request(url, {
      method: 'POST',
      headers: {
        ...authHeaders(adminSession, true),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userId: '@ghost' }),
    }),
    url,
    '/settings/api/admin/users',
  )
  expect(res.status).toBe(200)
  const body = z.object({ ok: z.literal(true), pending: z.literal(true) }).parse(await res.json())
  expect(body.pending).toBe(true)
  const pendingRow = listUsers('pi-1').find((u) => u.username === 'ghost')
  expect(pendingRow).toBeDefined()
  expect(pendingRow!.platform_user_id.startsWith('placeholder-')).toBe(true)
  expect(pendingRow!.added_by).toBe('admin-1')
})

test('POST users without a chat router creates a pending entry', async () => {
  clearRuntimeChatRouter()
  const url = new URL('https://x/settings/api/admin/users')
  const res = await handleAdminSystemAccessRoutes(
    new Request(url, {
      method: 'POST',
      headers: {
        ...authHeaders(adminSession, true),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userId: '@offline' }),
    }),
    url,
    '/settings/api/admin/users',
  )
  expect(res.status).toBe(200)
  z.object({ ok: z.literal(true), pending: z.literal(true) }).parse(await res.json())
  expect(listUsers('pi-1').some((u) => u.username === 'offline')).toBe(true)
})

test('POST users with only "@" returns 422', async () => {
  clearRuntimeChatRouter() // no router → unresolved with empty username
  const url = new URL('https://x/settings/api/admin/users')
  const res = await handleAdminSystemAccessRoutes(
    new Request(url, {
      method: 'POST',
      headers: {
        ...authHeaders(adminSession, true),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userId: '@' }),
    }),
    url,
    '/settings/api/admin/users',
  )
  expect(res.status).toBe(422)
})
```

Note: the `'@'` input passes the Zod `min(1)` check but reaches `addPendingUser` as an empty username, so the route must map `addPendingUser() === false` to 422.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/debug/settings/admin/system-access-routes.test.ts`
Expected: FAIL — the unresolvable-username tests get `422 could not resolve ...` instead of 200/pending.

- [ ] **Step 3: Implement the route change**

In `src/debug/settings/admin/system-access-routes.ts`:

Replace the import of `getRuntimeChatRouter` (line 19) with the shared resolver, and extend the users import (line 17):

```typescript
import { addPendingUser, addUser, listUsers, removeUser } from '../../../users.js'
```

```typescript
import { resolveSettingsUserId } from '../resolve-user-id.js'
```

(remove `import { getRuntimeChatRouter } from '../../chat-router-runtime.js'`)

Delete the whole local `resolveUserIdIfNeeded` function (lines 58–74).

Replace the `req.method === 'POST'` block in `handleUsers` (lines 94–109) with:

```typescript
if (req.method === 'POST') {
  const resolution = await resolveSettingsUserId(body.data.userId, authed.principal)
  if (resolution.kind === 'unresolved') {
    const added = addPendingUser({
      username: resolution.username,
      platformInstanceId: authed.principal.platformInstanceId,
      addedBy: authed.principal.platformUserId,
    })
    if (!added) return settingsJson(422, { error: 'invalid request' })
    log.info({ platformInstanceId: authed.principal.platformInstanceId }, 'Settings admin added pending user')
    return settingsJson(200, { ok: true, pending: true })
  }
  addUser({
    userId: resolution.userId,
    platformInstanceId: authed.principal.platformInstanceId,
    addedBy: authed.principal.platformUserId,
    username: body.data.username,
  })
  log.info({ platformInstanceId: authed.principal.platformInstanceId }, 'Settings admin added user')
  return settingsJson(200, { ok: true })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/debug/settings/admin/system-access-routes.test.ts`
Expected: PASS — including all pre-existing tests (the mock still resolves non-ghost usernames to `resolved-<name>`).

- [ ] **Step 5: Commit**

```bash
git add tests/debug/settings/admin/system-access-routes.test.ts src/debug/settings/admin/system-access-routes.ts
git commit -m "feat(settings): pending user entries when username resolution fails"
```

---

### Task 4: Group-members route uses the shared resolver, clearer 422

**Files:**

- Modify: `src/debug/settings/group-routes.ts` (lines 17, 57–73, 85–93)
- Test: `tests/debug/settings/group-routes.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/debug/settings/group-routes.test.ts`, change the resolver mock (around line 35, same shape as Task 3):

```typescript
const mockResolveUserId = mock((username: string, _context?: unknown) => {
  if (username.includes('ghost')) return Promise.resolve<string | null>(null)
  return Promise.resolve<string | null>(/^\d+$/u.test(username) ? username : `resolved-${username}`)
})
```

Add after the test ending on line 185 (`members POST with @username passes platformInstanceId to resolver`):

```typescript
test('members POST with unresolvable username returns 422 with guidance', async () => {
  const contextId = seedManageableGroup()

  const postUrl = new URL('https://x/settings/api/group/members')
  const postRes = await handleGroupRoutes(
    new Request(postUrl, {
      method: 'POST',
      headers: {
        ...authHeaders(session, true),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userId: '@ghost-member', contextId }),
    }),
    postUrl,
    '/settings/api/group/members',
  )
  expect(postRes.status).toBe(422)
  await expect(postRes.json()).resolves.toEqual({
    error: 'could not resolve "@ghost-member" to a user ID — use the numeric user ID',
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/debug/settings/group-routes.test.ts`
Expected: FAIL — current message is `could not resolve "@ghost-member" to a user ID` (no guidance suffix).

- [ ] **Step 3: Implement**

In `src/debug/settings/group-routes.ts`:

Replace the `getRuntimeChatRouter` import (line 17) with:

```typescript
import { resolveSettingsUserId } from './resolve-user-id.js'
```

Delete the local `resolveUserIdIfNeeded` function (lines 57–73).

Replace the whole `if (req.method === 'POST') { ... } else { ... }` block of `handleMembersWrite` (lines 85–97) with:

```typescript
if (req.method === 'POST') {
  const resolution = await resolveSettingsUserId(body.data.userId, authed.principal)
  if (resolution.kind === 'unresolved') {
    return settingsJson(422, {
      error: `could not resolve "${body.data.userId}" to a user ID — use the numeric user ID`,
    })
  }
  addGroupMember(outcome.group.contextId, resolution.userId, authed.principal.platformUserId)
  log.info({ contextId: outcome.group.contextId }, 'Settings group member added')
} else {
  removeGroupMember(outcome.group.contextId, body.data.userId)
  log.info({ contextId: outcome.group.contextId }, 'Settings group member removed')
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/debug/settings/group-routes.test.ts`
Expected: PASS — all pre-existing tests still pass (mock keeps resolving non-ghost names).

- [ ] **Step 5: Commit**

```bash
git add tests/debug/settings/group-routes.test.ts src/debug/settings/group-routes.ts
git commit -m "refactor(settings): share user-id resolution in group member route"
```

---

### Task 5: Client response schema + fetcher

**Files:**

- Modify: `client/settings/fetcher-schemas.ts` (after line 258)
- Modify: `client/settings/admin-fetchers.ts` (lines 109–110 + imports)
- Test: `tests/client/settings/fetcher-schemas.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/client/settings/fetcher-schemas.test.ts` (import `AddAdminUserResponseSchema` from `client/settings/fetcher-schemas.js` alongside the file's existing schema imports):

```typescript
describe('AddAdminUserResponseSchema', () => {
  test('accepts a plain ok response', () => {
    expect(AddAdminUserResponseSchema.parse({ ok: true })).toEqual({
      ok: true,
    })
  })

  test('accepts and preserves the pending flag', () => {
    expect(AddAdminUserResponseSchema.parse({ ok: true, pending: true })).toEqual({ ok: true, pending: true })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/fetcher-schemas.test.ts`
Expected: FAIL — `AddAdminUserResponseSchema` is not exported.

- [ ] **Step 3: Implement**

In `client/settings/fetcher-schemas.ts`, after the `AdminUsersResponseSchema` block (line 258):

```typescript
export const AddAdminUserResponseSchema = z.object({ ok: z.boolean(), pending: z.boolean().optional() }).loose()
export type AddAdminUserResponse = z.infer<typeof AddAdminUserResponseSchema>
```

In `client/settings/admin-fetchers.ts`, add `AddAdminUserResponseSchema` and `AddAdminUserResponse` to the existing `fetcher-schemas.js` imports, then replace `addAdminUser` (lines 109–110):

```typescript
export const addAdminUser = (input: { userId: string; username?: string }): Promise<AddAdminUserResponse> =>
  writeJson('/settings/api/admin/users', 'POST', input, (b) => AddAdminUserResponseSchema.parse(b))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/fetcher-schemas.test.ts tests/client/settings/admin-fetchers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/client/settings/fetcher-schemas.test.ts client/settings/fetcher-schemas.ts client/settings/admin-fetchers.ts
git commit -m "feat(settings-ui): typed add-user response with pending flag"
```

---

### Task 6: Pending badge + message in `AdminUsersSection.svelte`

**Files:**

- Modify: `client/settings/sections/admin/AdminUsersSection.svelte`
- Test: `tests/client/settings/sections/admin/AdminUsersSection.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/client/settings/sections/admin/AdminUsersSection.test.ts`:

```typescript
const pendingPayload = {
  users: [
    {
      platform_user_id: 'placeholder-123e4567-e89b-12d3-a456-426614174000',
      platform_instance_id: 'tg',
      username: 'ghost',
    },
  ],
}

const pendingAddMock = (url: string, init: RequestInit): Promise<Response> => {
  if (url.includes('/admin/users') && init.method === 'POST') return Promise.resolve(json({ ok: true, pending: true }))
  return Promise.resolve(json(usersPayload))
}
```

And these tests inside the `describe` block:

```typescript
test('renders a pending badge instead of the placeholder id', async () => {
  setMockFetch(() => Promise.resolve(json(pendingPayload)))
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(AdminUsersSection, { target })
  await drain()
  expect(target.querySelector('[data-testid="user-pending-badge"]')).not.toBeNull()
  expect(target.textContent).toContain('ghost')
  expect(target.querySelector('.id-cell')).toBeNull() // the only row is pending → no IdCell rendered
  void unmount(component)
})

test('a pending add shows the first-contact status message', async () => {
  setCsrfToken('c')
  setMockFetch(pendingAddMock)
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(AdminUsersSection, { target })
  await drain()
  const input = target.querySelector<HTMLInputElement>('[data-testid="user-add-input"]')!
  input.value = '@ghost'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
  target.querySelector<HTMLButtonElement>('[data-testid="user-add"]')!.click()
  await drain()
  expect(target.querySelector('.status-success')?.textContent).toContain('first message the bot')
  void unmount(component)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/sections/admin/AdminUsersSection.test.ts`
Expected: FAIL — no badge testid; status message is `User added.`.

- [ ] **Step 3: Implement the component changes**

In `client/settings/sections/admin/AdminUsersSection.svelte`:

a) In `add()`, capture the response and branch the status message (replace lines 46–51):

```typescript
const username = newUsername.trim()
const result = await addAdminUser(username === '' ? { userId } : { userId, username })
newUserId = ''
newUsername = ''
await load()
status = result.pending === true ? "User added — they'll be authorized when they first message the bot." : 'User added.'
```

b) Update the field hint (line 100):

```svelte
    <Field label="User ID or @username" hint="For Telegram, @username adds a pending entry that activates when the user first messages the bot">
```

c) In the `cell` snippet, render the badge for placeholder rows (replace the `platform_user_id` branch, lines 121–122):

```svelte
      {:else if col.key === 'platform_user_id'}
        {#if row.platform_user_id.startsWith('placeholder-')}
          <span class="pending-badge" data-testid="user-pending-badge">pending</span>
        {:else}
          <IdCell value={row.platform_user_id} />
        {/if}
```

d) Add a scoped style block at the end of the file (the component currently has none; follow the `.badge-required` idiom from `AdminPluginsConfigSection.svelte`):

```svelte
<style>
  .pending-badge {
    font-size: 10px;
    color: var(--fg2);
    border: 1px solid var(--border);
    padding: 1px 4px;
    border-radius: 2px;
  }
</style>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/sections/admin/AdminUsersSection.test.ts`
Expected: PASS — including the pre-existing add/remove/list tests.

- [ ] **Step 5: Commit**

```bash
git add tests/client/settings/sections/admin/AdminUsersSection.test.ts client/settings/sections/admin/AdminUsersSection.svelte
git commit -m "feat(settings-ui): pending badge and first-contact message for username adds"
```

---

### Task 7: Full verification

- [ ] **Step 1: Build client bundles (required before server suites on a clean tree)**

Run: `bun build:client`
Expected: bundles written to `public/`.

- [ ] **Step 2: Run all server suites**

Run: `bun run test`
Expected: PASS.

- [ ] **Step 3: Run all client suites**

Run: `bun test:client`
Expected: PASS.

- [ ] **Step 4: Full check**

Run: `bun check:full`
Expected: all checks pass (lint, typecheck, format, license-headers, duplicates, …).

- [ ] **Step 5: Mutation sanity on changed files (local-only, optional but recommended)**

Run: `bun test:mutate:changed`
Expected: no surviving mutants in the new code paths.
