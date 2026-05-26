<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Multi-Provider Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining multi-provider isolation, data-loss, and wrong-instance routing gaps before multi-provider support is considered complete.

**Architecture:** Add one canonical scoped context ID helper and migrate context-owned storage to use `platformInstanceId + nativeContextId` instead of raw IDs. Then route staged downloads through exact chat instances, constrain user cleanup and username resolution by platform scope, make Kaneo provisioning use task-instance config, and skip proactive sends to stopped chat instances.

**Tech Stack:** Bun test runner, TypeScript, Drizzle ORM SQLite schema/migrations, existing `ChatRouter`, existing instance stores, pino logging, oxlint/oxfmt.

---

## External Documentation Checked

- Drizzle ORM docs via Context7: composite primary keys, SQLite unique indexes, and SQLite upsert conflict targets.
- Web search: Drizzle SQLite table/index documentation confirmed `uniqueIndex` / unique index support for SQLite.

## File Structure

### New files

- `src/chat/scoped-context.ts` — canonical scoped context ID encoder used by auth, setup, config, storage, and tests.
- `tests/chat/scoped-context.test.ts` — unit tests for stable encoding and thread scoping.
- `src/db/migrations/043_scoped_context_ids.ts` — migration for scoped context IDs, staged file source instance, username uniqueness, and single-instance backfill.
- `tests/db/migrations/043_scoped_context_ids.test.ts` — migration tests for unambiguous backfill, ambiguous preservation, staged file source instance column, and duplicate username deduplication.

### Modified files

- `src/db/index.ts` — register migration 043.
- `src/db/schema.ts` — add partial username uniqueness to `users`.
- `src/db/staged-schema.ts` — add `sourcePlatformInstanceId` column.
- `src/auth.ts` — compute scoped `storageContextId` and `configContextId` with `platformInstanceId`.
- `src/groups.ts` and `src/authorized-groups.ts` — store and query scoped group IDs supplied by command/auth call sites.
- `src/commands/group.ts` — use scoped config context for membership and group authorization mutations; keep native IDs for provider label rendering.
- `src/setup/task-instance-selection.ts` — expect already-scoped context IDs when writing `context_settings`.
- `src/bot-attachments.ts` — include `msg.platformInstanceId` when staging file candidates.
- `src/attachments/types.ts`, `src/attachments/staged.ts`, `src/attachments/staged-download.ts` — persist and use `sourcePlatformInstanceId` for staged downloads.
- `src/chat/router.ts` — add `isInstanceActive()` and `downloadFileFromInstance()` for staged downloads.
- `src/chat/telegram/index.ts`, `src/chat/mattermost/index.ts`, `src/chat/telegram/file-fetcher.ts`, `src/chat/mattermost/index.ts` — remove global fetcher dependency and expose instance-local file fetch.
- `src/users.ts` — make username add/resolve idempotent and delete recurring tasks only by scoped owner context.
- `src/providers/kaneo/provision.ts` — use assigned task instance URL/internal URL for provisioning.
- `src/deferred-prompts/proactive-delivery.ts` — skip missing or stopped router instances.
- Relevant tests under `tests/auth.test.ts`, `tests/bot.test.ts`, `tests/commands/group.test.ts`, `tests/users.test.ts`, `tests/chat/router.test.ts`, `tests/chat/delivery-routing.test.ts`, `tests/bot-attachments.test.ts`, `tests/attachments/staged.test.ts`, `tests/attachments/staged-download.test.ts`, `tests/providers/kaneo/provision.test.ts`, and `tests/deferred-prompts/poller.test.ts`.

### Decomposition decisions

- Scope identity first. Later tasks depend on `toScopedContextId()` and `toScopedThreadContextId()`.
- Migration is separate from runtime changes so existing data safety is reviewed independently.
- Attachment routing is independent once scoped context IDs exist, so it can be tested without touching provider task resolution.
- User cleanup and username idempotency are grouped because both mutate `users` and depend on the same scoped platform identity invariants.
- Kaneo provisioning and proactive delivery are last because they are behavior fixes that do not affect storage migration.

---

### Task 1: Add Scoped Context Helper And Auth Runtime Contract

**Files:**

- Create: `src/chat/scoped-context.ts`
- Create: `tests/chat/scoped-context.test.ts`
- Modify: `src/auth.ts`
- Modify: `tests/auth.test.ts`

- [ ] **Step 1: Write failing scoped context tests**

Create `tests/chat/scoped-context.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { toScopedContextId, toScopedThreadContextId } from '../../src/chat/scoped-context.js'

describe('scoped chat context ids', () => {
  test('includes platform instance and native context', () => {
    expect(toScopedContextId({ platformInstanceId: 'telegram-default', nativeContextId: '123' })).toBe(
      'pi:dGVsZWdyYW0tZGVmYXVsdA:ctx:MTIz',
    )
  })

  test('distinguishes identical native ids on different platform instances', () => {
    const telegram = toScopedContextId({ platformInstanceId: 'telegram-default', nativeContextId: 'shared' })
    const discord = toScopedContextId({ platformInstanceId: 'discord-default', nativeContextId: 'shared' })

    expect(telegram).not.toBe(discord)
  })

  test('adds thread component only when thread id is present', () => {
    expect(
      toScopedThreadContextId({
        platformInstanceId: 'mattermost-team',
        nativeContextId: 'channel-1',
        threadId: 'root-post',
      }),
    ).toBe('pi:bWF0dGVybW9zdC10ZWFt:ctx:Y2hhbm5lbC0x:thread:cm9vdC1wb3N0')
  })
})
```

- [ ] **Step 2: Run scoped context tests to verify they fail**

Run: `bun test ./tests/chat/scoped-context.test.ts`

Expected: FAIL with module resolution error for `../../src/chat/scoped-context.js`.

- [ ] **Step 3: Implement scoped context helper**

Create `src/chat/scoped-context.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type PlatformScopedContext = Readonly<{
  platformInstanceId: string
  nativeContextId: string
}>

export type PlatformScopedThreadContext = PlatformScopedContext &
  Readonly<{
    threadId?: string
  }>

const encodeComponent = (value: string): string => Buffer.from(value, 'utf8').toString('base64url')

export const toScopedContextId = (input: PlatformScopedContext): string =>
  `pi:${encodeComponent(input.platformInstanceId)}:ctx:${encodeComponent(input.nativeContextId)}`

export const toScopedThreadContextId = (input: PlatformScopedThreadContext): string => {
  const scoped = toScopedContextId(input)
  if (input.threadId === undefined) return scoped
  return `${scoped}:thread:${encodeComponent(input.threadId)}`
}
```

- [ ] **Step 4: Run scoped context tests to verify they pass**

Run: `bun test ./tests/chat/scoped-context.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing auth tests for platform-scoped storage IDs**

In `tests/auth.test.ts`, replace the expectations in `getThreadScopedStorageContextId` with scoped variants and add a direct check on `checkAuthorizationExtendedScoped`:

```typescript
test('returns scoped user id for DM context when platform is provided', () => {
  const result = getThreadScopedStorageContextId('user123', 'dm', undefined, 'telegram-default')

  expect(result).toBe('pi:dGVsZWdyYW0tZGVmYXVsdA:ctx:dXNlcjEyMw')
})

test('returns scoped group thread id when platform is provided', () => {
  const result = getThreadScopedStorageContextId('group456', 'group', 'thread789', 'discord-default')

  expect(result).toBe('pi:ZGlzY29yZC1kZWZhdWx0:ctx:Z3JvdXA0NTY:thread:dGhyZWFkNzg5')
})

test('authorized DM gets scoped storage context', () => {
  addScopedUser({ userId: 'u1', platformInstanceId: 'telegram-default', addedBy: 'root-user' })

  const auth = checkAuthorizationExtendedScoped('u1', null, 'u1', 'dm', undefined, false, 'telegram-default')

  expect(auth.allowed).toBe(true)
  expect(auth.storageContextId).toBe('pi:dGVsZWdyYW0tZGVmYXVsdA:ctx:dTE')
  expect(auth.configContextId).toBe('pi:dGVsZWdyYW0tZGVmYXVsdA:ctx:dTE')
})
```

- [ ] **Step 6: Run auth tests to verify they fail**

Run: `bun test ./tests/auth.test.ts -t "scoped"`

Expected: FAIL because `getThreadScopedStorageContextId()` does not accept `platformInstanceId` and auth returns raw IDs.

- [ ] **Step 7: Update `src/auth.ts`**

Change `getThreadScopedStorageContextId()` to keep its existing overloads and add a platform-aware overload:

```typescript
export function getThreadScopedStorageContextId(
  ...args:
    | [contextId: string, contextType: ContextType]
    | [contextId: string, contextType: ContextType, threadId: string | undefined]
    | [contextId: string, contextType: ContextType, threadId: string | undefined, platformInstanceId: string]
): string {
  const [contextId, contextType, threadId, platformInstanceId] = args
  if (platformInstanceId !== undefined) {
    const input = { platformInstanceId, nativeContextId: contextId }
    if (contextType === 'dm') return toScopedContextId(input)
    return toScopedThreadContextId({ ...input, threadId })
  }
  if (contextType === 'dm') return contextId
  if (threadId === undefined) return contextId
  return `${contextId}:${threadId}`
}
```

Then pass `platformInstanceId` through `getBotAdminAuth()`, `getGroupMemberAuth()`, `getUnauthorizedGroupAuth()`, `getDmUserAuth()`, and `getUnauthorizedDmAuth()` so every `AuthorizationResult.storageContextId` and `configContextId` is scoped when `checkAuthorizationExtended()` is called with a platform instance.

- [ ] **Step 8: Run focused auth tests**

Run: `bun test ./tests/chat/scoped-context.test.ts ./tests/auth.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit Task 1**

```bash
git add src/chat/scoped-context.ts src/auth.ts tests/chat/scoped-context.test.ts tests/auth.test.ts
git commit -m "fix(chat): scope storage context ids by platform instance"
```

---

### Task 2: Add Migration 043 For Scoped IDs And Username Uniqueness

**Files:**

- Create: `src/db/migrations/043_scoped_context_ids.ts`
- Create: `tests/db/migrations/043_scoped_context_ids.test.ts`
- Modify: `src/db/index.ts`
- Modify: `src/db/staged-schema.ts`
- Modify: `src/db/schema.ts`

- [ ] **Step 1: Write failing migration tests**

Create `tests/db/migrations/043_scoped_context_ids.test.ts` with tests that construct the affected legacy tables and run migration 043:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { migration043ScopedContextIds } from '../../../src/db/migrations/043_scoped_context_ids.js'

describe('migration043ScopedContextIds', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.run('PRAGMA foreign_keys=OFF')
    db.run(
      'CREATE TABLE platform_instances (id TEXT PRIMARY KEY, type TEXT NOT NULL, config TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL)',
    )
    db.run(
      'CREATE TABLE context_settings (context_id TEXT PRIMARY KEY, task_instance_id TEXT NOT NULL, platform_instance_id TEXT NOT NULL)',
    )
    db.run(
      'CREATE TABLE user_config (user_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (user_id, key))',
    )
    db.run('CREATE TABLE conversation_history (user_id TEXT PRIMARY KEY, messages TEXT NOT NULL)')
    db.run('CREATE TABLE memory_summary (user_id TEXT PRIMARY KEY, summary TEXT NOT NULL, updated_at TEXT NOT NULL)')
    db.run(
      "CREATE TABLE memory_facts (user_id TEXT NOT NULL, identifier TEXT NOT NULL, title TEXT NOT NULL, url TEXT NOT NULL DEFAULT '', last_seen TEXT NOT NULL, PRIMARY KEY (user_id, identifier))",
    )
    db.run('CREATE TABLE authorized_groups (group_id TEXT PRIMARY KEY, added_by TEXT NOT NULL, added_at TEXT NOT NULL)')
    db.run(
      'CREATE TABLE group_members (group_id TEXT NOT NULL, user_id TEXT NOT NULL, added_by TEXT NOT NULL, added_at TEXT NOT NULL, PRIMARY KEY (group_id, user_id))',
    )
    db.run(
      'CREATE TABLE recurring_tasks (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, project_id TEXT NOT NULL, title TEXT NOT NULL)',
    )
    db.run(
      'CREATE TABLE scheduled_prompts (id TEXT PRIMARY KEY, created_by_user_id TEXT NOT NULL, delivery_context_id TEXT, prompt TEXT NOT NULL)',
    )
    db.run(
      'CREATE TABLE alert_prompts (id TEXT PRIMARY KEY, created_by_user_id TEXT NOT NULL, delivery_context_id TEXT, prompt TEXT NOT NULL)',
    )
    db.run(
      'CREATE TABLE task_snapshots (user_id TEXT NOT NULL, task_id TEXT NOT NULL, field TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (user_id, task_id, field))',
    )
    db.run(
      'CREATE TABLE staged_files (staged_id TEXT PRIMARY KEY, context_id TEXT NOT NULL, message_id TEXT, sender_id TEXT NOT NULL, sender_username TEXT, filename TEXT NOT NULL, mime_type TEXT, size INTEGER, platform_file_id TEXT NOT NULL, source_provider TEXT NOT NULL, status TEXT NOT NULL, attachment_id TEXT, created_at TEXT NOT NULL, expires_at TEXT NOT NULL)',
    )
    db.run(
      'CREATE TABLE users (platform_user_id TEXT NOT NULL, platform_instance_id TEXT NOT NULL, username TEXT, added_at TEXT NOT NULL, added_by TEXT NOT NULL, PRIMARY KEY (platform_instance_id, platform_user_id))',
    )
  })

  afterEach(() => db.close())

  test('scopes legacy context rows when one platform instance exists', () => {
    db.run("INSERT INTO platform_instances VALUES ('telegram-default', 'telegram', '{}', 'active', 'now')")
    db.run("INSERT INTO context_settings VALUES ('user-1', 'task-1', 'telegram-default')")
    db.run("INSERT INTO user_config VALUES ('user-1', 'timezone', 'UTC')")
    db.run("INSERT INTO authorized_groups VALUES ('group-1', 'admin', 'now')")
    db.run("INSERT INTO group_members VALUES ('group-1', 'user-1', 'admin', 'now')")

    migration043ScopedContextIds.up(db)

    const scopedUser = 'pi:dGVsZWdyYW0tZGVmYXVsdA:ctx:dXNlci0x'
    const scopedGroup = 'pi:dGVsZWdyYW0tZGVmYXVsdA:ctx:Z3JvdXAtMQ'
    expect(db.query('SELECT context_id FROM context_settings').get()).toEqual({ context_id: scopedUser })
    expect(db.query('SELECT user_id FROM user_config').get()).toEqual({ user_id: scopedUser })
    expect(db.query('SELECT group_id FROM authorized_groups').get()).toEqual({ group_id: scopedGroup })
    expect(db.query('SELECT group_id FROM group_members').get()).toEqual({ group_id: scopedGroup })
  })

  test('preserves ambiguous legacy rows when multiple platform instances exist', () => {
    db.run("INSERT INTO platform_instances VALUES ('telegram-default', 'telegram', '{}', 'active', 'now')")
    db.run("INSERT INTO platform_instances VALUES ('discord-default', 'discord', '{}', 'active', 'now')")
    db.run("INSERT INTO user_config VALUES ('user-1', 'timezone', 'UTC')")

    migration043ScopedContextIds.up(db)

    expect(db.query('SELECT user_id FROM user_config').get()).toEqual({ user_id: 'user-1' })
  })

  test('adds staged source platform column with empty fallback', () => {
    migration043ScopedContextIds.up(db)

    const columns = db
      .query<{ name: string }, []>('PRAGMA table_info(staged_files)')
      .all()
      .map((row) => row.name)
    expect(columns).toContain('source_platform_instance_id')
  })

  test('deduplicates usernames before adding unique index', () => {
    db.run("INSERT INTO users VALUES ('placeholder-old', 'telegram-default', 'alice', '2026-01-01', 'admin')")
    db.run("INSERT INTO users VALUES ('placeholder-new', 'telegram-default', 'alice', '2026-02-01', 'admin')")

    migration043ScopedContextIds.up(db)

    expect(
      db
        .query(
          "SELECT COUNT(*) AS count FROM users WHERE platform_instance_id = 'telegram-default' AND username = 'alice'",
        )
        .get(),
    ).toEqual({ count: 1 })
  })
})
```

- [ ] **Step 2: Run migration tests to verify they fail**

Run: `bun test ./tests/db/migrations/043_scoped_context_ids.test.ts`

Expected: FAIL with module resolution error for migration 043.

- [ ] **Step 3: Implement migration 043**

Create `src/db/migrations/043_scoped_context_ids.ts` with these exported pieces:

```typescript
import type { Database } from 'bun:sqlite'

import { toScopedContextId } from '../../chat/scoped-context.js'
import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:043' })

const tableExists = (db: Database, table: string): boolean =>
  db
    .query<{ name: string }, [string]>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) !== null

const columnExists = (db: Database, table: string, column: string): boolean =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .some((row) => row.name === column)

const getSinglePlatformInstanceId = (db: Database): string | null => {
  if (!tableExists(db, 'platform_instances')) return null
  const rows = db.query<{ id: string }, []>('SELECT id FROM platform_instances ORDER BY id').all()
  return rows.length === 1 ? rows[0]!.id : null
}

const scopeValue = (platformInstanceId: string, value: string | null): string | null => {
  if (value === null) return null
  if (value.startsWith('pi:')) return value
  return toScopedContextId({ platformInstanceId, nativeContextId: value })
}
```

Then add helper updates for each table listed in the spec. Use `UPDATE ... SET column = ? WHERE column = ?` loops rather than nested SQL string building so escaping remains simple. Add `ALTER TABLE staged_files ADD COLUMN source_platform_instance_id TEXT NOT NULL DEFAULT ''` if missing. Deduplicate duplicate `(platform_instance_id, username)` rows by keeping a real non-placeholder row when present, otherwise the oldest row. Finally run:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_platform_username_unique
ON users(platform_instance_id, username)
WHERE username IS NOT NULL
```

Export:

```typescript
export const migration043ScopedContextIds: Migration = {
  id: '043_scoped_context_ids',
  up(db) {
    const platformInstanceId = getSinglePlatformInstanceId(db)
    if (platformInstanceId === null) {
      log.warn('migration 043: preserving legacy context ids because platform ownership is ambiguous')
    } else {
      scopeContextOwnedRows(db, platformInstanceId)
    }
    addStagedSourcePlatformColumn(db)
    deduplicateUsernames(db)
    db.run(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_platform_username_unique ON users(platform_instance_id, username) WHERE username IS NOT NULL`,
    )
  },
}
```

- [ ] **Step 4: Register migration 043 and update schema**

In `src/db/index.ts`, import `migration043ScopedContextIds` and append it after migration 042 in `MIGRATIONS`.

In `src/db/staged-schema.ts`, add:

```typescript
sourcePlatformInstanceId: text('source_platform_instance_id').notNull().default(''),
```

In `src/db/schema.ts`, import `uniqueIndex` from `drizzle-orm/sqlite-core` and add this extra config entry for `users`:

```typescript
uniqueIndex('idx_users_platform_username_unique')
  .on(table.platformInstanceId, table.username)
  .where(sql`${table.username} IS NOT NULL`),
```

- [ ] **Step 5: Run migration tests and registration tests**

Run: `bun test ./tests/db/migrations/043_scoped_context_ids.test.ts ./tests/db/migration-registration.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add src/db/migrations/043_scoped_context_ids.ts src/db/index.ts src/db/schema.ts src/db/staged-schema.ts tests/db/migrations/043_scoped_context_ids.test.ts tests/db/migration-registration.test.ts
git commit -m "fix(db): migrate context-owned rows to platform scoped ids"
```

---

### Task 3: Apply Scoped Context IDs To Runtime Storage Call Sites

**Files:**

- Modify: `src/commands/group.ts`
- Modify: `src/groups.ts`
- Modify: `src/authorized-groups.ts`
- Modify: `src/setup/task-instance-selection.ts`
- Modify: `tests/commands/group.test.ts`
- Modify: `tests/group-settings/dispatch.test.ts`
- Modify: `tests/setup/task-instance-selection.test.ts`
- Modify: `tests/bot.test.ts`
- Modify: `src/tools/tools-builder.ts`
- Modify: `tests/tools/web-fetch.test.ts`

- [ ] **Step 1: Write failing runtime isolation tests**

Add a test to `tests/commands/group.test.ts` proving same native group IDs on different platform instances do not share membership:

```typescript
test('group members are isolated by platform-scoped context id', async () => {
  await setupTestDb()
  const telegramGroup = createGroupMessage('admin', '/group adduser user-1', true, 'shared-group')
  telegramGroup.platformInstanceId = 'telegram-default'
  const discordGroup = createGroupMessage('admin', '/group users', true, 'shared-group')
  discordGroup.platformInstanceId = 'discord-default'
  const telegramAuth = createAuth({
    allowed: true,
    isGroupAdmin: true,
    storageContextId: 'pi:dGVsZWdyYW0tZGVmYXVsdA:ctx:c2hhcmVkLWdyb3Vw',
    configContextId: 'pi:dGVsZWdyYW0tZGVmYXVsdA:ctx:c2hhcmVkLWdyb3Vw',
  })
  const discordAuth = createAuth({
    allowed: true,
    isGroupAdmin: true,
    storageContextId: 'pi:ZGlzY29yZC1kZWZhdWx0:ctx:c2hhcmVkLWdyb3Vw',
    configContextId: 'pi:ZGlzY29yZC1kZWZhdWx0:ctx:c2hhcmVkLWdyb3Vw',
  })
  const telegramReply = createMockReply()
  const discordReply = createMockReply()
  const chat = createMockChat()

  await handleGroupCommand(chat, telegramGroup, telegramReply, telegramAuth)
  await handleGroupCommand(chat, discordGroup, discordReply, discordAuth)

  expect(discordReply.messages.at(-1)).toBe('No members in this group yet.')
})
```

Adjust function names/imports to match the existing exports in `tests/commands/group.test.ts`; do not add new production exports only for this test.

- [ ] **Step 2: Run group tests to verify they fail**

Run: `bun test ./tests/commands/group.test.ts -t "isolated by platform-scoped"`

Expected: FAIL because current group storage still keys by raw `msg.contextId`.

- [ ] **Step 3: Update command storage call sites**

In `src/commands/group.ts`, replace storage writes/reads that use `msg.contextId` with `auth.configContextId ?? auth.storageContextId`:

```typescript
const storageGroupId = auth.configContextId ?? auth.storageContextId
addAuthorizedGroup(storageGroupId, msg.user.id)
removeAuthorizedGroup(storageGroupId)
addGroupMember(storageGroupId, userId, msg.user.id)
removeGroupMember(storageGroupId, userId)
const members = listGroupMembers(storageGroupId)
```

Keep provider label resolution using native `msg.contextId` and `msg.platformInstanceId`.

- [ ] **Step 4: Update setup and group-settings tests for scoped IDs**

In setup selection tests, assert `setContextSettings()` receives scoped `contextId` values passed by auth/bot flow. Do not make `startTaskInstanceSelection()` compute scoping itself; its caller owns the storage context.

- [ ] **Step 5: Run focused runtime tests**

Before running tests, update web-fetch actor scoping so runtime writes the same scoped actor IDs that migration 043 writes into `web_rate_limit.actor_id`. In `src/tools/tools-builder.ts`, pass the scoped storage context ID as the web-fetch actor when `contextId` is available:

```typescript
addWebFetchTool(tools, contextId, contextId ?? chatUserId, contextType)
```

Add or update `tests/tools/web-fetch.test.ts` to assert `fetchAndExtract()` receives `actorUserId` equal to the scoped storage context ID when the tool is assembled with a storage context.

Run: `bun test ./tests/auth.test.ts ./tests/commands/group.test.ts ./tests/group-settings/dispatch.test.ts ./tests/setup/task-instance-selection.test.ts ./tests/bot.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add src/commands/group.ts src/groups.ts src/authorized-groups.ts src/setup/task-instance-selection.ts src/tools/tools-builder.ts tests/commands/group.test.ts tests/group-settings/dispatch.test.ts tests/setup/task-instance-selection.test.ts tests/bot.test.ts tests/tools/web-fetch.test.ts
git commit -m "fix(auth): use scoped context ids for runtime storage"
```

---

### Task 4: Route Staged Attachment Downloads Through Source Instances

**Files:**

- Modify: `src/attachments/types.ts`
- Modify: `src/attachments/staged.ts`
- Modify: `src/attachments/staged-download.ts`
- Modify: `src/bot-attachments.ts`
- Modify: `src/chat/router.ts`
- Modify: `src/chat/telegram/index.ts`
- Modify: `src/chat/telegram/file-fetcher.ts`
- Modify: `src/chat/mattermost/index.ts`
- Modify: `tests/bot-attachments.test.ts`
- Modify: `tests/attachments/staged.test.ts`
- Modify: `tests/chat/router.test.ts`

- [ ] **Step 1: Write failing staged file source-instance tests**

In `tests/attachments/staged.test.ts`, add:

```typescript
test('passes source platform instance id to staged downloader', async () => {
  await setupTestDb()
  const ref = stageFileMetadata({
    contextId: 'ctx-1',
    messageId: 'msg-1',
    senderId: 'sender-1',
    senderUsername: 'alice',
    filename: 'note.txt',
    mimeType: 'text/plain',
    size: 4,
    platformFileId: 'file-1',
    sourceProvider: 'telegram',
    sourcePlatformInstanceId: 'telegram-a',
  })
  const calls: Array<{ fileId: string; sourceProvider: string; sourcePlatformInstanceId: string }> = []

  await resolveStagedFile(ref.stagedId, 'ctx-1', async (fileId, sourceProvider, sourcePlatformInstanceId) => {
    calls.push({ fileId, sourceProvider, sourcePlatformInstanceId })
    return Buffer.from('test')
  })

  expect(calls).toEqual([{ fileId: 'file-1', sourceProvider: 'telegram', sourcePlatformInstanceId: 'telegram-a' }])
})
```

- [ ] **Step 2: Run staged attachment test to verify it fails**

Run: `bun test ./tests/attachments/staged.test.ts -t "source platform instance"`

Expected: FAIL because `StageFileParams` and `StagedFileDownloadFn` do not include `sourcePlatformInstanceId`.

- [ ] **Step 3: Update attachment types and staged persistence**

In `src/attachments/types.ts`, add `sourcePlatformInstanceId: string` to `StagedFileRef` and `StageFileParams`, and change `StagedFileDownloadFn` to:

```typescript
export type StagedFileDownloadFn = (
  platformFileId: string,
  sourceProvider: AttachmentSourceProvider,
  sourcePlatformInstanceId: string,
) => Promise<Buffer | null>
```

In `src/attachments/staged.ts`, read/write `sourcePlatformInstanceId` from `stagedFiles.sourcePlatformInstanceId`, include it in `onConflictDoUpdate`, and call:

```typescript
const content = await downloadFn(row.platformFileId, toSourceProvider(row.sourceProvider), row.sourcePlatformInstanceId)
```

- [ ] **Step 4: Add source platform when staging candidates**

In `src/bot-attachments.ts`, pass `sourcePlatformInstanceId: params.msg.platformInstanceId` into `stageFileMetadataFn()`.

- [ ] **Step 5: Replace global fetchers with instance-local routing**

Update `src/attachments/staged-download.ts` so `createStagedDownloader()` accepts a `ChatProvider` or lookup function instead of global provider-type fetchers:

```typescript
type ChatInstanceFileLookup = {
  downloadFileFromInstance: (
    platformInstanceId: string,
    sourceProvider: AttachmentSourceProvider,
    fileId: string,
  ) => Promise<Buffer | null>
}
```

Add `downloadFileFromInstance()` to `ChatRouter`. It gets the managed instance, returns `null` unless active, and delegates to adapter `downloadFile(fileId)` methods on Telegram/Mattermost providers.

- [ ] **Step 6: Update Telegram and Mattermost adapters**

Remove global singleton fetcher usage. Add instance methods:

```typescript
downloadFile(fileId: string): Promise<Buffer | null> {
  const fetcher = createTelegramFileFetcher(this.bot.api, this.token, log)
  return fetcher(fileId)
}
```

For Mattermost:

```typescript
downloadFile(fileId: string): Promise<Buffer | null> {
  return downloadMattermostFile(this.baseUrl, this.token, fileId)
}
```

- [ ] **Step 7: Run focused attachment tests**

Run: `bun test ./tests/attachments/staged.test.ts ./tests/bot-attachments.test.ts ./tests/chat/router.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit Task 4**

```bash
git add src/attachments/types.ts src/attachments/staged.ts src/attachments/staged-download.ts src/bot-attachments.ts src/chat/router.ts src/chat/telegram/index.ts src/chat/telegram/file-fetcher.ts src/chat/mattermost/index.ts tests/attachments/staged.test.ts tests/bot-attachments.test.ts tests/chat/router.test.ts
git commit -m "fix(attachments): route staged downloads by platform instance"
```

---

### Task 5: Make User Removal And Username Resolution Platform-Safe

**Files:**

- Modify: `src/users.ts`
- Modify: `src/commands/admin.ts`
- Modify: `tests/users.test.ts`
- Modify: `tests/commands/admin.test.ts`

- [ ] **Step 1: Write failing recurring cleanup test**

In `tests/users.test.ts`, add:

```typescript
test('removes recurring tasks only for scoped platform owner', () => {
  const db = testDb
  addUser({ userId: 'same-id', platformInstanceId: 'telegram-default', addedBy: 'admin' })
  addUser({ userId: 'same-id', platformInstanceId: 'discord-default', addedBy: 'admin' })
  db.insert(schema.recurringTasks)
    .values({
      id: 'tg-recurring',
      userId: 'pi:dGVsZWdyYW0tZGVmYXVsdA:ctx:c2FtZS1pZA',
      projectId: 'p1',
      title: 'tg task',
    })
    .run()
  db.insert(schema.recurringTasks)
    .values({
      id: 'ds-recurring',
      userId: 'pi:ZGlzY29yZC1kZWZhdWx0:ctx:c2FtZS1pZA',
      projectId: 'p1',
      title: 'ds task',
    })
    .run()

  expect(removeUser('same-id', 'telegram-default')).toBe(true)

  expect(db.select({ id: schema.recurringTasks.id }).from(schema.recurringTasks).all()).toEqual([
    { id: 'ds-recurring' },
  ])
})
```

- [ ] **Step 2: Write failing username idempotency tests**

In `tests/users.test.ts`, add:

```typescript
test('reuses username row on repeated add for same platform', () => {
  addUser({ userId: 'placeholder-one', platformInstanceId: TEST_PLATFORM_ID, addedBy: 'admin', username: 'alice' })
  addUser({ userId: 'placeholder-two', platformInstanceId: TEST_PLATFORM_ID, addedBy: 'admin', username: 'alice' })

  expect(listUsers(TEST_PLATFORM_ID).filter((user) => user.username === 'alice')).toHaveLength(1)
})

test('resolveUserByUsername updates one placeholder only', () => {
  addUser({ userId: 'placeholder-one', platformInstanceId: TEST_PLATFORM_ID, addedBy: 'admin', username: 'alice' })

  expect(resolveUserByUsername('real-alice', 'alice', TEST_PLATFORM_ID)).toBe(true)
  expect(listUsers(TEST_PLATFORM_ID).filter((user) => user.username === 'alice')).toEqual([
    expect.objectContaining({ platform_user_id: 'real-alice', username: 'alice' }),
  ])
})
```

- [ ] **Step 3: Run user tests to verify they fail**

Run: `bun test ./tests/users.test.ts -t "recurring tasks only|reuses username|updates one placeholder"`

Expected: FAIL because cleanup and duplicate username handling are not platform-safe.

- [ ] **Step 4: Update `src/users.ts`**

Add helper:

```typescript
const scopedUserContextId = (platformInstanceId: string, userId: string): string =>
  toScopedContextId({ platformInstanceId, nativeContextId: userId })
```

Change `removeUser()` recurring cleanup to delete by `scopedUserContextId(platformInstanceId, row.platformUserId)` only. Change `addUser()` so username adds first look up an existing row by `(platformInstanceId, username)` and return without inserting a second placeholder. Change `resolveUserByUsername()` to fetch one row, return true if it already matches, update only that row if it is a placeholder, and avoid broad updates by username.

- [ ] **Step 5: Update admin command username expectations**

In `tests/commands/admin.test.ts`, assert repeated `/user add @alice` replies as authorized but leaves one user row for the source platform.

- [ ] **Step 6: Run focused user/admin tests**

Run: `bun test ./tests/users.test.ts ./tests/commands/admin.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit Task 5**

```bash
git add src/users.ts src/commands/admin.ts tests/users.test.ts tests/commands/admin.test.ts
git commit -m "fix(users): constrain user cleanup and username resolution by platform"
```

---

### Task 6: Use Task Instance Config For Kaneo Provisioning

**Files:**

- Modify: `src/providers/kaneo/provision.ts`
- Modify: `tests/providers/kaneo/provision.test.ts`

- [ ] **Step 1: Write failing Kaneo provisioning test**

In `tests/providers/kaneo/provision.test.ts`, add a test that assigns an active Kaneo task instance with `url` and `internalUrl`, clears `KANEO_CLIENT_URL`, and expects provisioning to use the DB URL:

```typescript
test('auto-provisioning uses assigned task instance URL without KANEO_CLIENT_URL', async () => {
  await setupTestDb()
  delete process.env['KANEO_CLIENT_URL']
  process.env['INSTANCE_CONFIG_KEY'] = '4'.repeat(64)
  insertTaskInstance({
    id: 'kaneo-team-a',
    type: 'kaneo',
    status: 'active',
    config: { url: 'https://kaneo.public.invalid', internalUrl: 'https://kaneo.internal.invalid' },
  })
  setContextSettings({
    contextId: 'ctx-1',
    taskInstanceId: 'kaneo-team-a',
    platformInstanceId: 'telegram-default',
  })
  const reply = createMockReply()

  await maybeProvisionKaneo(reply, 'ctx-1', 'alice')

  expect(reply.messages.join('\n')).not.toContain('KANEO_CLIENT_URL not set')
})
```

- [ ] **Step 2: Run Kaneo provisioning test to verify it fails**

Run: `bun test ./tests/providers/kaneo/provision.test.ts -t "task instance URL"`

Expected: FAIL because `provisionAndConfigure()` still reads `KANEO_CLIENT_URL`.

- [ ] **Step 3: Update provisioning API**

In `src/providers/kaneo/provision.ts`, change `provisionAndConfigure()` to accept URLs:

```typescript
export type ProvisionConfig = Readonly<{
  publicUrl: string
  internalUrl?: string
}>

export async function provisionAndConfigure(
  userId: string,
  username: string | null,
  config: ProvisionConfig,
): Promise<ProvisionOutcome> {
  const kaneoUrl = config.publicUrl
  const kaneoInternalUrl = config.internalUrl ?? kaneoUrl
  // existing provisionKaneoUser call uses kaneoInternalUrl and kaneoUrl
}
```

In `maybeProvisionKaneo()`, derive:

```typescript
const publicUrl = taskInstance.config['baseUrl'] ?? taskInstance.config['url']
const internalUrl = taskInstance.config['internalUrl']
if (publicUrl === undefined || publicUrl.trim() === '') {
  provLog.warn(
    { contextId, taskInstanceId: taskInstance.id },
    'Kaneo auto-provisioning skipped: task instance URL missing',
  )
  return
}
const outcome = await provisionAndConfigure(contextId, username, { publicUrl, internalUrl })
```

Update `AdminCommandsDeps.provisionAndConfigure` to accept the new explicit provisioning config. For `/user add`, keep the existing best-effort provisioning behavior by passing `{ publicUrl: process.env['KANEO_CLIENT_URL'], internalUrl: process.env['KANEO_INTERNAL_URL'] }` only when `KANEO_CLIENT_URL` is set; otherwise skip the best-effort provisioning note and leave `/setup` as the user-facing configuration path.

- [ ] **Step 4: Run focused Kaneo tests**

Run: `bun test ./tests/providers/kaneo/provision.test.ts ./tests/commands/admin.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit Task 6**

```bash
git add src/providers/kaneo/provision.ts tests/providers/kaneo/provision.test.ts tests/commands/admin.test.ts
git commit -m "fix(kaneo): provision from assigned task instance config"
```

---

### Task 7: Skip Proactive Delivery To Stopped Instances

**Files:**

- Modify: `src/chat/router.ts`
- Modify: `src/deferred-prompts/proactive-delivery.ts`
- Modify: `tests/chat/router.test.ts`
- Modify: `tests/chat/delivery-routing.test.ts`
- Modify: `tests/deferred-prompts/poller.test.ts`

- [ ] **Step 1: Write failing proactive delivery tests**

In `tests/chat/router.test.ts`, add:

```typescript
test('isInstanceActive reports only active instances', async () => {
  const router = new ChatRouter((id, type) => makeProvider(type))
  router.addInstance('telegram-a', 'telegram', { token: 'x' })

  expect(router.isInstanceActive('telegram-a')).toBe(false)
  await router.startInstance('telegram-a')
  expect(router.isInstanceActive('telegram-a')).toBe(true)
  await router.stopInstance('telegram-a')
  expect(router.isInstanceActive('telegram-a')).toBe(false)
})
```

In `tests/chat/delivery-routing.test.ts`, add a test that `sendProactiveMessage()` returns `false` when `isInstanceActive()` returns false.

- [ ] **Step 2: Run routing tests to verify they fail**

Run: `bun test ./tests/chat/router.test.ts ./tests/chat/delivery-routing.test.ts -t "isInstanceActive|stopped"`

Expected: FAIL because the router has no `isInstanceActive()` and proactive delivery only checks existence.

- [ ] **Step 3: Implement active guard**

In `src/chat/router.ts`, add:

```typescript
isInstanceActive(platformInstanceId: string): boolean {
  const instance = this.instances.get(platformInstanceId)
  return instance !== undefined && instance.status === 'active'
}
```

In `src/deferred-prompts/proactive-delivery.ts`, update the reflective guard:

```typescript
type RouterInstanceActiveLookup = { isInstanceActive: (id: string) => boolean }

if (hasRouterInstanceActiveLookup(chat) && !chat.isInstanceActive(platformInstanceId)) return null
```

- [ ] **Step 4: Run proactive delivery tests**

Run: `bun test ./tests/chat/router.test.ts ./tests/chat/delivery-routing.test.ts ./tests/deferred-prompts/poller.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit Task 7**

```bash
git add src/chat/router.ts src/deferred-prompts/proactive-delivery.ts tests/chat/router.test.ts tests/chat/delivery-routing.test.ts tests/deferred-prompts/poller.test.ts
git commit -m "fix(chat): skip proactive delivery to stopped instances"
```

---

### Task 8: Final Verification And Spec Sync

**Files:**

- Modify: `docs/superpowers/specs/2026-05-25-multi-provider-stabilization-design.md` only if implementation changes the approved design.
- Test-only if final verification reveals missing coverage.

- [ ] **Step 1: Run focused stabilization tests**

Run:

```bash
bun test ./tests/chat/scoped-context.test.ts ./tests/auth.test.ts ./tests/db/migrations/043_scoped_context_ids.test.ts ./tests/commands/group.test.ts ./tests/setup/task-instance-selection.test.ts ./tests/attachments/staged.test.ts ./tests/bot-attachments.test.ts ./tests/users.test.ts ./tests/commands/admin.test.ts ./tests/providers/kaneo/provision.test.ts ./tests/chat/router.test.ts ./tests/chat/delivery-routing.test.ts ./tests/deferred-prompts/poller.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run: `bun typecheck`

Expected: PASS with exit 0.

- [ ] **Step 3: Run strict lint for touched files**

Run:

```bash
bun lint:agent-strict -- src/chat/scoped-context.ts src/auth.ts src/db/migrations/043_scoped_context_ids.ts src/db/index.ts src/db/schema.ts src/db/staged-schema.ts src/commands/group.ts src/groups.ts src/authorized-groups.ts src/setup/task-instance-selection.ts src/attachments/types.ts src/attachments/staged.ts src/attachments/staged-download.ts src/bot-attachments.ts src/chat/router.ts src/chat/telegram/index.ts src/chat/telegram/file-fetcher.ts src/chat/mattermost/index.ts src/users.ts src/providers/kaneo/provision.ts src/deferred-prompts/proactive-delivery.ts
```

Expected: PASS with 0 errors.

- [ ] **Step 4: Run curated backend tests**

Run: `bun test`

Expected: PASS.

- [ ] **Step 5: Run format check**

Run: `bun format:check`

Expected: PASS.

- [ ] **Step 6: Re-read spec against implementation**

Open `docs/superpowers/specs/2026-05-25-multi-provider-stabilization-design.md` and verify each goal maps to code and tests:

- Scoped storage IDs: `src/chat/scoped-context.ts`, `src/auth.ts`, migration 043, auth/group/setup tests.
- Existing data migration: migration 043 tests.
- Exact attachment instance routing: staged attachment and router tests.
- Scoped user removal: users tests.
- Username idempotency: users/admin tests.
- Kaneo DB-source provisioning: Kaneo tests.
- Stopped proactive delivery skip: router/delivery tests.

- [ ] **Step 7: Inspect git diff**

Run: `git diff --check && git status --short`

Expected: no whitespace errors; only intended stabilization files changed.

- [ ] **Step 8: Commit final verification or spec sync**

If no files changed in Task 8 after verification, do not create an empty commit. If only the spec changed during Task 8:

```bash
git add docs/superpowers/specs/2026-05-25-multi-provider-stabilization-design.md
git commit -m "docs: sync multi-provider stabilization spec"
```

If Task 8 changed tests, run `git status --short`, inspect each changed test file, and stage only the inspected stabilization test files before committing with the same message.
