<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Thread-Aware Group Chat Design

**Date:** 2026-04-10  
**Status:** Approved  
**Scope:** Group chat thread creation, thread-scoped history, and parent context access

## Problem Statement

Group chats currently behave inconsistently between Telegram (with topics/forums) and Mattermost (with threads):

1. **Telegram**: Bot does not create new forum topics when @mentioned in main chat
2. **Mattermost**: Bot replies as top-level posts instead of threaded replies
3. **History**: All group members share the same conversation history regardless of thread
4. **Context**: No way for bot to access information from parent/main chat when in a thread

## Goals

1. Create threads/topics when bot is @mentioned (platform-dependent)
2. Isolate conversation history per thread while sharing memory/config
3. Provide bot tool to query main group chat context

## Non-Goals

- Per-user history isolation in groups (group chats share context among members)
- Automatic thread summarization or archival
- Thread persistence beyond conversation history TTL

## Design

### 1. Thread Capability Detection

Each `ChatProvider` exposes thread capabilities:

```typescript
// src/chat/types.ts
export type ThreadCapabilities = {
  supportsThreads: boolean // Platform has thread/topic support
  canCreateThreads: boolean // Bot can create new threads (Telegram: yes, Mattermost: no)
  threadScope: 'message' | 'post' // Telegram: message_thread_id, Mattermost: root_id
}

// Added to ChatProvider interface
export interface ChatProvider {
  readonly name: string
  readonly threadCapabilities: ThreadCapabilities // NEW
  // ... existing methods
}
```

**Platform Capabilities:**

| Platform         | supportsThreads | canCreateThreads | threadScope |
| ---------------- | --------------- | ---------------- | ----------- |
| Telegram (Forum) | true            | true             | 'message'   |
| Telegram (Basic) | false           | false            | 'message'   |
| Mattermost       | true            | false            | 'post'      |

### 2. Thread Creation Behavior

#### Telegram (Forum Topics)

When bot is @mentioned in main chat of a forum group:

1. Detect if chat is a forum (check `chat.type === 'supergroup'` and `is_forum` flag)
2. Create new topic via `createForumTopic` API:
   ```typescript
   const topic = await ctx.api.createForumTopic(chatId, {
     name: `Question from ${username}`,
     icon_color: 0x6b9eff, // Optional: consistent bot color
   })
   const threadId = topic.message_thread_id
   ```
3. Use `threadId` for reply and history storage

When bot is @mentioned in existing topic:

- Use existing `message_thread_id` from context
- Reply in that topic
- Use thread-scoped storage key

#### Mattermost (Threaded Replies)

When bot is @mentioned:

1. Create reply with `root_id` set to the mentioned message ID:
   ```typescript
   await apiFetch('POST', '/api/v4/posts', {
     channel_id: channelId,
     message: response,
     root_id: mentionedMessageId, // Creates thread
   })
   ```
2. Track thread ID (`root_id`) for subsequent replies
3. Use thread-scoped storage key

**Note:** Mattermost users create threads by replying; bot participates by setting `root_id` on first reply.

### 3. Storage Context Strategy

#### Storage Key Format

| Location      | History Storage Key | Shared Data Key |
| ------------- | ------------------- | --------------- |
| **Main chat** | `groupId`           | `groupId`       |
| **In thread** | `groupId:threadId`  | `groupId`       |

#### Data Scope

| Data Type            | Storage Key                                | Scope                                        |
| -------------------- | ------------------------------------------ | -------------------------------------------- |
| Conversation history | `groupId:threadId` (or `groupId` for main) | Thread-scoped                                |
| Memory facts         | `groupId`                                  | Group-scoped (shared)                        |
| User configuration   | `groupId` (or user-scoped in DMs)          | Group-scoped/shared                          |
| Wizard state         | `groupId`                                  | Group-scoped (one wizard per user per group) |
| Instructions         | `groupId`                                  | Group-scoped (shared)                        |

#### Authorization

Authorization checks continue to use `msg.contextId` (the group ID) for group membership validation.

### 4. Implementation Changes

#### Chat Types (`src/chat/types.ts`)

```typescript
export type ThreadCapabilities = {
  supportsThreads: boolean
  canCreateThreads: boolean
  threadScope: 'message' | 'post'
}

export interface ChatProvider {
  readonly name: string
  readonly threadCapabilities: ThreadCapabilities
  // ... existing methods
}

export type IncomingMessage = {
  user: ChatUser
  contextId: string // Group ID (for membership/auth)
  contextType: ContextType
  isMentioned: boolean
  text: string
  commandMatch?: string
  messageId?: string
  replyToMessageId?: string
  replyContext?: ReplyContext
  files?: IncomingFile[]
  // NEW: Thread-specific fields
  threadId?: string // Platform thread ID (if in thread)
  shouldCreateThread?: boolean // True if bot should create new thread
}
```

#### Telegram Provider (`src/chat/telegram/index.ts`)

```typescript
export class TelegramChatProvider implements ChatProvider {
  readonly name = 'telegram'
  readonly threadCapabilities: ThreadCapabilities = {
    supportsThreads: true,
    canCreateThreads: true,
    threadScope: 'message',
  }

  private async handleThreadCreation(ctx: Context, msg: IncomingMessage): Promise<string | undefined> {
    // Only create thread if:
    // 1. Bot was @mentioned
    // 2. Message is in main chat (no thread_id)
    // 3. Chat is a forum
    if (!msg.isMentioned) return undefined
    if (ctx.message?.message_thread_id !== undefined) return String(ctx.message.message_thread_id)
    if (ctx.chat?.type !== 'supergroup') return undefined
    if (!(ctx.chat as unknown as { is_forum?: boolean }).is_forum) return undefined

    try {
      const topic = await this.bot.api.createForumTopic(ctx.chat.id, {
        name: `Question from @${ctx.from?.username ?? 'user'}`,
      })
      return String(topic.message_thread_id)
    } catch (error) {
      log.warn({ error }, 'Failed to create forum topic')
      return undefined
    }
  }
}
```

#### Mattermost Provider (`src/chat/mattermost/index.ts`)

```typescript
export class MattermostChatProvider implements ChatProvider {
  readonly name = 'mattermost'
  readonly threadCapabilities: ThreadCapabilities = {
    supportsThreads: true,
    canCreateThreads: false, // Users create threads, bot replies
    threadScope: 'post',
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
    // ... existing code ...

    // Determine thread behavior
    const isInThread = post.root_id !== undefined && post.root_id !== ''
    const shouldCreateThread = !isInThread && msg.isMentioned
    const threadId = isInThread ? post.root_id : shouldCreateThread ? post.id : undefined

    // Pass threadId to ReplyFn for subsequent replies
    const reply = this.buildReplyFn(post.channel_id, post.id, threadId)

    // ... rest of message building ...
  }
}
```

#### Bot Authorization (`src/bot.ts`)

Update `getThreadScopedStorageContextId` function:

```typescript
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

// Update auth functions
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
```

### 5. New Tool: `lookup_group_history`

When bot is in a thread, it can query main group chat context.

```typescript
// src/tools/lookup-group-history.ts
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

**Implementation:**

```typescript
export async function executeLookupGroupHistory(
  userId: string,
  groupId: string,
  queries: string[],
  deps: LookupDeps = defaultDeps,
): Promise<string> {
  // Load main chat history (not thread-scoped)
  const mainHistory = getCachedHistory(groupId)

  if (mainHistory.length === 0) {
    return 'No messages found in the main chat.'
  }

  // Use small_model to extract relevant information
  const smallModel = deps.getSmallModel(userId)
  const result = await deps.generateText({
    model: smallModel,
    messages: [
      {
        role: 'system',
        content:
          'You are searching through group chat history. Extract only the information relevant to the queries. Be concise and factual.',
      },
      {
        role: 'user',
        content: `Search queries: ${queries.join(', ')}

Chat history:
${mainHistory.map((m) => `${m.role}: ${m.content}`).join('\n')}

Provide a concise answer based only on the chat history. If no relevant information is found, say "No relevant information found in main chat."`,
      },
    ],
  })

  return result.text
}
```

### 6. Edge Cases & Fallbacks

| Scenario                             | Behavior                                                  |
| ------------------------------------ | --------------------------------------------------------- |
| Telegram group is NOT a forum        | Reply in main chat, use `groupId` storage                 |
| Thread creation fails                | Log warning, reply in main chat                           |
| Mattermost message already in thread | Continue existing thread, use existing `root_id`          |
| Thread-scoped history is empty       | Bot behaves as new conversation                           |
| `/clear` in thread                   | Clears only thread's history, main chat unchanged         |
| User switches between threads        | Each thread has independent history                       |
| `lookup_group_history` in main chat  | Returns "Already in main chat" or searches from beginning |

### 7. Migration

Existing group chat histories remain under `groupId` key:

- Treated as `:main` for backward compatibility
- No data migration needed
- Threads start with empty history (fresh conversation)

## Testing Strategy

### Unit Tests

1. **Thread capability detection**: Verify each provider returns correct capabilities
2. **Storage key generation**: Test `getThreadScopedStorageContextId` with various inputs
3. **Telegram thread creation**: Mock `createForumTopic` API
4. **Mattermost thread reply**: Verify `root_id` is set correctly
5. **Tool execution**: Test `lookup_group_history` with mock history

### Integration Tests

1. **E2E Telegram forum flow**:
   - @mention bot in forum main chat
   - Verify topic is created
   - Verify bot replies in new topic
   - Verify thread-scoped history

2. **E2E Mattermost thread flow**:
   - @mention bot in channel
   - Verify reply is threaded (has `root_id`)
   - Verify subsequent messages stay in thread

## Future Considerations

- **Thread archival**: Optionally summarize and archive old thread histories
- **Thread discovery**: Tool to list active threads in a group
- **Cross-thread context**: Allow bot to carry context between related threads
- **Thread permissions**: Control which users can create threads with bot

## Open Questions

None. Design approved by user on 2026-04-10.
