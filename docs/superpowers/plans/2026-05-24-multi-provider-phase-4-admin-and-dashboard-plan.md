<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Multi-Provider Phase 4 Admin And Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Phase 4 admin authorization and the `/admin#instances` dashboard/API for managing platform instances, task instances, and admins.

**Architecture:** Backend work extends the Phase 1 instance stores and Phase 3 `ChatRouter` instead of adding a parallel runtime model. Authorization is source-platform scoped: inbound messages carry `platformInstanceId`, admin checks read `admins`, and user authorization reads `users.platform_instance_id`. Dashboard routes are small JSON handlers under `src/debug/instance-routes.ts`; the Svelte admin client consumes the same server-masked data shape.

**Tech Stack:** Bun runtime/test runner, TypeScript, Drizzle SQLite schema, Zod v4 validation, Svelte admin client, oxlint/oxfmt/Knip.

---

## Current Context

- Phase 1 already created `platform_instances`, `task_instances`, `context_settings`, and `admins` via migration `040_platform_instances`.
- Migration `040_platform_instances` also added `users.platform_instance_id`, but `src/db/schema.ts` and `src/users.ts` do not expose or use it yet.
- Phase 3 added `IncomingMessage.platformInstanceId`, `IncomingInteraction.platformInstanceId`, `ChatRouter.addInstance()`, `ChatRouter.removeInstance()`, and `ChatRouter.startInstance()`, but not `ChatRouter.listInstances()`.
- `src/auth.ts` still checks `process.env.ADMIN_USER_ID` and `isAuthorized(userId)` without a platform instance parameter.
- `src/commands/admin.ts` still accepts only the original single env admin and writes global user rows.
- `src/commands/plugin.ts` still treats `adminUserId` / `auth.isBotAdmin` as plugin trust authority.
- `src/debug/server.ts` already serves `/admin`, `/admin/llm`, `/stats/*`, and `/billing/*`; add instance routes there.
- `client/admin/AdminApp.svelte` currently mounts Overview, Billing, Stats, Memos, Reminders, Identities, Groups, and System sections; add Instances beside System.

## File Structure

### Backend Data And Auth

- Modify `src/db/schema.ts`
  - Add `users.platformInstanceId` and an index for scoped auth queries.
- Create `src/db/migrations/041_users_platform_instance_index.ts`
  - Add an index for `users(platform_instance_id, platform_user_id)` and `users(platform_instance_id, username)`.
- Modify `src/db/index.ts`
  - Register migration 041.
- Modify `src/users.ts`
  - Replace global user auth helpers with platform-scoped helpers.
- Modify `src/auth.ts`
  - Add `platformInstanceId` to `checkAuthorizationExtended()` and derive bot-admin status from `admins`.
- Modify `src/bot.ts`
  - Pass `msg.platformInstanceId` into auth and check helper paths.
- Modify `src/chat/discord/button-dispatch.ts`, `src/chat/telegram/index.ts`, `src/chat/mattermost/index.ts` only if direct calls to `checkAuthorizationExtended()` need the new argument.

### Command Re-Scoping

- Modify `src/commands/admin.ts`
  - Gate `/user`, `/users`, and `/announce` through `isAdmin(msg.user.id, msg.platformInstanceId)`.
  - Scope `/user add`, `/user remove`, and `/users` to the source platform instance.
- Modify `src/commands/plugin.ts`
  - Gate `approve` / `reject` on `isSuperAdmin()`.
  - Gate `list` / `info` on any admin for the source instance.
  - Gate `enable` / `disable` by target context's `context_settings.platform_instance_id`.
- Modify `src/instances/admin-store.ts`
  - Add `isSuperAdmin()`, `isPlatformAdmin()`, and `listAdmins()`.

### Router Apply And API

- Modify `src/chat/router.ts`
  - Add readonly `listInstances()`.
- Create `src/debug/chat-router-runtime.ts`
  - Store and clear the active router for debug API apply calls.
- Modify `src/index.ts`
  - Register the active `ChatRouter` in `chat-router-runtime.ts` after constructing it and clear it during shutdown.
- Create `src/debug/instance-routes.ts`
  - Implement JSON CRUD handlers, validation, masking, and apply reconciliation.
- Modify `src/debug/server.ts`
  - Route `/api/platform-instances`, `/api/task-instances`, and `/api/admins` to `instance-routes.ts`.

### Admin Client

- Modify `client/shared/api-types.ts`
  - Add shared instance/admin response types.
- Modify `client/admin/fetcher-schemas.ts`
  - Add Zod schemas for platform instances, task instances, admins, and apply responses.
- Modify `client/admin/fetchers.ts`
  - Add fetch/submit/delete helpers for the new API.
- Modify `client/admin/admin.svelte.ts`
  - Add `instances` to `adminSections`.
- Modify `client/admin/AdminApp.svelte`
  - Mount `InstancesSection` and add `instances` to scroll-spy IDs.
- Create `client/admin/sections/InstancesSection.svelte`
  - Render the three Phase 4 tables/forms.
- Create `tests/client/admin/sections/InstancesSection.test.ts`
  - Cover rendering and form submissions.

## Task 1: Platform-Scoped Users And Schema

**Files:**

- Modify: `src/db/schema.ts`
- Create: `src/db/migrations/041_users_platform_instance_index.ts`
- Modify: `src/db/index.ts`
- Modify: `src/users.ts`
- Modify: `tests/users.test.ts`
- Test: `tests/users.test.ts`

- [ ] **Step 1: Write failing tests for scoped users**

Append these tests to `tests/users.test.ts` and update imports to include `addAdmin` and `SUPER_ADMIN_PLATFORM_ID` from `../src/instances/admin-store.js`.

```typescript
import { addAdmin, SUPER_ADMIN_PLATFORM_ID } from '../src/instances/admin-store.js'

describe('platform-scoped authorization', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('authorizes only on the platform instance where the user was added', () => {
    addUser({ userId: '111', platformInstanceId: 'telegram-default', addedBy: 'admin-1' })

    expect(isAuthorized('111', 'telegram-default')).toBe(true)
    expect(isAuthorized('111', 'discord-default')).toBe(false)
  })

  test('super-admin is authorized on every platform instance without a users row', () => {
    addAdmin('root', SUPER_ADMIN_PLATFORM_ID)

    expect(isAuthorized('root', 'telegram-default')).toBe(true)
    expect(isAuthorized('root', 'discord-default')).toBe(true)
  })

  test('username placeholder resolution is scoped by platform instance', () => {
    addUser({
      userId: 'placeholder-alice',
      platformInstanceId: 'telegram-default',
      addedBy: 'admin-1',
      username: 'alice',
    })

    expect(resolveUserByUsername('telegram-real', 'alice', 'discord-default')).toBe(false)
    expect(resolveUserByUsername('telegram-real', 'alice', 'telegram-default')).toBe(true)
    expect(isAuthorized('telegram-real', 'telegram-default')).toBe(true)
  })

  test('listUsers can return only one platform instance', () => {
    addUser({ userId: 'tg-user', platformInstanceId: 'telegram-default', addedBy: 'admin-1' })
    addUser({ userId: 'ds-user', platformInstanceId: 'discord-default', addedBy: 'admin-1' })

    expect(listUsers('telegram-default').map((u) => u.platform_user_id)).toEqual(['tg-user'])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test ./tests/users.test.ts`

Expected: FAIL with TypeScript/runtime errors because `addUser()` still accepts positional arguments and `isAuthorized()` / `resolveUserByUsername()` do not accept `platformInstanceId`.

- [ ] **Step 3: Create migration 041**

Create `src/db/migrations/041_users_platform_instance_index.ts` with this content:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:041' })

const up = (db: Database): void => {
  db.run(`CREATE INDEX IF NOT EXISTS idx_users_platform_user ON users (platform_instance_id, platform_user_id)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_users_platform_username ON users (platform_instance_id, username)`)
  log.info('migration 041: users platform-scope indexes created')
}

export const migration041UsersPlatformInstanceIndex: Migration = {
  id: '041_users_platform_instance_index',
  up,
}
```

- [ ] **Step 4: Register migration 041**

In `src/db/index.ts`, add the import after migration 040:

```typescript
import { migration041UsersPlatformInstanceIndex } from './migrations/041_users_platform_instance_index.js'
```

Add it to `MIGRATIONS` after `migration040PlatformInstances`:

```typescript
  migration040PlatformInstances,
  migration041UsersPlatformInstanceIndex,
]
```

- [ ] **Step 5: Add `platformInstanceId` to the Drizzle users schema**

Replace the current `users` declaration in `src/db/schema.ts` with this version:

```typescript
export const users = sqliteTable(
  'users',
  {
    platformUserId: text('platform_user_id').primaryKey(),
    platformInstanceId: text('platform_instance_id'),
    username: text('username').unique(),
    addedAt: text('added_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    addedBy: text('added_by').notNull(),
    kaneoWorkspaceId: text('kaneo_workspace_id'),
  },
  (table) => [
    index('idx_users_platform_user').on(table.platformInstanceId, table.platformUserId),
    index('idx_users_platform_username').on(table.platformInstanceId, table.username),
  ],
)
```

- [ ] **Step 6: Replace `src/users.ts` helper signatures and queries**

Change the exported user record and add-user input to this shape:

```typescript
export interface UserRecord {
  platform_user_id: string
  platform_instance_id: string | null
  username: string | null
  added_at: string
  added_by: string
}

export interface AddUserInput {
  userId: string
  platformInstanceId: string
  addedBy: string
  username?: string
}
```

Replace `addUser`, `removeUser`, `isAuthorized`, `resolveUserByUsername`, and `listUsers` with platform-scoped versions:

```typescript
export function addUser(input: AddUserInput): void {
  log.debug(
    { hasUsername: input.username !== undefined, platformInstanceId: input.platformInstanceId },
    'addUser called',
  )
  const db = getDrizzleDb()

  db.insert(users)
    .values({
      platformUserId: input.userId,
      platformInstanceId: input.platformInstanceId,
      username: input.username ?? null,
      addedBy: input.addedBy,
    })
    .onConflictDoUpdate({
      target: users.platformUserId,
      set: { username: input.username ?? null, platformInstanceId: input.platformInstanceId },
    })
    .run()

  log.info({ hasUsername: input.username !== undefined, platformInstanceId: input.platformInstanceId }, 'User added')
}

export function removeUser(identifier: string, platformInstanceId: string): boolean {
  log.debug({ platformInstanceId }, 'removeUser called')
  const db = getDrizzleDb()

  const deleted = db
    .delete(users)
    .where(
      and(
        eq(users.platformInstanceId, platformInstanceId),
        or(eq(users.username, identifier), eq(users.platformUserId, identifier)),
      ),
    )
    .returning({ platformUserId: users.platformUserId })
    .all()

  for (const row of deleted) evictUser(row.platformUserId)
  return deleted.length > 0
}

export function isAuthorized(userId: string, platformInstanceId: string): boolean {
  log.debug({ platformInstanceId }, 'isAuthorized called')
  if (isAdmin(userId, platformInstanceId)) return true
  const row = getDrizzleDb()
    .select({ platformUserId: users.platformUserId })
    .from(users)
    .where(and(eq(users.platformUserId, userId), eq(users.platformInstanceId, platformInstanceId)))
    .get()

  return row !== undefined
}

export function resolveUserByUsername(userId: string, username: string, platformInstanceId: string): boolean {
  log.debug({ platformInstanceId }, 'resolveUserByUsername called')
  const db = getDrizzleDb()

  const row = db
    .select({ platformUserId: users.platformUserId })
    .from(users)
    .where(and(eq(users.username, username), eq(users.platformInstanceId, platformInstanceId)))
    .get()

  if (row === undefined) return false
  if (row.platformUserId === userId) return true

  db.update(users)
    .set({ platformUserId: userId })
    .where(and(eq(users.username, username), eq(users.platformInstanceId, platformInstanceId)))
    .run()

  log.info({ platformInstanceId }, 'User platform_user_id resolved from username')
  return true
}

export function listUsers(platformInstanceId?: string): UserRecord[] {
  log.debug({ platformInstanceId }, 'listUsers called')
  const db = getDrizzleDb()
  const base = db
    .select({
      platform_user_id: users.platformUserId,
      platform_instance_id: users.platformInstanceId,
      username: users.username,
      added_at: users.addedAt,
      added_by: users.addedBy,
    })
    .from(users)

  if (platformInstanceId === undefined) return base.all()
  return base.where(eq(users.platformInstanceId, platformInstanceId)).all()
}
```

Add these imports at the top of `src/users.ts`:

```typescript
import { and, eq, or } from 'drizzle-orm'
import { isAdmin } from './instances/admin-store.js'
```

- [ ] **Step 7: Update existing tests in `tests/users.test.ts` to call the new API**

Replace old calls like this:

```typescript
addUser('111', '999')
expect(isAuthorized('111')).toBe(true)
removeUser('111')
```

with this scoped form:

```typescript
addUser({ userId: '111', platformInstanceId: 'telegram-default', addedBy: '999' })
expect(isAuthorized('111', 'telegram-default')).toBe(true)
removeUser('111', 'telegram-default')
```

- [ ] **Step 8: Run tests to verify the task passes**

Run: `bun test ./tests/users.test.ts`

Expected: PASS.

- [ ] **Step 9: Run focused type and lint checks**

Run: `bun typecheck`

Expected: PASS after all internal call sites are updated in later tasks; if this task is implemented in isolation, failures should point only to old `addUser` / `isAuthorized` call sites to be fixed in Tasks 2 and 3.

Run: `bun lint:agent-strict -- src/users.ts src/db/schema.ts tests/users.test.ts`

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/db/schema.ts src/db/index.ts src/db/migrations/041_users_platform_instance_index.ts src/users.ts tests/users.test.ts
git commit -m "feat(auth): scope authorized users by platform instance"
```

### Task 2: Runtime Authorization Uses Admin Rows

**Files:**

- Modify: `src/instances/admin-store.ts`
- Modify: `src/auth.ts`
- Modify: `src/bot.ts`
- Modify: adapter files with direct auth calls if typecheck identifies them
- Test: `tests/auth.test.ts`
- Test: `tests/bot.test.ts`

- [ ] **Step 1: Write failing auth tests**

Add these tests to `tests/auth.test.ts`:

```typescript
import { addAdmin, SUPER_ADMIN_PLATFORM_ID } from '../src/instances/admin-store.js'

test('super-admin row authorizes DM without ADMIN_USER_ID match', async () => {
  await setupTestDb()
  addAdmin('root-user', SUPER_ADMIN_PLATFORM_ID)

  const auth = checkAuthorizationExtended('root-user', null, 'root-user', 'dm', undefined, false, 'discord-default')

  expect(auth.allowed).toBe(true)
  expect(auth.isBotAdmin).toBe(true)
})

test('regular users must be authorized on the source platform instance', async () => {
  await setupTestDb()
  addUser({ userId: 'u1', platformInstanceId: 'telegram-default', addedBy: 'root-user' })

  const auth = checkAuthorizationExtended('u1', null, 'u1', 'dm', undefined, false, 'discord-default')

  expect(auth.allowed).toBe(false)
  expect(auth.reason).toBe('dm_not_allowed')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test ./tests/auth.test.ts`

Expected: FAIL because `checkAuthorizationExtended()` has no `platformInstanceId` parameter and admin rows are not used.

- [ ] **Step 3: Add admin predicates**

In `src/instances/admin-store.ts`, add these exports below `addAdmin`:

```typescript
export const isSuperAdmin = (userId: string): boolean => {
  const row = getDrizzleDb()
    .select({ userId: admins.userId })
    .from(admins)
    .where(and(eq(admins.userId, userId), eq(admins.platformInstanceId, SUPER_ADMIN_PLATFORM_ID)))
    .get()
  return row !== undefined
}

export const isPlatformAdmin = (userId: string, platformInstanceId: string): boolean => {
  const row = getDrizzleDb()
    .select({ userId: admins.userId })
    .from(admins)
    .where(and(eq(admins.userId, userId), eq(admins.platformInstanceId, platformInstanceId)))
    .get()
  return row !== undefined
}
```

Replace `isAdmin` with this implementation:

```typescript
export const isAdmin = (userId: string, platformInstanceId: string): boolean =>
  isSuperAdmin(userId) || isPlatformAdmin(userId, platformInstanceId)
```

Add a list helper for the dashboard:

```typescript
export const listAdmins = (): AdminRecord[] => {
  const rows = getDrizzleDb().select().from(admins).all()
  return rows.map((row) => rowToRecord(row))
}
```

- [ ] **Step 4: Change `checkAuthorizationExtended()` signature**

In `src/auth.ts`, add the import:

```typescript
import { isAdmin } from './instances/admin-store.js'
```

Change the function signature to include the final parameter:

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
```

Replace the env-admin check with:

```typescript
const isConfiguredBotAdmin = (userId: string, platformInstanceId: string): boolean =>
  isAdmin(userId, platformInstanceId)
```

Update demo and normal user checks:

```typescript
if (process.env['DEMO_MODE'] !== 'true' || isAuthorized(userId, platformInstanceId) || contextType !== 'dm') {
  return null
}

if (username === null) {
  addUser({ userId, platformInstanceId, addedBy: 'demo-auto' })
} else {
  addUser({ userId, platformInstanceId, addedBy: 'demo-auto', username })
}
```

Replace the primary auth branch with this logic:

```typescript
const botAdmin = isConfiguredBotAdmin(userId, platformInstanceId)
if (isAuthorized(userId, platformInstanceId)) {
  if (contextType === 'dm' && isDemoUser(userId)) {
    return getGroupMemberAuth(contextId, contextType, threadId, false)
  }
  if (contextType === 'dm') {
    return { ...getDmUserAuth(userId), isBotAdmin: botAdmin }
  }
  return botAdmin
    ? getBotAdminAuth(contextId, contextType, threadId, isPlatformAdmin)
    : getGroupMemberAuth(contextId, contextType, threadId, isPlatformAdmin)
}
```

Update username resolution:

```typescript
if (username !== null && resolveUserByUsername(userId, username, platformInstanceId)) {
  return { ...getDmUserAuth(userId), isBotAdmin: botAdmin }
}
```

- [ ] **Step 5: Pass source platform in bot auth**

In `src/bot.ts`, replace `resolveMessageAuth()` with:

```typescript
function resolveMessageAuth(msg: IncomingMessage): AuthorizationResult {
  return checkAuthorizationExtended(
    msg.user.id,
    msg.user.username,
    msg.contextId,
    msg.contextType,
    msg.threadId,
    msg.user.isAdmin,
    msg.platformInstanceId,
  )
}
```

Replace the local `checkAuthorization` helper with a platform-aware helper used by `registerClearCommand`:

```typescript
const checkAuthorization = (
  userId: string,
  username: string | null | undefined,
  platformInstanceId = 'legacy-single',
): boolean => {
  log.debug({ userId, platformInstanceId }, 'Checking authorization')
  if (isAuthorized(userId, platformInstanceId)) return true
  if (username !== undefined && username !== null && resolveUserByUsername(userId, username, platformInstanceId))
    return true
  log.warn({ attemptedUserId: userId, platformInstanceId }, 'Unauthorized access attempt')
  return false
}
```

If `registerClearCommand` cannot pass a platform instance yet, change its injected check type in `src/commands/clear.ts` to accept `(userId, username, platformInstanceId)` and call it with `msg.platformInstanceId`.

- [ ] **Step 6: Update direct adapter auth calls**

Search compile errors from `bun typecheck`. For each direct `checkAuthorizationExtended(...)` call, add the available source platform instance. Example for `src/chat/discord/button-dispatch.ts`:

```typescript
const auth = checkAuthorizationExtended(
  mapped.user.id,
  mapped.user.username,
  mapped.contextId,
  mapped.contextType,
  threadId,
  mapped.user.isAdmin,
  mapped.platformInstanceId,
)
```

- [ ] **Step 7: Run tests and checks**

Run: `bun test ./tests/auth.test.ts ./tests/bot.test.ts`

Expected: PASS.

Run: `bun typecheck`

Expected: PASS for auth signature call sites.

- [ ] **Step 8: Commit**

```bash
git add src/instances/admin-store.ts src/auth.ts src/bot.ts src/commands/clear.ts tests/auth.test.ts tests/bot.test.ts
git commit -m "feat(auth): authorize admins from instance admin rows"
```

### Task 3: Re-Scope `/user`, `/users`, And `/announce`

**Files:**

- Modify: `src/commands/admin.ts`
- Modify: `src/index.ts`
- Test: `tests/commands/admin.test.ts`

- [ ] **Step 1: Write failing command tests**

Add imports to `tests/commands/admin.test.ts`:

```typescript
import { addAdmin, SUPER_ADMIN_PLATFORM_ID } from '../../src/instances/admin-store.js'
```

Add these tests under `/user add` and `/user remove`:

```typescript
test('adds users to the source platform instance only', async () => {
  addAdmin(ADMIN_ID, 'discord-default')
  const handler = commandHandlers.get('user')!
  const { reply } = createMockReply()

  await handler({ ...createDmMessage(ADMIN_ID, 'add 123456'), platformInstanceId: 'discord-default' }, reply, {
    allowed: true,
    isBotAdmin: true,
    isGroupAdmin: false,
    storageContextId: ADMIN_ID,
  })

  expect(isAuthorized('123456', 'discord-default')).toBe(true)
  expect(isAuthorized('123456', 'telegram-default')).toBe(false)
})

test('removes users from only the source platform instance', async () => {
  addAdmin(ADMIN_ID, SUPER_ADMIN_PLATFORM_ID)
  addUser({ userId: 'victim', platformInstanceId: 'discord-default', addedBy: ADMIN_ID })
  const handler = commandHandlers.get('user')!
  const { reply } = createMockReply()

  await handler({ ...createDmMessage(ADMIN_ID, 'remove victim'), platformInstanceId: 'telegram-default' }, reply, {
    allowed: true,
    isBotAdmin: true,
    isGroupAdmin: false,
    storageContextId: ADMIN_ID,
  })

  expect(isAuthorized('victim', 'discord-default')).toBe(true)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test ./tests/commands/admin.test.ts`

Expected: FAIL because admin commands still write/remove global user rows and still check the env admin ID.

- [ ] **Step 3: Gate admin commands through `isAdmin()`**

In `src/commands/admin.ts`, add:

```typescript
import { isAdmin, isSuperAdmin } from '../instances/admin-store.js'
```

Remove the local `checkAdmin = (userId) => userId === adminUserId` and replace checks with source-platform checks:

```typescript
if (!isAdmin(msg.user.id, msg.platformInstanceId)) {
  await reply.text('Only a platform admin can manage users for this platform instance.')
  return
}
```

For `/announce`, keep the same source-platform gate and keep the send target scoped to `msg.platformInstanceId`.

- [ ] **Step 4: Pass platform instance into user handlers**

Change the call in `handleUserCommand()`:

```typescript
await handleUserAdd(reply, userId, msg.platformInstanceId, identifier, deps)
```

Change `handleUserAdd()` signature and write paths:

```typescript
async function handleUserAdd(
  reply: ReplyFn,
  adminId: string,
  platformInstanceId: string,
  identifier: string | undefined,
  deps: AdminCommandsDeps,
): Promise<void> {
```

Replace ID add:

```typescript
addUser({ userId: parsed.value, platformInstanceId, addedBy: adminId })
```

Replace username add:

```typescript
addUser({ userId: placeholderId, platformInstanceId, addedBy: adminId, username: parsed.value })
```

- [ ] **Step 5: Scope removal and listing**

Change remove calls:

```typescript
await handleUserRemove(reply, userId, msg.platformInstanceId, identifier, adminUserId)
```

Replace remove execution:

```typescript
const removed = removeUser(parsed.value, platformInstanceId)
```

For `/users`, use super-admin all-rows and platform-admin scoped rows:

```typescript
async function handleUsersCommand(reply: ReplyFn, userId: string, platformInstanceId: string): Promise<void> {
  const rows = isSuperAdmin(userId) ? listUsers() : listUsers(platformInstanceId)
```

Include the platform in output rows:

```typescript
return `${u.platform_user_id}${username}${admin} [${u.platform_instance_id ?? 'unscoped'}] — added ${u.added_at}`
```

- [ ] **Step 6: Stop seeding runtime admin into global users**

In `src/index.ts`, remove this line:

```typescript
addUser(adminUserId, adminUserId)
```

Remove the now-unused import:

```typescript
import { addUser } from './users.js'
```

- [ ] **Step 7: Run tests and checks**

Run: `bun test ./tests/commands/admin.test.ts ./tests/index.test.ts`

Expected: PASS.

Run: `bun typecheck`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/commands/admin.ts src/index.ts tests/commands/admin.test.ts
git commit -m "feat(commands): scope user management by platform instance"
```

### Task 4: Re-Scope `/plugin` Admin Gating

**Files:**

- Modify: `src/commands/plugin.ts`
- Test: `tests/commands/plugin.test.ts`

- [ ] **Step 1: Write failing plugin admin tests**

Add imports to `tests/commands/plugin.test.ts`:

```typescript
import { setContextSettings } from '../../src/instances/context-store.js'
import { addAdmin, SUPER_ADMIN_PLATFORM_ID } from '../../src/instances/admin-store.js'
```

Add tests:

```typescript
test('rejects approve from platform-admin and accepts super-admin', async () => {
  const plugin = makePlugin('trust-plugin')
  pluginRegistry.registerDiscovered(plugin)
  addAdmin('platform-admin', 'telegram-default')
  addAdmin('root-admin', SUPER_ADMIN_PLATFORM_ID)
  const handler = registerCommandForTest()
  const platformReply = createMockReply()

  await handler(
    {
      ...createDmMessage('platform-admin', '/plugin approve trust-plugin'),
      commandMatch: 'approve trust-plugin',
      platformInstanceId: 'telegram-default',
    },
    platformReply.reply,
    createAuth('platform-admin', { isBotAdmin: true }),
  )

  expect(platformReply.textCalls[0]).toContain('Only a super-admin')
  expect(getPluginAdminState('trust-plugin')?.state).not.toBe('approved')

  const rootReply = createMockReply()
  await handler(
    {
      ...createDmMessage('root-admin', '/plugin approve trust-plugin'),
      commandMatch: 'approve trust-plugin',
      platformInstanceId: 'telegram-default',
    },
    rootReply.reply,
    createAuth('root-admin', { isBotAdmin: true }),
  )

  expect(getPluginAdminState('trust-plugin')?.state).toBe('approved')
})

test('allows platform-admin to enable plugin only for contexts on their platform', async () => {
  const plugin = makePlugin('context-plugin')
  pluginRegistry.registerDiscovered(plugin)
  pluginRegistry.approve(plugin.manifest.id, 'root-admin', plugin.manifestHash)
  pluginRegistry.markActive(plugin.manifest.id)
  addAdmin('platform-admin', 'telegram-default')
  setContextSettings({ contextId: 'group-1', taskInstanceId: 'kaneo-default', platformInstanceId: 'telegram-default' })
  setContextSettings({ contextId: 'group-2', taskInstanceId: 'kaneo-default', platformInstanceId: 'discord-default' })
  const handler = registerCommandForTest()
  const allowedReply = createMockReply()

  await handler(
    {
      ...createDmMessage('platform-admin', '/plugin enable context-plugin group-1'),
      commandMatch: 'enable context-plugin group-1',
      platformInstanceId: 'telegram-default',
    },
    allowedReply.reply,
    createAuth('platform-admin', { isBotAdmin: true }),
  )
  expect(allowedReply.textCalls[0]).toContain('enabled')

  const deniedReply = createMockReply()
  await handler(
    {
      ...createDmMessage('platform-admin', '/plugin enable context-plugin group-2'),
      commandMatch: 'enable context-plugin group-2',
      platformInstanceId: 'telegram-default',
    },
    deniedReply.reply,
    createAuth('platform-admin', { isBotAdmin: true }),
  )
  expect(deniedReply.textCalls[0]).toContain('not authorized')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test ./tests/commands/plugin.test.ts`

Expected: FAIL because `/plugin approve` currently accepts any bot admin and `enable` does not check target context ownership.

- [ ] **Step 3: Import admin and context helpers**

In `src/commands/plugin.ts`, add:

```typescript
import { getContextSettings } from '../instances/context-store.js'
import { isAdmin, isSuperAdmin } from '../instances/admin-store.js'
```

- [ ] **Step 4: Pass message context into subcommand routing**

Change `runPluginSubcommand()` signature:

```typescript
async function runPluginSubcommand(
  subcommand: string,
  args: string[],
  userId: string,
  platformInstanceId: string,
  reply: ReplyFn,
): Promise<void> {
```

Update the call site:

```typescript
await runPluginSubcommand(subcommand, args, msg.user.id, msg.platformInstanceId, reply)
```

- [ ] **Step 5: Enforce command-level admin gates**

Replace the current top-level bot-admin gate with:

```typescript
if (!isAdmin(msg.user.id, msg.platformInstanceId)) {
  await reply.text('Only an admin can manage plugins.')
  return
}
```

Inside `approve` / `reject`, add before calling handlers:

```typescript
if (!isSuperAdmin(userId)) {
  await reply.text('Only a super-admin can approve or reject plugins.')
  return
}
```

Inside `enable` / `disable`, validate target context:

```typescript
const targetContextId = args[2] ?? userId
const settings = getContextSettings(targetContextId)
const targetPlatformInstanceId = settings?.platformInstanceId ?? platformInstanceId
if (!isAdmin(userId, targetPlatformInstanceId)) {
  await reply.text(`You are not authorized to manage plugins for context \`${targetContextId}\`.`)
  return
}
await handleEnable(id, targetContextId, userId, reply)
```

Use the same target-platform validation before `handleDisable()`.

- [ ] **Step 6: Run tests and checks**

Run: `bun test ./tests/commands/plugin.test.ts`

Expected: PASS.

Run: `bun lint:agent-strict -- src/commands/plugin.ts tests/commands/plugin.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/commands/plugin.ts tests/commands/plugin.test.ts
git commit -m "feat(commands): scope plugin admin actions"
```

### Task 5: Router Listing And Runtime Apply Target

**Files:**

- Modify: `src/chat/router.ts`
- Create: `src/debug/chat-router-runtime.ts`
- Modify: `src/index.ts`
- Test: `tests/chat/router.test.ts`
- Test: `tests/debug/chat-router-runtime.test.ts`

- [ ] **Step 1: Write failing router list test**

Append to `tests/chat/router.test.ts`:

```typescript
test('listInstances returns readonly snapshots of managed instances', () => {
  const router = new ChatRouter((id) => createMockChatProvider(id))
  router.addInstance('telegram-default', 'telegram', { token: 'x' })

  const listed = router.listInstances()

  expect(listed).toEqual([{ id: 'telegram-default', type: 'telegram', status: 'pending' }])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test ./tests/chat/router.test.ts -t "listInstances returns readonly snapshots"`

Expected: FAIL because `listInstances` is not defined.

- [ ] **Step 3: Add router list type and method**

In `src/chat/router.ts`, add near `ManagedChatInstance`:

```typescript
export type ManagedChatInstanceSnapshot = {
  readonly id: string
  readonly type: PlatformInstanceType
  readonly status: InstanceStatus
}
```

Add this public method after `getInstance()`:

```typescript
  listInstances(): ManagedChatInstanceSnapshot[] {
    return [...this.instances.values()].map((instance) => ({
      id: instance.id,
      type: instance.type,
      status: instance.status,
    }))
  }
```

- [ ] **Step 4: Create runtime router holder tests**

Create `tests/debug/chat-router-runtime.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { ChatRouter } from '../../src/chat/router.js'
import {
  clearRuntimeChatRouter,
  getRuntimeChatRouter,
  setRuntimeChatRouter,
} from '../../src/debug/chat-router-runtime.js'
import { createMockChat } from '../utils/test-helpers.js'

afterEach(() => {
  clearRuntimeChatRouter()
})

describe('chat-router-runtime', () => {
  test('stores and clears the active ChatRouter', () => {
    const router = new ChatRouter(() => createMockChat())

    setRuntimeChatRouter(router)
    expect(getRuntimeChatRouter()).toBe(router)

    clearRuntimeChatRouter()
    expect(getRuntimeChatRouter()).toBeNull()
  })
})
```

- [ ] **Step 5: Run runtime holder test to verify it fails**

Run: `bun test ./tests/debug/chat-router-runtime.test.ts`

Expected: FAIL because `src/debug/chat-router-runtime.ts` does not exist.

- [ ] **Step 6: Implement runtime router holder**

Create `src/debug/chat-router-runtime.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ChatRouter } from '../chat/router.js'

let runtimeChatRouter: ChatRouter | null = null

export const setRuntimeChatRouter = (router: ChatRouter): void => {
  runtimeChatRouter = router
}

export const getRuntimeChatRouter = (): ChatRouter | null => runtimeChatRouter

export const clearRuntimeChatRouter = (): void => {
  runtimeChatRouter = null
}
```

- [ ] **Step 7: Register and clear runtime router in startup**

In `src/index.ts`, add:

```typescript
import { clearRuntimeChatRouter, setRuntimeChatRouter } from './debug/chat-router-runtime.js'
```

After constructing `chatProvider`:

```typescript
setRuntimeChatRouter(chatProvider)
```

During shutdown before `return chatProvider.stop()`:

```typescript
clearRuntimeChatRouter()
```

- [ ] **Step 8: Run tests and checks**

Run: `bun test ./tests/chat/router.test.ts ./tests/debug/chat-router-runtime.test.ts ./tests/index.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/chat/router.ts src/debug/chat-router-runtime.ts src/index.ts tests/chat/router.test.ts tests/debug/chat-router-runtime.test.ts
git commit -m "feat(chat): expose runtime router for instance apply"
```

### Task 6: Instance API Routes

**Files:**

- Create: `src/debug/instance-routes.ts`
- Modify: `src/debug/server.ts`
- Modify: `src/instances/context-store.ts`
- Test: `tests/debug/instance-routes.test.ts`

- [ ] **Step 1: Write failing API route tests**

Create `tests/debug/instance-routes.test.ts` with route-level tests that call exported handlers directly:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { ChatRouter } from '../../src/chat/router.js'
import { clearRuntimeChatRouter, setRuntimeChatRouter } from '../../src/debug/chat-router-runtime.js'
import { handleInstanceApiRoute } from '../../src/debug/instance-routes.js'
import { getRuntimeChatRouter } from '../../src/debug/chat-router-runtime.js'
import { SUPER_ADMIN_PLATFORM_ID } from '../../src/instances/admin-store.js'
import { insertPlatformInstance } from '../../src/instances/platform-store.js'
import { createMockChat, mockLogger, setupTestDb } from '../utils/test-helpers.js'

const jsonReq = (path: string, body: unknown, token = 't'): Request =>
  new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })

const delReq = (path: string, token = 't'): Request =>
  new Request(`http://localhost${path}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })

const getReq = (path: string): Request => new Request(`http://localhost${path}`)

const readJson = async (res: Response): Promise<Record<string, unknown>> => JSON.parse(await res.text())

beforeEach(async () => {
  mockLogger()
  await setupTestDb()
  process.env['DEBUG_TOKEN'] = 't'
  process.env['INSTANCE_CONFIG_KEY'] = '1'.repeat(64)
})

afterEach(() => {
  clearRuntimeChatRouter()
  delete process.env['DEBUG_TOKEN']
  delete process.env['INSTANCE_CONFIG_KEY']
})

describe('instance API routes', () => {
  test('creates and lists a masked platform instance', async () => {
    const create = await handleInstanceApiRoute(
      jsonReq('/api/platform-instances', {
        id: 'telegram-a',
        type: 'telegram',
        config: { token: 'secret-token', label: 'primary' },
      }),
      new URL('http://localhost/api/platform-instances'),
    )

    expect(create?.status).toBe(201)
    const body = await readJson(create!)
    expect(body.config).toEqual({ token: '***', label: 'primary' })

    const list = await handleInstanceApiRoute(
      getReq('/api/platform-instances'),
      new URL('http://localhost/api/platform-instances'),
    )
    expect(list?.status).toBe(200)
  })

  test('rejects writes when DEBUG_TOKEN is unset', async () => {
    delete process.env['DEBUG_TOKEN']

    const res = await handleInstanceApiRoute(
      jsonReq('/api/task-instances', {
        id: 'kaneo-a',
        type: 'kaneo',
        config: { url: 'https://kaneo.test' },
      }),
      new URL('http://localhost/api/task-instances'),
    )

    expect(res?.status).toBe(401)
  })

  test('returns 503 when apply has no runtime router', async () => {
    const res = await handleInstanceApiRoute(
      jsonReq('/api/platform-instances/apply', {}),
      new URL('http://localhost/api/platform-instances/apply'),
    )

    expect(res?.status).toBe(503)
  })

  test('apply starts active DB instances missing from the router', async () => {
    insertPlatformInstance({ id: 'telegram-a', type: 'telegram', config: { token: 'x' }, status: 'active' })
    const router = new ChatRouter(() => createMockChat())
    setRuntimeChatRouter(router)

    const res = await handleInstanceApiRoute(
      jsonReq('/api/platform-instances/apply', {}),
      new URL('http://localhost/api/platform-instances/apply'),
    )

    expect(res?.status).toBe(200)
    expect(getRuntimeChatRouter()?.getInstance('telegram-a')).not.toBeNull()
  })

  test('creates and deletes super-admin rows', async () => {
    const create = await handleInstanceApiRoute(
      jsonReq('/api/admins', { userId: 'root' }),
      new URL('http://localhost/api/admins'),
    )
    expect(create?.status).toBe(201)

    const del = await handleInstanceApiRoute(
      delReq(`/api/admins/root/${encodeURIComponent(SUPER_ADMIN_PLATFORM_ID)}`),
      new URL(`http://localhost/api/admins/root/${encodeURIComponent(SUPER_ADMIN_PLATFORM_ID)}`),
    )
    expect(del?.status).toBe(204)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test ./tests/debug/instance-routes.test.ts`

Expected: FAIL because `src/debug/instance-routes.ts` does not exist.

- [ ] **Step 3: Add orphan context deletion helper**

In `src/instances/context-store.ts`, add:

```typescript
export const deleteContextsByTaskInstance = (taskInstanceId: string): number => {
  const rows = listContextsByTaskInstance(taskInstanceId)
  getDrizzleDb().delete(contextSettings).where(eq(contextSettings.taskInstanceId, taskInstanceId)).run()
  return rows.length
}
```

- [ ] **Step 4: Implement API validation and masking**

Create `src/debug/instance-routes.ts` with these building blocks:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { addAdmin, listAdmins, removeAdmin, SUPER_ADMIN_PLATFORM_ID } from '../instances/admin-store.js'
import { deleteContextsByTaskInstance } from '../instances/context-store.js'
import { maskConfig } from '../instances/encryption.js'
import {
  deletePlatformInstance,
  getPlatformInstance,
  insertPlatformInstance,
  listActivePlatformInstances,
  listPlatformInstances,
  updatePlatformInstance,
} from '../instances/platform-store.js'
import { deleteTaskInstance, insertTaskInstance, listTaskInstances } from '../instances/task-store.js'
import type { PlatformInstance, TaskInstance } from '../instances/types.js'
import { logger } from '../logger.js'
import { getRuntimeChatRouter } from './chat-router-runtime.js'

const log = logger.child({ scope: 'debug:instance-routes' })

const configSchema = z.record(z.string(), z.string())
const platformTypeSchema = z.enum(['telegram', 'mattermost', 'discord'])
const taskTypeSchema = z.enum(['kaneo', 'youtrack'])
const statusSchema = z.enum(['pending', 'active', 'stopped'])

const createPlatformSchema = z.object({ id: z.string().min(1), type: platformTypeSchema, config: configSchema })
const createTaskSchema = z.object({ id: z.string().min(1), type: taskTypeSchema, config: configSchema })
const adminSchema = z.object({ userId: z.string().min(1), platformInstanceId: z.string().min(1).optional() })
const statusBodySchema = z.object({ status: statusSchema })

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const emptyResponse = (status: number): Response => new Response(null, { status })

const maskedPlatform = (row: PlatformInstance): PlatformInstance => ({ ...row, config: maskConfig(row.config) })
const maskedTask = (row: TaskInstance): TaskInstance => ({ ...row, config: maskConfig(row.config) })
```

- [ ] **Step 5: Add write-token helper**

Add:

```typescript
const isWriteMethod = (method: string): boolean => method === 'POST' || method === 'DELETE'

const authorizeWrite = (req: Request): Response | null => {
  if (!isWriteMethod(req.method)) return null
  const debugToken = process.env['DEBUG_TOKEN']
  if (debugToken === undefined || debugToken === '')
    return jsonResponse(401, { error: 'write API requires DEBUG_TOKEN' })
  const headerToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (headerToken !== debugToken) return jsonResponse(401, { error: 'unauthorized' })
  return null
}
```

- [ ] **Step 6: Add create/list/delete handlers**

Add handlers:

```typescript
const readBody = async (req: Request): Promise<unknown> => {
  try {
    return await req.json()
  } catch {
    throw new Error('invalid JSON body')
  }
}

const createPlatform = async (req: Request): Promise<Response> => {
  const parsed = createPlatformSchema.safeParse(await readBody(req))
  if (!parsed.success) return jsonResponse(400, { error: 'invalid platform instance body' })
  insertPlatformInstance({ ...parsed.data, status: 'active' })
  const row = getPlatformInstance(parsed.data.id)
  if (row === null) return jsonResponse(500, { error: 'created platform instance missing' })
  return jsonResponse(201, maskedPlatform(row))
}

const createTask = async (req: Request): Promise<Response> => {
  const parsed = createTaskSchema.safeParse(await readBody(req))
  if (!parsed.success) return jsonResponse(400, { error: 'invalid task instance body' })
  insertTaskInstance({ ...parsed.data, status: 'active' })
  const row = listTaskInstances().find((candidate) => candidate.id === parsed.data.id)
  if (row === undefined) return jsonResponse(500, { error: 'created task instance missing' })
  return jsonResponse(201, maskedTask(row))
}

const createAdmin = async (req: Request): Promise<Response> => {
  const parsed = adminSchema.safeParse(await readBody(req))
  if (!parsed.success) return jsonResponse(400, { error: 'invalid admin body' })
  const platformInstanceId = parsed.data.platformInstanceId ?? SUPER_ADMIN_PLATFORM_ID
  addAdmin(parsed.data.userId, platformInstanceId)
  return jsonResponse(201, { userId: parsed.data.userId, platformInstanceId })
}
```

- [ ] **Step 7: Add apply reconciliation**

Add:

```typescript
const applyPlatformInstances = async (): Promise<Response> => {
  const router = getRuntimeChatRouter()
  if (router === null) return jsonResponse(503, { error: 'router not initialised' })

  const desired = listActivePlatformInstances()
  const desiredIds = new Set(desired.map((instance) => instance.id))
  for (const existing of router.listInstances()) {
    if (!desiredIds.has(existing.id)) await router.removeInstance(existing.id)
  }

  const existingIds = new Set(router.listInstances().map((instance) => instance.id))
  for (const want of desired) {
    if (!existingIds.has(want.id)) {
      router.addInstance(want.id, want.type, want.config)
      await router.startInstance(want.id)
    }
  }

  return jsonResponse(200, { applied: desired.length })
}
```

- [ ] **Step 8: Add route dispatcher**

Add:

```typescript
export const handleInstanceApiRoute = async (req: Request, url: URL): Promise<Response | null> => {
  if (!url.pathname.startsWith('/api/')) return null
  const auth = authorizeWrite(req)
  if (auth !== null) return auth

  try {
    if (url.pathname === '/api/platform-instances' && req.method === 'GET')
      return jsonResponse(200, listPlatformInstances().map(maskedPlatform))
    if (url.pathname === '/api/platform-instances' && req.method === 'POST') return await createPlatform(req)
    if (url.pathname === '/api/platform-instances/apply' && req.method === 'POST') return await applyPlatformInstances()
    if (
      url.pathname.endsWith('/status') &&
      url.pathname.startsWith('/api/platform-instances/') &&
      req.method === 'POST'
    ) {
      const id = decodeURIComponent(url.pathname.slice('/api/platform-instances/'.length, -'/status'.length))
      const parsed = statusBodySchema.safeParse(await readBody(req))
      if (!parsed.success) return jsonResponse(400, { error: 'invalid status body' })
      updatePlatformInstance(id, { config: undefined, status: parsed.data.status })
      const row = getPlatformInstance(id)
      return row === null
        ? jsonResponse(404, { error: 'platform instance not found' })
        : jsonResponse(200, maskedPlatform(row))
    }
    if (url.pathname.startsWith('/api/platform-instances/') && req.method === 'DELETE') {
      const id = decodeURIComponent(url.pathname.slice('/api/platform-instances/'.length))
      const router = getRuntimeChatRouter()
      if (router !== null) await router.removeInstance(id)
      deletePlatformInstance(id)
      return emptyResponse(204)
    }
    if (url.pathname === '/api/task-instances' && req.method === 'GET')
      return jsonResponse(200, listTaskInstances().map(maskedTask))
    if (url.pathname === '/api/task-instances' && req.method === 'POST') return await createTask(req)
    if (url.pathname.startsWith('/api/task-instances/') && req.method === 'DELETE') {
      const id = decodeURIComponent(url.pathname.slice('/api/task-instances/'.length))
      deleteContextsByTaskInstance(id)
      deleteTaskInstance(id)
      return emptyResponse(204)
    }
    if (url.pathname === '/api/admins' && req.method === 'GET') return jsonResponse(200, listAdmins())
    if (url.pathname === '/api/admins' && req.method === 'POST') return await createAdmin(req)
    if (url.pathname.startsWith('/api/admins/') && req.method === 'DELETE') {
      const parts = url.pathname.slice('/api/admins/'.length).split('/').map(decodeURIComponent)
      const [userId, instanceId] = parts
      if (userId === undefined || instanceId === undefined)
        return jsonResponse(400, { error: 'invalid admin delete path' })
      removeAdmin(userId, instanceId)
      return emptyResponse(204)
    }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error) }, 'instance API failed')
    return jsonResponse(500, { error: 'internal server error' })
  }

  return null
}
```

- [ ] **Step 9: Wire routes into debug server**

In `src/debug/server.ts`, add import:

```typescript
import { handleInstanceApiRoute } from './instance-routes.js'
```

In `routeRequest()`, before `routeAdminPaths()`:

```typescript
const instanceApiResponse = handleInstanceApiRoute(req, url)
if (instanceApiResponse !== null) return instanceApiResponse
```

Because `handleInstanceApiRoute()` is async, change `routeRequest()` return type to `Response | Promise<Response>` if needed and call it with `await` in an async `routeRequest`.

- [ ] **Step 10: Run tests and checks**

Run: `bun test ./tests/debug/instance-routes.test.ts ./tests/debug/server.test.ts ./tests/debug/admin-llm-route.test.ts`

Expected: PASS.

Run: `bun typecheck`

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/debug/instance-routes.ts src/debug/server.ts src/instances/context-store.ts tests/debug/instance-routes.test.ts
git commit -m "feat(debug): add instance management API routes"
```

### Task 7: Admin Client Fetchers And Schemas

**Files:**

- Modify: `client/shared/api-types.ts`
- Modify: `client/admin/fetcher-schemas.ts`
- Modify: `client/admin/fetchers.ts`
- Test: `tests/client/admin/fetcher-schemas.test.ts`
- Test: `tests/client/admin/fetchers.test.ts`

- [ ] **Step 1: Write failing fetcher tests**

Append to `tests/client/admin/fetchers.test.ts`:

```typescript
import {
  createPlatformInstance,
  deletePlatformInstance,
  fetchPlatformInstances,
  applyPlatformInstances,
} from '../../../client/admin/fetchers.js'

test('fetches platform instances', async () => {
  installFetch(200, [
    { id: 'telegram-a', type: 'telegram', status: 'active', config: { token: '***' }, createdAt: 'now' },
  ])

  const result = await fetchPlatformInstances()

  expect(captured[0]).toEqual({ url: '/api/platform-instances', init: {} })
  expect(result[0]?.id).toBe('telegram-a')
})

test('creates platform instance with JSON body', async () => {
  installFetch(201, {
    id: 'telegram-a',
    type: 'telegram',
    status: 'active',
    config: { token: '***' },
    createdAt: 'now',
  })

  const result = await createPlatformInstance({ id: 'telegram-a', type: 'telegram', config: { token: 'secret' } })

  expect(captured[0]?.url).toBe('/api/platform-instances')
  expect(captured[0]?.init.method).toBe('POST')
  expect(captured[0]?.init.body).toBe(
    JSON.stringify({ id: 'telegram-a', type: 'telegram', config: { token: 'secret' } }),
  )
  expect(result.config.token).toBe('***')
})

test('applies platform instance changes', async () => {
  installFetch(200, { applied: 1 })

  const result = await applyPlatformInstances()

  expect(captured[0]?.url).toBe('/api/platform-instances/apply')
  expect(captured[0]?.init.method).toBe('POST')
  expect(result.applied).toBe(1)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test ./tests/client/admin/fetchers.test.ts`

Expected: FAIL because the fetcher exports and schemas do not exist.

- [ ] **Step 3: Add API types**

In `client/shared/api-types.ts`, add:

```typescript
export type InstanceConfigView = Record<string, string>
export type PlatformInstanceView = {
  readonly id: string
  readonly type: 'telegram' | 'mattermost' | 'discord'
  readonly config: InstanceConfigView
  readonly status: 'pending' | 'active' | 'stopped'
  readonly createdAt: string
}
export type TaskInstanceView = {
  readonly id: string
  readonly type: 'kaneo' | 'youtrack'
  readonly config: InstanceConfigView
  readonly status: 'pending' | 'active' | 'stopped'
  readonly createdAt: string
}
export type AdminInstanceView = {
  readonly userId: string
  readonly platformInstanceId: string
  readonly createdAt?: string
}
export type ApplyInstancesResult = { readonly applied: number }
```

- [ ] **Step 4: Add Zod schemas**

In `client/admin/fetcher-schemas.ts`, add:

```typescript
export const InstanceConfigViewSchema = z.record(z.string(), z.string())
export const PlatformInstanceViewSchema = z.object({
  id: z.string(),
  type: z.enum(['telegram', 'mattermost', 'discord']),
  config: InstanceConfigViewSchema,
  status: z.enum(['pending', 'active', 'stopped']),
  createdAt: z.string(),
})
export const TaskInstanceViewSchema = z.object({
  id: z.string(),
  type: z.enum(['kaneo', 'youtrack']),
  config: InstanceConfigViewSchema,
  status: z.enum(['pending', 'active', 'stopped']),
  createdAt: z.string(),
})
export const AdminInstanceViewSchema = z.object({
  userId: z.string(),
  platformInstanceId: z.string(),
  createdAt: z.string().optional(),
})
export const ApplyInstancesResultSchema = z.object({ applied: z.number() })
```

- [ ] **Step 5: Add fetcher helpers**

In `client/admin/fetchers.ts`, import the new schemas and types. Add:

```typescript
export type CreatePlatformInstanceInput = {
  readonly id: string
  readonly type: 'telegram' | 'mattermost' | 'discord'
  readonly config: Record<string, string>
}

export type CreateTaskInstanceInput = {
  readonly id: string
  readonly type: 'kaneo' | 'youtrack'
  readonly config: Record<string, string>
}

export const fetchPlatformInstances = async (): Promise<PlatformInstanceView[]> => {
  const res = await fetch('/api/platform-instances')
  const body = await readBody(res)
  requireOk(res, body)
  return z.array(PlatformInstanceViewSchema).parse(body) as PlatformInstanceView[]
}

export const createPlatformInstance = async (input: CreatePlatformInstanceInput): Promise<PlatformInstanceView> => {
  const res = await fetch('/api/platform-instances', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const body = await readBody(res)
  requireOk(res, body)
  return PlatformInstanceViewSchema.parse(body) as PlatformInstanceView
}

export const setPlatformInstanceStatus = async (
  id: string,
  status: 'active' | 'stopped',
): Promise<PlatformInstanceView> => {
  const res = await fetch(`/api/platform-instances/${encodeURIComponent(id)}/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  })
  const body = await readBody(res)
  requireOk(res, body)
  return PlatformInstanceViewSchema.parse(body) as PlatformInstanceView
}

export const deletePlatformInstance = async (id: string): Promise<void> => {
  const res = await fetch(`/api/platform-instances/${encodeURIComponent(id)}`, { method: 'DELETE' })
  const body = await readBody(res)
  requireOk(res, body)
}

export const applyPlatformInstances = async (): Promise<ApplyInstancesResult> => {
  const res = await fetch('/api/platform-instances/apply', { method: 'POST' })
  const body = await readBody(res)
  requireOk(res, body)
  return ApplyInstancesResultSchema.parse(body) as ApplyInstancesResult
}
```

Add equivalent `fetchTaskInstances`, `createTaskInstance`, `deleteTaskInstance`, `fetchAdmins`, `createAdmin`, and `deleteAdmin` helpers using paths from the spec and the schemas from Step 4.

- [ ] **Step 6: Run client fetcher tests**

Run: `bun test:client -- tests/client/admin/fetchers.test.ts tests/client/admin/fetcher-schemas.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add client/shared/api-types.ts client/admin/fetcher-schemas.ts client/admin/fetchers.ts tests/client/admin/fetchers.test.ts tests/client/admin/fetcher-schemas.test.ts
git commit -m "feat(admin): add instance API client helpers"
```

### Task 8: `/admin#instances` UI

**Files:**

- Modify: `client/admin/admin.svelte.ts`
- Modify: `client/admin/AdminApp.svelte`
- Create: `client/admin/sections/InstancesSection.svelte`
- Test: `tests/client/admin/admin.svelte.test.ts`
- Test: `tests/client/admin/AdminApp.test.ts`
- Test: `tests/client/admin/sections/InstancesSection.test.ts`

- [ ] **Step 1: Write failing section registration tests**

In `tests/client/admin/admin.svelte.test.ts`, add:

```typescript
test('recognizes instances hash section', () => {
  expect(sectionFromHash('#instances')).toBe('instances')
  expect(sectionLabel('instances')).toBe('Instances')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test:client -- tests/client/admin/admin.svelte.test.ts`

Expected: FAIL because `instances` is not an admin section.

- [ ] **Step 3: Register the section**

In `client/admin/admin.svelte.ts`, add `instances` before `system`:

```typescript
  { id: 'instances', label: 'Instances' },
```

- [ ] **Step 4: Create failing InstancesSection tests**

Create `tests/client/admin/sections/InstancesSection.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { flushSync, mount, unmount } from 'svelte'

import InstancesSection from '../../../../client/admin/sections/InstancesSection.svelte'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const render = (): { readonly component: ReturnType<typeof mount>; readonly target: HTMLElement } => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')
  if (target === null) throw new Error('root missing')
  return { component: mount(InstancesSection, { target }), target }
}

afterEach(() => restoreFetch())

describe('InstancesSection', () => {
  test('renders platform, task, and admin tables from the API', async () => {
    setMockFetch((url) => {
      if (url === '/api/platform-instances')
        return Promise.resolve(
          Response.json([
            { id: 'telegram-a', type: 'telegram', status: 'active', config: { token: '***' }, createdAt: 'now' },
          ]),
        )
      if (url === '/api/task-instances')
        return Promise.resolve(
          Response.json([
            { id: 'kaneo-a', type: 'kaneo', status: 'active', config: { url: 'https://kaneo.test' }, createdAt: 'now' },
          ]),
        )
      if (url === '/api/admins')
        return Promise.resolve(Response.json([{ userId: 'root', platformInstanceId: '__super__', createdAt: 'now' }]))
      return Promise.resolve(new Response('not mocked', { status: 500 }))
    })

    const { component, target } = render()
    await drain()

    expect(target.textContent).toContain('Platform Instances')
    expect(target.textContent).toContain('telegram-a')
    expect(target.textContent).toContain('Task Instances')
    expect(target.textContent).toContain('kaneo-a')
    expect(target.textContent).toContain('Admins')
    expect(target.textContent).toContain('root')
    void unmount(component)
  })

  test('submits platform instance form and shows unapplied indicator', async () => {
    const calls: Array<{ readonly url: string; readonly init: RequestInit }> = []
    setMockFetch((url, init) => {
      calls.push({ url, init })
      if (url === '/api/platform-instances' && init.method === 'POST')
        return Promise.resolve(
          Response.json(
            { id: 'discord-a', type: 'discord', status: 'active', config: { token: '***' }, createdAt: 'now' },
            { status: 201 },
          ),
        )
      if (url === '/api/platform-instances') return Promise.resolve(Response.json([]))
      if (url === '/api/task-instances') return Promise.resolve(Response.json([]))
      if (url === '/api/admins') return Promise.resolve(Response.json([]))
      return Promise.resolve(new Response('not mocked', { status: 500 }))
    })

    const { component, target } = render()
    await drain()
    const id = target.querySelector<HTMLInputElement>('[data-testid="platform-id"]')!
    const config = target.querySelector<HTMLTextAreaElement>('[data-testid="platform-config"]')!
    id.value = 'discord-a'
    id.dispatchEvent(new Event('input', { bubbles: true }))
    config.value = '{"token":"secret"}'
    config.dispatchEvent(new Event('input', { bubbles: true }))
    target.querySelector<HTMLFormElement>('[data-testid="platform-form"]')!.requestSubmit()
    await drain()

    expect(calls.some((call) => call.url === '/api/platform-instances' && call.init.method === 'POST')).toBe(true)
    expect(target.textContent).toContain('Unapplied platform changes')
    void unmount(component)
  })
})
```

- [ ] **Step 5: Run test to verify it fails**

Run: `bun test:client -- tests/client/admin/sections/InstancesSection.test.ts`

Expected: FAIL because `InstancesSection.svelte` does not exist.

- [ ] **Step 6: Implement the section component**

Create `client/admin/sections/InstancesSection.svelte` with three focused tables and forms:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import {
    applyPlatformInstances,
    createAdmin,
    createPlatformInstance,
    createTaskInstance,
    deleteAdmin,
    deletePlatformInstance,
    deleteTaskInstance,
    fetchAdmins,
    fetchPlatformInstances,
    fetchTaskInstances,
    setPlatformInstanceStatus,
  } from '../fetchers.js'
  import type { AdminInstanceView, PlatformInstanceView, TaskInstanceView } from '../../shared/api-types.js'

  let platforms = $state<PlatformInstanceView[]>([])
  let tasks = $state<TaskInstanceView[]>([])
  let admins = $state<AdminInstanceView[]>([])
  let status = $state('')
  let dirty = $state(false)
  let platformId = $state('')
  let platformType = $state<'telegram' | 'mattermost' | 'discord'>('telegram')
  let platformConfig = $state('{"token":""}')
  let taskId = $state('')
  let taskType = $state<'kaneo' | 'youtrack'>('kaneo')
  let taskConfig = $state('{"url":""}')
  let adminUserId = $state('')
  let adminPlatformInstanceId = $state('')

  const parseConfig = (raw: string): Record<string, string> => {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Config must be a JSON object')
    return Object.fromEntries(
      Object.entries(parsed).map(([key, value]) => {
        if (typeof value !== 'string') throw new Error(`Config value ${key} must be a string`)
        return [key, value]
      }),
    )
  }

  const refresh = async (): Promise<void> => {
    platforms = await fetchPlatformInstances()
    tasks = await fetchTaskInstances()
    admins = await fetchAdmins()
  }

  const markDirty = (): void => {
    dirty = true
  }

  const apply = async (): Promise<void> => {
    const result = await applyPlatformInstances()
    dirty = false
    status = `Applied ${result.applied} active platform instance(s).`
    await refresh()
  }

  const submitPlatform = async (): Promise<void> => {
    await createPlatformInstance({ id: platformId, type: platformType, config: parseConfig(platformConfig) })
    platformId = ''
    dirty = true
    await refresh()
  }

  const submitTask = async (): Promise<void> => {
    await createTaskInstance({ id: taskId, type: taskType, config: parseConfig(taskConfig) })
    taskId = ''
    await refresh()
  }

  const submitAdmin = async (): Promise<void> => {
    await createAdmin({ userId: adminUserId, platformInstanceId: adminPlatformInstanceId || undefined })
    adminUserId = ''
    adminPlatformInstanceId = ''
    await refresh()
  }

  $effect(() => {
    void refresh()
  })
</script>

<section id="instances" class="admin-section" data-testid="instances-section">
  <header>
    <p class="eyebrow">Configuration</p>
    <h2>Instances</h2>
    <p>Manage platform adapters, task providers, and admin rows stored in SQLite.</p>
  </header>

  <div class="card">
    <h3>Platform Instances</h3>
    {#if dirty}<p data-testid="unapplied-indicator">Unapplied platform changes</p>{/if}
    <button type="button" data-testid="apply-platforms" onclick={apply}>Apply changes</button>
    <form data-testid="platform-form" onsubmit={(event) => { event.preventDefault(); void submitPlatform() }}>
      <input data-testid="platform-id" placeholder="platform id" bind:value={platformId} />
      <select bind:value={platformType}>
        <option value="telegram">telegram</option>
        <option value="mattermost">mattermost</option>
        <option value="discord">discord</option>
      </select>
      <textarea data-testid="platform-config" bind:value={platformConfig}></textarea>
      <button type="submit">Add platform</button>
    </form>
    <table>
      <tbody>
        {#each platforms as platform}
          <tr data-testid="platform-row">
            <td>{platform.id}</td>
            <td>{platform.type}</td>
            <td>{platform.status}</td>
            <td>{JSON.stringify(platform.config)}</td>
            <td><button type="button" onclick={async () => { await setPlatformInstanceStatus(platform.id, platform.status === 'active' ? 'stopped' : 'active'); markDirty(); await refresh() }}>{platform.status === 'active' ? 'Stop' : 'Start'}</button></td>
            <td><button type="button" onclick={async () => { await deletePlatformInstance(platform.id); markDirty(); await refresh() }}>Delete</button></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <div class="card">
    <h3>Task Instances</h3>
    <form data-testid="task-form" onsubmit={(event) => { event.preventDefault(); void submitTask() }}>
      <input data-testid="task-id" placeholder="task id" bind:value={taskId} />
      <select bind:value={taskType}>
        <option value="kaneo">kaneo</option>
        <option value="youtrack">youtrack</option>
      </select>
      <textarea data-testid="task-config" bind:value={taskConfig}></textarea>
      <button type="submit">Add task</button>
    </form>
    <table>
      <tbody>
        {#each tasks as task}
          <tr data-testid="task-row">
            <td>{task.id}</td>
            <td>{task.type}</td>
            <td>{task.status}</td>
            <td>{JSON.stringify(task.config)}</td>
            <td><button type="button" onclick={async () => { await deleteTaskInstance(task.id); await refresh() }}>Delete</button></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <div class="card">
    <h3>Admins</h3>
    <form data-testid="admin-form" onsubmit={(event) => { event.preventDefault(); void submitAdmin() }}>
      <input data-testid="admin-user-id" placeholder="user id" bind:value={adminUserId} />
      <input data-testid="admin-platform-id" placeholder="platform instance id, blank for super-admin" bind:value={adminPlatformInstanceId} />
      <button type="submit">Add admin</button>
    </form>
    <table>
      <tbody>
        {#each admins as admin}
          <tr data-testid="admin-row">
            <td>{admin.userId}</td>
            <td>{admin.platformInstanceId}</td>
            <td><button type="button" onclick={async () => { await deleteAdmin(admin.userId, admin.platformInstanceId); await refresh() }}>Remove</button></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  {#if status !== ''}<p data-testid="instances-status">{status}</p>{/if}
</section>
```

- [ ] **Step 7: Add section to AdminApp**

In `client/admin/AdminApp.svelte`, import and mount the section:

```svelte
import InstancesSection from './sections/InstancesSection.svelte'
```

Update `sectionIds`:

```typescript
const sectionIds = ['overview', 'billing', 'stats', 'memos', 'reminders', 'identities', 'groups', 'instances', 'system']
```

Mount before System:

```svelte
<InstancesSection />
<SystemSection />
```

- [ ] **Step 8: Run client tests**

Run: `bun test:client -- tests/client/admin/admin.svelte.test.ts tests/client/admin/AdminApp.test.ts tests/client/admin/sections/InstancesSection.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add client/admin/admin.svelte.ts client/admin/AdminApp.svelte client/admin/sections/InstancesSection.svelte tests/client/admin/admin.svelte.test.ts tests/client/admin/AdminApp.test.ts tests/client/admin/sections/InstancesSection.test.ts
git commit -m "feat(admin): add instances dashboard section"
```

### Task 9: Final Verification And Documentation Sync

**Files:**

- Modify: `docs/superpowers/specs/2026-04-13-multi-provider-phase-4-admin-and-dashboard.md` if implementation discovered a mismatch
- Verify: full repo checks

- [ ] **Step 1: Run complete verification**

Run:

```bash
bun lint
bun format:check
bun typecheck
bun knip
bun test
bun test:client
```

Expected: every command exits 0. `bun test` should report no failures; `bun test:client` should report no failures.

- [ ] **Step 2: Run focused Phase 4 verification**

Run:

```bash
bun test ./tests/users.test.ts ./tests/auth.test.ts ./tests/commands/admin.test.ts ./tests/commands/plugin.test.ts ./tests/debug/instance-routes.test.ts ./tests/chat/router.test.ts
bun test:client -- tests/client/admin/fetchers.test.ts tests/client/admin/fetcher-schemas.test.ts tests/client/admin/sections/InstancesSection.test.ts
```

Expected: all focused suites pass.

- [ ] **Step 3: Inspect diff and status**

Run:

```bash

```

Expected: only Phase 4 files changed; `git diff --check` prints no output and exits 0.

- [ ] **Step 4: Commit any final doc-only alignment**

If the spec was updated during execution, commit it separately:

```bash

```

- [ ] **Step 5: Final implementation commit is not needed if Tasks 1-8 were committed**

Run:

```bash

```

Expected: recent commits show one focused commit per task.

## Self-Review

### Spec Coverage

- Admin predicates: Tasks 1-2 add platform-scoped users and `admins`-backed predicates.
- `/user add` / `/user remove`: Task 3 scopes writes and deletes by `msg.platformInstanceId`.
- `/plugin` gating: Task 4 separates super-admin trust actions from platform/context actions.
- Dashboard API endpoints: Task 6 creates `/api/platform-instances`, `/api/task-instances`, and `/api/admins` handlers.
- Apply endpoint: Tasks 5-6 add `ChatRouter.listInstances()` and reconcile active DB rows.
- Dashboard UI: Tasks 7-8 add typed fetchers and `/admin#instances`.
- Secret masking: Task 6 masks server responses with `maskConfig`; Task 8 only renders returned data.
- Error handling: Task 6 covers 400, 401, 503, 500, and delete behavior.

### Placeholder Scan

- The plan contains no placeholder markers.
- Each code-changing step includes concrete code or an exact replacement pattern.
- Each task includes exact verification commands and expected outcomes.

### Type Consistency

- `platformInstanceId` is the property name used across `IncomingMessage`, `users`, `admins`, `context_settings`, API schemas, and client types.
- Runtime router access uses `setRuntimeChatRouter()`, `getRuntimeChatRouter()`, and `clearRuntimeChatRouter()` consistently.
- The API and client both use `PlatformInstanceView`, `TaskInstanceView`, `AdminInstanceView`, and `ApplyInstancesResult`.
