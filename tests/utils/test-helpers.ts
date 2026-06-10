// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { mock } from 'bun:test'

import { drizzle } from 'drizzle-orm/bun-sqlite'

import type {
  AuthorizationResult,
  ChatCapability,
  ChatFile,
  ChatProvider,
  ChatProviderConfigRequirement,
  ChatProviderTraits,
  CommandHandler,
  ContextRendered,
  ContextSnapshot,
  DeferredDeliveryTarget,
  EmbedOptions,
  IncomingInteraction,
  IncomingMessage,
  ReplyFn,
  ResolveUserContext,
} from '../../src/chat/types.js'
import { resetDrizzleDbForTesting, setDrizzleDbForTesting } from '../../src/db/drizzle.js'
import { MIGRATIONS } from '../../src/db/index.js'
import * as schema from '../../src/db/schema.js'
import type { AppError } from '../../src/errors.js'
import { getUserMessage, isAppError } from '../../src/errors.js'
import { encryptInstanceConfig } from '../../src/instances/encryption.js'
import type {
  InstanceConfig,
  InstanceStatus,
  PlatformInstanceType,
  TaskInstanceType,
} from '../../src/instances/types.js'
// ============================================================================
// MESSAGE CACHE TEST HELPERS
// ============================================================================
import type { CachedMessage } from '../../src/message-cache/types.js'
import { systemConfigCacheForTesting } from '../../src/system-config.js'

// Test-local message cache — fully isolated from production
const testMessageCache = new Map<string, CachedMessage>()
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000

function messageCacheKey(contextId: string, messageId: string): string {
  return `${contextId}:${messageId}`
}

/**
 * Mock the message cache module with a test-local implementation.
 * Call in describe-level beforeEach (NOT at top level) to avoid mock pollution.
 *
 * @example
 * describe('Feature', () => {
 *   beforeEach(() => {
 *     mockMessageCache()
 *   })
 * })
 */
export function mockMessageCache(): void {
  void mock.module('../../src/message-cache/cache.js', () => ({
    cacheMessage: (message: CachedMessage): void => {
      testMessageCache.set(messageCacheKey(message.contextId, message.messageId), message)
    },
    getCachedMessage: (contextId: string, messageId: string): CachedMessage | undefined => {
      const cached = testMessageCache.get(messageCacheKey(contextId, messageId))
      if (cached === undefined) return undefined
      if (Date.now() - cached.timestamp > ONE_WEEK_MS) {
        testMessageCache.delete(messageCacheKey(contextId, messageId))
        return undefined
      }
      return cached
    },
  }))
}

/**
 * Clear the test message cache between tests.
 */
export function clearMessageCache(): void {
  testMessageCache.clear()
}

/**
 * Check if a message exists in the test message cache.
 */
export function hasCachedMessage(contextId: string, messageId: string): boolean {
  const cached = testMessageCache.get(messageCacheKey(contextId, messageId))
  if (cached === undefined) return false
  if (Date.now() - cached.timestamp > ONE_WEEK_MS) {
    testMessageCache.delete(messageCacheKey(contextId, messageId))
    return false
  }
  return true
}

// ============================================================================
// DATABASE & MIGRATION HELPERS
// ============================================================================

let testDb: ReturnType<typeof drizzle<typeof schema>> | null = null
let testSqlite: Database | null = null

// Cache of pre-migrated in-memory DB images, keyed by the migration set (by
// reference identity). Replaying the ~50 migrations per test costs ~17ms each;
// deserializing a snapshot is ~190x faster (~0.1ms), so we migrate once per
// distinct migration set and clone the resulting image for every later setup.
type MigrationSet = readonly { id: string; up: (db: Database) => void }[]
const migratedSnapshotCache = new Map<MigrationSet, Uint8Array>()

async function buildMigratedSnapshot(migrations: MigrationSet): Promise<Uint8Array> {
  const cached = migratedSnapshotCache.get(migrations)
  if (cached !== undefined) return cached

  const { runMigrations } = await import('../../src/db/migrate.js')
  const template = new Database(':memory:')
  template.run('PRAGMA foreign_keys=ON')
  runMigrations(template, migrations)
  // serialize() copies the schema into a standalone image; deserialize() below
  // copies it back into a fresh private DB, so the cached buffer is never mutated.
  const snapshot = template.serialize()
  template.close()
  migratedSnapshotCache.set(migrations, snapshot)
  return snapshot
}

async function setupMigratedTestDb(migrations: MigrationSet): Promise<ReturnType<typeof drizzle<typeof schema>>> {
  // Clear the in-memory user cache to prevent config/session bleed between tests
  const { userCachesForTesting } = await import('../../src/cache.js')
  userCachesForTesting.clear()
  const { resetPluginRegistryForTesting } = await import('../../src/plugins/registry.js')
  resetPluginRegistryForTesting()

  const snapshot = await buildMigratedSnapshot(migrations)
  testSqlite = Database.deserialize(snapshot)
  // foreign_keys is a per-connection pragma, not part of the serialized image.
  testSqlite.run('PRAGMA foreign_keys=ON')
  testDb = drizzle(testSqlite, { schema })
  setDrizzleDbForTesting(testDb)
  return testDb
}

/**
 * Setup test database with all migrations.
 * Call this in beforeEach or at the start of each test.
 * Returns drizzle db instance.
 */
export function setupTestDb(): Promise<ReturnType<typeof drizzle<typeof schema>>> {
  return setupMigratedTestDb(MIGRATIONS)
}

/**
 * Setup a focused test database for settings auth/session/quota stores.
 * Use this for settings unit suites that do not depend on the full schema.
 */
export function setupSettingsAuthTestDb(): Promise<ReturnType<typeof drizzle<typeof schema>>> {
  return import('../../src/db/migrations/050_settings_auth.js').then(({ migration050SettingsAuth }) =>
    setupMigratedTestDb([migration050SettingsAuth]),
  )
}

/**
 * Get the current test database instance.
 * Throws if setupTestDb hasn't been called.
 */
export function getTestDb(): ReturnType<typeof drizzle<typeof schema>> {
  if (testDb === null) {
    throw new Error('Test database not initialized. Call setupTestDb() first.')
  }
  return testDb
}

/**
 * Inject a custom drizzle instance into the singleton.
 * Use this when tests create their own in-memory DB with custom schema
 * (e.g. without full migrations). For full-migration setup, use setupTestDb().
 */
export function setTestDrizzleDb(db: ReturnType<typeof drizzle<typeof schema>>): void {
  setDrizzleDbForTesting(db)
}

/**
 * Reset the drizzle singleton back to its default (lazy-init) behavior.
 */
export function restoreDrizzle(): void {
  resetDrizzleDbForTesting()
}

/**
 * Clear the in-process system_config cache so tests start from a known state
 * without going through a process restart. Mirrors the cache-reset escape
 * hatch that `setupTestDb()` performs on `userCachesForTesting`.
 */
export function resetSystemConfigCacheForTesting(): void {
  systemConfigCacheForTesting.clear()
}

export interface SeedTestPlatformInstanceInput {
  id: string
  type?: PlatformInstanceType
  config?: InstanceConfig
  status?: InstanceStatus
}

export interface SeedTestTaskInstanceInput {
  id: string
  type?: TaskInstanceType
  config?: InstanceConfig
  status?: InstanceStatus
}

export function seedTestPlatformInstance(input: SeedTestPlatformInstanceInput): void {
  getTestDb()
    .insert(schema.platformInstances)
    .values({
      id: input.id,
      type: input.type ?? 'telegram',
      config: encryptInstanceConfig(input.config ?? {}),
      status: input.status ?? 'active',
    })
    .onConflictDoNothing({ target: schema.platformInstances.id })
    .run()
}

export function seedTestTaskInstance(input: SeedTestTaskInstanceInput): void {
  getTestDb()
    .insert(schema.taskInstances)
    .values({
      id: input.id,
      type: input.type ?? 'kaneo',
      config: encryptInstanceConfig(input.config ?? { baseUrl: 'https://tasks.invalid' }),
      status: input.status ?? 'active',
    })
    .onConflictDoNothing({ target: schema.taskInstances.id })
    .run()
}

export function seedCommonTestPlatformInstances(): void {
  seedTestPlatformInstance({ id: 'legacy-single' })
  seedTestPlatformInstance({ id: 'telegram-default' })
  seedTestPlatformInstance({ id: 'telegram-main' })
  seedTestPlatformInstance({ id: 'telegram-secondary' })
  seedTestPlatformInstance({ id: 'discord-default', type: 'discord' })
  seedTestPlatformInstance({ id: 'discord-main', type: 'discord' })
  seedTestPlatformInstance({ id: 'mattermost-default', type: 'mattermost' })
  seedTestPlatformInstance({ id: 'tg-default' })
  seedTestPlatformInstance({ id: 'mm-default', type: 'mattermost' })
  seedTestPlatformInstance({ id: 'test-instance' })
  seedTestPlatformInstance({ id: 'test-platform' })
}

// Re-export logger mocks from dedicated file (no src/ imports to avoid mock timing issues)
export {
  createLoggerMock,
  createTrackedLoggerMock,
  mockLogger,
  type LogCall,
  type TrackedLoggerMock,
} from './logger-mock.js'

// ============================================================================
// REPLY MOCK FACTORIES
// ============================================================================

export interface MockReplyResult {
  reply: ReplyFn
  textCalls: string[]
  buttonCalls: string[]
  redactCalls: string[]
  fileCalls: ChatFile[]
  embedCalls: EmbedOptions[]
  getReplies: () => string[]
  getRedactions: () => string[]
  getEmbeds: () => EmbedOptions[]
}

/**
 * Create a mock reply function that captures text calls.
 */
export function createMockReply(): MockReplyResult {
  const textCalls: string[] = []
  const buttonCalls: string[] = []
  const redactCalls: string[] = []
  const fileCalls: ChatFile[] = []
  const embedCalls: EmbedOptions[] = []
  const reply: ReplyFn = {
    text: (content: string): Promise<void> => {
      textCalls.push(content)
      return Promise.resolve()
    },
    formatted: (content: string): Promise<void> => {
      textCalls.push(content)
      return Promise.resolve()
    },
    file: (file: ChatFile): Promise<void> => {
      fileCalls.push(file)
      return Promise.resolve()
    },
    typing: (): void => {},
    redactMessage: (replacementText: string): Promise<void> => {
      redactCalls.push(replacementText)
      return Promise.resolve()
    },
    buttons: (content: string): Promise<void> => {
      buttonCalls.push(content)
      return Promise.resolve()
    },
    embed: (options: EmbedOptions): Promise<void> => {
      embedCalls.push(options)
      return Promise.resolve()
    },
  }
  return {
    reply,
    textCalls,
    buttonCalls,
    redactCalls,
    fileCalls,
    embedCalls,
    getReplies: () => textCalls,
    getRedactions: () => redactCalls,
    getEmbeds: () => embedCalls,
  }
}

/**
 * Create a mock reply with getter function (legacy compatibility).
 */
export function createMockReplyLegacy(): {
  reply: ReplyFn
  getReplies: () => string[]
  getRedactions: () => string[]
} {
  const { reply, getReplies, getRedactions } = createMockReply()
  return { reply, getReplies, getRedactions }
}

// ============================================================================
// MESSAGE FACTORIES
// ============================================================================

/**
 * Create a DM message for testing commands.
 */
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
    platformInstanceId: 'test-instance',
    commandMatch,
  }
}

/**
 * Create a group message for testing commands.
 */
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
    platformInstanceId: 'test-instance',
    commandMatch: text.replace(/^\//u, ''),
  }
}

// ============================================================================
// AUTHORIZATION HELPERS
// ============================================================================

/**
 * Create an authorization result for testing.
 */
type CreateAuthOptions = Partial<
  Readonly<{
    allowed: boolean
    isBotAdmin: boolean
    isGroupAdmin: boolean
    reason: AuthorizationResult['reason']
  }>
>

type CreateMockChatOptions = Partial<
  Readonly<{
    commandHandlers: Map<string, CommandHandler>
    sendMessage: (
      platformInstanceId: string,
      target: DeferredDeliveryTarget,
      text: string,
    ) => ReturnType<ChatProvider['sendMessage']>
    onMessageHandler: (handler: (msg: IncomingMessage, reply: ReplyFn) => Promise<void>) => void
    resolveUserId: (username: string, context: ResolveUserContext) => Promise<string | null>
    resolveUserLabel: (userId: string, context: ResolveUserContext | undefined) => Promise<string | null>
    resolveGroupLabel: (groupId: string) => Promise<string | null>
    onInteractionHandler: (handler: (interaction: IncomingInteraction, reply: ReplyFn) => Promise<void>) => void
    setCommands: (adminUserId: string) => Promise<void>
    capabilities: Set<ChatCapability>
    traits: ChatProviderTraits
    configRequirements: ChatProviderConfigRequirement[]
  }>
>

const EMPTY_CREATE_AUTH_OPTIONS: CreateAuthOptions = {}
const EMPTY_CREATE_MOCK_CHAT_OPTIONS: CreateMockChatOptions = {}
const DEFAULT_MOCK_CHAT_TRAITS: ChatProviderTraits = { observedGroupMessages: 'all' }
const DEFAULT_SEND_MESSAGE: (
  platformInstanceId: string,
  target: DeferredDeliveryTarget,
  text: string,
) => ReturnType<ChatProvider['sendMessage']> = (_platformInstanceId, _target, _text) => Promise.resolve()
const DEFAULT_SET_COMMANDS: (adminUserId: string) => Promise<void> = (_adminUserId) => Promise.resolve()
const DEFAULT_RESOLVE_USER_ID = (username: string, _context: ResolveUserContext): Promise<string | null> => {
  const clean = username.startsWith('@') ? username.slice(1) : username
  return Promise.resolve(clean)
}
const DEFAULT_RESOLVE_USER_LABEL = (
  _userId: string,
  _context: ResolveUserContext | undefined,
): Promise<string | null> => Promise.resolve(null)
const DEFAULT_RESOLVE_GROUP_LABEL = (_groupId: string): Promise<string | null> => Promise.resolve(null)

function hasAppError(error: Error): error is Error & { appError: AppError } {
  const appError: unknown = Reflect.get(error, 'appError')
  return isAppError(appError)
}

export function createAuth(
  ...args: [userId: string] | [userId: string, options: CreateAuthOptions]
): AuthorizationResult {
  const userId = args[0]
  let options: CreateAuthOptions = EMPTY_CREATE_AUTH_OPTIONS
  if (args.length >= 2 && args[1] !== undefined) {
    options = args[1]
  }

  let allowed = true
  if (options.allowed !== undefined) {
    allowed = options.allowed
  }

  let isBotAdmin = false
  if (options.isBotAdmin !== undefined) {
    isBotAdmin = options.isBotAdmin
  }

  let isGroupAdmin = false
  if (options.isGroupAdmin !== undefined) {
    isGroupAdmin = options.isGroupAdmin
  }

  const reason = options.reason

  return {
    allowed,
    isBotAdmin,
    isGroupAdmin,
    storageContextId: userId,
    ...(reason === undefined ? {} : { reason }),
  }
}

// ============================================================================
// CHAT PROVIDER MOCK
// ============================================================================

/** Default capability set for mock chat providers. */
export const DEFAULT_CHAT_CAPABILITIES = new Set<ChatCapability>([
  'commands.menu',
  'interactions.callbacks',
  'messages.buttons',
  'messages.files',
  'messages.redact',
  'files.receive',
  'messages.reply-context',
  'users.resolve',
])

/**
 * Telegram-like capabilities (no users.resolve).
 * Use when testing Telegram-specific behavior that should reject @username resolution.
 */
export const TELEGRAM_LIKE_CAPABILITIES = new Set<ChatCapability>([
  'commands.menu',
  'interactions.callbacks',
  'messages.buttons',
  'messages.files',
  'messages.redact',
  'files.receive',
  'messages.reply-context',
])

/**
 * Create a mock chat provider with configurable behavior.
 * @param options - Optional configuration for the mock provider
 * @returns The mock ChatProvider and any captured state
 */
export function createMockChat(...args: [] | [options: CreateMockChatOptions]): ChatProvider {
  let options: CreateMockChatOptions = EMPTY_CREATE_MOCK_CHAT_OPTIONS
  if (args.length > 0 && args[0] !== undefined) {
    options = args[0]
  }

  let capabilities = DEFAULT_CHAT_CAPABILITIES
  if (options.capabilities !== undefined) {
    capabilities = options.capabilities
  }

  let traits: ChatProviderTraits = DEFAULT_MOCK_CHAT_TRAITS
  if (options.traits !== undefined) {
    traits = options.traits
  }

  let configRequirements: ChatProviderConfigRequirement[] = []
  if (options.configRequirements !== undefined) {
    configRequirements = options.configRequirements
  }

  const commandHandlers = options.commandHandlers
  const onMessageHandler = options.onMessageHandler
  const onInteractionHandler = options.onInteractionHandler
  const sendMessage = options.sendMessage
  const resolveUserId = options.resolveUserId
  const resolveUserLabel = options.resolveUserLabel
  const resolveGroupLabel = options.resolveGroupLabel
  const setCommands = options.setCommands

  let sendMessageImpl: (
    platformInstanceId: string,
    target: DeferredDeliveryTarget,
    text: string,
  ) => ReturnType<ChatProvider['sendMessage']> = DEFAULT_SEND_MESSAGE
  if (sendMessage !== undefined) {
    sendMessageImpl = sendMessage
  }

  let resolveUserIdImpl = DEFAULT_RESOLVE_USER_ID
  if (resolveUserId !== undefined) {
    resolveUserIdImpl = resolveUserId
  }

  let resolveUserLabelImpl = DEFAULT_RESOLVE_USER_LABEL
  if (resolveUserLabel !== undefined) {
    resolveUserLabelImpl = resolveUserLabel
  }

  let resolveGroupLabelImpl = DEFAULT_RESOLVE_GROUP_LABEL
  if (resolveGroupLabel !== undefined) {
    resolveGroupLabelImpl = resolveGroupLabel
  }

  let setCommandsImpl: (adminUserId: string) => Promise<void> = DEFAULT_SET_COMMANDS
  if (setCommands !== undefined) {
    setCommandsImpl = setCommands
  }

  return {
    name: 'mock',
    threadCapabilities: {
      supportsThreads: true,
      canCreateThreads: false,
      threadScope: 'message',
    },
    capabilities,
    traits,
    configRequirements,
    registerCommand: (name: string, handler: CommandHandler): void => {
      if (commandHandlers !== undefined) {
        commandHandlers.set(name, handler)
      }
    },
    onMessage: (handler): void => {
      if (onMessageHandler !== undefined) {
        onMessageHandler(handler)
      }
    },
    ...(onInteractionHandler === undefined
      ? {}
      : (() => {
          return {
            onInteraction: (handler: (interaction: IncomingInteraction, reply: ReplyFn) => Promise<void>): void => {
              onInteractionHandler(handler)
            },
          }
        })()),
    sendMessage: sendMessageImpl,
    resolveUserId: resolveUserIdImpl,
    resolveUserLabel: resolveUserLabelImpl,
    resolveGroupLabel: resolveGroupLabelImpl,
    setCommands: setCommandsImpl,
    renderContext: (snapshot: ContextSnapshot): ContextRendered => ({
      method: 'text',
      content: `mock renderContext: ${snapshot.modelName} total=${String(snapshot.totalTokens)}`,
    }),
    start: (): Promise<void> => Promise.resolve(),
    stop: (): Promise<void> => Promise.resolve(),
  }
}

/**
 * Create a mock chat provider that captures command registrations.
 */
export function createMockChatWithCommandHandlers(...args: [] | [options: CreateMockChatOptions]): {
  provider: ChatProvider
  commandHandlers: Map<string, CommandHandler>
} {
  let options: CreateMockChatOptions = EMPTY_CREATE_MOCK_CHAT_OPTIONS
  if (args.length > 0 && args[0] !== undefined) {
    options = args[0]
  }
  const commandHandlers = new Map<string, CommandHandler>()
  const provider = createMockChat({ ...options, commandHandlers })
  return { provider, commandHandlers }
}

/**
 * Create a mock chat provider with custom sendMessage behavior and command handler capture.
 * The callback receives contextId (string) for backward compatibility with callers that
 * pre-date the DeferredDeliveryTarget interface.
 */
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

/**
 * Create a mock chat provider for bot tests that captures the message handler.
 * Returns both the provider and a function to get the captured message handler.
 */
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

/**
 * Create a mock chat provider that tracks sent messages.
 * Returns the provider and a getter for sent messages.
 */
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

// ============================================================================
// ERROR ASSERTIONS
// ============================================================================

// ============================================================================
// STATE COLLECTOR HELPERS
// ============================================================================

import { stats, pendingTraces, recentLlm } from '../../src/debug/state-collector.js'

/**
 * Reset debug stats and traces for testing.
 */
export function resetStats(): void {
  stats.startedAt = Date.now()
  stats.totalMessages = 0
  stats.totalLlmCalls = 0
  stats.totalToolCalls = 0
  pendingTraces.clear()
  recentLlm.length = 0
}

// ============================================================================
// ERROR ASSERTIONS
// ============================================================================

/**
 * Test helper to assert that an error is an AppError with expected user message.
 */
export function expectAppError(error: unknown, expectedMessage: string | RegExp): void {
  if (!(error instanceof Error)) {
    throw new Error(`Expected Error, got ${String(error)}`)
  }

  // Check if it's a classified error with appError property
  if (!hasAppError(error)) {
    throw new Error(`Error missing appError property: ${error.message}`)
  }

  const userMessage = getUserMessage(error.appError)

  if (typeof expectedMessage === 'string') {
    if (userMessage !== expectedMessage) {
      throw new Error(`Expected user message "${expectedMessage}", got "${userMessage}"`)
    }
  } else if (!expectedMessage.test(userMessage)) {
    throw new Error(`Expected user message to match ${expectedMessage.toString()}, got "${userMessage}"`)
  }
}

// ============================================================================
// TOOL TESTING HELPERS
// ============================================================================

interface SafeParseable {
  safeParse: (data: unknown) => { success: boolean }
}

function isSafeParseable(val: unknown): val is SafeParseable {
  return typeof val === 'object' && val !== null && 'safeParse' in val && typeof val.safeParse === 'function'
}

/** Test whether a tool's inputSchema accepts or rejects given data. */
export function schemaValidates(tool: { inputSchema: unknown }, data: unknown): boolean {
  const inputSchema = tool.inputSchema
  if (!isSafeParseable(inputSchema)) {
    throw new Error('Tool inputSchema does not have safeParse')
  }
  return inputSchema.safeParse(data).success
}

export interface ToolExecutor {
  execute: (...args: unknown[]) => Promise<unknown>
}

export function hasExecute(tool: unknown): tool is ToolExecutor {
  return (
    typeof tool === 'object' &&
    tool !== null &&
    'execute' in tool &&
    typeof (tool as Record<string, unknown>)['execute'] === 'function'
  )
}

export function getToolExecutor(tool: unknown): (...args: unknown[]) => Promise<unknown> {
  if (hasExecute(tool)) {
    return tool.execute
  }
  throw new Error('Tool does not have an execute method')
}

// ============================================================================
// MOCK DATA FACTORIES
// ============================================================================

import type { z } from 'zod'

import type { CreateLabelResponseSchema } from '../../plugins/task-provider-kaneo/schemas/create-label.js'
import { TaskSchema } from '../../plugins/task-provider-kaneo/schemas/create-task.js'
import { ActivityItemSchema } from '../../plugins/task-provider-kaneo/schemas/global-search.js'

type CreateTaskResponse = z.infer<typeof TaskSchema>
type CreateProjectResponse = {
  id: string
  workspaceId: string
  slug: string
  icon: string | null
  name: string
  description: string | null
  createdAt: unknown
  isPublic: boolean | null
}
type CreateLabelResponse = z.infer<typeof CreateLabelResponseSchema>
type ActivityItem = z.infer<typeof ActivityItemSchema>

type Column = {
  id: string
  name: string
  icon: string | null
  color: string | null
  isFinal: boolean
}

// Complete task mock matching CreateTaskResponseSchema
export function createMockTask(...args: [] | [overrides: Partial<CreateTaskResponse>]): CreateTaskResponse {
  const overrides = args.length === 0 ? {} : args[0]
  return {
    id: 'task-1',
    projectId: 'proj-1',
    position: 0,
    number: 42,
    userId: null,
    title: 'Test Task',
    description: 'Test description',
    status: 'todo',
    priority: 'medium',
    createdAt: '2026-03-01T00:00:00Z',
    dueDate: null,
    ...overrides,
  }
}

// Complete project mock matching CreateProjectResponseSchema
export function createMockProject(...args: [] | [overrides: Partial<CreateProjectResponse>]): CreateProjectResponse {
  const overrides = args.length === 0 ? {} : args[0]
  return {
    id: 'proj-1',
    workspaceId: 'ws-1',
    name: 'Test Project',
    slug: 'test-project',
    icon: null,
    description: null,
    createdAt: '2026-03-01T00:00:00Z',
    isPublic: false,
    ...overrides,
  }
}

// Complete label mock matching CreateLabelResponseSchema
export function createMockLabel(...args: [] | [overrides: Partial<CreateLabelResponse>]): CreateLabelResponse {
  const overrides = args.length === 0 ? {} : args[0]
  return {
    id: 'label-1',
    name: 'Bug',
    color: '#ff0000',
    createdAt: '2026-03-01T00:00:00Z',
    taskId: null,
    workspaceId: 'ws-1',
    ...overrides,
  }
}

// Complete activity mock matching CreateCommentResponseSchema (for add/update)
// or ActivityItemSchema (for list) - both have same structure
export function createMockActivity(...args: [] | [overrides: Partial<ActivityItem>]): ActivityItem {
  const overrides = args.length === 0 ? {} : args[0]
  return {
    id: 'act-1',
    taskId: 'task-1',
    type: 'comment',
    createdAt: '2026-03-01T00:00:00Z',
    userId: null,
    content: 'Test comment',
    externalUserName: null,
    externalUserAvatar: null,
    externalSource: null,
    externalUrl: null,
    ...overrides,
  }
}

// Complete column mock matching ColumnSchema
export function createMockColumn(...args: [] | [overrides: Partial<Column>]): Column {
  const overrides = args.length === 0 ? {} : args[0]
  return {
    id: 'col-1',
    name: 'To Do',
    icon: null,
    color: null,
    isFinal: false,
    ...overrides,
  }
}

// ============================================================================
// FETCH MOCK HELPERS
// ============================================================================

const originalFetch = globalThis.fetch

export function restoreFetch(): void {
  globalThis.fetch = originalFetch
}

/**
 * Replace globalThis.fetch with a mock handler for testing.
 * Wraps `mock()` internally so callers don't need `as unknown as` casts.
 */
export function setMockFetch(handler: (url: string, init: RequestInit) => Promise<Response>): void {
  const mocked = mock(handler)
  const mockedFetch = Object.assign(
    (...args: Parameters<typeof fetch>): ReturnType<typeof fetch> => {
      const [input, init] = args
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      let requestInit: RequestInit = {}
      if (init !== undefined) {
        requestInit = init
      }
      return mocked(url, requestInit)
    },
    { preconnect: originalFetch.preconnect },
  ) satisfies typeof fetch
  globalThis.fetch = mockedFetch
}

// ============================================================================
// MODULE MOCK RESTORATION HELPERS
// ============================================================================

const originalModules = new Map<string, Record<string, unknown>>()

export function storeOriginalModule(path: string, original: Record<string, unknown>): void {
  if (!originalModules.has(path)) {
    originalModules.set(path, original)
  }
}

export function restoreModule(path: string): void {
  const original = originalModules.get(path)
  if (original !== undefined) {
    void mock.module(path, () => original)
    originalModules.delete(path)
  }
}

export function restoreAllModules(): void {
  for (const [path, original] of originalModules) {
    void mock.module(path, () => original)
  }
  originalModules.clear()
}

export async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => {
    queueMicrotask(() => {
      resolve()
    })
  })
  await new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve()
    }, 0)
  })
}
