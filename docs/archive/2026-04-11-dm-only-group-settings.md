<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# DM-Only Group Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make group-scoped `/config` and `/setup` configurable only through DM, with explicit group selection and group-admin-only access.

**Architecture:** Persist a known-group/admin-observation registry, enrich inbound group messages with human-readable context metadata, and add a DM-only selector that chooses a settings target context before reusing the existing config editor and setup wizard. Group chats become redirect-only for settings, while threads keep separate conversation history but always share the parent group config target.

**Tech Stack:** TypeScript, Bun, Drizzle ORM with SQLite migrations, Grammy, Mattermost REST/WebSocket, discord.js structural adapters, Bun test

---

## File Structure

One plan is enough here because the database, adapter, selector, bot, and command work all ship one user-visible slice.

| File                                                                                               | Responsibility                                                                                    |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `src/db/schema.ts`                                                                                 | Add persistent `known_group_contexts` and `group_admin_observations` tables                       |
| `src/db/migrations/020_group_settings_registry.ts`                                                 | Create the new tables and indexes in SQLite                                                       |
| `src/group-settings/types.ts`                                                                      | Shared types for registry rows, selector sessions, and selector outcomes                          |
| `src/group-settings/registry.ts`                                                                   | Upsert/read known groups and admin observations                                                   |
| `src/group-settings/access.ts`                                                                     | `canManageGroupSettings`, `listManageableGroups`, and freeform matching                           |
| `src/group-settings/state.ts`                                                                      | DM selector session store keyed by DM user ID with 30 minute TTL                                  |
| `src/group-settings/selector.ts`                                                                   | Scope picker, group picker, callback parsing, and continuation outcomes                           |
| `src/chat/types.ts`                                                                                | Add optional `contextName` / `contextParentName` metadata to `IncomingMessage`                    |
| `src/chat/telegram/index.ts`                                                                       | Populate Telegram group titles into incoming message metadata                                     |
| `src/chat/mattermost/schema.ts` and `src/chat/mattermost/index.ts`                                 | Parse channel/team metadata and attach it to incoming messages                                    |
| `src/chat/discord/map-message.ts`                                                                  | Populate Discord channel/guild metadata on mapped incoming messages                               |
| `src/bot.ts`                                                                                       | Record group observations and enforce selector → editor → wizard interception order               |
| `src/commands/config.ts`                                                                           | DM selector entrypoint, group redirect, and `renderConfigForTarget()` helper                      |
| `src/commands/setup.ts`                                                                            | DM selector entrypoint, group redirect, and `startSetupForTarget()` helper                        |
| `src/chat/interaction-router.ts`                                                                   | Route `gsel:` callbacks and resolve active group target for `cfg:` / `wizard_` callbacks          |
| `src/chat/discord/index.ts`                                                                        | Continue selector callbacks in Discord and resolve active group target before cfg/wizard handlers |
| `src/config-editor/handlers.ts`                                                                    | Fix back-navigation to delete the correct user-scoped editor session                              |
| `src/commands/help.ts`                                                                             | Update DM and group help copy for DM-only group settings                                          |
| `tests/group-settings/*.test.ts`                                                                   | Unit coverage for registry/access/state/selector logic                                            |
| `tests/commands/*.test.ts`, `tests/chat/*.test.ts`, `tests/db/schema.test.ts`, `tests/bot.test.ts` | Regression coverage for commands, adapters, router, and observation capture                       |

---

### Task 1: Persist known group contexts and admin observations

**Files:**

- Create: `src/db/migrations/020_group_settings_registry.ts`
- Create: `src/group-settings/types.ts`
- Create: `src/group-settings/registry.ts`
- Modify: `src/db/schema.ts`
- Modify: `tests/utils/test-helpers.ts`
- Modify: `tests/db/schema.test.ts`
- Test: `tests/group-settings/registry.test.ts`

- [ ] **Step 1: Write the failing schema and registry tests**

```typescript
// tests/db/schema.test.ts - append after the existing userIdentityMappings tests
import { groupAdminObservations, knownGroupContexts, userIdentityMappings } from '../../src/db/schema.js'

describe('knownGroupContexts', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  it('should expose the expected columns', () => {
    expect(knownGroupContexts.contextId).toBeDefined()
    expect(knownGroupContexts.provider).toBeDefined()
    expect(knownGroupContexts.displayName).toBeDefined()
    expect(knownGroupContexts.parentName).toBeDefined()
    expect(knownGroupContexts.firstSeenAt).toBeDefined()
    expect(knownGroupContexts.lastSeenAt).toBeDefined()
  })
})

describe('groupAdminObservations', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  it('should expose a composite key over contextId and userId', () => {
    expect(groupAdminObservations.contextId).toBeDefined()
    expect(groupAdminObservations.userId).toBeDefined()
    expect(groupAdminObservations.isAdmin).toBeDefined()
    expect(groupAdminObservations.lastSeenAt).toBeDefined()
  })
})
```

```typescript
// tests/group-settings/registry.test.ts
import { beforeEach, describe, expect, test } from 'bun:test'

import {
  getGroupAdminObservation,
  listKnownGroupContexts,
  upsertGroupAdminObservation,
  upsertKnownGroupContext,
} from '../../src/group-settings/registry.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('group-settings registry', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('upserts known group contexts by root context id', () => {
    upsertKnownGroupContext({
      contextId: 'group-1',
      provider: 'telegram',
      displayName: 'Operations',
      parentName: 'Platform',
    })

    const groups = listKnownGroupContexts()
    expect(groups).toHaveLength(1)
    expect(groups[0]?.contextId).toBe('group-1')
    expect(groups[0]?.displayName).toBe('Operations')
    expect(groups[0]?.parentName).toBe('Platform')
  })

  test('stores the latest admin observation per group and user', () => {
    upsertGroupAdminObservation({
      contextId: 'group-1',
      userId: 'user-1',
      username: 'alice',
      isAdmin: true,
    })

    const observation = getGroupAdminObservation('group-1', 'user-1')
    expect(observation?.username).toBe('alice')
    expect(observation?.isAdmin).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
bun test tests/db/schema.test.ts tests/group-settings/registry.test.ts
```

Expected: FAIL with import errors for `knownGroupContexts`, `groupAdminObservations`, and `src/group-settings/registry.ts`.

- [ ] **Step 3: Add the Drizzle tables, SQLite migration, and test-migration wiring**

```typescript
// src/db/schema.ts - add after userIdentityMappings
export const knownGroupContexts = sqliteTable(
  'known_group_contexts',
  {
    contextId: text('context_id').primaryKey(),
    provider: text('provider').notNull(),
    displayName: text('display_name').notNull(),
    parentName: text('parent_name'),
    firstSeenAt: text('first_seen_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
  },
  (table) => [
    index('idx_known_group_contexts_provider').on(table.provider),
    index('idx_known_group_contexts_last_seen').on(table.lastSeenAt),
  ],
)

export const groupAdminObservations = sqliteTable(
  'group_admin_observations',
  {
    contextId: text('context_id').notNull(),
    userId: text('user_id').notNull(),
    username: text('username'),
    isAdmin: integer('is_admin', { mode: 'boolean' }).notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.contextId, table.userId] }),
    index('idx_group_admin_observations_user_admin').on(table.userId, table.isAdmin),
  ],
)

export type KnownGroupContextRow = typeof knownGroupContexts.$inferSelect
export type GroupAdminObservationRow = typeof groupAdminObservations.$inferSelect
```

```typescript
// src/db/migrations/020_group_settings_registry.ts
import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

function createKnownGroupContextsTable(db: Database): void {
  db.run(`
    CREATE TABLE known_group_contexts (
      context_id    TEXT PRIMARY KEY,
      provider      TEXT NOT NULL,
      display_name  TEXT NOT NULL,
      parent_name   TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at  TEXT NOT NULL
    )
  `)
  db.run(`CREATE INDEX idx_known_group_contexts_provider ON known_group_contexts(provider)`)
  db.run(`CREATE INDEX idx_known_group_contexts_last_seen ON known_group_contexts(last_seen_at)`)
}

function createGroupAdminObservationsTable(db: Database): void {
  db.run(`
    CREATE TABLE group_admin_observations (
      context_id   TEXT NOT NULL,
      user_id      TEXT NOT NULL,
      username     TEXT,
      is_admin     INTEGER NOT NULL,
      last_seen_at TEXT NOT NULL,
      PRIMARY KEY (context_id, user_id)
    )
  `)
  db.run(`CREATE INDEX idx_group_admin_observations_user_admin ON group_admin_observations(user_id, is_admin)`)
}

export const migration020GroupSettingsRegistry: Migration = {
  id: '020_group_settings_registry',
  up(db: Database): void {
    createKnownGroupContextsTable(db)
    createGroupAdminObservationsTable(db)
  },
}
```

```typescript
// tests/utils/test-helpers.ts - add one import and append to ALL_MIGRATIONS
import { migration020GroupSettingsRegistry } from '../../src/db/migrations/020_group_settings_registry.js'

const ALL_MIGRATIONS: readonly Migration[] = [
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
]
```

- [ ] **Step 4: Add shared group-settings types and the registry module**

```typescript
// src/group-settings/types.ts
export type KnownGroupContext = {
  contextId: string
  provider: string
  displayName: string
  parentName: string | null
  firstSeenAt: string
  lastSeenAt: string
}

export type GroupAdminObservation = {
  contextId: string
  userId: string
  username: string | null
  isAdmin: boolean
  lastSeenAt: string
}

export type GroupSettingsCommand = 'config' | 'setup'
```

```typescript
// src/group-settings/registry.ts
import { and, eq } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { groupAdminObservations, knownGroupContexts } from '../db/schema.js'
import { logger } from '../logger.js'
import type { GroupAdminObservation, KnownGroupContext } from './types.js'

const log = logger.child({ scope: 'group-settings:registry' })

export function upsertKnownGroupContext(input: {
  contextId: string
  provider: string
  displayName: string
  parentName: string | null
}): void {
  const db = getDrizzleDb()
  const now = new Date().toISOString()

  db.insert(knownGroupContexts)
    .values({
      contextId: input.contextId,
      provider: input.provider,
      displayName: input.displayName,
      parentName: input.parentName,
      firstSeenAt: now,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: knownGroupContexts.contextId,
      set: {
        provider: input.provider,
        displayName: input.displayName,
        parentName: input.parentName,
        lastSeenAt: now,
      },
    })
    .run()

  log.info({ contextId: input.contextId, provider: input.provider }, 'Known group context upserted')
}

export function upsertGroupAdminObservation(input: {
  contextId: string
  userId: string
  username: string | null
  isAdmin: boolean
}): void {
  const db = getDrizzleDb()
  const now = new Date().toISOString()

  db.insert(groupAdminObservations)
    .values({
      contextId: input.contextId,
      userId: input.userId,
      username: input.username,
      isAdmin: input.isAdmin,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: [groupAdminObservations.contextId, groupAdminObservations.userId],
      set: {
        username: input.username,
        isAdmin: input.isAdmin,
        lastSeenAt: now,
      },
    })
    .run()

  log.info(
    { contextId: input.contextId, userId: input.userId, isAdmin: input.isAdmin },
    'Group admin observation upserted',
  )
}

export function listKnownGroupContexts(): KnownGroupContext[] {
  return getDrizzleDb()
    .select()
    .from(knownGroupContexts)
    .all()
    .map((row) => ({
      contextId: row.contextId,
      provider: row.provider,
      displayName: row.displayName,
      parentName: row.parentName ?? null,
      firstSeenAt: row.firstSeenAt,
      lastSeenAt: row.lastSeenAt,
    }))
    .sort((left, right) => left.displayName.localeCompare(right.displayName))
}

export function getGroupAdminObservation(contextId: string, userId: string): GroupAdminObservation | null {
  const row = getDrizzleDb()
    .select()
    .from(groupAdminObservations)
    .where(and(eq(groupAdminObservations.contextId, contextId), eq(groupAdminObservations.userId, userId)))
    .get()

  if (row === undefined) return null

  return {
    contextId: row.contextId,
    userId: row.userId,
    username: row.username ?? null,
    isAdmin: row.isAdmin,
    lastSeenAt: row.lastSeenAt,
  }
}
```

- [ ] **Step 5: Run the tests to verify the persistence layer passes**

```bash
bun test tests/db/schema.test.ts tests/group-settings/registry.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add \
  src/db/schema.ts \
  src/db/migrations/020_group_settings_registry.ts \
  src/group-settings/types.ts \
  src/group-settings/registry.ts \
  tests/utils/test-helpers.ts \
  tests/db/schema.test.ts \
  tests/group-settings/registry.test.ts
git commit -m "feat(group-settings): add registry persistence" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 2: Add human-readable group metadata to incoming messages

**Files:**

- Modify: `src/chat/types.ts`
- Modify: `src/chat/telegram/index.ts`
- Modify: `src/chat/mattermost/schema.ts`
- Modify: `src/chat/mattermost/index.ts`
- Modify: `src/chat/discord/map-message.ts`
- Modify: `tests/chat/types.test.ts`
- Modify: `tests/chat/telegram/index.test.ts`
- Modify: `tests/chat/mattermost/index.test.ts`
- Modify: `tests/chat/discord/map-message.test.ts`

- [ ] **Step 1: Write the failing type and adapter tests**

```typescript
// tests/chat/types.test.ts - append a new describe block
describe('IncomingMessage context metadata', () => {
  test('supports optional contextName and contextParentName fields', () => {
    const message = {
      user: { id: 'u1', username: 'alice', isAdmin: false },
      contextId: 'group-1',
      contextType: 'group' as const,
      contextName: 'Operations',
      contextParentName: 'Platform',
      isMentioned: true,
      text: 'hello',
    }

    expect(message.contextName).toBe('Operations')
    expect(message.contextParentName).toBe('Platform')
  })
})
```

```typescript
// tests/chat/telegram/index.test.ts - add to the existing suite
test('extractMessage includes Telegram chat title for group messages', async () => {
  process.env['TELEGRAM_BOT_TOKEN'] = 'test-token'
  const { TelegramChatProvider } = await import('../../../src/chat/telegram/index.js')
  const provider = new TelegramChatProvider()
  const extractMessage = Reflect.get(provider, 'extractMessage') as (
    ctx: {
      from: { id: number; username?: string }
      chat: { id: number; type: string; title?: string }
      message: { text: string; message_id: number }
    },
    isAdmin: boolean,
  ) => Promise<import('../../../src/chat/types.js').IncomingMessage | null>

  const message = await extractMessage(
    {
      from: { id: 1, username: 'alice' },
      chat: { id: 99, type: 'supergroup', title: 'Operations' },
      message: { text: '/help', message_id: 42 },
    },
    true,
  )

  expect(message?.contextName).toBe('Operations')
})
```

```typescript
// tests/chat/mattermost/index.test.ts - add to the existing suite
import { createMockReply } from '../../utils/test-helpers.js'

test('buildPostedMessage includes channel and team names', async () => {
  process.env['MATTERMOST_URL'] = 'https://mattermost.example.com'
  process.env['MATTERMOST_BOT_TOKEN'] = 'token'
  const { MattermostChatProvider } = await import('../../../src/chat/mattermost/index.js')
  const { reply } = createMockReply()
  const provider = new MattermostChatProvider()

  Reflect.set(provider, 'fetchChannelInfo', async () => ({
    type: 'O',
    display_name: 'Operations',
    name: 'operations',
    team_id: 'team-1',
  }))
  Reflect.set(provider, 'fetchTeamInfo', async () => ({
    display_name: 'Platform',
    name: 'platform',
  }))
  Reflect.set(provider, 'checkChannelAdmin', async () => true)
  Reflect.set(provider, 'buildReplyFn', () => reply)

  const buildPostedMessage = Reflect.get(provider, 'buildPostedMessage') as (
    post: {
      id: string
      user_id: string
      channel_id: string
      message: string
      user_name?: string
      root_id?: string
      parent_id?: string
      file_ids?: string[]
    },
    senderName: string | undefined,
    replyToMessageId: string | undefined,
  ) => Promise<{ msg: import('../../../src/chat/types.js').IncomingMessage }>

  const result = await buildPostedMessage(
    {
      id: 'post-1',
      user_id: 'user-1',
      channel_id: 'chan-1',
      message: '@papai hi',
      user_name: 'alice',
      file_ids: [],
    },
    'alice',
    undefined,
  )

  expect(result.msg.contextName).toBe('Operations')
  expect(result.msg.contextParentName).toBe('Platform')
})
```

```typescript
// tests/chat/discord/map-message.test.ts - add to the existing suite
import { mapDiscordMessage } from '../../../src/chat/discord/map-message.js'

test('maps Discord channel and guild names onto IncomingMessage metadata', () => {
  const mapped = mapDiscordMessage(
    {
      id: 'm1',
      author: { id: 'user-1', username: 'alice', bot: false },
      content: '<@bot-id> /help',
      channel: { id: 'chan-1', type: 0, name: 'operations' },
      guild: { id: 'guild-1', name: 'Platform' },
      mentions: { has: (id: string) => id === 'bot-id' },
      reference: null,
      type: 0,
    },
    'bot-id',
    'admin-id',
  )

  expect(mapped?.contextName).toBe('operations')
  expect(mapped?.contextParentName).toBe('Platform')
})
```

- [ ] **Step 2: Run the adapter tests to verify they fail**

```bash
bun test tests/chat/types.test.ts tests/chat/telegram/index.test.ts tests/chat/mattermost/index.test.ts tests/chat/discord/map-message.test.ts
```

Expected: FAIL because `IncomingMessage` does not expose the new metadata fields and the adapters do not populate them yet.

- [ ] **Step 3: Add the new metadata fields and populate them in each adapter**

```typescript
// src/chat/types.ts - extend IncomingMessage only
export type IncomingMessage = {
  user: ChatUser
  /** storage key: userId in DMs, groupId in groups */
  contextId: string
  contextType: ContextType
  /** Human-readable channel/group name when the adapter knows it */
  contextName?: string
  /** Human-readable workspace/team/guild label when the adapter knows it */
  contextParentName?: string
  /** bot was @mentioned */
  isMentioned: boolean
  text: string
  commandMatch?: string
  /** platform-specific message ID for deletion */
  messageId?: string
  /** parent message ID if this is a reply */
  replyToMessageId?: string
  /** Reply or quote context if this message is a reply */
  replyContext?: ReplyContext
  /** Files attached to this message (populated by platform adapters) */
  files?: IncomingFile[]
  /** Platform thread ID (if in thread) */
  threadId?: string
}
```

```typescript
// src/chat/telegram/index.ts - inside extractMessage()
const contextName = contextType === 'group' ? ctx.chat?.title : undefined

return {
  user: { id: String(id), username: ctx.from?.username ?? null, isAdmin },
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

```typescript
// src/chat/mattermost/schema.ts
export const ChannelInfoSchema = z.object({
  type: z.string(),
  display_name: z.string().optional(),
  name: z.string().optional(),
  team_id: z.string().optional(),
})

export const TeamInfoSchema = z.object({
  display_name: z.string().optional(),
  name: z.string().optional(),
})
```

```typescript
// src/chat/mattermost/index.ts - add a helper and use it in buildPostedMessage()
private async fetchTeamInfo(teamId: string): Promise<{ display_name?: string; name?: string } | null> {
  try {
    const data = await this.apiFetch('GET', `/api/v4/teams/${teamId}`, undefined)
    const parsed = TeamInfoSchema.safeParse(data)
    if (!parsed.success) {
      log.warn({ teamId, error: parsed.error }, 'Failed to parse team info')
      return null
    }
    return parsed.data
  } catch (error) {
    log.warn({ teamId, error: error instanceof Error ? error.message : String(error) }, 'Failed to fetch team info')
    return null
  }
}

private async buildPostedMessage(
  post: MattermostPost,
  senderName: string | undefined,
  replyToMessageId: string | undefined,
): Promise<{
  msg: IncomingMessage
  reply: ReplyFn
  command: { handler: CommandHandler; match: string } | null
  isAdmin: boolean
}> {
  const replyContext =
    replyToMessageId === undefined
      ? undefined
      : await buildMattermostReplyContext(post, replyToMessageId, this.apiFetch.bind(this))
  const channelInfo = await this.fetchChannelInfo(post.channel_id)
  const contextType: ContextType = channelInfo.type === 'D' ? 'dm' : 'group'
  const teamInfo =
    contextType === 'group' && channelInfo.team_id !== undefined
      ? await this.fetchTeamInfo(channelInfo.team_id)
      : null
  const isAdmin = await this.checkChannelAdmin(post.channel_id, post.user_id)
  const threadId = post.root_id === undefined || post.root_id === '' ? replyToMessageId : post.root_id
  const reply = this.buildReplyFn(post.channel_id, post.id, threadId)
  const command = this.matchCommand(post.message)
  const username = post.user_name ?? senderName ?? null
  const contextName = contextType === 'group' ? channelInfo.display_name ?? channelInfo.name ?? post.channel_id : undefined
  const contextParentName = contextType === 'group' ? teamInfo?.display_name ?? teamInfo?.name : undefined

  const files =
    post.file_ids !== undefined && post.file_ids.length > 0
      ? await fetchMattermostFiles(post.file_ids, this.apiFetch.bind(this), (fileId) =>
          downloadMattermostFile(this.baseUrl, this.token, fileId),
        )
      : undefined

  const msg: IncomingMessage = {
    user: { id: post.user_id, username, isAdmin },
    contextId: post.channel_id,
    contextType,
    contextName,
    contextParentName,
    isMentioned: this.isBotMentioned(post.message),
    text: post.message,
    commandMatch: command?.match,
    messageId: post.id,
    replyToMessageId,
    replyContext,
    ...(files !== undefined && files.length > 0 ? { files } : {}),
  }
  return { msg, reply, command, isAdmin }
}
```

```typescript
// src/chat/discord/map-message.ts - widen the structural type and map the metadata
export type DiscordMessageLike = {
  id: string
  author: { id: string; username: string; bot: boolean }
  content: string
  channel: { id: string; type: number; name?: string }
  guild?: { id: string; name: string } | null
  mentions: { has: (id: string) => boolean }
  reference: { messageId?: string } | null
  type: number
}

export function mapDiscordMessage(
  message: DiscordMessageLike,
  botId: string,
  adminUserId: string,
): IncomingMessage | null {
  if (message.author.bot) {
    log.debug({ messageId: message.id, authorId: message.author.id }, 'Skipping bot-authored message')
    return null
  }
  if (!ACCEPTED_MESSAGE_TYPES.has(message.type)) {
    log.debug({ messageId: message.id, type: message.type }, 'Skipping unsupported message type')
    return null
  }

  const contextType: ContextType = message.channel.type === CHANNEL_TYPE_DM ? 'dm' : 'group'
  const contextId = contextType === 'dm' ? message.author.id : message.channel.id
  const mentioned = isBotMentioned(message.content, botId, contextType)

  if (contextType === 'group' && !mentioned) {
    return null
  }

  const text = stripBotMention(message.content, botId)
  const contextName = contextType === 'group' ? message.channel.name : undefined
  const contextParentName = contextType === 'group' ? (message.guild?.name ?? undefined) : undefined

  return {
    user: {
      id: message.author.id,
      username: message.author.username.length > 0 ? message.author.username : null,
      isAdmin: message.author.id === adminUserId,
    },
    contextId,
    contextType,
    contextName,
    contextParentName,
    isMentioned: mentioned,
    text,
    messageId: message.id,
    replyToMessageId: message.reference?.messageId,
  }
}
```

- [ ] **Step 4: Run the adapter tests to verify they pass**

```bash
bun test tests/chat/types.test.ts tests/chat/telegram/index.test.ts tests/chat/mattermost/index.test.ts tests/chat/discord/map-message.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add \
  src/chat/types.ts \
  src/chat/telegram/index.ts \
  src/chat/mattermost/schema.ts \
  src/chat/mattermost/index.ts \
  src/chat/discord/map-message.ts \
  tests/chat/types.test.ts \
  tests/chat/telegram/index.test.ts \
  tests/chat/mattermost/index.test.ts \
  tests/chat/discord/map-message.test.ts
git commit -m "feat(chat): capture group display metadata" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 3: Record group observations and implement group-settings access checks

**Files:**

- Create: `src/group-settings/access.ts`
- Modify: `src/bot.ts`
- Test: `tests/group-settings/access.test.ts`
- Modify: `tests/bot.test.ts`

- [ ] **Step 1: Write the failing access and observation-capture tests**

```typescript
// tests/group-settings/access.test.ts
import { beforeEach, describe, expect, test } from 'bun:test'

import { canManageGroupSettings, listManageableGroups, matchManageableGroup } from '../../src/group-settings/access.js'
import { upsertGroupAdminObservation, upsertKnownGroupContext } from '../../src/group-settings/registry.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('group settings access', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('lists only groups where the user is a known admin', () => {
    upsertKnownGroupContext({
      contextId: 'group-1',
      provider: 'telegram',
      displayName: 'Operations',
      parentName: 'Platform',
    })
    upsertKnownGroupContext({
      contextId: 'group-2',
      provider: 'telegram',
      displayName: 'Security',
      parentName: 'Platform',
    })
    upsertGroupAdminObservation({
      contextId: 'group-1',
      userId: 'user-1',
      username: 'alice',
      isAdmin: true,
    })
    upsertGroupAdminObservation({
      contextId: 'group-2',
      userId: 'user-1',
      username: 'alice',
      isAdmin: false,
    })

    expect(listManageableGroups('user-1').map((group) => group.contextId)).toEqual(['group-1'])
    expect(canManageGroupSettings('user-1', 'group-1')).toBe(true)
    expect(canManageGroupSettings('user-1', 'group-2')).toBe(false)
  })

  test('matches by context id and display name and reports ambiguity', () => {
    upsertKnownGroupContext({
      contextId: 'group-1',
      provider: 'telegram',
      displayName: 'Operations',
      parentName: 'Platform',
    })
    upsertKnownGroupContext({
      contextId: 'group-2',
      provider: 'telegram',
      displayName: 'Operations Europe',
      parentName: 'Platform',
    })
    upsertGroupAdminObservation({
      contextId: 'group-1',
      userId: 'user-1',
      username: 'alice',
      isAdmin: true,
    })
    upsertGroupAdminObservation({
      contextId: 'group-2',
      userId: 'user-1',
      username: 'alice',
      isAdmin: true,
    })

    expect(matchManageableGroup('user-1', 'group-1')).toEqual({
      kind: 'match',
      group: expect.objectContaining({ contextId: 'group-1' }),
    })
    expect(matchManageableGroup('user-1', 'operations')).toEqual({
      kind: 'ambiguous',
      matches: expect.arrayContaining([
        expect.objectContaining({ contextId: 'group-1' }),
        expect.objectContaining({ contextId: 'group-2' }),
      ]),
    })
  })
})
```

```typescript
// tests/bot.test.ts - append under the setupBot describe block
import { and, eq } from 'drizzle-orm'

import { getDrizzleDb } from '../src/db/drizzle.js'
import { groupAdminObservations, knownGroupContexts } from '../src/db/schema.js'
import { createGroupMessage } from './utils/test-helpers.js'

test('records known group and admin observations before normal message handling', async () => {
  addUser('group-admin', ADMIN_ID)
  setupUserConfig('group-admin')

  const messageHandler = getMessageHandler()
  expect(messageHandler).not.toBeNull()

  const groupMessage = createGroupMessage('group-admin', '@bot status', true, 'group-ops')
  groupMessage.contextName = 'Operations'
  groupMessage.contextParentName = 'Platform'
  groupMessage.threadId = 'thread-1'

  const { reply } = createMockReply()
  await messageHandler!(groupMessage, reply)

  const db = getDrizzleDb()
  const knownGroup = db.select().from(knownGroupContexts).where(eq(knownGroupContexts.contextId, 'group-ops')).get()
  const adminObservation = db
    .select()
    .from(groupAdminObservations)
    .where(and(eq(groupAdminObservations.contextId, 'group-ops'), eq(groupAdminObservations.userId, 'group-admin')))
    .get()

  expect(knownGroup?.displayName).toBe('Operations')
  expect(knownGroup?.parentName).toBe('Platform')
  expect(adminObservation?.isAdmin).toBe(true)
})
```

- [ ] **Step 2: Run the access and bot tests to verify they fail**

```bash
bun test tests/group-settings/access.test.ts tests/bot.test.ts
```

Expected: FAIL because `src/group-settings/access.ts` does not exist and `bot.ts` is not recording group observations.

- [ ] **Step 3: Implement `canManageGroupSettings`, manageable-group listing, and freeform matching**

```typescript
// src/group-settings/access.ts
import { and, eq } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { groupAdminObservations, knownGroupContexts } from '../db/schema.js'
import { logger } from '../logger.js'
import type { KnownGroupContext } from './types.js'

const log = logger.child({ scope: 'group-settings:access' })

export type GroupMatchResult =
  | { kind: 'match'; group: KnownGroupContext }
  | { kind: 'ambiguous'; matches: KnownGroupContext[] }
  | { kind: 'not_found' }

export function canManageGroupSettings(userId: string, groupId: string): boolean {
  const row = getDrizzleDb()
    .select()
    .from(groupAdminObservations)
    .where(and(eq(groupAdminObservations.contextId, groupId), eq(groupAdminObservations.userId, userId)))
    .get()

  const allowed = row?.isAdmin === true
  log.debug({ userId, groupId, allowed }, 'Evaluated group settings access')
  return allowed
}

export function listManageableGroups(userId: string): KnownGroupContext[] {
  const db = getDrizzleDb()
  const adminRows = db
    .select()
    .from(groupAdminObservations)
    .where(and(eq(groupAdminObservations.userId, userId), eq(groupAdminObservations.isAdmin, true)))
    .all()

  const groups = adminRows
    .map((row) => db.select().from(knownGroupContexts).where(eq(knownGroupContexts.contextId, row.contextId)).get())
    .filter((row): row is typeof knownGroupContexts.$inferSelect => row !== undefined)
    .map((row) => ({
      contextId: row.contextId,
      provider: row.provider,
      displayName: row.displayName,
      parentName: row.parentName ?? null,
      firstSeenAt: row.firstSeenAt,
      lastSeenAt: row.lastSeenAt,
    }))
    .sort((left, right) => left.displayName.localeCompare(right.displayName))

  log.debug({ userId, groupCount: groups.length }, 'Listed manageable groups')
  return groups
}

export function matchManageableGroup(userId: string, query: string): GroupMatchResult {
  const normalized = query.trim().toLowerCase()
  if (normalized.length === 0) return { kind: 'not_found' }

  const groups = listManageableGroups(userId)
  const exactId = groups.find((group) => group.contextId.toLowerCase() === normalized)
  if (exactId !== undefined) {
    return { kind: 'match', group: exactId }
  }

  const matches = groups.filter((group) => {
    const candidates = [
      group.displayName,
      group.parentName ?? '',
      group.parentName === null ? group.displayName : `${group.parentName} / ${group.displayName}`,
    ]
    return candidates.some((candidate) => candidate.toLowerCase().includes(normalized))
  })

  if (matches.length === 1) {
    return { kind: 'match', group: matches[0]! }
  }
  if (matches.length > 1) {
    return { kind: 'ambiguous', matches }
  }
  return { kind: 'not_found' }
}
```

- [ ] **Step 4: Record group observations in `src/bot.ts` before any selector/editor/wizard logic runs**

```typescript
// src/bot.ts - add imports
import { upsertGroupAdminObservation, upsertKnownGroupContext } from './group-settings/registry.js'
```

```typescript
// src/bot.ts - add helper above onIncomingMessage()
function recordGroupObservation(chat: ChatProvider, msg: IncomingMessage): void {
  if (msg.contextType !== 'group') return

  upsertKnownGroupContext({
    contextId: msg.contextId,
    provider: chat.name,
    displayName: msg.contextName ?? msg.contextId,
    parentName: msg.contextParentName ?? null,
  })
  upsertGroupAdminObservation({
    contextId: msg.contextId,
    userId: msg.user.id,
    username: msg.user.username,
    isAdmin: msg.user.isAdmin,
  })
}
```

```typescript
// src/bot.ts - call the helper at the top of onIncomingMessage()
async function onIncomingMessage(
  chat: ChatProvider,
  msg: IncomingMessage,
  reply: ReplyFn,
  deps: BotDeps,
): Promise<void> {
  emit('message:received', {
    userId: msg.user.id,
    contextId: msg.contextId,
    contextType: msg.contextType,
    threadId: msg.threadId,
    textLength: msg.text.length,
    isCommand: msg.text.startsWith('/'),
  })

  recordGroupObservation(chat, msg)

  const auth = checkAuthorizationExtended(
    msg.user.id,
    msg.user.username,
    msg.contextId,
    msg.contextType,
    msg.threadId,
    msg.user.isAdmin,
  )
  // ... keep the rest of the function as-is for now
}
```

- [ ] **Step 5: Run the access and bot tests to verify they pass**

```bash
bun test tests/group-settings/access.test.ts tests/bot.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add \
  src/group-settings/access.ts \
  src/bot.ts \
  tests/group-settings/access.test.ts \
  tests/bot.test.ts
git commit -m "feat(group-settings): add access checks and observations" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 4: Build the DM group-settings selector state machine

**Files:**

- Create: `src/group-settings/state.ts`
- Create: `src/group-settings/selector.ts`
- Modify: `src/group-settings/types.ts`
- Test: `tests/group-settings/state.test.ts`
- Test: `tests/group-settings/selector.test.ts`

- [ ] **Step 1: Write the failing state and selector tests**

```typescript
// tests/group-settings/state.test.ts
import { beforeEach, describe, expect, test } from 'bun:test'

import {
  cleanupExpiredGroupSettingsSessions,
  createGroupSettingsSession,
  deleteGroupSettingsSession,
  getActiveGroupSettingsTarget,
  getGroupSettingsSession,
  updateGroupSettingsSession,
} from '../../src/group-settings/state.js'

describe('group settings state', () => {
  beforeEach(() => {
    deleteGroupSettingsSession('user-1')
  })

  test('stores one selector session per DM user and exposes active group target only in active stage', () => {
    createGroupSettingsSession({ userId: 'user-1', command: 'config', stage: 'choose_scope' })
    expect(getActiveGroupSettingsTarget('user-1')).toBeNull()

    updateGroupSettingsSession('user-1', { stage: 'active', targetContextId: 'group-1' })
    expect(getGroupSettingsSession('user-1')?.targetContextId).toBe('group-1')
    expect(getActiveGroupSettingsTarget('user-1')).toBe('group-1')
  })

  test('expires selector sessions after the 30 minute TTL', () => {
    const session = createGroupSettingsSession({
      userId: 'user-1',
      command: 'config',
      stage: 'choose_scope',
    })
    session.startedAt = new Date(Date.now() - 31 * 60 * 1000)

    cleanupExpiredGroupSettingsSessions()

    expect(getGroupSettingsSession('user-1')).toBeNull()
  })
})
```

```typescript
// tests/group-settings/selector.test.ts
import { beforeEach, describe, expect, test } from 'bun:test'

import {
  handleGroupSettingsSelectorCallback,
  handleGroupSettingsSelectorMessage,
  startGroupSettingsSelection,
} from '../../src/group-settings/selector.js'
import { deleteGroupSettingsSession, getActiveGroupSettingsTarget } from '../../src/group-settings/state.js'
import { upsertGroupAdminObservation, upsertKnownGroupContext } from '../../src/group-settings/registry.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('group settings selector', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    deleteGroupSettingsSession('user-1')
  })

  test('starts with a personal/group scope picker', () => {
    const result = startGroupSettingsSelection('user-1', 'config', true)

    expect(result).toEqual({
      handled: true,
      response: expect.stringContaining('What do you want to configure?'),
      buttons: expect.arrayContaining([
        expect.objectContaining({ callbackData: 'gsel:scope:personal' }),
        expect.objectContaining({ callbackData: 'gsel:scope:group' }),
      ]),
    })
  })

  test('returns the DM user id when personal settings are selected', () => {
    startGroupSettingsSelection('user-1', 'config', true)
    const result = handleGroupSettingsSelectorCallback('user-1', 'gsel:scope:personal')

    expect(result).toEqual({
      handled: true,
      continueWith: { command: 'config', targetContextId: 'user-1' },
    })
    expect(getActiveGroupSettingsTarget('user-1')).toBeNull()
  })

  test('returns guidance when the user has no known manageable groups', () => {
    startGroupSettingsSelection('user-1', 'config', false)
    const result = handleGroupSettingsSelectorMessage('user-1', 'group', false)

    expect(result).toEqual({
      handled: true,
      response: expect.stringContaining("I don't know any groups where you're an admin yet."),
    })
  })

  test('returns a continuation when the user selects a manageable group', () => {
    upsertKnownGroupContext({
      contextId: 'group-1',
      provider: 'telegram',
      displayName: 'Operations',
      parentName: 'Platform',
    })
    upsertGroupAdminObservation({
      contextId: 'group-1',
      userId: 'user-1',
      username: 'alice',
      isAdmin: true,
    })

    startGroupSettingsSelection('user-1', 'config', true)
    handleGroupSettingsSelectorCallback('user-1', 'gsel:scope:group')
    const result = handleGroupSettingsSelectorMessage('user-1', 'Operations', true)

    expect(result).toEqual({
      handled: true,
      continueWith: { command: 'config', targetContextId: 'group-1' },
    })
    expect(getActiveGroupSettingsTarget('user-1')).toBe('group-1')
  })
})
```

- [ ] **Step 2: Run the selector tests to verify they fail**

```bash
bun test tests/group-settings/state.test.ts tests/group-settings/selector.test.ts
```

Expected: FAIL because `src/group-settings/state.ts` and `src/group-settings/selector.ts` do not exist.

- [ ] **Step 3: Add the in-memory DM selector session store**

```typescript
// src/group-settings/types.ts - extend the file from Task 1
export type GroupSettingsSessionStage = 'choose_scope' | 'choose_group' | 'active'

export type GroupSettingsSession = {
  userId: string
  command: GroupSettingsCommand
  stage: GroupSettingsSessionStage
  startedAt: Date
  targetContextId?: string
}

export type GroupSettingsSelectorResult =
  | { handled: false }
  | { handled: true; response: string; buttons?: import('../chat/types.js').ChatButton[] }
  | { handled: true; continueWith: { command: GroupSettingsCommand; targetContextId: string } }
```

```typescript
// src/group-settings/state.ts
import { logger } from '../logger.js'
import type { GroupSettingsCommand, GroupSettingsSession, GroupSettingsSessionStage } from './types.js'

const log = logger.child({ scope: 'group-settings:state' })
const GROUP_SETTINGS_SESSION_TTL_MS = 30 * 60 * 1000
const activeSessions = new Map<string, GroupSettingsSession>()

export function createGroupSettingsSession(params: {
  userId: string
  command: GroupSettingsCommand
  stage: GroupSettingsSessionStage
  targetContextId?: string
}): GroupSettingsSession {
  const session: GroupSettingsSession = {
    userId: params.userId,
    command: params.command,
    stage: params.stage,
    startedAt: new Date(),
    targetContextId: params.targetContextId,
  }
  activeSessions.set(params.userId, session)
  log.info({ userId: params.userId, command: params.command, stage: params.stage }, 'Created group settings session')
  return session
}

export function getGroupSettingsSession(userId: string): GroupSettingsSession | null {
  const session = activeSessions.get(userId)
  if (session === undefined) return null
  if (Date.now() - session.startedAt.getTime() > GROUP_SETTINGS_SESSION_TTL_MS) {
    activeSessions.delete(userId)
    log.info({ userId }, 'Expired group settings session')
    return null
  }
  return session
}

export function updateGroupSettingsSession(
  userId: string,
  update: { stage?: GroupSettingsSessionStage; targetContextId?: string },
): GroupSettingsSession | null {
  const session = getGroupSettingsSession(userId)
  if (session === null) return null
  if (update.stage !== undefined) session.stage = update.stage
  if (update.targetContextId !== undefined) session.targetContextId = update.targetContextId
  log.info({ userId, stage: session.stage, targetContextId: session.targetContextId }, 'Updated group settings session')
  return session
}

export function deleteGroupSettingsSession(userId: string): boolean {
  const existed = activeSessions.delete(userId)
  if (existed) log.info({ userId }, 'Deleted group settings session')
  return existed
}

export function getActiveGroupSettingsTarget(userId: string): string | null {
  const session = getGroupSettingsSession(userId)
  if (session === null || session.stage !== 'active') return null
  return session.targetContextId ?? null
}

export function cleanupExpiredGroupSettingsSessions(): void {
  for (const [userId, session] of activeSessions.entries()) {
    if (Date.now() - session.startedAt.getTime() > GROUP_SETTINGS_SESSION_TTL_MS) {
      activeSessions.delete(userId)
      log.info({ userId }, 'Cleaned up expired group settings session')
    }
  }
}
```

- [ ] **Step 4: Add the selector orchestration module**

```typescript
// src/group-settings/selector.ts
import type { ChatButton } from '../chat/types.js'
import { logger } from '../logger.js'
import { listManageableGroups, matchManageableGroup } from './access.js'
import {
  createGroupSettingsSession,
  deleteGroupSettingsSession,
  getGroupSettingsSession,
  updateGroupSettingsSession,
} from './state.js'
import type { GroupSettingsCommand, GroupSettingsSelectorResult } from './types.js'

const log = logger.child({ scope: 'group-settings:selector' })
const GROUP_BUTTON_LIMIT = 10

function serializeGroupSettingsCallbackData(data: {
  action: 'scope' | 'group' | 'cancel'
  value?: 'personal' | 'group' | string
}): string {
  if (data.action === 'cancel') return 'gsel:cancel'
  if (data.action === 'scope' && data.value !== undefined) return `gsel:scope:${data.value}`
  if (data.action === 'group' && data.value !== undefined) return `gsel:group:${data.value}`
  return 'gsel:cancel'
}

function buildGroupButtons(groups: ReturnType<typeof listManageableGroups>): ChatButton[] {
  return groups.slice(0, GROUP_BUTTON_LIMIT).map((group) => ({
    text: group.parentName === null ? group.displayName : `${group.parentName} / ${group.displayName}`,
    callbackData: serializeGroupSettingsCallbackData({ action: 'group', value: group.contextId }),
    style: 'primary',
  }))
}

function buildScopeResponse(interactiveButtons: boolean): GroupSettingsSelectorResult {
  const buttons: ChatButton[] = [
    {
      text: '👤 Personal settings',
      callbackData: serializeGroupSettingsCallbackData({ action: 'scope', value: 'personal' }),
      style: 'primary',
    },
    {
      text: '👥 Group settings',
      callbackData: serializeGroupSettingsCallbackData({ action: 'scope', value: 'group' }),
      style: 'secondary',
    },
    {
      text: '❌ Cancel',
      callbackData: serializeGroupSettingsCallbackData({ action: 'cancel' }),
      style: 'danger',
    },
  ]

  return {
    handled: true,
    response: 'What do you want to configure?\n\nChoose personal settings or pick a group to manage from DM.',
    ...(interactiveButtons ? { buttons } : {}),
  }
}

function buildGroupResponse(userId: string, interactiveButtons: boolean): GroupSettingsSelectorResult {
  const groups = listManageableGroups(userId)
  if (groups.length === 0) {
    deleteGroupSettingsSession(userId)
    return {
      handled: true,
      response:
        "I don't know any groups where you're an admin yet.\n\nUse the bot in the target group first, then retry this command in DM.",
    }
  }

  const lines = [
    'Choose a group to configure.',
    '',
    ...groups.map((group) =>
      group.parentName === null
        ? `• ${group.displayName} — ${group.contextId}`
        : `• ${group.parentName} / ${group.displayName} — ${group.contextId}`,
    ),
    '',
    'Reply with the group name or context ID if you do not want to tap a button.',
  ]

  return {
    handled: true,
    response: lines.join('\n'),
    ...(interactiveButtons
      ? {
          buttons: [
            ...buildGroupButtons(groups),
            {
              text: '❌ Cancel',
              callbackData: serializeGroupSettingsCallbackData({ action: 'cancel' }),
              style: 'danger',
            },
          ],
        }
      : {}),
  }
}

export function startGroupSettingsSelection(
  userId: string,
  command: GroupSettingsCommand,
  interactiveButtons: boolean,
): GroupSettingsSelectorResult {
  createGroupSettingsSession({ userId, command, stage: 'choose_scope' })
  return buildScopeResponse(interactiveButtons)
}

export function handleGroupSettingsSelectorCallback(userId: string, callbackData: string): GroupSettingsSelectorResult {
  const session = getGroupSettingsSession(userId)
  if (session === null || !callbackData.startsWith('gsel:')) return { handled: false }

  if (callbackData === 'gsel:cancel') {
    deleteGroupSettingsSession(userId)
    return { handled: true, response: 'Cancelled group settings selection.' }
  }

  if (callbackData === 'gsel:scope:personal') {
    deleteGroupSettingsSession(userId)
    return { handled: true, continueWith: { command: session.command, targetContextId: userId } }
  }

  if (callbackData === 'gsel:scope:group') {
    updateGroupSettingsSession(userId, { stage: 'choose_group' })
    return buildGroupResponse(userId, true)
  }

  if (callbackData.startsWith('gsel:group:')) {
    const groupId = callbackData.slice('gsel:group:'.length)
    const match = matchManageableGroup(userId, groupId)
    if (match.kind !== 'match') {
      return {
        handled: true,
        response: 'That group is no longer available. Run /config or /setup again.',
      }
    }
    updateGroupSettingsSession(userId, { stage: 'active', targetContextId: match.group.contextId })
    log.info(
      { userId, command: session.command, targetContextId: match.group.contextId },
      'Selected group settings target from callback',
    )
    return {
      handled: true,
      continueWith: { command: session.command, targetContextId: match.group.contextId },
    }
  }

  return { handled: false }
}

export function handleGroupSettingsSelectorMessage(
  userId: string,
  text: string,
  interactiveButtons: boolean,
): GroupSettingsSelectorResult {
  const session = getGroupSettingsSession(userId)
  if (session === null) return { handled: false }

  const normalized = text.trim().toLowerCase()
  if (session.stage === 'choose_scope') {
    if (normalized === 'personal' || normalized === 'personal settings') {
      deleteGroupSettingsSession(userId)
      return { handled: true, continueWith: { command: session.command, targetContextId: userId } }
    }
    if (normalized === 'group' || normalized === 'group settings') {
      updateGroupSettingsSession(userId, { stage: 'choose_group' })
      return buildGroupResponse(userId, interactiveButtons)
    }
    return { handled: true, response: 'Reply with "personal" or "group".' }
  }

  if (session.stage === 'choose_group') {
    const match = matchManageableGroup(userId, text)
    if (match.kind === 'match') {
      updateGroupSettingsSession(userId, {
        stage: 'active',
        targetContextId: match.group.contextId,
      })
      log.info(
        { userId, command: session.command, targetContextId: match.group.contextId },
        'Selected group settings target from text',
      )
      return {
        handled: true,
        continueWith: { command: session.command, targetContextId: match.group.contextId },
      }
    }
    if (match.kind === 'ambiguous') {
      return {
        handled: true,
        response: [
          'That matches more than one group. Reply with the exact group name or context ID:',
          '',
          ...match.matches.map((group) =>
            group.parentName === null
              ? `• ${group.displayName} — ${group.contextId}`
              : `• ${group.parentName} / ${group.displayName} — ${group.contextId}`,
          ),
        ].join('\n'),
      }
    }
    return {
      handled: true,
      response:
        'No manageable group matched that value. Reply with the exact group name or context ID from the list above.',
    }
  }

  return { handled: false }
}
```

- [ ] **Step 5: Run the selector tests to verify they pass**

```bash
bun test tests/group-settings/state.test.ts tests/group-settings/selector.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add \
  src/group-settings/types.ts \
  src/group-settings/state.ts \
  src/group-settings/selector.ts \
  tests/group-settings/state.test.ts \
  tests/group-settings/selector.test.ts
git commit -m "feat(group-settings): add DM selector state machine" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 5: Route `/config` through the DM selector and resolve the active target context

**Files:**

- Modify: `src/commands/config.ts`
- Modify: `src/bot.ts`
- Modify: `src/chat/interaction-router.ts`
- Modify: `src/chat/discord/index.ts`
- Modify: `src/config-editor/handlers.ts`
- Modify: `tests/commands/config.test.ts`
- Modify: `tests/commands/restrictions.test.ts`
- Modify: `tests/chat/interaction-router.test.ts`
- Modify: `tests/chat/discord/index.test.ts`
- Test: `tests/config-editor/handlers.test.ts`

- [ ] **Step 1: Write the failing `/config` flow and callback-target tests**

```typescript
// tests/commands/config.test.ts - add to the DM describe block
test('starts with a personal/group selector in DM', async () => {
  expect(configHandler).not.toBeNull()
  const { reply, buttonCalls } = createMockReply()

  await configHandler!(createDmMessage(USER_ID), reply, createAuth(USER_ID, true))

  expect(buttonCalls[0]).toContain('Personal settings')
  expect(buttonCalls[0]).toContain('Group settings')
})
```

```typescript
// tests/commands/restrictions.test.ts - replace the existing /config group assertions
test('non-admin in group gets the DM-only admin restriction', async () => {
  const handler = commandHandlers.get('config')
  expect(handler).toBeDefined()

  const msg = createGroupMessage('user456', '', false, 'group1')
  const auth = createAuth('user456')
  const { reply, textCalls } = createMockReply()

  await handler!(msg, reply, auth)

  expect(textCalls[0]).toBe(
    'Only group admins can configure group settings, and group settings are configured in direct messages with the bot.',
  )
})

test('group admin in group gets a DM-only redirect', async () => {
  const handler = commandHandlers.get('config')
  expect(handler).toBeDefined()

  const msg = createGroupMessage('user456', '', true, 'group1')
  const auth = createAuth('user456', { isGroupAdmin: true })
  const { reply, textCalls } = createMockReply()

  await handler!(msg, reply, auth)

  expect(textCalls[0]).toBe(
    'Group settings are configured in direct messages with the bot. Open a DM with me and run /config.',
  )
})
```

```typescript
// tests/chat/interaction-router.test.ts - add a real router test
import { createEditorSession, deleteEditorSession } from '../../src/config-editor/state.js'
import { getConfig } from '../../src/config.js'
import { handleEditorMessage } from '../../src/config-editor/handlers.js'
import { createGroupSettingsSession, deleteGroupSettingsSession } from '../../src/group-settings/state.js'

// Update the existing dependency-based router tests in this file to add:
// handleGroupSettingsInteraction: () => Promise.resolve(false)

test('uses the active group target for cfg callbacks received in DM', async () => {
  createGroupSettingsSession({
    userId: interaction.user.id,
    command: 'config',
    stage: 'active',
    targetContextId: 'group-9',
  })
  createEditorSession({
    userId: interaction.user.id,
    storageContextId: 'group-9',
    editingKey: 'timezone',
  })

  const replies: string[] = []
  const handled = await routeInteraction(
    { ...interaction, callbackData: 'cfg:cancel' },
    {
      ...reply,
      text: (content: string): Promise<void> => {
        replies.push(content)
        return Promise.resolve()
      },
    },
  )

  expect(handled).toBe(true)
  expect(replies[0]).toContain('Changes cancelled')

  deleteEditorSession(interaction.user.id, 'group-9')
  deleteGroupSettingsSession(interaction.user.id)
})

test('saves edited config into the selected group context instead of the DM user context', async () => {
  createGroupSettingsSession({
    userId: interaction.user.id,
    command: 'config',
    stage: 'active',
    targetContextId: 'group-9',
  })
  createEditorSession({
    userId: interaction.user.id,
    storageContextId: 'group-9',
    editingKey: 'timezone',
  })
  handleEditorMessage(interaction.user.id, 'group-9', 'Europe/Berlin')

  await routeInteraction({ ...interaction, callbackData: 'cfg:save:timezone' }, reply)

  expect(getConfig('group-9', 'timezone')).toBe('Europe/Berlin')
  expect(getConfig(interaction.user.id, 'timezone')).toBeNull()

  deleteGroupSettingsSession(interaction.user.id)
})
```

```typescript
// tests/chat/discord/index.test.ts - add a selector callback test
import { upsertGroupAdminObservation, upsertKnownGroupContext } from '../../../src/group-settings/registry.js'
import { startGroupSettingsSelection } from '../../../src/group-settings/selector.js'

test('Discord DM group-settings callback opens config for the selected group', async () => {
  const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
  const provider = new DiscordChatProvider()
  await setupTestDb()

  upsertKnownGroupContext({
    contextId: 'group-1',
    provider: 'discord',
    displayName: 'Operations',
    parentName: 'Platform',
  })
  upsertGroupAdminObservation({
    contextId: 'group-1',
    userId: 'user-1',
    username: 'alice',
    isAdmin: true,
  })
  startGroupSettingsSelection('user-1', 'config', true)

  const sends: Array<{ content?: string }> = []
  const interaction: ButtonInteractionLike = {
    user: { id: 'user-1', username: 'alice' },
    customId: 'gsel:scope:group',
    channelId: 'dm-1',
    channel: {
      id: 'dm-1',
      type: 1,
      send: (arg: { content?: string }): Promise<{ id: string; edit: () => Promise<void> }> => {
        sends.push(arg)
        return Promise.resolve({ id: 'out-1', edit: (): Promise<void> => Promise.resolve() })
      },
      sendTyping: (): Promise<void> => Promise.resolve(),
    },
    message: { id: 'm-1' },
    deferUpdate: (): Promise<void> => Promise.resolve(),
  }

  await provider.testDispatchButtonInteraction(interaction, 'bot-id', 'admin-id')

  expect(sends[0]?.content).toContain('Choose a group to configure.')
})
```

```typescript
// tests/config-editor/handlers.test.ts - create if this file does not exist yet
import { beforeEach, describe, expect, test } from 'bun:test'

import { handleEditorCallback, startEditor } from '../../src/config-editor/handlers.js'
import { getEditorSession } from '../../src/config-editor/state.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('config-editor back action', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('back removes the active session for the current user and target context', () => {
    startEditor('user-1', 'group-1', 'timezone')
    const result = handleEditorCallback('user-1', 'group-1', 'back')

    expect(result.handled).toBe(true)
    expect(getEditorSession('user-1', 'group-1')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the `/config` tests to verify they fail**

```bash
bun test tests/commands/config.test.ts tests/commands/restrictions.test.ts tests/chat/interaction-router.test.ts tests/chat/discord/index.test.ts tests/config-editor/handlers.test.ts
```

Expected: FAIL because `/config` still renders immediately in DM, still works in groups, and callback routing still uses the DM context ID.

- [ ] **Step 3: Export a target-aware config renderer and make `/config` DM-only for groups**

```typescript
// src/commands/config.ts - add helper above registerConfigCommand()
export async function renderConfigForTarget(
  reply: import('../chat/types.js').ReplyFn,
  targetContextId: string,
  interactiveButtons: boolean,
): Promise<void> {
  const config = getAllConfig(targetContextId)
  const lines = ['⚙️ **Current Configuration**\n']

  for (const key of CONFIG_KEYS) {
    lines.push(formatConfigLine(key, config[key]))
  }

  if (!interactiveButtons) {
    lines.push('\n⚠️ Interactive editing is not available in this chat. Use `/setup` to configure everything.')
    await reply.text(lines.join('\n'))
    return
  }

  lines.push('\n💡 Click a field below to edit it, or use `/setup` to configure everything.')
  await reply.buttons(lines.join('\n'), { buttons: buildConfigButtons(config) })
}
```

```typescript
// src/commands/config.ts - replace the handler body
import { startGroupSettingsSelection } from '../group-settings/selector.js'

const GROUP_CONFIG_REDIRECT =
  'Group settings are configured in direct messages with the bot. Open a DM with me and run /config.'
const GROUP_CONFIG_ADMIN_ONLY =
  'Only group admins can configure group settings, and group settings are configured in direct messages with the bot.'

export function registerConfigCommand(
  chat: ChatProvider,
  _checkAuthorization: (userId: string, username?: string | null) => boolean,
): void {
  const handler: CommandHandler = async (msg, reply, auth) => {
    if (!auth.allowed) return

    if (msg.contextType === 'group') {
      await reply.text(auth.isGroupAdmin ? GROUP_CONFIG_REDIRECT : GROUP_CONFIG_ADMIN_ONLY)
      return
    }

    const interactiveButtons = supportsInteractiveButtons(chat)
    const selection = startGroupSettingsSelection(msg.user.id, 'config', interactiveButtons)
    if (selection.handled && 'continueWith' in selection) {
      await renderConfigForTarget(reply, selection.continueWith.targetContextId, interactiveButtons)
      return
    }
    if (selection.handled && 'buttons' in selection && selection.buttons !== undefined) {
      await reply.buttons(selection.response, { buttons: selection.buttons })
      return
    }
    if (selection.handled && 'response' in selection) {
      await reply.text(selection.response)
    }
  }

  chat.registerCommand('config', handler)
}
```

- [ ] **Step 4: Update bot interception order and callback routing to use the active group target**

```typescript
// src/bot.ts - add imports
import { renderConfigForTarget } from './commands/config.js'
import { getActiveGroupSettingsTarget } from './group-settings/state.js'
import { handleGroupSettingsSelectorMessage } from './group-settings/selector.js'
```

```typescript
// src/bot.ts - replace maybeInterceptWizard() with the new order
async function maybeInterceptWizard(
  msg: IncomingMessage,
  reply: ReplyFn,
  auth: AuthorizationResult,
  interactiveButtons: boolean,
): Promise<boolean> {
  const isCommand = msg.text.startsWith('/')

  if (!isCommand && msg.contextType === 'dm') {
    const selection = handleGroupSettingsSelectorMessage(msg.user.id, msg.text, interactiveButtons)
    if (selection.handled) {
      if ('continueWith' in selection) {
        await renderConfigForTarget(reply, selection.continueWith.targetContextId, interactiveButtons)
      } else if ('buttons' in selection && selection.buttons !== undefined) {
        await reply.buttons(selection.response, { buttons: selection.buttons })
      } else if ('response' in selection) {
        await reply.text(selection.response)
      }
      return true
    }
  }

  const activeGroupTarget = msg.contextType === 'dm' ? getActiveGroupSettingsTarget(msg.user.id) : null
  const settingsTargetContextId = activeGroupTarget ?? auth.storageContextId

  if (!isCommand) {
    const wasEditorHandled = await handleConfigEditorMessage(msg.user.id, settingsTargetContextId, msg.text, reply)
    if (wasEditorHandled) return true
  }

  if (!isCommand) {
    const wasWizardHandled = await handleWizardMessage(
      msg.user.id,
      settingsTargetContextId,
      msg.text,
      reply,
      interactiveButtons,
    )
    if (wasWizardHandled) return true
  }

  if (!isCommand && auth.allowed) {
    const wasWizardAutoStarted = await autoStartWizardIfNeeded(msg.user.id, auth.storageContextId, reply)
    if (wasWizardAutoStarted) return true
  }

  return false
}
```

```typescript
// src/bot.ts - update the call site
if (await maybeInterceptWizard(msg, reply, auth, interactiveButtons)) return
```

```typescript
// src/chat/interaction-router.ts - extend deps and default handlers
import { renderConfigForTarget } from '../commands/config.js'
import { getActiveGroupSettingsTarget } from '../group-settings/state.js'
import { handleGroupSettingsSelectorCallback } from '../group-settings/selector.js'

export type InteractionRouteDeps = {
  handleGroupSettingsInteraction: (interaction: IncomingInteraction, reply: ReplyFn) => Promise<boolean>
  handleConfigInteraction: (interaction: IncomingInteraction, reply: ReplyFn) => Promise<boolean>
  handleWizardInteraction: (interaction: IncomingInteraction, reply: ReplyFn) => Promise<boolean>
}

async function defaultHandleGroupSettingsInteraction(
  interaction: IncomingInteraction,
  reply: ReplyFn,
): Promise<boolean> {
  const result = handleGroupSettingsSelectorCallback(interaction.user.id, interaction.callbackData)
  if (!result.handled) return false

  if ('continueWith' in result && result.continueWith.command === 'config') {
    await renderConfigForTarget(reply, result.continueWith.targetContextId, true)
    return true
  }

  if ('buttons' in result && result.buttons !== undefined) {
    await reply.buttons(result.response, { buttons: result.buttons })
    return true
  }

  if ('response' in result) {
    await reply.text(result.response)
    return true
  }

  return false
}

async function defaultHandleConfigInteraction(interaction: IncomingInteraction, reply: ReplyFn): Promise<boolean> {
  const { callbackData, user } = interaction
  if (!callbackData.startsWith('cfg:')) return false

  const targetContextId =
    interaction.contextType === 'dm'
      ? (getActiveGroupSettingsTarget(user.id) ?? interaction.contextId)
      : interaction.contextId
  const { action, key } = parseCallbackData(callbackData)

  if (action === null) {
    log.warn({ callbackData }, 'Unknown config editor callback data')
    return true
  }

  const result = handleEditorCallback(user.id, targetContextId, action, key ?? undefined)
  if (!result.handled) return true

  if (result.buttons !== undefined && result.buttons.length > 0) {
    await reply.buttons(result.response ?? '', {
      buttons: result.buttons.map((btn) => ({
        text: btn.text,
        callbackData: serializeCallbackData(btn),
      })),
    })
  } else {
    await reply.text(result.response ?? '')
  }

  return true
}

async function defaultHandleWizardInteraction(interaction: IncomingInteraction, reply: ReplyFn): Promise<boolean> {
  const { callbackData, user } = interaction
  if (!callbackData.startsWith('wizard_')) return false

  const storageContextId =
    interaction.contextType === 'dm'
      ? (getActiveGroupSettingsTarget(user.id) ?? interaction.contextId)
      : interaction.contextId

  switch (callbackData) {
    case 'wizard_confirm': {
      const result = await validateAndSaveWizardConfig(user.id, storageContextId)
      await replyWithWizardButtons(reply, result.message, result.buttons)
      return true
    }
    case 'wizard_cancel': {
      cancelWizard(user.id, storageContextId)
      await reply.text('❌ Wizard cancelled. Type /setup to restart.')
      return true
    }
    case 'wizard_restart': {
      cancelWizard(user.id, storageContextId)
      await reply.text('Restarting wizard... Type /setup to begin.')
      return true
    }
    case 'wizard_edit':
      return handleWizardEdit(user.id, storageContextId, reply)
    case 'wizard_skip_small_model':
    case 'wizard_skip_embedding':
      return handleWizardSkip(callbackData, user.id, storageContextId, reply)
    default:
      return false
  }
}

const defaultDeps: InteractionRouteDeps = {
  handleGroupSettingsInteraction: defaultHandleGroupSettingsInteraction,
  handleConfigInteraction: defaultHandleConfigInteraction,
  handleWizardInteraction: defaultHandleWizardInteraction,
}

export function routeInteraction(
  interaction: IncomingInteraction,
  reply: ReplyFn,
  deps: InteractionRouteDeps = defaultDeps,
): Promise<boolean> {
  const { callbackData } = interaction

  if (callbackData.startsWith('gsel:')) {
    return deps.handleGroupSettingsInteraction(interaction, reply)
  }
  if (callbackData.startsWith('cfg:')) {
    return deps.handleConfigInteraction(interaction, reply)
  }
  if (callbackData.startsWith('wizard_')) {
    return deps.handleWizardInteraction(interaction, reply)
  }

  log.debug({ callbackData }, 'No route matched for interaction callback')
  return Promise.resolve(false)
}
```

```typescript
// src/chat/discord/index.ts - keep dispatchButtonInteraction, but resolve target first and branch on gsel:
import { renderConfigForTarget } from '../../commands/config.js'
import { handleGroupSettingsSelectorCallback } from '../../group-settings/selector.js'
import { getActiveGroupSettingsTarget } from '../../group-settings/state.js'

private async handleButtonInteraction(interaction: ButtonInteractionLike, adminUserId: string): Promise<void> {
  const channel = interaction.channel
  if (channel === null) {
    log.warn({ channelId: interaction.channelId }, 'Button interaction: channel not available, skipping')
    return
  }

  const contextType = channel.type === CHANNEL_TYPE_DM ? ('dm' as const) : ('group' as const)
  const contextId = contextType === 'dm' ? interaction.user.id : interaction.channelId
  const userId = interaction.user.id
  const reply = createDiscordReplyFn({ channel, replyToMessageId: undefined })

  if (interaction.customId.startsWith('gsel:')) {
    await interaction.deferUpdate().catch(() => undefined)
    const result = handleGroupSettingsSelectorCallback(userId, interaction.customId)
    if ('continueWith' in result && result.continueWith.command === 'config') {
      await renderConfigForTarget(reply, result.continueWith.targetContextId, true)
      return
    }
    if ('buttons' in result && result.buttons !== undefined) {
      await reply.buttons(result.response, { buttons: result.buttons })
      return
    }
    if ('response' in result) {
      await reply.text(result.response)
      return
    }
  }

  const activeGroupTarget = contextType === 'dm' ? getActiveGroupSettingsTarget(userId) : null
  const settingsTargetContextId = activeGroupTarget ?? contextId

  const onCfg = async (data: string): Promise<void> => {
    await handleConfigEditorCallback(userId, settingsTargetContextId, data, channel)
  }
  const onWizard = async (data: string): Promise<void> => {
    await handleWizardCallback(userId, settingsTargetContextId, data, channel)
  }

  await dispatchButtonInteraction(interaction, onCfg, onWizard)
  await this.routeButtonFallback(interaction, channel, contextId, contextType, adminUserId)
}
```

```typescript
// src/config-editor/handlers.ts - fix the back action bug
function handleBackAction(userId: string, storageContextId: string): EditorProcessResult {
  deleteEditorSession(userId, storageContextId)
  const { text, buttons } = buildConfigList(storageContextId)
  return { handled: true, response: text, buttons }
}

export function handleEditorCallback(
  userId: string,
  storageContextId: string,
  action: 'edit' | 'save' | 'cancel' | 'back' | 'setup',
  key?: ConfigKey,
): EditorProcessResult {
  switch (action) {
    case 'edit':
      return key === undefined ? { handled: false } : startEditor(userId, storageContextId, key)
    case 'save':
      return handleSaveAction(userId, storageContextId)
    case 'cancel':
      return handleCancelAction(userId, storageContextId)
    case 'back':
      return handleBackAction(userId, storageContextId)
    case 'setup':
      return handleSetupAction()
    default:
      return { handled: false }
  }
}
```

- [ ] **Step 5: Run the `/config` tests to verify they pass**

```bash
bun test tests/commands/config.test.ts tests/commands/restrictions.test.ts tests/chat/interaction-router.test.ts tests/chat/discord/index.test.ts tests/config-editor/handlers.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add \
  src/commands/config.ts \
  src/bot.ts \
  src/chat/interaction-router.ts \
  src/chat/discord/index.ts \
  src/config-editor/handlers.ts \
  tests/commands/config.test.ts \
  tests/commands/restrictions.test.ts \
  tests/chat/interaction-router.test.ts \
  tests/chat/discord/index.test.ts \
  tests/config-editor/handlers.test.ts
git commit -m "feat(config): route group settings through DM" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 6: Route `/setup` through the DM selector and launch the wizard against the selected target

**Files:**

- Modify: `src/commands/setup.ts`
- Modify: `src/bot.ts`
- Modify: `src/chat/interaction-router.ts`
- Modify: `src/chat/discord/index.ts`
- Test: `tests/commands/setup.test.ts`
- Modify: `tests/chat/interaction-router.test.ts`
- Modify: `tests/chat/discord/index.test.ts`

- [ ] **Step 1: Write the failing `/setup` command and selector-continuation tests**

```typescript
// tests/commands/setup.test.ts
import { beforeEach, describe, expect, test } from 'bun:test'

import type { CommandHandler } from '../../src/chat/types.js'
import { registerSetupCommand } from '../../src/commands/setup.js'
import {
  createAuth,
  createDmMessage,
  createGroupMessage,
  createMockChatWithCommandHandlers,
  createMockReply,
  mockLogger,
  setupTestDb,
} from '../utils/test-helpers.js'

describe('/setup command', () => {
  let setupHandler: CommandHandler | null = null

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    const { provider, commandHandlers } = createMockChatWithCommandHandlers()
    registerSetupCommand(provider, (_userId: string) => true)
    setupHandler = commandHandlers.get('setup') ?? null
  })

  test('starts with a personal/group selector in DM', async () => {
    expect(setupHandler).not.toBeNull()
    const { reply, buttonCalls } = createMockReply()

    await setupHandler!(createDmMessage('user-1'), reply, createAuth('user-1'))

    expect(buttonCalls[0]).toContain('Personal settings')
    expect(buttonCalls[0]).toContain('Group settings')
  })

  test('group admin gets a DM-only redirect', async () => {
    expect(setupHandler).not.toBeNull()
    const { reply, textCalls } = createMockReply()

    await setupHandler!(
      createGroupMessage('user-1', '/setup', true, 'group-1'),
      reply,
      createAuth('user-1', { isGroupAdmin: true }),
    )

    expect(textCalls[0]).toBe(
      'Group settings are configured in direct messages with the bot. Open a DM with me and run /setup.',
    )
  })

  test('non-admin group user gets the admin-only restriction', async () => {
    expect(setupHandler).not.toBeNull()
    const { reply, textCalls } = createMockReply()

    await setupHandler!(createGroupMessage('user-1', '/setup', false, 'group-1'), reply, createAuth('user-1'))

    expect(textCalls[0]).toBe(
      'Only group admins can configure group settings, and group settings are configured in direct messages with the bot.',
    )
  })
})
```

```typescript
// tests/chat/interaction-router.test.ts - add a setup continuation case
test('routes gsel callbacks into the setup continuation when selector state says setup', async () => {
  const calls: string[] = []
  const handled = await routeInteraction({ ...interaction, callbackData: 'gsel:scope:group' }, reply, {
    handleGroupSettingsInteraction: () => {
      calls.push('gsel')
      return Promise.resolve(true)
    },
    handleConfigInteraction: () => Promise.resolve(false),
    handleWizardInteraction: () => Promise.resolve(false),
  })

  expect(handled).toBe(true)
  expect(calls).toEqual(['gsel'])
})
```

```typescript
// tests/chat/discord/index.test.ts - add a selected-group setup continuation case
import { handleGroupSettingsSelectorCallback } from '../../../src/group-settings/selector.js'

test('Discord DM selector continues into setup when the selector command is setup', async () => {
  const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
  const provider = new DiscordChatProvider()
  await setupTestDb()

  upsertKnownGroupContext({
    contextId: 'group-1',
    provider: 'discord',
    displayName: 'Operations',
    parentName: 'Platform',
  })
  upsertGroupAdminObservation({
    contextId: 'group-1',
    userId: 'user-1',
    username: 'alice',
    isAdmin: true,
  })
  startGroupSettingsSelection('user-1', 'setup', true)
  handleGroupSettingsSelectorCallback('user-1', 'gsel:scope:group')

  const sends: Array<{ content?: string }> = []
  const interaction: ButtonInteractionLike = {
    user: { id: 'user-1', username: 'alice' },
    customId: 'gsel:group:group-1',
    channelId: 'dm-1',
    channel: {
      id: 'dm-1',
      type: 1,
      send: (arg: { content?: string }): Promise<{ id: string; edit: () => Promise<void> }> => {
        sends.push(arg)
        return Promise.resolve({ id: 'out-1', edit: (): Promise<void> => Promise.resolve() })
      },
      sendTyping: (): Promise<void> => Promise.resolve(),
    },
    message: { id: 'm-1' },
    deferUpdate: (): Promise<void> => Promise.resolve(),
  }

  await provider.testDispatchButtonInteraction(interaction, 'bot-id', 'admin-id')

  expect(sends[0]?.content).toContain('Let’s get your configuration set up')
})
```

- [ ] **Step 2: Run the `/setup` tests to verify they fail**

```bash
bun test tests/commands/setup.test.ts tests/chat/interaction-router.test.ts tests/chat/discord/index.test.ts
```

Expected: FAIL because `/setup` still launches immediately in DM, still runs in groups, and selector continuations only know how to continue `/config`.

- [ ] **Step 3: Export a target-aware setup launcher and make `/setup` DM-only for groups**

```typescript
// src/commands/setup.ts - add helper above registerSetupCommand()
import { supportsInteractiveButtons } from '../chat/capabilities.js'
import type { ReplyFn } from '../chat/types.js'
import { startGroupSettingsSelection } from '../group-settings/selector.js'

const GROUP_SETUP_REDIRECT =
  'Group settings are configured in direct messages with the bot. Open a DM with me and run /setup.'
const GROUP_SETUP_ADMIN_ONLY =
  'Only group admins can configure group settings, and group settings are configured in direct messages with the bot.'

export async function startSetupForTarget(userId: string, reply: ReplyFn, targetContextId: string): Promise<void> {
  const result = createWizard(userId, targetContextId, TASK_PROVIDER)
  if (result.success) {
    await reply.text(result.prompt)
    return
  }
  await reply.text(result.prompt ?? 'Failed to start wizard. Please try again.')
}
```

```typescript
// src/commands/setup.ts - replace the handler body
export function registerSetupCommand(
  chat: ChatProvider,
  _checkAuthorization: (userId: string, username?: string | null) => boolean,
): void {
  const handler: CommandHandler = async (msg, reply, auth) => {
    if (!auth.allowed) {
      await reply.text('You are not authorized to use this bot.')
      return
    }

    if (msg.contextType === 'group') {
      await reply.text(auth.isGroupAdmin ? GROUP_SETUP_REDIRECT : GROUP_SETUP_ADMIN_ONLY)
      return
    }

    const interactiveButtons = supportsInteractiveButtons(chat)
    const selection = startGroupSettingsSelection(msg.user.id, 'setup', interactiveButtons)
    if (selection.handled && 'continueWith' in selection) {
      await startSetupForTarget(msg.user.id, reply, selection.continueWith.targetContextId)
      return
    }
    if (selection.handled && 'buttons' in selection && selection.buttons !== undefined) {
      await reply.buttons(selection.response, { buttons: selection.buttons })
      return
    }
    if (selection.handled && 'response' in selection) {
      await reply.text(selection.response)
    }
  }

  chat.registerCommand('setup', handler)
}
```

- [ ] **Step 4: Extend selector continuations so `/setup` launches the wizard against the selected target**

```typescript
// src/bot.ts - add import
import { startSetupForTarget } from './commands/setup.js'
```

```typescript
// src/bot.ts - extend the selector continuation branch
if (!isCommand && msg.contextType === 'dm') {
  const selection = handleGroupSettingsSelectorMessage(msg.user.id, msg.text, interactiveButtons)
  if (selection.handled) {
    if ('continueWith' in selection) {
      if (selection.continueWith.command === 'config') {
        await renderConfigForTarget(reply, selection.continueWith.targetContextId, interactiveButtons)
      } else {
        await startSetupForTarget(msg.user.id, reply, selection.continueWith.targetContextId)
      }
    } else if ('buttons' in selection && selection.buttons !== undefined) {
      await reply.buttons(selection.response, { buttons: selection.buttons })
    } else if ('response' in selection) {
      await reply.text(selection.response)
    }
    return true
  }
}
```

```typescript
// src/chat/interaction-router.ts - replace the gsel continuation branch
import { startSetupForTarget } from '../commands/setup.js'

async function defaultHandleGroupSettingsInteraction(
  interaction: IncomingInteraction,
  reply: ReplyFn,
): Promise<boolean> {
  const result = handleGroupSettingsSelectorCallback(interaction.user.id, interaction.callbackData)
  if (!result.handled) return false

  if ('continueWith' in result) {
    if (result.continueWith.command === 'config') {
      await renderConfigForTarget(reply, result.continueWith.targetContextId, true)
    } else {
      await startSetupForTarget(interaction.user.id, reply, result.continueWith.targetContextId)
    }
    return true
  }

  if ('buttons' in result && result.buttons !== undefined) {
    await reply.buttons(result.response, { buttons: result.buttons })
    return true
  }

  if ('response' in result) {
    await reply.text(result.response)
    return true
  }

  return false
}
```

```typescript
// src/chat/discord/index.ts - extend the gsel continuation branch
import { startSetupForTarget } from '../../commands/setup.js'

if (interaction.customId.startsWith('gsel:')) {
  const result = handleGroupSettingsSelectorCallback(userId, interaction.customId)
  if ('continueWith' in result) {
    if (result.continueWith.command === 'config') {
      await renderConfigForTarget(reply, result.continueWith.targetContextId, true)
    } else {
      await startSetupForTarget(userId, reply, result.continueWith.targetContextId)
    }
    return
  }
  if ('buttons' in result && result.buttons !== undefined) {
    await reply.buttons(result.response, { buttons: result.buttons })
    return
  }
  if ('response' in result) {
    await reply.text(result.response)
    return
  }
}
```

- [ ] **Step 5: Run the `/setup` tests to verify they pass**

```bash
bun test tests/commands/setup.test.ts tests/chat/interaction-router.test.ts tests/chat/discord/index.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add \
  src/commands/setup.ts \
  src/bot.ts \
  src/chat/interaction-router.ts \
  src/chat/discord/index.ts \
  tests/commands/setup.test.ts \
  tests/chat/interaction-router.test.ts \
  tests/chat/discord/index.test.ts
git commit -m "feat(setup): support DM group target selection" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 7: Update help text and run the final regression suite

**Files:**

- Modify: `src/commands/help.ts`
- Modify: `tests/commands/help.test.ts`

- [ ] **Step 1: Write the failing help-text assertions**

```typescript
// tests/commands/help.test.ts - replace the group admin assertions and extend DM assertions
test('DM help explains that /setup and /config can target personal or group settings', async () => {
  const dmMsg = createDmMessage('user1', '/help')
  const auth = {
    allowed: true,
    isBotAdmin: false,
    isGroupAdmin: false,
    storageContextId: 'user1',
  }

  await lastHandler!(dmMsg, mockReply, auth)

  expect(capturedText).toContain('/setup — Interactive configuration wizard for personal or group settings')
  expect(capturedText).toContain('/config — View or edit personal settings, or choose a group to configure from DM')
})

test('Group admin help no longer advertises in-group /setup or /config', async () => {
  const groupMsg = createGroupMessage('admin1', '/help', true, 'group1')
  const auth = {
    allowed: true,
    isBotAdmin: false,
    isGroupAdmin: true,
    storageContextId: 'group1',
  }

  await lastHandler!(groupMsg, mockReply, auth)

  expect(capturedText).toContain('Group settings are configured in DM with the bot')
  expect(capturedText).not.toContain('/setup — Interactive configuration wizard')
  expect(capturedText).not.toContain('/config — View group configuration')
  expect(capturedText).toContain('/clear')
})
```

- [ ] **Step 2: Run the help tests to verify they fail**

```bash
bun test tests/commands/help.test.ts
```

Expected: FAIL because the help text still describes `/setup` and `/config` as group-admin commands inside the group.

- [ ] **Step 3: Update the DM and group help copy**

```typescript
// src/commands/help.ts - replace the help-text constants
const DM_USER_HELP = [
  'papai — AI assistant for Kaneo task management',
  '',
  'Commands:',
  '/help — Show this message',
  '/setup — Interactive configuration wizard for personal or group settings',
  '/config — View or edit personal settings, or choose a group to configure from DM',
  '/clear — Clear conversation history and memory',
  '',
  'Any other message is sent to the AI assistant.',
].join('\n')

function getGroupHelpText(isGroupAdmin: boolean): string {
  let text = [
    'papai — AI assistant for Kaneo task management',
    '',
    'Group commands:',
    '/help — Show this message',
    '/group adduser <@username> — Add member to group',
    '/group deluser <@username> — Remove member from group',
    '/group users — List group members',
    '',
    'Mention me with @botname for natural language queries',
  ].join('\n')

  if (isGroupAdmin) {
    text += [
      '',
      'Admin commands:',
      '/clear — Clear group conversation history',
      '',
      'Group settings are configured in DM with the bot.',
    ].join('\n')
  }

  return text
}
```

- [ ] **Step 4: Run the help tests, then the full unit suite and typecheck**

```bash
bun test tests/commands/help.test.ts && bun run check:full
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/commands/help.ts tests/commands/help.test.ts
git commit -m "docs(help): describe DM-only group settings" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
