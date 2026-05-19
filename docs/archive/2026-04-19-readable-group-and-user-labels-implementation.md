# Readable Group And User Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/groups` and `/group users` render readable group and user labels like `John Johnson (@itsmike)` when the active chat provider can resolve them, while preserving raw-ID fallback.

**Architecture:** Extend `ChatProvider` with best-effort reverse label resolution methods, keep provider-specific lookup logic inside the Telegram, Mattermost, and Discord adapters, and keep output formatting in `src/commands/group.ts`. Command responses remain fully functional when any lookup returns `null`, and in-request memoization avoids duplicate lookups in a single response.

**Tech Stack:** Bun, TypeScript, grammY, Mattermost REST API, discord.js, Bun test runner, pino, oxlint/oxfmt.

**Spec:** `docs/superpowers/specs/2026-04-19-readable-group-and-user-labels-design.md`.

---

## File Structure

### Modified files

- `src/chat/types.ts` — extend `ChatProvider` with `resolveUserLabel` and `resolveGroupLabel` optional methods.
- `tests/utils/test-helpers.ts` — extend `createMockChat` and `CreateMockChatOptions` so command tests can inject reverse label resolution.
- `tests/commands/group.test.ts` — add red/green coverage for readable labels and raw-ID fallbacks in `/groups` and `/group users`.
- `src/commands/group.ts` — add reusable formatting helpers, best-effort provider lookups, per-response memoization, and readable output formatting.
- `src/chat/mattermost/schema.ts` — add a narrow user schema for `/api/v4/users/{id}` responses.
- `src/chat/mattermost/index.ts` — implement reverse user/group label resolution against Mattermost APIs.
- `tests/chat/mattermost/index.test.ts` — add focused tests for Mattermost label resolution and null fallback.
- `src/chat/discord/client-factory.ts` — widen structural types so the provider can fetch channels/users/members for label resolution.
- `src/chat/discord/type-guards.ts` — add or extend type guards for the richer Discord client/guild/channel shapes used by label resolution.
- `src/chat/discord/index.ts` — implement reverse user/group label resolution using channel fetch, guild member fetch, and user fetch fallback.
- `tests/chat/discord/index.test.ts` — add focused tests for Discord label resolution paths and null fallback.
- `src/chat/telegram/index.ts` — implement best-effort reverse user/group label resolution using `getChat` and `getChatMember` where available.
- `tests/chat/telegram/index.test.ts` — add focused tests for Telegram label resolution success and null fallback.

### No new persistence or migration files

- Do not change `authorized_groups`, `group_members`, or any DB schema.
- Do not add caches beyond in-request memoization inside the command handler.

---

## Decisions Locked Before Implementation

1. `registerGroupCommand(chat)` already receives the active provider, so no `src/bot.ts` changes are needed.
2. Reverse-resolution methods return a fully formatted label string or `null`; they do not return structured profile objects.
3. User label formatting target is exactly:
   - `Display Name (@username)` when both exist
   - `Display Name` when only display name exists
   - `@username` when only username exists
   - raw stored ID when provider resolution returns `null`
4. Group label formatting target is the resolved title/name only; if that fails, keep the raw group ID.
5. Resolution is best-effort and must never fail the command.
6. Within one command response, repeated IDs should be looked up once via a local memoization map.

---

### Task 1: Extend `ChatProvider` and test helpers for reverse label resolution

**Files:**

- Modify: `src/chat/types.ts`
- Modify: `tests/utils/test-helpers.ts`
- Test: `tests/commands/group.test.ts`

- [ ] **Step 1: Write the failing tests for injected reverse label resolution**

Edit `tests/commands/group.test.ts` to add two tests near the existing `/groups` and `users` sections:

```typescript
test('lists authorized groups with resolved group and user labels', async () => {
  const labeledHandlers = new Map<string, CommandHandler>()
  const labeledChat = createMockChat({
    commandHandlers: labeledHandlers,
    resolveGroupLabel: (groupId: string): Promise<string | null> => {
      if (groupId === 'group-123') return Promise.resolve('Engineering Chat')
      return Promise.resolve(null)
    },
    resolveUserLabel: (userId: string): Promise<string | null> => {
      if (userId === 'admin1') return Promise.resolve('John Johnson (@itsmike)')
      return Promise.resolve(null)
    },
  })
  registerGroupCommand(labeledChat)

  const { addAuthorizedGroup } = await import('../../src/authorized-groups.js')
  addAuthorizedGroup('group-123', 'admin1')

  const handler = labeledHandlers.get('groups')
  expect(handler).toBeDefined()

  const { reply, textCalls } = createMockReply()
  await handler!(createDmMessage('admin1'), reply, createAuth('admin1', { isBotAdmin: true }))

  expect(textCalls[0]).toContain('Engineering Chat')
  expect(textCalls[0]).toContain('John Johnson (@itsmike)')
  expect(textCalls[0]).not.toContain('group-123 (added by admin1)')
})

test('lists group users with resolved member and adder labels', async () => {
  const labeledHandlers = new Map<string, CommandHandler>()
  const labeledChat = createMockChat({
    commandHandlers: labeledHandlers,
    resolveUserLabel: (userId: string): Promise<string | null> => {
      if (userId === 'user1') return Promise.resolve('John Johnson (@itsmike)')
      if (userId === 'admin1') return Promise.resolve('Jane Admin (@janeadmin)')
      return Promise.resolve(null)
    },
  })
  registerGroupCommand(labeledChat)

  const { addGroupMember } = await import('../../src/groups.js')
  addGroupMember('group1', 'user1', 'admin1')

  const handler = labeledHandlers.get('group')
  expect(handler).toBeDefined()

  const { reply, textCalls } = createMockReply()
  await handler!(createGroupMessage('user1', 'users', false), reply, createAuth('user1'))

  expect(textCalls[0]).toContain('John Johnson (@itsmike)')
  expect(textCalls[0]).toContain('added by Jane Admin (@janeadmin)')
})
```

- [ ] **Step 2: Run the command test to verify it fails**

Run:

```bash
bun test tests/commands/group.test.ts
```

Expected: FAIL because `createMockChat` and `ChatProvider` do not yet expose `resolveUserLabel` or `resolveGroupLabel`.

- [ ] **Step 3: Extend the `ChatProvider` contract**

Edit `src/chat/types.ts` to add the new optional methods:

```typescript
} & Partial<{
  /** Register the handler for button/callback interactions (optional). */
  onInteraction: (handler: (interaction: IncomingInteraction, reply: ReplyFn) => Promise<void>) => void
  resolveUserId: (username: string, context: ResolveUserContext) => Promise<string | null>
  resolveUserLabel: (userId: string, context?: ResolveUserContext) => Promise<string | null>
  resolveGroupLabel: (groupId: string) => Promise<string | null>
  /** Register the bot's command list with the platform (for command menus). */
  setCommands: (adminUserId: string) => Promise<void>
}>
```

- [ ] **Step 4: Extend `createMockChat` so tests can inject the new methods**

Edit `tests/utils/test-helpers.ts` in the `CreateMockChatOptions` block and `createMockChat` implementation:

```typescript
type CreateMockChatOptions = Partial<
  Readonly<{
    commandHandlers: Map<string, CommandHandler>
    sendMessage: (userId: string, text: string) => Promise<void>
    onMessageHandler: (handler: (msg: IncomingMessage, reply: ReplyFn) => Promise<void>) => void
    resolveUserId: (username: string, context: ResolveUserContext) => Promise<string | null>
    resolveUserLabel: (userId: string, context?: ResolveUserContext) => Promise<string | null>
    resolveGroupLabel: (groupId: string) => Promise<string | null>
    onInteractionHandler: (handler: (interaction: IncomingInteraction, reply: ReplyFn) => Promise<void>) => void
    setCommands: (adminUserId: string) => Promise<void>
    capabilities: Set<ChatCapability>
    traits: ChatProviderTraits
    configRequirements: ChatProviderConfigRequirement[]
  }>
>

const DEFAULT_RESOLVE_USER_LABEL = (_userId: string, _context?: ResolveUserContext): Promise<string | null> =>
  Promise.resolve(null)
const DEFAULT_RESOLVE_GROUP_LABEL = (_groupId: string): Promise<string | null> => Promise.resolve(null)
```

And in `createMockChat`:

```typescript
const resolveUserLabel = options.resolveUserLabel
const resolveGroupLabel = options.resolveGroupLabel

let resolveUserLabelImpl = DEFAULT_RESOLVE_USER_LABEL
if (resolveUserLabel !== undefined) {
  resolveUserLabelImpl = resolveUserLabel
}

let resolveGroupLabelImpl = DEFAULT_RESOLVE_GROUP_LABEL
if (resolveGroupLabel !== undefined) {
  resolveGroupLabelImpl = resolveGroupLabel
}
```

And in the returned provider object:

```typescript
    resolveUserId: resolveUserIdImpl,
    resolveUserLabel: resolveUserLabelImpl,
    resolveGroupLabel: resolveGroupLabelImpl,
    setCommands: setCommandsImpl,
```

- [ ] **Step 5: Run the command test to verify it now reaches the command implementation gap**

Run:

```bash
bun test tests/commands/group.test.ts
```

Expected: FAIL on the new assertions because `src/commands/group.ts` still prints IDs directly.

- [ ] **Step 6: Commit the interface and test-helper changes**

```bash
git add src/chat/types.ts tests/utils/test-helpers.ts tests/commands/group.test.ts
git commit -m "refactor: add chat provider label resolution hooks"
```

---

### Task 2: Add readable label formatting to `/groups` and `/group users`

**Files:**

- Modify: `src/commands/group.ts`
- Test: `tests/commands/group.test.ts`

- [ ] **Step 1: Expand the failing command tests to cover fallback and memoization-safe formatting**

Add these tests to `tests/commands/group.test.ts`:

```typescript
test('falls back to raw IDs when /groups label resolution returns null', async () => {
  const fallbackHandlers = new Map<string, CommandHandler>()
  const fallbackChat = createMockChat({
    commandHandlers: fallbackHandlers,
    resolveGroupLabel: (_groupId: string): Promise<string | null> => Promise.resolve(null),
    resolveUserLabel: (_userId: string): Promise<string | null> => Promise.resolve(null),
  })
  registerGroupCommand(fallbackChat)

  const { addAuthorizedGroup } = await import('../../src/authorized-groups.js')
  addAuthorizedGroup('group-123', 'admin1')

  const handler = fallbackHandlers.get('groups')
  expect(handler).toBeDefined()

  const { reply, textCalls } = createMockReply()
  await handler!(createDmMessage('admin1'), reply, createAuth('admin1', { isBotAdmin: true }))

  expect(textCalls[0]).toContain('group-123 (added by admin1)')
})

test('falls back to raw IDs when /group users label resolution returns null', async () => {
  const fallbackHandlers = new Map<string, CommandHandler>()
  const fallbackChat = createMockChat({
    commandHandlers: fallbackHandlers,
    resolveUserLabel: (_userId: string): Promise<string | null> => Promise.resolve(null),
  })
  registerGroupCommand(fallbackChat)

  const { addGroupMember } = await import('../../src/groups.js')
  addGroupMember('group1', 'user1', 'admin1')

  const handler = fallbackHandlers.get('group')
  expect(handler).toBeDefined()

  const { reply, textCalls } = createMockReply()
  await handler!(createGroupMessage('user1', 'users', false), reply, createAuth('user1'))

  expect(textCalls[0]).toContain('- user1 (added by admin1)')
})
```

- [ ] **Step 2: Run the targeted test file and confirm the new tests fail**

Run:

```bash
bun test tests/commands/group.test.ts
```

Expected: FAIL because the handler still formats raw IDs directly and has no async label-resolution path.

- [ ] **Step 3: Add reusable label helpers and async list rendering in `src/commands/group.ts`**

Edit `src/commands/group.ts`.

First, add helper types and helpers near the top of the file, after the usage constants:

```typescript
type LabelResolverContext = {
  readonly chat: ChatProvider
  readonly contextId: string
  readonly contextType: 'dm' | 'group'
}

function makeDisplayLabel(label: string | null, fallback: string): string {
  return label ?? fallback
}

async function resolveUserLabel(
  resolverContext: LabelResolverContext,
  userId: string,
  cache: Map<string, Promise<string | null>>,
): Promise<string | null> {
  const existing = cache.get(userId)
  if (existing !== undefined) {
    return existing
  }

  const pending =
    resolverContext.chat.resolveUserLabel?.(userId, {
      contextId: resolverContext.contextId,
      contextType: resolverContext.contextType,
    }) ?? Promise.resolve(null)

  cache.set(userId, pending)
  return pending
}

async function resolveGroupLabel(
  chat: ChatProvider,
  groupId: string,
  cache: Map<string, Promise<string | null>>,
): Promise<string | null> {
  const existing = cache.get(groupId)
  if (existing !== undefined) {
    return existing
  }

  const pending = chat.resolveGroupLabel?.(groupId) ?? Promise.resolve(null)
  cache.set(groupId, pending)
  return pending
}
```

Then update the `/groups` handler block from direct `.map()` formatting to async resolution:

```typescript
const groupLabelCache = new Map<string, Promise<string | null>>()
const userLabelCache = new Map<string, Promise<string | null>>()

const lines = await Promise.all(
  groups.map(async (group) => {
    const [resolvedGroupLabel, resolvedUserLabel] = await Promise.all([
      resolveGroupLabel(chat, group.group_id, groupLabelCache),
      resolveUserLabel({ chat, contextId: group.group_id, contextType: 'group' }, group.added_by, userLabelCache),
    ])

    const groupLabel = makeDisplayLabel(resolvedGroupLabel, group.group_id)
    const userLabel = makeDisplayLabel(resolvedUserLabel, group.added_by)
    return `${groupLabel} (added by ${userLabel})`
  }),
)
```

Then update `handleListUsers` to accept the `chat` parameter and render asynchronously:

```typescript
await handleListUsers(chat, msg, reply)
```

And change the function implementation to:

```typescript
async function handleListUsers(chat: ChatProvider, msg: IncomingMessage, reply: ReplyFn): Promise<void> {
  const members = listGroupMembers(msg.contextId)

  if (members.length === 0) {
    await reply.text('No members in this group yet.')
    return
  }

  const userLabelCache = new Map<string, Promise<string | null>>()
  const resolverContext: LabelResolverContext = {
    chat,
    contextId: msg.contextId,
    contextType: msg.contextType,
  }

  const lines = await Promise.all(
    members.map(async (member) => {
      const [resolvedMemberLabel, resolvedAdderLabel] = await Promise.all([
        resolveUserLabel(resolverContext, member.user_id, userLabelCache),
        resolveUserLabel(resolverContext, member.added_by, userLabelCache),
      ])

      const memberLabel = makeDisplayLabel(resolvedMemberLabel, member.user_id)
      const adderLabel = makeDisplayLabel(resolvedAdderLabel, member.added_by)
      return `- ${memberLabel} (added by ${adderLabel})`
    }),
  )

  await reply.text(`Group members:\n${lines.join('\n')}`)
}
```

- [ ] **Step 4: Run the command tests to verify the readable output passes**

Run:

```bash
bun test tests/commands/group.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run the stricter lint check for the modified implementation and test files**

Run:

```bash
bun run lint:agent-strict -- src/commands/group.ts tests/commands/group.test.ts tests/utils/test-helpers.ts src/chat/types.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the command-layer behavior change**

```bash
git add src/commands/group.ts tests/commands/group.test.ts
git commit -m "feat: render readable labels in group listings"
```

---

### Task 3: Implement Mattermost reverse label resolution

**Files:**

- Modify: `src/chat/mattermost/schema.ts`
- Modify: `src/chat/mattermost/index.ts`
- Test: `tests/chat/mattermost/index.test.ts`

- [ ] **Step 1: Write the failing Mattermost tests**

Add these tests to `tests/chat/mattermost/index.test.ts` inside `describe('MattermostChatProvider', ...)`:

```typescript
describe('reverse label resolution', () => {
  test('resolveGroupLabel returns channel display name', async () => {
    setMockFetch((url: string) => {
      if (url.includes('/api/v4/channels/chan-1')) {
        return Promise.resolve(
          new Response(JSON.stringify({ type: 'O', display_name: 'Operations', name: 'operations' }), { status: 200 }),
        )
      }
      return Promise.resolve(new Response(null, { status: 404 }))
    })

    provider = new MattermostChatProvider()
    const label = await provider.resolveGroupLabel?.('chan-1')

    expect(label).toBe('Operations')
    restoreFetch()
  })

  test('resolveUserLabel returns display name and username', async () => {
    setMockFetch((url: string) => {
      if (url.includes('/api/v4/users/user-1')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'user-1',
              username: 'itsmike',
              first_name: 'John',
              last_name: 'Johnson',
              nickname: '',
            }),
            { status: 200 },
          ),
        )
      }
      return Promise.resolve(new Response(null, { status: 404 }))
    })

    provider = new MattermostChatProvider()
    const label = await provider.resolveUserLabel?.('user-1')

    expect(label).toBe('John Johnson (@itsmike)')
    restoreFetch()
  })

  test('resolveUserLabel returns null when user lookup fails', async () => {
    setMockFetch(() => Promise.resolve(new Response(null, { status: 404 })))

    provider = new MattermostChatProvider()
    const label = await provider.resolveUserLabel?.('missing-user')

    expect(label).toBeNull()
    restoreFetch()
  })
})
```

- [ ] **Step 2: Run the Mattermost provider test file and verify it fails**

Run:

```bash
bun test tests/chat/mattermost/index.test.ts
```

Expected: FAIL because `resolveGroupLabel` and `resolveUserLabel` do not exist.

- [ ] **Step 3: Add a narrow user schema for Mattermost user-by-ID responses**

Edit `src/chat/mattermost/schema.ts` and add:

```typescript
export const MattermostUserSchema = z.object({
  id: z.string(),
  username: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  nickname: z.string().optional(),
})
```

- [ ] **Step 4: Implement label formatting and reverse lookup in the provider**

Edit `src/chat/mattermost/index.ts`.

Add the new import:

```typescript
import {
  ChannelSchema,
  extractReplyId,
  MattermostUserSchema,
  MattermostWsEventSchema,
  type MattermostPost,
  UserMeSchema,
} from './schema.js'
```

Add a small helper near the logger:

```typescript
function formatMattermostUserLabel(user: {
  username?: string
  first_name?: string
  last_name?: string
  nickname?: string
}): string | null {
  const displayName = [user.first_name, user.last_name]
    .filter((part) => part !== undefined && part !== '')
    .join(' ')
    .trim()
  const nickname = user.nickname !== undefined && user.nickname !== '' ? user.nickname : null
  const bestName = displayName.length > 0 ? displayName : nickname
  const username = user.username !== undefined && user.username !== '' ? `@${user.username}` : null

  if (bestName !== null && username !== null) {
    return `${bestName} (${username})`
  }
  return bestName ?? username
}
```

Add methods to the class after `resolveUserId`:

```typescript
  async resolveGroupLabel(groupId: string): Promise<string | null> {
    try {
      const channelInfo = await fetchMattermostChannelInfo(this.apiFetch.bind(this), groupId)
      return channelInfo.display_name ?? channelInfo.name ?? null
    } catch (error) {
      log.warn({ groupId, error: error instanceof Error ? error.message : String(error) }, 'Mattermost group label lookup failed')
      return null
    }
  }

  async resolveUserLabel(userId: string): Promise<string | null> {
    try {
      const data = await this.apiFetch('GET', `/api/v4/users/${encodeURIComponent(userId)}`, undefined)
      const parsed = MattermostUserSchema.safeParse(data)
      if (!parsed.success) {
        log.warn({ userId, error: parsed.error }, 'Failed to parse Mattermost user label response')
        return null
      }
      return formatMattermostUserLabel(parsed.data)
    } catch (error) {
      log.warn({ userId, error: error instanceof Error ? error.message : String(error) }, 'Mattermost user label lookup failed')
      return null
    }
  }
```

- [ ] **Step 5: Run the Mattermost provider tests to verify the implementation passes**

Run:

```bash
bun test tests/chat/mattermost/index.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the Mattermost provider support**

```bash
git add src/chat/mattermost/schema.ts src/chat/mattermost/index.ts tests/chat/mattermost/index.test.ts
git commit -m "feat: resolve readable labels for mattermost groups and users"
```

---

### Task 4: Implement Discord reverse label resolution

**Files:**

- Modify: `src/chat/discord/client-factory.ts`
- Modify: `src/chat/discord/type-guards.ts`
- Modify: `src/chat/discord/index.ts`
- Test: `tests/chat/discord/index.test.ts`

- [ ] **Step 1: Write the failing Discord tests**

Add these tests to `tests/chat/discord/index.test.ts`:

```typescript
test('resolveGroupLabel returns the fetched channel name', async () => {
  const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
  const provider = new DiscordChatProvider()

  provider.testSetClient({
    destroy: (): Promise<void> => Promise.resolve(),
    channels: {
      cache: new Map(),
      fetch: (id: string): Promise<{ name: string }> => {
        expect(id).toBe('chan-7')
        return Promise.resolve({ name: 'engineering-chat' })
      },
    },
  })

  const label = await provider.resolveGroupLabel?.('chan-7')
  expect(label).toBe('engineering-chat')
})

test('resolveUserLabel prefers guild member display name and username', async () => {
  const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
  const provider = new DiscordChatProvider()

  provider.testSetClient({
    destroy: (): Promise<void> => Promise.resolve(),
    channels: {
      cache: new Map([['chan-7', { guildId: 'guild-3' }]]),
    },
    guilds: {
      cache: new Map([
        [
          'guild-3',
          {
            members: {
              search: (): Promise<Map<string, { id: string }>> => Promise.resolve(new Map()),
              fetch: (id: string): Promise<{ displayName: string; user: { username: string } }> => {
                expect(id).toBe('user-9')
                return Promise.resolve({ displayName: 'John Johnson', user: { username: 'itsmike' } })
              },
            },
          },
        ],
      ]),
    },
  })

  const label = await provider.resolveUserLabel?.('user-9', { contextId: 'chan-7', contextType: 'group' })
  expect(label).toBe('John Johnson (@itsmike)')
})

test('resolveUserLabel falls back to global user fetch when guild context is unavailable', async () => {
  const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
  const provider = new DiscordChatProvider()

  provider.testSetClient({
    destroy: (): Promise<void> => Promise.resolve(),
    users: {
      fetch: (
        id: string,
      ): Promise<{
        displayName: string
        username: string
        createDM: () => Promise<{ send: (arg: { content: string }) => Promise<unknown> }>
      }> => {
        expect(id).toBe('user-12')
        return Promise.resolve({
          displayName: 'Jane Admin',
          username: 'janeadmin',
          createDM: () => Promise.resolve({ send: (): Promise<unknown> => Promise.resolve(null) }),
        })
      },
    },
  })

  const label = await provider.resolveUserLabel?.('user-12', { contextId: 'dm-user', contextType: 'dm' })
  expect(label).toBe('Jane Admin (@janeadmin)')
})
```

- [ ] **Step 2: Run the Discord provider test file and verify it fails**

Run:

```bash
bun test tests/chat/discord/index.test.ts
```

Expected: FAIL because the client structural types and provider methods do not yet support the new lookups.

- [ ] **Step 3: Widen the Discord structural types and type guards**

Edit `src/chat/discord/client-factory.ts` to support the fetches used by label resolution:

```typescript
export type DiscordClientLike = {
  destroy: () => Promise<void>
  users?: {
    fetch: (id: string) => Promise<{
      username?: string
      displayName?: string
      globalName?: string | null
      createDM: () => Promise<{ send: (arg: { content: string }) => Promise<unknown> }>
    }>
  }
  channels?: {
    cache: { get(id: string): unknown }
    fetch?: (id: string) => Promise<{ name?: string } | null>
  }
  guilds?: { cache: { get(id: string): unknown } }
}

export type GuildLike = {
  members: {
    search: (arg: { query: string; limit: number }) => Promise<Map<string, { id: string }>>
    fetch?: (id: string) => Promise<{
      displayName?: string
      user?: { username?: string; displayName?: string; globalName?: string | null }
    }>
  }
}
```

Then edit `src/chat/discord/type-guards.ts` so the guild guard accepts the richer member manager shape:

```typescript
export function isGuildLike(v: unknown): v is GuildLike {
  if (typeof v !== 'object' || v === null || !('members' in v)) return false
  const members = v.members
  return typeof members === 'object' && members !== null && 'search' in members && typeof members.search === 'function'
}
```

- [ ] **Step 4: Implement the label formatting and reverse lookups in `src/chat/discord/index.ts`**

Add helper functions near the logger:

```typescript
function formatDiscordUserLabel(displayName: string | null, username: string | null): string | null {
  if (displayName !== null && username !== null && displayName !== username) {
    return `${displayName} (@${username})`
  }
  if (displayName !== null) {
    return displayName
  }
  if (username !== null) {
    return `@${username}`
  }
  return null
}

function getDiscordUserDisplayName(user: {
  displayName?: string
  globalName?: string | null
  username?: string
}): string | null {
  if (user.displayName !== undefined && user.displayName !== '') return user.displayName
  if (user.globalName !== undefined && user.globalName !== null && user.globalName !== '') return user.globalName
  return null
}
```

Then add methods to the class after `resolveUserId`:

```typescript
  async resolveGroupLabel(groupId: string): Promise<string | null> {
    if (this.client === null || this.client.channels === undefined) return null

    const cached = this.client.channels.cache.get(groupId)
    if (typeof cached === 'object' && cached !== null && 'name' in cached && typeof cached.name === 'string') {
      return cached.name
    }

    if (this.client.channels.fetch === undefined) return null

    try {
      const channel = await this.client.channels.fetch(groupId)
      if (channel === null || channel === undefined) return null
      return typeof channel.name === 'string' && channel.name.length > 0 ? channel.name : null
    } catch (error) {
      log.warn({ groupId, error: error instanceof Error ? error.message : String(error) }, 'Discord group label lookup failed')
      return null
    }
  }

  async resolveUserLabel(userId: string, context?: ResolveUserContext): Promise<string | null> {
    if (this.client === null) return null

    if (context?.contextType === 'group' && this.client.channels !== undefined && this.client.guilds !== undefined) {
      const rawChannel = this.client.channels.cache.get(context.contextId)
      if (typeof rawChannel === 'object' && rawChannel !== null && 'guildId' in rawChannel && typeof rawChannel.guildId === 'string') {
        const rawGuild = this.client.guilds.cache.get(rawChannel.guildId)
        if (isGuildLike(rawGuild) && rawGuild.members.fetch !== undefined) {
          try {
            const member = await rawGuild.members.fetch(userId)
            const memberDisplayName = member.displayName !== undefined && member.displayName !== '' ? member.displayName : null
            const username = member.user?.username !== undefined && member.user.username !== '' ? member.user.username : null
            const label = formatDiscordUserLabel(memberDisplayName, username)
            if (label !== null) return label
          } catch (error) {
            log.warn(
              { userId, contextId: context.contextId, error: error instanceof Error ? error.message : String(error) },
              'Discord guild member label lookup failed',
            )
          }
        }
      }
    }

    if (this.client.users === undefined) return null

    try {
      const user = await this.client.users.fetch(userId)
      const displayName = getDiscordUserDisplayName(user)
      const username = user.username !== undefined && user.username !== '' ? user.username : null
      return formatDiscordUserLabel(displayName, username)
    } catch (error) {
      log.warn({ userId, error: error instanceof Error ? error.message : String(error) }, 'Discord user label lookup failed')
      return null
    }
  }
```

- [ ] **Step 5: Run the Discord provider tests to verify they pass**

Run:

```bash
bun test tests/chat/discord/index.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the Discord provider support**

```bash
git add src/chat/discord/client-factory.ts src/chat/discord/type-guards.ts src/chat/discord/index.ts tests/chat/discord/index.test.ts
git commit -m "feat: resolve readable labels for discord groups and users"
```

---

### Task 5: Implement Telegram best-effort reverse label resolution

**Files:**

- Modify: `src/chat/telegram/index.ts`
- Test: `tests/chat/telegram/index.test.ts`

- [ ] **Step 1: Write the failing Telegram tests**

Add these tests to `tests/chat/telegram/index.test.ts`:

```typescript
test('resolveGroupLabel returns chat title from getChat', async () => {
  process.env['TELEGRAM_BOT_TOKEN'] = 'test-token'
  const provider = new TelegramChatProvider()
  const fakeBot = Reflect.get(provider, 'bot') as {
    api: {
      getChat: (chatId: number) => Promise<{ title?: string }>
    }
  }

  fakeBot.api.getChat = (chatId: number): Promise<{ title?: string }> => {
    expect(chatId).toBe(-1003768634358)
    return Promise.resolve({ title: 'Engineering Chat' })
  }

  const label = await provider.resolveGroupLabel?.('-1003768634358')
  expect(label).toBe('Engineering Chat')
  delete process.env['TELEGRAM_BOT_TOKEN']
})

test('resolveUserLabel returns full name and username from getChatMember', async () => {
  process.env['TELEGRAM_BOT_TOKEN'] = 'test-token'
  const provider = new TelegramChatProvider()
  const fakeBot = Reflect.get(provider, 'bot') as {
    api: {
      getChatMember: (
        chatId: number | string,
        userId: number,
      ) => Promise<{ user?: { first_name?: string; last_name?: string; username?: string } }>
    }
  }

  fakeBot.api.getChatMember = (_chatId: number | string, userId: number) => {
    expect(userId).toBe(164696606)
    return Promise.resolve({
      user: { first_name: 'John', last_name: 'Johnson', username: 'itsmike' },
    })
  }

  const label = await provider.resolveUserLabel?.('164696606', { contextId: '-1003768634358', contextType: 'group' })
  expect(label).toBe('John Johnson (@itsmike)')
  delete process.env['TELEGRAM_BOT_TOKEN']
})

test('resolveUserLabel returns null for non-numeric Telegram user IDs', async () => {
  process.env['TELEGRAM_BOT_TOKEN'] = 'test-token'
  const provider = new TelegramChatProvider()

  const label = await provider.resolveUserLabel?.('not-a-number', { contextId: '-1003768634358', contextType: 'group' })
  expect(label).toBeNull()
  delete process.env['TELEGRAM_BOT_TOKEN']
})
```

- [ ] **Step 2: Run the Telegram provider test file and verify it fails**

Run:

```bash
bun test tests/chat/telegram/index.test.ts
```

Expected: FAIL because the new provider methods do not exist.

- [ ] **Step 3: Implement Telegram formatting and best-effort lookups**

Edit `src/chat/telegram/index.ts`.

Add helpers near the logger:

```typescript
function formatTelegramUserLabel(user: { first_name?: string; last_name?: string; username?: string }): string | null {
  const firstName = user.first_name !== undefined && user.first_name !== '' ? user.first_name : null
  const lastName = user.last_name !== undefined && user.last_name !== '' ? user.last_name : null
  const displayName = [firstName, lastName]
    .filter((part) => part !== null)
    .join(' ')
    .trim()
  const username = user.username !== undefined && user.username !== '' ? `@${user.username}` : null

  if (displayName.length > 0 && username !== null) {
    return `${displayName} (${username})`
  }
  if (displayName.length > 0) {
    return displayName
  }
  return username
}
```

Then add methods to the class after `resolveUserId`:

```typescript
  async resolveGroupLabel(groupId: string): Promise<string | null> {
    const parsedGroupId = Number(groupId)
    if (!Number.isInteger(parsedGroupId)) return null

    try {
      const chat = await this.bot.api.getChat(parsedGroupId)
      return 'title' in chat && typeof chat.title === 'string' && chat.title.length > 0 ? chat.title : null
    } catch (error) {
      log.warn({ groupId, error: error instanceof Error ? error.message : String(error) }, 'Telegram group label lookup failed')
      return null
    }
  }

  async resolveUserLabel(userId: string, context?: ResolveUserContext): Promise<string | null> {
    const parsedUserId = Number(userId)
    if (!Number.isInteger(parsedUserId)) return null
    if (context === undefined || context.contextType !== 'group') return null

    const parsedChatId = Number(context.contextId)
    if (!Number.isInteger(parsedChatId)) return null

    try {
      const member = await this.bot.api.getChatMember(parsedChatId, parsedUserId)
      const rawUser = 'user' in member ? member.user : undefined
      if (rawUser === undefined || typeof rawUser !== 'object' || rawUser === null) return null
      return formatTelegramUserLabel(rawUser)
    } catch (error) {
      log.warn(
        { userId, contextId: context.contextId, error: error instanceof Error ? error.message : String(error) },
        'Telegram user label lookup failed',
      )
      return null
    }
  }
```

- [ ] **Step 4: Run the Telegram provider tests to verify the implementation passes**

Run:

```bash
bun test tests/chat/telegram/index.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the Telegram provider support**

```bash
git add src/chat/telegram/index.ts tests/chat/telegram/index.test.ts
git commit -m "feat: add best-effort telegram label resolution"
```

---

### Task 6: Full verification and cleanup

**Files:**

- Modify: none expected
- Verify: `tests/commands/group.test.ts`, `tests/chat/mattermost/index.test.ts`, `tests/chat/discord/index.test.ts`, `tests/chat/telegram/index.test.ts`

- [ ] **Step 1: Run the focused test suite for all touched behavior**

Run:

```bash
bun test tests/commands/group.test.ts tests/chat/mattermost/index.test.ts tests/chat/discord/index.test.ts tests/chat/telegram/index.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run lint on all touched source and test files**

Run:

```bash
bun run lint:agent-strict -- src/chat/types.ts src/commands/group.ts src/chat/mattermost/schema.ts src/chat/mattermost/index.ts src/chat/discord/client-factory.ts src/chat/discord/type-guards.ts src/chat/discord/index.ts src/chat/telegram/index.ts tests/utils/test-helpers.ts tests/commands/group.test.ts tests/chat/mattermost/index.test.ts tests/chat/discord/index.test.ts tests/chat/telegram/index.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run formatting check on the changed files**

Run:

```bash
bun format:check
```

Expected: PASS, or only unrelated pre-existing formatting noise if the worktree is dirty.

- [ ] **Step 4: Inspect git diff before handoff**

Run:

```bash
git diff -- src/chat/types.ts src/commands/group.ts src/chat/mattermost/schema.ts src/chat/mattermost/index.ts src/chat/discord/client-factory.ts src/chat/discord/type-guards.ts src/chat/discord/index.ts src/chat/telegram/index.ts tests/utils/test-helpers.ts tests/commands/group.test.ts tests/chat/mattermost/index.test.ts tests/chat/discord/index.test.ts tests/chat/telegram/index.test.ts
```

Expected: only the planned readable-label changes appear.

- [ ] **Step 5: Final commit**

```bash
git add src/chat/types.ts src/commands/group.ts src/chat/mattermost/schema.ts src/chat/mattermost/index.ts src/chat/discord/client-factory.ts src/chat/discord/type-guards.ts src/chat/discord/index.ts src/chat/telegram/index.ts tests/utils/test-helpers.ts tests/commands/group.test.ts tests/chat/mattermost/index.test.ts tests/chat/discord/index.test.ts tests/chat/telegram/index.test.ts
git commit -m "feat: show readable labels in group authorization output"
```

---

## Spec Coverage Check

- `ChatProvider` reverse-resolution contract: Task 1.
- `/groups` readable output with fallback: Task 2.
- `/group users` readable output with fallback: Task 2.
- Mattermost provider support: Task 3.
- Discord provider support: Task 4.
- Telegram best-effort provider support: Task 5.
- Non-fatal lookup failures and raw-ID fallback: Tasks 2-5.
- In-request memoization to avoid repeated lookups: Task 2.
- Focused command and provider tests: Tasks 1-6.

## Placeholder Scan

- No `TODO`, `TBD`, or deferred “implement later” placeholders remain.
- Every code-changing task includes exact file paths, code snippets, commands, and expected outcomes.

## Type Consistency Check

- Optional provider methods are named consistently as `resolveUserLabel` and `resolveGroupLabel` across interface, test helpers, command code, and provider implementations.
- User label formatting consistently targets `Display Name (@username)`.
- Command-layer helper names and provider method names match the design spec.
