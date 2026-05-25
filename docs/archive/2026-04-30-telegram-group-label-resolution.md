<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Telegram Group Label Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve Telegram `/groups` and `/group users` so they resolve group
IDs and user IDs to readable labels via live Bot API lookups first, cached
local observations second, and raw IDs last.

**Architecture:** Keep `src/commands/group.ts` responsible for authorization
and reply formatting, but move Telegram-specific display fallback logic into a
dedicated helper under `src/chat/telegram/`. Add a small provider-scoped
observation table plus registry helpers so group messages can seed cached user
labels and command resolvers can reuse those labels when Telegram live lookups
fail.

**Tech Stack:** Bun, TypeScript, Drizzle ORM with SQLite migrations, Grammy Telegram adapter, Bun test

---

## File Structure

### Existing files to modify

- `src/db/schema.ts`
  - Add the provider-scoped table for cached group user display observations.
- `src/db/index.ts`
  - Register the new migration.
- `src/group-settings/registry.ts`
  - Add upsert/query helpers for cached group user display observations and a
    small exported lookup for known group labels.
- `src/chat/types.ts`
  - Add an optional `displayLabel` field on `ChatUser` so adapters can pass
    already-known human-readable labels into observation recording.
- `src/chat/telegram/index.ts`
  - Populate `msg.user.displayLabel` from Telegram `from.first_name`, `from.last_name`, and `from.username`.
- `src/bot.ts`
  - Persist cached group user display observations when group messages are recorded.
- `src/commands/group.ts`
  - Route Telegram `/groups` and `/group users` label resolution through the
    Telegram-specific resolver while preserving existing concurrency limits and
    non-Telegram behavior.
- `tests/group-settings/registry.test.ts`
  - Add regression tests for the new observation table and helper functions.
- `tests/bot.test.ts`
  - Add regression coverage that group-message observation writes cached user display labels.
- `tests/commands/group.test.ts`
  - Add Telegram-specific command regressions proving cached labels are used when live lookups return `null`.

### New files to create

- `src/db/migrations/028_group_user_observations.ts`
  - Creates the new provider-scoped observation table.
- `src/chat/telegram/group-display-resolution.ts`
  - Telegram-only live+cached group/user label resolver used by the group commands.
- `tests/chat/telegram/group-display-resolution.test.ts`
  - Focused tests for live lookup precedence and cached fallback behavior.

### Responsibility boundaries

- The new DB table and registry helpers own **storage** and **lookup** for cached labels.
- `src/chat/telegram/index.ts` and `src/bot.ts` own **observation capture** from incoming Telegram group messages.
- `src/chat/telegram/group-display-resolution.ts` owns **Telegram-specific fallback policy**.
- `src/commands/group.ts` continues to own **reply formatting** and **authorization checks**.

---

### Task 1: Add provider-scoped cached group user observations

**Files:**

- Create: `src/db/migrations/028_group_user_observations.ts`
- Modify: `src/db/schema.ts:220-270`
- Modify: `src/db/index.ts:1-120`
- Modify: `src/group-settings/registry.ts:1-220`
- Test: `tests/group-settings/registry.test.ts`

- [ ] **Step 1: Write the failing registry tests**

Append these imports and tests to `tests/group-settings/registry.test.ts`.

```ts
import { groupUserObservations } from '../../src/db/schema.js'
import {
  findGroupUserObservation,
  findKnownGroupContext,
  upsertGroupUserObservation,
} from '../../src/group-settings/registry.js'

function getGroupUserObservation(
  provider: string,
  contextId: string,
  userId: string,
): typeof groupUserObservations.$inferSelect | undefined {
  return getDrizzleDb()
    .select()
    .from(groupUserObservations)
    .where(
      and(
        eq(groupUserObservations.provider, provider),
        eq(groupUserObservations.contextId, contextId),
        eq(groupUserObservations.userId, userId),
      ),
    )
    .get()
}

test('stores the latest observed group user label per provider, group, and user', () => {
  upsertGroupUserObservation({
    provider: 'telegram',
    contextId: 'group-1',
    userId: 'user-1',
    username: 'alice',
    displayLabel: 'Alice Example (@alice)',
  })

  const observation = getGroupUserObservation('telegram', 'group-1', 'user-1')
  expect(observation?.displayLabel).toBe('Alice Example (@alice)')
  expect(observation?.username).toBe('alice')
})

test('finds group user observations by exact provider, context, and user', () => {
  upsertGroupUserObservation({
    provider: 'telegram',
    contextId: 'group-1',
    userId: 'user-1',
    username: 'alice',
    displayLabel: 'Alice Example (@alice)',
  })
  upsertGroupUserObservation({
    provider: 'discord',
    contextId: 'group-1',
    userId: 'user-1',
    username: 'alice-discord',
    displayLabel: 'Alice Discord',
  })

  expect(findGroupUserObservation('telegram', 'group-1', 'user-1')).toEqual({
    provider: 'telegram',
    contextId: 'group-1',
    userId: 'user-1',
    username: 'alice',
    displayLabel: 'Alice Example (@alice)',
  })
})

test('finds known group contexts by provider and context id', () => {
  upsertKnownGroupContext({
    contextId: 'group-1',
    provider: 'telegram',
    displayName: 'Operations',
    parentName: 'Platform',
  })

  expect(findKnownGroupContext('telegram', 'group-1')?.displayName).toBe('Operations')
  expect(findKnownGroupContext('discord', 'group-1')).toBeNull()
})
```

- [ ] **Step 2: Run the registry tests to verify they fail**

Run:

```bash
bun test tests/group-settings/registry.test.ts
```

Expected: FAIL with missing exports such as `groupUserObservations`, `upsertGroupUserObservation`, `findGroupUserObservation`, or `findKnownGroupContext`.

- [ ] **Step 3: Add the migration, schema, and migration registration**

Create `src/db/migrations/028_group_user_observations.ts`:

```ts
import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

const createGroupUserObservationsTable = (db: Database): void => {
  db.run(`
    CREATE TABLE group_user_observations (
      provider TEXT NOT NULL,
      context_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      username TEXT,
      display_label TEXT NOT NULL,
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (provider, context_id, user_id)
    )
  `)
  db.run('CREATE INDEX idx_group_user_observations_provider_user ON group_user_observations(provider, user_id)')
}

export const migration028GroupUserObservations: Migration = {
  id: '028_group_user_observations',
  up(db: Database): void {
    createGroupUserObservationsTable(db)
  },
}
```

Add this table to `src/db/schema.ts` after `groupAdminObservations`:

```ts
export const groupUserObservations = sqliteTable(
  'group_user_observations',
  {
    provider: text('provider').notNull(),
    contextId: text('context_id').notNull(),
    userId: text('user_id').notNull(),
    username: text('username'),
    displayLabel: text('display_label').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.contextId, table.userId] }),
    index('idx_group_user_observations_provider_user').on(table.provider, table.userId),
  ],
)
```

Register the migration in `src/db/index.ts`:

```ts
import { migration028GroupUserObservations } from './migrations/028_group_user_observations.js'

export const MIGRATIONS: readonly Migration[] = [
  migration001Initial,
  migration002ConversationHistory,
  migration003MultiuserSupport,
  migration004KaneoWorkspace,
  migration005RenameConfigKeys,
  migration006VersionAnnouncements,
  migration007PlatformUserId,
  migration008GroupMembers,
  migration009RecurringTasks,
  migration010RecurringTaskOccurrences,
  migration011ProactiveAlerts,
  migration012UserInstructions,
  migration013DeferredPrompts,
  migration014BackgroundEvents,
  migration015DropBackgroundEvents,
  migration016ExecutionMetadata,
  migration017MessageMetadata,
  migration018Memos,
  migration019UserIdentityMappings,
  migration020GroupSettingsRegistry,
  migration021WebFetch,
  migration022DropUnusedLastSeenIndex,
  migration023AddForeignKeys,
  migration024AuthorizedGroups,
  migration025DeferredPromptDeliveryTargets,
  migration026RruleUnification,
  migration027ScheduledPromptTimezone,
  migration028GroupUserObservations,
]
```

- [ ] **Step 4: Add the registry helpers**

Modify `src/group-settings/registry.ts` imports and add the new APIs.

```ts
import { and, eq } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { groupAdminObservations, groupUserObservations, knownGroupContexts } from '../db/schema.js'
import { logger } from '../logger.js'
import type { KnownGroupContext } from './types.js'

export interface UpsertGroupUserObservationInput {
  readonly provider: string
  readonly contextId: string
  readonly userId: string
  readonly username: string | null
  readonly displayLabel: string
}

export interface GroupUserObservation {
  readonly provider: string
  readonly contextId: string
  readonly userId: string
  readonly username: string | null
  readonly displayLabel: string
}

export function findKnownGroupContext(provider: string, contextId: string): KnownGroupContext | null {
  const row = getDrizzleDb()
    .select({
      contextId: knownGroupContexts.contextId,
      provider: knownGroupContexts.provider,
      displayName: knownGroupContexts.displayName,
      parentName: knownGroupContexts.parentName,
      firstSeenAt: knownGroupContexts.firstSeenAt,
      lastSeenAt: knownGroupContexts.lastSeenAt,
    })
    .from(knownGroupContexts)
    .where(and(eq(knownGroupContexts.provider, provider), eq(knownGroupContexts.contextId, contextId)))
    .get()

  return row === undefined ? null : toKnownGroupContext(row)
}

export function upsertGroupUserObservation(input: UpsertGroupUserObservationInput): void {
  log.debug(
    { provider: input.provider, contextId: input.contextId, userId: input.userId },
    'upsertGroupUserObservation called',
  )

  const db = getDrizzleDb()
  const existing = db
    .select({ lastSeenAt: groupUserObservations.lastSeenAt })
    .from(groupUserObservations)
    .where(
      and(
        eq(groupUserObservations.provider, input.provider),
        eq(groupUserObservations.contextId, input.contextId),
        eq(groupUserObservations.userId, input.userId),
      ),
    )
    .get()

  if (existing !== undefined && isWithinThrottleWindow(existing.lastSeenAt)) {
    log.debug(
      { provider: input.provider, contextId: input.contextId, userId: input.userId },
      'Skipping group user observation upsert (throttled)',
    )
    return
  }

  const now = new Date().toISOString()

  db.insert(groupUserObservations)
    .values({
      provider: input.provider,
      contextId: input.contextId,
      userId: input.userId,
      username: input.username,
      displayLabel: input.displayLabel,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: [groupUserObservations.provider, groupUserObservations.contextId, groupUserObservations.userId],
      set: {
        username: input.username,
        displayLabel: input.displayLabel,
        lastSeenAt: now,
      },
    })
    .run()
}

export function findGroupUserObservation(
  provider: string,
  contextId: string,
  userId: string,
): GroupUserObservation | null {
  const row = getDrizzleDb()
    .select({
      provider: groupUserObservations.provider,
      contextId: groupUserObservations.contextId,
      userId: groupUserObservations.userId,
      username: groupUserObservations.username,
      displayLabel: groupUserObservations.displayLabel,
    })
    .from(groupUserObservations)
    .where(
      and(
        eq(groupUserObservations.provider, provider),
        eq(groupUserObservations.contextId, contextId),
        eq(groupUserObservations.userId, userId),
      ),
    )
    .get()

  return row ?? null
}
```

- [ ] **Step 5: Run the registry tests to verify they pass**

Run:

```bash
bun test tests/group-settings/registry.test.ts
```

Expected: PASS for the new observation-table tests and the pre-existing registry tests.

- [ ] **Step 6: Commit Task 1**

Run:

```bash
git add src/db/migrations/028_group_user_observations.ts src/db/schema.ts src/db/index.ts src/group-settings/registry.ts tests/group-settings/registry.test.ts
git commit -m "feat: add cached group user observations"
```

---

### Task 2: Capture Telegram display labels during group-message observation

**Files:**

- Modify: `src/chat/types.ts:1-20`
- Modify: `src/chat/telegram/index.ts:179-205`
- Modify: `src/bot.ts:194-207`
- Test: `tests/bot.test.ts`

- [ ] **Step 1: Write the failing bot regression**

Add the new table import and this test to `tests/bot.test.ts`.

```ts
import { groupAdminObservations, groupUserObservations, knownGroupContexts } from '../src/db/schema.js'

test('records group user display observations before normal message handling', async () => {
  addUser('group-admin', ADMIN_ID)
  addAuthorizedGroup('group-ops', ADMIN_ID)
  setupUserConfig('group-admin')

  const messageHandler = getMessageHandler()
  expect(messageHandler).not.toBeNull()

  const groupMessage = createGroupMessage('group-admin', '@bot status', true, 'group-ops')
  groupMessage.contextName = 'Operations'
  groupMessage.contextParentName = 'Platform'
  groupMessage.user = {
    ...groupMessage.user,
    username: 'itsmike',
    displayLabel: 'John Johnson (@itsmike)',
  }

  const { reply } = createMockReply()
  await messageHandler!(groupMessage, reply)

  const observation = getDrizzleDb()
    .select()
    .from(groupUserObservations)
    .where(
      and(
        eq(groupUserObservations.provider, 'mock'),
        eq(groupUserObservations.contextId, 'group-ops'),
        eq(groupUserObservations.userId, 'group-admin'),
      ),
    )
    .get()

  expect(observation?.displayLabel).toBe('John Johnson (@itsmike)')
  expect(observation?.username).toBe('itsmike')
})
```

- [ ] **Step 2: Run the bot test to verify it fails**

Run:

```bash
bun test tests/bot.test.ts -t "records group user display observations before normal message handling"
```

Expected: FAIL because `ChatUser` does not yet accept `displayLabel` and `recordGroupObservation` does not persist to `groupUserObservations`.

- [ ] **Step 3: Add `displayLabel` to `ChatUser` and populate it in the Telegram adapter**

Modify `src/chat/types.ts`:

```ts
export type ChatUser = {
  id: string
  username: string | null
  /** provider-formatted display label when the adapter already knows it */
  displayLabel?: string
  /** platform admin in current context */
  isAdmin: boolean
}
```

Modify `src/chat/telegram/index.ts` imports and `extractMessage` return value:

```ts
import { formatTelegramUserLabel } from './label-helpers.js'

const username = from === undefined ? null : getTelegramUsername(from.username)
const displayLabel =
  from === undefined
    ? undefined
    : (formatTelegramUserLabel(
        typeof from.first_name === 'string' ? from.first_name : '',
        typeof from.last_name === 'string' && from.last_name !== '' ? from.last_name : undefined,
        username ?? undefined,
      ) ?? undefined)

return {
  user: { id: String(id), username, displayLabel, isAdmin },
  contextId,
  contextType,
  contextName,
  isMentioned,
  text,
  messageId: messageIdStr,
  replyToMessageId: replyToMessageIdStr,
  replyContext,
  threadId,
}
```

- [ ] **Step 4: Persist cached display labels in `recordGroupObservation`**

Modify `src/bot.ts` imports and `recordGroupObservation`.

```ts
import {
  upsertGroupAdminObservation,
  upsertGroupUserObservation,
  upsertKnownGroupContext,
} from './group-settings/registry.js'

function recordGroupObservation(chat: ChatProvider, msg: IncomingMessage): void {
  if (msg.contextType !== 'group' || shouldIgnoreGroupMessage(msg)) return
  let displayName = msg.contextId
  if (msg.contextName !== undefined) displayName = msg.contextName
  let parentName: string | null = null
  if (msg.contextParentName !== undefined) parentName = msg.contextParentName
  upsertKnownGroupContext({
    contextId: msg.contextId,
    provider: chat.name,
    displayName,
    parentName,
  })
  upsertGroupAdminObservation({
    contextId: msg.contextId,
    userId: msg.user.id,
    username: msg.user.username,
    isAdmin: msg.user.isAdmin,
  })

  if (msg.user.displayLabel !== undefined && msg.user.displayLabel !== '') {
    upsertGroupUserObservation({
      provider: chat.name,
      contextId: msg.contextId,
      userId: msg.user.id,
      username: msg.user.username,
      displayLabel: msg.user.displayLabel,
    })
  }
}
```

- [ ] **Step 5: Run the targeted bot regression**

Run:

```bash
bun test tests/bot.test.ts -t "records group user display observations before normal message handling"
```

Expected: PASS, and the new `group_user_observations` row is written alongside the existing group/admin observations.

- [ ] **Step 6: Commit Task 2**

Run:

```bash
git add src/chat/types.ts src/chat/telegram/index.ts src/bot.ts tests/bot.test.ts
git commit -m "feat: record observed group user labels"
```

---

### Task 3: Add a Telegram-only live+cached display resolver

**Files:**

- Create: `src/chat/telegram/group-display-resolution.ts`
- Test: `tests/chat/telegram/group-display-resolution.test.ts`
- Modify: `src/group-settings/registry.ts:1-260` (reuse existing helpers only if Task 1 exported everything needed)

- [ ] **Step 1: Write the failing resolver tests**

Create `tests/chat/telegram/group-display-resolution.test.ts`.

```ts
import { beforeEach, describe, expect, test } from 'bun:test'

import type { ChatProvider } from '../../../src/chat/types.js'
import {
  resolveTelegramGroupDisplayLabel,
  resolveTelegramUserDisplayLabel,
} from '../../../src/chat/telegram/group-display-resolution.js'
import { upsertGroupUserObservation, upsertKnownGroupContext } from '../../../src/group-settings/registry.js'
import { createMockChat, mockLogger, setupTestDb } from '../../utils/test-helpers.js'

const createTelegramChat = (overrides: Parameters<typeof createMockChat>[0]): ChatProvider => ({
  ...createMockChat(overrides),
  name: 'telegram',
})

describe('telegram group display resolution', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('prefers live group titles over cached known-group labels', async () => {
    upsertKnownGroupContext({
      contextId: '-1001',
      provider: 'telegram',
      displayName: 'Cached Operations',
      parentName: null,
    })

    const chat = createTelegramChat({
      resolveGroupLabel: async (): Promise<string | null> => 'Live Operations',
    })

    expect(await resolveTelegramGroupDisplayLabel(chat, '-1001')).toBe('Live Operations')
  })

  test('falls back to cached known-group labels when live group lookup returns null', async () => {
    upsertKnownGroupContext({
      contextId: '-1001',
      provider: 'telegram',
      displayName: 'Cached Operations',
      parentName: null,
    })

    const chat = createTelegramChat({
      resolveGroupLabel: async (): Promise<string | null> => null,
    })

    expect(await resolveTelegramGroupDisplayLabel(chat, '-1001')).toBe('Cached Operations')
  })

  test('falls back to cached observed user labels when live member lookup returns null', async () => {
    upsertGroupUserObservation({
      provider: 'telegram',
      contextId: '-1001',
      userId: '42',
      username: 'itsmike',
      displayLabel: 'John Johnson (@itsmike)',
    })

    const chat = createTelegramChat({
      resolveUserLabel: async (): Promise<string | null> => null,
    })

    expect(await resolveTelegramUserDisplayLabel(chat, '-1001', '42')).toBe('John Johnson (@itsmike)')
  })
})
```

- [ ] **Step 2: Run the resolver tests to verify they fail**

Run:

```bash
bun test tests/chat/telegram/group-display-resolution.test.ts
```

Expected: FAIL because `src/chat/telegram/group-display-resolution.ts` does not exist.

- [ ] **Step 3: Implement the Telegram resolver**

Create `src/chat/telegram/group-display-resolution.ts`.

```ts
import type { ChatProvider } from '../types.js'
import { logger } from '../../logger.js'
import {
  findGroupUserObservation,
  findKnownGroupContext,
  upsertGroupUserObservation,
} from '../../group-settings/registry.js'

const log = logger.child({ scope: 'chat:telegram:group-display-resolution' })
const TELEGRAM_PROVIDER = 'telegram'

const isTelegramChat = (chat: Pick<ChatProvider, 'name'>): boolean => chat.name === TELEGRAM_PROVIDER

const resolveLiveGroupLabel = async (chat: ChatProvider, groupId: string): Promise<string | null> => {
  const fn = chat.resolveGroupLabel
  if (fn === undefined) return null
  try {
    return await fn(groupId)
  } catch (error: unknown) {
    log.warn(
      { groupId, error: error instanceof Error ? error.message : String(error) },
      'Telegram group label lookup failed',
    )
    return null
  }
}

const resolveLiveUserLabel = async (chat: ChatProvider, contextId: string, userId: string): Promise<string | null> => {
  const fn = chat.resolveUserLabel
  if (fn === undefined) return null
  try {
    return await fn(userId, { contextId, contextType: 'group' })
  } catch (error: unknown) {
    log.warn(
      { contextId, userId, error: error instanceof Error ? error.message : String(error) },
      'Telegram user label lookup failed',
    )
    return null
  }
}

export async function resolveTelegramGroupDisplayLabel(chat: ChatProvider, groupId: string): Promise<string | null> {
  if (!isTelegramChat(chat)) return null
  const liveLabel = await resolveLiveGroupLabel(chat, groupId)
  if (liveLabel !== null) return liveLabel
  return findKnownGroupContext(TELEGRAM_PROVIDER, groupId)?.displayName ?? null
}

export async function resolveTelegramUserDisplayLabel(
  chat: ChatProvider,
  contextId: string,
  userId: string,
): Promise<string | null> {
  if (!isTelegramChat(chat)) return null
  const liveLabel = await resolveLiveUserLabel(chat, contextId, userId)
  if (liveLabel !== null) {
    upsertGroupUserObservation({
      provider: TELEGRAM_PROVIDER,
      contextId,
      userId,
      username: null,
      displayLabel: liveLabel,
    })
    return liveLabel
  }
  return findGroupUserObservation(TELEGRAM_PROVIDER, contextId, userId)?.displayLabel ?? null
}
```

- [ ] **Step 4: Run the resolver tests to verify they pass**

Run:

```bash
bun test tests/chat/telegram/group-display-resolution.test.ts
```

Expected: PASS for live-group precedence, cached group fallback, and cached user fallback.

- [ ] **Step 5: Commit Task 3**

Run:

```bash
git add src/chat/telegram/group-display-resolution.ts tests/chat/telegram/group-display-resolution.test.ts
git commit -m "feat: add telegram group display resolver"
```

---

### Task 4: Wire `/groups` and `/group users` to the Telegram resolver

**Files:**

- Modify: `src/commands/group.ts:1-284`
- Test: `tests/commands/group.test.ts`

- [ ] **Step 1: Write the failing command regressions**

Add these imports and tests to `tests/commands/group.test.ts`.

```ts
import { upsertGroupUserObservation, upsertKnownGroupContext } from '../../src/group-settings/registry.js'

test('uses cached telegram group and adder labels for /groups when live lookup returns null', async () => {
  const commandHandlers = new Map<string, CommandHandler>()
  const telegramChat: ChatProvider = {
    ...createMockChat({
      commandHandlers,
      resolveGroupLabel: async (): Promise<string | null> => null,
      resolveUserLabel: async (): Promise<string | null> => null,
    }),
    name: 'telegram',
  }
  registerGroupCommand(telegramChat)

  const { addAuthorizedGroup } = await import('../../src/authorized-groups.js')
  addAuthorizedGroup('-100123', '42')
  upsertKnownGroupContext({
    contextId: '-100123',
    provider: 'telegram',
    displayName: 'Operations',
    parentName: null,
  })
  upsertGroupUserObservation({
    provider: 'telegram',
    contextId: '-100123',
    userId: '42',
    username: 'itsmike',
    displayLabel: 'John Johnson (@itsmike)',
  })

  const handler = commandHandlers.get('groups')
  expect(handler).toBeDefined()

  const { reply, textCalls } = createMockReply()
  await handler!(createDmMessage('admin1'), reply, createAuth('admin1', { isBotAdmin: true }))

  expect(textCalls[0]).toContain('Operations (added by John Johnson (@itsmike))')
})

test('uses cached telegram member and adder labels for /group users when live lookup returns null', async () => {
  const commandHandlers = new Map<string, CommandHandler>()
  const telegramChat: ChatProvider = {
    ...createMockChat({
      commandHandlers,
      resolveUserLabel: async (): Promise<string | null> => null,
    }),
    name: 'telegram',
  }
  registerGroupCommand(telegramChat)

  const { addGroupMember } = await import('../../src/groups.js')
  addGroupMember('-100123', '99', '42')
  upsertGroupUserObservation({
    provider: 'telegram',
    contextId: '-100123',
    userId: '99',
    username: 'worker99',
    displayLabel: 'Worker Ninety Nine (@worker99)',
  })
  upsertGroupUserObservation({
    provider: 'telegram',
    contextId: '-100123',
    userId: '42',
    username: 'itsmike',
    displayLabel: 'John Johnson (@itsmike)',
  })

  const handler = commandHandlers.get('group')
  expect(handler).toBeDefined()

  const { reply, textCalls } = createMockReply()
  await handler!(createGroupMessage('42', 'users', true, '-100123'), reply, createAuth('42', { isGroupAdmin: true }))

  expect(textCalls[0]).toContain('- Worker Ninety Nine (@worker99) (added by John Johnson (@itsmike))')
})
```

- [ ] **Step 2: Run the command regressions to verify they fail**

Run:

```bash
bun test tests/commands/group.test.ts -t "uses cached telegram"
```

Expected: FAIL because `src/commands/group.ts` still falls straight from live lookup to raw IDs.

- [ ] **Step 3: Update `src/commands/group.ts` to use the Telegram resolver**

Import the Telegram resolver and refactor the current cached label helpers.

```ts
import {
  resolveTelegramGroupDisplayLabel,
  resolveTelegramUserDisplayLabel,
} from '../chat/telegram/group-display-resolution.js'

async function resolveCommandUserLabel(resolverContext: LabelResolverContext, userId: string): Promise<string | null> {
  if (resolverContext.chat.name === 'telegram') {
    return resolveTelegramUserDisplayLabel(resolverContext.chat, resolverContext.contextId, userId)
  }

  const fn = resolverContext.chat.resolveUserLabel
  if (fn === undefined) return null
  return fn(userId, {
    contextId: resolverContext.contextId,
    contextType: resolverContext.contextType,
  })
}

async function resolveCommandGroupLabel(chat: ChatProvider, groupId: string): Promise<string | null> {
  if (chat.name === 'telegram') {
    return resolveTelegramGroupDisplayLabel(chat, groupId)
  }

  const fn = chat.resolveGroupLabel
  if (fn === undefined) return null
  return fn(groupId)
}

function resolveUserLabelCached(
  resolverContext: LabelResolverContext,
  userId: string,
  cache: Map<string, Promise<string | null>>,
  scheduleLookup: ScheduleLookup,
): Promise<string | null> {
  const cacheKey = `${resolverContext.contextType}:${resolverContext.contextId}:${userId}`
  const existing = cache.get(cacheKey)
  if (existing !== undefined) return existing

  const pending = scheduleLookup(() =>
    resolveCommandUserLabel(resolverContext, userId).catch((error: unknown): string | null => {
      log.warn(
        {
          userId,
          contextId: resolverContext.contextId,
          contextType: resolverContext.contextType,
          error: error instanceof Error ? error.message : String(error),
        },
        'User label lookup failed in group command',
      )
      return null
    }),
  )

  cache.set(cacheKey, pending)
  return pending
}

function resolveGroupLabelCached(
  chat: ChatProvider,
  groupId: string,
  cache: Map<string, Promise<string | null>>,
  scheduleLookup: ScheduleLookup,
): Promise<string | null> {
  const existing = cache.get(groupId)
  if (existing !== undefined) return existing

  const pending = scheduleLookup(() =>
    resolveCommandGroupLabel(chat, groupId).catch((error: unknown): string | null => {
      log.warn(
        { groupId, error: error instanceof Error ? error.message : String(error) },
        'Group label lookup failed in group command',
      )
      return null
    }),
  )

  cache.set(groupId, pending)
  return pending
}
```

- [ ] **Step 4: Run the command test file to verify the new Telegram fallback behavior**

Run:

```bash
bun test tests/commands/group.test.ts
```

Expected: PASS for the new Telegram cached fallback tests and the pre-existing `/groups` and `/group users` coverage.

- [ ] **Step 5: Commit Task 4**

Run:

```bash
git add src/commands/group.ts tests/commands/group.test.ts
git commit -m "feat: use cached telegram labels in group commands"
```

---

### Task 5: Final verification

**Files:**

- Verify only: `src/db/migrations/028_group_user_observations.ts`
- Verify only: `src/db/schema.ts`
- Verify only: `src/db/index.ts`
- Verify only: `src/group-settings/registry.ts`
- Verify only: `src/chat/types.ts`
- Verify only: `src/chat/telegram/index.ts`
- Verify only: `src/chat/telegram/group-display-resolution.ts`
- Verify only: `src/bot.ts`
- Verify only: `src/commands/group.ts`
- Verify only: `tests/group-settings/registry.test.ts`
- Verify only: `tests/chat/telegram/group-display-resolution.test.ts`
- Verify only: `tests/bot.test.ts`
- Verify only: `tests/commands/group.test.ts`

- [ ] **Step 1: Run the targeted regression suite**

Run:

```bash
bun test tests/group-settings/registry.test.ts tests/chat/telegram/group-display-resolution.test.ts tests/bot.test.ts tests/commands/group.test.ts
```

Expected: PASS for all targeted regressions covering storage, observation capture, resolver behavior, and command output.

- [ ] **Step 2: Run static verification on the touched paths**

Run:

```bash
bun typecheck
bun lint:agent-strict -- src/db/schema.ts src/db/index.ts src/db/migrations/028_group_user_observations.ts src/group-settings/registry.ts src/chat/types.ts src/chat/telegram/index.ts src/chat/telegram/group-display-resolution.ts src/bot.ts src/commands/group.ts tests/group-settings/registry.test.ts tests/chat/telegram/group-display-resolution.test.ts tests/bot.test.ts tests/commands/group.test.ts
```

Expected: PASS with no TypeScript or lint errors on the modified implementation and test files.

- [ ] **Step 3: Check git status before handing off**

Run:

```bash
git status --short
```

Expected: clean working tree, or only the intentionally uncommitted changes from the active task if you are stopping for review before the final commit.

---

## Plan Self-Review

- **Spec coverage:** Task 1 adds provider-scoped cached display-label storage, Task 2 captures Telegram observations from group messages, Task 3 implements Telegram live+cached fallback policy, and Task 4 wires `/groups` and `/group users` to that policy. That covers the spec’s architecture, persistence, fallback order, and testing requirements.
- **Placeholder scan:** No `TODO`, `TBD`, or “similar to above” shortcuts remain. Every code-changing step includes concrete code.
- **Type consistency:** The plan uses one `displayLabel` field name consistently on `ChatUser`, one `groupUserObservations` table name consistently in schema/tests, and one pair of resolver entry points: `resolveTelegramGroupDisplayLabel` and `resolveTelegramUserDisplayLabel`.
