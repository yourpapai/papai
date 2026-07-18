<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Admin Open DM Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the env-only `DEMO_MODE` auto-add with a per-platform-instance, admin-toggleable "open DM access" mode that auto-provisions a real `users` row on an unknown user's first DM, plus a durable per-user block.

**Architecture:** A new plain boolean column `platform_instances.open_dm_access` (read cheaply in the auth hot path) and a nullable `users.blocked_at` timestamp. `checkAuthorizationExtended` gains a block gate and an open-access auto-add branch, and loses all `DEMO_MODE`/`demo-auto`/`isDemoUser` logic. A bot-admin settings route toggles the flag and blocks/unblocks users; the Users settings UI gets a toggle, a source badge, and a block/unblock action.

**Tech Stack:** Bun, TypeScript (strict, `.js` import paths), Drizzle ORM + bun:sqlite, Zod v4, Svelte 5 (runes) settings SPA, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-06-18-admin-open-dm-access-design.md`

---

## Conventions for every task

- Run a single test file with: `bun test <path>` (serial, fine for one file). Full suite is `bun run test`.
- Never add lint-disable/ts-ignore comments — fix the underlying issue (hook policy blocks them).
- Every new `.ts` file starts with the 4-line SPDX header (copy from any existing `src/*.ts`).
- After each task, the TDD write-hook runs targeted tests automatically; still run the listed command yourself to confirm.

---

## Task 1: Migration 058 + schema columns

**Files:**

- Create: `src/db/migrations/058_open_dm_access.ts`
- Modify: `src/db/index.ts` (import + append to `MIGRATIONS`)
- Modify: `src/db/instance-schema.ts` (add `openDmAccess` column + ensure `integer` import)
- Modify: `src/db/schema.ts` (add `blockedAt` column to `users`)
- Test: `tests/db/migrations/058_open_dm_access.test.ts`

- [ ] **Step 1: Write the failing migration test**

Create `tests/db/migrations/058_open_dm_access.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'

import { MIGRATIONS } from '../../../src/db/index.js'
import { runMigrations } from '../../../src/db/migrate.js'
import { migration058OpenDmAccess } from '../../../src/db/migrations/058_open_dm_access.js'

const cols = (db: Database, table: string): string[] =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .map((r) => r.name)

describe('migration 058', () => {
  test('has correct id', () => {
    expect(migration058OpenDmAccess.id).toBe('058_open_dm_access')
  })

  test('adds open_dm_access to platform_instances and blocked_at to users', () => {
    const db = new Database(':memory:')
    runMigrations(db, MIGRATIONS)
    expect(cols(db, 'platform_instances')).toContain('open_dm_access')
    expect(cols(db, 'users')).toContain('blocked_at')
  })

  test('open_dm_access defaults to 0', () => {
    const db = new Database(':memory:')
    runMigrations(db, MIGRATIONS)
    db.run(`INSERT INTO platform_instances (id, type, config, status) VALUES ('x', 'telegram', 'cfg', 'active')`)
    const row = db
      .query<{ open_dm_access: number }, []>(`SELECT open_dm_access FROM platform_instances WHERE id='x'`)
      .get()
    expect(row?.open_dm_access).toBe(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/db/migrations/058_open_dm_access.test.ts`
Expected: FAIL — cannot resolve `../../../src/db/migrations/058_open_dm_access.js`.

- [ ] **Step 3: Create the migration**

Create `src/db/migrations/058_open_dm_access.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:058' })

const columnExists = (db: Database, table: string, column: string): boolean =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .some((row) => row.name === column)

const up = (db: Database): void => {
  if (!columnExists(db, 'platform_instances', 'open_dm_access')) {
    db.run(`ALTER TABLE platform_instances ADD COLUMN open_dm_access INTEGER NOT NULL DEFAULT 0`)
  }
  if (!columnExists(db, 'users', 'blocked_at')) {
    db.run(`ALTER TABLE users ADD COLUMN blocked_at TEXT`)
  }
  log.info('migration 058: open_dm_access + blocked_at added')
}

export const migration058OpenDmAccess: Migration = { id: '058_open_dm_access', up }

export default migration058OpenDmAccess
```

- [ ] **Step 4: Register the migration**

In `src/db/index.ts`, add the import alongside the other migration imports:

```typescript
import { migration058OpenDmAccess } from './migrations/058_open_dm_access.js'
```

Append it as the **last** element of the `MIGRATIONS` array (right after `migration057AttachmentGroupContext`):

```typescript
  migration057AttachmentGroupContext,
  migration058OpenDmAccess,
]
```

- [ ] **Step 5: Add the Drizzle schema columns**

In `src/db/instance-schema.ts`, ensure `integer` is imported from `drizzle-orm/sqlite-core` (add it to the existing `sqliteTable, text` import). Then add the column to the `platformInstances` table definition:

```typescript
export const platformInstances = sqliteTable('platform_instances', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  config: text('config').notNull(),
  status: text('status').notNull().default('pending'),
  openDmAccess: integer('open_dm_access', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
})
```

In `src/db/schema.ts`, add `blockedAt` to the `users` table columns (after `addedBy`, before `kaneoWorkspaceId`):

```typescript
    addedBy: text('added_by').notNull(),
    blockedAt: text('blocked_at'),
    kaneoWorkspaceId: text('kaneo_workspace_id'),
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `bun test tests/db/migrations/058_open_dm_access.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add src/db/migrations/058_open_dm_access.ts src/db/index.ts src/db/instance-schema.ts src/db/schema.ts tests/db/migrations/058_open_dm_access.test.ts
git commit -m "feat(db): migration 058 — open_dm_access + users.blocked_at"
```

---

## Task 2: Platform-store open-access read/write

**Files:**

- Modify: `src/instances/platform-store.ts` (add `isOpenDmAccessEnabled`, `setOpenDmAccess`)
- Test: `tests/instances/platform-store.test.ts` (extend)

**Note:** `platform_instances` has **no in-process cache** — these helpers read/write the column directly. `isOpenDmAccessEnabled` selects only the boolean column (no config decryption), keeping it cheap for the auth hot path.

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe('platform-store', ...)` block in `tests/instances/platform-store.test.ts` (and add the two new names to the import from `../../src/instances/platform-store.js`):

```typescript
test('open DM access defaults to false and toggles', () => {
  insertPlatformInstance({ id: 'oa', type: 'telegram', config: { token: 't' }, status: 'active' })
  expect(isOpenDmAccessEnabled('oa')).toBe(false)
  setOpenDmAccess('oa', true)
  expect(isOpenDmAccessEnabled('oa')).toBe(true)
  setOpenDmAccess('oa', false)
  expect(isOpenDmAccessEnabled('oa')).toBe(false)
})

test('isOpenDmAccessEnabled is false for missing instance', () => {
  expect(isOpenDmAccessEnabled('nope')).toBe(false)
})
```

Update the import line to include the new functions:

```typescript
import {
  deletePlatformInstance,
  getPlatformInstance,
  insertPlatformInstance,
  isOpenDmAccessEnabled,
  listActivePlatformInstancesSafe,
  listPlatformInstances,
  setOpenDmAccess,
  updatePlatformInstance,
} from '../../src/instances/platform-store.js'
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/instances/platform-store.test.ts`
Expected: FAIL — `isOpenDmAccessEnabled` is not exported.

- [ ] **Step 3: Implement the helpers**

In `src/instances/platform-store.ts`, add (the file already imports `eq`, `getDrizzleDb`, `platformInstances`, and a `log`):

```typescript
export const isOpenDmAccessEnabled = (id: string): boolean => {
  const row = getDrizzleDb()
    .select({ openDmAccess: platformInstances.openDmAccess })
    .from(platformInstances)
    .where(eq(platformInstances.id, id))
    .get()
  return row?.openDmAccess === true
}

export const setOpenDmAccess = (id: string, enabled: boolean): void => {
  getDrizzleDb().update(platformInstances).set({ openDmAccess: enabled }).where(eq(platformInstances.id, id)).run()
  log.info({ id, enabled }, 'open DM access updated')
}
```

(If `log` is not already defined in this file, reuse the existing logger child it uses for `updatePlatformInstance`'s `log.info`.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/instances/platform-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/instances/platform-store.ts tests/instances/platform-store.test.ts
git commit -m "feat(instances): open DM access read/write helpers"
```

---

## Task 3: User block helpers + listUsers/UserRecord, remove isDemoUser

**Files:**

- Modify: `src/users.ts` (add `blockUser`/`unblockUser`/`isBlocked`, extend `UserRecord` + `listUsers`, delete `isDemoUser`)
- Test: `tests/users.test.ts` (add block tests, remove `isDemoUser` suite)

- [ ] **Step 1: Write the failing tests**

In `tests/users.test.ts`, remove the `isDemoUser` from the import list and delete the entire `describe('isDemoUser', ...)` block (around lines 343–363). Add a new block (place near the other `describe`s; use the same imports the file already has — `addUser`/`isAuthorized` are imported there). Add `blockUser, unblockUser, isBlocked` to the `../../src/users.js` import:

```typescript
describe('user blocking', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()
  })

  test('isBlocked is false for unknown and unblocked users', () => {
    expect(isBlocked('nobody', 'telegram-default')).toBe(false)
    addUser({ userId: 'u1', platformInstanceId: 'telegram-default', addedBy: 'manual' })
    expect(isBlocked('u1', 'telegram-default')).toBe(false)
  })

  test('blockUser blocks an existing user and unblockUser reverses it', () => {
    addUser({ userId: 'u1', platformInstanceId: 'telegram-default', addedBy: 'manual' })
    expect(blockUser('u1', 'telegram-default')).toBe(true)
    expect(isBlocked('u1', 'telegram-default')).toBe(true)
    expect(unblockUser('u1', 'telegram-default')).toBe(true)
    expect(isBlocked('u1', 'telegram-default')).toBe(false)
  })

  test('blockUser returns false when no row exists', () => {
    expect(blockUser('ghost', 'telegram-default')).toBe(false)
  })

  test('listUsers includes added_by and blocked_at', () => {
    addUser({ userId: 'u1', platformInstanceId: 'telegram-default', addedBy: 'open-access' })
    blockUser('u1', 'telegram-default')
    const row = listUsers('telegram-default').find((u) => u.platform_user_id === 'u1')
    expect(row?.added_by).toBe('open-access')
    expect(row?.blocked_at).not.toBeNull()
  })
})
```

Confirm `listUsers`, `mockLogger`, `setupTestDb`, `seedCommonTestPlatformInstances`, and `beforeEach`/`describe`/`expect`/`test` are imported in the file (add any missing). Use the platform instance id that `seedCommonTestPlatformInstances` creates — `'telegram-default'` per the existing `isDemoUser` test; keep it consistent with that file's other tests.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/users.test.ts`
Expected: FAIL — `blockUser`/`unblockUser`/`isBlocked` not exported (and the deleted `isDemoUser` import is gone).

- [ ] **Step 3: Implement the helpers and remove isDemoUser**

In `src/users.ts`:

1. Add `blocked_at` to `UserRecord`:

```typescript
export interface UserRecord {
  platform_user_id: string
  platform_instance_id: string
  username: string | null
  added_at: string
  added_by: string
  blocked_at: string | null
}
```

2. Add `blocked_at` to the `listUsers` select:

```typescript
    .select({
      platform_user_id: users.platformUserId,
      platform_instance_id: users.platformInstanceId,
      username: users.username,
      added_at: users.addedAt,
      added_by: users.addedBy,
      blocked_at: users.blockedAt,
    })
```

3. Delete the entire `isDemoUser` function (lines ~212–221).

4. Add the block helpers (the file already imports `and`, `eq`, `sql`, `getDrizzleDb`, `users`, `evictUser`, `log`):

```typescript
export function blockUser(userId: string, platformInstanceId: string): boolean {
  log.debug({ platformInstanceId }, 'blockUser called')
  const db = getDrizzleDb()
  const updated = db
    .update(users)
    .set({ blockedAt: sql`(datetime('now'))` })
    .where(and(eq(users.platformUserId, userId), eq(users.platformInstanceId, platformInstanceId)))
    .returning({ platformUserId: users.platformUserId })
    .all()
  if (updated.length > 0) evictUser(userId)
  return updated.length > 0
}

export function unblockUser(userId: string, platformInstanceId: string): boolean {
  log.debug({ platformInstanceId }, 'unblockUser called')
  const db = getDrizzleDb()
  const updated = db
    .update(users)
    .set({ blockedAt: null })
    .where(and(eq(users.platformUserId, userId), eq(users.platformInstanceId, platformInstanceId)))
    .returning({ platformUserId: users.platformUserId })
    .all()
  if (updated.length > 0) evictUser(userId)
  return updated.length > 0
}

export function isBlocked(userId: string, platformInstanceId: string): boolean {
  const db = getDrizzleDb()
  const row = db
    .select({ blockedAt: users.blockedAt })
    .from(users)
    .where(and(eq(users.platformUserId, userId), eq(users.platformInstanceId, platformInstanceId)))
    .get()
  return row !== undefined && row.blockedAt !== null
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/users.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/users.ts tests/users.test.ts
git commit -m "feat(users): block/unblock/isBlocked helpers; drop isDemoUser"
```

---

## Task 4: Auth gate — block gate + open-access branch; remove DEMO_MODE; new deny reason

**Files:**

- Modify: `src/chat/types.ts` (add `'user_blocked'` to `AuthorizationDenyReason`)
- Modify: `src/auth.ts` (rewrite decision tree)
- Modify: `src/bot.ts` (message mapping for `user_blocked`)
- Test: `tests/auth.test.ts` (new file if absent, else extend) + migrate demo tests in `tests/bot.test.ts`

- [ ] **Step 1: Add the deny reason**

In `src/chat/types.ts`:

```typescript
export type AuthorizationDenyReason =
  | 'group_not_allowed'
  | 'group_member_not_allowed'
  | 'dm_not_allowed'
  | 'user_blocked'
```

- [ ] **Step 2: Write the failing auth test**

Create `tests/auth.test.ts` (if it does not already exist; if it does, add these tests to it):

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { checkAuthorizationExtended } from '../src/auth.js'
import { isOpenDmAccessEnabled, setOpenDmAccess } from '../src/instances/platform-store.js'
import { blockUser, isAuthorized } from '../src/users.js'
import { mockLogger, seedCommonTestPlatformInstances, setupTestDb } from './utils/test-helpers.js'

const PI = 'telegram-default'

describe('checkAuthorizationExtended — open DM access', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()
  })

  test('open access off: unknown DM user is denied with dm_not_allowed', () => {
    const auth = checkAuthorizationExtended('u-new', null, 'u-new', 'dm', undefined, false, PI)
    expect(auth.allowed).toBe(false)
    expect(auth.reason).toBe('dm_not_allowed')
    expect(isAuthorized('u-new', PI)).toBe(false)
  })

  test('open access on: unknown DM user is auto-added and allowed', () => {
    setOpenDmAccess(PI, true)
    const auth = checkAuthorizationExtended('u-open', 'opener', 'u-open', 'dm', undefined, false, PI)
    expect(auth.allowed).toBe(true)
    expect(auth.isBotAdmin).toBe(false)
    expect(isAuthorized('u-open', PI)).toBe(true)
  })

  test('open access on: blocked user is denied and not re-added', () => {
    setOpenDmAccess(PI, true)
    // first DM adds the user
    checkAuthorizationExtended('u-blk', null, 'u-blk', 'dm', undefined, false, PI)
    expect(blockUser('u-blk', PI)).toBe(true)
    const auth = checkAuthorizationExtended('u-blk', null, 'u-blk', 'dm', undefined, false, PI)
    expect(auth.allowed).toBe(false)
    expect(auth.reason).toBe('user_blocked')
  })

  test('open access on does not affect group contexts', () => {
    setOpenDmAccess(PI, true)
    const auth = checkAuthorizationExtended('u-grp', null, 'group-xyz', 'group', undefined, false, PI)
    expect(auth.allowed).toBe(false)
    expect(auth.reason).toBe('group_not_allowed')
  })

  test('isOpenDmAccessEnabled reflects the toggle', () => {
    expect(isOpenDmAccessEnabled(PI)).toBe(false)
    setOpenDmAccess(PI, true)
    expect(isOpenDmAccessEnabled(PI)).toBe(true)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun test tests/auth.test.ts`
Expected: FAIL — open-access branch not implemented (unknown DM user currently `dm_not_allowed`, blocked test fails, etc.).

- [ ] **Step 4: Rewrite `src/auth.ts`**

Replace the import on line 12 and remove the demo helper. Change the imports at the top:

```typescript
import { isAuthorizedGroup } from './authorized-groups.js'
import { toScopedContextId, toScopedThreadContextId } from './chat/scoped-context.js'
import type { AuthorizationResult, ContextType } from './chat/types.js'
import { isGroupMember } from './groups.js'
import { isAdmin } from './instances/admin-store.js'
import { isOpenDmAccessEnabled } from './instances/platform-store.js'
import { logger } from './logger.js'
import { addUser, isAuthorized, isBlocked, resolveUserByUsername } from './users.js'
```

Delete the entire `maybeAuthorizeDemoModeUser` function (lines ~111–130).

Replace `getAuthorizedUserAuth` (remove the `isDemoUser` branch):

```typescript
const getAuthorizedUserAuth = (
  userId: string,
  contextId: string,
  contextType: ContextType,
  threadId: string | undefined,
  isPlatformAdmin: boolean,
  platformInstanceId: string,
): AuthorizationResult => {
  if (contextType === 'dm') {
    return getDmUserAuth(userId, platformInstanceId)
  }
  return getGroupMemberAuth(contextId, contextType, threadId, isPlatformAdmin, platformInstanceId)
}
```

Add a blocked-auth helper next to `getUnauthorizedDmAuth`:

```typescript
const getBlockedAuth = (
  userId: string,
  contextId: string,
  contextType: ContextType,
  threadId: string | undefined,
  platformInstanceId: string,
): AuthorizationResult => {
  const base = contextType === 'dm' ? userId : contextId
  return {
    allowed: false,
    isBotAdmin: false,
    isGroupAdmin: false,
    storageContextId: getThreadScopedStorageContextId(base, contextType, threadId, platformInstanceId),
    configContextId: getThreadScopedStorageContextId(base, contextType, undefined, platformInstanceId),
    reason: 'user_blocked',
  }
}
```

Replace the body of `checkAuthorizationExtended` (the `demoModeAuth` block is removed; admin moves above the block gate so blocked admins still pass; open-access branch added):

```typescript
export const checkAuthorizationExtended = (
  userId: string,
  username: string | null,
  contextId: string,
  contextType: ContextType,
  threadId: string | undefined,
  isPlatformAdmin: boolean,
  platformInstanceId: string,
): AuthorizationResult => {
  log.debug({ userId, contextId, contextType, threadId }, 'Checking authorization')

  if (contextType === 'group' && !isAuthorizedGroup(getGroupConfigContextId(contextId, platformInstanceId))) {
    return getUnauthorizedGroupAuth(contextId, threadId, platformInstanceId, 'group_not_allowed')
  }

  if (isAdmin(userId, platformInstanceId)) {
    return getAdminAuth(userId, contextId, contextType, threadId, isPlatformAdmin, platformInstanceId)
  }

  if (isBlocked(userId, platformInstanceId)) {
    return getBlockedAuth(userId, contextId, contextType, threadId, platformInstanceId)
  }

  if (contextType === 'dm' && !isAuthorized(userId, platformInstanceId) && isOpenDmAccessEnabled(platformInstanceId)) {
    log.info({ userId, platformInstanceId }, 'Open DM access: auto-adding user')
    if (username === null) {
      addUser({ userId, platformInstanceId, addedBy: 'open-access' })
    } else {
      addUser({ userId, platformInstanceId, addedBy: 'open-access', username })
    }
    return getDmUserAuth(userId, platformInstanceId)
  }

  if (isAuthorized(userId, platformInstanceId)) {
    return getAuthorizedUserAuth(userId, contextId, contextType, threadId, isPlatformAdmin, platformInstanceId)
  }

  if (contextType === 'group') {
    return getUnauthenticatedGroupAuth(userId, contextId, contextType, threadId, isPlatformAdmin, platformInstanceId)
  }

  if (username !== null && resolveUserByUsername(userId, username, platformInstanceId)) {
    return getDmUserAuth(userId, platformInstanceId)
  }

  return getUnauthorizedDmAuth(userId, platformInstanceId)
}
```

- [ ] **Step 5: Map the new reason in `src/bot.ts`**

In `getUnauthorizedReplyText` (around line 52), add a branch returning the same generic copy as `dm_not_allowed` (do not reveal blocked status):

```typescript
if (auth.reason === 'dm_not_allowed') return 'You are not authorized to use this bot.'
if (auth.reason === 'user_blocked') return 'You are not authorized to use this bot.'
return null
```

- [ ] **Step 6: Run the auth test to verify it passes**

Run: `bun test tests/auth.test.ts`
Expected: PASS.

- [ ] **Step 7: Migrate the demo tests in `tests/bot.test.ts`**

`tests/bot.test.ts` has demo-mode tests at ~lines 351–398 and ~1774–1780 that set `process.env['DEMO_MODE']` and call `addUser(..., 'demo-auto', ...)`. Replace them with open-access equivalents: instead of `process.env['DEMO_MODE'] = 'true'`, call `setOpenDmAccess(<platformInstanceId>, true)` (import from `../src/instances/platform-store.js`); replace the `'demo-auto'` `addedBy` with `'open-access'`; delete the `delete process.env['DEMO_MODE']` lines. The assertions about auto-add/allow stay the same. Read those tests, port each, and ensure each ported test still asserts the same allow/deny outcome.

- [ ] **Step 8: Run the bot suite to verify it passes**

Run: `bun test tests/bot.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/chat/types.ts src/auth.ts src/bot.ts tests/auth.test.ts tests/bot.test.ts
git commit -m "feat(auth): open-access auto-add + block gate; remove DEMO_MODE branch"
```

---

## Task 5: Start command — remove demo logic

**Files:**

- Modify: `src/commands/start.ts` (delete `maybeAddDemoUser`, `StartCommandDeps`, `defaultDeps`, demo imports; simplify `registerStartCommand`)
- Modify: `src/bot.ts` (callsite already `registerStartCommand(observedChat)` — no signature arg, so it stays valid)
- Modify: `src/commands/catalog.ts` (no change to the `'registerStartCommand'` literal; verify it still compiles)
- Test: `tests/commands/start.test.ts` (replace demo suite with a welcome-message test)

**Note:** Under open access the auth gate auto-adds the user _before_ the command handler runs, so `/start` needs no add logic. `maybeAutoProvisionProvider` was only invoked from the demo path; it is dropped here (auto-provisioning task-providers for every open-access user is out of scope per the spec).

- [ ] **Step 1: Rewrite the start test**

Replace the entire body of `tests/commands/start.test.ts` with:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import type { CommandHandler } from '../../src/chat/types.js'
import { registerStartCommand } from '../../src/commands/start.js'
import { createMockChatWithCommandHandlers, createMockReply, mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('start command', () => {
  let handler: CommandHandler | null = null
  const { provider: mockChat, commandHandlers } = createMockChatWithCommandHandlers()

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    registerStartCommand(mockChat)
    handler = commandHandlers.get('start') ?? null
  })

  test('authorized user gets the welcome message', async () => {
    let captured: string | null = null
    const reply = {
      text: (): Promise<void> => Promise.resolve(),
      formatted: (content: string): Promise<void> => {
        captured = content
        return Promise.resolve()
      },
      file: (): Promise<void> => Promise.resolve(),
      typing: (): void => {},
      buttons: (): Promise<void> => Promise.resolve(),
    }
    const msg = {
      user: { id: 'u1', username: 'user', isAdmin: false },
      contextId: 'u1',
      contextType: 'dm' as const,
      text: '/start',
      platformInstanceId: 'test-instance',
      commandMatch: 'start',
      isMentioned: false,
    }
    await handler!(msg, reply, { allowed: true, isBotAdmin: false, isGroupAdmin: false, storageContextId: 'u1' })
    expect(captured).toContain('Welcome')
    expect(captured).toContain('/config')
  })

  test('unauthorized user gets the rejection message', async () => {
    let captured: string | null = null
    const reply = {
      text: (content: string): Promise<void> => {
        captured = content
        return Promise.resolve()
      },
      formatted: (): Promise<void> => Promise.resolve(),
      file: (): Promise<void> => Promise.resolve(),
      typing: (): void => {},
      buttons: (): Promise<void> => Promise.resolve(),
    }
    const msg = {
      user: { id: 'u2', username: 'user', isAdmin: false },
      contextId: 'u2',
      contextType: 'dm' as const,
      text: '/start',
      platformInstanceId: 'test-instance',
      commandMatch: 'start',
      isMentioned: false,
    }
    await handler!(msg, reply, { allowed: false, isBotAdmin: false, isGroupAdmin: false, storageContextId: 'u2' })
    expect(captured).toContain('not authorized')
  })
})
```

(If `createMockReply` is unused after writing, drop it from the import to satisfy lint.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/commands/start.test.ts`
Expected: FAIL — current `start.ts` still references `StartCommandDeps`/demo and the old suite is gone; the new test may fail on `import` mismatch or pass partially. Confirm a failure before editing source.

- [ ] **Step 3: Rewrite `src/commands/start.ts`**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ChatProvider, CommandHandler } from '../chat/types.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'commands:start' })

export function registerStartCommand(chat: ChatProvider): void {
  const handler: CommandHandler = async (msg, reply, auth) => {
    if (!auth.allowed) {
      await reply.text('You are not authorized to use this bot.')
      return
    }

    log.info({ userId: msg.user.id, contextId: auth.storageContextId }, '/start command executed')

    const welcomeMessage = `👋 **Welcome to papai!**

I'm your task management assistant. I can help you:

📋 **Create and manage tasks** via natural language
🔍 **Search and update** existing tasks
⚙️ **Configure integrations** with your task tracker

**Get Started:**
⚙️ **/config** - Open your settings (API keys, models, integrations) in the web UI
❓ **/help** - Show available commands

**Quick Tips:**
• Type your requests naturally (e.g., "create task: review PR #123")
• I'll remember our conversation context
• Use "/clear" to reset conversation history

Let's get you set up! 🎯`

    await reply.formatted(welcomeMessage)
  }

  chat.registerCommand('start', handler)
}
```

- [ ] **Step 4: Verify the callsite and catalog still compile**

`src/bot.ts:104` is `registerStartCommand(observedChat)` — already arity-1, no change needed. `src/commands/index.ts` re-exports `registerStartCommand` — unchanged. `src/commands/catalog.ts` references the string literal `'registerStartCommand'` — unchanged. The removed export `StartCommandDeps` is no longer imported anywhere (the only importer was the old `start.test.ts`).

- [ ] **Step 5: Run the test + typecheck**

Run: `bun test tests/commands/start.test.ts`
Expected: PASS.
Run: `bun run typecheck`
Expected: clean (no dangling `StartCommandDeps` references).

- [ ] **Step 6: Commit**

```bash
git add src/commands/start.ts tests/commands/start.test.ts
git commit -m "refactor(start): drop demo-mode auto-add; welcome-only handler"
```

---

## Task 6: Settings routes — open-access toggle, block/unblock, Users source/blocked

**Files:**

- Modify: `src/debug/settings/admin/system-access-routes.ts` (add `handleOpenAccess`, `handleUserBlock`, dispatch; Users GET already returns the new fields via `listUsers`)
- Modify: `src/debug/settings-api-router.ts` (route the two new paths)
- Test: `tests/debug/settings/admin/system-access-routes.test.ts` (extend or create)

- [ ] **Step 1: Write the failing route test**

Locate the existing test for these routes (search `tests/` for `system-access-routes` or `admin/users`). If one exists, extend it; otherwise create `tests/debug/settings/admin/system-access-routes.test.ts` following the local pattern used by other settings-route tests (they build a `Request` with a valid settings session + CSRF header and call the exported handler). Add tests asserting:

```typescript
// Pseudostructure — match the existing settings-route test harness in this repo:
// 1. GET /settings/api/admin/open-access returns { openDmAccess: false } by default.
// 2. POST /settings/api/admin/open-access { enabled: true } returns { ok: true, openDmAccess: true }
//    and isOpenDmAccessEnabled(principal.platformInstanceId) === true afterward.
// 3. POST /settings/api/admin/users/block { userId, blocked: true } sets blocked_at (isBlocked === true).
// 4. POST .../users/block { userId, blocked: false } clears it.
// 5. A request without bot-admin scope → 403; a write without CSRF → 403.
```

Use the same session/CSRF construction helpers the neighboring settings-route tests use (read one such test first to copy the harness exactly — do not invent a new auth-mocking approach).

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/debug/settings/admin/system-access-routes.test.ts`
Expected: FAIL — new paths return 404.

- [ ] **Step 3: Add the handlers and schemas**

In `src/debug/settings/admin/system-access-routes.ts`, add imports:

```typescript
import { isOpenDmAccessEnabled, setOpenDmAccess } from '../../../instances/platform-store.js'
import { addPendingUser, addUser, blockUser, listUsers, removeUser, unblockUser } from '../../../users.js'
```

(Replace the existing `users.js` import line with the one above.) Add the Zod schemas near the others:

```typescript
const OpenAccessBodySchema = z.object({ enabled: z.boolean() })
const UserBlockBodySchema = z.object({ userId: z.string().min(1), blocked: z.boolean() })
```

Add two handlers:

```typescript
async function handleOpenAccess(req: Request, authed: AuthenticatedSettingsRequest): Promise<Response> {
  if (req.method === 'GET') {
    const guard = requireAdmin(authed, 'read')
    if (guard !== null) return guard
    return settingsJson(200, { openDmAccess: isOpenDmAccessEnabled(authed.principal.platformInstanceId) })
  }
  if (req.method === 'POST') {
    const guard = requireAdmin(authed, 'write')
    if (guard !== null) return guard
    const csrf = requireCsrf(req, authed)
    if (csrf !== null) return csrf
    const parsed = await parseJsonBody(req)
    if (!parsed.ok) return parsed.response
    const body = OpenAccessBodySchema.safeParse(parsed.value)
    if (!body.success) return settingsJson(422, { error: 'invalid request' })
    setOpenDmAccess(authed.principal.platformInstanceId, body.data.enabled)
    log.info(
      { platformInstanceId: authed.principal.platformInstanceId, enabled: body.data.enabled },
      'open DM access set',
    )
    return settingsJson(200, { ok: true, openDmAccess: body.data.enabled })
  }
  return settingsJson(405, { error: 'method not allowed' })
}

async function handleUserBlock(req: Request, authed: AuthenticatedSettingsRequest): Promise<Response> {
  if (req.method !== 'POST') return settingsJson(405, { error: 'method not allowed' })
  const guard = requireAdmin(authed, 'write')
  if (guard !== null) return guard
  const csrf = requireCsrf(req, authed)
  if (csrf !== null) return csrf
  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = UserBlockBodySchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })
  const changed = body.data.blocked
    ? blockUser(body.data.userId, authed.principal.platformInstanceId)
    : unblockUser(body.data.userId, authed.principal.platformInstanceId)
  return settingsJson(200, { ok: changed })
}
```

Extend the dispatcher `handleAdminSystemAccessRoutes`:

```typescript
if (pathname === '/settings/api/admin/system') return handleSystem(req, auth.authed)
if (pathname === '/settings/api/admin/users') return handleUsers(req, auth.authed)
if (pathname === '/settings/api/admin/users/block') return handleUserBlock(req, auth.authed)
if (pathname === '/settings/api/admin/open-access') return handleOpenAccess(req, auth.authed)
if (pathname === '/settings/api/admin/groups') return handleGroups(req, auth.authed)
```

The Users GET already returns the new fields because `listUsers` now selects `added_by` and `blocked_at` (Task 3) — no change needed in `handleUsers`.

- [ ] **Step 4: Route the new paths in `src/debug/settings-api-router.ts`**

Extend the existing system/users/groups branch:

```typescript
if (
  url.pathname === '/settings/api/admin/system' ||
  url.pathname === '/settings/api/admin/users' ||
  url.pathname === '/settings/api/admin/users/block' ||
  url.pathname === '/settings/api/admin/open-access' ||
  url.pathname === '/settings/api/admin/groups'
) {
  return handleAdminSystemAccessRoutes(req, url, url.pathname)
}
```

- [ ] **Step 5: Run the route test to verify it passes**

Run: `bun test tests/debug/settings/admin/system-access-routes.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/debug/settings/admin/system-access-routes.ts src/debug/settings-api-router.ts tests/debug/settings/admin/system-access-routes.test.ts
git commit -m "feat(settings): open-access toggle + user block/unblock routes"
```

---

## Task 7: Client fetchers + schemas

**Files:**

- Modify: `client/settings/fetcher-schemas.ts` (extend `AdminUserRowSchema`; add `OpenAccessResponseSchema`)
- Modify: `client/settings/admin-fetchers.ts` (add `fetchOpenAccess`, `patchOpenAccess`, `setUserBlocked`)
- Test: `tests/client/settings/admin-fetchers.test.ts` (if the repo has fetcher tests; otherwise covered by the component test in Task 8)

- [ ] **Step 1: Extend the schemas**

In `client/settings/fetcher-schemas.ts`, replace `AdminUserRowSchema` and add the open-access schema:

```typescript
export const AdminUserRowSchema = z
  .object({
    platform_user_id: z.string(),
    platform_instance_id: z.string(),
    username: z.string().nullable().optional(),
    added_by: z.string().optional(),
    blocked_at: z.string().nullable().optional(),
  })
  .loose()
export const AdminUsersResponseSchema = z.object({ users: z.array(AdminUserRowSchema) })
export type AdminUserRow = z.infer<typeof AdminUserRowSchema>
export type AdminUsersResponse = z.infer<typeof AdminUsersResponseSchema>

export const OpenAccessResponseSchema = z.object({ openDmAccess: z.boolean() }).loose()
export type OpenAccessResponse = z.infer<typeof OpenAccessResponseSchema>
```

- [ ] **Step 2: Add the fetchers**

In `client/settings/admin-fetchers.ts`, near the user fetchers, add (import `OpenAccessResponse`/`OpenAccessResponseSchema` from `./fetcher-schemas.js`):

```typescript
export const fetchOpenAccess = (): Promise<OpenAccessResponse> =>
  getJson('/settings/api/admin/open-access', (b) => OpenAccessResponseSchema.parse(b))

export const patchOpenAccess = (input: { enabled: boolean }): Promise<unknown> =>
  writeJson('/settings/api/admin/open-access', 'POST', input, (b) => b)

export const setUserBlocked = (input: { userId: string; blocked: boolean }): Promise<unknown> =>
  writeJson('/settings/api/admin/users/block', 'POST', input, (b) => b)
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add client/settings/fetcher-schemas.ts client/settings/admin-fetchers.ts
git commit -m "feat(settings-client): open-access + block fetchers and schemas"
```

---

## Task 8: Users settings UI — toggle, source badge, block/unblock

**Files:**

- Modify: `client/settings/sections/admin/AdminUsersSection.svelte`
- Test: `tests/client/settings/AdminUsersSection.test.ts` (create, happy-dom)

**Resolution semantics in the UI:** when open access is ON, the recommended revoke action is **Block** (a removed user re-adds on next DM). The component therefore shows a Block/Unblock action per row in addition to Remove.

- [ ] **Step 1: Write the failing component test**

Create `tests/client/settings/AdminUsersSection.test.ts`. Follow the existing client-test pattern (search `tests/client/settings/` for a section test that mounts a Svelte component with happy-dom and mocks `settingsFetch`/fetchers). Assert:

```typescript
// Pseudostructure — match the existing client section-test harness:
// 1. With fetchOpenAccess resolving { openDmAccess: false }, the toggle renders "off" state.
// 2. Clicking the toggle calls patchOpenAccess({ enabled: true }).
// 3. A user row with added_by:'open-access' shows an "open-access" source badge.
// 4. A user row with blocked_at set shows an "Unblock" action; clicking calls
//    setUserBlocked({ userId, blocked: false }).
// 5. A non-blocked row shows a "Block" action calling setUserBlocked({ userId, blocked: true }).
```

Mock the fetchers via the same mechanism neighboring tests use (module mock or injected fetch). Read one existing client section test first and copy its harness exactly.

- [ ] **Step 2: Run to verify it fails**

Run: `bun test:client tests/client/settings/AdminUsersSection.test.ts`
Expected: FAIL — toggle/badge/actions not present.

- [ ] **Step 3: Implement the component**

Rewrite `client/settings/sections/admin/AdminUsersSection.svelte`. Keep the existing add-user form and Remove flow; add the open-access toggle, a `source`/`blocked` derived field, and a Block/Unblock action. Full file:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->

<script lang="ts">
  import {
    addAdminUser,
    fetchAdminUsers,
    fetchOpenAccess,
    patchOpenAccess,
    removeAdminUser,
    setUserBlocked,
  } from '../../admin-fetchers.js'
  import type { AdminUserRow } from '../../fetcher-schemas.js'
  import Confirm from '../../../shared/Confirm.svelte'
  import Btn from '../../../shared/ui/Btn.svelte'
  import Field from '../../../shared/ui/Field.svelte'
  import IconButton from '../../../shared/ui/IconButton.svelte'
  import Input from '../../../shared/ui/Input.svelte'
  import PageHeader from '../../../shared/ui/PageHeader.svelte'
  import SettingsTable from '../../components/SettingsTable.svelte'
  import IdCell from '../../components/IdCell.svelte'

  let users: AdminUserRow[] = $state([])
  let openDmAccess = $state(false)
  let togglingAccess = $state(false)
  let error: string | null = $state(null)
  let status: string | null = $state(null)
  let loading = $state(false)
  let newUserId = $state('')
  let newUsername = $state('')
  let pendingRemoval: string | null = $state(null)
  let blocking: string | null = $state(null)
  const pendingRemovalLabel = $derived(pendingRemoval ?? '')

  async function load(): Promise<void> {
    error = null
    status = null
    loading = true
    try {
      users = (await fetchAdminUsers()).users
      openDmAccess = (await fetchOpenAccess()).openDmAccess
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  async function toggleAccess(): Promise<void> {
    error = null
    status = null
    togglingAccess = true
    try {
      await patchOpenAccess({ enabled: !openDmAccess })
      await load()
      status = openDmAccess ? 'Open DM access disabled.' : 'Open DM access enabled.'
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      togglingAccess = false
    }
  }

  async function add(): Promise<void> {
    error = null
    status = null
    const userId = newUserId.trim()
    if (userId === '') return
    try {
      const username = newUsername.trim()
      const result = await addAdminUser(username === '' ? { userId } : { userId, username })
      newUserId = ''
      newUsername = ''
      await load()
      status =
        result.pending === true ? "User added — they'll be authorized when they first message the bot." : 'User added.'
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  async function remove(userId: string): Promise<void> {
    error = null
    status = null
    try {
      await removeAdminUser({ userId })
      await load()
      status = 'User removed.'
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  async function toggleBlock(userId: string, blocked: boolean): Promise<void> {
    error = null
    status = null
    blocking = userId
    try {
      await setUserBlocked({ userId, blocked })
      await load()
      status = blocked ? 'User blocked.' : 'User unblocked.'
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      blocking = null
    }
  }

  $effect(() => {
    void load()
  })

  interface UserRow {
    platform_user_id: string
    username: string
    source: string
    blocked: boolean
  }

  const userRows = $derived<UserRow[]>(
    users.map((u) => ({
      platform_user_id: u.platform_user_id,
      username: u.username ?? '—',
      source: u.added_by ?? '—',
      blocked: u.blocked_at != null,
    })),
  )

  const userColumns = [
    { key: 'platform_user_id' as const, label: 'User ID' },
    { key: 'username' as const, label: 'Username' },
    { key: 'source' as const, label: 'Source' },
    { key: 'actions' as const, label: '', align: 'right' as const },
  ]
</script>

<section id="users" class="settings-section">
  <PageHeader eyebrow="Admin · Access" title="Users">
    {#snippet action()}
      <IconButton label="Refresh" glyph="⟳" busy={loading} onClick={() => void load()} testid="users-refresh" />
    {/snippet}
  </PageHeader>

  {#if error !== null}<p class="status-error">{error}</p>{/if}
  {#if status !== null}<p class="status-success">{status}</p>{/if}

  <div class="open-access-card" data-testid="open-access-card">
    <div>
      <strong>Open DM access</strong>
      <p class="open-access-hint">
        Anyone can DM this bot. New users are added automatically and listed below; block individuals to revoke.
      </p>
    </div>
    <Btn
      variant={openDmAccess ? 'danger' : 'primary'}
      size="sm"
      testid="open-access-toggle"
      disabled={togglingAccess}
      onClick={() => void toggleAccess()}>
      {#snippet children()}{togglingAccess ? 'Saving…' : openDmAccess ? 'Disable' : 'Enable'}{/snippet}
    </Btn>
  </div>

  <form
    class="settings-form"
    onsubmit={(event) => {
      event.preventDefault()
      void add()
    }}>
    <Field
      label="User ID or @username"
      hint="For Telegram, @username adds a pending entry that activates when the user first messages the bot">
      {#snippet children()}
        <Input value={newUserId} onInput={(v) => (newUserId = v)} testid="user-add-input" placeholder="123456789 or @username" />
      {/snippet}
    </Field>
    <Field label="Username" hint="optional">
      {#snippet children()}
        <Input value={newUsername} onInput={(v) => (newUsername = v)} />
      {/snippet}
    </Field>
    <Btn variant="primary" type="submit" testid="user-add">
      {#snippet children()}Add user{/snippet}
    </Btn>
  </form>

  <div class="settings-table-wrap">
    {#snippet cell(row: UserRow, col: { key: string; label: string })}
      {#if col.key === 'actions'}
        <Btn
          variant={row.blocked ? 'secondary' : 'danger'}
          size="sm"
          testid={`user-block-${row.platform_user_id}`}
          disabled={blocking === row.platform_user_id}
          onClick={() => void toggleBlock(row.platform_user_id, !row.blocked)}>
          {#snippet children()}{row.blocked ? 'Unblock' : 'Block'}{/snippet}
        </Btn>
        <Btn
          variant="danger"
          size="sm"
          testid={`user-remove-${row.platform_user_id}`}
          onClick={() => (pendingRemoval = row.platform_user_id)}>
          {#snippet children()}Remove{/snippet}
        </Btn>
      {:else if col.key === 'platform_user_id'}
        {#if row.platform_user_id.startsWith('placeholder-')}
          <span class="pending-badge" data-testid="user-pending-badge">pending</span>
        {:else}
          <IdCell value={row.platform_user_id} />
        {/if}
      {:else if col.key === 'source'}
        <span class="source-badge" data-testid={`user-source-${row.platform_user_id}`}>{row.source}</span>
      {:else}
        {String(row[col.key as keyof UserRow] ?? '')}
      {/if}
    {/snippet}
    <SettingsTable
      columns={userColumns}
      rows={userRows}
      rowKey="platform_user_id"
      searchKeys={['platform_user_id', 'username']}
      {cell}
      searchPlaceholder="Search users by ID or name…">
      {#snippet empty()}No users{/snippet}
    </SettingsTable>
  </div>

  <Confirm
    open={pendingRemoval !== null}
    title="Remove user"
    danger
    confirmLabel="Remove"
    onCancel={() => (pendingRemoval = null)}
    onConfirm={() => {
      const id = pendingRemoval
      pendingRemoval = null
      if (id !== null) void remove(id)
    }}>
    {#snippet body()}<p>Remove user {pendingRemovalLabel}? This cannot be undone.</p>{/snippet}
  </Confirm>
</section>

<style>
  .pending-badge,
  .source-badge {
    font-size: 10px;
    color: var(--fg2);
    border: 1px solid var(--border);
    padding: 1px 4px;
    border-radius: 2px;
  }
  .open-access-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 10px 12px;
    margin-bottom: 12px;
  }
  .open-access-hint {
    font-size: 12px;
    color: var(--fg2);
    margin: 2px 0 0;
  }
</style>
```

- [ ] **Step 4: Run the component test to verify it passes**

Run: `bun test:client tests/client/settings/AdminUsersSection.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/settings/sections/admin/AdminUsersSection.svelte tests/client/settings/AdminUsersSection.test.ts
git commit -m "feat(settings-ui): open-access toggle + user source badge + block/unblock"
```

---

## Task 9: Remove DEMO_MODE from remaining tests/docs + regression guard

**Files:**

- Modify: `tests/llm-orchestrator.test.ts` (drop the `DEMO_MODE` env save/restore plumbing now that nothing reads it)
- Modify: `CLAUDE.md` (remove `DEMO_MODE` from "Optional runtime flags"; document the open-access toggle)
- Modify: `docs/research/billing/06-papai-integration-notes.md` (update the note that references `DEMO_MODE`, if it asserts current behavior)
- Test: `tests/no-demo-mode.test.ts` (regression guard)

**Note:** `src/index.ts` does **not** reference `DEMO_MODE` (verified by grep) — nothing to change there. Do not edit files under `docs/archive/**` (historical plans).

- [ ] **Step 1: Write the regression guard test**

Create `tests/no-demo-mode.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { Glob } from 'bun'
import { readFileSync } from 'node:fs'

describe('DEMO_MODE is fully removed from src', () => {
  test('no src file references DEMO_MODE, isDemoUser, or demo-auto', async () => {
    const glob = new Glob('src/**/*.ts')
    const offenders: string[] = []
    for await (const file of glob.scan('.')) {
      const text = readFileSync(file, 'utf8')
      if (/DEMO_MODE|isDemoUser|demo-auto/.test(text)) offenders.push(file)
    }
    expect(offenders).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify current state**

Run: `bun test tests/no-demo-mode.test.ts`
Expected: PASS if Tasks 3–5 are complete (all `src/` references already removed). If it FAILS, the listed file still references the symbols — remove them before continuing.

- [ ] **Step 3: Clean `tests/llm-orchestrator.test.ts`**

Remove the now-pointless `DEMO_MODE` env plumbing: the `originalDemoMode` capture (~line 256), the `delete process.env['DEMO_MODE']` (~line 351), and the restore in teardown (~lines 363–364). The behavioral coverage comment (~line 1426) can stay or be updated to drop the `DEMO_MODE` mention. Run `bun test tests/llm-orchestrator.test.ts` afterward — Expected: PASS.

- [ ] **Step 4: Update `CLAUDE.md`**

In the "Optional runtime flags" line, remove `DEMO_MODE`. Add a sentence under the authorization bullets (near the Users note) describing the toggle, e.g.:

> Open DM access is a per-platform-instance toggle (admin "Users" section → `open_dm_access` column). When on, an unknown user's first DM auto-provisions a `users` row (`added_by = 'open-access'`) and is granted normal DM auth; admins can durably block individuals (`users.blocked_at`). It replaces the removed `DEMO_MODE` env flag.

Update `docs/research/billing/06-papai-integration-notes.md` only if its `DEMO_MODE` reference states current behavior (change it to reference open DM access); if it is purely historical narrative, leave it.

- [ ] **Step 5: Run the regression guard + full check**

Run: `bun test tests/no-demo-mode.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/llm-orchestrator.test.ts tests/no-demo-mode.test.ts CLAUDE.md docs/research/billing/06-papai-integration-notes.md
git commit -m "chore: purge DEMO_MODE from tests/docs; add regression guard"
```

---

## Task 10: Full verification

- [ ] **Step 1: Build clients (required before debug-server suites on a clean tree)**

Run: `bun build:client`
Expected: bundles written to `public/`.

- [ ] **Step 2: Run the full server suite**

Run: `bun run test`
Expected: all pass. If a previously-passing demo test was missed, fix it (port to open-access or delete).

- [ ] **Step 3: Run the client suite**

Run: `bun test:client`
Expected: all pass.

- [ ] **Step 4: Full check (lint + typecheck + format + license headers)**

Run: `bun check:full`
Expected: all checks pass.

- [ ] **Step 5: Manual smoke (optional but recommended)**

With a local bot + settings UI: as bot admin, open `/config`, go to Users, toggle **Open DM access** on. From a non-authorized account, DM the bot — it should respond and appear in the Users list with source `open-access`. Click **Block** on that user; from that account, DM again — it should be rejected. Click **Unblock**; DM again — allowed.

- [ ] **Step 6: Final commit (if any doc/cleanup remains)**

```bash
git add -A
git commit -m "test: full-suite green for open DM access"
```

---

## Self-review notes (addressed)

- **Spec coverage:** open-access column + auth branch (T1, T4), per-user block (T1, T3, T4), settings toggle + block routes (T6), UI toggle + source + block (T8), DEMO_MODE removal (T4, T5, T9). All spec sections map to a task.
- **`src/index.ts`:** spec mentioned env-validation removal there, but grep shows no `DEMO_MODE` reference — corrected in T9 (docs/tests only).
- **No cache invalidation:** spec assumed an instance cache; there is none — T2 reads/writes the column directly (corrected).
- **Type consistency:** `isOpenDmAccessEnabled`/`setOpenDmAccess`, `blockUser`/`unblockUser`/`isBlocked`, `fetchOpenAccess`/`patchOpenAccess`/`setUserBlocked`, `OpenAccessResponseSchema`, and the `'user_blocked'` reason are used consistently across server, client, and tests.
- **Block on non-existent row:** `blockUser` returns `false` (no row), surfaced as `{ ok: false }` — admins block from the Users list, which only lists existing rows.
