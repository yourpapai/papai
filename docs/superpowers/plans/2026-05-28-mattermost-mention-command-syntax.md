<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mattermost Mention-Prefixed Command Syntax Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change Mattermost command recognition so papai only accepts mention-prefixed commands of the form `@papai /command`, removes bare `/command` handling, and preserves mention-based natural-language behavior.

**Architecture:** Keep command handlers untouched and localize the behavior change to `MattermostChatProvider`. Add a normalization/classification helper in the provider path so command routing depends on a leading mention followed by slash-like command text, while ordinary mention-addressed natural language still reaches the main message flow.

**Tech Stack:** TypeScript, Bun test runner, Mattermost WebSocket event mapping, existing provider tests in `tests/chat/mattermost/index.test.ts`

---

### Task 1: Lock In The New Mattermost Syntax With Provider Tests

**Files:**

- Modify: `tests/chat/mattermost/index.test.ts`
- Test: `tests/chat/mattermost/index.test.ts`

- [ ] **Step 1: Add a failing test for mention-prefixed command routing**

```typescript
test('routes @mention-prefixed slash text to the registered command handler', async () => {
  setMockFetch(makeFetchWithGroupChannel('O'))

  provider = new MattermostChatProvider()
  // @ts-expect-error testing private state setup
  provider.botUsername = 'testbot'

  let commandCalled = false
  provider.registerCommand('config', () => {
    commandCalled = true
    return Promise.resolve()
  })

  const handlePostedEvent = getPostedEventHandler(provider)

  await handlePostedEvent.call(provider, {
    sender_name: 'testuser',
    post: JSON.stringify({
      id: 'post123',
      user_id: 'user456',
      channel_id: 'channel789',
      message: '@testbot /config',
      root_id: '',
      parent_id: '',
    }),
  })

  expect(commandCalled).toBe(true)

  restoreFetch()
})
```

- [ ] **Step 2: Add a failing test proving bare `/command` no longer routes**

```typescript
test('does not route bare slash text to papai command handlers', async () => {
  setMockFetch(makeFetchWithGroupChannel('O'))

  provider = new MattermostChatProvider()

  let commandCalled = false
  provider.registerCommand('config', () => {
    commandCalled = true
    return Promise.resolve()
  })

  const handlePostedEvent = getPostedEventHandler(provider)

  await handlePostedEvent.call(provider, {
    sender_name: 'testuser',
    post: JSON.stringify({
      id: 'post123',
      user_id: 'user456',
      channel_id: 'channel789',
      message: '/config',
      root_id: '',
      parent_id: '',
    }),
  })

  expect(commandCalled).toBe(false)

  restoreFetch()
})
```

- [ ] **Step 3: Add a failing test for mention-prefixed natural language**

```typescript
test('keeps mention-prefixed natural language on the message flow', async () => {
  setMockFetch(makeFetchWithGroupChannel('O'))

  provider = new MattermostChatProvider()
  // @ts-expect-error testing private state setup
  provider.botUsername = 'testbot'

  let seen: IncomingMessage | null = null
  provider.onMessage(async (msg) => {
    seen = msg
  })

  const handlePostedEvent = getPostedEventHandler(provider)

  await handlePostedEvent.call(provider, {
    sender_name: 'testuser',
    post: JSON.stringify({
      id: 'post123',
      user_id: 'user456',
      channel_id: 'channel789',
      message: '@testbot summarize this thread',
      root_id: '',
      parent_id: '',
    }),
  })

  expect(seen).not.toBeNull()
  expect(seen?.isMentioned).toBe(true)
  expect(seen?.text).toBe('summarize this thread')
  expect(seen?.commandMatch).toBeUndefined()

  restoreFetch()
})
```

- [ ] **Step 4: Run the focused Mattermost provider tests and confirm failure**

Run: `bun test tests/chat/mattermost/index.test.ts`

Expected: FAIL because the provider still matches bare `/command` and does not normalize mention-prefixed command text.

- [ ] **Step 5: Commit the failing test additions**

```bash
git add tests/chat/mattermost/index.test.ts
git commit -m "test(mattermost): cover mention-prefixed command syntax"
```

### Task 2: Normalize Mention-Prefixed Mattermost Messages Before Command Matching

**Files:**

- Modify: `src/chat/mattermost/index.ts`
- Test: `tests/chat/mattermost/index.test.ts`

- [ ] **Step 1: Add a small normalization helper inside the Mattermost provider module**

```typescript
type NormalizedMattermostText = {
  readonly text: string
  readonly isMentioned: boolean
  readonly commandInput: string | null
}

function normalizeMattermostMessageText(message: string, botUsername: string | null): NormalizedMattermostText {
  const trimmed = message.trim()

  if (botUsername === null) {
    return { text: trimmed, isMentioned: false, commandInput: null }
  }

  const mentionPrefix = `@${botUsername}`
  if (!trimmed.startsWith(mentionPrefix)) {
    return { text: trimmed, isMentioned: false, commandInput: null }
  }

  const remainder = trimmed.slice(mentionPrefix.length).trim()
  return {
    text: remainder,
    isMentioned: true,
    commandInput: remainder.startsWith('/') ? remainder : null,
  }
}
```

- [ ] **Step 2: Use the normalization helper in `buildPostedMessage()` before command matching**

```typescript
const normalized = normalizeMattermostMessageText(post.message, this.botUsername)
const isMentioned = normalized.isMentioned
const threadId = this.determineThreadId(post, isMentioned, contextType, replyToMessageId)
const reply = this.buildReplyFn(post.channel_id, post.id, threadId)
const command = normalized.commandInput === null ? null : this.matchCommand(normalized.commandInput)

const msg: IncomingMessage = {
  user: { id: post.user_id, username, isAdmin },
  contextId: post.channel_id,
  contextType,
  contextName,
  contextParentName,
  isMentioned,
  text: normalized.text,
  platformInstanceId: this.platformInstanceId,
  commandMatch: command === null ? undefined : command.match,
  messageId: post.id,
  replyToMessageId,
  replyContext,
  threadId,
  ...(files ? { files } : {}),
  ...(fileCandidates ? { fileCandidates } : {}),
}
```

- [ ] **Step 3: Restrict `matchCommand()` to already-normalized slash input**

```typescript
private matchCommand(text: string): { handler: CommandHandler; match: string } | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('/')) return null

  for (const [name, handler] of this.commands) {
    if (trimmed === `/${name}` || trimmed.startsWith(`/${name} `)) {
      return {
        handler,
        match: trimmed.slice(name.length + 1).trim(),
      }
    }
  }

  return null
}
```

- [ ] **Step 4: Run the Mattermost provider test suite and confirm the new syntax passes**

Run: `bun test tests/chat/mattermost/index.test.ts`

Expected: PASS

- [ ] **Step 5: Commit the normalization implementation**

```bash
git add src/chat/mattermost/index.ts tests/chat/mattermost/index.test.ts
git commit -m "feat(mattermost): require mention-prefixed commands"
```

### Task 3: Add Guidance For Empty Mention-Only Messages

**Files:**

- Modify: `tests/chat/mattermost/index.test.ts`
- Modify: `src/chat/mattermost/index.ts`
- Test: `tests/chat/mattermost/index.test.ts`

- [ ] **Step 1: Add a failing test for mention-only guidance**

```typescript
import { createMockReply } from '../../utils/test-helpers.js'

test('replies with guidance when a message only mentions the bot', async () => {
  setMockFetch(makeFetchWithGroupChannel('O'))

  provider = new MattermostChatProvider()
  // @ts-expect-error testing private state setup
  provider.botUsername = 'testbot'

  const replies = createMockReply()
  provider.onMessage(async (_msg, reply) => {
    await reply.text('should not be called')
  })

  // @ts-expect-error testing private method replacement
  provider.buildReplyFn = () => replies.reply

  const handlePostedEvent = getPostedEventHandler(provider)

  await handlePostedEvent.call(provider, {
    sender_name: 'testuser',
    post: JSON.stringify({
      id: 'post123',
      user_id: 'user456',
      channel_id: 'channel789',
      message: '@testbot',
      root_id: '',
      parent_id: '',
    }),
  })

  expect(replies.getReplies()).toEqual(['Use `@papai /help` to see commands, or mention me with a question.'])

  restoreFetch()
})
```

- [ ] **Step 2: Run the focused empty-mention test and confirm failure**

Run: `bun test tests/chat/mattermost/index.test.ts --test-name-pattern "only mentions the bot"`

Expected: FAIL because empty mention-only input still falls through the normal message path.

- [ ] **Step 3: Handle mention-only empty input before normal message dispatch**

```typescript
private async handlePostedEvent(data: Record<string, unknown>): Promise<void> {
  const parsed = parsePostedEvent(data)
  if (parsed === null) return

  const { post, senderName } = parsed
  if (post.user_id === this.botUserId) return

  const replyToMessageId = extractReplyId(post.parent_id, post.root_id)
  cacheIncomingPost(post, replyToMessageId, senderName)
  const { msg, reply, command, isAdmin } = await this.buildPostedMessage(post, senderName, replyToMessageId)

  if (msg.isMentioned && msg.text === '') {
    await reply.text('Use `@papai /help` to see commands, or mention me with a question.')
    return
  }

  if (command !== null) {
    const auth = buildScopedCommandAuth(msg, isAdmin, this.platformInstanceId)
    await command.handler(msg, reply, auth)
    return
  }

  if (this.messageHandler !== null) {
    await this.messageHandler(msg, reply)
  }
}
```

- [ ] **Step 4: Run the Mattermost provider tests again and confirm they pass**

Run: `bun test tests/chat/mattermost/index.test.ts`

Expected: PASS

- [ ] **Step 5: Commit the mention-only guidance behavior**

```bash
git add src/chat/mattermost/index.ts tests/chat/mattermost/index.test.ts
git commit -m "feat(mattermost): guide mention-only messages"
```

### Task 4: Verify The Full Mattermost Behavior And Repo Checks

**Files:**

- Test: `tests/chat/mattermost/index.test.ts`
- Test: `tests/bot.test.ts` (only if command flow regressions are discovered)

- [ ] **Step 1: Run the focused Mattermost verification suite**

Run: `bun test tests/chat/mattermost/index.test.ts`

Expected: PASS

- [ ] **Step 2: Run strict lint on the touched source and test file**

Run: `bun run lint:agent-strict -- src/chat/mattermost/index.ts tests/chat/mattermost/index.test.ts`

Expected: PASS

- [ ] **Step 3: Run formatting check on the touched files**

Run: `bun format:check src/chat/mattermost/index.ts tests/chat/mattermost/index.test.ts`

Expected: PASS

- [ ] **Step 4: Commit the verification pass**

```bash
git add src/chat/mattermost/index.ts tests/chat/mattermost/index.test.ts
git commit -m "test(mattermost): verify mention command flow"
```
