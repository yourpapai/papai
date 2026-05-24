<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Multi-Provider Phase 3 Chat Router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run papai through a `ChatRouter` that owns multiple active chat adapters, tags inbound traffic with `platformInstanceId`, and routes proactive sends to an explicit platform instance.

**Architecture:** Keep the existing adapter boundary, but introduce `ChatRouter` as the only `ChatProvider` passed to `setupBot()`, scheduler, pollers, startup helpers, and admin notices. Phase 3 intentionally updates the proactive-send contract to `sendMessage(platformInstanceId, target, markdown)` and updates concrete adapters to accept and ignore the first parameter. The router fans out command registration and command-menu registration, delegates optional resolver/rendering surfaces to the source instance, and is constructed from decrypted active `platform_instances` rows.

**Tech Stack:** Bun runtime and `bun:test`, TypeScript, Drizzle ORM with `bun:sqlite`, pino logging, existing `src/chat/*` adapters, existing `src/instances/*` stores, existing `DeferredDeliveryTarget` delivery model.

---

## External Documentation Checked

- Bun test runner docs were checked with Context7 (`/oven-sh/bun`) and web search (`https://bun.com/docs/test`). Use exact test-file paths prefixed with `./`, for example `bun test ./tests/chat/router.test.ts`, and use `-t` / `--test-name-pattern` to filter by test name.

---

## Scope Notes

- This is Phase 3 only. Do not build dashboard Apply, platform-admin CRUD, or plugin capability re-evaluation.
- Phase 1 storage exists in code, but `src/instances/platform-store.ts` currently exposes `listPlatformInstances()`, not `listActivePlatformInstances()`.
- `src/chat/registry.ts` currently builds providers from env-shaped dependencies. Phase 3 adds config-backed creation without deleting `createChatProvider(name)` because current startup and tests still cover the env path.
- The current `ChatProvider` interface includes `renderContext()`, optional `resolveUserId()`, optional label resolvers, optional `setCommands()`, `threadCapabilities`, `capabilities`, `traits`, and `configRequirements`. The router must implement the whole surface, not just `registerCommand`, `onMessage`, `sendMessage`, `start`, and `stop`.
- `DeferredDeliveryTarget` is persisted in scheduled and alert prompts. Do not add `platformInstanceId` to that persisted shape in Phase 3. Pass `platformInstanceId` as the new first `sendMessage()` argument instead.
- Concrete adapters should set `platformInstanceId` on directly emitted messages and interactions too. In normal runtime the router overwrites it with the managed instance ID, but direct adapter tests still need valid `IncomingMessage` and `IncomingInteraction` values after the type becomes required.

---

## File Structure

### New Files

- `src/chat/router.ts` — `ChatRouter implements ChatProvider`, managed instance lifecycle, command replay, inbound tagging, proactive send routing, command-menu fan-out, capability union, instance-specific context rendering, and optional resolver delegation.
- `src/chat/delivery-routing.ts` — looks up `context_settings.platformInstanceId` for a `DeferredDeliveryTarget` and logs a skip when proactive delivery cannot be routed safely.
- `tests/chat/router.test.ts` — router lifecycle, fan-out, replay, tagging, send routing, command-menu fan-out, resolver delegation, and failure isolation.
- `tests/chat/incoming-message-shape.test.ts` — type/runtime shape coverage for required `platformInstanceId` fields.
- `tests/chat/delivery-routing.test.ts` — proactive delivery route lookup and missing-assignment behavior.

### Modified Files

- `src/chat/types.ts` — add `platformInstanceId` to inbound message/interaction types, add optional `platformInstanceId` to `ResolveUserContext`, and change `ChatProvider.sendMessage` to `(platformInstanceId, target, markdown)`.
- `tests/utils/test-helpers.ts` — default message factories and mock chat helpers to `platformInstanceId: 'test-instance'` and new `sendMessage` signature.
- `src/chat/registry.ts` — add config-backed provider construction from `platform_instances.config`; preserve env-backed `createChatProvider()`.
- `src/chat/telegram/index.ts` — accept instance ID in constructor, include it in emitted messages/interactions, and accept new `sendMessage` signature.
- `src/chat/mattermost/index.ts` — accept config overrides and instance ID in constructor, include it in emitted messages, and accept new `sendMessage` signature.
- `src/chat/discord/index.ts` — accept instance ID in constructor, include it in emitted messages/interactions, and accept new `sendMessage` signature.
- `src/instances/platform-store.ts` — add `listActivePlatformInstances()` helper.
- `src/index.ts` — construct and start `ChatRouter`, load active platform instances from DB, build staged downloader independently of `chat.name`, and pass explicit platform IDs to startup notices.
- `src/chat/startup.ts` — keep calling `setCommands` through the router; add tests for fan-out in router tests rather than hard-coding router behavior here.
- `src/commands/context.ts` — render `/context` using the source instance when the chat object is a router.
- `src/commands/group.ts` — pass `msg.platformInstanceId` into user and label resolution contexts.
- `src/commands/admin.ts` — route `/announce` through `msg.platformInstanceId`.
- `src/announcements.ts` — require a platform instance ID for version announcement sends.
- `src/deferred-prompts/poller.ts` — resolve delivery platform from `context_settings` before every scheduled/alert proactive send.
- `src/scheduler-recurring.ts` — resolve delivery platform before recurring-task notifications.
- Existing tests that construct `ChatProvider`, `IncomingMessage`, `IncomingInteraction`, or assert proactive sends — update to the new required fields/signature.

### Decomposition Decisions

- `ChatRouter` owns runtime adapter routing. It does not mutate DB rows; dashboard Apply remains Phase 4.
- `delivery-routing.ts` is separate from the router because scheduler and poller should not reach into router internals or duplicate `context_settings` lookup logic.
- Registry config mapping stays in `src/chat/registry.ts` because the mapping is part of chat-provider construction, not instance storage.
- `/context` is the only command that needs instance-specific `renderContext()` today; it should use `renderContextForInstance()` when available and fall back to `chat.renderContext()` for tests or direct adapter usage.

---

## Task 1: Update Chat Types And Shared Test Helpers

**Files:**

- Modify: `src/chat/types.ts:24-297`
- Modify: `tests/utils/test-helpers.ts:252-596`
- Modify: `tests/chat/types.test.ts:54-143`
- Create: `tests/chat/incoming-message-shape.test.ts`

- [ ] **Step 1: Write the failing inbound-shape test**

Create `tests/chat/incoming-message-shape.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { IncomingInteraction, IncomingMessage, ResolveUserContext } from '../../src/chat/types.js'

describe('incoming chat platform instance shape', () => {
  test('IncomingMessage carries required platformInstanceId', () => {
    const message: IncomingMessage = {
      user: { id: 'user-1', username: null, isAdmin: false },
      contextId: 'user-1',
      contextType: 'dm',
      isMentioned: false,
      text: 'hello',
      platformInstanceId: 'telegram-default',
    }

    expect(message.platformInstanceId).toBe('telegram-default')
  })

  test('IncomingInteraction carries required platformInstanceId', () => {
    const interaction: IncomingInteraction = {
      kind: 'button',
      user: { id: 'user-1', username: 'alice', isAdmin: false },
      contextId: 'user-1',
      contextType: 'dm',
      storageContextId: 'user-1',
      callbackData: 'cfg:setup',
      platformInstanceId: 'mattermost-team',
    }

    expect(interaction.platformInstanceId).toBe('mattermost-team')
  })

  test('ResolveUserContext can carry platformInstanceId for router delegation', () => {
    const context: ResolveUserContext = {
      contextId: 'group-1',
      contextType: 'group',
      platformInstanceId: 'discord-prod',
    }

    expect(context.platformInstanceId).toBe('discord-prod')
  })
})
```

- [ ] **Step 2: Run the new test and typecheck to verify RED**

Run: `bun test ./tests/chat/incoming-message-shape.test.ts && bun typecheck`

Expected: FAIL. The test/typecheck should report that `platformInstanceId` is not part of `IncomingMessage`, `IncomingInteraction`, or `ResolveUserContext` yet.

- [ ] **Step 3: Update `src/chat/types.ts`**

Change `ResolveUserContext`, `IncomingMessage`, `IncomingInteraction`, and `ChatProvider.sendMessage` to this shape while keeping the existing optional fields intact:

```typescript
export type ResolveUserContext = {
  /** Storage key of the conversation where the lookup originated (userId in DMs, channel/group ID in groups). */
  contextId: string
  /** 'dm' or 'group' — adapters may use this to decide whether guild-scoped search is possible. */
  contextType: ContextType
} & Partial<{
  /** Source platform instance for router delegation when context_settings is not available yet. */
  platformInstanceId: string
}>

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
  contextName: string
  contextParentName: string
  commandMatch: string
  messageId: string
  replyToMessageId: string
  replyContext: ReplyContext
  files: IncomingFile[]
  fileCandidates: IncomingFileCandidate[]
  threadId: string
}>

export type IncomingInteraction = {
  kind: 'button'
  user: ChatUser
  contextId: string
  contextType: ContextType
  /** ID of the chat provider instance this interaction arrived on. */
  platformInstanceId: string
  /**
   * Thread-scoped storage key for session/config lookup.
   * Same as contextId in DMs, groupId:threadId in forum topics.
   */
  storageContextId: string
  callbackData: string
} & Partial<{
  messageId: string
  threadId: string
}>

export type ChatProvider = {
  readonly name: string
  readonly threadCapabilities: ThreadCapabilities
  readonly capabilities: ReadonlySet<ChatCapability>
  readonly traits: ChatProviderTraits
  readonly configRequirements: readonly ChatProviderConfigRequirement[]
  registerCommand(name: string, handler: CommandHandler): void
  onMessage(handler: (msg: IncomingMessage, reply: ReplyFn) => Promise<void>): void
  sendMessage(platformInstanceId: string, target: DeferredDeliveryTarget, markdown: string): Promise<void>
  renderContext(snapshot: ContextSnapshot): ContextRendered
  start(): Promise<void>
  stop(): Promise<void>
} & Partial<{
  onInteraction: (handler: (interaction: IncomingInteraction, reply: ReplyFn) => Promise<void>) => void
  resolveUserId: (username: string, context: ResolveUserContext) => Promise<string | null>
  resolveUserLabel: (userId: string, context: ResolveUserContext | undefined) => Promise<string | null>
  resolveGroupLabel: (groupId: string) => Promise<string | null>
  setCommands: (adminUserId: string) => Promise<void>
}>
```

- [ ] **Step 4: Update shared message and chat test helpers**

In `tests/utils/test-helpers.ts`, make these exact helper changes:

```typescript
export function createDmMessage(
  ...args:
    | [userId: string]
    | [userId: string, commandMatch: string]
    | [userId: string, commandMatch: string, username: string | null]
): IncomingMessage {
  const userId = args[0]
  const commandMatch = args.length >= 2 ? args[1] : ''
  const username = args.length >= 3 ? args[2] : null
  const resolvedUsername = username === undefined ? null : username
  return {
    user: { id: userId, username: resolvedUsername, isAdmin: false },
    contextId: userId,
    contextType: 'dm',
    isMentioned: false,
    text: '',
    commandMatch,
    platformInstanceId: 'test-instance',
  }
}

export function createGroupMessage(
  ...args:
    | [userId: string, text: string]
    | [userId: string, text: string, isAdmin: boolean]
    | [userId: string, text: string, isAdmin: boolean, groupId: string]
): IncomingMessage {
  const userId = args[0]
  const text = args[1]
  const isAdmin = args.length >= 3 ? args[2] === true : false
  let groupId = 'group1'
  if (args.length >= 4 && args[3] !== undefined) {
    groupId = args[3]
  }
  return {
    user: { id: userId, username: `user${userId}`, isAdmin },
    contextId: groupId,
    contextType: 'group',
    isMentioned: text.includes('@bot'),
    text,
    commandMatch: text.replace(/^\//u, ''),
    platformInstanceId: 'test-instance',
  }
}
```

Update the mock chat option and implementation signatures in the same file:

```typescript
type CreateMockChatOptions = Partial<
  Readonly<{
    commandHandlers: Map<string, CommandHandler>
    sendMessage: (platformInstanceId: string, target: DeferredDeliveryTarget, text: string) => Promise<void>
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

const DEFAULT_SEND_MESSAGE: (
  platformInstanceId: string,
  target: DeferredDeliveryTarget,
  text: string,
) => Promise<void> = (_platformInstanceId, _target, _text) => Promise.resolve()
```

Update `createMockChatWithHandler()` and `createMockChatWithSentMessages()`:

```typescript
export function createMockChatWithHandler(sendMessageImpl: (userId: string, markdown: string) => Promise<void>): {
  mockChat: ChatProvider
  handlers: Map<string, CommandHandler>
} {
  const handlers = new Map<string, CommandHandler>()
  const mockChat = createMockChat({
    commandHandlers: handlers,
    sendMessage: (_platformInstanceId: string, target: DeferredDeliveryTarget, text: string): Promise<void> =>
      sendMessageImpl(target.contextId, text),
  })
  return { mockChat, handlers }
}

export function createMockChatWithSentMessages(): {
  provider: ChatProvider
  sentMessages: Array<{ platformInstanceId: string; target: DeferredDeliveryTarget; text: string }>
} {
  const sentMessages: Array<{ platformInstanceId: string; target: DeferredDeliveryTarget; text: string }> = []

  const provider = createMockChat({
    sendMessage: (platformInstanceId: string, target: DeferredDeliveryTarget, text: string): Promise<void> => {
      sentMessages.push({ platformInstanceId, target, text })
      return Promise.resolve()
    },
  })

  return { provider, sentMessages }
}
```

- [ ] **Step 5: Update `tests/chat/types.test.ts` direct literals**

In the `IncomingMessage context metadata` test, add `platformInstanceId`:

```typescript
const message = {
  user: { id: 'u1', username: 'alice', isAdmin: false },
  contextId: 'group-1',
  contextType: 'group' as const,
  contextName: 'Operations',
  contextParentName: 'Platform',
  isMentioned: true,
  text: 'hello',
  platformInstanceId: 'test-instance',
}
```

In the `IncomingInteraction` literal, add `platformInstanceId`:

```typescript
const interaction: IncomingInteraction = {
  kind: 'button',
  user: { id: 'user123', username: 'alice', isAdmin: false },
  contextId: 'ctx-1',
  contextType: 'dm',
  storageContextId: 'ctx-1',
  callbackData: 'cfg:setup',
  platformInstanceId: 'test-instance',
}
```

- [ ] **Step 6: Run the focused tests and typecheck**

Run: `bun test ./tests/chat/incoming-message-shape.test.ts ./tests/chat/types.test.ts && bun typecheck`

Expected: Typecheck may still fail in files that directly construct `ChatProvider`, `IncomingMessage`, or `IncomingInteraction`. Fix those diagnostics by applying the same concrete rule: add `platformInstanceId: 'test-instance'` to inbound literals and change mock `sendMessage` functions to accept `(platformInstanceId, target, text)`. Re-run until this command passes.

- [ ] **Step 7: Commit**

```bash
git add src/chat/types.ts tests/utils/test-helpers.ts tests/chat/types.test.ts tests/chat/incoming-message-shape.test.ts
git commit -m "feat(chat): require platform instance on inbound chat events"
```

---

## Task 2: Add Config-Backed Chat Provider Construction

**Files:**

- Modify: `src/chat/registry.ts:15-42`
- Modify: `src/chat/mattermost/index.ts:49-79`
- Modify: `src/chat/telegram/index.ts:59-83`
- Modify: `src/chat/discord/index.ts:46-70`
- Modify: `src/instances/platform-store.ts:69-72`
- Modify: `tests/chat/registry.test.ts`
- Modify: existing adapter constructor tests in `tests/chat/{telegram,mattermost,discord}/index.test.ts`

- [ ] **Step 1: Write failing registry tests for config-backed creation**

Append these tests to `tests/chat/registry.test.ts`:

```typescript
test('createChatProviderFromConfig creates telegram from encrypted-row config token', async () => {
  const { createChatProviderFromConfig } = await import('../../src/chat/registry.js')

  const provider = createChatProviderFromConfig('telegram-default', 'telegram', { token: '123:test-token' })

  expect(provider.name).toBe('telegram')
})

test('createChatProviderFromConfig creates discord from encrypted-row config token', async () => {
  const { createChatProviderFromConfig } = await import('../../src/chat/registry.js')

  const provider = createChatProviderFromConfig('discord-default', 'discord', { token: 'discord-token' })

  expect(provider.name).toBe('discord')
})

test('createChatProviderFromConfig creates mattermost from encrypted-row url and token', async () => {
  const { createChatProviderFromConfig } = await import('../../src/chat/registry.js')

  const provider = createChatProviderFromConfig('mattermost-default', 'mattermost', {
    url: 'https://mattermost.example.test',
    token: 'mattermost-token',
  })

  expect(provider.name).toBe('mattermost')
})

test('createChatProviderFromConfig rejects missing config values before adapter construction', async () => {
  const { createChatProviderFromConfig } = await import('../../src/chat/registry.js')

  expect(() => createChatProviderFromConfig('mattermost-default', 'mattermost', { token: 'mattermost-token' })).toThrow(
    'Missing mattermost instance config',
  )
})
```

- [ ] **Step 2: Run registry tests to verify RED**

Run: `bun test ./tests/chat/registry.test.ts -t createChatProviderFromConfig`

Expected: FAIL with an export error for `createChatProviderFromConfig`.

- [ ] **Step 3: Implement config-backed factory in `src/chat/registry.ts`**

Replace the provider map and exported factory area with this implementation:

```typescript
import type { InstanceConfig, PlatformInstanceType } from '../instances/types.js'

type ChatProviderFactory = (deps: RegistryDeps) => ChatProvider

export interface RegistryDeps {
  env: Record<string, string | undefined>
}

const defaultDeps: RegistryDeps = { env: process.env }

const providers = new Map<string, ChatProviderFactory>()

registerChatProvider('telegram', (deps) => new TelegramChatProvider(deps.env['TELEGRAM_BOT_TOKEN']))
registerChatProvider(
  'mattermost',
  (deps) =>
    new MattermostChatProvider({
      url: deps.env['MATTERMOST_URL'],
      token: deps.env['MATTERMOST_BOT_TOKEN'],
    }),
)
registerChatProvider('discord', (deps) => new DiscordChatProvider(undefined, deps.env['DISCORD_BOT_TOKEN']))

function registerChatProvider(name: string, factory: ChatProviderFactory): void {
  providers.set(name, factory)
}

const configToEnv = (type: PlatformInstanceType, config: InstanceConfig): Record<string, string | undefined> => {
  switch (type) {
    case 'telegram':
      return { TELEGRAM_BOT_TOKEN: config['token'] }
    case 'mattermost':
      return { MATTERMOST_URL: config['url'], MATTERMOST_BOT_TOKEN: config['token'] }
    case 'discord':
      return { DISCORD_BOT_TOKEN: config['token'] }
  }
}

const missingConfigMessage = (type: PlatformInstanceType): string => `Missing ${type} instance config`

export function createChatProvider(name: string, deps: RegistryDeps = defaultDeps): ChatProvider {
  const validation = validateChatProviderEnv(name, deps.env)
  if (!validation.ok) {
    log.error({ reason: validation.reason, missing: validation.missing }, 'Invalid chat provider configuration')
    throw new Error(validation.reason)
  }
  const factory = providers.get(name)!
  log.debug({ name }, 'Creating chat provider instance')
  return factory(deps)
}

export function createChatProviderFromConfig(
  id: string,
  type: PlatformInstanceType,
  config: InstanceConfig,
): ChatProvider {
  const deps: RegistryDeps = { env: configToEnv(type, config) }
  const validation = validateChatProviderEnv(type, deps.env)
  if (!validation.ok) {
    log.error({ id, type, missing: validation.missing }, 'Invalid chat instance configuration')
    throw new Error(missingConfigMessage(type))
  }
  const provider = createChatProvider(type, deps)
  log.debug({ id, type }, 'Creating chat provider instance from DB config')
  return provider
}
```

- [ ] **Step 4: Update adapter constructors to support config-backed Mattermost and instance IDs**

In `src/chat/mattermost/index.ts`, replace the constructor with:

```typescript
type MattermostConstructorConfig = Partial<{
  url: string
  token: string
  platformInstanceId: string
}>

constructor(config: MattermostConstructorConfig = {}) {
  const url = config.url ?? process.env['MATTERMOST_URL']
  const token = config.token ?? process.env['MATTERMOST_BOT_TOKEN']
  if (url === undefined || url.trim() === '') {
    throw new Error('MATTERMOST_URL environment variable is required')
  }
  if (token === undefined || token.trim() === '') {
    throw new Error('MATTERMOST_BOT_TOKEN environment variable is required')
  }
  this.baseUrl = url.replace(/\/+$/u, '')
  this.token = token
  this.platformInstanceId = config.platformInstanceId ?? 'legacy-single'
}
```

Add this private field near the existing private fields:

```typescript
private readonly platformInstanceId: string
```

In `src/chat/telegram/index.ts`, change the constructor signature and field:

```typescript
private readonly platformInstanceId: string

constructor(tokenOverride?: string, platformInstanceId = 'legacy-single') {
  const token = tokenOverride ?? process.env['TELEGRAM_BOT_TOKEN']
  if (token === undefined || token.trim() === '') {
    throw new Error('TELEGRAM_BOT_TOKEN environment variable is required')
  }
  this.token = token
  this.platformInstanceId = platformInstanceId
  this.bot = new Bot(token)
  createTelegramFileFetcher(this.bot.api, this.token, log)
  this.bot.on('callback_query:data', (ctx) => this.dispatchCallbackQuery(ctx))
}
```

In `src/chat/discord/index.ts`, change the constructor signature and field:

```typescript
private readonly platformInstanceId: string

constructor(clientFactory?: DiscordClientFactory, tokenOverride?: string, platformInstanceId = 'legacy-single') {
  const token = tokenOverride ?? process.env['DISCORD_BOT_TOKEN']
  if (token === undefined || token.trim() === '') {
    throw new Error('DISCORD_BOT_TOKEN environment variable is required')
  }
  this.token = token
  this.platformInstanceId = platformInstanceId
  this.clientFactory = typeof clientFactory === 'function' ? clientFactory : defaultClientFactory
  log.debug({ tokenLength: this.token.length }, 'DiscordChatProvider constructed')
}
```

Then update `createChatProviderFromConfig()` to pass the ID by changing the registered factories to accept an optional platform instance ID through `RegistryDeps`:

```typescript
export interface RegistryDeps {
  env: Record<string, string | undefined>
  platformInstanceId?: string
}

registerChatProvider(
  'telegram',
  (deps) => new TelegramChatProvider(deps.env['TELEGRAM_BOT_TOKEN'], deps.platformInstanceId),
)
registerChatProvider(
  'mattermost',
  (deps) =>
    new MattermostChatProvider({
      url: deps.env['MATTERMOST_URL'],
      token: deps.env['MATTERMOST_BOT_TOKEN'],
      platformInstanceId: deps.platformInstanceId,
    }),
)
registerChatProvider(
  'discord',
  (deps) => new DiscordChatProvider(undefined, deps.env['DISCORD_BOT_TOKEN'], deps.platformInstanceId),
)

const deps: RegistryDeps = { env: configToEnv(type, config), platformInstanceId: id }
```

- [ ] **Step 5: Add `listActivePlatformInstances()`**

In `src/instances/platform-store.ts`, add this export below `listPlatformInstances()`:

```typescript
export const listActivePlatformInstances = (): PlatformInstance[] =>
  listPlatformInstances().filter((instance) => instance.status === 'active')
```

- [ ] **Step 6: Run focused tests**

Run: `bun test ./tests/chat/registry.test.ts ./tests/chat/mattermost/index.test.ts ./tests/chat/telegram/index.test.ts ./tests/chat/discord/index.test.ts`

Expected: PASS. If adapter constructor tests fail because they assert the old constructor arity, keep existing behavior by passing no args in those tests; the constructors above preserve env fallback.

- [ ] **Step 7: Commit**

```bash
git add src/chat/registry.ts src/chat/mattermost/index.ts src/chat/telegram/index.ts src/chat/discord/index.ts src/instances/platform-store.ts tests/chat/registry.test.ts tests/chat/mattermost/index.test.ts tests/chat/telegram/index.test.ts tests/chat/discord/index.test.ts
git commit -m "feat(chat): create platform providers from instance config"
```

---

## Task 3: Implement `ChatRouter`

**Files:**

- Create: `src/chat/router.ts`
- Create: `tests/chat/router.test.ts`

- [ ] **Step 1: Write failing router tests**

Create `tests/chat/router.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { ChatRouter, type ManagedChatInstanceFactory } from '../../src/chat/router.js'
import type {
  ChatCapability,
  ChatProvider,
  CommandHandler,
  ContextRendered,
  DeferredDeliveryTarget,
  IncomingInteraction,
  IncomingMessage,
  ReplyFn,
} from '../../src/chat/types.js'
import type { InstanceConfig, PlatformInstanceType } from '../../src/instances/types.js'
import { dmTarget } from '../../src/chat/types.js'
import { mockLogger } from '../utils/test-helpers.js'

type FakeProvider = ChatProvider & {
  deliverMessage: (msg: IncomingMessage) => Promise<void>
  deliverInteraction: (interaction: IncomingInteraction) => Promise<void>
  sent: Array<{ platformInstanceId: string; target: DeferredDeliveryTarget; markdown: string }>
  commandNames: string[]
  setCommandsCalls: string[]
}

const fakeReply: ReplyFn = {
  text: async () => undefined,
  formatted: async () => undefined,
  typing: () => undefined,
  buttons: async () => undefined,
}

const makeProvider = (
  name: string,
  options: Partial<{
    capabilities: readonly ChatCapability[]
    start: () => Promise<void>
    stop: () => Promise<void>
    render: ContextRendered
  }> = {},
): FakeProvider => {
  let messageHandler: ((msg: IncomingMessage, reply: ReplyFn) => Promise<void>) | null = null
  let interactionHandler: ((interaction: IncomingInteraction, reply: ReplyFn) => Promise<void>) | null = null
  const sent: Array<{ platformInstanceId: string; target: DeferredDeliveryTarget; markdown: string }> = []
  const commandNames: string[] = []
  const setCommandsCalls: string[] = []
  return {
    name,
    threadCapabilities: { supportsThreads: true, canCreateThreads: false, threadScope: 'message' },
    capabilities: new Set(options.capabilities ?? []),
    traits: { observedGroupMessages: name === 'discord' ? 'mentions_only' : 'all' },
    configRequirements: [],
    registerCommand: (commandName: string, _handler: CommandHandler): void => {
      commandNames.push(commandName)
    },
    onMessage: (handler): void => {
      messageHandler = handler
    },
    onInteraction: (handler): void => {
      interactionHandler = handler
    },
    sendMessage: (platformInstanceId, target, markdown): Promise<void> => {
      sent.push({ platformInstanceId, target, markdown })
      return Promise.resolve()
    },
    resolveUserId: (username): Promise<string | null> => Promise.resolve(`${name}:${username}`),
    resolveUserLabel: (userId): Promise<string | null> => Promise.resolve(`${name}:${userId}`),
    resolveGroupLabel: (groupId): Promise<string | null> => Promise.resolve(`${name}:${groupId}`),
    setCommands: (adminUserId): Promise<void> => {
      setCommandsCalls.push(adminUserId)
      return Promise.resolve()
    },
    renderContext: () => options.render ?? { method: 'text', content: `${name} context` },
    start: options.start ?? (() => Promise.resolve()),
    stop: options.stop ?? (() => Promise.resolve()),
    deliverMessage: async (msg): Promise<void> => {
      if (messageHandler === null) throw new Error('message handler missing')
      await messageHandler(msg, fakeReply)
    },
    deliverInteraction: async (interaction): Promise<void> => {
      if (interactionHandler === null) throw new Error('interaction handler missing')
      await interactionHandler(interaction, fakeReply)
    },
    sent,
    commandNames,
    setCommandsCalls,
  }
}

describe('ChatRouter', () => {
  const providers = new Map<string, FakeProvider>()
  let factory: ManagedChatInstanceFactory

  beforeEach(() => {
    mockLogger()
    providers.clear()
    factory = (id: string, type: PlatformInstanceType, _config: InstanceConfig): ChatProvider => {
      const provider = makeProvider(type)
      providers.set(id, provider)
      return provider
    }
  })

  test('fans out command registration and replays commands for later instances', () => {
    const router = new ChatRouter(factory)
    router.addInstance('telegram-default', 'telegram', { token: 't' })

    router.registerCommand('help', async () => undefined)
    router.addInstance('mattermost-default', 'mattermost', { url: 'https://mm.test', token: 'm' })

    expect(providers.get('telegram-default')?.commandNames).toEqual(['help'])
    expect(providers.get('mattermost-default')?.commandNames).toEqual(['help'])
  })

  test('injects platformInstanceId into messages and interactions', async () => {
    const router = new ChatRouter(factory)
    const seenMessages: IncomingMessage[] = []
    const seenInteractions: IncomingInteraction[] = []
    router.addInstance('telegram-default', 'telegram', { token: 't' })
    router.onMessage((msg) => {
      seenMessages.push(msg)
      return Promise.resolve()
    })
    router.onInteraction((interaction) => {
      seenInteractions.push(interaction)
      return Promise.resolve()
    })

    await providers.get('telegram-default')!.deliverMessage({
      user: { id: 'user-1', username: null, isAdmin: false },
      contextId: 'user-1',
      contextType: 'dm',
      isMentioned: false,
      text: 'hello',
      platformInstanceId: 'adapter-placeholder',
    })
    await providers.get('telegram-default')!.deliverInteraction({
      kind: 'button',
      user: { id: 'user-1', username: null, isAdmin: false },
      contextId: 'user-1',
      contextType: 'dm',
      storageContextId: 'user-1',
      callbackData: 'cfg:setup',
      platformInstanceId: 'adapter-placeholder',
    })

    expect(seenMessages[0]?.platformInstanceId).toBe('telegram-default')
    expect(seenInteractions[0]?.platformInstanceId).toBe('telegram-default')
  })

  test('routes proactive send to the named instance only', async () => {
    const router = new ChatRouter(factory)
    router.addInstance('telegram-default', 'telegram', { token: 't' })
    router.addInstance('mattermost-default', 'mattermost', { url: 'https://mm.test', token: 'm' })

    await router.sendMessage('mattermost-default', dmTarget('user-1'), 'hello')

    expect(providers.get('telegram-default')?.sent).toEqual([])
    expect(providers.get('mattermost-default')?.sent).toEqual([
      { platformInstanceId: 'mattermost-default', target: dmTarget('user-1'), markdown: 'hello' },
    ])
  })

  test('start isolates failing instances and keeps starting the rest', async () => {
    factory = (id, type) => {
      const provider = makeProvider(type, {
        start: id === 'bad-mm' ? () => Promise.reject(new Error('boom')) : () => Promise.resolve(),
      })
      providers.set(id, provider)
      return provider
    }
    const router = new ChatRouter(factory)
    router.addInstance('telegram-default', 'telegram', { token: 't' })
    router.addInstance('bad-mm', 'mattermost', { url: 'https://mm.test', token: 'm' })

    await router.start()

    expect(router.getInstance('telegram-default')?.status).toBe('active')
    expect(router.getInstance('bad-mm')?.status).toBe('stopped')
  })

  test('removeInstance swallows stop errors and removes the instance', async () => {
    factory = (id, type) => {
      const provider = makeProvider(type, { stop: () => Promise.reject(new Error('stop failed')) })
      providers.set(id, provider)
      return provider
    }
    const router = new ChatRouter(factory)
    router.addInstance('telegram-default', 'telegram', { token: 't' })

    await router.removeInstance('telegram-default')

    expect(router.getInstance('telegram-default')).toBeUndefined()
  })

  test('aggregates capabilities and delegates render and resolver surfaces by instance', async () => {
    factory = (id, type) => {
      const provider = makeProvider(type, {
        capabilities: id === 'telegram-default' ? ['commands.menu'] : ['users.resolve'],
      })
      providers.set(id, provider)
      return provider
    }
    const router = new ChatRouter(factory)
    router.addInstance('telegram-default', 'telegram', { token: 't' })
    router.addInstance('discord-default', 'discord', { token: 'd' })

    await router.setCommands?.('admin-1')
    const resolved = await router.resolveUserId?.('@alice', {
      contextId: 'guild-1',
      contextType: 'group',
      platformInstanceId: 'discord-default',
    })

    expect([...router.capabilities].sort()).toEqual(['commands.menu', 'users.resolve'])
    expect(router.getInstanceTraits('discord-default')?.observedGroupMessages).toBe('mentions_only')
    expect(
      router.renderContextForInstance('discord-default', {
        sections: [],
        totalTokens: 0,
        maxTokens: 1,
        approximate: false,
        modelName: 'm',
      }),
    ).toEqual({
      method: 'text',
      content: 'discord context',
    })
    expect(resolved).toBe('discord:@alice')
    expect(providers.get('telegram-default')?.setCommandsCalls).toEqual(['admin-1'])
    expect(providers.get('discord-default')?.setCommandsCalls).toEqual(['admin-1'])
  })
})
```

- [ ] **Step 2: Run router tests to verify RED**

Run: `bun test ./tests/chat/router.test.ts`

Expected: FAIL with `Cannot find module '../../src/chat/router.js'`.

- [ ] **Step 3: Implement `src/chat/router.ts`**

Create `src/chat/router.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getContextSettings } from '../instances/context-store.js'
import type { InstanceConfig, PlatformInstanceType } from '../instances/types.js'
import { logger } from '../logger.js'
import type {
  ChatCapability,
  ChatProvider,
  ChatProviderTraits,
  CommandHandler,
  ContextRendered,
  ContextSnapshot,
  DeferredDeliveryTarget,
  IncomingInteraction,
  IncomingMessage,
  ReplyFn,
  ResolveUserContext,
  ThreadCapabilities,
} from './types.js'

const log = logger.child({ scope: 'chat:router' })

export type ManagedChatInstance = {
  id: string
  type: PlatformInstanceType
  provider: ChatProvider
  status: 'pending' | 'active' | 'stopped'
}

export type ManagedChatInstanceFactory = (
  id: string,
  type: PlatformInstanceType,
  config: InstanceConfig,
) => ChatProvider

const fallbackThreadCapabilities: ThreadCapabilities = {
  supportsThreads: false,
  canCreateThreads: false,
  threadScope: 'message',
}

const fallbackTraits: ChatProviderTraits = { observedGroupMessages: 'mentions_only' }

const fallbackContextRendered: ContextRendered = {
  method: 'text',
  content: 'No active chat provider is available to render this context.',
}

export class ChatRouter implements ChatProvider {
  readonly name = 'router'
  readonly configRequirements = []
  private readonly instances = new Map<string, ManagedChatInstance>()
  private readonly registeredCommands = new Map<string, CommandHandler>()
  private messageHandler: ((msg: IncomingMessage, reply: ReplyFn) => Promise<void>) | null = null
  private interactionHandler: ((interaction: IncomingInteraction, reply: ReplyFn) => Promise<void>) | null = null

  constructor(private readonly factory: ManagedChatInstanceFactory) {}

  get threadCapabilities(): ThreadCapabilities {
    return this.firstActiveInstance()?.provider.threadCapabilities ?? fallbackThreadCapabilities
  }

  get capabilities(): ReadonlySet<ChatCapability> {
    return new Set(this.activeInstances().flatMap((instance) => [...instance.provider.capabilities]))
  }

  get traits(): ChatProviderTraits {
    return this.firstActiveInstance()?.provider.traits ?? fallbackTraits
  }

  addInstance(id: string, type: PlatformInstanceType, config: InstanceConfig): void {
    if (this.instances.has(id)) throw new Error(`Chat instance already exists: ${id}`)
    const provider = this.factory(id, type, config)
    const instance: ManagedChatInstance = { id, type, provider, status: 'pending' }
    this.instances.set(id, instance)
    this.replayBindings(instance)
    log.info({ id, type }, 'chat instance added to router')
  }

  async removeInstance(id: string): Promise<void> {
    const instance = this.instances.get(id)
    if (instance === undefined) return
    try {
      await instance.provider.stop()
    } catch (error) {
      log.warn(
        { id, error: error instanceof Error ? error.message : String(error) },
        'chat instance stop failed during remove',
      )
    }
    this.instances.delete(id)
  }

  async startInstance(id: string): Promise<void> {
    const instance = this.instances.get(id)
    if (instance === undefined) throw new Error(`Unknown chat instance: ${id}`)
    try {
      await instance.provider.start()
      instance.status = 'active'
      log.info({ id, type: instance.type }, 'chat instance started')
    } catch (error) {
      instance.status = 'stopped'
      log.error({ id, error: error instanceof Error ? error.message : String(error) }, 'chat instance failed to start')
    }
  }

  async stopInstance(id: string): Promise<void> {
    const instance = this.instances.get(id)
    if (instance === undefined) return
    await instance.provider.stop()
    instance.status = 'stopped'
  }

  registerCommand(name: string, handler: CommandHandler): void {
    this.registeredCommands.set(name, handler)
    for (const instance of this.instances.values()) {
      instance.provider.registerCommand(name, handler)
    }
  }

  onMessage(handler: (msg: IncomingMessage, reply: ReplyFn) => Promise<void>): void {
    this.messageHandler = handler
    for (const instance of this.instances.values()) {
      this.bindMessageHandler(instance)
    }
  }

  onInteraction(handler: (interaction: IncomingInteraction, reply: ReplyFn) => Promise<void>): void {
    this.interactionHandler = handler
    for (const instance of this.instances.values()) {
      this.bindInteractionHandler(instance)
    }
  }

  async sendMessage(platformInstanceId: string, target: DeferredDeliveryTarget, markdown: string): Promise<void> {
    const instance = this.instances.get(platformInstanceId)
    if (instance === undefined) {
      log.warn({ platformInstanceId, contextId: target.contextId }, 'sendMessage target platform instance is unknown')
      return
    }
    await instance.provider.sendMessage(platformInstanceId, target, markdown)
  }

  renderContext(snapshot: ContextSnapshot): ContextRendered {
    return this.firstActiveInstance()?.provider.renderContext(snapshot) ?? fallbackContextRendered
  }

  renderContextForInstance(platformInstanceId: string, snapshot: ContextSnapshot): ContextRendered {
    const instance = this.instances.get(platformInstanceId)
    if (instance === undefined) return this.renderContext(snapshot)
    return instance.provider.renderContext(snapshot)
  }

  async start(): Promise<void> {
    for (const instance of this.instances.values()) {
      await this.startInstance(instance.id)
    }
  }

  async stop(): Promise<void> {
    for (const instance of this.instances.values()) {
      await this.stopInstance(instance.id)
    }
  }

  async setCommands(adminUserId: string): Promise<void> {
    for (const instance of this.activeInstances()) {
      if (instance.provider.setCommands === undefined) continue
      try {
        await instance.provider.setCommands(adminUserId)
      } catch (error) {
        log.warn(
          { id: instance.id, error: error instanceof Error ? error.message : String(error) },
          'setCommands failed',
        )
      }
    }
  }

  async resolveUserId(username: string, context: ResolveUserContext): Promise<string | null> {
    const provider = this.resolveProviderForContext(context)
    if (provider?.resolveUserId === undefined) return null
    return provider.resolveUserId(username, context)
  }

  async resolveUserLabel(userId: string, context: ResolveUserContext | undefined): Promise<string | null> {
    const provider = context === undefined ? undefined : this.resolveProviderForContext(context)
    if (provider?.resolveUserLabel === undefined) return null
    return provider.resolveUserLabel(userId, context)
  }

  async resolveGroupLabel(groupId: string): Promise<string | null> {
    const platformInstanceId = getContextSettings(groupId)?.platformInstanceId
    if (platformInstanceId === undefined) return null
    const provider = this.instances.get(platformInstanceId)?.provider
    if (provider?.resolveGroupLabel === undefined) return null
    return provider.resolveGroupLabel(groupId)
  }

  getInstance(id: string): ManagedChatInstance | undefined {
    return this.instances.get(id)
  }

  listInstances(): ManagedChatInstance[] {
    return [...this.instances.values()]
  }

  getInstanceTraits(platformInstanceId: string): ChatProviderTraits | undefined {
    return this.instances.get(platformInstanceId)?.provider.traits
  }

  private replayBindings(instance: ManagedChatInstance): void {
    for (const [name, handler] of this.registeredCommands.entries()) {
      instance.provider.registerCommand(name, handler)
    }
    this.bindMessageHandler(instance)
    this.bindInteractionHandler(instance)
  }

  private bindMessageHandler(instance: ManagedChatInstance): void {
    if (this.messageHandler === null) return
    const outer = this.messageHandler
    instance.provider.onMessage(async (msg, reply) => {
      await outer({ ...msg, platformInstanceId: instance.id }, reply)
    })
  }

  private bindInteractionHandler(instance: ManagedChatInstance): void {
    if (this.interactionHandler === null || instance.provider.onInteraction === undefined) return
    const outer = this.interactionHandler
    instance.provider.onInteraction(async (interaction, reply) => {
      await outer({ ...interaction, platformInstanceId: instance.id }, reply)
    })
  }

  private activeInstances(): ManagedChatInstance[] {
    return [...this.instances.values()].filter(
      (instance) => instance.status === 'active' || instance.status === 'pending',
    )
  }

  private firstActiveInstance(): ManagedChatInstance | undefined {
    return this.activeInstances()[0]
  }

  private resolveProviderForContext(context: ResolveUserContext): ChatProvider | undefined {
    const explicit = context.platformInstanceId
    if (explicit !== undefined) return this.instances.get(explicit)?.provider
    const assigned = getContextSettings(context.contextId)?.platformInstanceId
    return assigned === undefined ? undefined : this.instances.get(assigned)?.provider
  }
}
```

- [ ] **Step 4: Run router tests to verify GREEN**

Run: `bun test ./tests/chat/router.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/chat/router.ts tests/chat/router.test.ts
git commit -m "feat(chat): add multi-instance ChatRouter"
```

---

## Task 4: Update Concrete Adapters For Instance IDs And Send Signature

**Files:**

- Modify: `src/chat/telegram/index.ts:84-146` and message/interaction extraction helpers in the same file
- Modify: `src/chat/mattermost/index.ts:81-107` and posted-message mapping in the same file
- Modify: `src/chat/discord/index.ts:72-85` and dispatch/mapping paths in the same file
- Modify: direct adapter tests under `tests/chat/telegram/index.test.ts`, `tests/chat/mattermost/index.test.ts`, and `tests/chat/discord/index.test.ts`

- [ ] **Step 1: Add failing direct-adapter assertions for platform IDs**

In each adapter test file, add one assertion in an existing message-dispatch test that the captured message includes the constructor-provided instance ID. Use this shape in the local test after creating the provider:

```typescript
const provider = new TelegramChatProvider('123:test-token', 'telegram-test')
const captured: IncomingMessage[] = []
provider.onMessage((msg) => {
  captured.push(msg)
  return Promise.resolve()
})

expect(captured[0]?.platformInstanceId).toBe('telegram-test')
```

For Discord, use the third constructor argument:

```typescript
const provider = new DiscordChatProvider(factory, 'discord-token', 'discord-test')
```

For Mattermost, use the config object:

```typescript
const provider = new MattermostChatProvider({
  url: 'https://mattermost.example.test',
  token: 'mattermost-token',
  platformInstanceId: 'mattermost-test',
})
```

- [ ] **Step 2: Run direct adapter tests to verify RED**

Run: `bun test ./tests/chat/telegram/index.test.ts ./tests/chat/mattermost/index.test.ts ./tests/chat/discord/index.test.ts -t platformInstanceId`

Expected: FAIL because emitted messages do not yet carry the constructor-provided platform instance ID.

- [ ] **Step 3: Update adapter send signatures**

Change each concrete adapter method to the new contract:

```typescript
async sendMessage(_platformInstanceId: string, target: DeferredDeliveryTarget, markdown: string): Promise<void> {
  // Existing adapter body stays the same and uses target + markdown.
}
```

For Telegram, the method body remains:

```typescript
const chatId = parseInt(target.contextId, 10)
const mentionPrefix = buildTelegramMentionPrefix(target)
const formatted = formatLlmOutput(markdown)
const options: Parameters<typeof this.bot.api.sendMessage>[2] = {
  entities: [
    ...mentionPrefix.entities,
    ...formatted.entities.map((entity) => shiftTelegramEntity(entity, mentionPrefix.text.length)),
  ],
}
if (target.contextType === 'group' && target.threadId !== null) {
  options.message_thread_id = parseInt(target.threadId, 10)
}
await this.bot.api.sendMessage(chatId, `${mentionPrefix.text}${formatted.text}`, options)
```

- [ ] **Step 4: Tag emitted messages and interactions inside adapters**

In every object literal returned or passed as `IncomingMessage`, add:

```typescript
platformInstanceId: this.platformInstanceId,
```

In every object literal returned or passed as `IncomingInteraction`, add:

```typescript
platformInstanceId: this.platformInstanceId,
```

For helper functions that do not have access to `this`, pass `platformInstanceId` as an argument from the class method and include it in the returned object:

```typescript
private async extractMessage(ctx: Context, isAdmin: boolean): Promise<IncomingMessage | null> {
  const msg = await extractTelegramMessage(ctx, isAdmin, this.platformInstanceId)
  return msg
}
```

The returned object must include the field next to `text` or `callbackData`:

```typescript
return {
  user,
  contextId,
  contextType,
  isMentioned,
  text,
  platformInstanceId,
}
```

- [ ] **Step 5: Run adapter tests and typecheck**

Run: `bun test ./tests/chat/telegram/index.test.ts ./tests/chat/mattermost/index.test.ts ./tests/chat/discord/index.test.ts && bun typecheck`

Expected: PASS. If typecheck identifies additional adapter helper return objects, add `platformInstanceId` using the same constructor-backed field.

- [ ] **Step 6: Commit**

```bash
git add src/chat/telegram/index.ts src/chat/mattermost/index.ts src/chat/discord/index.ts tests/chat/telegram/index.test.ts tests/chat/mattermost/index.test.ts tests/chat/discord/index.test.ts
git commit -m "feat(chat): tag adapter events with platform instance ids"
```

---

## Task 5: Route Instance-Specific Command Surfaces

**Files:**

- Modify: `src/commands/context.ts:186-223`
- Modify: `src/commands/group.ts:21-84` and `src/commands/group.ts:220-284`
- Modify: tests covering `/context` and `/group` command resolution: `tests/commands/context.test.ts`, `tests/commands/group.test.ts` if present, or the existing command sections in `tests/bot.test.ts`

- [ ] **Step 1: Write failing tests for source-instance rendering and resolution**

In `tests/commands/context.test.ts`, add a test using a chat object with both `renderContext` and `renderContextForInstance`:

```typescript
test('/context renders with the source platform instance when router helper is present', async () => {
  const renderedBy: string[] = []
  const chat = createMockChat({}) as ChatProvider & {
    renderContextForInstance: (platformInstanceId: string, snapshot: ContextSnapshot) => ContextRendered
  }
  chat.renderContextForInstance = (platformInstanceId) => {
    renderedBy.push(platformInstanceId)
    return { method: 'text', content: `rendered by ${platformInstanceId}` }
  }
  const { reply, textCalls } = createMockReply()
  registerContextCommand(chat, {
    collectContext: () => ({ sections: [], totalTokens: 0, maxTokens: 1, approximate: false, modelName: 'm' }),
    buildProvider: () => null,
    buildLiveToolSet: () => ({}),
    resolveActiveToolDefinitions: () => ({}),
    resolveToolSurface: () => ({ tools: {}, routing: undefined }),
  })
  const handler = commandHandlers.get('context')!

  await handler(createDmMessage('context-user', '/context'), reply, createAuth('context-user'))

  expect(renderedBy).toEqual(['test-instance'])
  expect(textCalls).toEqual(['rendered by test-instance'])
})
```

Adapt the `commandHandlers` setup to the local pattern already used in `tests/commands/context.test.ts`.

In the group command tests or the `/group` section of `tests/bot.test.ts`, add a resolver-capture assertion:

```typescript
test('/group adduser passes source platform instance into username resolution', async () => {
  const contexts: ResolveUserContext[] = []
  const chat = createMockChatWithCommandHandlers({
    resolveUserId: (_username, context) => {
      contexts.push(context)
      return Promise.resolve('resolved-user')
    },
  })
  registerGroupCommand(chat.provider)
  const { reply } = createMockReply()
  const msg = {
    ...createGroupMessage('admin-1', '/group adduser @alice', true, 'group-1'),
    platformInstanceId: 'discord-prod',
  }

  await chat.commandHandlers.get('group')!(msg, reply, createAuth('admin-1', { allowed: true, isGroupAdmin: true }))

  expect(contexts[0]).toEqual({ contextId: 'group-1', contextType: 'group', platformInstanceId: 'discord-prod' })
})
```

- [ ] **Step 2: Run command tests to verify RED**

Run: `bun test ./tests/commands/context.test.ts ./tests/bot.test.ts -t platformInstanceId`

Expected: FAIL because `/context` uses `chat.renderContext(snapshot)` and `/group` resolver contexts do not include `platformInstanceId` yet.

- [ ] **Step 3: Update `/context` rendering**

In `src/commands/context.ts`, add this helper near `sendContextResponse()`:

```typescript
type InstanceContextRenderer = ChatProvider & {
  renderContextForInstance?: (platformInstanceId: string, snapshot: ContextSnapshot) => ContextRendered
}

function renderContextForMessage(
  chat: ChatProvider,
  msg: { platformInstanceId: string },
  snapshot: ContextSnapshot,
): ContextRendered {
  const renderer = chat as InstanceContextRenderer
  if (renderer.renderContextForInstance !== undefined) {
    return renderer.renderContextForInstance(msg.platformInstanceId, snapshot)
  }
  return chat.renderContext(snapshot)
}
```

Then replace:

```typescript
const rendered = chat.renderContext(snapshot)
```

with:

```typescript
const rendered = renderContextForMessage(chat, msg, snapshot)
```

- [ ] **Step 4: Update `/group` resolver contexts**

Change `LabelResolverContext` in `src/commands/group.ts`:

```typescript
type LabelResolverContext = {
  readonly chat: ChatProvider
  readonly contextId: string
  readonly contextType: 'dm' | 'group'
  readonly platformInstanceId: string
}
```

Change the label resolver call:

```typescript
resolveChatUserDisplayLabel(resolverContext.chat, userId, {
  contextId: resolverContext.contextId,
  contextType: resolverContext.contextType,
  platformInstanceId: resolverContext.platformInstanceId,
})
```

When building `resolverContext`, include the message source:

```typescript
const resolverContext: LabelResolverContext = {
  chat,
  contextId: msg.contextId,
  contextType: msg.contextType,
  platformInstanceId: msg.platformInstanceId,
}
```

When calling `extractUserId()`, pass the platform instance:

```typescript
const result = await extractUserId(chat, targetUser, {
  contextId: msg.contextId,
  contextType: msg.contextType,
  platformInstanceId: msg.platformInstanceId,
})
```

- [ ] **Step 5: Run focused command tests**

Run: `bun test ./tests/commands/context.test.ts ./tests/bot.test.ts -t platformInstanceId`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/commands/context.ts src/commands/group.ts tests/commands/context.test.ts tests/bot.test.ts
git commit -m "feat(chat): route command helpers through source platform instance"
```

---

## Task 6: Add Proactive Delivery Routing Helper

**Files:**

- Create: `src/chat/delivery-routing.ts`
- Create: `tests/chat/delivery-routing.test.ts`
- Modify later in Task 7: scheduler, poller, announcements, admin command

- [ ] **Step 1: Write failing delivery-routing tests**

Create `tests/chat/delivery-routing.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { dmTarget } from '../../src/chat/types.js'
import { resolveDeliveryPlatformInstanceId } from '../../src/chat/delivery-routing.js'
import { setContextSettings } from '../../src/instances/context-store.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('resolveDeliveryPlatformInstanceId', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns context_settings platform instance for the delivery context', () => {
    setContextSettings({
      contextId: 'user-1',
      taskInstanceId: 'kaneo-default',
      platformInstanceId: 'telegram-default',
    })

    expect(resolveDeliveryPlatformInstanceId(dmTarget('user-1'))).toBe('telegram-default')
  })

  test('returns null when the delivery context has no assignment', () => {
    expect(resolveDeliveryPlatformInstanceId(dmTarget('missing-user'))).toBeNull()
  })
})
```

- [ ] **Step 2: Run delivery-routing tests to verify RED**

Run: `bun test ./tests/chat/delivery-routing.test.ts`

Expected: FAIL with `Cannot find module '../../src/chat/delivery-routing.js'`.

- [ ] **Step 3: Implement `src/chat/delivery-routing.ts`**

Create `src/chat/delivery-routing.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getContextSettings } from '../instances/context-store.js'
import { logger } from '../logger.js'
import type { DeferredDeliveryTarget } from './types.js'

const log = logger.child({ scope: 'chat:delivery-routing' })

export function resolveDeliveryPlatformInstanceId(target: DeferredDeliveryTarget): string | null {
  const settings = getContextSettings(target.contextId)
  if (settings === null) {
    log.warn(
      { contextId: target.contextId, contextType: target.contextType },
      'Cannot route proactive chat delivery: context has no platform instance assignment',
    )
    return null
  }
  return settings.platformInstanceId
}
```

- [ ] **Step 4: Run delivery-routing tests to verify GREEN**

Run: `bun test ./tests/chat/delivery-routing.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/chat/delivery-routing.ts tests/chat/delivery-routing.test.ts
git commit -m "feat(chat): resolve proactive delivery platform instances"
```

---

## Task 7: Update Proactive Send Callers

**Files:**

- Modify: `src/deferred-prompts/poller.ts:52-84` and `src/deferred-prompts/poller.ts:120-160`
- Modify: `src/scheduler-recurring.ts:51-66`
- Modify: `src/announcements.ts:38-72`
- Modify: `src/commands/admin.ts:200-220`
- Modify: `tests/deferred-prompts/poller.test.ts`
- Modify: `tests/scheduler.test.ts`
- Modify: `tests/announcements.test.ts` if present, otherwise announcement coverage in `tests/index.test.ts`
- Modify: admin command coverage in `tests/bot.test.ts` or `tests/commands/admin.test.ts`

- [ ] **Step 1: Write failing focused tests for explicit platform sends**

In the scheduler notification test, use a mock chat that records the first argument:

```typescript
const sends: Array<{ platformInstanceId: string; contextId: string; text: string }> = []
const chat = createMockChat({
  sendMessage: (platformInstanceId, target, text) => {
    sends.push({ platformInstanceId, contextId: target.contextId, text })
    return Promise.resolve()
  },
})
setContextSettings({ contextId: 'user-1', taskInstanceId: 'kaneo-default', platformInstanceId: 'telegram-default' })

await notifyUser(chat, 'user-1', createdTask)

expect(sends).toEqual([
  {
    platformInstanceId: 'telegram-default',
    contextId: 'user-1',
    text: 'Recurring task created: **Task title** in project.',
  },
])
```

In the poller scheduled-prompt delivery test, assert the same shape:

```typescript
expect(sentMessages[0]?.platformInstanceId).toBe('telegram-default')
```

In the `/announce` test, set the incoming message source and assert it is used:

```typescript
const msg = { ...createDmMessage('admin-1', '/announce hello'), platformInstanceId: 'mattermost-default' }
expect(sentMessages.every((send) => send.platformInstanceId === 'mattermost-default')).toBe(true)
```

- [ ] **Step 2: Run focused tests to verify RED**

Run: `bun test ./tests/scheduler.test.ts ./tests/deferred-prompts/poller.test.ts ./tests/bot.test.ts -t platformInstanceId`

Expected: FAIL because proactive send callsites still call `sendMessage(target, text)` or do not pass the expected platform instance ID.

- [ ] **Step 3: Update scheduled prompt sends in `src/deferred-prompts/poller.ts`**

Import the helper:

```typescript
import { resolveDeliveryPlatformInstanceId } from '../chat/delivery-routing.js'
```

Add a local delivery helper near `executeScheduledPromptsForGroup()`:

```typescript
async function sendProactiveMessage(
  chat: ChatProvider,
  target: DeferredDeliveryTarget,
  markdown: string,
): Promise<void> {
  const platformInstanceId = resolveDeliveryPlatformInstanceId(target)
  if (platformInstanceId === null) return
  await chat.sendMessage(platformInstanceId, target, markdown)
}
```

Replace all four poller calls:

```typescript
await sendProactiveMessage(chat, execCtx.deliveryTarget, `I ran into an error while working on that: ${errMsg}`)
await sendProactiveMessage(chat, execCtx.deliveryTarget, response)
await sendProactiveMessage(
  chat,
  alert.deliveryTarget,
  `Sorry, something went wrong while preparing this update: ${errMsg}`,
)
await sendProactiveMessage(chat, alert.deliveryTarget, response)
```

- [ ] **Step 4: Update recurring notification sends in `src/scheduler-recurring.ts`**

Import the helper:

```typescript
import { resolveDeliveryPlatformInstanceId } from './chat/delivery-routing.js'
```

Replace `notifyUser()` with:

```typescript
export const notifyUser = async (
  chatProviderRef: ChatProvider | null,
  userId: string,
  created: Task,
): Promise<void> => {
  if (chatProviderRef === null) return

  const target = dmTarget(userId)
  const platformInstanceId = resolveDeliveryPlatformInstanceId(target)
  if (platformInstanceId === null) return

  try {
    await chatProviderRef.sendMessage(
      platformInstanceId,
      target,
      `Recurring task created: **${created.title}** in project.`,
    )
  } catch (notifyError) {
    log.warn(
      { userId, error: notifyError instanceof Error ? notifyError.message : String(notifyError) },
      'Failed to notify user about recurring task',
    )
  }
}
```

- [ ] **Step 5: Update version announcements**

In `src/announcements.ts`, change signatures:

```typescript
async function sendAnnouncementToAdmin(
  platformInstanceId: string,
  adminUserId: string,
  markdown: string,
  chat: ChatProvider,
): Promise<boolean> {
  try {
    await chat.sendMessage(platformInstanceId, dmTarget(adminUserId), markdown)
    log.debug({ version: VERSION, platformInstanceId }, 'Announcement sent to admin')
    return true
  } catch (error) {
    log.warn(
      { version: VERSION, platformInstanceId, error: error instanceof Error ? error.message : String(error) },
      'Failed to send announcement to admin',
    )
    return false
  }
}

export async function announceNewVersion(
  chat: ChatProvider,
  platformInstanceId: string,
  adminUserId: string,
  deps: AnnouncementsDeps = defaultAnnouncementsDeps,
): Promise<void> {
  log.debug({ version: VERSION, platformInstanceId }, 'Checking if version announcement is needed')
  const changelogSection = await loadChangelogSection(deps)
  if (changelogSection === null) return
  const claimed = markVersionAnnounced(VERSION)
  if (!claimed) {
    log.debug({ version: VERSION }, 'Version already announced, skipping')
    return
  }
  log.info({ version: VERSION, platformInstanceId }, 'Sending version announcement to admin')
  const message = `🆕 papai v${VERSION} has been released!\n\n${changelogSection}`
  const success = await sendAnnouncementToAdmin(platformInstanceId, adminUserId, message, chat)
  log.info({ version: VERSION, success }, 'Version announcement complete')
}
```

- [ ] **Step 6: Update `/announce` admin command**

In `src/commands/admin.ts`, replace the send call inside `handleAnnounce()`:

```typescript
await chat.sendMessage(msg.platformInstanceId, dmTarget(user.platform_user_id), message)
```

- [ ] **Step 7: Run focused tests**

Run: `bun test ./tests/scheduler.test.ts ./tests/deferred-prompts/poller.test.ts ./tests/bot.test.ts ./tests/index.test.ts -t platformInstanceId`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/deferred-prompts/poller.ts src/scheduler-recurring.ts src/announcements.ts src/commands/admin.ts tests/scheduler.test.ts tests/deferred-prompts/poller.test.ts tests/bot.test.ts tests/index.test.ts
git commit -m "feat(chat): pass platform instance ids for proactive sends"
```

---

## Task 8: Wire `ChatRouter` Into Startup

**Files:**

- Modify: `src/index.ts:10-126`
- Modify: `tests/index.test.ts:79-220`

- [ ] **Step 1: Write failing startup test for DB-backed router construction**

In `tests/index.test.ts`, update the startup wiring test mocks so `src/chat/router.js` and `listActivePlatformInstances()` are observed:

```typescript
const addedInstances: Array<{ id: string; type: string; config: Record<string, string> }> = []
const routerStartCalls: string[] = []
const routerProvider: ChatProvider = {
  name: 'router',
  threadCapabilities: { supportsThreads: false, canCreateThreads: false, threadScope: 'message' },
  capabilities: new Set(),
  traits: { observedGroupMessages: 'mentions_only' },
  configRequirements: [],
  registerCommand: (): void => undefined,
  onMessage: (): void => undefined,
  sendMessage: (): Promise<void> => Promise.resolve(),
  renderContext: () => ({ method: 'text', content: 'mock' }),
  start: (): Promise<void> => {
    callOrder.push('start')
    routerStartCalls.push('start')
    return Promise.resolve()
  },
  stop: (): Promise<void> => Promise.resolve(),
}

void mock.module('../src/chat/router.js', () => ({
  ChatRouter: class {
    readonly name = routerProvider.name
    readonly threadCapabilities = routerProvider.threadCapabilities
    readonly capabilities = routerProvider.capabilities
    readonly traits = routerProvider.traits
    readonly configRequirements = routerProvider.configRequirements
    registerCommand = routerProvider.registerCommand
    onMessage = routerProvider.onMessage
    sendMessage = routerProvider.sendMessage
    renderContext = routerProvider.renderContext
    start = routerProvider.start
    stop = routerProvider.stop
    addInstance(id: string, type: string, config: Record<string, string>): void {
      addedInstances.push({ id, type, config })
    }
  },
}))

void mock.module('../src/instances/platform-store.js', () => ({
  listActivePlatformInstances: () => [
    {
      id: 'telegram-default',
      type: 'telegram',
      config: { token: 'telegram-token' },
      status: 'active',
      createdAt: '2026-01-01',
    },
  ],
}))
```

After importing `src/index.ts`, assert:

```typescript
expect(addedInstances).toEqual([{ id: 'telegram-default', type: 'telegram', config: { token: 'telegram-token' } }])
expect(callOrder).toEqual(['setupBot', 'start'])
expect(routerStartCalls).toEqual(['start'])
```

- [ ] **Step 2: Run startup test to verify RED**

Run: `bun test ./tests/index.test.ts -t startup`

Expected: FAIL because `src/index.ts` still constructs a single provider with `createChatProvider(process.env['CHAT_PROVIDER'])`.

- [ ] **Step 3: Update startup imports and router construction**

In `src/index.ts`, replace the chat registry import and add router/platform-store imports:

```typescript
import { createChatProviderFromConfig } from './chat/registry.js'
import { ChatRouter } from './chat/router.js'
import { listActivePlatformInstances } from './instances/platform-store.js'
```

Replace:

```typescript
const chatProvider = createChatProvider(process.env['CHAT_PROVIDER']!)
```

with:

```typescript
const chatProvider = new ChatRouter((id, type, config) => createChatProviderFromConfig(id, type, config))
for (const instance of listActivePlatformInstances()) {
  chatProvider.addInstance(instance.id, instance.type, instance.config)
}
```

- [ ] **Step 4: Make staged downloader router-safe**

Replace `createStagedDownloadFn()` with a router-safe version that registers both currently supported fetchers:

```typescript
const createStagedDownloadFn = (): import('./attachments/types.js').StagedFileDownloadFn =>
  createStagedDownloader({
    telegramFetcher: (fileId) => {
      const fetcher = getTelegramFileFetcher()
      return fetcher === undefined ? Promise.resolve(null) : fetcher(fileId)
    },
    mattermostFetcher: (fileId) => {
      const fetcher = getMattermostFileFetcher()
      return fetcher === undefined ? Promise.resolve(null) : fetcher(fileId)
    },
  })
```

Replace:

```typescript
const stagedDownloadFn = createStagedDownloadFn(chatProvider)
const botDeps: BotDeps = stagedDownloadFn === null ? { processMessage } : { processMessage, stagedDownloadFn }
```

with:

```typescript
const stagedDownloadFn = createStagedDownloadFn()
const botDeps: BotDeps = { processMessage, stagedDownloadFn }
```

- [ ] **Step 5: Update version announcement call**

Before `announceNewVersion`, compute the startup announcement platform instance:

```typescript
const activePlatformInstances = listActivePlatformInstances()
const announcementPlatformInstanceId = activePlatformInstances[0]?.id
```

Use `activePlatformInstances` for router construction:

```typescript
for (const instance of activePlatformInstances) {
  chatProvider.addInstance(instance.id, instance.type, instance.config)
}
```

Replace:

```typescript
void announceNewVersion(chatProvider, adminUserId)
```

with:

```typescript
if (announcementPlatformInstanceId !== undefined) {
  void announceNewVersion(chatProvider, announcementPlatformInstanceId, adminUserId)
}
```

- [ ] **Step 6: Run startup tests**

Run: `bun test ./tests/index.test.ts -t startup`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/index.ts tests/index.test.ts
git commit -m "feat(chat): start runtime through ChatRouter"
```

---

## Task 9: Fix Remaining Compile-Time Callers And Run Full Verification

**Files:**

- Modify: any remaining test/source files reported by `bun typecheck` for the new `sendMessage`, `IncomingMessage`, or `IncomingInteraction` contracts.
- Expected high-probability files: `tests/bot.test.ts`, `tests/bot-group-observation.test.ts`, `tests/bot-attachments.test.ts`, `tests/scheduler.test.ts`, `tests/chat/proactive-send.test.ts`, `tests/chat/proactive-send-contract.test.ts`, `tests/chat/interaction-router.test.ts`, `tests/chat/plugin-interaction-handler.test.ts`.

- [ ] **Step 1: Run typecheck and capture remaining contract errors**

Run: `bun typecheck`

Expected: FAIL if any remaining direct literals or mock providers still use the old contract.

- [ ] **Step 2: Apply the exact contract fixes reported by typecheck**

For every `IncomingMessage` literal, add this field:

```typescript
platformInstanceId: 'test-instance',
```

For every `IncomingInteraction` literal, add this field:

```typescript
platformInstanceId: 'test-instance',
```

For every mock `ChatProvider.sendMessage` implementation with the old two-argument signature, change it to this three-argument shape:

```typescript
sendMessage: (_platformInstanceId: string, _target: DeferredDeliveryTarget, _text: string): Promise<void> =>
  Promise.resolve(),
```

For every production `chat.sendMessage(target, markdown)` call that is not already covered by Task 7, choose the source as follows and use the matching code:

```typescript
// In command handlers with an IncomingMessage:
await chat.sendMessage(msg.platformInstanceId, target, markdown)

// In proactive code with only a DeferredDeliveryTarget:
const platformInstanceId = resolveDeliveryPlatformInstanceId(target)
if (platformInstanceId === null) return
await chat.sendMessage(platformInstanceId, target, markdown)
```

- [ ] **Step 3: Run focused chat and proactive suites**

Run: `bun test ./tests/chat/router.test.ts ./tests/chat/delivery-routing.test.ts ./tests/chat/types.test.ts ./tests/chat/incoming-message-shape.test.ts ./tests/scheduler.test.ts ./tests/deferred-prompts/poller.test.ts ./tests/index.test.ts`

Expected: PASS.

- [ ] **Step 4: Run full project verification**

Run: `bun typecheck && bun test && bun lint && bun format:check`

Expected: PASS with no TypeScript errors, test failures, lint errors, or format diffs.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test(chat): update chat router contract coverage"
```

---

## Manual Smoke Check

- [ ] **Step 1: Start the app with one bootstrapped provider**

Run: `bun start:debug`

Expected: logs include `instance bootstrap evaluated`, `chat instance added to router`, and `chat instance started` for the active `platform_instances` row.

- [ ] **Step 2: Send a normal chat message to the configured provider**

Expected: the bot replies normally; logs for message handling include a non-empty `platformInstanceId` matching the DB platform instance ID.

- [ ] **Step 3: Trigger a proactive path in a context with `context_settings.platformInstanceId`**

Use an existing recurring task or deferred prompt test account.

Expected: the proactive send is delivered through the platform instance assigned to that context. If the context has no assignment, logs contain `Cannot route proactive chat delivery: context has no platform instance assignment` and the app does not throw.

---

## Self-Review Checklist

- Spec coverage: Tasks 1, 3, and 4 cover inbound `platformInstanceId`; Task 3 covers lifecycle, command fan-out, replay, start isolation, removal, capabilities, traits, render helper, and resolver delegation; Tasks 6 and 7 cover explicit proactive send routing; Task 8 covers startup integration from active `platform_instances`.
- Placeholder scan: This plan intentionally avoids placeholder language and future-fill instructions. Every code-changing step includes concrete code or a concrete replacement rule.
- Type consistency: The plan consistently uses `platformInstanceId`, `ManagedChatInstanceFactory(id, type, config)`, `sendMessage(platformInstanceId, target, markdown)`, `renderContextForInstance(platformInstanceId, snapshot)`, and `ResolveUserContext.platformInstanceId`.
