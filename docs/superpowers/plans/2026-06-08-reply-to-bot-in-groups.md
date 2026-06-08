<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Reply-to-Bot in Group Chats — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow the bot to process messages in group chats when a user replies directly to one of the bot's messages, without requiring an `@mention`.

**Architecture:** Add `isReplyToBot` to `IncomingMessage`, set it in Telegram and Discord adapters by comparing the parent message author against the bot's user ID, and include it in the group-message ignore gate.

**Tech Stack:** TypeScript, Bun test runner, Grammy (Telegram), discord.js (Discord)

---

## File Structure

| File                                     | Change                                                                     |
| ---------------------------------------- | -------------------------------------------------------------------------- |
| `src/chat/types.ts`                      | Add `isReplyToBot?: boolean` to `IncomingMessage`                          |
| `src/bot.ts`                             | Update `shouldIgnoreGroupMessage()` and `willQueueAuthorizedMessage()`     |
| `src/bot-group-observation.ts`           | Update `recordGroupObservation()` gate to include `isReplyToBot`           |
| `src/chat/telegram/index.ts`             | Set `isReplyToBot` in `extractMessage()`                                   |
| `src/chat/discord/map-message.ts`        | Add `isReplyToBot` parameter, relax group filter, export `CHANNEL_TYPE_DM` |
| `src/chat/discord/index.ts`              | Pre-fetch parent (mention/DM short-circuit) to check bot authorship        |
| `CLAUDE.md`, `src/chat/CLAUDE.md`        | Note Discord now processes replies to bot messages in groups               |
| `tests/bot.test.ts`                      | Tests for gate + observation changes                                       |
| `tests/chat/telegram/index.test.ts`      | Test for Telegram `isReplyToBot`                                           |
| `tests/chat/discord/map-message.test.ts` | Tests for `isReplyToBot` parameter                                         |
| `tests/chat/discord/index.test.ts`       | Test for Discord dispatch with reply-to-bot                                |

---

### Task 1: Add `isReplyToBot` to `IncomingMessage` type

**Files:**

- Modify: `src/chat/types.ts:137-154`

- [ ] **Step 1: Add `isReplyToBot` field to `IncomingMessage`**

In `src/chat/types.ts`, add `isReplyToBot` to the `Partial` block of `IncomingMessage` (after `isMentioned` at line 133, or inside the `Partial` block around line 146):

```ts
/** Incoming message from a user. */
export type IncomingMessage = {
  user: ChatUser
  /** storage key: userId in DMs, groupId in groups */
  contextId: string
  contextType: ContextType
  /** bot was @mentioned */
  isMentioned: boolean
  text: string
  /** ID of the chat provider instance this message arrived on. */
  platformInstanceId: string
} & Partial<{
  /** Human-readable channel/group name when the adapter knows it */
  contextName: string
  /** Human-readable workspace/team/guild label when the adapter knows it */
  contextParentName: string
  commandMatch: string
  /** platform-specific message ID for deletion */
  messageId: string
  /** parent message ID if this is a reply */
  replyToMessageId: string
  /** Reply or quote context if this message is a reply */
  replyContext: ReplyContext
  /** Files attached to this message (populated by platform adapters) */
  files: IncomingFile[]
  fileCandidates: IncomingFileCandidate[]
  /** Platform thread ID (if in thread) */
  threadId: string
  /** message is a reply to one of the bot's own messages */
  isReplyToBot: boolean
}>
```

- [ ] **Step 2: Verify types compile**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/chat/types.ts
git commit -m "feat: add isReplyToBot field to IncomingMessage type"
```

---

### Task 2: Update group message gates in `src/bot.ts` and `src/bot-group-observation.ts`

The `!msg.isMentioned` group gate is duplicated across **three** sites. All three must change together, or a reply-to-bot message will be processed but inconsistently accounted for (Step 7 covers the third, easily-missed site: group observation).

**Files:**

- Modify: `src/bot.ts:126-130` (`shouldIgnoreGroupMessage`)
- Modify: `src/bot.ts:160-165` (`willQueueAuthorizedMessage`)
- Modify: `src/bot-group-observation.ts:15-17` (`recordGroupObservation`)
- Test: `tests/bot.test.ts`

- [ ] **Step 1: Write failing tests for the gate changes**

In `tests/bot.test.ts`, find the test `'does not record group observations for ignored non-mentioned natural language'` (around line 1081). Add a new test after it:

```ts
test('processes group message when user replies to bot message', async () => {
  addAuthorizedGroupForPlatform('group-reply', ADMIN_ID)
  addGroupMemberForPlatform('group-reply', 'reply-user', ADMIN_ID)
  setupUserConfig('group-reply')

  const messageHandler = getMessageHandler()
  expect(messageHandler).not.toBeNull()

  const groupMessage: IncomingMessage = {
    user: { id: 'reply-user', username: 'replyuser', isAdmin: false },
    contextId: 'group-reply',
    contextType: 'group',
    contextName: 'Reply Group',
    isMentioned: false,
    isReplyToBot: true,
    text: 'what about this one?',
    platformInstanceId: 'test-instance',
    replyToMessageId: 'bot-msg-123',
  }

  const { reply } = createMockReply()
  await messageHandler!(groupMessage, reply)

  expect(processMessageCallCount).toBe(1)
})

test('ignores group message when not mentioned and not replying to bot', async () => {
  addAuthorizedGroupForPlatform('group-ignore', ADMIN_ID)
  addGroupMemberForPlatform('group-ignore', 'ignore-user', ADMIN_ID)
  setupUserConfig('group-ignore')

  const messageHandler = getMessageHandler()
  expect(messageHandler).not.toBeNull()

  const groupMessage: IncomingMessage = {
    user: { id: 'ignore-user', username: 'ignoreuser', isAdmin: false },
    contextId: 'group-ignore',
    contextType: 'group',
    isMentioned: false,
    isReplyToBot: false,
    text: 'random chatter',
    platformInstanceId: 'test-instance',
  }

  const { reply } = createMockReply()
  await messageHandler!(groupMessage, reply)

  expect(processMessageCallCount).toBe(0)
})

test('records group observation when user replies to bot without mention', async () => {
  addAuthorizedGroupForPlatform('group-obs', ADMIN_ID)
  addGroupMemberForPlatform('group-obs', 'obs-user', ADMIN_ID)
  setupUserConfig('group-obs')

  const messageHandler = getMessageHandler()
  expect(messageHandler).not.toBeNull()

  const groupMessage: IncomingMessage = {
    user: { id: 'obs-user', username: 'obsuser', isAdmin: false },
    contextId: 'group-obs',
    contextType: 'group',
    contextName: 'Obs Group',
    contextParentName: 'Platform',
    isMentioned: false,
    isReplyToBot: true,
    text: 'follow-up question',
    platformInstanceId: 'test-instance',
    replyToMessageId: 'bot-msg-9',
  }

  const { reply } = createMockReply()
  await messageHandler!(groupMessage, reply)

  const db = getDrizzleDb()
  const knownGroup = db
    .select()
    .from(knownGroupContexts)
    .where(and(eq(knownGroupContexts.provider, 'mock'), eq(knownGroupContexts.contextId, 'group-obs')))
    .get()
  const adminObservation = db
    .select()
    .from(groupAdminObservations)
    .where(
      and(
        eq(groupAdminObservations.provider, 'mock'),
        eq(groupAdminObservations.contextId, 'group-obs'),
        eq(groupAdminObservations.userId, 'obs-user'),
      ),
    )
    .get()

  expect(knownGroup).toBeDefined()
  expect(adminObservation).toBeDefined()
})
```

> Note: the existing test `'does not record group observations for ignored non-mentioned natural language'` (line 1081) asserts on `contextId: 'group-noise'` directly (not `scopedGroup('group-noise')`). Match whichever `contextId` convention you find in that sibling test when asserting the new observation, since both target the same registry.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/bot.test.ts`
Expected: The new tests fail (message not processed when `isReplyToBot: true`, or processed when `isReplyToBot: false`)

- [ ] **Step 3: Update `shouldIgnoreGroupMessage()`**

In `src/bot.ts`, change line 129:

```ts
// Before
function shouldIgnoreGroupMessage(msg: IncomingMessage): boolean {
  if (msg.contextType !== 'group') return false
  if (msg.commandMatch !== undefined && msg.commandMatch !== '') return false
  return !msg.isMentioned
}

// After
function shouldIgnoreGroupMessage(msg: IncomingMessage): boolean {
  if (msg.contextType !== 'group') return false
  if (msg.commandMatch !== undefined && msg.commandMatch !== '') return false
  return !msg.isMentioned && !msg.isReplyToBot
}
```

- [ ] **Step 4: Update `willQueueAuthorizedMessage()`**

In `src/bot.ts`, change line 164:

```ts
// Before
function willQueueAuthorizedMessage(msg: IncomingMessage, auth: AuthorizationResult): boolean {
  if (!auth.allowed) return false
  if (msg.contextType !== 'group') return true
  if (msg.commandMatch !== undefined) return true
  return msg.isMentioned
}

// After
function willQueueAuthorizedMessage(msg: IncomingMessage, auth: AuthorizationResult): boolean {
  if (!auth.allowed) return false
  if (msg.contextType !== 'group') return true
  if (msg.commandMatch !== undefined) return true
  return msg.isMentioned || msg.isReplyToBot === true
}
```

- [ ] **Step 5: Update `recordGroupObservation()`** (the third, easily-missed gate site)

In `src/bot-group-observation.ts`, change the early-return guard (line 17):

```ts
// Before
export function recordGroupObservation(chat: ChatProvider, msg: IncomingMessage): void {
  if (msg.contextType !== 'group') return
  if (msg.commandMatch === undefined && !msg.isMentioned) return
  // ...

// After
export function recordGroupObservation(chat: ChatProvider, msg: IncomingMessage): void {
  if (msg.contextType !== 'group') return
  if (msg.commandMatch === undefined && !msg.isMentioned && !msg.isReplyToBot) return
  // ...
```

Without this, the `processes`/`records observation` tests both run, but a reply-to-bot user is processed yet never recorded in the group-settings registry.

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test tests/bot.test.ts`
Expected: All tests pass, including the new ones (including `records group observation when user replies to bot without mention`)

- [ ] **Step 7: Commit**

```bash
git add src/bot.ts src/bot-group-observation.ts tests/bot.test.ts
git commit -m "feat: process and observe group messages that reply to bot"
```

---

### Task 3: Set `isReplyToBot` in Telegram adapter

**Files:**

- Modify: `src/chat/telegram/index.ts:189-219` (`extractMessage`)
- Test: `tests/chat/telegram/index.test.ts`

- [ ] **Step 1: Write failing test**

In `tests/chat/telegram/index.test.ts`, add a new test inside the `TelegramChatProvider` describe block. Use `Reflect.get` to access the private `extractMessage` method (same pattern as existing tests at lines 431-472):

```ts
test('sets isReplyToBot when reply targets bot own message', async () => {
  const provider = createTelegramProvider()
  const extractMessage: unknown = Reflect.get(provider, 'extractMessage')
  assert(typeof extractMessage === 'function', 'extractMessage not available')

  Reflect.set(provider, 'checkAdminStatus', (): Promise<boolean> => Promise.resolve(false))

  const botUserId = 99999
  const fakeCtx = {
    from: { id: 42, username: 'alice' },
    chat: { id: -100123, type: 'supergroup' },
    me: { id: botUserId },
    message: {
      message_id: 50,
      text: 'what did you mean?',
      reply_to_message: {
        message_id: 42,
        from: { id: botUserId, username: 'mybot' },
        text: 'Here is my answer',
      },
      entities: [],
    },
    api: {
      getChat: () => Promise.resolve({ type: 'supergroup' }),
      createForumTopic: () => Promise.resolve({ message_thread_id: 1 }),
    },
  }

  const result = await (extractMessage as (ctx: unknown, isAdmin: boolean) => Promise<IncomingMessage | null>).call(
    provider,
    fakeCtx,
    false,
  )

  expect(result).not.toBeNull()
  expect(result!.isReplyToBot).toBe(true)
  expect(result!.isMentioned).toBe(false)
})

test('sets isReplyToBot to false when reply targets non-bot user', async () => {
  const provider = createTelegramProvider()
  const extractMessage: unknown = Reflect.get(provider, 'extractMessage')
  assert(typeof extractMessage === 'function', 'extractMessage not available')

  Reflect.set(provider, 'checkAdminStatus', (): Promise<boolean> => Promise.resolve(false))

  const fakeCtx = {
    from: { id: 42, username: 'alice' },
    chat: { id: -100123, type: 'supergroup' },
    me: { id: 99999 },
    message: {
      message_id: 50,
      text: 'reply to someone else',
      reply_to_message: {
        message_id: 30,
        from: { id: 77, username: 'bob' },
        text: 'original message',
      },
      entities: [],
    },
    api: {
      getChat: () => Promise.resolve({ type: 'supergroup' }),
      createForumTopic: () => Promise.resolve({ message_thread_id: 1 }),
    },
  }

  const result = await (extractMessage as (ctx: unknown, isAdmin: boolean) => Promise<IncomingMessage | null>).call(
    provider,
    fakeCtx,
    false,
  )

  expect(result).not.toBeNull()
  expect(result!.isReplyToBot).toBe(false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/chat/telegram/index.test.ts`
Expected: FAIL — `isReplyToBot` is `undefined`

- [ ] **Step 3: Set `isReplyToBot` in `extractMessage()`**

In `src/chat/telegram/index.ts`, in `extractMessage()` (around line 198), after `const replyContext = extractReplyContext(ctx, contextId)`, add:

```ts
const isReplyToBot = replyContext?.authorId !== undefined && String(ctx.me?.id) === replyContext.authorId
```

Then include `isReplyToBot` in the returned `IncomingMessage` object (around line 206):

```ts
return {
  user: { id: String(id), username, displayLabel, isAdmin },
  contextId,
  contextType,
  contextName,
  isMentioned,
  isReplyToBot,
  text,
  platformInstanceId: this.platformInstanceId,
  messageId: messageIdStr,
  replyToMessageId: replyToMessageIdStr,
  replyContext,
  threadId,
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/chat/telegram/index.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/chat/telegram/index.ts tests/chat/telegram/index.test.ts
git commit -m "feat(telegram): set isReplyToBot when reply targets bot message"
```

---

### Task 4: Add `isReplyToBot` parameter to Discord `mapDiscordMessage()`

**Files:**

- Modify: `src/chat/discord/map-message.ts:32-76`
- Test: `tests/chat/discord/map-message.test.ts`

- [ ] **Step 1: Write failing tests**

In `tests/chat/discord/map-message.test.ts`, add new tests:

```ts
test('passes group message with isReplyToBot even without mention', () => {
  const msg = makeMsg({
    content: 'what about this?',
    mentions: { has: () => false },
    reference: { messageId: 'bot-msg-1' },
  })
  const result = mapDiscordMessage(msg, botId, platformInstanceId, true)
  expect(result).not.toBeNull()
  expect(result!.isReplyToBot).toBe(true)
  expect(result!.isMentioned).toBe(false)
  expect(result!.replyToMessageId).toBe('bot-msg-1')
})

test('still returns null for group message without mention and without isReplyToBot', () => {
  const msg = makeMsg({
    content: 'unrelated chatter',
    mentions: { has: () => false },
  })
  const result = mapDiscordMessage(msg, botId, platformInstanceId, false)
  expect(result).toBeNull()
})

test('defaults isReplyToBot to false when parameter omitted', () => {
  const msg = makeMsg({ content: `<@${botId}> hello` })
  const result = mapDiscordMessage(msg, botId, platformInstanceId)
  expect(result).not.toBeNull()
  expect(result!.isReplyToBot).toBe(false)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/chat/discord/map-message.test.ts`
Expected: FAIL — `isReplyToBot` not recognized, or group message still filtered

- [ ] **Step 3: Update `mapDiscordMessage()` signature and filter**

In `src/chat/discord/map-message.ts`:

Export the existing DM-channel-type constant so `dispatchMessage()` (Task 5) can reuse it instead of an inline `1` (line 26):

```ts
// Before
const CHANNEL_TYPE_DM = 1
// After
export const CHANNEL_TYPE_DM = 1
```

Update the function signature (line 32):

```ts
export function mapDiscordMessage(
  message: DiscordMessageLike,
  botId: string,
  platformInstanceId: string,
  isReplyToBot = false,
): IncomingMessage | null {
```

Update the filter (line 50):

```ts
if (contextType === 'group' && !mentioned && !isReplyToBot) {
  return null
}
```

Include `isReplyToBot` in the return object:

```ts
return {
  user: {
    id: message.author.id,
    username: message.author.username.length > 0 ? message.author.username : null,
    isAdmin: false,
  },
  contextId,
  contextType,
  contextName,
  contextParentName,
  isMentioned: mentioned,
  isReplyToBot,
  text,
  platformInstanceId,
  messageId: message.id,
  replyToMessageId,
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/chat/discord/map-message.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/chat/discord/map-message.ts tests/chat/discord/map-message.test.ts
git commit -m "feat(discord): add isReplyToBot parameter to mapDiscordMessage"
```

---

### Task 5: Pre-fetch parent message in Discord `dispatchMessage()`

**Files:**

- Modify: `src/chat/discord/index.ts:225-260` (`dispatchMessage`)
- Test: `tests/chat/discord/index.test.ts`

- [ ] **Step 1: Write failing test**

In `tests/chat/discord/index.test.ts`, add a test for reply-to-bot dispatch:

```ts
test('dispatches reply-to-bot message in group without @mention', async () => {
  const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
  const provider = new DiscordChatProvider({
    token: 'fake-discord-token',
    platformInstanceId: TEST_PLATFORM_ID,
  })

  const seen: IncomingMessage[] = []
  provider.onMessage((msg): Promise<void> => {
    seen.push(msg)
    return Promise.resolve()
  })

  const fakeMessage = {
    id: 'm3',
    author: { id: 'u3', username: 'charlie', bot: false },
    content: 'what did you mean by that?',
    channel: {
      id: 'c3',
      type: 0,
      send: (): Promise<{ id: string; edit: () => Promise<void> }> =>
        Promise.resolve({
          id: 'out3',
          edit: (): Promise<void> => Promise.resolve(),
        }),
      sendTyping: (): Promise<void> => Promise.resolve(),
      messages: {
        fetch: (
          id: string,
        ): Promise<{
          id: string
          author: { id: string; username: string }
          content: string
        }> =>
          Promise.resolve({
            id,
            author: { id: 'bot_id', username: 'mybot' },
            content: 'previous bot message',
          }),
      },
    },
    mentions: { has: (): boolean => false },
    reference: { messageId: 'bot-msg-42' },
    type: 0,
  }
  await provider.testDispatchMessage(fakeMessage, 'bot_id')

  expect(seen).toHaveLength(1)
  expect(seen[0]!.isReplyToBot).toBe(true)
  expect(seen[0]!.isMentioned).toBe(false)
  expect(seen[0]!.text).toBe('what did you mean by that?')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/chat/discord/index.test.ts`
Expected: FAIL — message is dropped (returns null from `mapDiscordMessage`)

- [ ] **Step 3: Update `dispatchMessage()` to pre-check reply-to-bot**

In `src/chat/discord/index.ts`, add `isBotMentioned` and `CHANNEL_TYPE_DM` to the existing import from `./map-message.js` (verify the exact import line; `mapDiscordMessage` is already imported there). `isBotMentioned` is exported from `./mention-helpers.js`:

```ts
import { CHANNEL_TYPE_DM, mapDiscordMessage } from './map-message.js'
import { isBotMentioned } from './mention-helpers.js'
```

Then update `dispatchMessage()` (line 225):

```ts
private async dispatchMessage(message: DispatchableMessage, botId: string): Promise<void> {
  // Pre-check: is this a reply to the bot's own message? Skip the fetch when
  // already mentioned (it passes the filter regardless) or in a DM channel.
  let isReplyToBot = false
  const mentioned = isBotMentioned(message.mentions, botId, 'group')
  if (message.reference?.messageId !== undefined && message.channel.type !== CHANNEL_TYPE_DM && !mentioned) {
    const messages = message.channel.messages
    if (messages !== undefined) {
      try {
        const parent = await messages.fetch(message.reference.messageId)
        isReplyToBot = parent.author.id === botId
      } catch {
        // Parent fetch failed — not a blocker, treat as non-reply
      }
    }
  }

  const mapped = mapDiscordMessage(message, botId, this.platformInstanceId, isReplyToBot)
  if (mapped === null) return
  // ... rest unchanged ...
```

`isBotMentioned(message.mentions, botId, 'group')` reuses the same mention check `mapDiscordMessage()` runs; `'group'` is fixed here because the short-circuit only matters in non-DM channels (DMs are excluded by the `CHANNEL_TYPE_DM` guard anyway).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/chat/discord/index.test.ts`
Expected: PASS

- [ ] **Step 5: Run all affected test suites**

Run: `bun test tests/bot.test.ts tests/chat/telegram/index.test.ts tests/chat/discord/map-message.test.ts tests/chat/discord/index.test.ts`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src/chat/discord/index.ts tests/chat/discord/index.test.ts
git commit -m "feat(discord): pre-fetch parent to detect reply-to-bot in groups"
```

---

### Task 6: Update documentation

The current docs state Discord only observes DMs + `@mention`. Reply-to-bot is a new group-processing path and must be reflected.

- [ ] **Step 1: Update `src/chat/CLAUDE.md`**

Find the "Group behavior differs by provider" line ("Discord observes DMs plus `@bot` mentions in guild channels") and amend it to note Discord also processes **replies to the bot's own messages** in guild channels.

- [ ] **Step 2: Update root `CLAUDE.md`**

In the "Notable non-obvious behaviors" / group-context discussion, add a one-line note that Telegram and Discord process replies to bot messages in groups as equivalent to an `@mention` (Mattermost/Kontur Talk excluded).

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md src/chat/CLAUDE.md
git commit -m "docs: note reply-to-bot group processing for telegram and discord"
```

---

### Task 7: Final verification

- [ ] **Step 1: Run full typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 2: Run full test suite**

Run: `bun test`
Expected: PASS

- [ ] **Step 3: Run lint and format check**

Run: `bun run check:full`
Expected: PASS

- [ ] **Step 4: Commit any formatting fixes**

```bash
git add -A
git commit -m "chore: format and lint fixes for reply-to-bot feature"
```
