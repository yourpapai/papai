<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Guest Mode for Group Chats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-group "guest mode" toggle that lets any otherwise-unrecognized user in an authorized group interact with the bot using a **read-only** toolset, without affecting bot admins, group admins, or members.

**Architecture:** A new `guest_mode` boolean column on `authorized_groups` gates a new "allow as guest" branch in group auth. The auth result carries an `isGuest` flag, which is mapped to an `actorRole` (`'guest' | 'member'`) and threaded through the message queue → `processMessage` → orchestrator. Guests get a hardcoded read-only tool filter (read-risk tools only, bypassing per-context `tool_prefs`) and are excluded from long-term memory capture/extraction. A settings-UI group toggle drives the column.

**Tech Stack:** Bun, TypeScript (strict, `.js` import paths), Drizzle ORM + SQLite, Zod v4, Vercel AI SDK, Svelte 5 settings SPA. Tests via `bun test`.

**Spec:** `docs/superpowers/specs/2026-06-19-guest-mode-group-chats-design.md`

---

## File Structure

**New files:**

- `src/db/migrations/059_guest_mode.ts` — migration adding `guest_mode` to `authorized_groups`.
- `src/debug/settings/guest-mode-routes.ts` — _(not used; routes go into existing `group-routes.ts`)_. **Do not create.** Guest-mode handlers live in `src/debug/settings/group-routes.ts`.
- `client/settings/sections/GuestModeSection.svelte` — group-section toggle.
- Test files: `tests/auth/guest-mode-auth.test.ts`, `tests/tools/guest-readonly-filter.test.ts`, `tests/message-queue/guest-actor-role.test.ts`, `tests/long-term-memory/guest-capture-exclusion.test.ts`, `tests/debug/settings/guest-mode-routes.test.ts`.

**Modified files:**

- `src/chat/types.ts` — add `ActorRole` type and `isGuest` field on `AuthorizationResult`.
- `src/db/schema.ts` — add `guestMode` column to `authorizedGroups`.
- `src/db/index.ts` — register migration 059.
- `src/authorized-groups.ts` — `isGuestModeEnabled` / `setGuestMode` helpers.
- `src/auth.ts` — guest auth helper + guest branch.
- `src/message-queue/types.ts` — `actorRole` on `QueueItem` / `CoalescedItem`.
- `src/message-queue/queue.ts` — copy `actorRole` in `flush()`.
- `src/bot.ts` — set `actorRole` from auth; pass through `processCoalescedMessage`.
- `src/llm-orchestrator-process-args.ts` — `actorRole` in `ProcessMessageRest`.
- `src/llm-orchestrator.ts` — read `actorRole`, thread into `invocationSource` + history append.
- `src/llm-orchestrator-tools.ts` — `actorRole` on `InvocationSource` / `LlmInvocationOptions`; guest branch in `buildFullToolSet`.
- `src/tools/index.ts` — `applyGuestReadOnlyFilter`.
- `src/llm-history.ts` — thread `actorRole`; skip memory paths for guests.
- `src/long-term-memory/capture.ts` — `actorRole` on `RunMemoryCaptureInput`.
- `src/long-term-memory/capture-debounce.ts` — guest guard in `armMemoryCapture`.
- `src/debug/settings/group-routes.ts` — GET/PATCH `/settings/api/group/guest-mode`.
- `client/settings/fetcher-schemas.ts` — guest-mode response schema.
- `client/settings/fetchers.ts` — guest-mode fetchers.
- `client/settings/SettingsApp.svelte` — render `GuestModeSection` for groups.

---

## Task 1: Migration + schema column for `guest_mode`

**Files:**

- Create: `src/db/migrations/059_guest_mode.ts`
- Modify: `src/db/schema.ts` (authorizedGroups table, ~lines 99-109)
- Modify: `src/db/index.ts` (migration imports ~lines 14-71, `MIGRATIONS` array ~lines 106-165)
- Test: `tests/db/migration-059-guest-mode.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/db/migration-059-guest-mode.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { setupTestDb } from '../utils/test-helpers.js'
import { getDrizzleDb } from '../../src/db/drizzle.js'

describe('migration 059 guest_mode', () => {
  test('authorized_groups has a guest_mode column defaulting to 0', () => {
    setupTestDb()
    const cols = getDrizzleDb().$client.query<{ name: string }, []>(`PRAGMA table_info(authorized_groups)`).all()
    expect(cols.some((c) => c.name === 'guest_mode')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/db/migration-059-guest-mode.test.ts`
Expected: FAIL — `guest_mode` column not present.

- [ ] **Step 3: Create the migration file**

Create `src/db/migrations/059_guest_mode.ts` (mirrors `058_open_dm_access.ts` exactly):

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:059' })

const columnExists = (db: Database, table: string, column: string): boolean =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .some((row) => row.name === column)

const up = (db: Database): void => {
  if (!columnExists(db, 'authorized_groups', 'guest_mode')) {
    db.run(`ALTER TABLE authorized_groups ADD COLUMN guest_mode INTEGER NOT NULL DEFAULT 0`)
  }
  log.info('migration 059: guest_mode added to authorized_groups')
}

export const migration059GuestMode: Migration = { id: '059_guest_mode', up }

export default migration059GuestMode
```

- [ ] **Step 4: Register the migration in `src/db/index.ts`**

Add the import alongside the other migration imports (after the `058` import, ~line 71):

```typescript
import { migration059GuestMode } from './migrations/059_guest_mode.js'
```

Append to the `MIGRATIONS` array, immediately after `migration058OpenDmAccess` (~line 164):

```typescript
  migration059GuestMode,
```

- [ ] **Step 5: Add the Drizzle column to `authorizedGroups` in `src/db/schema.ts`**

Add a `guestMode` column to the `authorizedGroups` table definition. The table currently is:

```typescript
export const authorizedGroups = sqliteTable(
  'authorized_groups',
  {
    groupId: text('group_id').primaryKey(),
    addedBy: text('added_by').notNull(),
    addedAt: text('added_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [index('idx_authorized_groups_added_by').on(table.addedBy)],
)
```

Change it to add the column (note: `integer` must already be imported from `drizzle-orm/sqlite-core` — it is used by other tables in this file):

```typescript
export const authorizedGroups = sqliteTable(
  'authorized_groups',
  {
    groupId: text('group_id').primaryKey(),
    addedBy: text('added_by').notNull(),
    addedAt: text('added_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    guestMode: integer('guest_mode', { mode: 'boolean' }).notNull().default(false),
  },
  (table) => [index('idx_authorized_groups_added_by').on(table.addedBy)],
)
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bun test tests/db/migration-059-guest-mode.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/db/migrations/059_guest_mode.ts src/db/index.ts src/db/schema.ts tests/db/migration-059-guest-mode.test.ts
git commit -m "feat(db): add guest_mode column to authorized_groups (migration 059)"
```

---

## Task 2: Store helpers `isGuestModeEnabled` / `setGuestMode`

**Files:**

- Modify: `src/authorized-groups.ts` (add two exported functions; `isAuthorizedGroup` is at lines 58-69 for reference)
- Test: `tests/authorized-groups/guest-mode-store.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/authorized-groups/guest-mode-store.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { addAuthorizedGroup, isGuestModeEnabled, setGuestMode } from '../../src/authorized-groups.js'
import { setupTestDb } from '../utils/test-helpers.js'

describe('guest mode store', () => {
  beforeEach(() => {
    setupTestDb()
  })

  test('defaults to false for a newly authorized group', () => {
    addAuthorizedGroup('grp-1', 'admin')
    expect(isGuestModeEnabled('grp-1')).toBe(false)
  })

  test('setGuestMode round-trips', () => {
    addAuthorizedGroup('grp-1', 'admin')
    setGuestMode('grp-1', true)
    expect(isGuestModeEnabled('grp-1')).toBe(true)
    setGuestMode('grp-1', false)
    expect(isGuestModeEnabled('grp-1')).toBe(false)
  })

  test('returns false for an unknown group', () => {
    expect(isGuestModeEnabled('nope')).toBe(false)
  })
})
```

Note: verify the exact `addAuthorizedGroup` signature in `src/authorized-groups.ts` (it is `addAuthorizedGroup(groupId, addedBy)`). Adjust the call if the signature differs.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/authorized-groups/guest-mode-store.test.ts`
Expected: FAIL — `isGuestModeEnabled`/`setGuestMode` not exported.

- [ ] **Step 3: Add the helpers to `src/authorized-groups.ts`**

Append after `isAuthorizedGroup` (mirrors `isOpenDmAccessEnabled`/`setOpenDmAccess` in `src/instances/platform-store.ts`). The file already imports `eq` from `drizzle-orm`, `getDrizzleDb` from `./db/drizzle.js`, `authorizedGroups` from `./db/schema.js`, and has a `log` instance:

```typescript
export function isGuestModeEnabled(groupId: string): boolean {
  const row = getDrizzleDb()
    .select({ guestMode: authorizedGroups.guestMode })
    .from(authorizedGroups)
    .where(eq(authorizedGroups.groupId, groupId))
    .get()
  return row?.guestMode === true
}

export function setGuestMode(groupId: string, enabled: boolean): void {
  getDrizzleDb().update(authorizedGroups).set({ guestMode: enabled }).where(eq(authorizedGroups.groupId, groupId)).run()
  log.info({ groupId, enabled }, 'guest mode updated')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/authorized-groups/guest-mode-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/authorized-groups.ts tests/authorized-groups/guest-mode-store.test.ts
git commit -m "feat(groups): isGuestModeEnabled/setGuestMode store helpers"
```

---

## Task 3: Auth — `ActorRole` type, `isGuest` flag, guest branch

**Files:**

- Modify: `src/chat/types.ts` (`AuthorizationResult` ~lines 189-204)
- Modify: `src/auth.ts` (`getUnauthenticatedGroupAuth` lines 150-166; import line ~6-10)
- Test: `tests/auth/guest-mode-auth.test.ts` (create)

- [ ] **Step 1: Add the `ActorRole` type and `isGuest` field in `src/chat/types.ts`**

Add the `ActorRole` type near `AuthorizationResult`:

```typescript
/** Effective actor role for a turn: a restricted group guest vs. a normal member/admin/user. */
export type ActorRole = 'guest' | 'member'
```

Extend `AuthorizationResult`'s `Partial<{...}>` clause to include `isGuest`:

```typescript
export type AuthorizationResult = {
  allowed: boolean
  isBotAdmin: boolean
  isGroupAdmin: boolean
  storageContextId: string
} & Partial<{
  configContextId: string
  reason: AuthorizationDenyReason
  configCommandAllowed: boolean
  isGuest: boolean
}>
```

- [ ] **Step 2: Write the failing test**

Create `tests/auth/guest-mode-auth.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { addAuthorizedGroup, setGuestMode } from '../../src/authorized-groups.js'
import { checkAuthorizationExtended } from '../../src/auth.js'
import { getThreadScopedStorageContextId } from '../../src/chat/scoped-context.js'
import { setupTestDb } from '../utils/test-helpers.js'

const PI = 'pi-1'

const groupConfigId = (rawGroupId: string): string =>
  getThreadScopedStorageContextId(rawGroupId, 'group', undefined, PI)

describe('guest mode authorization', () => {
  beforeEach(() => {
    setupTestDb()
  })

  test('unknown user is allowed as guest when guest mode is on', () => {
    addAuthorizedGroup(groupConfigId('g1'), 'admin')
    setGuestMode(groupConfigId('g1'), true)
    const result = checkAuthorizationExtended('stranger', null, 'g1', 'group', undefined, false, PI)
    expect(result.allowed).toBe(true)
    expect(result.isGuest).toBe(true)
    expect(result.isBotAdmin).toBe(false)
    expect(result.isGroupAdmin).toBe(false)
  })

  test('unknown user is denied when guest mode is off (regression)', () => {
    addAuthorizedGroup(groupConfigId('g1'), 'admin')
    const result = checkAuthorizationExtended('stranger', null, 'g1', 'group', undefined, false, PI)
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('group_member_not_allowed')
    expect(result.isGuest).toBeUndefined()
  })

  test('platform/group admin keeps full access (not a guest) even with guest mode on', () => {
    addAuthorizedGroup(groupConfigId('g1'), 'admin')
    setGuestMode(groupConfigId('g1'), true)
    const result = checkAuthorizationExtended('admin-user', null, 'g1', 'group', undefined, true, PI)
    expect(result.allowed).toBe(true)
    expect(result.isGroupAdmin).toBe(true)
    expect(result.isGuest).toBeUndefined()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test tests/auth/guest-mode-auth.test.ts`
Expected: FAIL — guest is denied (`group_member_not_allowed`) because the guest branch does not exist yet.

- [ ] **Step 4: Implement the guest branch in `src/auth.ts`**

Add `isGuestModeEnabled` to the existing import from `./authorized-groups.js` (currently `import { isAuthorizedGroup } from './authorized-groups.js'`):

```typescript
import { isAuthorizedGroup, isGuestModeEnabled } from './authorized-groups.js'
```

Add a `getGuestGroupAuth` helper near `getGroupMemberAuth` (lines 65-77):

```typescript
const getGuestGroupAuth = (
  contextId: string,
  contextType: ContextType,
  threadId: string | undefined,
  platformInstanceId: string,
): AuthorizationResult => ({
  allowed: true,
  isBotAdmin: false,
  isGroupAdmin: false,
  isGuest: true,
  storageContextId: getThreadScopedStorageContextId(contextId, contextType, threadId, platformInstanceId),
  configContextId: getThreadScopedStorageContextId(contextId, contextType, undefined, platformInstanceId),
})
```

Modify `getUnauthenticatedGroupAuth` (lines 150-166) to add the guest branch immediately before the terminal deny:

```typescript
if (isGroupMember(getGroupConfigContextId(contextId, platformInstanceId), userId)) {
  return getGroupMemberAuth(contextId, contextType, threadId, isPlatformAdmin, platformInstanceId)
}
if (isGuestModeEnabled(getGroupConfigContextId(contextId, platformInstanceId))) {
  return getGuestGroupAuth(contextId, contextType, threadId, platformInstanceId)
}
return getUnauthorizedGroupAuth(contextId, threadId, platformInstanceId, 'group_member_not_allowed')
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/auth/guest-mode-auth.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the existing auth suite for regressions**

Run: `bun test tests/auth/`
Expected: PASS (all existing auth tests still pass).

- [ ] **Step 7: Commit**

```bash
git add src/chat/types.ts src/auth.ts tests/auth/guest-mode-auth.test.ts
git commit -m "feat(auth): allow unknown group users as read-only guests when guest mode is on"
```

---

## Task 4: Thread `actorRole` through the message queue

**Files:**

- Modify: `src/message-queue/types.ts` (`QueueItem` lines 18-27; `CoalescedItem` lines 29-40)
- Modify: `src/message-queue/queue.ts` (`flush()` result object lines 187-198)
- Modify: `src/bot.ts` (`handleMessage` queue object lines 178-191)
- Test: `tests/message-queue/guest-actor-role.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/message-queue/guest-actor-role.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { MessageQueue } from '../../src/message-queue/queue.js'
import type { CoalescedItem, QueueItem } from '../../src/message-queue/types.js'
import { createMockReply } from '../utils/test-helpers.js'

const baseItem = (overrides: Partial<QueueItem>): QueueItem => ({
  text: 'hi',
  userId: 'u1',
  username: null,
  storageContextId: 'g1',
  contextType: 'group',
  newAttachmentIds: [],
  voiceStagedIds: [],
  ...overrides,
})

describe('queue actorRole propagation', () => {
  test('flush carries actorRole from the buffered item', async () => {
    const q = new MessageQueue('g1')
    let captured: CoalescedItem | null = null
    q.setHandler((c) => {
      captured = c
      return Promise.resolve()
    })
    q.enqueue(baseItem({ actorRole: 'guest' }), createMockReply())
    // forceFlush returns the coalesced item synchronously for assertion.
    const flushed = q.forceFlush()
    expect(flushed?.actorRole).toBe('guest')
  })
})
```

Note: confirm `createMockReply` exists in `tests/utils/test-helpers.ts`; if not, pass `(() => Promise.resolve()) as never` as the reply.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/message-queue/guest-actor-role.test.ts`
Expected: FAIL — `actorRole` is not a known property of `QueueItem`/`CoalescedItem` (type error) and/or `flushed.actorRole` is `undefined`.

- [ ] **Step 3: Add `actorRole` to the queue types**

In `src/message-queue/types.ts`, add the import and the optional field to both types:

```typescript
import type { ActorRole, ContextType, ReplyFn } from '../chat/types.js'
```

`QueueItem` (add `actorRole?: ActorRole` inside the `Readonly<{...}>`):

```typescript
export type QueueItem = Readonly<{
  text: string
  userId: string
  username: string | null
  storageContextId: string
  newAttachmentIds: readonly string[]
  voiceStagedIds: readonly string[]
  actorRole?: ActorRole
}> &
  QueueContextInfo &
  QueueConfigContextInfo
```

`CoalescedItem` (add `actorRole?: ActorRole`):

```typescript
export type CoalescedItem = Readonly<{
  text: string
  userId: string
  username: string | null
  storageContextId: string
  newAttachmentIds: readonly string[]
  voiceStagedIds: readonly string[]
  reply: ReplyFn
  turnId: string
  actorRole?: ActorRole
}> &
  QueueContextInfo &
  QueueConfigContextInfo
```

- [ ] **Step 4: Copy `actorRole` in `flush()`**

In `src/message-queue/queue.ts`, add `actorRole` to the `result` object in `flush()` (lines 187-198), sourcing from `lastMessage` (single-user batch, so first/last share the role):

```typescript
const result: CoalescedItem = {
  text,
  userId: lastMessage.item.userId,
  username: lastMessage.item.username,
  storageContextId: this.storageContextId,
  configContextId: lastMessage.item.configContextId,
  contextType: lastMessage.item.contextType,
  newAttachmentIds: attachmentIds,
  voiceStagedIds,
  reply: lastMessage.reply,
  turnId,
  actorRole: lastMessage.item.actorRole,
}
```

- [ ] **Step 5: Set `actorRole` from auth in `src/bot.ts`**

In `handleMessage` (lines 178-191), add `actorRole` to the queued object:

```typescript
queueMessage(
  {
    text: buildPromptWithReplyContext(msg, activeAttachments, auth.storageContextId),
    userId: msg.user.id,
    username: msg.user.username,
    storageContextId: auth.storageContextId,
    configContextId: auth.configContextId,
    contextType: msg.contextType,
    newAttachmentIds,
    voiceStagedIds,
    actorRole: auth.isGuest === true ? 'guest' : 'member',
  },
  reply,
  (coalescedItem): Promise<void> => processCoalescedMessage(coalescedItem, deps),
)
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bun test tests/message-queue/guest-actor-role.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the existing queue suite for regressions**

Run: `bun test tests/message-queue/`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/message-queue/types.ts src/message-queue/queue.ts src/bot.ts tests/message-queue/guest-actor-role.test.ts
git commit -m "feat(queue): thread actorRole from auth through message coalescing"
```

---

## Task 5: Thread `actorRole` into `processMessage` and the orchestrator

**Files:**

- Modify: `src/llm-orchestrator-process-args.ts` (`ProcessMessageRest` lines 9-14)
- Modify: `src/bot.ts` (`processCoalescedMessage` call, lines 141-152)
- Modify: `src/llm-orchestrator.ts` (`processMessage` lines 235-284)
- Modify: `src/llm-orchestrator-tools.ts` (`LlmInvocationOptions` lines 82-93; `InvocationSource` lines 96-104; `buildLlmInvocationOpts` lines 107-126)

This task is pure plumbing; its correctness is verified by the enforcement tests in Tasks 6 and 7. Each step keeps the build green because `actorRole` is optional everywhere and defaults to `'member'`.

- [ ] **Step 1: Add `actorRole` to `ProcessMessageRest`**

In `src/llm-orchestrator-process-args.ts`, add the import and a trailing tuple element:

```typescript
import type { ActorRole } from './chat/types.js'
```

```typescript
export type ProcessMessageRest = readonly [
  configContextId?: string,
  deps?: LlmOrchestratorDeps,
  newAttachmentIds?: readonly string[],
  turnId?: string,
  actorRole?: ActorRole,
]
```

- [ ] **Step 2: Read `actorRole` in `processMessage` and thread it**

In `src/llm-orchestrator.ts` `processMessage` (lines 235-284):

Change the rest destructure (line 244) to capture the new element and default it:

```typescript
const [configContextId, depsInput, newAttachmentIdsInput, turnId, actorRoleInput] = rest
const actorRole = actorRoleInput ?? 'member'
```

Add `actorRole` to `invocationSource` (line 253):

```typescript
const invocationSource = {
  reply,
  contextId,
  chatUserId,
  username,
  userText,
  contextType,
  actorRole,
}
```

Pass `actorRole` to `appendAssistantTurnHistory` (lines 265-273) as a new trailing argument:

```typescript
appendAssistantTurnHistory(
  contextId,
  configId,
  resolvedLlm.mainModel,
  turn.baseHistory,
  turn.historyMessage,
  result.response.messages,
  contextType,
  actorRole,
)
```

(`appendAssistantTurnHistory` gains the `actorRole` parameter in Task 7.)

- [ ] **Step 3: Pass `actorRole` from the coalesced item in `src/bot.ts`**

In `processCoalescedMessage` (lines 141-152), add `coalescedItem.actorRole` as the final argument after `coalescedItem.turnId`:

```typescript
await deps.processMessage(
  tracked.reply,
  coalescedItem.storageContextId,
  coalescedItem.userId,
  coalescedItem.username,
  coalescedItem.text,
  coalescedItem.contextType,
  coalescedItem.configContextId,
  { ...defaultDeps, stagedDownloadFn: deps.stagedDownloadFn },
  [...voiceAttachmentIds, ...coalescedItem.newAttachmentIds],
  coalescedItem.turnId,
  coalescedItem.actorRole,
)
```

- [ ] **Step 4: Add `actorRole` to the orchestrator option types**

In `src/llm-orchestrator-tools.ts`:

Add the import:

```typescript
import type { ActorRole, ReplyFn } from './chat/types.js'
```

(Adjust the existing `import type { ReplyFn } from './chat/types.js'` to include `ActorRole`.)

`LlmInvocationOptions` (lines 82-93) — add the field:

```typescript
export type LlmInvocationOptions = {
  contextId: string
  configId: string
  chatUserId: string
  username: string | null
  contextType: 'dm' | 'group'
  provider: TaskProvider | null
  history: readonly ModelMessage[]
  userText: string
  stagedDownloadFn: StagedFileDownloadFn | undefined
  askPermission: AskPermissionFn | undefined
  actorRole?: ActorRole
}
```

`InvocationSource` (lines 96-104) — add the field:

```typescript
export type InvocationSource = {
  reply: ReplyFn
  contextId: string
  chatUserId: string
  username: string | null
  contextType: 'dm' | 'group'
  history: readonly ModelMessage[]
  userText: string
  actorRole?: ActorRole
}
```

`buildLlmInvocationOpts` (lines 114-125) — copy it into the returned options:

```typescript
return {
  contextId: src.contextId,
  configId,
  chatUserId: src.chatUserId,
  username: src.username,
  contextType: src.contextType,
  provider,
  history: src.history,
  userText: src.userText,
  stagedDownloadFn,
  askPermission,
  actorRole: src.actorRole,
}
```

- [ ] **Step 5: Verify the build compiles**

Run: `bun run typecheck`
Expected: PASS — no type errors. (`actorRole` is optional throughout; `appendAssistantTurnHistory` gets its new param in Task 7 but the extra positional arg is type-checked there; if typecheck complains about the arity now, proceed to Task 7 in the same working session — these two tasks compile together. If you need an isolated green commit, temporarily add `actorRole?: ActorRole` as the last param of `appendAssistantTurnHistory` with no body change, then complete Task 7.)

- [ ] **Step 6: Commit**

```bash
git add src/llm-orchestrator-process-args.ts src/bot.ts src/llm-orchestrator.ts src/llm-orchestrator-tools.ts
git commit -m "feat(orchestrator): thread actorRole into processMessage and invocation options"
```

---

## Task 6: Read-only tool enforcement for guests

**Files:**

- Modify: `src/tools/index.ts` (add `applyGuestReadOnlyFilter`; `applyToolPreferences` at lines 25-52 for reference)
- Modify: `src/llm-orchestrator-tools.ts` (`buildFullToolSet` lines 128-161)
- Test: `tests/tools/guest-readonly-filter.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/tools/guest-readonly-filter.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import type { ToolSet } from 'ai'

import { applyGuestReadOnlyFilter } from '../../src/tools/index.js'

// Minimal tool stub; only the key (name) matters for risk classification.
const stub = {
  description: '',
  inputSchema: {},
  execute: () => Promise.resolve(null),
} as unknown as ToolSet[string]

describe('applyGuestReadOnlyFilter', () => {
  test('keeps read-risk tools and drops write/destructive/open-world tools', () => {
    const tools: ToolSet = {
      list_tasks: stub, // read
      get_task: stub, // read
      create_task: stub, // write
      delete_task: stub, // destructive
      web_fetch: stub, // open-world
      mcp_server__do: stub, // open-world (mcp_ prefix)
    }
    const filtered = applyGuestReadOnlyFilter(tools)
    expect(Object.keys(filtered).sort()).toEqual(['get_task', 'list_tasks'])
  })

  test('drops tools with unknown metadata', () => {
    const filtered = applyGuestReadOnlyFilter({ totally_unknown_tool: stub })
    expect(Object.keys(filtered)).toEqual([])
  })
})
```

Note: confirm `create_task`/`delete_task` are the real write/destructive tool names in `src/tools/tool-metadata.ts`; if the canonical names differ, substitute any tool whose `risk` is `'write'` and `'destructive'` respectively. `list_tasks`/`get_task` are confirmed `read`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/tools/guest-readonly-filter.test.ts`
Expected: FAIL — `applyGuestReadOnlyFilter` is not exported.

- [ ] **Step 3: Implement `applyGuestReadOnlyFilter` in `src/tools/index.ts`**

Add an import for `getToolMetadata` (from `./tool-metadata.js`) if not already imported, then add the exported function near `applyToolPreferences`:

```typescript
import { getToolMetadata } from './tool-metadata.js'

/**
 * Guest enforcement: keep only read-risk tools, dropping all write/destructive/open-world
 * (and unknown) tools. Bypasses per-context tool_prefs entirely — guests get a fixed,
 * non-overridable read-only toolset. Tools with unknown metadata are dropped (fail-closed).
 */
export function applyGuestReadOnlyFilter(tools: ToolSet): ToolSet {
  const out: ToolSet = {}
  for (const [name, t] of Object.entries(tools)) {
    if (t === undefined) continue
    if (getToolMetadata(name)?.risk === 'read') out[name] = t
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/tools/guest-readonly-filter.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the guest branch into `buildFullToolSet`**

In `src/llm-orchestrator-tools.ts`, import the filter (add to the existing `./tools/index.js` import):

```typescript
import {
  applyGuestReadOnlyFilter,
  applyToolPreferences,
  buildProviderlessToolDescriptors,
  buildToolDescriptors,
} from './tools/index.js'
```

In `buildFullToolSet` (lines 128-161), destructure `actorRole` and branch at the `prefTools` assignment (line 142):

```typescript
const { contextId, chatUserId, username, contextType, provider, userText, stagedDownloadFn, askPermission, actorRole } =
  opts
const descriptors = await getOrCreateDescriptors(
  contextId,
  chatUserId,
  username,
  provider,
  contextType,
  stagedDownloadFn,
  deps,
)
const prefTools =
  actorRole === 'guest'
    ? applyGuestReadOnlyFilter(descriptors)
    : applyToolPreferences(descriptors, contextId, askPermission)
```

(The rest of `buildFullToolSet` — compaction, disclosure — is unchanged and runs on `prefTools` as before.)

- [ ] **Step 6: Run targeted suites to verify it passes**

Run: `bun test tests/tools/guest-readonly-filter.test.ts`
Run: `bun test tests/llm-orchestrator-tools.test.ts` (if present)
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/tools/index.ts src/llm-orchestrator-tools.ts tests/tools/guest-readonly-filter.test.ts
git commit -m "feat(tools): hard read-only tool filter for guest actors"
```

---

## Task 7: Exclude guests from long-term memory capture/extraction

**Files:**

- Modify: `src/long-term-memory/capture.ts` (`RunMemoryCaptureInput` lines 27-32)
- Modify: `src/long-term-memory/capture-debounce.ts` (`armMemoryCapture` lines 47-68)
- Modify: `src/llm-history.ts` (`appendAssistantHistory` lines 20-43; `appendAssistantTurnHistory` lines 45-62)
- Test: `tests/long-term-memory/guest-capture-exclusion.test.ts` (create)

- [ ] **Step 1: Add `actorRole` to `RunMemoryCaptureInput`**

In `src/long-term-memory/capture.ts`, import `ActorRole` and add an optional field:

```typescript
import type { ActorRole, ContextType } from '../chat/types.js'
```

```typescript
export type RunMemoryCaptureInput = Readonly<{
  storageContextId: string
  configContextId: string
  contextType: ContextType
  history: readonly ModelMessage[]
  actorRole?: ActorRole
}>
```

- [ ] **Step 2: Write the failing test**

Create `tests/long-term-memory/guest-capture-exclusion.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { armMemoryCapture } from '../../src/long-term-memory/capture-debounce.js'
import type { RunMemoryCaptureInput } from '../../src/long-term-memory/capture.js'

const groupInput = (actorRole: 'guest' | 'member' | undefined): RunMemoryCaptureInput => ({
  storageContextId: 'g1:thread-1',
  configContextId: 'g1',
  contextType: 'group',
  history: [{ role: 'user', content: 'remember my office is in Berlin' }],
  actorRole,
})

describe('guest memory capture exclusion', () => {
  test('armMemoryCapture does not schedule for a guest turn', () => {
    let scheduled = false
    armMemoryCapture(groupInput('guest'), {
      scheduleCapture: () => {
        scheduled = true
      },
    })
    expect(scheduled).toBe(false)
  })

  test('armMemoryCapture schedules for a member turn', () => {
    let scheduled = false
    armMemoryCapture(groupInput('member'), {
      scheduleCapture: () => {
        scheduled = true
      },
    })
    expect(scheduled).toBe(true)
  })
})
```

Note: inspect `armMemoryCapture`'s `ArmCaptureDeps` shape in `src/long-term-memory/capture-debounce.ts` and use the real injected dependency name (the report shows a `defaultDeps`-style injection). If the dep that performs scheduling has a different name than `scheduleCapture`, use the actual name in the test stub. If the function is not easily injectable, instead assert on the watermark/state side effect it normally writes (no provisional record / no `memory_extraction_state` row for the guest case).

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test tests/long-term-memory/guest-capture-exclusion.test.ts`
Expected: FAIL — guest turn still schedules capture.

- [ ] **Step 4: Add the guest guard in `armMemoryCapture`**

In `src/long-term-memory/capture-debounce.ts`, add the guard at the very top of `armMemoryCapture` (lines 47-68), right beside the existing non-group early return:

```typescript
export function armMemoryCapture(input: RunMemoryCaptureInput, deps: ArmCaptureDeps = defaultDeps): void {
  if (input.actorRole === 'guest') return
  if (input.contextType !== 'group') return
  // ... existing body unchanged
}
```

- [ ] **Step 5: Thread `actorRole` through `llm-history.ts`**

In `src/llm-history.ts`, add the import:

```typescript
import type { ActorRole } from './chat/types.js'
```

`appendAssistantHistory` (lines 20-43) — add an optional `actorRole` parameter (default `'member'`), pass it to `armMemoryCapture`, and skip the trim-triggered memory extraction for guests:

```typescript
export const appendAssistantHistory = (
  contextId: string,
  configId: string,
  mainModel: string,
  history: readonly ModelMessage[],
  assistantMessages: ModelMessage[],
  contextType: 'dm' | 'group' = 'dm',
  actorRole: ActorRole = 'member',
): void => {
  if (assistantMessages.length > 0) {
    appendHistory(contextId, assistantMessages)
    log.debug({ contextId, assistantMessagesCount: assistantMessages.length }, 'Assistant response appended to history')
  }
  const combined = [...history, ...assistantMessages]
  if (shouldTriggerTrim(combined, mainModel)) {
    void runTrimInBackground(contextId, combined, undefined, configId)
    if (actorRole !== 'guest') {
      void runMemoryExtractionInBackground({
        storageContextId: contextId,
        contextType,
        configContextId: configId,
        history: combined,
      })
    }
  }
  armMemoryCapture({
    storageContextId: contextId,
    configContextId: configId,
    contextType,
    history: combined,
    actorRole,
  })
}
```

`appendAssistantTurnHistory` (lines 45-62) — add the `actorRole` parameter and forward it:

```typescript
export const appendAssistantTurnHistory = (
  contextId: string,
  configId: string,
  mainModel: string,
  baseHistory: readonly ModelMessage[],
  historyMessage: ModelMessage,
  assistantMessages: ModelMessage[],
  contextType: 'dm' | 'group',
  actorRole: ActorRole = 'member',
): void => {
  appendAssistantHistory(
    contextId,
    configId,
    mainModel,
    [...baseHistory, historyMessage],
    assistantMessages,
    contextType,
    actorRole,
  )
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bun test tests/long-term-memory/guest-capture-exclusion.test.ts`
Expected: PASS.

- [ ] **Step 7: Run memory + history suites for regressions**

Run: `bun test tests/long-term-memory/ tests/llm-history.test.ts`
Expected: PASS (skip the second path if that test file does not exist).

- [ ] **Step 8: Commit**

```bash
git add src/long-term-memory/capture.ts src/long-term-memory/capture-debounce.ts src/llm-history.ts tests/long-term-memory/guest-capture-exclusion.test.ts
git commit -m "feat(memory): exclude guest turns from long-term memory capture and extraction"
```

---

## Task 8: Settings route — GET/PATCH `/settings/api/group/guest-mode`

**Files:**

- Modify: `src/debug/settings/group-routes.ts` (add handlers + dispatch; members handler lines 56-82, task-instance PATCH lines 101-133, dispatch lines 139-142)
- Test: `tests/debug/settings/guest-mode-routes.test.ts` (create; mirror `tests/debug/settings/group-routes.test.ts`)

- [ ] **Step 1: Write the failing test**

Create `tests/debug/settings/guest-mode-routes.test.ts` mirroring the structure of `tests/debug/settings/group-routes.test.ts` (reuse its `beforeEach` setup, `seedManageableGroup()` helper, `establishSession`, and `authHeaders`). Include at minimum:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { isGuestModeEnabled } from '../../../src/authorized-groups.js'
import { handleGroupRoutes } from '../../../src/debug/settings/group-routes.js'
// Reuse the helpers/seed utilities from the sibling group-routes test.
import { authHeaders, establishSession, seedManageableGroup, setupGroupRoutesTest } from './group-routes-shared.js'

const PATH = '/settings/api/group/guest-mode'

describe('guest-mode settings route', () => {
  let ctx: Awaited<ReturnType<typeof setupGroupRoutesTest>>

  beforeEach(async () => {
    ctx = await setupGroupRoutesTest()
  })

  test('GET returns current guest-mode state', async () => {
    const contextId = seedManageableGroup(ctx)
    const url = new URL(`http://x${PATH}?contextId=${encodeURIComponent(contextId)}`)
    const res = await handleGroupRoutes(new Request(url, { headers: authHeaders(ctx.session) }), url, PATH)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ contextId, enabled: false })
  })

  test('PATCH enables guest mode', async () => {
    const contextId = seedManageableGroup(ctx)
    const url = new URL(`http://x${PATH}`)
    const res = await handleGroupRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: {
          ...authHeaders(ctx.session, true),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ enabled: true, contextId }),
      }),
      url,
      PATH,
    )
    expect(res.status).toBe(200)
    expect(isGuestModeEnabled(contextId)).toBe(true)
  })

  test('PATCH without CSRF is rejected', async () => {
    const contextId = seedManageableGroup(ctx)
    const url = new URL(`http://x${PATH}`)
    const res = await handleGroupRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: {
          ...authHeaders(ctx.session),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ enabled: true, contextId }),
      }),
      url,
      PATH,
    )
    expect(res.status).toBe(403)
  })
})
```

Note: `tests/debug/settings/group-routes.test.ts` currently defines its setup/seed helpers inline. Either (a) extract them into a shared `tests/debug/settings/group-routes-shared.ts` and import from both files, or (b) inline the same `beforeEach`/`seedManageableGroup`/`establishSession`/`authHeaders` pattern directly into this test file. Prefer (b) if extraction risks churn; the seed must: `toScopedContextId` → `upsertKnownGroupContext` → `upsertGroupAdminObservation(..., isAdmin: true)` → `addAuthorizedGroup(...)` and return the resulting group `contextId`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/debug/settings/guest-mode-routes.test.ts`
Expected: FAIL — route returns 404/405 (handler not implemented).

- [ ] **Step 3: Implement the handlers in `src/debug/settings/group-routes.ts`**

Add imports for the store helpers (top of file, near the other `../../` imports):

```typescript
import { isGuestModeEnabled, setGuestMode } from '../../authorized-groups.js'
```

Add a Zod body schema near `MemberBodySchema` (line 56):

```typescript
const GuestModeBodySchema = z.object({
  enabled: z.boolean(),
  contextId: z.string().min(1),
})
```

Add a GET handler (mirrors `handleMembersGet`) and a PATCH handler (mirrors `handleTaskInstancePatch`, lines 101-133):

```typescript
function handleGuestModeGet(authed: AuthenticatedSettingsRequest, url: URL): Response {
  const outcome = requireGroup(authed, 'read', url.searchParams.get('contextId'))
  if (!outcome.ok) return outcome.response
  return settingsJson(200, {
    contextId: outcome.group.contextId,
    enabled: isGuestModeEnabled(outcome.group.contextId),
  })
}

async function handleGuestModePatch(req: Request, authed: AuthenticatedSettingsRequest): Promise<Response> {
  const csrf = requireCsrf(req, authed)
  if (csrf !== null) return csrf
  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = GuestModeBodySchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })
  const outcome = requireGroup(authed, 'write', body.data.contextId)
  if (!outcome.ok) return outcome.response
  setGuestMode(outcome.group.contextId, body.data.enabled)
  log.info({ contextId: outcome.group.contextId, enabled: body.data.enabled }, 'Settings group guest mode updated')
  return settingsJson(200, {
    ok: true,
    contextId: outcome.group.contextId,
    enabled: body.data.enabled,
  })
}
```

Add the dispatch in `handleGroupRoutes` (after the `members` block, lines 139-142):

```typescript
if (pathname === '/settings/api/group/guest-mode') {
  if (req.method === 'GET') return Promise.resolve(handleGuestModeGet(auth.authed, url))
  if (req.method === 'PATCH') return handleGuestModePatch(req, auth.authed)
  return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/debug/settings/guest-mode-routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the settings route suite for regressions**

Run: `bun test tests/debug/settings/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/debug/settings/group-routes.ts tests/debug/settings/guest-mode-routes.test.ts
git commit -m "feat(settings-api): GET/PATCH group guest-mode route"
```

---

## Task 9: Settings client fetchers + schema

**Files:**

- Modify: `client/settings/fetcher-schemas.ts` (after `GroupTaskInstanceResponseSchema`, ~line 184)
- Modify: `client/settings/fetchers.ts` (Group section, after `patchGroupTaskInstance`, ~line 222)
- Test: `tests/client/settings/guest-mode-fetchers.test.ts` (create) — only if the project has client fetcher tests; otherwise rely on the schema's type-check + the Svelte test in Task 10.

- [ ] **Step 1: Add the Zod schema in `client/settings/fetcher-schemas.ts`**

After `GroupTaskInstanceResponseSchema` (line 184):

```typescript
export const GroupGuestModeResponseSchema = z.object({
  contextId: z.string(),
  enabled: z.boolean(),
})
export type GroupGuestModeResponse = z.infer<typeof GroupGuestModeResponseSchema>
```

- [ ] **Step 2: Add the fetchers in `client/settings/fetchers.ts`**

In the `// --- Group ---` section (after `patchGroupTaskInstance`, line 222), mirroring `fetchGroupTaskInstance` / `patchGroupTaskInstance`. Ensure `GroupGuestModeResponse` and `GroupGuestModeResponseSchema` are imported from `./fetcher-schemas.js` at the top of the file (add to the existing import list):

```typescript
export const fetchGroupGuestMode = (contextId: string): Promise<GroupGuestModeResponse> =>
  getJson(`/settings/api/group/guest-mode?${ctxQuery(contextId)}`, (b) => GroupGuestModeResponseSchema.parse(b))

export const patchGroupGuestMode = (input: { enabled: boolean; contextId: string }): Promise<unknown> =>
  writeJson('/settings/api/group/guest-mode', 'PATCH', input, (b) => b)
```

- [ ] **Step 3: Type-check**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add client/settings/fetcher-schemas.ts client/settings/fetchers.ts
git commit -m "feat(settings-ui): guest-mode fetchers + schema"
```

---

## Task 10: Settings client — `GuestModeSection` toggle

**Files:**

- Create: `client/settings/sections/GuestModeSection.svelte` (mirror `MembersSection.svelte` shell + `MemorySection.svelte` toggle pattern)
- Modify: `client/settings/SettingsApp.svelte` (group section block lines 184-188)
- Test: `tests/client/settings/guest-mode-section.test.ts` (create) — happy-dom, run via `bun test:client`

- [ ] **Step 1: Write the failing client test**

Create `tests/client/settings/guest-mode-section.test.ts` mirroring an existing section test (e.g. the test for `MemorySection`/`MembersSection`, if present). At minimum, mount `GuestModeSection` with a mocked fetcher returning `{ contextId, enabled: false }` and assert the toggle button renders with the "enable" label; then simulate a click and assert `patchGroupGuestMode` is called with `{ enabled: true, contextId }`. Use the existing client test harness (`tests/client-setup.ts`) and the project's established Svelte component test pattern. If the codebase has no per-section component tests, skip this step and rely on the route/store tests plus manual verification in Step 5.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test:client tests/client/settings/guest-mode-section.test.ts`
Expected: FAIL — component does not exist.

- [ ] **Step 3: Create `client/settings/sections/GuestModeSection.svelte`**

Mirror `MembersSection.svelte` for the section shell (`<section id="guest-mode" class="settings-section">`, `<PageHeader eyebrow="Group" title="Guest mode">`) and `MemorySection.svelte`'s `toggleCapture` for the load/mutate pattern:

```svelte
<script lang="ts">
  import PageHeader from '../components/PageHeader.svelte'
  import Btn from '../components/Btn.svelte'
  import { fetchGroupGuestMode, patchGroupGuestMode } from '../fetchers.js'
  import { messageFrom } from '../lib/errors.js'

  let { contextId }: { contextId: string } = $props()

  let enabled = $state<boolean | null>(null)
  let loading = $state(false)
  let mutating = $state(false)
  let error = $state<string | null>(null)

  async function load(id: string): Promise<void> {
    loading = true
    error = null
    try {
      const res = await fetchGroupGuestMode(id)
      enabled = res.enabled
    } catch (err) {
      error = messageFrom(err)
    } finally {
      loading = false
    }
  }

  async function toggle(): Promise<void> {
    if (enabled === null) return
    error = null
    mutating = true
    try {
      await patchGroupGuestMode({ contextId, enabled: !enabled })
      await load(contextId)
    } catch (err) {
      error = messageFrom(err)
    } finally {
      mutating = false
    }
  }

  $effect(() => {
    void load(contextId)
  })
</script>

<section id="guest-mode" class="settings-section">
  <PageHeader eyebrow="Group" title="Guest mode" />
  <p class="t-meta">When on, anyone in this chat can use the bot, read-only. Members and admins are unaffected.</p>
  {#if error !== null}<p class="t-error" data-testid="guest-mode-error">{error}</p>{/if}
  <Btn
    variant={enabled ? 'outline' : 'primary'}
    size="sm"
    disabled={enabled === null || loading || mutating}
    testid="guest-mode-toggle"
    onClick={() => void toggle()}>
    {#snippet children()}{enabled ? 'Disable guest mode' : 'Enable guest mode'}{/snippet}
  </Btn>
</section>
```

Note: confirm the exact import paths/props for `PageHeader`, `Btn`, and the error helper (`messageFrom`) by opening `MemorySection.svelte` and `MembersSection.svelte`; match their import style precisely (these components and helpers are used there). Adjust `lib/errors.js` to wherever `messageFrom` actually lives.

- [ ] **Step 4: Render it for groups in `SettingsApp.svelte`**

Import `GuestModeSection` alongside the other section imports, and add it to the `{#if isGroup}` block (lines 184-188):

```svelte
{#if isGroup}
  <MembersSection contextId={ctx} />
  <GuestModeSection contextId={ctx} />
  <GroupProviderSection contextId={ctx} />
{/if}
```

Also add it to the section navigation/scrollspy list if `SettingsApp.svelte` maintains an explicit list of section ids (search for `'members'` / `'guest-mode'` registration and add `'guest-mode'` consistently).

- [ ] **Step 5: Run client test / build to verify**

Run: `bun test:client tests/client/settings/guest-mode-section.test.ts` (if written)
Then: `bun build:client` and verify no build errors.
Expected: PASS / clean build.

- [ ] **Step 6: Commit**

```bash
git add client/settings/sections/GuestModeSection.svelte client/settings/SettingsApp.svelte tests/client/settings/guest-mode-section.test.ts
git commit -m "feat(settings-ui): group guest-mode toggle section"
```

---

## Task 11: Docs — record guest mode in CLAUDE.md

**Files:**

- Modify: `CLAUDE.md` (the group scope / open-DM "Notable non-obvious behaviors" area)

- [ ] **Step 1: Add a behavior note**

In the "Notable non-obvious behaviors" list in `CLAUDE.md`, add a concise entry after the `open_dm_access` description:

```markdown
- **Guest mode** is a per-_group_ toggle (`authorized_groups.guest_mode`) enabled by bot or group admins in the settings UI group section. When on, any user in an authorized group who is otherwise unrecognized (not admin/member) is allowed as a **guest**: identified by `AuthorizationResult.isGuest` → `actorRole: 'guest'` threaded through the queue/orchestrator, given a hardcoded **read-only** toolset (`applyGuestReadOnlyFilter`, read-risk tools only, bypassing `tool_prefs`), and excluded from long-term memory capture/extraction. Guests are **never** provisioned into `users`/`group_members` (so they never become members). v1 abuse control is toggle-off.
```

- [ ] **Step 2: Verify the doc passes checks**

Run: `bun check` (staged-file lint/format/license check)
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document group guest mode behavior"
```

---

## Final verification

- [ ] **Run the full server-side suite**

Run: `bun run test`
Expected: PASS.

- [ ] **Run the client suite**

Run: `bun test:client`
Expected: PASS.

- [ ] **Run the full check**

Run: `bun check:full`
Expected: PASS (lint, typecheck, format, knip, tests). Note: any pre-existing failures from unrelated in-progress work (e.g. `src/run-control/**`, `tests/run-control/**`) are out of scope for this plan.

---

## Notes / invariants (do not regress)

- **Guests are never written to `users` or `group_members`.** If a future change provisions them, they would match the member branch and silently gain full tools. This is the core correctness invariant (spec decision #2).
- **`actorRole` is single-valued per coalesced turn** because the queue force-flushes on user change. Do not coalesce across users.
- **Read-only = deny, not ask.** `applyGuestReadOnlyFilter` removes non-read tools entirely; guests have no `askPermission` path to self-escalate.
- **Re-deriving role at the orchestrator is unsafe** — the platform/group-admin signal (`msg.user.isAdmin`) is not persisted downstream, so admins would be misclassified as guests. Always thread `actorRole` from the auth result.
- **Guest mode is per-group, group-only.** DMs use `open_dm_access`; do not conflate the two.
