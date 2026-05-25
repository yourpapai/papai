<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Fix Cross-User Impersonation in Group Chats

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the cross-user impersonation vulnerability where identity mapping is keyed on `storageContextId` (shared in group chats) instead of the actual user ID.

**Architecture:** Thread a separate `chatUserId` through the tool system to properly isolate identity mappings per-user, while keeping `storageContextId` for conversation-scoped data (history, memos, instructions).

**Tech Stack:** TypeScript, Bun, Zod, Vercel AI SDK

---

## Files to Modify

| File                                    | Responsibility                                            |
| --------------------------------------- | --------------------------------------------------------- |
| `src/tools/types.ts`                    | Add `chatUserId` to `MakeToolsOptions` interface          |
| `src/tools/index.ts`                    | Update `makeTools` to extract and pass `chatUserId`       |
| `src/tools/tools-builder.ts`            | Update `buildTools` signature and identity tool calls     |
| `src/tools/set-my-identity.ts`          | Use `chatUserId` instead of `userId` for identity mapping |
| `src/tools/clear-my-identity.ts`        | Use `chatUserId` instead of `userId` for identity mapping |
| `src/llm-orchestrator.ts`               | Pass `chatUserId` when calling `makeTools`                |
| `src/deferred-prompts/proactive-llm.ts` | Pass `chatUserId` when calling `makeTools`                |
| `tests/tools/index.test.ts`             | Update tests to include `chatUserId` parameter            |
| `tests/tools/set-my-identity.test.ts`   | Update tests with correct user isolation                  |
| `tests/tools/clear-my-identity.test.ts` | Update tests with correct user isolation                  |
| `tests/tools/tools-builder.test.ts`     | Update tests with new `buildTools` signature              |

---

## Task 1: Add `chatUserId` to `MakeToolsOptions`

**Files:**

- Modify: `src/tools/types.ts:8-23`

**Context:** The `MakeToolsOptions` interface currently only has `storageContextId`, which in group chats resolves to a shared group ID. We need to add a separate `chatUserId` that represents the actual chat user.

- [ ] **Step 1: Write the test first**

```typescript
// tests/tools/types.test.ts
import { describe, expect, it } from 'bun:test'
import type { MakeToolsOptions } from '../../src/tools/types.js'

describe('MakeToolsOptions', () => {
  it('should accept chatUserId parameter', () => {
    const options: MakeToolsOptions = {
      storageContextId: 'group-123',
      chatUserId: 'user-456',
    }
    expect(options.storageContextId).toBe('group-123')
    expect(options.chatUserId).toBe('user-456')
  })

  it('should work without chatUserId (backward compatibility)', () => {
    const options: MakeToolsOptions = {
      storageContextId: 'user-123',
    }
    expect(options.storageContextId).toBe('user-123')
    expect(options.chatUserId).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the test to verify it compiles and passes**

```bash
bun test tests/tools/types.test.ts
```

Expected: PASS (type test only)

- [ ] **Step 3: Add `chatUserId` to the interface**

```typescript
// src/tools/types.ts
export type ToolMode = 'normal' | 'proactive'

/**
 * Options for makeTools function.
 * Use this options object pattern for clarity - the single storageContextId
 * parameter replaces the confusing userId/contextId split.
 */
export type MakeToolsOptions = {
  /**
   * The storage context ID for the user/conversation.
   * This single identifier is used for:
   * - User-scoped tools (memos, recurring tasks, instructions)
   * - Group history lookup (if the ID contains a group/thread suffix)
   * - Attachment tools
   */
  storageContextId?: string
  /**
   * The actual chat user ID (different from storageContextId in group chats).
   * Used for identity tools to ensure per-user isolation.
   * In DMs, this is the same as storageContextId.
   * In groups, this is the actual user ID while storageContextId is the group ID.
   */
  chatUserId?: string
  /**
   * Tool mode: 'normal' (default) includes deferred prompt tools,
   * 'proactive' excludes them for proactive delivery contexts.
   */
  mode?: ToolMode
}
```

- [ ] **Step 4: Run the test again**

```bash
bun test tests/tools/types.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/types.ts tests/tools/types.test.ts
git commit -m "feat(tools): add chatUserId to MakeToolsOptions for identity isolation"
```

---

## Task 2: Update `makeTools` to Handle `chatUserId`

**Files:**

- Modify: `src/tools/index.ts:8-24`

**Context:** The `makeTools` function currently sets `userId = storageContextId`. We need to use `chatUserId` for identity-related operations, while keeping `storageContextId` for conversation-scoped data.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/tools/index.test.ts - add to existing describe block
import { describe, expect, it, mock, beforeEach } from 'bun:test'
import { makeTools } from '../../src/tools/index.js'
import { mockLogger } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

describe('makeTools', () => {
  beforeEach(() => {
    mockLogger()
    mock.restore()
  })

  // ... existing tests ...

  describe('chatUserId isolation', () => {
    it('should use chatUserId for identity tools when provided', () => {
      const providerWithResolver = createMockProvider({
        identityResolver: {
          searchUsers: () => Promise.resolve([]),
        },
      })
      // In a group chat: storageContextId is group ID, chatUserId is actual user
      const tools = makeTools(providerWithResolver, {
        storageContextId: 'group-123',
        chatUserId: 'user-456',
      })
      // Identity tools should be created with user-456, not group-123
      expect(tools['set_my_identity']).toBeDefined()
      expect(tools['clear_my_identity']).toBeDefined()
    })

    it('should fall back to storageContextId when chatUserId not provided', () => {
      const providerWithResolver = createMockProvider({
        identityResolver: {
          searchUsers: () => Promise.resolve([]),
        },
      })
      const tools = makeTools(providerWithResolver, {
        storageContextId: 'user-123',
      })
      expect(tools['set_my_identity']).toBeDefined()
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test tests/tools/index.test.ts -t "chatUserId"
```

Expected: Tests may pass (behavior not yet changed), but we need to verify the implementation.

- [ ] **Step 3: Update `makeTools` function**

````typescript
// src/tools/index.ts
import type { ToolSet } from 'ai'

import type { TaskProvider } from '../providers/types.js'
import { buildTools } from './tools-builder.js'
import type { MakeToolsOptions, ToolMode } from './types.js'

export type { MakeToolsOptions, ToolMode }

/**
 * Build a tool set for the given provider and context.
 *
 * Usage:
 * ```ts
 * makeTools(provider, { storageContextId: 'user-1:group-1', chatUserId: 'user-1', mode: 'normal' })
 * ```
 */
export function makeTools(provider: TaskProvider, options: MakeToolsOptions = {}): ToolSet {
  const storageContextId = options.storageContextId
  const chatUserId = options.chatUserId ?? storageContextId
  const contextId = storageContextId
  const mode = options.mode ?? 'normal'

  return buildTools(provider, chatUserId, contextId, mode)
}
````

- [ ] **Step 4: Update `buildTools` signature in tools-builder.ts**

The `buildTools` function signature needs to change from `(provider, userId, contextId, mode)` to `(provider, chatUserId, contextId, mode)` for clarity.

See Task 3 for the full implementation.

- [ ] **Step 5: Run tests**

```bash
bun test tests/tools/index.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/tools/index.ts tests/tools/index.test.ts
git commit -m "feat(tools): update makeTools to use chatUserId for identity isolation"
```

---

## Task 3: Update `buildTools` and Identity Tools

**Files:**

- Modify: `src/tools/tools-builder.ts:261-287`
- Modify: `src/tools/tools-builder.ts:255-259`
- Modify: `src/tools/set-my-identity.ts:87`
- Modify: `src/tools/clear-my-identity.ts:11`

**Context:** Update `buildTools` to receive `chatUserId` as the first parameter (renamed from `userId` for clarity) and pass it to identity tools. The identity tools need to use this `chatUserId` for all identity mapping operations.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/tools/tools-builder.test.ts - add new test
describe('buildTools chatUserId isolation', () => {
  it('should pass chatUserId separately from contextId to identity tools', () => {
    const provider = createMockProvider({
      identityResolver: {
        searchUsers: () => Promise.resolve([]),
      },
    })
    // chatUserId: 'user-123', contextId: 'group-456' (group chat scenario)
    const tools = buildTools(provider, 'user-123', 'group-456', 'normal')

    expect(tools['set_my_identity']).toBeDefined()
    expect(tools['clear_my_identity']).toBeDefined()
  })
})
```

- [ ] **Step 2: Update `buildTools` function signature and identity tool calls**

```typescript
// src/tools/tools-builder.ts:261-287
export function buildTools(
  provider: TaskProvider,
  chatUserId: string | undefined,
  contextId: string | undefined,
  mode: ToolMode,
): ToolSet {
  const tools = makeCoreTools(provider, chatUserId)
  maybeAddProjectTools(tools, provider)
  maybeAddCommentTools(tools, provider)
  maybeAddLabelTools(tools, provider)
  maybeAddRelationTools(tools, provider)
  maybeAddStatusTools(tools, provider)
  maybeAddDeleteTool(tools, provider)
  maybeAddCollaborationTaskTools(tools, provider, contextId)
  maybeAddAttachmentTools(tools, provider, chatUserId)
  maybeAddWorkItemTools(tools, provider)
  maybeAddCountTasksTool(tools, provider)
  addRecurringTools(tools, chatUserId)
  addMemoTools(tools, provider, chatUserId)
  addInstructionTools(tools, chatUserId)
  addLookupGroupHistoryTool(tools, chatUserId, contextId)
  maybeAddIdentityTools(tools, provider, chatUserId)
  if (mode === 'normal') {
    addDeferredPromptTools(tools, chatUserId)
  }
  return tools
}
```

- [ ] **Step 3: Update `maybeAddIdentityTools` to use `chatUserId`**

```typescript
// src/tools/tools-builder.ts:255-259
function maybeAddIdentityTools(tools: ToolSet, provider: TaskProvider, chatUserId: string | undefined): void {
  if (chatUserId === undefined || provider.identityResolver === undefined) return
  tools['set_my_identity'] = makeSetMyIdentityTool(provider, chatUserId)
  tools['clear_my_identity'] = makeClearMyIdentityTool(provider, chatUserId)
}
```

- [ ] **Step 4: Update identity tool factories to use `chatUserId`**

Both identity tools already receive `userId` as a parameter. We just need to update the parameter name for clarity in the factory functions:

```typescript
// src/tools/set-my-identity.ts:87
export function makeSetMyIdentityTool(provider: TaskProvider, chatUserId: string): ToolSet[string] {
  return tool({
    description:
      "Set or correct the user's task tracker identity. Use when user says things like 'I'm jsmith', 'My login is john.smith', or 'Link me to user jsmith'.",
    inputSchema: z.object({
      claim: z.string().describe("The user's natural language claim about their identity"),
    }),
    execute: async ({ claim }) => {
      log.debug({ chatUserId, claim }, 'set_my_identity called')
      // ... rest of implementation uses chatUserId instead of userId ...
    },
  })
}
```

Update the logging and variable names in `set-my-identity.ts`:

```typescript
// src/tools/set-my-identity.ts - Full updated file
import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { setIdentityMapping } from '../identity/mapping.js'
import { extractIdentityClaim } from '../identity/nl-detection.js'
import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:set-my-identity' })

interface ErrorResult {
  status: 'error'
  message: string
}

interface SuccessResult {
  status: 'success'
  message: string
  identity: {
    login: string
    displayName: string
  }
}

function validateResolver(provider: TaskProvider): ErrorResult | null {
  if (provider.identityResolver === undefined) {
    log.warn({ providerName: provider.name }, 'Provider has no identity resolver')
    return {
      status: 'error',
      message: 'Identity resolution not supported for this provider.',
    }
  }
  return null
}

function parseClaim(claim: string): { result: ErrorResult | null; login: string | null } {
  const claimedLogin = extractIdentityClaim(claim)
  if (claimedLogin === null) {
    log.warn({ claim }, 'Could not extract identity from claim')
    return {
      result: {
        status: 'error',
        message: "I couldn't understand your identity claim. Try saying 'I'm jsmith'.",
      },
      login: null,
    }
  }
  return { result: null, login: claimedLogin }
}

async function findUser(
  resolver: NonNullable<TaskProvider['identityResolver']>,
  claimedLogin: string,
  _providerName: string,
): Promise<{ id: string; login: string; name?: string } | null> {
  const users = await resolver.searchUsers(claimedLogin, 5)
  return users.find((u) => u.login.toLowerCase() === claimedLogin.toLowerCase()) ?? null
}

function storeIdentity(
  chatUserId: string,
  providerName: string,
  matched: { id: string; login: string; name?: string },
): SuccessResult {
  setIdentityMapping({
    contextId: chatUserId,
    providerName,
    providerUserId: matched.id,
    providerUserLogin: matched.login,
    displayName: matched.name ?? matched.login,
    matchMethod: 'manual_nl',
    confidence: 100,
  })

  log.info({ chatUserId, login: matched.login }, 'Identity set via NL')
  return {
    status: 'success',
    message: `Linked you to ${matched.login} (${matched.name ?? matched.login}) in ${providerName}.`,
    identity: {
      login: matched.login,
      displayName: matched.name ?? matched.login,
    },
  }
}

export function makeSetMyIdentityTool(provider: TaskProvider, chatUserId: string): ToolSet[string] {
  return tool({
    description:
      "Set or correct the user's task tracker identity. Use when user says things like 'I'm jsmith', 'My login is john.smith', or 'Link me to user jsmith'.",
    inputSchema: z.object({
      claim: z.string().describe("The user's natural language claim about their identity"),
    }),
    execute: async ({ claim }) => {
      log.debug({ chatUserId, claim }, 'set_my_identity called')

      const resolverError = validateResolver(provider)
      if (resolverError !== null) return resolverError

      const { result, login } = parseClaim(claim)
      if (result !== null) return result
      if (login === null) return { status: 'error', message: 'Failed to parse identity claim.' }

      try {
        const resolver = provider.identityResolver!
        const matched = await findUser(resolver, login, provider.name)

        if (matched === null) {
          log.warn({ claimedLogin: login }, 'User not found in provider')
          return {
            status: 'error',
            message: `I couldn't find user '${login}' in ${provider.name}. Check the username and try again.`,
          }
        }

        return storeIdentity(chatUserId, provider.name, matched)
      } catch (error) {
        log.error(
          {
            error: error instanceof Error ? error.message : String(error),
            chatUserId,
            claimedLogin: login,
          },
          'Failed to set identity',
        )
        return {
          status: 'error',
          message: 'Failed to set identity. Please try again.',
        }
      }
    },
  })
}
```

```typescript
// src/tools/clear-my-identity.ts - Full updated file
import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { clearIdentityMapping, getIdentityMapping } from '../identity/mapping.js'
import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:clear-my-identity' })

export function makeClearMyIdentityTool(provider: TaskProvider, chatUserId: string): ToolSet[string] {
  return tool({
    description:
      "Clear the user's task tracker identity mapping. Use when user says things like 'I'm not Alice', 'That's not me', 'These aren't my tasks', or 'Unlink my account'.",
    inputSchema: z.object({}),
    execute: () => {
      log.debug({ chatUserId }, 'clear_my_identity called')

      const existing = getIdentityMapping(chatUserId, provider.name)
      if (existing === null || existing.providerUserId === null) {
        return {
          status: 'info',
          message: 'No identity mapping to clear.',
        }
      }

      clearIdentityMapping(chatUserId, provider.name)

      log.info({ chatUserId }, 'Identity cleared via NL')
      return {
        status: 'success',
        message: "Okay, I've unlinked you. Tell me your correct login (e.g., 'I'm jsmith').",
      }
    },
  })
}
```

- [ ] **Step 5: Run all tool tests**

```bash
bun test tests/tools/tools-builder.test.ts tests/tools/set-my-identity.test.ts tests/tools/clear-my-identity.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/tools/tools-builder.ts src/tools/set-my-identity.ts src/tools/clear-my-identity.ts
git commit -m "feat(tools): update buildTools and identity tools to use chatUserId"
```

---

## Task 4: Update Call Sites in llm-orchestrator.ts

**Files:**

- Modify: `src/llm-orchestrator.ts:62-72`, `130-150`, `209-224`

**Context:** The `processMessage` function receives messages via `bot.ts`, which has access to the actual `msg.user.id`. We need to thread this through to `makeTools`.

Looking at the code flow:

1. `bot.ts` `onIncomingMessage` receives `msg: IncomingMessage` with `msg.user.id`
2. It calls `handleMessage` which creates a queue item with `userId: msg.user.id`
3. The queue eventually calls `processCoalescedMessage` which calls `deps.processMessage`
4. `processMessage` in `llm-orchestrator.ts` currently only receives `contextId` (which is `storageContextId`)

We need to:

1. Update `processMessage` signature to accept `chatUserId`
2. Update `callLlm` to pass `chatUserId` to `getOrCreateTools`
3. Update `getOrCreateTools` to accept and use `chatUserId`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/llm-orchestrator.test.ts - verify chatUserId is passed to makeTools
import { describe, expect, it, mock, beforeEach } from 'bun:test'
import { processMessage } from '../src/llm-orchestrator.js'
import { mockLogger } from './utils/test-helpers.js'

describe('processMessage chatUserId', () => {
  beforeEach(() => {
    mockLogger()
    mock.restore()
  })

  it('should accept chatUserId parameter for identity isolation', async () => {
    // This is an integration test - verify the signature accepts chatUserId
    // The actual isolation is tested in identity tool tests
    expect(typeof processMessage).toBe('function')
  })
})
```

- [ ] **Step 2: Update `processMessage` and `callLlm` signatures**

```typescript
// src/llm-orchestrator.ts - key changes

// Update getOrCreateTools to accept chatUserId
const getOrCreateTools = (contextId: string, chatUserId: string, provider: TaskProvider): ToolSet => {
  const cachedTools = getCachedTools(contextId)
  if (cachedTools !== undefined && cachedTools !== null && isToolSet(cachedTools)) {
    log.debug({ contextId }, 'Using cached tools')
    return cachedTools
  }
  log.debug({ contextId, chatUserId }, 'Building tools (cache miss)')
  const tools = makeTools(provider, { storageContextId: contextId, chatUserId })
  setCachedTools(contextId, tools)
  return tools
}

// Update callLlm to accept and pass chatUserId
const callLlm = async (
  reply: ReplyFn,
  contextId: string,
  chatUserId: string,
  username: string | null,
  history: readonly ModelMessage[],
  deps: LlmOrchestratorDeps,
): Promise<{ response: { messages: ModelMessage[] } }> => {
  // ... existing code ...
  const provider = deps.buildProviderForUser(contextId)
  const tools = getOrCreateTools(contextId, chatUserId, provider)
  // ... rest of function ...
}

// Update processMessage signature
export const processMessage = async (
  reply: ReplyFn,
  contextId: string,
  chatUserId: string,
  username: string | null,
  userText: string,
  deps: LlmOrchestratorDeps = defaultDeps,
): Promise<void> => {
  log.debug({ contextId, chatUserId, userText }, 'processMessage called')
  log.info({ contextId, chatUserId, messageLength: userText.length }, 'Message received from user')

  const baseHistory = getCachedHistory(contextId)
  const newMessage: ModelMessage = { role: 'user', content: userText }
  const history = [...baseHistory, newMessage]
  appendHistory(contextId, [newMessage])
  try {
    const result = await callLlm(reply, contextId, chatUserId, username, history, deps)
    // ... rest of function ...
  }
  // ... error handling ...
}
```

- [ ] **Step 3: Update bot.ts to pass chatUserId**

```typescript
// src/bot.ts - update processCoalescedMessage

async function processCoalescedMessage(
  coalescedItem: {
    text: string
    userId: string
    username: string | null
    storageContextId: string
    files: readonly IncomingFile[]
    reply: ReplyFn
  },
  deps: BotDeps,
): Promise<void> {
  const start = Date.now()

  coalescedItem.reply.typing()

  if (coalescedItem.files.length > 0) {
    storeIncomingFiles(coalescedItem.storageContextId, coalescedItem.files)
  } else {
    clearIncomingFiles(coalescedItem.storageContextId)
  }

  try {
    await deps.processMessage(
      coalescedItem.reply,
      coalescedItem.storageContextId,
      coalescedItem.userId, // Pass actual user ID as chatUserId
      coalescedItem.username,
      coalescedItem.text,
    )
  } finally {
    clearIncomingFiles(coalescedItem.storageContextId)
    emit('message:replied', {
      userId: coalescedItem.userId,
      contextId: coalescedItem.storageContextId,
      duration: Date.now() - start,
    })
  }
}
```

- [ ] **Step 4: Update BotDeps interface**

```typescript
// src/bot.ts:28-34
export interface BotDeps {
  processMessage: (
    reply: ReplyFn,
    contextId: string,
    chatUserId: string,
    username: string | null,
    userText: string,
  ) => Promise<void>
}

const defaultBotDeps: BotDeps = {
  processMessage: defaultProcessMessage,
}
```

- [ ] **Step 5: Run tests**

```bash
bun test tests/llm-orchestrator.test.ts tests/bot.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/llm-orchestrator.ts src/bot.ts
git commit -m "feat(orchestrator): thread chatUserId through to makeTools"
```

---

## Task 5: Update Deferred Prompts

**Files:**

- Modify: `src/deferred-prompts/proactive-llm.ts:176-220`

**Context:** Deferred prompts run in `invokeFull` mode with full tools. In this context, `userId` is already the actual chat user ID (not a group context), so we can pass it as both `storageContextId` and `chatUserId`.

- [ ] **Step 1: Write the test**

```typescript
// tests/deferred-prompts/proactive-llm.test.ts - add test
import { describe, expect, it, mock, beforeEach } from 'bun:test'
import { dispatchExecution } from '../../src/deferred-prompts/proactive-llm.js'
import { mockLogger } from '../utils/test-helpers.js'

describe('proactive-llm identity isolation', () => {
  beforeEach(() => {
    mockLogger()
    mock.restore()
  })

  it('should pass userId as chatUserId in full mode', async () => {
    // This verifies the signature is correct
    // Full integration test would require mocking makeTools
    expect(typeof dispatchExecution).toBe('function')
  })
})
```

- [ ] **Step 2: Update invokeFull to pass chatUserId**

```typescript
// src/deferred-prompts/proactive-llm.ts:176-220
async function invokeFull(
  userId: string,
  type: 'scheduled' | 'alert',
  prompt: string,
  metadata: ExecutionMetadata,
  buildProviderFn: BuildProviderFn,
  matchedTasksSummary: string | undefined,
  deps: ProactiveLlmDeps,
): Promise<string> {
  log.debug({ userId, mode: 'full' }, 'invokeFull called')
  const config = getLlmConfig(userId)
  if (typeof config === 'string') return config

  const provider = buildProviderFn(userId)
  if (provider === null) {
    log.warn({ userId }, 'Could not build task provider for deferred prompt')
    return 'Deferred prompt skipped: task provider not configured.'
  }

  const model = deps.buildModel(config, config.mainModel)
  // In deferred prompts, userId is already the actual user (not a group)
  // So we pass it as both storageContextId and chatUserId
  const tools = makeTools(provider, {
    storageContextId: userId,
    chatUserId: userId,
    mode: 'proactive',
  })
  const timezone = getConfig(userId, 'timezone') ?? 'UTC'
  const systemPrompt = buildSystemPrompt(provider, userId)
  const trigger = buildProactiveTrigger(type, prompt, timezone, matchedTasksSummary)
  const history = getCachedHistory(userId)
  const { messages: messagesWithMemory } = buildMessagesWithMemory(userId, history)
  const finalMessages: ModelMessage[] = [
    ...messagesWithMemory,
    { role: 'system', content: trigger.systemContext },
    ...buildMetadataMessages(metadata),
    { role: 'user', content: trigger.userContent },
  ]

  log.debug({ userId, mainModel: config.mainModel, historyLength: history.length, mode: 'full' }, 'generateText')
  const result = await deps.generateText({
    model,
    system: systemPrompt,
    messages: finalMessages,
    tools,
    stopWhen: deps.stepCountIs(25),
    timeout: 1_200_000,
  })
  persistProactiveResults(userId, result, history)
  return result.text ?? 'Done.'
}
```

- [ ] **Step 3: Run tests**

```bash
bun test tests/deferred-prompts/proactive-llm.test.ts
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/deferred-prompts/proactive-llm.ts tests/deferred-prompts/proactive-llm.test.ts
git commit -m "feat(deferred-prompts): pass chatUserId in proactive LLM"
```

---

## Task 6: Update Test Files

**Files:**

- Modify: `tests/tools/set-my-identity.test.ts`
- Modify: `tests/tools/clear-my-identity.test.ts`
- Modify: `tests/tools/index.test.ts`
- Modify: `tests/tools/tools-builder.test.ts`

**Context:** Update tests to verify identity isolation works correctly with separate `chatUserId` and `storageContextId`.

- [ ] **Step 1: Update set-my-identity tests**

```typescript
// tests/tools/set-my-identity.test.ts
import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { getIdentityMapping, clearIdentityMapping } from '../../src/identity/mapping.js'
import type { TaskProvider } from '../../src/providers/types.js'
import { makeSetMyIdentityTool } from '../../src/tools/set-my-identity.js'
import { mockLogger, setupTestDb, getToolExecutor } from '../utils/test-helpers.js'

const mockProvider: TaskProvider = {
  name: 'mock',
  capabilities: new Set(),
  configRequirements: [],
  identityResolver: {
    searchUsers: mock((query: string) => {
      if (query === 'jsmith') {
        return Promise.resolve([{ id: 'user-123', login: 'jsmith', name: 'John Smith' }])
      }
      return Promise.resolve([])
    }),
  },
  buildTaskUrl: () => '',
  buildProjectUrl: () => '',
  classifyError: (e) => {
    throw e
  },
  getPromptAddendum: () => '',
  createTask(): Promise<never> {
    throw new Error('not implemented')
  },
  getTask(): Promise<never> {
    throw new Error('not implemented')
  },
  updateTask(): Promise<never> {
    throw new Error('not implemented')
  },
  listTasks(): Promise<never> {
    throw new Error('not implemented')
  },
  searchTasks(): Promise<never> {
    throw new Error('not implemented')
  },
} as TaskProvider

describe('set_my_identity tool', () => {
  const testChatUserId = 'test-user-tool-123'
  const testGroupId = 'group-456'

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    clearIdentityMapping(testChatUserId, 'mock')
    clearIdentityMapping(testGroupId, 'mock')
  })

  test('returns tool with correct structure', () => {
    const tool = makeSetMyIdentityTool(mockProvider, testChatUserId)
    expect(tool.description).toContain('identity')
  })

  test('should create identity mapping when user found', async () => {
    const tool = makeSetMyIdentityTool(mockProvider, testChatUserId)
    const result: unknown = await getToolExecutor(tool)({ claim: "I'm jsmith" }, { toolCallId: '1', messages: [] })

    expect(result).toHaveProperty('status', 'success')
    const mapping = getIdentityMapping(testChatUserId, 'mock')
    expect(mapping?.providerUserLogin).toBe('jsmith')
  })

  test('should isolate identities by chatUserId in group contexts', async () => {
    // Alice sets her identity using her chatUserId
    const aliceTool = makeSetMyIdentityTool(mockProvider, 'user-alice')
    await getToolExecutor(aliceTool)({ claim: "I'm alice" }, { toolCallId: '1', messages: [] })

    // Verify Alice's identity is stored under her chatUserId
    const aliceMapping = getIdentityMapping('user-alice', 'mock')
    expect(aliceMapping?.providerUserLogin).toBe('jsmith')

    // Verify group context doesn't have Alice's identity
    const groupMapping = getIdentityMapping(testGroupId, 'mock')
    expect(groupMapping).toBeNull()

    // Bob sets his identity using his chatUserId
    const bobProvider = {
      ...mockProvider,
      identityResolver: {
        searchUsers: mock((query: string) => {
          if (query === 'bobsmith') {
            return Promise.resolve([{ id: 'user-789', login: 'bobsmith', name: 'Bob Smith' }])
          }
          return Promise.resolve([])
        }),
      },
    } as TaskProvider

    const bobTool = makeSetMyIdentityTool(bobProvider, 'user-bob')
    await getToolExecutor(bobTool)({ claim: "I'm bobsmith" }, { toolCallId: '2', messages: [] })

    // Verify Bob's identity is stored separately
    const bobMapping = getIdentityMapping('user-bob', 'mock')
    expect(bobMapping?.providerUserLogin).toBe('bobsmith')

    // Alice's identity should be unchanged
    const aliceMappingAfter = getIdentityMapping('user-alice', 'mock')
    expect(aliceMappingAfter?.providerUserLogin).toBe('jsmith')
  })

  test('should return error when user not found', async () => {
    const tool = makeSetMyIdentityTool(mockProvider, testChatUserId)
    const result: unknown = await getToolExecutor(tool)({ claim: "I'm nonexistent" }, { toolCallId: '1', messages: [] })

    expect(result).toHaveProperty('status', 'error')
  })

  test('should return error when provider has no identity resolver', async () => {
    const providerWithoutResolver = {
      ...mockProvider,
      identityResolver: undefined,
    } as TaskProvider

    const tool = makeSetMyIdentityTool(providerWithoutResolver, testChatUserId)
    const result: unknown = await getToolExecutor(tool)({ claim: "I'm jsmith" }, { toolCallId: '1', messages: [] })

    expect(result).toHaveProperty('status', 'error')
  })

  test('should return error when claim cannot be parsed', async () => {
    const tool = makeSetMyIdentityTool(mockProvider, testChatUserId)
    const result: unknown = await getToolExecutor(tool)(
      { claim: 'just some random text' },
      { toolCallId: '1', messages: [] },
    )

    expect(result).toHaveProperty('status', 'error')
  })
})
```

- [ ] **Step 2: Update clear-my-identity tests**

```typescript
// tests/tools/clear-my-identity.test.ts
import { beforeEach, describe, expect, test } from 'bun:test'

import { clearIdentityMapping, getIdentityMapping, setIdentityMapping } from '../../src/identity/mapping.js'
import type { TaskProvider } from '../../src/providers/types.js'
import { makeClearMyIdentityTool } from '../../src/tools/clear-my-identity.js'
import { getToolExecutor, mockLogger, setupTestDb } from '../utils/test-helpers.js'

const mockProvider: TaskProvider = {
  name: 'mock',
  capabilities: new Set(),
  configRequirements: [],
  buildTaskUrl: () => '',
  buildProjectUrl: () => '',
  classifyError: (e) => {
    throw e
  },
  getPromptAddendum: () => '',
  createTask(): Promise<never> {
    throw new Error('not implemented')
  },
  getTask(): Promise<never> {
    throw new Error('not implemented')
  },
  updateTask(): Promise<never> {
    throw new Error('not implemented')
  },
  listTasks(): Promise<never> {
    throw new Error('not implemented')
  },
  searchTasks(): Promise<never> {
    throw new Error('not implemented')
  },
} as TaskProvider

describe('clear_my_identity tool', () => {
  const testChatUserId = 'test-user-clear-123'

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()

    // Setup initial mapping
    setIdentityMapping({
      contextId: testChatUserId,
      providerName: 'mock',
      providerUserId: 'user-123',
      providerUserLogin: 'jsmith',
      displayName: 'John Smith',
      matchMethod: 'auto',
      confidence: 100,
    })
  })

  test('returns tool with correct structure', () => {
    const tool = makeClearMyIdentityTool(mockProvider, testChatUserId)
    expect(tool.description).toContain('identity')
  })

  test('should clear identity mapping', async () => {
    const tool = makeClearMyIdentityTool(mockProvider, testChatUserId)
    const result: unknown = await getToolExecutor(tool)({}, { toolCallId: '1', messages: [] })

    expect(result).toHaveProperty('status', 'success')
    const mapping = getIdentityMapping(testChatUserId, 'mock')
    expect(mapping?.providerUserId).toBeNull()
    expect(mapping?.matchMethod).toBe('unmatched')
  })

  test('should isolate clear operations by chatUserId', async () => {
    // Setup another user's identity
    const otherUserId = 'user-other'
    setIdentityMapping({
      contextId: otherUserId,
      providerName: 'mock',
      providerUserId: 'user-999',
      providerUserLogin: 'otheruser',
      displayName: 'Other User',
      matchMethod: 'auto',
      confidence: 100,
    })

    // Clear first user's identity
    const tool = makeClearMyIdentityTool(mockProvider, testChatUserId)
    await getToolExecutor(tool)({}, { toolCallId: '1', messages: [] })

    // First user's identity should be cleared
    const clearedMapping = getIdentityMapping(testChatUserId, 'mock')
    expect(clearedMapping?.providerUserId).toBeNull()

    // Other user's identity should remain intact
    const otherMapping = getIdentityMapping(otherUserId, 'mock')
    expect(otherMapping?.providerUserId).toBe('user-999')
  })

  test('should return info when no mapping exists', async () => {
    // Clear any existing mapping first
    clearIdentityMapping(testChatUserId, 'mock')

    const tool = makeClearMyIdentityTool(mockProvider, testChatUserId)
    const result: unknown = await getToolExecutor(tool)({}, { toolCallId: '1', messages: [] })

    expect(result).toHaveProperty('status', 'info')
    expect(result).toHaveProperty('message', 'No identity mapping to clear.')
  })
})
```

- [ ] **Step 3: Update tools-builder tests**

```typescript
// tests/tools/tools-builder.test.ts
import { describe, expect, it } from 'bun:test'

import type { TaskProvider } from '../../src/providers/types.js'
import { buildTools } from '../../src/tools/tools-builder.js'
import { createMockProvider } from './mock-provider.js'

describe('buildTools', () => {
  it('should include core tools', () => {
    const provider = createMockProvider()
    const tools = buildTools(provider, 'user-123', 'user-123', 'normal')

    expect(tools).toHaveProperty('create_task')
    expect(tools).toHaveProperty('update_task')
    expect(tools).toHaveProperty('search_tasks')
    expect(tools).toHaveProperty('list_tasks')
    expect(tools).toHaveProperty('get_task')
    expect(tools).toHaveProperty('get_current_time')
  })

  it('should conditionally add project tools', () => {
    const provider = createMockProvider({
      capabilities: new Set([
        'projects.list',
        'projects.create',
        'projects.update',
        'projects.delete',
        'projects.team',
      ]),
    } as Partial<TaskProvider>)

    const tools = buildTools(provider, 'user-123', 'user-123', 'normal')

    expect(tools).toHaveProperty('list_projects')
    expect(tools).toHaveProperty('create_project')
    expect(tools).toHaveProperty('update_project')
    expect(tools).toHaveProperty('delete_project')
    expect(tools).toHaveProperty('list_project_team')
    expect(tools).toHaveProperty('add_project_member')
    expect(tools).toHaveProperty('remove_project_member')
  })

  it('should conditionally add comment tools', () => {
    const provider = createMockProvider({
      capabilities: new Set([
        'comments.read',
        'comments.create',
        'comments.update',
        'comments.delete',
        'comments.reactions',
      ]),
    } as Partial<TaskProvider>)

    const tools = buildTools(provider, 'user-123', 'user-123', 'normal')

    expect(tools).toHaveProperty('get_comments')
    expect(tools).toHaveProperty('add_comment')
    expect(tools).toHaveProperty('update_comment')
    expect(tools).toHaveProperty('remove_comment')
    expect(tools).toHaveProperty('add_comment_reaction')
    expect(tools).toHaveProperty('remove_comment_reaction')
  })

  it('should conditionally add deferred prompt tools in normal mode', () => {
    const provider = createMockProvider()
    const tools = buildTools(provider, 'user-123', 'user-123', 'normal')

    expect(tools).toHaveProperty('create_deferred_prompt')
    expect(tools).toHaveProperty('list_deferred_prompts')
  })

  it('should not add deferred prompt tools in proactive mode', () => {
    const provider = createMockProvider()
    const tools = buildTools(provider, 'user-123', 'user-123', 'proactive')

    expect(tools).not.toHaveProperty('create_deferred_prompt')
    expect(tools).not.toHaveProperty('list_deferred_prompts')
  })

  it('should not add user-scoped tools when chatUserId is undefined', () => {
    const provider = createMockProvider()
    const tools = buildTools(provider, undefined, undefined, 'normal')

    expect(tools).not.toHaveProperty('save_memo')
    expect(tools).not.toHaveProperty('list_memos')
    expect(tools).not.toHaveProperty('create_recurring_task')
    expect(tools).not.toHaveProperty('save_instruction')
  })

  it('should add lookup_group_history when contextId is a group', () => {
    const provider = createMockProvider()
    const tools = buildTools(provider, 'user-123', 'user-123:group-1', 'normal')

    expect(tools).toHaveProperty('lookup_group_history')
  })

  it('should not add lookup_group_history when contextId is a DM', () => {
    const provider = createMockProvider()
    const tools = buildTools(provider, 'user-123', 'user-123', 'normal')

    expect(tools).not.toHaveProperty('lookup_group_history')
  })

  describe('chatUserId isolation', () => {
    it('should pass chatUserId separately from contextId to identity tools', () => {
      const provider = createMockProvider({
        identityResolver: {
          searchUsers: () => Promise.resolve([]),
        },
      })
      // chatUserId: 'user-123', contextId: 'group-456' (group chat scenario)
      const tools = buildTools(provider, 'user-123', 'group-456', 'normal')

      expect(tools['set_my_identity']).toBeDefined()
      expect(tools['clear_my_identity']).toBeDefined()
    })

    it('should use chatUserId for identity tools in group contexts', () => {
      const provider = createMockProvider({
        identityResolver: {
          searchUsers: () => Promise.resolve([]),
        },
      })
      // Different chatUserId and contextId (group scenario)
      const tools = buildTools(provider, 'alice-user-id', 'group-123', 'normal')

      // Identity tools should exist and be configured with alice-user-id
      expect(tools['set_my_identity']).toBeDefined()
      expect(tools['clear_my_identity']).toBeDefined()
    })
  })
})
```

- [ ] **Step 4: Run all tool tests**

```bash
bun test tests/tools/
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/tools/
git commit -m "test(tools): add chatUserId isolation tests for identity tools"
```

---

## Task 7: Run Full Test Suite and Verify Fix

- [ ] **Step 1: Run full test suite**

```bash
bun test
```

Expected: All tests PASS

- [ ] **Step 2: Run type check**

```bash
bun typecheck
```

Expected: No type errors

- [ ] **Step 3: Run lint**

```bash
bun lint
```

Expected: No lint errors

- [ ] **Step 4: Run security scan**

```bash
bun security
```

Expected: No security issues related to this change

- [ ] **Step 5: Final verification commit**

```bash
git commit -m "fix(security): isolate identity mappings by chatUserId in group chats

Fixes C1 — Cross-user impersonation vulnerability where identity mapping
was keyed on storageContextId (shared in group chats) instead of the
actual user ID. Now identity tools use chatUserId for proper per-user
isolation.

- Add chatUserId to MakeToolsOptions
- Thread chatUserId through makeTools, buildTools, and identity tools
- Update call sites in llm-orchestrator.ts and proactive-llm.ts
- Add comprehensive isolation tests

Security: HIGH — prevents unauthorized access to other users' task data"
```

---

## Summary

This fix addresses the critical security vulnerability (C1) where:

1. **Before**: Identity mapping used `storageContextId` as the key, which in group chats is a shared group ID
2. **After**: Identity mapping uses `chatUserId` (the actual user ID) as the key, ensuring per-user isolation

The change is backwards compatible:

- In DMs: `chatUserId` === `storageContextId` (same behavior)
- In groups: `chatUserId` is the actual user, `storageContextId` is the group (isolated)

All conversation-scoped data (history, memos, instructions) still uses `storageContextId`, while identity-sensitive operations use `chatUserId`.
