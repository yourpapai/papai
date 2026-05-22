<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Provider Capability Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved provider capability architecture: rename task capabilities to `TaskCapability`, add chat provider metadata and provider-agnostic interactions, refactor the first consumer flows to gate on chat capabilities, and align the plugin-system plans with the new compatibility model.

**Architecture:** This is an additive refactor, not a rewrite. Task providers keep their existing behavior but rename `Capability` to `TaskCapability` behind a temporary alias, while chat providers grow `ChatCapability`, traits, config requirements, and an optional `onInteraction` hook. A shared chat capability helper module and interaction router keep the consumer changes focused, and the existing plugin docs are revised last so they describe the exact provider capability model that the code now implements.

**Tech Stack:** Bun, TypeScript, Bun test, Grammy, Mattermost REST/WebSocket, pino

---

## File Structure

This stays as a **single plan** because all changes build on one shared provider-capability foundation. Splitting this into separate plans would force the implementer to guess cross-task type names, helper APIs, and migration order.

| Path                                                    | Responsibility                                                                                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `src/providers/types.ts`                                | Rename `Capability` to `TaskCapability` and keep a transitional alias                                                                |
| `src/providers/kaneo/constants.ts`                      | Retype Kaneo capability set to `TaskCapability`                                                                                      |
| `src/providers/youtrack/constants.ts`                   | Retype YouTrack capability set to `TaskCapability`                                                                                   |
| `src/chat/types.ts`                                     | Add `ChatCapability`, `ChatProviderTraits`, `ChatProviderConfigRequirement`, `IncomingInteraction`, and optional chat-provider hooks |
| `src/chat/capabilities.ts`                              | Central helper predicates for capability-aware callers                                                                               |
| `src/chat/interaction-router.ts`                        | Shared callback router for `cfg:*`, `wizard_*`, and later `plugin_*` interactions                                                    |
| `src/chat/startup.ts`                                   | Capability-aware startup helper for command menu registration                                                                        |
| `src/chat/telegram/index.ts`                            | Declare Telegram metadata and emit `IncomingInteraction` events                                                                      |
| `src/chat/mattermost/index.ts`                          | Declare Mattermost metadata and intentionally omit unsupported interaction capabilities                                              |
| `src/bot.ts`                                            | Register `onInteraction`, remove provider-name wizard branching, and route interactions through the shared router                    |
| `src/commands/setup.ts`                                 | Stop passing provider names into wizard creation                                                                                     |
| `src/commands/config.ts`                                | Text-first fallback when interactive buttons are unavailable                                                                         |
| `src/commands/context.ts`                               | Warning-only fallback when file delivery is unavailable                                                                              |
| `src/commands/group.ts`                                 | Capability-gated username resolution                                                                                                 |
| `src/index.ts`                                          | Replace duck-typed command-menu startup with capability-aware startup helper                                                         |
| `src/wizard/types.ts`                                   | Remove wizard platform enum from session state                                                                                       |
| `src/wizard/engine.ts`                                  | Remove platform parameter from `createWizard()`                                                                                      |
| `src/wizard-integration.ts`                             | Gate wizard buttons by capability boolean, not provider name                                                                         |
| `tests/utils/test-helpers.ts`                           | Update mock chat providers to satisfy the new chat contract and capture interactions                                                 |
| `tests/chat/capabilities.test.ts`                       | Tests for helper predicates                                                                                                          |
| `tests/chat/interaction-router.test.ts`                 | Tests for shared interaction routing                                                                                                 |
| `tests/chat/startup.test.ts`                            | Tests for capability-aware command menu startup                                                                                      |
| `tests/commands/context.test.ts`                        | New tests for `/context` file capability behavior                                                                                    |
| `docs/plans/2026-03-30-plugin-system-design.md`         | Revise plugin design doc for provider requirements and incompatibility state                                                         |
| `docs/plans/2026-03-30-plugin-system-implementation.md` | Revise plugin implementation plan to add provider-capability groundwork and provider/user-bound plugin tools                         |
| `Delete: src/chat/telegram/config-editor-callbacks.ts`  | Remove Telegram-owned config callback flow after the shared router exists                                                            |
| `Delete: src/wizard/telegram-handlers.ts`               | Remove Telegram-owned wizard callback flow after the shared router exists                                                            |

---

### Task 1: Rename `Capability` to `TaskCapability`

**Files:**

- Modify: `src/providers/types.ts`
- Modify: `src/providers/kaneo/constants.ts`
- Modify: `src/providers/youtrack/constants.ts`
- Modify: `tests/providers/types.test.ts`
- Modify: `tests/tools/mock-provider.ts`
- Modify: `tests/scheduler.test.ts`
- Modify: `tests/providers/youtrack/tools-integration.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test to `tests/providers/types.test.ts`:

```typescript
import type { TaskCapability } from '../../src/providers/types.js'

test('TaskCapability names task provider capabilities explicitly', () => {
  const capabilities: TaskCapability[] = ['tasks.delete', 'comments.create']
  expect(capabilities).toEqual(['tasks.delete', 'comments.create'])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
bun test tests/providers/types.test.ts --reporter=dot
```

Expected: FAIL because `TaskCapability` is not exported from `src/providers/types.ts`.

- [ ] **Step 3: Write minimal implementation**

Update `src/providers/types.ts` so the task capability union is renamed and the old name remains as an alias during migration:

```typescript
/** Capabilities that a task tracker provider may support. */
export type TaskCapability =
  | 'tasks.delete'
  | 'tasks.count'
  | 'tasks.relations'
  | 'tasks.watchers'
  | 'tasks.votes'
  | 'tasks.visibility'
  | 'projects.read'
  | 'projects.list'
  | 'projects.create'
  | 'projects.update'
  | 'projects.delete'
  | 'projects.team'
  | 'comments.read'
  | 'comments.create'
  | 'comments.update'
  | 'comments.delete'
  | 'comments.reactions'
  | 'labels.list'
  | 'labels.create'
  | 'labels.update'
  | 'labels.delete'
  | 'labels.assign'
  | 'statuses.list'
  | 'statuses.create'
  | 'statuses.update'
  | 'statuses.delete'
  | 'statuses.reorder'
  | 'attachments.list'
  | 'attachments.upload'
  | 'attachments.delete'
  | 'workItems.list'
  | 'workItems.create'
  | 'workItems.update'
  | 'workItems.delete'
  | 'sprints.list'
  | 'sprints.create'
  | 'sprints.update'
  | 'sprints.assign'
  | 'activities.read'
  | 'queries.saved'

/** Transitional alias during migration. */
export type Capability = TaskCapability

export interface TaskProvider extends TaskProviderPhaseFive {
  readonly name: string
  readonly capabilities: ReadonlySet<TaskCapability>
  readonly configRequirements: readonly ProviderConfigRequirement[]
}
```

Update the provider constants to use the new name directly. Only the import and the `ReadonlySet` / `Set` generic change here; leave the existing string literals exactly as they are:

```typescript
// src/providers/kaneo/constants.ts
import type { ProviderConfigRequirement, TaskCapability } from '../types.js'

export const ALL_CAPABILITIES: ReadonlySet<TaskCapability> = new Set<TaskCapability>([])
```

```typescript
// src/providers/youtrack/constants.ts
import type { ProviderConfigRequirement, TaskCapability } from '../types.js'

export const YOUTRACK_CAPABILITIES: ReadonlySet<TaskCapability> = new Set<TaskCapability>([])
```

Migrate the tests and mock provider to the new name:

```typescript
// tests/tools/mock-provider.ts
import type { TaskCapability, TaskProvider } from '../../src/providers/types.js'

const ALL_CAPABILITIES: ReadonlySet<TaskCapability> = new Set<TaskCapability>([])
```

```typescript
// tests/scheduler.test.ts
import type { TaskCapability, Task, TaskProvider } from '../src/providers/types.js'

let mockCapabilities: Set<TaskCapability>
```

```typescript
// tests/providers/youtrack/tools-integration.test.ts
import type { TaskCapability } from '../../../src/providers/types.js'

const youtrackCapabilities = new Set<TaskCapability>([])
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
bun test tests/providers/types.test.ts tests/scheduler.test.ts tests/providers/youtrack/tools-integration.test.ts --reporter=dot
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/providers/types.ts src/providers/kaneo/constants.ts src/providers/youtrack/constants.ts tests/providers/types.test.ts tests/tools/mock-provider.ts tests/scheduler.test.ts tests/providers/youtrack/tools-integration.test.ts
git commit -m "refactor(providers): rename Capability to TaskCapability"
```

### Task 2: Add chat capability metadata and helper predicates

**Files:**

- Modify: `src/chat/types.ts`
- Create: `src/chat/capabilities.ts`
- Modify: `tests/chat/types.test.ts`
- Create: `tests/chat/capabilities.test.ts`
- Modify: `tests/utils/test-helpers.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/chat/capabilities.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'

import {
  supportsCommandMenu,
  supportsFileReplies,
  supportsInteractiveButtons,
  supportsUserResolution,
} from '../../src/chat/capabilities.js'
import type { ChatCapability, ChatProvider } from '../../src/chat/types.js'

const interactiveChat: ChatProvider = {
  name: 'mock',
  threadCapabilities: { supportsThreads: true, canCreateThreads: false, threadScope: 'message' },
  capabilities: new Set<ChatCapability>([
    'messages.buttons',
    'interactions.callbacks',
    'messages.files',
    'users.resolve',
    'commands.menu',
  ]),
  traits: { observedGroupMessages: 'all' },
  configRequirements: [],
  registerCommand: (): void => {},
  onMessage: (): void => {},
  onInteraction: (): void => {},
  sendMessage: async (): Promise<void> => {},
  resolveUserId: async (): Promise<string | null> => 'user-1',
  setCommands: async (): Promise<void> => {},
  start: async (): Promise<void> => {},
  stop: async (): Promise<void> => {},
}

describe('chat capability helpers', () => {
  test('supportsInteractiveButtons requires both button rendering and callbacks', () => {
    expect(supportsInteractiveButtons(interactiveChat)).toBe(true)
    expect(
      supportsInteractiveButtons({
        ...interactiveChat,
        capabilities: new Set<ChatCapability>(['messages.buttons']),
      }),
    ).toBe(false)
  })

  test('supportsFileReplies, supportsUserResolution, and supportsCommandMenu read the capability set', () => {
    expect(supportsFileReplies(interactiveChat)).toBe(true)
    expect(supportsUserResolution(interactiveChat)).toBe(true)
    expect(supportsCommandMenu(interactiveChat)).toBe(true)
  })
})
```

Extend `tests/chat/types.test.ts` with a provider shape that includes the new metadata:

```typescript
import type { ChatCapability, ChatProvider, IncomingInteraction, ThreadCapabilities } from '../../src/chat/types.js'

test('ChatProvider interface includes capability metadata and optional interaction hooks', async () => {
  const capabilities: ChatCapability[] = ['messages.buttons', 'interactions.callbacks']

  const mockProvider: ChatProvider = {
    name: 'mock',
    threadCapabilities: {
      supportsThreads: true,
      canCreateThreads: false,
      threadScope: 'message',
    },
    capabilities: new Set(capabilities),
    traits: { observedGroupMessages: 'all', callbackDataMaxLength: 64 },
    configRequirements: [{ key: 'BOT_TOKEN', label: 'Bot Token', required: true }],
    registerCommand: (): void => {},
    onMessage: (): void => {},
    onInteraction: (_handler): void => {},
    sendMessage: async (): Promise<void> => {},
    resolveUserId: async (): Promise<string | null> => 'user123',
    setCommands: async (): Promise<void> => {},
    start: async (): Promise<void> => {},
    stop: async (): Promise<void> => {},
  }

  const interaction: IncomingInteraction = {
    kind: 'button',
    user: { id: 'user123', username: 'alice', isAdmin: false },
    contextId: 'ctx-1',
    contextType: 'dm',
    callbackData: 'cfg:setup',
  }

  expect(mockProvider.capabilities.has('messages.buttons')).toBe(true)
  expect(mockProvider.traits.callbackDataMaxLength).toBe(64)
  expect(interaction.callbackData).toBe('cfg:setup')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
bun test tests/chat/types.test.ts tests/chat/capabilities.test.ts --reporter=dot
```

Expected: FAIL because `ChatCapability`, `IncomingInteraction`, and `src/chat/capabilities.ts` do not exist yet.

- [ ] **Step 3: Write minimal implementation**

Extend `src/chat/types.ts` with the new chat-provider metadata and interaction types while keeping `ThreadCapabilities` intact:

```typescript
export type ChatCapability =
  | 'commands.menu'
  | 'interactions.callbacks'
  | 'messages.buttons'
  | 'messages.files'
  | 'messages.redact'
  | 'messages.reply-context'
  | 'files.receive'
  | 'users.resolve'

export type ChatProviderTraits = {
  observedGroupMessages: 'all' | 'mentions_only'
  maxMessageLength?: number
  callbackDataMaxLength?: number
}

export type ChatProviderConfigRequirement = {
  key: string
  label: string
  required: boolean
}

export type IncomingInteraction = {
  kind: 'button'
  user: ChatUser
  contextId: string
  contextType: ContextType
  callbackData: string
  messageId?: string
  threadId?: string
}

export interface ChatProvider {
  readonly name: string
  readonly threadCapabilities: ThreadCapabilities
  readonly capabilities: ReadonlySet<ChatCapability>
  readonly traits: ChatProviderTraits
  readonly configRequirements: readonly ChatProviderConfigRequirement[]

  registerCommand(name: string, handler: CommandHandler): void
  onMessage(handler: (msg: IncomingMessage, reply: ReplyFn) => Promise<void>): void
  onInteraction?(handler: (interaction: IncomingInteraction, reply: ReplyFn) => Promise<void>): void

  sendMessage(userId: string, markdown: string): Promise<void>
  resolveUserId?(username: string): Promise<string | null>
  setCommands?(adminUserId: string): Promise<void>
  start(): Promise<void>
  stop(): Promise<void>
}
```

Create `src/chat/capabilities.ts`:

```typescript
import type { ChatProvider } from './types.js'

export function supportsInteractiveButtons(chat: Pick<ChatProvider, 'capabilities'>): boolean {
  return chat.capabilities.has('messages.buttons') && chat.capabilities.has('interactions.callbacks')
}

export function supportsFileReplies(chat: Pick<ChatProvider, 'capabilities'>): boolean {
  return chat.capabilities.has('messages.files')
}

export function supportsUserResolution(chat: Pick<ChatProvider, 'capabilities'>): boolean {
  return chat.capabilities.has('users.resolve')
}

export function supportsCommandMenu(chat: Pick<ChatProvider, 'capabilities'>): boolean {
  return chat.capabilities.has('commands.menu')
}
```

Update the chat mocks in `tests/utils/test-helpers.ts` so existing command and bot tests can satisfy the new interface without repeated boilerplate:

```typescript
import type {
  AuthorizationResult,
  ChatCapability,
  ChatProvider,
  ChatProviderConfigRequirement,
  ChatProviderTraits,
  CommandHandler,
  IncomingInteraction,
  IncomingMessage,
  ReplyFn,
} from '../../src/chat/types.js'

const DEFAULT_CHAT_CAPABILITIES: readonly ChatCapability[] = [
  'commands.menu',
  'interactions.callbacks',
  'messages.buttons',
  'messages.files',
  'users.resolve',
]

export function createMockChat(
  options: {
    commandHandlers?: Map<string, CommandHandler>
    sendMessage?: (userId: string, text: string) => Promise<void>
    onMessageHandler?: (handler: (msg: IncomingMessage, reply: ReplyFn) => Promise<void>) => void
    onInteractionHandler?: (handler: (interaction: IncomingInteraction, reply: ReplyFn) => Promise<void>) => void
    resolveUserId?: (username: string) => Promise<string | null>
    setCommands?: (adminUserId: string) => Promise<void>
    capabilities?: ReadonlySet<ChatCapability> | ChatCapability[]
    traits?: ChatProviderTraits
    configRequirements?: readonly ChatProviderConfigRequirement[]
  } = {},
): ChatProvider {
  const capabilities =
    options.capabilities instanceof Set
      ? new Set(options.capabilities)
      : new Set(options.capabilities ?? DEFAULT_CHAT_CAPABILITIES)

  return {
    name: 'mock',
    threadCapabilities: {
      supportsThreads: true,
      canCreateThreads: false,
      threadScope: 'message',
    },
    capabilities,
    traits: options.traits ?? { observedGroupMessages: 'all' },
    configRequirements: options.configRequirements ?? [],
    registerCommand: (name: string, handler: CommandHandler): void => {
      options.commandHandlers?.set(name, handler)
    },
    onMessage: (handler): void => {
      options.onMessageHandler?.(handler)
    },
    onInteraction:
      options.onInteractionHandler === undefined
        ? undefined
        : (handler): void => {
            options.onInteractionHandler?.(handler)
          },
    sendMessage: options.sendMessage ?? ((): Promise<void> => Promise.resolve()),
    resolveUserId:
      options.resolveUserId ??
      ((username: string): Promise<string | null> => {
        const clean = username.startsWith('@') ? username.slice(1) : username
        return Promise.resolve(clean)
      }),
    setCommands: options.setCommands,
    start: (): Promise<void> => Promise.resolve(),
    stop: (): Promise<void> => Promise.resolve(),
  }
}
```

Update the wrapper helper so command tests can override capabilities without rebuilding the provider wiring:

```typescript
export function createMockChatWithCommandHandlers(options: Parameters<typeof createMockChat>[0] = {}): {
  provider: ChatProvider
  commandHandlers: Map<string, CommandHandler>
} {
  const commandHandlers = new Map<string, CommandHandler>()
  const provider = createMockChat({ ...options, commandHandlers })
  return { provider, commandHandlers }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
bun test tests/chat/types.test.ts tests/chat/capabilities.test.ts tests/commands/config.test.ts --reporter=dot
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/chat/types.ts src/chat/capabilities.ts tests/chat/types.test.ts tests/chat/capabilities.test.ts tests/utils/test-helpers.ts
git commit -m "feat(chat): add chat capability metadata"
```

### Task 3: Add a shared interaction router and move Telegram onto it

**Files:**

- Create: `src/chat/interaction-router.ts`
- Modify: `src/chat/telegram/index.ts`
- Create: `tests/chat/interaction-router.test.ts`
- Modify: `tests/chat/telegram/index.test.ts`
- Delete: `src/chat/telegram/config-editor-callbacks.ts`
- Delete: `src/wizard/telegram-handlers.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/chat/interaction-router.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'

import { routeInteraction } from '../../src/chat/interaction-router.js'
import type { IncomingInteraction, ReplyFn } from '../../src/chat/types.js'

const interaction: IncomingInteraction = {
  kind: 'button',
  user: { id: 'user-1', username: 'alice', isAdmin: false },
  contextId: 'ctx-1',
  contextType: 'dm',
  callbackData: 'cfg:edit:timezone',
}

const reply: ReplyFn = {
  text: async (): Promise<void> => {},
  formatted: async (): Promise<void> => {},
  file: async (): Promise<void> => {},
  typing: (): void => {},
  redactMessage: async (): Promise<void> => {},
  buttons: async (): Promise<void> => {},
}

describe('routeInteraction', () => {
  test('routes cfg callbacks through the config interaction dependency', async () => {
    const calls: string[] = []
    const handled = await routeInteraction(interaction, reply, {
      handleConfigInteraction: async () => {
        calls.push('cfg')
        return true
      },
      handleWizardInteraction: async () => false,
    })

    expect(handled).toBe(true)
    expect(calls).toEqual(['cfg'])
  })

  test('routes wizard callbacks through the wizard interaction dependency', async () => {
    const calls: string[] = []
    const handled = await routeInteraction({ ...interaction, callbackData: 'wizard_confirm' }, reply, {
      handleConfigInteraction: async () => false,
      handleWizardInteraction: async () => {
        calls.push('wizard')
        return true
      },
    })

    expect(handled).toBe(true)
    expect(calls).toEqual(['wizard'])
  })

  test('returns false for unrecognized callback prefixes', async () => {
    const handled = await routeInteraction({ ...interaction, callbackData: 'unknown:action' }, reply, {
      handleConfigInteraction: async () => false,
      handleWizardInteraction: async () => false,
    })

    expect(handled).toBe(false)
  })
})
```

Extend `tests/chat/telegram/index.test.ts`:

```typescript
test('provider exposes interactive capabilities and onInteraction hook', () => {
  process.env['TELEGRAM_BOT_TOKEN'] = 'test-token'
  const provider = new TelegramChatProvider()

  expect(provider.capabilities.has('messages.buttons')).toBe(true)
  expect(provider.capabilities.has('interactions.callbacks')).toBe(true)
  expect(typeof provider.onInteraction).toBe('function')

  delete process.env['TELEGRAM_BOT_TOKEN']
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
bun test tests/chat/interaction-router.test.ts tests/chat/telegram/index.test.ts --reporter=dot
```

Expected: FAIL because `src/chat/interaction-router.ts` does not exist and `TelegramChatProvider` does not expose the new metadata/hooks yet.

- [ ] **Step 3: Create the shared interaction router**

Create `src/chat/interaction-router.ts` with dependency injection so it is easy to test:

```typescript
import { handleEditorCallback, parseCallbackData } from '../config-editor/index.js'
import { getNextPrompt, processWizardMessage, cancelWizard } from '../wizard/engine.js'
import { validateAndSaveWizardConfig } from '../wizard/save.js'
import { getWizardSession, resetWizardSession } from '../wizard/state.js'
import type { IncomingInteraction, ReplyFn } from './types.js'

export interface InteractionRouteDeps {
  handleConfigInteraction: (interaction: IncomingInteraction, reply: ReplyFn) => Promise<boolean>
  handleWizardInteraction: (interaction: IncomingInteraction, reply: ReplyFn) => Promise<boolean>
}

const defaultDeps: InteractionRouteDeps = {
  handleConfigInteraction: async (interaction, reply) => {
    const { action, key } = parseCallbackData(interaction.callbackData)
    if (action === null) return true

    const result = handleEditorCallback(interaction.user.id, interaction.contextId, action, key ?? undefined)
    if (!result.handled) return true

    if (result.buttons !== undefined && result.buttons.length > 0) {
      await reply.buttons(result.response ?? '', {
        buttons: result.buttons.map((button) => ({
          text: button.text,
          callbackData:
            button.action === 'edit' && button.key !== undefined
              ? `cfg:edit:${button.key}`
              : button.action === 'save' && button.key !== undefined
                ? `cfg:save:${button.key}`
                : `cfg:${button.action}`,
          style: button.style ?? 'primary',
        })),
      })
    } else if (result.response !== undefined && result.response !== '') {
      await reply.text(result.response)
    }

    return true
  },
  handleWizardInteraction: async (interaction, reply) => {
    const { callbackData, user, contextId } = interaction

    switch (callbackData) {
      case 'wizard_confirm': {
        const result = await validateAndSaveWizardConfig(user.id, contextId)
        await reply.text(result.message)
        return true
      }
      case 'wizard_cancel':
        cancelWizard(user.id, contextId)
        await reply.text('❌ Wizard cancelled. Type /setup to restart.')
        return true
      case 'wizard_restart':
        cancelWizard(user.id, contextId)
        await reply.text('Restarting wizard... Type /setup to begin.')
        return true
      case 'wizard_edit': {
        const session = getWizardSession(user.id, contextId)
        if (session !== null) {
          resetWizardSession(user.id, contextId)
          await reply.text(`🔧 Editing configuration from the beginning...\n\n${getNextPrompt(user.id, contextId)}`)
        }
        return true
      }
      case 'wizard_skip_small_model':
      case 'wizard_skip_embedding': {
        const skipValue = callbackData === 'wizard_skip_small_model' ? 'same' : 'skip'
        const result = await processWizardMessage(user.id, contextId, skipValue)
        if (result.response !== undefined && result.response !== '') {
          if (result.buttons !== undefined && result.buttons.length > 0) {
            await reply.buttons(result.response, {
              buttons: result.buttons.map((button) => ({
                text: button.text,
                callbackData: `wizard_${button.action}`,
                style: button.style ?? 'primary',
              })),
            })
          } else {
            await reply.text(result.response)
          }
        }
        return true
      }
      default:
        return false
    }
  },
}

export async function routeInteraction(
  interaction: IncomingInteraction,
  reply: ReplyFn,
  deps: InteractionRouteDeps = defaultDeps,
): Promise<boolean> {
  if (interaction.callbackData.startsWith('cfg:')) {
    return deps.handleConfigInteraction(interaction, reply)
  }
  if (interaction.callbackData.startsWith('wizard_')) {
    return deps.handleWizardInteraction(interaction, reply)
  }
  return false
}
```

- [ ] **Step 4: Wire Telegram to emit `IncomingInteraction` and delete the old callback handlers**

Update `src/chat/telegram/index.ts`. Add the metadata fields near the top of the file and replace the callback-query section inside `start()` with this version:

```typescript
import type {
  ChatCapability,
  ChatProviderConfigRequirement,
  ChatProviderTraits,
  IncomingInteraction,
} from '../types.js'

const TELEGRAM_CAPABILITIES: ReadonlySet<ChatCapability> = new Set([
  'commands.menu',
  'interactions.callbacks',
  'messages.buttons',
  'messages.files',
  'messages.redact',
  'messages.reply-context',
  'files.receive',
])

const TELEGRAM_TRAITS: ChatProviderTraits = {
  observedGroupMessages: 'all',
}

const TELEGRAM_CONFIG_REQUIREMENTS: readonly ChatProviderConfigRequirement[] = [
  { key: 'TELEGRAM_BOT_TOKEN', label: 'Telegram Bot Token', required: true },
]

export class TelegramChatProvider implements ChatProvider {
  readonly name = 'telegram'
  readonly threadCapabilities = { supportsThreads: true, canCreateThreads: true, threadScope: 'message' } as const
  readonly capabilities = TELEGRAM_CAPABILITIES
  readonly traits = TELEGRAM_TRAITS
  readonly configRequirements = TELEGRAM_CONFIG_REQUIREMENTS

  private interactionHandler: ((interaction: IncomingInteraction, reply: ReplyFn) => Promise<void>) | null = null

  onInteraction(handler: (interaction: IncomingInteraction, reply: ReplyFn) => Promise<void>): void {
    this.interactionHandler = handler
  }

  start(): Promise<void> {
    this.bot.on('callback_query:data', async (ctx) => {
      if (this.interactionHandler === null) return
      const callbackData = ctx.callbackQuery.data ?? ''
      if (callbackData === '') return

      await ctx.answerCallbackQuery()

      const interaction: IncomingInteraction = {
        kind: 'button',
        user: {
          id: String(ctx.from?.id ?? ''),
          username: ctx.from?.username ?? null,
          isAdmin: false,
        },
        contextId: String(ctx.chat?.id ?? ctx.from?.id ?? ''),
        contextType: ctx.chat?.type === 'private' ? 'dm' : 'group',
        callbackData,
        messageId:
          ctx.callbackQuery.message?.message_id === undefined
            ? undefined
            : String(ctx.callbackQuery.message.message_id),
        threadId:
          ctx.callbackQuery.message?.message_thread_id === undefined
            ? undefined
            : String(ctx.callbackQuery.message.message_thread_id),
      }

      await this.interactionHandler(interaction, this.buildReplyFn(ctx))
    })

    return new Promise<void>((resolve, reject) => {
      this.bot
        .start({
          onStart: (botInfo) => {
            this.botUsername = botInfo.username
            log.info({ botUsername: this.botUsername }, 'Telegram bot is running')
            resolve()
          },
        })
        .catch((error: unknown) => {
          const err = error instanceof Error ? error : new Error(String(error))
          log.error({ error: err.message }, 'Telegram polling loop exited')
          reject(err)
        })
    })
  }
}
```

Remove the Telegram-owned callback files once the provider no longer imports them:

```bash
git rm src/chat/telegram/config-editor-callbacks.ts src/wizard/telegram-handlers.ts
```

- [ ] **Step 5: Run tests to verify they pass**

Run:

```bash
bun test tests/chat/interaction-router.test.ts tests/chat/telegram/index.test.ts --reporter=dot
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/chat/interaction-router.ts src/chat/telegram/index.ts tests/chat/interaction-router.test.ts tests/chat/telegram/index.test.ts
git add -u src/chat/telegram/config-editor-callbacks.ts src/wizard/telegram-handlers.ts
git commit -m "feat(chat): add provider-agnostic interaction routing"
```

### Task 4: Remove wizard platform branching and wire bot interactions

**Files:**

- Modify: `src/wizard/types.ts`
- Modify: `src/wizard/engine.ts`
- Modify: `src/wizard-integration.ts`
- Modify: `src/commands/setup.ts`
- Modify: `src/bot.ts`
- Modify: `tests/utils/test-helpers.ts`
- Modify: `tests/wizard/types.test.ts`
- Modify: `tests/wizard/engine.test.ts`
- Modify: `tests/wizard-integration.test.ts`
- Modify: `tests/bot.test.ts`

- [ ] **Step 1: Write the failing tests**

Extend `tests/wizard/engine.test.ts` to use the new `createWizard()` signature and verify session state no longer stores a platform:

```typescript
test('createWizard stores task provider only and no platform field', async () => {
  const result = await createWizard(userId, storageContextId, 'kaneo')

  expect(result.success).toBe(true)

  const session = await getWizardSession(userId, storageContextId)
  expect(session?.taskProvider).toBe('kaneo')
  expect('platform' in (session ?? {})).toBe(false)
})
```

Replace the placeholder test in `tests/wizard-integration.test.ts` with capability-aware button behavior:

```typescript
import { createWizard } from '../src/wizard/engine.js'
import { createMockReply } from './utils/test-helpers.js'

test('handleWizardMessage falls back to text when interactive buttons are disabled', async () => {
  await createWizard(userId, storageContextId, 'kaneo')
  const { reply, textCalls } = createMockReply()

  const handled = await handleWizardMessage(userId, storageContextId, 'sk-test12345', reply, false)

  expect(handled).toBe(true)
  expect(textCalls.length).toBeGreaterThan(0)
})
```

Extend `tests/bot.test.ts` to verify `setupBot()` registers an interaction handler when the provider exposes one:

```typescript
test('setupBot registers chat interaction handler when supported', async () => {
  addUser('auth-user', ADMIN_ID)
  setupUserConfig('auth-user')

  const { provider: mockChat, getMessageHandler, getInteractionHandler } = createMockChatForBot()
  setupBot(mockChat, ADMIN_ID, {
    processMessage: async (): Promise<void> => {},
  })

  expect(getMessageHandler()).not.toBeNull()
  expect(getInteractionHandler()).not.toBeNull()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
bun test tests/wizard/engine.test.ts tests/wizard-integration.test.ts tests/bot.test.ts --reporter=dot
```

Expected: FAIL because `createWizard()` still expects a platform argument, wizard integration still keys off provider name, and the bot mock does not capture interactions yet.

- [ ] **Step 3: Write minimal implementation**

Remove platform from wizard session state in `src/wizard/types.ts`:

```typescript
export interface WizardSession {
  userId: string
  storageContextId: string
  startedAt: Date
  currentStep: number
  totalSteps: number
  data: WizardData
  skippedSteps: number[]
  taskProvider: 'kaneo' | 'youtrack'
}
```

Change `createWizard()` in `src/wizard/engine.ts`:

```typescript
export function createWizard(userId: string, storageContextId: string, taskProvider: TaskProvider): CreateWizardResult {
  const steps = getWizardSteps(taskProvider)
  const existingConfig = getAllConfig(storageContextId)
  const initialData: Partial<Record<ConfigKey, string>> = {}

  for (const key of CONFIG_KEYS) {
    const value = existingConfig[key]
    if (value !== undefined) {
      initialData[key] = value
    }
  }

  createWizardSession({
    userId,
    storageContextId,
    totalSteps: steps.length,
    taskProvider,
    initialData,
  })

  const firstStep = steps[0]
  if (firstStep === undefined) return { success: false, prompt: 'Error: No wizard steps configured' }

  const existingValue = initialData[firstStep.key]
  let prompt = firstStep.prompt
  if (existingValue !== undefined && existingValue !== '') {
    const maskedValue = maskValue(firstStep.key, existingValue)
    prompt = `${firstStep.prompt}\n\n💡 Current value: ${maskedValue} (type new value to change, or "skip" to keep)`
  }

  return { success: true, prompt: `${WELCOME_MESSAGE}\n\n${prompt}` }
}
```

Gate wizard buttons with a boolean in `src/wizard-integration.ts`:

```typescript
export async function handleWizardMessage(
  userId: string,
  storageContextId: string,
  text: string,
  reply: ReplyFn,
  supportsInteractiveButtons: boolean,
): Promise<boolean> {
  if (!hasActiveWizard(userId, storageContextId)) {
    return false
  }

  const wizardResult = await processWizardMessage(userId, storageContextId, text)

  if (!wizardResult.handled) {
    return false
  }

  const buttons = wizardResult.buttons
  if (supportsInteractiveButtons && buttons !== undefined && buttons.length > 0) {
    await reply.buttons(wizardResult.response ?? '', {
      buttons: buttons.map((button) => ({
        text: button.text,
        callbackData: `wizard_${button.action}`,
        style:
          button.action === 'cancel'
            ? 'danger'
            : button.action === 'skip_small_model' || button.action === 'skip_embedding'
              ? 'secondary'
              : 'primary',
      })),
    })
  } else if (wizardResult.response !== undefined && wizardResult.response !== '') {
    await reply.text(wizardResult.response)
  }

  return true
}
```

Update `src/commands/setup.ts`:

```typescript
// src/commands/setup.ts
const result = createWizard(msg.user.id, auth.storageContextId, TASK_PROVIDER)
```

Update `src/bot.ts` with exact function replacements:

```typescript
// src/bot.ts
import { supportsInteractiveButtons } from './chat/capabilities.js'
import { routeInteraction } from './chat/interaction-router.js'

async function autoStartWizardIfNeeded(userId: string, storageContextId: string, reply: ReplyFn): Promise<boolean> {
  if (hasActiveWizard(userId, storageContextId)) return false
  if (process.env['DEMO_MODE'] === 'true' && isDemoUser(userId)) return false

  const taskProvider = process.env['TASK_PROVIDER'] === 'youtrack' ? 'youtrack' : 'kaneo'
  if (!userNeedsSetup(storageContextId, taskProvider)) {
    return false
  }

  const result = createWizard(userId, storageContextId, taskProvider)
  if (!result.success) {
    return false
  }

  await reply.text(result.prompt)
  return true
}

async function maybeInterceptWizard(
  chat: ChatProvider,
  msg: IncomingMessage,
  reply: ReplyFn,
  auth: AuthorizationResult,
): Promise<boolean> {
  const isCommand = msg.text.startsWith('/')
  const interactiveButtons = supportsInteractiveButtons(chat)

  if (!isCommand && auth.allowed) {
    const wasWizardAutoStarted = await autoStartWizardIfNeeded(msg.user.id, auth.storageContextId, reply)
    if (wasWizardAutoStarted) return true
  }

  if (!isCommand) {
    const wasEditorHandled = await handleConfigEditorMessage(msg.user.id, auth.storageContextId, msg.text, reply)
    if (wasEditorHandled) return true
  }

  if (!isCommand) {
    const wasWizardHandled = await handleWizardMessage(
      msg.user.id,
      auth.storageContextId,
      msg.text,
      reply,
      interactiveButtons,
    )
    if (wasWizardHandled) return true
  }

  return false
}

export function setupBot(chat: ChatProvider, adminUserId: string, deps: BotDeps = defaultBotDeps): void {
  registerCommands(chat, adminUserId)
  chat.onMessage((msg, reply) => onIncomingMessage(chat, msg, reply, deps))
  chat.onInteraction?.(async (interaction, reply) => {
    await routeInteraction(interaction, reply)
  })
}
```

Update the bot test helper in `tests/utils/test-helpers.ts`:

```typescript
export function createMockChatForBot(): {
  provider: ChatProvider
  getMessageHandler: () => ((msg: IncomingMessage, reply: ReplyFn) => Promise<void>) | null
  getInteractionHandler: () => ((interaction: IncomingInteraction, reply: ReplyFn) => Promise<void>) | null
} {
  let messageHandler: ((msg: IncomingMessage, reply: ReplyFn) => Promise<void>) | null = null
  let interactionHandler: ((interaction: IncomingInteraction, reply: ReplyFn) => Promise<void>) | null = null

  const provider = createMockChat({
    onMessageHandler: (handler): void => {
      messageHandler = handler
    },
    onInteractionHandler: (handler): void => {
      interactionHandler = handler
    },
  })

  return {
    provider,
    getMessageHandler: () => messageHandler,
    getInteractionHandler: () => interactionHandler,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
bun test tests/wizard/engine.test.ts tests/wizard-integration.test.ts tests/bot.test.ts --reporter=dot
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/wizard/types.ts src/wizard/engine.ts src/wizard-integration.ts src/commands/setup.ts src/bot.ts tests/utils/test-helpers.ts tests/wizard/types.test.ts tests/wizard/engine.test.ts tests/wizard-integration.test.ts tests/bot.test.ts
git commit -m "refactor(chat): remove wizard platform branching"
```

### Task 5: Gate the first consumer flows by chat capabilities

**Files:**

- Create: `src/chat/startup.ts`
- Modify: `src/chat/mattermost/index.ts`
- Modify: `src/commands/config.ts`
- Modify: `src/commands/context.ts`
- Modify: `src/commands/group.ts`
- Modify: `src/index.ts`
- Modify: `tests/commands/config.test.ts`
- Create: `tests/commands/context.test.ts`
- Modify: `tests/commands/group.test.ts`
- Modify: `tests/chat/mattermost/index.test.ts`
- Create: `tests/chat/startup.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/commands/context.test.ts`:

```typescript
import { beforeEach, describe, expect, test } from 'bun:test'

import type { CommandHandler } from '../../src/chat/types.js'
import { registerContextCommand } from '../../src/commands/context.js'
import {
  createAuth,
  createDmMessage,
  createMockChat,
  createMockReply,
  mockLogger,
  setupTestDb,
} from '../utils/test-helpers.js'

describe('/context command', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('warns when file replies are unsupported', async () => {
    const commandHandlers = new Map<string, CommandHandler>()
    const mockChat = createMockChat({
      commandHandlers,
      capabilities: [],
    })

    registerContextCommand(mockChat, 'admin1')
    const handler = commandHandlers.get('context')
    expect(handler).toBeDefined()

    const { reply, textCalls } = createMockReply()
    await handler!(createDmMessage('admin1'), reply, createAuth('admin1', { isBotAdmin: true }))

    expect(textCalls[0]).toBe("This chat provider doesn't support file-based context export yet.")
  })
})
```

Extend `tests/commands/config.test.ts`:

```typescript
import { createMockChat } from '../utils/test-helpers.js'

test('falls back to text when interactive buttons are unavailable', async () => {
  const commandHandlers = new Map<string, CommandHandler>()
  const mockChat = createMockChat({
    commandHandlers,
    capabilities: [],
  })
  registerConfigCommand(mockChat, (_userId: string) => true)
  const handler = commandHandlers.get('config')
  expect(handler).toBeDefined()

  const { reply, textCalls } = createMockReply()
  await handler!(createDmMessage(USER_ID), reply, createAuth(USER_ID, true))

  expect(textCalls[0]).toContain('Current Configuration')
  expect(textCalls[0]).toContain('Interactive editing is not available on this chat provider yet.')
})
```

Extend `tests/commands/group.test.ts`:

```typescript
test('requires explicit user ID when provider cannot resolve usernames', async () => {
  const commandHandlers = new Map<string, CommandHandler>()
  const nonResolvingChat: ChatProvider = {
    ...createMockChat({
      commandHandlers,
      capabilities: [],
    }),
    resolveUserId: undefined,
  }
  registerGroupCommand(nonResolvingChat)

  const { reply, textCalls } = createMockReply()
  await commandHandlers.get('group')!(
    createGroupMessage('admin1', 'adduser @user1', true),
    reply,
    createAuth('admin1', { isGroupAdmin: true }),
  )

  expect(textCalls[0]).toBe('This chat provider does not support username lookup. Use an explicit user ID.')
})

test('requires explicit user ID when username resolution fails', async () => {
  const commandHandlers = new Map<string, CommandHandler>()
  const nonMatchingChat = createMockChat({
    commandHandlers,
    capabilities: ['users.resolve'],
    resolveUserId: async (): Promise<string | null> => null,
  })
  registerGroupCommand(nonMatchingChat)

  const { reply, textCalls } = createMockReply()
  await commandHandlers.get('group')!(
    createGroupMessage('admin1', 'adduser @missing', true),
    reply,
    createAuth('admin1', { isGroupAdmin: true }),
  )

  expect(textCalls[0]).toBe("Couldn't resolve that username. Use an explicit user ID.")
})
```

Create `tests/chat/startup.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'

import { registerCommandMenuIfSupported } from '../../src/chat/startup.js'
import { createMockChat } from '../utils/test-helpers.js'

describe('registerCommandMenuIfSupported', () => {
  test('calls setCommands when commands.menu is supported', async () => {
    const calls: string[] = []
    const chat = createMockChat({
      capabilities: ['commands.menu'],
      setCommands: async (adminUserId: string): Promise<void> => {
        calls.push(adminUserId)
      },
    })

    await registerCommandMenuIfSupported(chat, 'admin-1')
    expect(calls).toEqual(['admin-1'])
  })

  test('does nothing when commands.menu is unsupported', async () => {
    const calls: string[] = []
    const chat = createMockChat({
      capabilities: [],
      setCommands: async (adminUserId: string): Promise<void> => {
        calls.push(adminUserId)
      },
    })

    await registerCommandMenuIfSupported(chat, 'admin-1')
    expect(calls).toEqual([])
  })
})
```

Extend `tests/chat/mattermost/index.test.ts`:

```typescript
test('advertises only the supported Mattermost chat capabilities', () => {
  const provider = new MattermostChatProvider()

  expect(provider.capabilities.has('messages.files')).toBe(true)
  expect(provider.capabilities.has('messages.reply-context')).toBe(true)
  expect(provider.capabilities.has('users.resolve')).toBe(true)
  expect(provider.capabilities.has('messages.buttons')).toBe(false)
  expect(provider.capabilities.has('interactions.callbacks')).toBe(false)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
bun test tests/commands/config.test.ts tests/commands/context.test.ts tests/commands/group.test.ts tests/chat/mattermost/index.test.ts tests/chat/startup.test.ts --reporter=dot
```

Expected: FAIL because the commands still assume universal support, `src/chat/startup.ts` does not exist, and Mattermost does not declare capability metadata yet.

- [ ] **Step 3: Write minimal implementation**

Create `src/chat/startup.ts`:

```typescript
import { supportsCommandMenu } from './capabilities.js'
import type { ChatProvider } from './types.js'

export async function registerCommandMenuIfSupported(chat: ChatProvider, adminUserId: string): Promise<void> {
  if (!supportsCommandMenu(chat)) {
    return
  }
  if (chat.setCommands === undefined) {
    return
  }
  await chat.setCommands(adminUserId)
}
```

Declare Mattermost metadata in `src/chat/mattermost/index.ts`:

```typescript
import type { ChatCapability, ChatProviderConfigRequirement, ChatProviderTraits } from '../types.js'

const MATTERMOST_CAPABILITIES: ReadonlySet<ChatCapability> = new Set([
  'messages.files',
  'messages.redact',
  'messages.reply-context',
  'files.receive',
  'users.resolve',
])

const MATTERMOST_TRAITS: ChatProviderTraits = {
  observedGroupMessages: 'all',
}

const MATTERMOST_CONFIG_REQUIREMENTS: readonly ChatProviderConfigRequirement[] = [
  { key: 'MATTERMOST_URL', label: 'Mattermost URL', required: true },
  { key: 'MATTERMOST_BOT_TOKEN', label: 'Mattermost Bot Token', required: true },
]

export class MattermostChatProvider implements ChatProvider {
  readonly name = 'mattermost'
  readonly threadCapabilities = { supportsThreads: true, canCreateThreads: false, threadScope: 'post' } as const
  readonly capabilities = MATTERMOST_CAPABILITIES
  readonly traits = MATTERMOST_TRAITS
  readonly configRequirements = MATTERMOST_CONFIG_REQUIREMENTS
}
```

Capability-gate the consumer commands:

```typescript
// src/commands/config.ts
import { supportsInteractiveButtons } from '../chat/capabilities.js'

if (!supportsInteractiveButtons(chat)) {
  lines.push(
    '\n💡 Interactive editing is not available on this chat provider yet. Use `/setup` to configure everything.',
  )
  await reply.text(lines.join('\n'))
  return
}

await reply.buttons(lines.join('\n'), { buttons })
```

```typescript
// src/commands/context.ts
import { supportsFileReplies } from '../chat/capabilities.js'

if (!supportsFileReplies(chat)) {
  await reply.text("This chat provider doesn't support file-based context export yet.")
  return
}

await reply.file({ content: Buffer.from(report, 'utf-8'), filename: 'context.txt' })
```

```typescript
// src/commands/group.ts
import { supportsUserResolution } from '../chat/capabilities.js'

async function extractUserId(chat: ChatProvider, input: string): Promise<string | null> {
  if (input.startsWith('@')) {
    if (!supportsUserResolution(chat) || chat.resolveUserId === undefined) {
      return null
    }
    return chat.resolveUserId(input)
  }
  if (/^\d+$/.test(input) || /^[a-zA-Z0-9_-]+$/.test(input)) {
    return input
  }
  return null
}
```

Then update the user-facing messages in `handleAddUser()` / `handleDelUser()`:

```typescript
if (targetUser?.startsWith('@') && (!supportsUserResolution(chat) || chat.resolveUserId === undefined)) {
  await reply.text('This chat provider does not support username lookup. Use an explicit user ID.')
  return
}

if (userId === null) {
  await reply.text(
    targetUser?.startsWith('@') === true
      ? "Couldn't resolve that username. Use an explicit user ID."
      : 'Please provide a valid user mention or ID.',
  )
  return
}
```

Switch startup to the helper in `src/index.ts`:

```typescript
import { registerCommandMenuIfSupported } from './chat/startup.js'

await chatProvider.start()
await registerCommandMenuIfSupported(chatProvider, adminUserId)
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
bun test tests/commands/config.test.ts tests/commands/context.test.ts tests/commands/group.test.ts tests/chat/mattermost/index.test.ts tests/chat/startup.test.ts --reporter=dot
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/chat/startup.ts src/chat/mattermost/index.ts src/commands/config.ts src/commands/context.ts src/commands/group.ts src/index.ts tests/commands/config.test.ts tests/commands/context.test.ts tests/commands/group.test.ts tests/chat/mattermost/index.test.ts tests/chat/startup.test.ts
git commit -m "feat(chat): gate consumer flows by provider capabilities"
```

### Task 6: Revise the plugin-system plans to match the implemented architecture

**Files:**

- Modify: `docs/plans/2026-03-30-plugin-system-design.md`
- Modify: `docs/plans/2026-03-30-plugin-system-implementation.md`

- [ ] **Step 1: Update the design doc with provider capability requirements**

Add provider capability requirements and incompatibility handling to `docs/plans/2026-03-30-plugin-system-design.md`.

Insert these two fields immediately after the existing `permissions:` entry in the manifest type:

```markdown
requiredTaskCapabilities?: TaskCapability[]
requiredChatCapabilities?: ChatCapability[]
```

Update the lifecycle state union to this:

```markdown
type PluginState =
| 'discovered'
| 'approved'
| 'incompatible'
| 'active'
| 'rejected'
| 'error'
```

Add a short explanation that:

- framework permissions and provider requirements are separate concepts
- ordinary plugins keep minimal `PluginChatService` access
- provider-as-plugin remains a later dedicated phase, not a phase-1 responsibility

- [ ] **Step 2: Update the implementation plan so plugin tools are provider/user-bound factories**

Revise `docs/plans/2026-03-30-plugin-system-implementation.md` so it no longer stores raw `ToolSet[string]` values in plugin state.

Replace the relevant shape with this:

```markdown
export interface RegisteredPluginTool {
build(args: {
userId: string
taskProvider: TaskProvider
store: PluginStore
}): ToolSet[string]
}

export type RegisteredPlugin = {
readonly manifest: PluginManifest
readonly dir: string
state: PluginState
instance?: PluginInstance
error?: string
readonly registeredTools: Map<string, RegisteredPluginTool>
readonly registeredPrompts: Map<string, string | (() => string | Promise<string>)>
readonly registeredJobs: string[]
readonly registeredCommands: string[]
}
```

Also insert a new early phase/task group that describes:

1. shared provider metadata (`TaskCapability`, `ChatCapability`, traits, startup helper)
2. provider-agnostic interaction routing
3. capability-gated consumer refactors
4. plugin compatibility checks using `requiredTaskCapabilities` / `requiredChatCapabilities`

- [ ] **Step 3: Validate the doc updates**

Run:

```bash
rg -n "TaskCapability|requiredTaskCapabilities|requiredChatCapabilities|incompatible|provider-agnostic interaction" docs/plans/2026-03-30-plugin-system-design.md docs/plans/2026-03-30-plugin-system-implementation.md
```

Expected: Matches in both files for the new provider capability model and incompatibility handling.

- [ ] **Step 4: Commit**

```bash
git add docs/plans/2026-03-30-plugin-system-design.md docs/plans/2026-03-30-plugin-system-implementation.md
git commit -m "docs(plugins): align plugin plans with provider capabilities"
```

### Task 7: Run the full verification pass

**Files:**

- No source changes expected

- [ ] **Step 1: Run the focused regression suite**

Run:

```bash
bun test tests/providers/types.test.ts tests/providers/youtrack/tools-integration.test.ts tests/scheduler.test.ts tests/chat/types.test.ts tests/chat/capabilities.test.ts tests/chat/interaction-router.test.ts tests/chat/telegram/index.test.ts tests/chat/mattermost/index.test.ts tests/chat/startup.test.ts tests/wizard/types.test.ts tests/wizard/engine.test.ts tests/wizard-integration.test.ts tests/commands/config.test.ts tests/commands/context.test.ts tests/commands/group.test.ts tests/bot.test.ts --reporter=dot
```

Expected: PASS

- [ ] **Step 2: Run the full repository validation**

Run:

```bash
bun run check:full
```

Expected: PASS

- [ ] **Step 3: Stop after verification**

Do **not** create an extra commit if no files changed during verification. At this point the implementation is ready for PR/merge workflow.
