<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Group Kaneo Provisioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicit group authorization plus DM-driven first-time Kaneo provisioning for groups, while preventing implicit Kaneo provisioning from ordinary group messages.

**Architecture:** Add a dedicated `authorized_groups` persistence layer separate from `group_members`, enforce it in auth before group-member checks, and extend the existing `/group` command to branch between DM admin allowlist management and in-group member management. Keep group Kaneo provisioning in explicit DM `/setup` flows only, thread `configContextId` through bot queueing so group config remains group-scoped, and gate message-time auto-provisioning to DMs only.

**Tech Stack:** Bun test runner, SQLite/Drizzle migrations, existing chat command handlers, existing Kaneo provisioning flow, existing message queue and bot auth pipeline

**Design spec:** `docs/superpowers/specs/2026-04-17-group-kaneo-provisioning-design.md`

---

## File Structure

### New files

| File                                         | Responsibility                                     |
| -------------------------------------------- | -------------------------------------------------- |
| `src/authorized-groups.ts`                   | CRUD helpers for bot-level group allowlist         |
| `src/db/migrations/024_authorized_groups.ts` | Migration creating `authorized_groups` table       |
| `tests/authorized-groups.test.ts`            | Unit tests for group allowlist persistence helpers |

### Modified files

| File                                      | Change                                                                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `src/db/schema.ts`                        | Add `authorizedGroups` Drizzle table                                                                                |
| `src/db/index.ts`                         | Register migration 024                                                                                              |
| `tests/utils/test-helpers.ts`             | Register migration 024 in test DB bootstrap                                                                         |
| `src/chat/types.ts`                       | Extend `AuthorizationResult` with explicit deny reasons                                                             |
| `src/auth.ts`                             | Enforce group allowlist before group-member checks; allow platform admins by default in allowed groups              |
| `src/bot.ts`                              | Pass `configContextId` through queued processing, improve unauthorized group reply, disable group auto-start wizard |
| `src/message-queue/types.ts`              | Carry `configContextId` through queue/coalesced items                                                               |
| `src/message-queue/queue.ts`              | Preserve `configContextId` during flush/coalescing                                                                  |
| `src/commands/group.ts`                   | Add DM admin `/group add`, `/group remove`, `/groups` while preserving in-group subcommands                         |
| `src/commands/help.ts`                    | Advertise new admin group commands in DM help                                                                       |
| `src/commands/setup.ts`                   | Gate group setup on allowlist and run first-time group Kaneo provisioning branches                                  |
| `src/providers/kaneo/provision.ts`        | Message-time auto-provisioning for DM contexts only                                                                 |
| `src/llm-orchestrator.ts`                 | Skip implicit Kaneo provisioning for group contexts                                                                 |
| `src/llm-orchestrator-types.ts`           | Keep dep signature aligned if provisioning callsite changes                                                         |
| `tests/auth.test.ts`                      | Auth unit coverage for allowlisted groups and deny reasons                                                          |
| `tests/auth-integration.test.ts`          | Integration coverage for allowlisted-group isolation                                                                |
| `tests/bot.test.ts`                       | Queue/configContextId propagation and unauthorized-group messaging                                                  |
| `tests/commands/group.test.ts`            | DM admin group allowlist commands plus existing in-group behavior                                                   |
| `tests/commands/help.test.ts`             | Help text assertions for new admin commands                                                                         |
| `tests/commands/setup.test.ts`            | Group setup gating and first-time provisioning branches                                                             |
| `tests/providers/kaneo/provision.test.ts` | Message-time auto-provisioning for DM contexts                                                                      |
| `tests/llm-orchestrator.test.ts`          | Group contexts do not implicitly call Kaneo auto-provisioning                                                       |

---

## Task 1: Add explicit group allowlist persistence

**Files:**

- Create: `src/authorized-groups.ts`
- Create: `src/db/migrations/024_authorized_groups.ts`
- Create: `tests/authorized-groups.test.ts`
- Modify: `src/db/schema.ts`
- Modify: `src/db/index.ts`
- Modify: `tests/utils/test-helpers.ts`

- [ ] **Step 1: Write the failing persistence test**

`tests/authorized-groups.test.ts`:

```typescript
import { beforeEach, describe, expect, test } from 'bun:test'

import {
  addAuthorizedGroup,
  isAuthorizedGroup,
  listAuthorizedGroups,
  removeAuthorizedGroup,
} from '../src/authorized-groups.js'
import { mockLogger, setupTestDb } from './utils/test-helpers.js'

describe('authorized groups', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('addAuthorizedGroup stores the group', () => {
    addAuthorizedGroup('group-1', 'admin-1')
    expect(isAuthorizedGroup('group-1')).toBe(true)
  })

  test('listAuthorizedGroups returns metadata', () => {
    addAuthorizedGroup('group-1', 'admin-1')
    addAuthorizedGroup('group-2', 'admin-1')

    const groups = listAuthorizedGroups()

    expect(groups.map((group) => group.group_id)).toEqual(['group-1', 'group-2'])
    expect(groups[0]).toHaveProperty('added_by', 'admin-1')
    expect(groups[0]).toHaveProperty('added_at')
  })

  test('removeAuthorizedGroup returns true when a row is removed', () => {
    addAuthorizedGroup('group-1', 'admin-1')
    expect(removeAuthorizedGroup('group-1')).toBe(true)
    expect(isAuthorizedGroup('group-1')).toBe(false)
  })

  test('removeAuthorizedGroup returns false for unknown group', () => {
    expect(removeAuthorizedGroup('missing-group')).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to confirm it fails**

Run:

```bash
bun test tests/authorized-groups.test.ts
```

Expected: FAIL with module-not-found errors for `../src/authorized-groups.js` and/or missing `authorized_groups` schema state.

- [ ] **Step 3: Implement the migration, schema, and helper module**

`src/db/migrations/024_authorized_groups.ts`:

```typescript
import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

export const migration024AuthorizedGroups: Migration = {
  id: '024_authorized_groups',
  up(db: Database): void {
    db.run(`
      CREATE TABLE authorized_groups (
        group_id  TEXT PRIMARY KEY,
        added_by  TEXT NOT NULL,
        added_at  TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)
    db.run(`CREATE INDEX idx_authorized_groups_added_by ON authorized_groups(added_by)`)
  },
}
```

`src/db/schema.ts` addition near `groupMembers`:

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

`src/authorized-groups.ts`:

```typescript
import { eq, sql } from 'drizzle-orm'

import { getDrizzleDb } from './db/drizzle.js'
import { authorizedGroups } from './db/schema.js'
import { logger } from './logger.js'

const log = logger.child({ scope: 'authorized-groups' })

export function addAuthorizedGroup(groupId: string, addedBy: string): void {
  log.debug({ groupId, addedBy }, 'addAuthorizedGroup called')
  getDrizzleDb().insert(authorizedGroups).values({ groupId, addedBy }).onConflictDoNothing().run()
  log.info({ groupId, addedBy }, 'Authorized group added')
}

export function removeAuthorizedGroup(groupId: string): boolean {
  log.debug({ groupId }, 'removeAuthorizedGroup called')
  const deleted = getDrizzleDb()
    .delete(authorizedGroups)
    .where(eq(authorizedGroups.groupId, groupId))
    .returning({ groupId: authorizedGroups.groupId })
    .all()
  const removed = deleted.length > 0
  log.info({ groupId, removed }, 'Authorized group removal attempted')
  return removed
}

export function isAuthorizedGroup(groupId: string): boolean {
  log.debug({ groupId }, 'isAuthorizedGroup called')
  const row = getDrizzleDb()
    .select({ groupId: authorizedGroups.groupId })
    .from(authorizedGroups)
    .where(eq(authorizedGroups.groupId, groupId))
    .get()
  return row !== undefined
}

export function listAuthorizedGroups(): Array<{
  group_id: string
  added_by: string
  added_at: string
}> {
  log.debug('listAuthorizedGroups called')
  return getDrizzleDb()
    .select({
      group_id: authorizedGroups.groupId,
      added_by: authorizedGroups.addedBy,
      added_at: authorizedGroups.addedAt,
    })
    .from(authorizedGroups)
    .orderBy(sql`${authorizedGroups.addedAt} ASC`)
    .all()
}
```

`src/db/index.ts` and `tests/utils/test-helpers.ts`: import `migration024AuthorizedGroups` and append it after `migration023AddForeignKeys` in the migration arrays.

- [ ] **Step 4: Run the persistence tests**

Run:

```bash
bun test tests/authorized-groups.test.ts tests/groups.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit the persistence slice**

```bash
git add src/authorized-groups.ts src/db/migrations/024_authorized_groups.ts src/db/schema.ts src/db/index.ts tests/utils/test-helpers.ts tests/authorized-groups.test.ts
git commit -m "feat: add explicit group allowlist storage"
```

---

## Task 2: Enforce group allowlist in auth and expose deny reasons

**Files:**

- Modify: `src/chat/types.ts`
- Modify: `src/auth.ts`
- Modify: `src/bot.ts`
- Modify: `tests/auth.test.ts`
- Modify: `tests/auth-integration.test.ts`
- Modify: `tests/bot.test.ts`

- [ ] **Step 1: Add failing auth and bot tests**

Add these tests to `tests/auth.test.ts`:

```typescript
import { addAuthorizedGroup } from '../src/authorized-groups.js'

test('allowlisted platform admin is allowed without explicit group membership', () => {
  addAuthorizedGroup('group1', 'admin1')

  const auth = checkAuthorizationExtended('admin1', null, 'group1', 'group', undefined, true)

  expect(auth.allowed).toBe(true)
  expect(auth.isGroupAdmin).toBe(true)
  expect(auth.reason).toBeUndefined()
})

test('non-allowlisted group denies even bot admin access in group context', () => {
  addUser('admin1', 'admin1')

  const auth = checkAuthorizationExtended('admin1', null, 'group1', 'group', undefined, true)

  expect(auth.allowed).toBe(false)
  expect(auth.reason).toBe('group_not_allowed')
})

test('allowlisted non-admin without group membership gets member-specific deny reason', () => {
  addAuthorizedGroup('group1', 'admin1')

  const auth = checkAuthorizationExtended('stranger1', null, 'group1', 'group', undefined, false)

  expect(auth.allowed).toBe(false)
  expect(auth.reason).toBe('group_member_not_allowed')
})
```

Add this test to `tests/bot.test.ts` under the unauthorized mention behavior section:

```typescript
test('mentioned user in non-allowlisted group gets bot-admin authorization hint', async () => {
  addUser(ADMIN_ID, ADMIN_ID)
  const messageHandler = getMessageHandler()
  expect(messageHandler).not.toBeNull()

  const { reply, textCalls } = createMockReply()
  await messageHandler!(createGroupMessage('user-1', '@bot hello', false, 'group-denied'), reply)

  expect(textCalls[0]).toContain('/group add <group-id>')
})
```

- [ ] **Step 2: Run the targeted tests to confirm failure**

Run:

```bash
bun test tests/auth.test.ts tests/auth-integration.test.ts tests/bot.test.ts
```

Expected: FAIL because `AuthorizationResult` has no `reason`, non-allowlisted groups still use the old auth path, and bot replies still point only to `/group adduser`.

- [ ] **Step 3: Implement auth enforcement and deny reasons**

`src/chat/types.ts` change `AuthorizationResult` to:

```typescript
export type AuthorizationResult = {
  allowed: boolean
  isBotAdmin: boolean
  isGroupAdmin: boolean
  storageContextId: string
} & Partial<{
  configContextId: string
  reason: 'group_not_allowed' | 'group_member_not_allowed' | 'dm_user_not_allowed'
}>
```

`src/auth.ts` group branch should become:

```typescript
import { isAuthorizedGroup } from './authorized-groups.js'

const getUnauthorizedGroupAuth = (
  contextId: string,
  reason: 'group_not_allowed' | 'group_member_not_allowed',
): AuthorizationResult => ({
  allowed: false,
  isBotAdmin: false,
  isGroupAdmin: false,
  storageContextId: contextId,
  configContextId: contextId,
  reason,
})

// inside checkAuthorizationExtended()
if (contextType === 'group') {
  if (!isAuthorizedGroup(contextId)) {
    return getUnauthorizedGroupAuth(contextId, 'group_not_allowed')
  }
  if (isPlatformAdmin) {
    return getGroupMemberAuth(contextId, contextType, threadId, true)
  }
  if (isGroupMember(contextId, userId)) {
    return getGroupMemberAuth(contextId, contextType, threadId, false)
  }
  return getUnauthorizedGroupAuth(contextId, 'group_member_not_allowed')
}
```

`src/bot.ts` unauthorized mention reply branch should become:

```typescript
if (!auth.allowed) {
  if (msg.isMentioned && msg.contextType === 'group') {
    if (auth.reason === 'group_not_allowed') {
      await reply.text(
        'This group is not authorized to use this bot. Ask the bot admin to run `/group add <group-id>` in DM.',
      )
      return
    }
    await reply.text(
      "You're not authorized to use this bot in this group. Ask a group admin to add you with `/group adduser @{username}`",
    )
  }
  return
}
```

Also add an `auth-integration` test proving the same user can be allowed in one allowlisted group and denied in another non-allowlisted group.

- [ ] **Step 4: Re-run the auth and bot tests**

Run:

```bash
bun test tests/auth.test.ts tests/auth-integration.test.ts tests/bot.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit the auth slice**

```bash
git add src/chat/types.ts src/auth.ts src/bot.ts tests/auth.test.ts tests/auth-integration.test.ts tests/bot.test.ts
git commit -m "feat: enforce group allowlist in auth"
```

---

## Task 3: Extend `/group` for DM admin allowlist management and update help

**Files:**

- Modify: `src/commands/group.ts`
- Modify: `src/commands/help.ts`
- Modify: `tests/commands/group.test.ts`
- Modify: `tests/commands/help.test.ts`

- [ ] **Step 1: Add failing command and help tests**

Add these tests to `tests/commands/group.test.ts`:

```typescript
import { addUser } from '../../src/users.js'

test('dm admin can add an authorized group', async () => {
  addUser('admin1', 'admin1')
  const handler = commandHandlers.get('group')
  expect(handler).toBeDefined()

  const { reply, textCalls } = createMockReply()
  await handler!(createDmMessage('admin1', 'add group-42'), reply, createAuth('admin1', { isBotAdmin: true }))

  expect(textCalls[0]).toBe('Group group-42 authorized.')
})

test('dm admin can list authorized groups', async () => {
  addUser('admin1', 'admin1')
  const handler = commandHandlers.get('group')
  expect(handler).toBeDefined()

  const { reply, textCalls } = createMockReply()
  await handler!(createDmMessage('admin1', 'groups'), reply, createAuth('admin1', { isBotAdmin: true }))

  expect(textCalls[0]).toContain('Authorized groups:')
})

test('dm non-admin cannot manage authorized groups', async () => {
  const handler = commandHandlers.get('group')
  expect(handler).toBeDefined()

  const { reply, textCalls } = createMockReply()
  await handler!(createDmMessage('user1', 'add group-42'), reply, createAuth('user1'))

  expect(textCalls[0]).toBe('Only the admin can manage groups.')
})
```

Add this assertion to `tests/commands/help.test.ts` admin DM help test:

```typescript
expect(capturedText).toContain('/group add <group-id>')
expect(capturedText).toContain('/group remove <group-id>')
expect(capturedText).toContain('/groups')
```

- [ ] **Step 2: Run the command tests to confirm failure**

Run:

```bash
bun test tests/commands/group.test.ts tests/commands/help.test.ts
```

Expected: FAIL because DM `/group` currently rejects all DM usage and help text does not mention group allowlist commands.

- [ ] **Step 3: Implement the DM/group branching in `registerGroupCommand`**

`src/commands/group.ts` should branch on `msg.contextType` inside the existing single `/group` handler:

```typescript
import { addAuthorizedGroup, listAuthorizedGroups, removeAuthorizedGroup } from '../authorized-groups.js'

export function registerGroupCommand(chat: ChatProvider): void {
  chat.registerCommand('group', async (msg, reply, auth) => {
    const match = (msg.commandMatch ?? '').trim()
    const [subcommand, ...args] = match.split(/\s+/)

    if (msg.contextType === 'dm') {
      if (!auth.isBotAdmin) {
        await reply.text('Only the admin can manage groups.')
        return
      }

      const targetGroupId = args[0]
      switch (subcommand) {
        case 'add':
          if (targetGroupId === undefined || targetGroupId === '') {
            await reply.text('Usage: /group add <group-id>')
            return
          }
          addAuthorizedGroup(targetGroupId, msg.user.id)
          await reply.text(`Group ${targetGroupId} authorized.`)
          return
        case 'remove':
          if (targetGroupId === undefined || targetGroupId === '') {
            await reply.text('Usage: /group remove <group-id>')
            return
          }
          await reply.text(
            removeAuthorizedGroup(targetGroupId)
              ? `Group ${targetGroupId} removed.`
              : `Group ${targetGroupId} not found.`,
          )
          return
        case 'groups': {
          const groups = listAuthorizedGroups()
          if (groups.length === 0) {
            await reply.text('No authorized groups.')
            return
          }
          const lines = groups.map((group) => `${group.group_id} — added by ${group.added_by} at ${group.added_at}`)
          await reply.text(['Authorized groups:', ...lines].join('\n'))
          return
        }
        default:
          await reply.text('Usage: /group add <group-id> | /group remove <group-id> | /groups')
          return
      }
    }

    // existing in-group adduser/deluser/users logic stays here
  })
}
```

`src/commands/help.ts` append these admin DM lines:

```typescript
'/group add <group-id> — Authorize a group',
'/group remove <group-id> — Revoke a group',
'/groups — List authorized groups',
```

- [ ] **Step 4: Re-run the command/help tests**

Run:

```bash
bun test tests/commands/group.test.ts tests/commands/help.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit the command surface slice**

```bash
git add src/commands/group.ts src/commands/help.ts tests/commands/group.test.ts tests/commands/help.test.ts
git commit -m "feat: add admin group authorization commands"
```

---

## Task 4: Thread `configContextId` through bot queueing and stop implicit group setup starts

**Files:**

- Modify: `src/bot.ts`
- Modify: `src/message-queue/types.ts`
- Modify: `src/message-queue/queue.ts`
- Modify: `tests/bot.test.ts`

- [ ] **Step 1: Add failing queue/config-context tests**

Add this test to `tests/bot.test.ts`:

```typescript
test('threaded group messages pass group configContextId to processMessage', async () => {
  addAuthorizedGroup('group-1', ADMIN_ID)
  addUser(ADMIN_ID, ADMIN_ID)

  let receivedStorageContextId: string | null = null
  let receivedConfigContextId: string | undefined
  const botDeps: BotDeps = {
    processMessage: (
      _reply,
      storageContextId,
      _chatUserId,
      _username,
      _text,
      _contextType,
      configContextId,
    ): Promise<void> => {
      receivedStorageContextId = storageContextId
      receivedConfigContextId = configContextId
      return Promise.resolve()
    },
  }

  const { provider: mockChat, getMessageHandler } = createMockChatForBot()
  setupBot(mockChat, ADMIN_ID, botDeps)

  const handler = getMessageHandler()
  expect(handler).not.toBeNull()

  const { reply } = createMockReply()
  const threadedMessage = {
    ...createGroupMessage(ADMIN_ID, '@bot thread test', true, 'group-1'),
    threadId: 'thread-9',
  }

  await handler!(threadedMessage, reply)

  expect(receivedStorageContextId).toBe('group-1:thread-9')
  expect(receivedConfigContextId).toBe('group-1')
})
```

Add this test too:

```typescript
test('group messages do not auto-start the setup wizard when config is missing', async () => {
  addAuthorizedGroup('group-1', ADMIN_ID)

  const { provider: mockChat, getMessageHandler } = createMockChatForBot()
  setupBot(mockChat, ADMIN_ID, {
    processMessage: (): Promise<void> => Promise.resolve(),
  })

  const handler = getMessageHandler()
  expect(handler).not.toBeNull()
  const { reply, textCalls } = createMockReply()

  await handler!(createGroupMessage('group-admin', '@bot hello', true, 'group-1'), reply)

  expect(textCalls.some((text) => text.includes('Welcome to papai configuration wizard'))).toBe(false)
})
```

- [ ] **Step 2: Run the bot test file to confirm failure**

Run:

```bash
bun test tests/bot.test.ts
```

Expected: FAIL because `BotDeps.processMessage` does not accept `configContextId`, queue items drop that context, and group messages can still auto-start the wizard.

- [ ] **Step 3: Implement `configContextId` propagation and group wizard suppression**

`src/message-queue/types.ts`:

```typescript
export interface QueueItem {
  readonly text: string
  readonly userId: string
  readonly username: string | null
  readonly storageContextId: string
  readonly configContextId?: string
  readonly contextType: ContextType
  readonly files: readonly IncomingFile[]
}

export interface CoalescedItem {
  readonly text: string
  readonly userId: string
  readonly username: string | null
  readonly storageContextId: string
  readonly configContextId?: string
  readonly contextType: ContextType
  readonly files: readonly IncomingFile[]
  readonly reply: ReplyFn
}
```

`src/message-queue/queue.ts` add `configContextId` when building the coalesced result:

```typescript
const result: CoalescedItem = {
  text,
  userId: lastMessage.item.userId,
  username: lastMessage.item.username,
  storageContextId: this.storageContextId,
  configContextId: lastMessage.item.configContextId,
  contextType: lastMessage.item.contextType,
  files: allFiles,
  reply,
}
```

`src/bot.ts` updates:

```typescript
export interface BotDeps {
  processMessage: (
    reply: ReplyFn,
    contextId: string,
    chatUserId: string,
    username: string | null,
    userText: string,
    contextType: 'dm' | 'group',
    configContextId?: string,
  ) => Promise<void>
}

const queueItem = {
  text: buildPromptWithReplyContext(msg),
  userId: msg.user.id,
  username: msg.user.username,
  storageContextId: auth.storageContextId,
  configContextId: auth.configContextId,
  contextType: msg.contextType,
  files: msg.files ?? [],
}

await withTypingRefresh(coalescedItem.reply, () =>
  deps.processMessage(
    coalescedItem.reply,
    coalescedItem.storageContextId,
    coalescedItem.userId,
    coalescedItem.username,
    coalescedItem.text,
    coalescedItem.contextType,
    coalescedItem.configContextId,
  ),
)

if (
  !isCommand &&
  auth.allowed &&
  msg.contextType === 'dm' &&
  (await autoStartWizardIfNeeded(msg.user.id, auth.storageContextId, reply))
) {
  return true
}
```

- [ ] **Step 4: Re-run the bot tests**

Run:

```bash
bun test tests/bot.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit the queueing/runtime slice**

```bash
git add src/bot.ts src/message-queue/types.ts src/message-queue/queue.ts tests/bot.test.ts
git commit -m "fix: preserve group config context through queued messages"
```

---

## Task 5: Move group Kaneo provisioning to explicit DM `/setup`

**Files:**

- Modify: `src/commands/setup.ts`
- Modify: `src/providers/kaneo/provision.ts`
- Modify: `src/llm-orchestrator.ts`
- Modify: `src/llm-orchestrator-types.ts`
- Modify: `.env.example`
- Modify: `tests/commands/setup.test.ts`
- Modify: `tests/providers/kaneo/provision.test.ts`
- Modify: `tests/llm-orchestrator.test.ts`

- [ ] **Step 1: Add failing tests for first-time group setup branches and group-message provisioning suppression**

Add these tests to `tests/commands/setup.test.ts`:

```typescript
import { addAuthorizedGroup } from '../../src/authorized-groups.js'
import { setConfig } from '../../src/config.js'
import { setKaneoWorkspace } from '../../src/users.js'

test('first-time allowlisted group setup provisions and stops before wizard', async () => {
  process.env['TASK_PROVIDER'] = 'kaneo'
  addAuthorizedGroup('group-1', 'admin-1')

  const { startSetupForTarget } = await import('../../src/commands/setup.js')
  const { reply, textCalls } = createMockReply()

  await startSetupForTarget('admin-1', reply, 'group-1', {
    isAuthorizedGroup: () => true,
    provisionAndConfigure: () =>
      Promise.resolve({
        status: 'provisioned',
        email: 'group-1-a1b2c3d4@pap.ai',
        password: 'pw-1',
        kaneoUrl: 'https://kaneo.test',
        apiKey: 'key-1',
        workspaceId: 'ws-1',
      }),
    createWizard: () => ({ success: true, prompt: 'wizard-started' }),
    getConfig: () => null,
    getKaneoWorkspace: () => null,
  })

  expect(textCalls.some((text) => text.includes('group Kaneo account has been created'))).toBe(true)
  expect(textCalls.some((text) => text.includes('wizard-started'))).toBe(false)
})

test('non-allowlisted group target is blocked before wizard creation', async () => {
  const { startSetupForTarget } = await import('../../src/commands/setup.js')
  const { reply, textCalls } = createMockReply()

  await startSetupForTarget('admin-1', reply, 'group-1', {
    isAuthorizedGroup: () => false,
    provisionAndConfigure: () => Promise.resolve({ status: 'failed', error: 'should not be called' }),
    createWizard: () => ({ success: true, prompt: 'wizard-started' }),
    getConfig: () => null,
    getKaneoWorkspace: () => null,
  })

  expect(textCalls[0]).toContain('/group add <group-id>')
})
```

Add this test to `tests/llm-orchestrator.test.ts`:

```typescript
test('group context does not call maybeProvisionKaneo before missing-config handling', async () => {
  let maybeProvisionCalls = 0
  const freshGroupCtx = 'group-1:thread-1'

  const { reply, textCalls } = createMockReply()
  await processMessage(reply, freshGroupCtx, 'user-1', null, 'hello', 'group', 'group-1', {
    generateText: (...args) => realAi.generateText(...args),
    stepCountIs: (...args) => realAi.stepCountIs(...args),
    buildOpenAI: () => () => 'mock-model',
    buildProviderForUser: () => mockProvider as TaskProvider,
    maybeProvisionKaneo: async () => {
      maybeProvisionCalls++
    },
  })

  expect(maybeProvisionCalls).toBe(0)
  expect(textCalls[0]).toContain('/setup')
})
```

- [ ] **Step 2: Run the setup/provisioning tests to confirm failure**

Run:

```bash
bun test tests/commands/setup.test.ts tests/providers/kaneo/provision.test.ts tests/llm-orchestrator.test.ts
```

Expected: FAIL because `startSetupForTarget()` has no dependency injection or provisioning branch, and the orchestrator still calls `maybeProvisionKaneo()` for group contexts.

- [ ] **Step 3: Implement explicit group-setup provisioning and DM-only implicit provisioning**

`src/providers/kaneo/provision.ts` should provide message-time auto-provisioning:

```typescript
export async function maybeProvisionKaneo(reply: ReplyFn, contextId: string, username: string | null): Promise<void> {
  const taskProvider = process.env['TASK_PROVIDER'] ?? 'kaneo'
  if (taskProvider !== 'kaneo') return
  // existing logic follows
}
```

`src/llm-orchestrator.ts` should only auto-provision for DM contexts:

```typescript
const configId = configContextId ?? contextId
if (contextType === 'dm') {
  await deps.maybeProvisionKaneo(reply, configId, username)
}
```

`src/commands/setup.ts` should gain dependency injection and explicit group-first-time branching:

```typescript
import { isAuthorizedGroup } from '../authorized-groups.js'
import { getConfig } from '../config.js'
import { provisionAndConfigure } from '../providers/kaneo/provision.js'
import { getKaneoWorkspace } from '../users.js'

export interface SetupCommandDeps {
  isAuthorizedGroup: (groupId: string) => boolean
  getConfig: typeof getConfig
  getKaneoWorkspace: typeof getKaneoWorkspace
  provisionAndConfigure: typeof provisionAndConfigure
  createWizard: typeof createWizard
}

const defaultDeps: SetupCommandDeps = {
  isAuthorizedGroup,
  getConfig,
  getKaneoWorkspace,
  provisionAndConfigure,
  createWizard,
}

function isFirstTimeKaneoGroupSetup(targetContextId: string, deps: SetupCommandDeps): boolean {
  return deps.getConfig(targetContextId, 'kaneo_apikey') === null || deps.getKaneoWorkspace(targetContextId) === null
}

async function replyForProvisionOutcome(reply: ReplyFn, outcome: ProvisionOutcome): Promise<boolean> {
  if (outcome.status === 'provisioned') {
    await reply.text(
      `✅ The group Kaneo account has been created.\n🌐 ${outcome.kaneoUrl}\n📧 Email: ${outcome.email}\n🔑 Password: ${outcome.password}`,
    )
    return true
  }

  if (outcome.status === 'registration_disabled') {
    await reply.text(
      'Kaneo account could not be created for this group because registration is disabled on this instance.',
    )
    return true
  }

  await reply.text(`Kaneo account could not be created for this group: ${outcome.error}`)
  return true
}

export async function startSetupForTarget(
  userId: string,
  reply: ReplyFn,
  targetContextId: string,
  deps: SetupCommandDeps = defaultDeps,
): Promise<void> {
  const isGroupTarget = targetContextId !== userId

  if (isGroupTarget && !deps.isAuthorizedGroup(targetContextId)) {
    await reply.text('This group is not authorized yet. Ask the bot admin to run `/group add <group-id>` in DM first.')
    return
  }

  if (isGroupTarget && TASK_PROVIDER === 'kaneo' && isFirstTimeKaneoGroupSetup(targetContextId, deps)) {
    const shouldStop = await replyForProvisionOutcome(reply, await deps.provisionAndConfigure(targetContextId, null))
    if (shouldStop) {
      return
    }
  }

  const result = deps.createWizard(userId, targetContextId, TASK_PROVIDER)
  if (result.success) {
    await reply.text(result.prompt)
    return
  }
  if (result.prompt === undefined) {
    await reply.text('Failed to start wizard. Please try again.')
    return
  }
  await reply.text(result.prompt)
}
```

- [ ] **Step 4: Re-run the setup/provisioning/orchestrator tests**

Run:

```bash
bun test tests/commands/setup.test.ts tests/providers/kaneo/provision.test.ts tests/llm-orchestrator.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit the setup/provisioning slice**

```bash
git add src/commands/setup.ts src/providers/kaneo/provision.ts src/llm-orchestrator.ts src/llm-orchestrator-types.ts .env.example tests/commands/setup.test.ts tests/providers/kaneo/provision.test.ts tests/llm-orchestrator.test.ts
git commit -m "feat: add explicit group Kaneo setup provisioning"
```

---

## Task 6: Run focused verification and full regression checks

**Files:**

- Modify: none unless a verification failure requires fixes

- [ ] **Step 1: Run the focused changed-area suite**

Run:

```bash
bun test tests/authorized-groups.test.ts tests/auth.test.ts tests/auth-integration.test.ts tests/bot.test.ts tests/commands/group.test.ts tests/commands/help.test.ts tests/commands/setup.test.ts tests/providers/kaneo/provision.test.ts tests/llm-orchestrator.test.ts
```

Expected: PASS

- [ ] **Step 2: Run lint and typecheck for the changed code**

Run:

```bash
bun run lint:agent-strict -- src/authorized-groups.ts src/auth.ts src/bot.ts src/commands/group.ts src/commands/help.ts src/commands/setup.ts src/providers/kaneo/provision.ts src/message-queue/types.ts src/message-queue/queue.ts src/llm-orchestrator.ts tests/authorized-groups.test.ts tests/auth.test.ts tests/auth-integration.test.ts tests/bot.test.ts tests/commands/group.test.ts tests/commands/help.test.ts tests/commands/setup.test.ts tests/providers/kaneo/provision.test.ts tests/llm-orchestrator.test.ts
bun run typecheck
```

Expected: PASS

- [ ] **Step 3: Run the broader project safety net**

Run:

```bash
bun test
```

Expected: PASS

- [ ] **Step 4: Commit any final verification-driven fixes**

```bash
git add src tests .env.example
git commit -m "test: verify group authorization and provisioning flow"
```

Only do this step if verification produced follow-up fixes not already committed in earlier tasks.

---

## Spec Coverage Check

- Explicit group allowlist: covered by Task 1 and Task 3
- Group auth model with admin-default access and non-admin member overrides: covered by Task 2
- Group deny messaging and bot behavior: covered by Task 2 and Task 4
- DM admin `/group add`, `/group remove`, `/groups`: covered by Task 3
- Group config must stay group-scoped rather than thread-scoped: covered by Task 4
- No implicit group provisioning from ordinary group messages: covered by Task 4 and Task 5
- First-time group `/setup` provisioning branches: covered by Task 5
- Verification and regressions: covered by Task 6

## Notes For The Implementer

- Do not create a second command registration for `/group`; extend the existing handler to branch on `msg.contextType`
- Do not overload `group_members` to mean "authorized group"; keep allowlisted groups and non-admin member overrides separate
- Keep group setup selection behavior based on observed manageable groups; block non-allowlisted groups at setup execution time instead of mutating the selector first
- Keep the future per-member Kaneo-account idea out of scope; do not introduce workspace invitation logic in this change
