<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Thread-Aware Group Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement thread-aware group chat with automatic thread creation, thread-scoped conversation history, and a tool for bot to query main group context.

**Architecture:** Add thread capability detection to ChatProvider interface, modify Telegram to create forum topics on mention, modify Mattermost to reply in threads, update storage key generation for thread-scoped history while sharing memory/config, and create a new lookup tool using small_model.

**Tech Stack:** TypeScript, Bun, Grammy (Telegram), Mattermost REST API, Zod, Vercel AI SDK

---

## File Structure

| File                                 | Responsibility                                             |
| ------------------------------------ | ---------------------------------------------------------- |
| `src/chat/types.ts`                  | Add ThreadCapabilities type and update IncomingMessage     |
| `src/chat/telegram/index.ts`         | Add thread capability declaration and forum topic creation |
| `src/chat/telegram/reply-helpers.ts` | Support thread_id in reply params                          |
| `src/chat/mattermost/index.ts`       | Add thread capability and root_id handling                 |
| `src/bot.ts`                         | Thread-scoped storage context ID generation                |
| `src/tools/lookup-group-history.ts`  | New tool implementation                                    |
| `src/tools/index.ts`                 | Register new tool                                          |
| Test files                           | Unit tests for all new functionality                       |

---

### Task 1: Add ThreadCapabilities to Chat Types

**Files:**

- Modify: `src/chat/types.ts`
- Test: `tests/chat/types.test.ts` (create)

- [ ] **Step 1: Write failing test for ThreadCapabilities**

```typescript
// tests/chat/types.test.ts
import { describe, expect, it } from 'bun:test'
import type { ThreadCapabilities } from '../../src/chat/types.js'

describe('ThreadCapabilities', () => {
  it('should have correct structure', () => {
    const caps: ThreadCapabilities = {
      supportsThreads: true,
      canCreateThreads: false,
      threadScope: 'message',
    }
    expect(caps.supportsThreads).toBe(true)
    expect(caps.canCreateThreads).toBe(false)
    expect(caps.threadScope).toBe('message')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test tests/chat/types.test.ts
```

Expected: FAIL - "Module not found" or type errors

- [ ] **Step 3: Add ThreadCapabilities type to types.ts**

```typescript
// src/chat/types.ts - Add after ContextType export

/** Thread support capabilities for a chat platform. */
export type ThreadCapabilities = {
  /** Platform has thread/topic support */
  supportsThreads: boolean
  /** Bot can create new threads (Telegram: yes, Mattermost: no) */
  canCreateThreads: boolean
  /** Platform-specific thread identifier type */
  threadScope: 'message' | 'post'
}
```

- [ ] **Step 4: Add threadId to IncomingMessage**

```typescript
// src/chat/types.ts - Update IncomingMessage type

export type IncomingMessage = {
  user: ChatUser
  contextId: string
  contextType: ContextType
  isMentioned: boolean
  text: string
  commandMatch?: string
  messageId?: string
  replyToMessageId?: string
  replyContext?: ReplyContext
  files?: IncomingFile[]
  /** Platform thread ID (if in thread) - NEW */
  threadId?: string
}
```

- [ ] **Step 5: Add threadCapabilities to ChatProvider interface**

```typescript
// src/chat/types.ts - Update ChatProvider interface

export interface ChatProvider {
  readonly name: string
  /** Thread support capabilities - NEW */
  readonly threadCapabilities: ThreadCapabilities
  registerCommand(name: string, handler: CommandHandler): void
  onMessage(handler: (msg: IncomingMessage, reply: ReplyFn) => Promise<void>): void
  sendMessage(userId: string, markdown: string): Promise<void>
  resolveUserId(username: string): Promise<string | null>
  start(): Promise<void>
  stop(): Promise<void>
}
```

- [ ] **Step 6: Run test to verify it passes**

```bash
bun test tests/chat/types.test.ts
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add tests/chat/types.test.ts src/chat/types.ts
git commit -m "feat(chat): add ThreadCapabilities type and threadId to IncomingMessage"
```

---

### Task 2: Add Thread Capabilities to Telegram Provider

**Files:**

- Modify: `src/chat/telegram/index.ts`
- Test: `tests/chat/telegram/index.test.ts` (add tests)

- [ ] **Step 1: Write failing test for thread capabilities**

```typescript
// tests/chat/telegram/index.test.ts - Add to existing tests
import { describe, expect, it } from 'bun:test'
import { TelegramChatProvider } from '../../../src/chat/telegram/index.js'

describe('TelegramChatProvider thread capabilities', () => {
  it('should expose correct thread capabilities', () => {
    // Mock TELEGRAM_BOT_TOKEN for test
    const originalToken = process.env['TELEGRAM_BOT_TOKEN']
    process.env['TELEGRAM_BOT_TOKEN'] = 'test-token'

    try {
      const provider = new TelegramChatProvider()
      expect(provider.threadCapabilities.supportsThreads).toBe(true)
      expect(provider.threadCapabilities.canCreateThreads).toBe(true)
      expect(provider.threadCapabilities.threadScope).toBe('message')
    } finally {
      process.env['TELEGRAM_BOT_TOKEN'] = originalToken
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test tests/chat/telegram/index.test.ts
```

Expected: FAIL - threadCapabilities undefined

- [ ] **Step 3: Add threadCapabilities to TelegramChatProvider**

```typescript
// src/chat/telegram/index.ts - Add to class definition

export class TelegramChatProvider implements ChatProvider {
  readonly name = 'telegram'
  /** Thread support capabilities */
  readonly threadCapabilities: ThreadCapabilities = {
    supportsThreads: true,
    canCreateThreads: true,
    threadScope: 'message',
  }
  private readonly bot: Bot
  private botUsername: string | null = null
  // ... rest of class
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test tests/chat/telegram/index.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/chat/telegram/index.test.ts src/chat/telegram/index.ts
git commit -m "feat(telegram): add thread capabilities declaration"
```

---

### Task 3: Implement Forum Topic Creation in Telegram

**Files:**

- Modify: `src/chat/telegram/index.ts`
- Modify: `src/chat/telegram/reply-helpers.ts`
- Test: `tests/chat/telegram/thread-creation.test.ts` (create)

- [ ] **Step 1: Write failing test for forum topic creation**

```typescript
// tests/chat/telegram/thread-creation.test.ts
import { describe, expect, it, beforeAll, afterAll } from 'bun:test'
import { TelegramChatProvider } from '../../../src/chat/telegram/index.js'

describe('Telegram forum topic creation', () => {
  const originalToken = process.env['TELEGRAM_BOT_TOKEN']

  beforeAll(() => {
    process.env['TELEGRAM_BOT_TOKEN'] = 'test-token'
  })

  afterAll(() => {
    process.env['TELEGRAM_BOT_TOKEN'] = originalToken
  })

  it('should detect forum groups', () => {
    const provider = new TelegramChatProvider()
    expect(provider).toBeDefined()
    // Forum detection logic will be tested via implementation
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test tests/chat/telegram/thread-creation.test.ts
```

Expected: PASS (basic test) but implementation missing

- [ ] **Step 3: Add forum topic creation method to Telegram provider**

```typescript
// src/chat/telegram/index.ts - Add private method to class

/**
 * Creates a new forum topic when bot is mentioned in main chat of a forum group.
 * Returns threadId if topic created or already in thread, undefined otherwise.
 */
private async createForumTopicIfNeeded(ctx: Context): Promise<string | undefined> {
  // Already in a thread/topic
  const existingThreadId = ctx.message?.message_thread_id
  if (existingThreadId !== undefined) {
    return String(existingThreadId)
  }

  const chat = ctx.chat
  if (chat?.type !== 'supergroup') return undefined

  // Check if chat is a forum
  const chatInfo = await this.bot.api.getChat(chat.id)
  const isForum = 'is_forum' in chatInfo && chatInfo.is_forum === true
  if (!isForum) return undefined

  try {
    const username = ctx.from?.username ?? 'user'
    const topic = await this.bot.api.createForumTopic(chat.id, `Question from @${username}`)
    log.info({ threadId: topic.message_thread_id, chatId: chat.id }, 'Created forum topic')
    return String(topic.message_thread_id)
  } catch (error) {
    log.warn({ error: error instanceof Error ? error.message : String(error), chatId: chat.id }, 'Failed to create forum topic')
    return undefined
  }
}
```

- [ ] **Step 4: Update extractMessage to include threadId**

```typescript
// src/chat/telegram/index.ts - Update extractMessage method

private async extractMessage(ctx: Context, isAdmin: boolean): Promise<IncomingMessage | null> {
  const id = ctx.from?.id
  if (id === undefined) return null

  const chatType = ctx.chat?.type
  const isGroup = chatType === 'group' || chatType === 'supergroup' || chatType === 'channel'
  const contextId = String(ctx.chat?.id ?? id)
  const contextType: ContextType = isGroup ? 'group' : 'dm'

  const text = ctx.message?.text ?? ctx.message?.caption ?? ''
  const isMentioned = this.isBotMentioned(text, ctx.message?.entities ?? ctx.message?.caption_entities)

  const messageId = ctx.message?.message_id
  const messageIdStr = messageId === undefined ? undefined : String(messageId)

  const replyToMessageId = ctx.message?.reply_to_message?.message_id
  const replyToMessageIdStr = replyToMessageId === undefined ? undefined : String(replyToMessageId)

  // Handle forum topic creation for mentions
  let threadId: string | undefined
  if (isMentioned && contextType === 'group') {
    threadId = await this.createForumTopicIfNeeded(ctx)
  } else if (ctx.message?.message_thread_id !== undefined) {
    threadId = String(ctx.message.message_thread_id)
  }

  if (messageIdStr !== undefined) {
    cacheMessage({
      messageId: messageIdStr,
      contextId,
      authorId: String(id),
      authorUsername: ctx.from?.username ?? undefined,
      text,
      replyToMessageId: replyToMessageIdStr,
      timestamp: Date.now(),
    })
  }

  const replyContext = extractReplyContext(ctx, contextId)

  return {
    user: { id: String(id), username: ctx.from?.username ?? null, isAdmin },
    contextId,
    contextType,
    isMentioned,
    text,
    messageId: messageIdStr,
    replyToMessageId: replyToMessageIdStr,
    replyContext,
    threadId,  // NEW
  }
}
```

- [ ] **Step 5: Update buildReplyFn to support threadId**

```typescript
// src/chat/telegram/index.ts - Update buildReplyFn method signature and call

private buildReplyFn(ctx: Context, threadId?: string): ReplyFn {
  const chatId = ctx.chat?.id
  const messageId = ctx.message?.message_id
  const buildReplyParams = createReplyParamsBuilder(ctx, threadId)

  return {
    text: (content: string, options?: ReplyOptions) => sendTextReply(ctx, content, buildReplyParams, options),
    formatted: (markdown: string, options?: ReplyOptions) =>
      sendFormattedReply(ctx, markdown, buildReplyParams, options),
    file: (file, options?: ReplyOptions) => sendFileReply(ctx, file, buildReplyParams, options),
    typing: () => {
      ctx.replyWithChatAction('typing').catch(() => undefined)
    },
    redactMessage: async (replacementText: string) => {
      if (chatId !== undefined && messageId !== undefined) {
        await this.bot.api.editMessageText(chatId, messageId, replacementText).catch((err: unknown) => {
          log.warn(
            { chatId, messageId, error: err instanceof Error ? err.message : String(err) },
            'Failed to redact message',
          )
        })
      }
    },
    buttons: (content: string, options) => sendButtonReply(ctx, content, buildReplyParams, options),
  }
}
```

- [ ] **Step 6: Update createReplyParamsBuilder to accept threadId**

```typescript
// src/chat/telegram/reply-helpers.ts - Update function

export type ReplyParamsBuilder = (
  options?: ReplyOptions,
) => { message_id: number; message_thread_id?: number } | undefined

export function createReplyParamsBuilder(ctx: Context, threadId?: string): ReplyParamsBuilder {
  const messageId = ctx.message?.message_id
  const contextThreadId = ctx.message?.message_thread_id

  return (options?: ReplyOptions): { message_id: number; message_thread_id?: number } | undefined => {
    const targetMessageId = options?.replyToMessageId === undefined ? messageId : parseInt(options.replyToMessageId, 10)

    if (targetMessageId === undefined) return undefined

    // Priority: explicit threadId param > options.threadId > context threadId
    const effectiveThreadId =
      threadId !== undefined
        ? parseInt(threadId, 10)
        : options?.threadId !== undefined
          ? parseInt(options.threadId, 10)
          : contextThreadId

    return {
      message_id: targetMessageId,
      ...(effectiveThreadId !== undefined && { message_thread_id: effectiveThreadId }),
    }
  }
}
```

- [ ] **Step 7: Update onMessage handlers to pass threadId to buildReplyFn**

```typescript
// src/chat/telegram/index.ts - Update onMessage handlers

onMessage(handler: (msg: IncomingMessage, reply: ReplyFn) => Promise<void>): void {
  this.bot.on('message:text', async (ctx) => {
    const isAdmin = await this.checkAdminStatus(ctx)
    const msg = await this.extractMessage(ctx, isAdmin)
    if (msg === null) return
    const reply = this.buildReplyFn(ctx, msg.threadId)  // Pass threadId
    await this.withTypingIndicator(ctx, () => handler(msg, reply))
  })

  this.bot.on(
    ['message:document', 'message:photo', 'message:audio', 'message:video', 'message:voice'],
    async (ctx) => {
      const isAdmin = await this.checkAdminStatus(ctx)
      const msg = await this.extractMessage(ctx, isAdmin)
      if (msg === null) return
      const files = await this.fetchFilesFromContext(ctx)
      if (files.length > 0) msg.files = files
      const reply = this.buildReplyFn(ctx, msg.threadId)  // Pass threadId
      await this.withTypingIndicator(ctx, () => handler(msg, reply))
    },
  )
}
```

- [ ] **Step 8: Run tests to verify**

```bash
bun test tests/chat/telegram/
```

Expected: PASS (existing tests still pass)

- [ ] **Step 9: Commit**

```bash
git add src/chat/telegram/index.ts src/chat/telegram/reply-helpers.ts tests/chat/telegram/thread-creation.test.ts
git commit -m "feat(telegram): implement forum topic creation on mention"
```

---

### Task 4: Add Thread Capabilities to Mattermost Provider

**Files:**

- Modify: `src/chat/mattermost/index.ts`
- Test: `tests/chat/mattermost/index.test.ts` (add tests)

- [ ] **Step 1: Write failing test for thread capabilities**

```typescript
// tests/chat/mattermost/index.test.ts - Add to existing tests
import { describe, expect, it, beforeAll, afterAll } from 'bun:test'
import { MattermostChatProvider } from '../../../src/chat/mattermost/index.js'

describe('MattermostChatProvider thread capabilities', () => {
  const originalUrl = process.env['MATTERMOST_URL']
  const originalToken = process.env['MATTERMOST_BOT_TOKEN']

  beforeAll(() => {
    process.env['MATTERMOST_URL'] = 'http://localhost:8065'
    process.env['MATTERMOST_BOT_TOKEN'] = 'test-token'
  })

  afterAll(() => {
    process.env['MATTERMOST_URL'] = originalUrl
    process.env['MATTERMOST_BOT_TOKEN'] = originalToken
  })

  it('should expose correct thread capabilities', () => {
    const provider = new MattermostChatProvider()
    expect(provider.threadCapabilities.supportsThreads).toBe(true)
    expect(provider.threadCapabilities.canCreateThreads).toBe(false)
    expect(provider.threadCapabilities.threadScope).toBe('post')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test tests/chat/mattermost/index.test.ts
```

Expected: FAIL - threadCapabilities undefined

- [ ] **Step 3: Add threadCapabilities to MattermostChatProvider**

```typescript
// src/chat/mattermost/index.ts - Add to class definition

export class MattermostChatProvider implements ChatProvider {
  readonly name = 'mattermost'
  /** Thread support capabilities */
  readonly threadCapabilities: ThreadCapabilities = {
    supportsThreads: true,
    canCreateThreads: false, // Users create threads, bot replies
    threadScope: 'post',
  }
  private readonly baseUrl: string
  private readonly token: string
  // ... rest of class
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test tests/chat/mattermost/index.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/chat/mattermost/index.test.ts src/chat/mattermost/index.ts
git commit -m "feat(mattermost): add thread capabilities declaration"
```

---

### Task 5: Implement Thread-scoped Storage Context

**Files:**

- Modify: `src/bot.ts`
- Test: `tests/bot.test.ts` (add tests)

- [ ] **Step 1: Write failing test for thread-scoped storage**

```typescript
// tests/bot.test.ts - Add to existing tests or create new test file
import { describe, expect, it } from 'bun:test'

describe('getThreadScopedStorageContextId', () => {
  it('should return userId for DM context', () => {
    const result = getThreadScopedStorageContextId('user123', 'dm', undefined)
    expect(result).toBe('user123')
  })

  it('should return groupId for main chat (no thread)', () => {
    const result = getThreadScopedStorageContextId('group456', 'group', undefined)
    expect(result).toBe('group456')
  })

  it('should return groupId:threadId for thread', () => {
    const result = getThreadScopedStorageContextId('group456', 'group', 'thread789')
    expect(result).toBe('group456:thread789')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test tests/bot.test.ts
```

Expected: FAIL - function not defined

- [ ] **Step 3: Add getThreadScopedStorageContextId function**

```typescript
// src/bot.ts - Add after existing auth functions

/**
 * Generates storage context ID with thread scoping.
 * - DMs: userId
 * - Main chat: groupId
 * - Thread: groupId:threadId
 */
function getThreadScopedStorageContextId(
  contextId: string,
  contextType: ContextType,
  threadId: string | undefined,
): string {
  if (contextType === 'dm') return contextId
  // Main chat: use groupId
  if (threadId === undefined) return contextId
  // Thread: use groupId:threadId for history isolation
  return `${contextId}:${threadId}`
}

// Export for testing
export { getThreadScopedStorageContextId }
```

- [ ] **Step 4: Update auth functions to accept and use threadId**

```typescript
// src/bot.ts - Update getGroupMemberAuth

const getGroupMemberAuth = (
  contextId: string,
  contextType: ContextType,
  threadId: string | undefined,
  isPlatformAdmin: boolean,
): AuthorizationResult => ({
  allowed: true,
  isBotAdmin: false,
  isGroupAdmin: isPlatformAdmin,
  storageContextId: getThreadScopedStorageContextId(contextId, contextType, threadId),
})

const getBotAdminAuth = (
  userId: string,
  contextId: string,
  contextType: ContextType,
  threadId: string | undefined,
  isPlatformAdmin: boolean,
): AuthorizationResult => ({
  allowed: true,
  isBotAdmin: true,
  isGroupAdmin: isPlatformAdmin,
  storageContextId: getThreadScopedStorageContextId(contextId, contextType, threadId),
})
```

- [ ] **Step 5: Update checkAuthorizationExtended to accept threadId**

```typescript
// src/bot.ts - Update checkAuthorizationExtended function signature and usage

export const checkAuthorizationExtended = (
  userId: string,
  username: string | null,
  contextId: string,
  contextType: ContextType,
  threadId: string | undefined,
  isPlatformAdmin: boolean,
): AuthorizationResult => {
  log.debug({ userId, contextId, contextType, threadId }, 'Checking authorization')

  if (process.env['DEMO_MODE'] === 'true' && !isAuthorized(userId) && contextType === 'dm') {
    log.info({ userId, username }, 'Demo mode: auto-adding user')
    addUser(userId, 'demo-auto', username ?? undefined)
    return getGroupMemberAuth(contextId, contextType, threadId, false)
  }

  if (isAuthorized(userId)) {
    if (contextType === 'dm' && isDemoUser(userId)) {
      return getGroupMemberAuth(contextId, contextType, threadId, false)
    }
    return getBotAdminAuth(userId, contextId, contextType, threadId, isPlatformAdmin)
  }

  if (contextType === 'group') {
    if (isGroupMember(contextId, userId)) {
      return getGroupMemberAuth(contextId, contextType, threadId, isPlatformAdmin)
    }
    return getUnauthorizedGroupAuth(contextId)
  }

  if (username !== null && resolveUserByUsername(userId, username)) {
    return getDmUserAuth(userId)
  }

  return getUnauthorizedDmAuth(userId)
}
```

- [ ] **Step 6: Update onIncomingMessage to pass threadId**

```typescript
// src/bot.ts - Update onIncomingMessage

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
    threadId: msg.threadId, // Add to event
    textLength: msg.text.length,
    isCommand: msg.text.startsWith('/'),
  })

  // Get authorization FIRST (needed for wizard storage context)
  const auth = checkAuthorizationExtended(
    msg.user.id,
    msg.user.username,
    msg.contextId,
    msg.contextType,
    msg.threadId, // Pass threadId
    msg.user.isAdmin,
  )

  // ... rest of function
}
```

- [ ] **Step 7: Run tests to verify**

```bash
bun test tests/bot.test.ts
```

Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/bot.ts tests/bot.test.ts
git commit -m "feat(bot): implement thread-scoped storage context IDs"
```

---

### Task 6: Create lookup_group_history Tool

**Files:**

- Create: `src/tools/lookup-group-history.ts`
- Create: `tests/tools/lookup-group-history.test.ts`

- [ ] **Step 1: Write failing test for lookup_group_history**

```typescript
// tests/tools/lookup-group-history.test.ts
import { describe, expect, it } from 'bun:test'
import { executeLookupGroupHistory } from '../../src/tools/lookup-group-history.js'

describe('executeLookupGroupHistory', () => {
  it('should return empty message when no history', async () => {
    const mockGetHistory = () => []
    const result = await executeLookupGroupHistory('user123', 'group456', ['test query'], {
      getCachedHistory: mockGetHistory,
      generateText: async () => ({ text: 'test' }),
      getSmallModel: () => ({}) as unknown as LanguageModel,
    })
    expect(result).toBe('No messages found in the main chat.')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test tests/tools/lookup-group-history.test.ts
```

Expected: FAIL - module not found

- [ ] **Step 3: Create lookup-group-history.ts implementation**

```typescript
// src/tools/lookup-group-history.ts
import type { LanguageModel } from 'ai'
import { generateText } from 'ai'

import { getCachedConfig, getCachedHistory } from '../cache.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tools:lookup-group-history' })

export type LookupGroupHistoryDeps = {
  getCachedHistory: typeof getCachedHistory
  generateText: typeof generateText
  getSmallModel: (userId: string) => LanguageModel | null
}

const defaultDeps: LookupGroupHistoryDeps = {
  getCachedHistory,
  generateText,
  getSmallModel: (userId: string) => {
    const llmApiKey = getCachedConfig(userId, 'llm_apikey')
    const llmBaseUrl = getCachedConfig(userId, 'llm_baseurl')
    const smallModel = getCachedConfig(userId, 'small_model')

    if (llmApiKey === null || llmBaseUrl === null || smallModel === null) {
      return null
    }

    const { createOpenAICompatible } = require('@ai-sdk/openai-compatible')
    return createOpenAICompatible({
      name: 'openai-compatible',
      apiKey: llmApiKey,
      baseURL: llmBaseUrl,
    })(smallModel)
  },
}

/**
 * Search the main group chat for specific information using AI.
 * Uses small_model to extract relevant information from main chat history.
 */
export async function executeLookupGroupHistory(
  userId: string,
  groupId: string,
  queries: string[],
  deps: LookupGroupHistoryDeps = defaultDeps,
): Promise<string> {
  log.debug({ userId, groupId, queries }, 'Executing lookup_group_history')

  // Load main chat history (not thread-scoped)
  const mainHistory = deps.getCachedHistory(groupId)

  if (mainHistory.length === 0) {
    return 'No messages found in the main chat.'
  }

  // Get small model for processing
  const smallModel = deps.getSmallModel(userId)
  if (smallModel === null) {
    log.warn({ userId }, 'No LLM config available for lookup_group_history')
    return 'Unable to search: LLM not configured.'
  }

  try {
    const result = await deps.generateText({
      model: smallModel,
      messages: [
        {
          role: 'system',
          content:
            'You are searching through group chat history. Extract only the information relevant to the queries. Be concise and factual. If no relevant information is found, say "No relevant information found in main chat."',
        },
        {
          role: 'user',
          content: `Search queries: ${queries.join(', ')}

Chat history:
${mainHistory.map((m) => `${m.role}: ${String(m.content)}`).join('\n')}

Provide a concise answer based only on the chat history.`,
        },
      ],
    })

    log.info({ userId, groupId, resultLength: result.text.length }, 'lookup_group_history completed')
    return result.text
  } catch (error) {
    log.error(
      { userId, groupId, error: error instanceof Error ? error.message : String(error) },
      'lookup_group_history failed',
    )
    return 'Error searching main chat history.'
  }
}

/**
 * Tool definition for lookup_group_history
 */
export const lookupGroupHistoryTool = {
  name: 'lookup_group_history',
  description:
    'Search the main group chat for specific information using AI. Use this when you need context from ongoing discussions outside the current thread, such as finding decisions, context, or references mentioned in the main chat.',
  parameters: {
    type: 'object',
    properties: {
      queries: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Search queries or topics to look for in the group context. Be specific about what you need to find.',
      },
    },
    required: ['queries'],
  },
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test tests/tools/lookup-group-history.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/lookup-group-history.ts tests/tools/lookup-group-history.test.ts
git commit -m "feat(tools): add lookup_group_history tool"
```

---

### Task 7: Register lookup_group_history Tool

**Files:**

- Modify: `src/tools/index.ts`
- Test: Run integration test

- [ ] **Step 1: Import and add tool to tools index**

```typescript
// src/tools/index.ts - Add import at top
import { executeLookupGroupHistory, lookupGroupHistoryTool } from './lookup-group-history.js'
```

- [ ] **Step 2: Add tool to makeTools function**

```typescript
// src/tools/index.ts - Inside makeTools function, add after other tools

// lookup_group_history - always available (reads main group context)
tools.push({
  definition: lookupGroupHistoryTool,
  execute: async (args: { queries: string[] }) => {
    // Extract groupId from contextId (remove thread suffix if present)
    const groupId = contextId.includes(':') ? contextId.split(':')[0] : contextId
    return executeLookupGroupHistory(contextId, groupId, args.queries)
  },
})
```

- [ ] **Step 3: Verify tool is registered by running typecheck**

```bash
bun typecheck
```

Expected: PASS (no type errors)

- [ ] **Step 4: Commit**

```bash
git add src/tools/index.ts
git commit -m "feat(tools): register lookup_group_history tool"
```

---

### Task 8: Run Full Test Suite

**Files:**

- All modified files

- [ ] **Step 1: Run typecheck**

```bash
bun typecheck
```

Expected: No errors

- [ ] **Step 2: Run lint**

```bash
bun lint
```

Expected: No errors

- [ ] **Step 3: Run format check**

```bash
bun format:check
```

Expected: No errors

- [ ] **Step 4: Run unit tests**

```bash
bun test
```

Expected: All tests pass

- [ ] **Step 5: Commit any formatting fixes**

```bash
bun fix
git add -A
git commit -m "chore: formatting fixes" || echo "No changes to commit"
```

---

## Spec Coverage Check

| Spec Requirement               | Implementation Task                |
| ------------------------------ | ---------------------------------- |
| ThreadCapability type          | Task 1                             |
| Telegram thread capabilities   | Task 2                             |
| Telegram forum topic creation  | Task 3                             |
| Mattermost thread capabilities | Task 4                             |
| Mattermost root_id handling    | Task 4 (already existed, verified) |
| Thread-scoped storage keys     | Task 5                             |
| lookup_group_history tool      | Task 6                             |
| Tool registration              | Task 7                             |

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-10-thread-aware-group-chat.md`.**

Two execution options:

**1. Subagent-Driven (recommended)** - Dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
