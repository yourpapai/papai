// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test, beforeEach, mock } from 'bun:test'
import assert from 'node:assert/strict'

import { and, eq } from 'drizzle-orm'

import { KeyVersionSchema, PseudonymSchema, VersionStringSchema } from '../src/analytics/controlled-types.js'
import type { EligibilityDecision } from '../src/analytics/governance/eligibility.js'
import type { NormalizerEnv } from '../src/analytics/normalizer.js'
import type { RephraseBoundaryDeps } from '../src/analytics/rephrase/handoff.js'
import { createAnalyticsObserver } from '../src/analytics/runtime.js'
import type { AnalyticsObserver } from '../src/analytics/runtime.js'
import { createRecordingHealth, createRecordingSinks } from '../src/analytics/runtime.testing.js'
import type { AnalyticsSourceFact } from '../src/analytics/source-facts.js'
import { createTurnContextRegistry } from '../src/analytics/turn-context.js'
import { listActiveAttachments } from '../src/attachments/index.js'
import {
  checkAuthorizationExtended as checkAuthorizationExtendedScoped,
  getThreadScopedStorageContextId,
} from '../src/auth.js'
import { addAuthorizedGroup, setGuestMode } from '../src/authorized-groups.js'
import { setupBot, withRephraseCapture, type BotDeps } from '../src/bot.js'
import { clearGroupAdminLiveCache } from '../src/chat/group-admin-live.testing.js'
import type {
  AuthorizationResult,
  ChatProvider,
  CommandHandler,
  ContextRendered,
  ContextSnapshot,
  DeferredDeliveryTarget,
  IncomingFile,
  IncomingInteraction,
  IncomingMessage,
  ReplyFn,
  ResolveUserContext,
} from '../src/chat/types.js'
import { setConfigValue } from '../src/config.js'
import { setConfig } from '../src/config.testing.js'
import { getDrizzleDb } from '../src/db/drizzle.js'
import { groupAdminObservations, groupUserObservations, knownGroupContexts } from '../src/db/schema.js'
import { subscribe, unsubscribe, type DebugEvent } from '../src/debug/event-bus.js'
import { listManageableGroups } from '../src/group-settings/access.js'
import { upsertGroupAdminObservation, upsertKnownGroupContext } from '../src/group-settings/registry.js'
import { addGroupMember } from '../src/groups.js'
import { addAdmin } from '../src/instances/admin-store.js'
import { getContextSettings, setContextSettings } from '../src/instances/context-store.js'
import { setOpenDmAccess } from '../src/instances/platform-store.js'
import { getTaskInstance, insertTaskInstance } from '../src/instances/task-store.js'
import type { CoalescedItem } from '../src/message-queue/index.js'
import { contributionRegistry } from '../src/plugins/contributions.js'
import { PLUGIN_API_VERSION, type PluginManifest } from '../src/plugins/types.js'
import { runRegistry } from '../src/run-control/registry.js'
import { KANEO_PLUGIN_CREDENTIAL_KEY } from '../src/types/config.js'
import {
  addUser as addScopedUser,
  blockUser,
  isAuthorized as isAuthorizedScoped,
  removeUser as removeScopedUser,
} from '../src/users.js'
import {
  createAuth,
  createDmMessage,
  createGroupMessage,
  DEFAULT_CHAT_CAPABILITIES,
  createMockChat,
  createMockChatForBot,
  createMockChatWithCommandHandlers,
  createMockReply,
  mockLogger,
  seedCommonTestPlatformInstances,
  seedTestPlatformInstance,
  setupTestDb,
  waitFor,
} from './utils/test-helpers.js'

const TEST_PLATFORM_ID = 'test-instance'
const getTestPlatformArg = (args: [] | [platformInstanceId: string]): string => {
  if (args.length === 0) return TEST_PLATFORM_ID
  return args[0]
}

const scopedDm = (contextId: string, ...args: [] | [platformInstanceId: string]): string => {
  const platformInstanceId = getTestPlatformArg(args)
  return getThreadScopedStorageContextId(contextId, 'dm', undefined, platformInstanceId)
}
const scopedGroup = (contextId: string, ...args: [] | [platformInstanceId: string]): string => {
  const platformInstanceId = getTestPlatformArg(args)
  return getThreadScopedStorageContextId(contextId, 'group', undefined, platformInstanceId)
}
const scopedGroupThread = (contextId: string, threadId: string, ...args: [] | [platformInstanceId: string]): string => {
  const platformInstanceId = getTestPlatformArg(args)
  return getThreadScopedStorageContextId(contextId, 'group', threadId, platformInstanceId)
}

const addAuthorizedGroupForPlatform = (
  nativeContextId: string,
  addedBy: string,
  ...args: [] | [platformInstanceId: string]
): void => {
  const platformInstanceId = getTestPlatformArg(args)
  addAuthorizedGroup(scopedGroup(nativeContextId, platformInstanceId), addedBy)
}

const addGroupMemberForPlatform = (
  nativeContextId: string,
  userId: string,
  addedBy: string,
  ...args: [] | [platformInstanceId: string]
): void => {
  const platformInstanceId = getTestPlatformArg(args)
  addGroupMember(scopedGroup(nativeContextId, platformInstanceId), userId, addedBy)
}

const addUser = (userId: string, addedBy: string, ...args: [] | [username: string]): void => {
  const username = args[0]
  if (username === undefined) {
    addScopedUser({ userId, platformInstanceId: TEST_PLATFORM_ID, addedBy })
  } else {
    addScopedUser({ userId, platformInstanceId: TEST_PLATFORM_ID, addedBy, username })
  }
}

const isAuthorized = (userId: string): boolean => isAuthorizedScoped(userId, TEST_PLATFORM_ID)

const removeUser = (identifier: string): boolean => removeScopedUser(identifier, TEST_PLATFORM_ID)

const checkAuthorizationExtended = (
  userId: string,
  username: string | null,
  contextId: string,
  contextType: 'dm' | 'group',
  threadId: string | undefined,
  isPlatformAdmin: boolean,
): AuthorizationResult =>
  checkAuthorizationExtendedScoped(
    userId,
    username,
    contextId,
    contextType,
    threadId,
    isPlatformAdmin,
    TEST_PLATFORM_ID,
  )

type EnqueueItem = Parameters<NonNullable<BotDeps['enqueueMessage']>>[0]

const buildSyncCoalescedItem = (item: EnqueueItem, reply: ReplyFn, turnId: string): CoalescedItem => ({
  text: item.text,
  userId: item.userId,
  username: item.username,
  storageContextId: item.storageContextId,
  configContextId: item.configContextId,
  contextType: item.contextType,
  newAttachmentIds: item.newAttachmentIds,
  voiceStagedIds: item.voiceStagedIds,
  reply,
  turnId,
  messageIds: item.messageId === undefined ? [] : [item.messageId],
  segments:
    item.messageId === undefined ? [] : [{ messageId: item.messageId, text: item.text, username: item.username }],
  analyticsTurnSeed: item.analyticsTurnSeed,
})

const enqueueMessageSynchronously: NonNullable<BotDeps['enqueueMessage']> = (item, reply, handler): void => {
  void handler(buildSyncCoalescedItem(item, reply, 'test-turn-id')).catch(() => {})
}

const withSynchronousQueue = (deps: Readonly<Omit<BotDeps, 'enqueueMessage'>>): BotDeps => ({
  ...deps,
  enqueueMessage: enqueueMessageSynchronously,
})

// ---------------------------------------------------------------------------
// Listener helpers defined outside test blocks to avoid no-conditional-in-test
// ---------------------------------------------------------------------------

function makeRepliedEventListener(repliedEvents: DebugEvent[], scopeUserId?: string): (event: DebugEvent) => void {
  return (event: DebugEvent): void => {
    if (event.type === 'message:replied') {
      if (scopeUserId === undefined || (event.scope.kind === 'user' && event.scope.userId === scopeUserId)) {
        repliedEvents.push(event)
      }
    }
  }
}

function incrementRegistrationCount(current: number | undefined): number {
  return current === undefined ? 1 : current + 1
}

// ---------------------------------------------------------------------------

describe('Authorization Logic', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()
  })

  describe('Bot Admin Authorization', () => {
    test('Bot admin in DM → allowed with isBotAdmin, storageContextId=scoped userId', () => {
      addUser('admin-1', 'system', 'admin')
      addAdmin('admin-1', TEST_PLATFORM_ID)

      const result = checkAuthorizationExtended('admin-1', 'admin', 'admin-1', 'dm', undefined, false)
      expect(result).toEqual({
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: scopedDm('admin-1'),
        configContextId: scopedDm('admin-1'),
      })
    })

    test('Bot admin in group → allowed with isBotAdmin, storageContextId=scoped groupId', () => {
      addUser('admin-1', 'system', 'admin')
      addAdmin('admin-1', TEST_PLATFORM_ID)
      addAuthorizedGroupForPlatform('group-1', 'system')

      const result = checkAuthorizationExtended('admin-1', 'admin', 'group-1', 'group', undefined, false)
      expect(result).toEqual({
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: scopedGroup('group-1'),
        configContextId: scopedGroup('group-1'),
      })
    })

    test('Bot admin who is also platform admin → isGroupAdmin=true', () => {
      addUser('admin-1', 'system', 'admin')
      addAdmin('admin-1', TEST_PLATFORM_ID)
      addAuthorizedGroupForPlatform('group-1', 'system')

      const result = checkAuthorizationExtended('admin-1', 'admin', 'group-1', 'group', undefined, true)
      expect(result).toEqual({
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: true,
        storageContextId: scopedGroup('group-1'),
        configContextId: scopedGroup('group-1'),
      })
    })
  })

  describe('Group Member Authorization', () => {
    test('Group member → allowed, not bot admin, storageContextId=scoped groupId', () => {
      addAuthorizedGroupForPlatform('group-1', 'system')
      addGroupMemberForPlatform('group-1', 'member-1', 'system')

      const result = checkAuthorizationExtended('member-1', null, 'group-1', 'group', undefined, false)
      expect(result).toEqual({
        allowed: true,
        isBotAdmin: false,
        isGroupAdmin: false,
        storageContextId: scopedGroup('group-1'),
        configContextId: scopedGroup('group-1'),
      })
    })

    test('Group member who is platform admin → isGroupAdmin=true', () => {
      addAuthorizedGroupForPlatform('group-1', 'system')
      addGroupMemberForPlatform('group-1', 'member-1', 'system')

      const result = checkAuthorizationExtended('member-1', null, 'group-1', 'group', undefined, true)
      expect(result).toEqual({
        allowed: true,
        isBotAdmin: false,
        isGroupAdmin: true,
        storageContextId: scopedGroup('group-1'),
        configContextId: scopedGroup('group-1'),
      })
    })

    test('Non-member in non-allowlisted group → not allowed with group_not_allowed reason', () => {
      const result = checkAuthorizationExtended('stranger-1', null, 'group-1', 'group', undefined, false)
      expect(result).toEqual({
        allowed: false,
        isBotAdmin: false,
        isGroupAdmin: false,
        storageContextId: scopedGroup('group-1'),
        configContextId: scopedGroup('group-1'),
        reason: 'group_not_allowed',
      })
    })

    test('Non-member in allowlisted group → not allowed with group_member_not_allowed reason', () => {
      addAuthorizedGroupForPlatform('group-1', 'system')

      const result = checkAuthorizationExtended('stranger-1', null, 'group-1', 'group', undefined, false)
      expect(result).toEqual({
        allowed: false,
        isBotAdmin: false,
        isGroupAdmin: false,
        storageContextId: scopedGroup('group-1'),
        configContextId: scopedGroup('group-1'),
        reason: 'group_member_not_allowed',
      })
    })

    test('Platform admin in allowlisted group is allowed without group membership', () => {
      addAuthorizedGroupForPlatform('group-1', 'system')

      const result = checkAuthorizationExtended('platform-admin', null, 'group-1', 'group', undefined, true)
      expect(result).toEqual({
        allowed: true,
        isBotAdmin: false,
        isGroupAdmin: true,
        storageContextId: scopedGroup('group-1'),
        configContextId: scopedGroup('group-1'),
      })
    })
  })

  describe('DM User Resolution by Username', () => {
    test('DM user resolved by username → allowed, storageContextId=scoped userId', () => {
      addUser('placeholder-id', 'system', 'alice')

      const result = checkAuthorizationExtended('real-alice-id', 'alice', 'real-alice-id', 'dm', undefined, false)
      expect(result).toEqual({
        allowed: true,
        isBotAdmin: false,
        isGroupAdmin: false,
        storageContextId: scopedDm('real-alice-id'),
        configContextId: scopedDm('real-alice-id'),
      })
    })

    test('DM user with unmatched username → not allowed', () => {
      const result = checkAuthorizationExtended('unknown-id', 'bob', 'unknown-id', 'dm', undefined, false)
      expect(result).toEqual({
        allowed: false,
        isBotAdmin: false,
        isGroupAdmin: false,
        storageContextId: scopedDm('unknown-id'),
        configContextId: scopedDm('unknown-id'),
        reason: 'dm_not_allowed',
      })
    })
  })

  describe('Priority: Bot Admin Wins Over Group Check', () => {
    test('User who is BOTH bot admin AND group member → returns bot admin result (isBotAdmin=true)', () => {
      addUser('admin-1', 'system', 'admin')
      addAdmin('admin-1', TEST_PLATFORM_ID)
      addAuthorizedGroupForPlatform('group-1', 'system')
      addGroupMemberForPlatform('group-1', 'admin-1', 'system')

      const result = checkAuthorizationExtended('admin-1', 'admin', 'group-1', 'group', undefined, false)
      expect(result).toEqual({
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: scopedGroup('group-1'),
        configContextId: scopedGroup('group-1'),
      })
    })
  })
})

describe('Open DM Access Auto-Provision', () => {
  const OPEN_USER_ID = 'demo-user-1'
  const OPEN_USERNAME = 'demouser'

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()
  })

  test('open access on: unknown DM user is auto-added with non-admin auth', () => {
    setOpenDmAccess(TEST_PLATFORM_ID, true)
    const result = checkAuthorizationExtended(OPEN_USER_ID, OPEN_USERNAME, OPEN_USER_ID, 'dm', undefined, false)
    expect(result).toEqual({
      allowed: true,
      isBotAdmin: false,
      isGroupAdmin: false,
      storageContextId: scopedDm(OPEN_USER_ID),
      configContextId: scopedDm(OPEN_USER_ID),
    })
    expect(isAuthorized(OPEN_USER_ID)).toBe(true)
  })

  test('open access on: open-access user stays non-admin on subsequent messages', () => {
    setOpenDmAccess(TEST_PLATFORM_ID, true)
    // First message — auto-add
    checkAuthorizationExtended(OPEN_USER_ID, OPEN_USERNAME, OPEN_USER_ID, 'dm', undefined, false)
    // Second message — user already authorized
    const result = checkAuthorizationExtended(OPEN_USER_ID, OPEN_USERNAME, OPEN_USER_ID, 'dm', undefined, false)
    expect(result).toEqual({
      allowed: true,
      isBotAdmin: false,
      isGroupAdmin: false,
      storageContextId: scopedDm(OPEN_USER_ID),
      configContextId: scopedDm(OPEN_USER_ID),
    })
  })

  test('open access on: unknown DM user without username is auto-added', () => {
    setOpenDmAccess(TEST_PLATFORM_ID, true)
    const result = checkAuthorizationExtended(OPEN_USER_ID, null, OPEN_USER_ID, 'dm', undefined, false)
    expect(result.allowed).toBe(true)
    expect(result.isBotAdmin).toBe(false)
    expect(isAuthorized(OPEN_USER_ID)).toBe(true)
  })

  test('open access on: manually-added non-admin user stays non-admin', () => {
    setOpenDmAccess(TEST_PLATFORM_ID, true)
    addUser('manual-user', 'admin', 'manualuser')
    const result = checkAuthorizationExtended('manual-user', 'manualuser', 'manual-user', 'dm', undefined, false)
    expect(result.isBotAdmin).toBe(false)
  })

  test('open access on: group messages from unknown users are NOT auto-added', () => {
    setOpenDmAccess(TEST_PLATFORM_ID, true)
    const result = checkAuthorizationExtended('stranger-1', null, 'group-1', 'group', undefined, false)
    expect(result.allowed).toBe(false)
  })

  test('open access off: unknown DM user is NOT auto-added', () => {
    const result = checkAuthorizationExtended('stranger-1', 'stranger', 'stranger-1', 'dm', undefined, false)
    expect(result.allowed).toBe(false)
  })
})

// Setup user config to bypass wizard auto-start. Phase 1 removes per-user
// LLM keys, so only the task-provider key and timezone need to be present.
function setupContextTaskAssignment(contextId: string, ...args: [] | [platformInstanceId: string]): void {
  let platformInstanceId = 'telegram-default'
  if (args.length === 1) platformInstanceId = args[0]
  for (const assignedContextId of new Set([contextId, scopedDm(contextId), scopedGroup(contextId)])) {
    const taskInstanceId = `${assignedContextId}-kaneo-test`
    if (getTaskInstance(taskInstanceId) === null) {
      insertTaskInstance({
        id: taskInstanceId,
        type: 'kaneo',
        config: { baseUrl: 'https://kaneo.invalid' },
        status: 'active',
      })
    }
    setContextSettings({ contextId: assignedContextId, taskInstanceId, platformInstanceId })
  }
}

function setupUserConfig(userId: string): void {
  for (const contextId of new Set([userId, scopedDm(userId), scopedGroup(userId)])) {
    setupContextTaskAssignment(contextId)
    setConfigValue(contextId, KANEO_PLUGIN_CREDENTIAL_KEY, 'test-kaneo-key')
    setConfig(contextId, 'timezone', 'UTC')
  }
}

function waitForNextTick(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve()
    }, 0)
  })
}

function makeFile(overrides: Partial<IncomingFile> | undefined): IncomingFile {
  let resolvedOverrides: Partial<IncomingFile> = {}
  if (overrides !== undefined) resolvedOverrides = overrides
  return {
    fileId: 'f1',
    filename: 'doc.pdf',
    mimeType: 'application/pdf',
    size: 1000,
    content: Buffer.from('data'),
    ...resolvedOverrides,
  }
}

const ADMIN_ID = 'admin-bot-auth'

function makePluginCommandManifest(
  pluginId: string,
  contributedCommands: readonly string[] = ['sync'],
): PluginManifest {
  return {
    id: pluginId,
    name: 'Bot Test Plugin',
    version: '1.0.0',
    description: 'Plugin command bot test',
    apiVersion: PLUGIN_API_VERSION,
    main: 'index.ts',
    contributes: {
      tools: [],
      promptFragments: [],
      commands: [...contributedCommands],
      jobs: [],
      configKeys: [],
      taskProviderTypes: [],
      attachmentTransformers: [],
    },
    permissions: [],
    defaultEnabled: false,
    activationTimeoutMs: 5000,
    requiredTaskCapabilities: [],
    requiredChatCapabilities: [],
    configRequirements: [],
    providerCapabilities: [],
    providerConfigSchema: [],
    providerAllowedHosts: [],
  }
}

describe('Bot Authorization Gate (setupBot)', () => {
  // Track processMessage calls
  let processMessageCallCount = 0
  let lastProcessedStorageId: string | null = null
  let lastProcessedConfigContextId: string | null = null
  let lastProcessedContextType: 'dm' | 'group' | null = null

  let getMessageHandler: () => ((msg: IncomingMessage, reply: ReplyFn) => Promise<void>) | null

  beforeEach(async () => {
    // Reset mutable state to defaults
    processMessageCallCount = 0
    lastProcessedStorageId = null
    lastProcessedConfigContextId = null
    lastProcessedContextType = null

    // Register mocks
    mockLogger()

    // Setup test database with migrations
    await setupTestDb()
    seedCommonTestPlatformInstances()
    seedTestPlatformInstance({ id: 'mattermost-source', type: 'mattermost' })

    const botDeps = withSynchronousQueue({
      processMessage: (
        _reply: ReplyFn,
        storageContextId: string,
        _chatUserId: string,
        _username: string | null,
        _userText: string,
        contextType: 'dm' | 'group',
        configContextId: string | undefined,
      ): Promise<void> => {
        processMessageCallCount++
        lastProcessedStorageId = storageContextId
        if (configContextId === undefined) lastProcessedConfigContextId = null
        else lastProcessedConfigContextId = configContextId
        lastProcessedContextType = contextType
        return Promise.resolve()
      },
    })

    const { provider: mockChat, getMessageHandler: getHandler } = createMockChatForBot()
    getMessageHandler = getHandler

    setupBot(mockChat, ADMIN_ID, botDeps)
  })

  test('registers active plugin command contributions', () => {
    const pluginId = 'bot-command-plugin'
    contributionRegistry.deregister(pluginId)
    contributionRegistry.register(
      pluginId,
      {
        tools: [],
        promptFragments: [],
        commands: [
          {
            name: 'sync',
            description: 'Sync data',
            execute: (): Promise<void> => Promise.resolve(),
          },
        ],
        jobs: [],
      },
      makePluginCommandManifest(pluginId),
    )
    const { provider, commandHandlers } = createMockChatWithCommandHandlers()

    setupBot(
      provider,
      ADMIN_ID,
      withSynchronousQueue({
        processMessage: (): Promise<void> => Promise.resolve(),
      }),
    )

    expect(commandHandlers.has('plugin_bot_command_plugin_sync')).toBe(true)
    contributionRegistry.deregister(pluginId)
  })

  describe('Unauthorized user — silent drop', () => {
    test('does not call processMessage for unauthorized user', async () => {
      const messageHandler = getMessageHandler()
      expect(messageHandler).not.toBeNull()
      const { reply } = createMockReply()
      await messageHandler!({ ...createDmMessage('unknown-user'), text: 'hello' }, reply)
      expect(processMessageCallCount).toBe(0)
    })

    test('does not call reply.text for unauthorized user', async () => {
      const messageHandler = getMessageHandler()
      expect(messageHandler).not.toBeNull()
      const { reply, textCalls } = createMockReply()
      await messageHandler!({ ...createDmMessage('unknown-user'), text: 'hello' }, reply)
      expect(textCalls).toHaveLength(0)
    })
  })

  describe('seeds context_settings on first authorized message', () => {
    test('seeds a platform-only row (null task instance) at the config context', async () => {
      // Authorized but never went through /config — no context_settings row yet.
      addUser('seed-user', ADMIN_ID)
      const messageHandler = getMessageHandler()
      const { reply } = createMockReply()
      await messageHandler!({ ...createDmMessage('seed-user'), text: 'hello' }, reply)

      const settings = getContextSettings(scopedDm('seed-user'))
      expect(settings).not.toBeNull()
      expect(settings?.taskInstanceId).toBeNull()
      expect(settings?.platformInstanceId).toBe('test-instance')
    })

    test('does not clobber an existing task assignment', async () => {
      addUser('seed-user', ADMIN_ID)
      const configContextId = scopedDm('seed-user')
      insertTaskInstance({
        id: 'bot-kaneo',
        type: 'kaneo',
        config: { baseUrl: 'https://kaneo.invalid' },
        status: 'active',
      })
      setContextSettings({
        contextId: configContextId,
        taskInstanceId: 'bot-kaneo',
        platformInstanceId: 'test-instance',
      })
      const messageHandler = getMessageHandler()
      const { reply } = createMockReply()

      await messageHandler!({ ...createDmMessage('seed-user'), text: 'hello' }, reply)

      expect(getContextSettings(configContextId)?.taskInstanceId).toBe('bot-kaneo')
    })
  })

  describe('config-eligible group member — /config in DM', () => {
    const originalBaseUrl = process.env['SETTINGS_PUBLIC_BASE_URL']
    afterEach(() => {
      if (originalBaseUrl === undefined) delete process.env['SETTINGS_PUBLIC_BASE_URL']
      else process.env['SETTINGS_PUBLIC_BASE_URL'] = originalBaseUrl
    })

    test('issues a settings link instead of the unauthorized message', async () => {
      process.env['SETTINGS_PUBLIC_BASE_URL'] = 'https://bot.example.com'
      // member-cfg is a group admin of an authorized group => has a manageable group.
      addAuthorizedGroupForPlatform('group-cfg', ADMIN_ID)
      const scopedCfgGroup = scopedGroup('group-cfg')
      upsertKnownGroupContext({
        contextId: scopedCfgGroup,
        provider: 'telegram',
        displayName: 'Cfg Group',
        parentName: null,
      })
      upsertGroupAdminObservation({
        provider: 'telegram',
        contextId: scopedCfgGroup,
        userId: 'member-cfg',
        username: null,
        isAdmin: true,
      })

      const { provider, commandHandlers } = createMockChatWithCommandHandlers()
      setupBot(provider, ADMIN_ID, withSynchronousQueue({ processMessage: (): Promise<void> => Promise.resolve() }))
      const configHandler = commandHandlers.get('config')
      assert.ok(configHandler !== undefined, 'expected config handler to be registered')

      const { reply, textCalls } = createMockReply()
      await configHandler(createDmMessage('member-cfg', 'config'), reply, createAuth('member-cfg', { allowed: false }))

      const allText = textCalls.join('\n')
      expect(allText).toContain('https://bot.example.com/settings?code=')
      expect(allText).not.toContain('not authorized')
    })

    test('non-member unauthorized DM user still gets the unauthorized message', async () => {
      process.env['SETTINGS_PUBLIC_BASE_URL'] = 'https://bot.example.com'
      const { provider, commandHandlers } = createMockChatWithCommandHandlers()
      setupBot(provider, ADMIN_ID, withSynchronousQueue({ processMessage: (): Promise<void> => Promise.resolve() }))
      const configHandler = commandHandlers.get('config')
      assert.ok(configHandler !== undefined, 'expected config handler to be registered')

      const { reply, textCalls } = createMockReply()
      await configHandler(
        createDmMessage('stranger-cfg', 'config'),
        reply,
        createAuth('stranger-cfg', { allowed: false }),
      )

      expect(textCalls.join('\n')).toContain('not authorized')
    })

    test('cold DM: live platform admin check grants /config when no observation exists', async () => {
      process.env['SETTINGS_PUBLIC_BASE_URL'] = 'https://bot.example.com'
      clearGroupAdminLiveCache()
      // Authorized group exists, but the admin has never interacted => no observation,
      // so the local manageableGroups check is empty and the live API check is consulted.
      addAuthorizedGroupForPlatform('group-live', ADMIN_ID)

      const { provider, commandHandlers } = createMockChatWithCommandHandlers()
      provider.isGroupAdmin = mock((_pi: string, groupId: string, _userId: string) =>
        Promise.resolve(groupId === 'group-live'),
      )
      setupBot(provider, ADMIN_ID, withSynchronousQueue({ processMessage: (): Promise<void> => Promise.resolve() }))
      const configHandler = commandHandlers.get('config')
      assert.ok(configHandler !== undefined, 'expected config handler to be registered')

      const { reply, textCalls } = createMockReply()
      await configHandler(createDmMessage('cold-admin', 'config'), reply, createAuth('cold-admin', { allowed: false }))

      expect(textCalls.join('\n')).toContain('https://bot.example.com/settings?code=')
      expect(provider.isGroupAdmin).toHaveBeenCalledWith('test-instance', 'group-live', 'cold-admin')
    })

    test('cold DM: live platform admin check denies /config when user is not a group admin', async () => {
      process.env['SETTINGS_PUBLIC_BASE_URL'] = 'https://bot.example.com'
      clearGroupAdminLiveCache()
      addAuthorizedGroupForPlatform('group-live', ADMIN_ID)

      const { provider, commandHandlers } = createMockChatWithCommandHandlers()
      provider.isGroupAdmin = mock(() => Promise.resolve(false))
      setupBot(provider, ADMIN_ID, withSynchronousQueue({ processMessage: (): Promise<void> => Promise.resolve() }))
      const configHandler = commandHandlers.get('config')
      assert.ok(configHandler !== undefined, 'expected config handler to be registered')

      const { reply, textCalls } = createMockReply()
      await configHandler(
        createDmMessage('cold-stranger', 'config'),
        reply,
        createAuth('cold-stranger', { allowed: false }),
      )

      expect(textCalls.join('\n')).toContain('not authorized')
    })
  })

  describe('Authorized user — message processed', () => {
    test('calls processMessage for authorized user', async () => {
      addUser('auth-user', ADMIN_ID)
      setupUserConfig('auth-user')
      const messageHandler = getMessageHandler()
      expect(messageHandler).not.toBeNull()
      const { reply } = createMockReply()
      await messageHandler!({ ...createDmMessage('auth-user'), text: 'hello' }, reply)
      expect(processMessageCallCount).toBe(1)
      expect(lastProcessedStorageId).toBe(scopedDm('auth-user'))
      expect(lastProcessedConfigContextId).toBe(scopedDm('auth-user'))
      expect(lastProcessedContextType).toBe('dm')
    })

    test('forwards group contextType to processMessage', async () => {
      addAuthorizedGroupForPlatform('group-queue', ADMIN_ID)
      addGroupMemberForPlatform('group-queue', 'group-user', ADMIN_ID)
      setupUserConfig('group-queue')

      const messageHandler = getMessageHandler()
      expect(messageHandler).not.toBeNull()

      const { reply } = createMockReply()
      await messageHandler!(createGroupMessage('group-user', '@bot hello', false, 'group-queue'), reply)

      expect(processMessageCallCount).toBe(1)
      expect(lastProcessedStorageId).toBe(scopedGroup('group-queue'))
      expect(lastProcessedConfigContextId).toBe(scopedGroup('group-queue'))
      expect(lastProcessedContextType).toBe('group')
    })

    test('DM message enqueues empty voiceStagedIds without performing staged-file DB lookup', async () => {
      addUser('auth-user', ADMIN_ID)
      setupUserConfig('auth-user')

      // Spy on findVoiceStagedIds via mock.module to detect if it is called for DMs
      let findVoiceStagedIdsCalled = false
      const { findVoiceStagedIds: realFindVoiceStagedIds, ...rest } = await import('../src/bot-attachments.js')
      void mock.module('../src/bot-attachments.js', () => ({
        ...rest,
        findVoiceStagedIds: (...args: Parameters<typeof realFindVoiceStagedIds>): string[] => {
          findVoiceStagedIdsCalled = true
          return realFindVoiceStagedIds(...args)
        },
      }))

      const { provider: spyChat, getMessageHandler: getSpyHandler } = createMockChatForBot()
      const { setupBot: freshSetupBot } = await import('../src/bot.js')
      freshSetupBot(spyChat, ADMIN_ID, {
        processMessage: (): Promise<void> => Promise.resolve(),
        enqueueMessage: (_item, _reply, _handler): void => {},
      })

      const spyHandler = getSpyHandler()
      expect(spyHandler).not.toBeNull()
      const { reply } = createMockReply()
      const msg: IncomingMessage = {
        ...createDmMessage('auth-user'),
        text: 'hello',
        messageId: 'msg-dm-spy',
      }
      await spyHandler!(msg, reply)

      expect(findVoiceStagedIdsCalled).toBe(false)

      // Restore
      void mock.module('../src/bot-attachments.js', () => ({ ...rest, findVoiceStagedIds: realFindVoiceStagedIds }))
    })

    test('forwards group-scoped configContextId for threaded group messages', async () => {
      addAuthorizedGroupForPlatform('group-thread', ADMIN_ID)
      addGroupMemberForPlatform('group-thread', 'thread-user', ADMIN_ID)
      setupUserConfig('group-thread')
      setupUserConfig('group-thread:thread-123')

      const messageHandler = getMessageHandler()
      expect(messageHandler).not.toBeNull()

      const threadMessage = createGroupMessage('thread-user', '@bot threaded hello', false, 'group-thread')
      threadMessage.threadId = 'thread-123'

      const { reply } = createMockReply()
      await messageHandler!(threadMessage, reply)

      expect(processMessageCallCount).toBe(1)
      expect(lastProcessedStorageId).toBe(scopedGroupThread('group-thread', 'thread-123'))
      expect(lastProcessedConfigContextId).toBe(scopedGroup('group-thread'))
      expect(lastProcessedContextType).toBe('group')
    })

    test('emits message:replied once for queued authorized messages that send a reply', async () => {
      addUser('auth-user', ADMIN_ID)
      setupUserConfig('auth-user')

      const repliedEvents: DebugEvent[] = []
      const listener = makeRepliedEventListener(repliedEvents, 'auth-user')
      subscribe(listener)

      const { provider: replyingChat, getMessageHandler: getReplyingHandler } = createMockChatForBot()
      setupBot(
        replyingChat,
        ADMIN_ID,
        withSynchronousQueue({
          processMessage: async (reply: ReplyFn): Promise<void> => {
            await reply.text('queued reply')
          },
        }),
      )

      try {
        const messageHandler = getReplyingHandler()
        expect(messageHandler).not.toBeNull()

        const { reply, textCalls } = createMockReply()
        await messageHandler!({ ...createDmMessage('auth-user'), text: 'hello' }, reply)
        await waitForNextTick()

        expect(repliedEvents).toHaveLength(1)
        expect(textCalls).toEqual(['queued reply'])
      } finally {
        unsubscribe(listener)
      }
    })

    test('does not send typing for queued work before the LLM path starts', async () => {
      addUser('auth-user', ADMIN_ID)
      setupUserConfig('auth-user')

      const typingCalls: number[] = []
      const reply: ReplyFn = {
        text: async (): Promise<void> => {},
        formatted: async (): Promise<void> => {},
        typing: (): void => {
          typingCalls.push(Date.now())
        },
        buttons: (): Promise<undefined> => Promise.resolve(undefined),
      }

      const { provider: slowChat, getMessageHandler: getSlowHandler } = createMockChatForBot()
      setupBot(
        slowChat,
        ADMIN_ID,
        withSynchronousQueue({
          processMessage: async (): Promise<void> => {
            await new Promise((resolve) => {
              setTimeout(resolve, 100)
            })
          },
        }),
      )

      const messageHandler = getSlowHandler()
      expect(messageHandler).not.toBeNull()

      await messageHandler!({ ...createDmMessage('auth-user'), text: 'hello' }, reply)
      expect(typingCalls).toHaveLength(0)
    }, 1000)

    test('emits message:replied when queued authorized messages use replaceText', async () => {
      addUser('auth-user', ADMIN_ID)
      setupUserConfig('auth-user')

      const repliedEvents: DebugEvent[] = []
      const listener = makeRepliedEventListener(repliedEvents, 'auth-user')
      subscribe(listener)

      const { provider: replyingChat, getMessageHandler: getReplyingHandler } = createMockChatForBot()
      setupBot(
        replyingChat,
        ADMIN_ID,
        withSynchronousQueue({
          processMessage: async (reply: ReplyFn): Promise<void> => {
            assert.ok(reply.replaceText !== undefined)
            await reply.replaceText('queued replacement')
          },
        }),
      )

      try {
        const messageHandler = getReplyingHandler()
        expect(messageHandler).not.toBeNull()

        const { reply } = createMockReply()
        const replyWithReplaceText: ReplyFn = {
          ...reply,
          replaceText: (content: string): Promise<void> => reply.text(content),
        }
        await messageHandler!({ ...createDmMessage('auth-user'), text: 'hello' }, replyWithReplaceText)
        await waitForNextTick()

        expect(repliedEvents).toHaveLength(1)
      } finally {
        unsubscribe(listener)
      }
    })

    test('emits message:replied when queued authorized messages use replaceButtons', async () => {
      addUser('auth-user', ADMIN_ID)
      setupUserConfig('auth-user')

      const repliedEvents: DebugEvent[] = []
      const listener = makeRepliedEventListener(repliedEvents, 'auth-user')
      subscribe(listener)

      const { provider: replyingChat, getMessageHandler: getReplyingHandler } = createMockChatForBot()
      setupBot(
        replyingChat,
        ADMIN_ID,
        withSynchronousQueue({
          processMessage: async (reply: ReplyFn): Promise<void> => {
            assert.ok(reply.replaceButtons !== undefined)
            await reply.replaceButtons('queued replacement buttons', { buttons: [] })
          },
        }),
      )

      try {
        const messageHandler = getReplyingHandler()
        expect(messageHandler).not.toBeNull()

        const { reply } = createMockReply()
        const replyWithReplaceButtons: ReplyFn = {
          ...reply,
          replaceButtons: async (content: string, options): Promise<void> => {
            await reply.buttons(content, options)
          },
        }
        await messageHandler!({ ...createDmMessage('auth-user'), text: 'hello' }, replyWithReplaceButtons)
        await waitForNextTick()

        expect(repliedEvents).toHaveLength(1)
      } finally {
        unsubscribe(listener)
      }
    })

    test('does not emit message:replied when queued processMessage throws before any reply', async () => {
      addUser('auth-user', ADMIN_ID)
      setupUserConfig('auth-user')

      const repliedEvents: DebugEvent[] = []
      const listener = makeRepliedEventListener(repliedEvents, 'auth-user')
      subscribe(listener)

      const { provider: failingChat, getMessageHandler: getFailingHandler } = createMockChatForBot()
      setupBot(
        failingChat,
        ADMIN_ID,
        withSynchronousQueue({
          processMessage: (): Promise<void> => Promise.reject(new Error('Simulated process failure')),
        }),
      )

      try {
        const messageHandler = getFailingHandler()
        expect(messageHandler).not.toBeNull()

        const { reply, textCalls } = createMockReply()
        await messageHandler!({ ...createDmMessage('auth-user'), text: 'hello' }, reply)
        await waitForNextTick()

        expect(repliedEvents).toHaveLength(0)
        expect(textCalls).toHaveLength(0)
      } finally {
        unsubscribe(listener)
      }
    })

    test('does not auto-start wizard for unconfigured threaded group messages', async () => {
      addAuthorizedGroupForPlatform('group-thread-configured', ADMIN_ID)
      addGroupMemberForPlatform('group-thread-configured', 'thread-user', ADMIN_ID)

      const messageHandler = getMessageHandler()
      expect(messageHandler).not.toBeNull()

      const threadMessage = createGroupMessage('thread-user', '@bot hello', false, 'group-thread-configured')
      threadMessage.threadId = 'thread-empty'

      const { reply, textCalls } = createMockReply()
      await messageHandler!(threadMessage, reply)

      expect(processMessageCallCount).toBe(1)
      expect(lastProcessedStorageId).toBe(scopedGroupThread('group-thread-configured', 'thread-empty'))
      expect(lastProcessedConfigContextId).toBe(scopedGroup('group-thread-configured'))
      expect(textCalls).toHaveLength(0)
    })
  })

  test('records known group and admin observations before normal message handling', async () => {
    addUser('group-admin', ADMIN_ID)
    addAuthorizedGroupForPlatform('group-ops', ADMIN_ID)
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
    const knownGroup = db
      .select()
      .from(knownGroupContexts)
      .where(and(eq(knownGroupContexts.provider, 'mock'), eq(knownGroupContexts.contextId, scopedGroup('group-ops'))))
      .get()
    const adminObservation = db
      .select()
      .from(groupAdminObservations)
      .where(
        and(
          eq(groupAdminObservations.provider, 'mock'),
          eq(groupAdminObservations.contextId, scopedGroup('group-ops')),
          eq(groupAdminObservations.userId, 'group-admin'),
        ),
      )
      .get()

    expect(knownGroup).toBeDefined()
    expect(adminObservation).toBeDefined()
    assert.ok(knownGroup !== undefined)
    assert.ok(adminObservation !== undefined)
    expect(knownGroup.displayName).toBe('Operations')
    expect(knownGroup.parentName).toBe('Platform')
    expect(adminObservation.isAdmin).toBe(true)
  })

  test('records group user display observations before normal message handling', async () => {
    addUser('group-admin', ADMIN_ID)
    addAuthorizedGroupForPlatform('group-ops', ADMIN_ID)
    setupUserConfig('group-admin')

    const messageHandler = getMessageHandler()
    expect(messageHandler).not.toBeNull()

    const groupMessage = createGroupMessage('group-admin', '@bot status', true, 'group-ops')
    groupMessage.contextName = 'Operations'
    groupMessage.contextParentName = 'Platform'
    groupMessage.user = {
      ...groupMessage.user,
      username: 'itsmike',
      displayLabel: 'John Johnson (@itsmike)',
    }

    const { reply } = createMockReply()
    await messageHandler!(groupMessage, reply)

    const observation = getDrizzleDb()
      .select()
      .from(groupUserObservations)
      .where(
        and(
          eq(groupUserObservations.provider, 'mock'),
          eq(groupUserObservations.contextId, scopedGroup('group-ops')),
          eq(groupUserObservations.userId, 'group-admin'),
        ),
      )
      .get()

    expect(observation).toBeDefined()
    assert.ok(observation !== undefined)
    expect(observation.displayLabel).toBe('John Johnson (@itsmike)')
    expect(observation.username).toBe('itsmike')
  })

  test('does not surface unauthorized mentioned group admin as manageable', async () => {
    addUser('group-admin', ADMIN_ID)
    setupUserConfig('group-admin')

    const messageHandler = getMessageHandler()
    expect(messageHandler).not.toBeNull()

    const groupMessage = createGroupMessage('group-admin', '@bot status', true, 'group-blocked')
    groupMessage.contextName = 'Blocked Ops'
    groupMessage.contextParentName = 'Platform'

    const { reply, textCalls } = createMockReply()
    await messageHandler!(groupMessage, reply)

    expect(textCalls).toHaveLength(1)
    expect(textCalls[0]).toContain('group-blocked')
    expect(listManageableGroups('group-admin')).toHaveLength(0)
  })

  test('context command preserves renderContext for class-based chat providers', async () => {
    addUser('context-user', ADMIN_ID)
    setupUserConfig('context-user')

    const commandHandlers = new Map<string, CommandHandler>()

    class PrototypeChatProvider implements ChatProvider {
      readonly name = 'prototype-mock'
      readonly threadCapabilities = {
        supportsThreads: true,
        canCreateThreads: false,
        threadScope: 'message' as const,
      }
      readonly capabilities = DEFAULT_CHAT_CAPABILITIES
      readonly traits = { observedGroupMessages: 'all' as const }
      readonly configRequirements: [] = []

      registerCommand(name: string, handler: CommandHandler): void {
        commandHandlers.set(name, handler)
      }

      onMessage(_handler: (msg: IncomingMessage, reply: ReplyFn) => Promise<void>): void {}

      sendMessage(_platformInstanceId: string, _target: DeferredDeliveryTarget, _text: string): Promise<void> {
        return Promise.resolve()
      }

      start(): Promise<void> {
        return Promise.resolve()
      }

      stop(): Promise<void> {
        return Promise.resolve()
      }

      setCommands(_adminUserId: string): Promise<void> {
        return Promise.resolve()
      }

      resolveUserId(username: string, _context: ResolveUserContext): Promise<string | null> {
        return Promise.resolve(username)
      }

      renderContext(snapshot: ContextSnapshot): ContextRendered {
        return {
          method: 'text',
          content: `Context total=${String(snapshot.totalTokens)}`,
        }
      }
    }

    setupBot(
      new PrototypeChatProvider(),
      ADMIN_ID,
      withSynchronousQueue({
        processMessage: (): Promise<void> => Promise.resolve(),
      }),
    )

    const contextHandler = commandHandlers.get('context')
    expect(contextHandler).toBeDefined()
    assert.ok(contextHandler !== undefined, 'Expected context command to be registered')

    const { reply, textCalls } = createMockReply()
    await contextHandler(createDmMessage('context-user', '/context'), reply, createAuth('context-user'))

    expect(textCalls.length).toBeGreaterThan(0)
    expect(textCalls[0]).toContain('Context total=')
  })

  test('emits message:replied for unauthorized mention denial path', async () => {
    const repliedEvents: DebugEvent[] = []
    const listener = makeRepliedEventListener(repliedEvents, 'unknown-group-user')
    subscribe(listener)

    try {
      const messageHandler = getMessageHandler()
      expect(messageHandler).not.toBeNull()

      const { reply } = createMockReply()
      await messageHandler!(createGroupMessage('unknown-group-user', '@bot hello', false, 'group-auth'), reply)

      expect(repliedEvents).toHaveLength(1)
    } finally {
      unsubscribe(listener)
    }
  })

  test('hides admin help for authorized non-admin DM user in wrapped runtime path', async () => {
    addUser('authorized-user', ADMIN_ID)
    setupUserConfig('authorized-user')

    const commandHandlers = new Map<
      string,
      (msg: IncomingMessage, reply: ReplyFn, auth: ReturnType<typeof createAuth>) => Promise<void>
    >()
    const mockChat = createMockChat({ commandHandlers })
    setupBot(
      mockChat,
      ADMIN_ID,
      withSynchronousQueue({
        processMessage: (): Promise<void> => Promise.resolve(),
      }),
    )

    const helpHandler = commandHandlers.get('help')
    expect(helpHandler).not.toBeUndefined()

    const { reply: helpReply, textCalls: helpTextCalls } = createMockReply()
    await helpHandler!(createDmMessage('authorized-user', '/help'), helpReply, createAuth('authorized-user'))

    expect(helpTextCalls).toHaveLength(1)
    expect(helpTextCalls[0]).not.toContain('/group add <group-id>')
    expect(helpTextCalls[0]).not.toContain('/group remove <group-id>')
    expect(helpTextCalls[0]).not.toContain('/groups')
    expect(helpTextCalls[0]).not.toContain('Admin commands:')
  })

  test('replies with authorization hint for unauthorized mentioned group user', async () => {
    const messageHandler = getMessageHandler()
    expect(messageHandler).not.toBeNull()

    const groupMessage = createGroupMessage('unknown-group-user', '@bot hello', false, 'group-auth')
    const { reply, textCalls } = createMockReply()
    await messageHandler!(groupMessage, reply)

    expect(processMessageCallCount).toBe(0)
    expect(textCalls).toHaveLength(1)
    expect(textCalls[0]).toContain('not authorized')
    expect(textCalls[0]).toContain('group-auth')
  })

  test('replies with member-level hint for unauthorized user in allowlisted mentioned group', async () => {
    addAuthorizedGroupForPlatform('group-auth', ADMIN_ID)

    const messageHandler = getMessageHandler()
    expect(messageHandler).not.toBeNull()

    const groupMessage = createGroupMessage('unknown-group-user', '@bot hello', false, 'group-auth')
    const { reply, textCalls } = createMockReply()
    await messageHandler!(groupMessage, reply)

    expect(processMessageCallCount).toBe(0)
    expect(textCalls).toHaveLength(1)
    expect(textCalls[0]).toContain('Ask a group admin to add you')
  })

  test('does not record group observations for ignored non-mentioned natural language', async () => {
    addAuthorizedGroupForPlatform('group-noise', ADMIN_ID)
    addGroupMemberForPlatform('group-noise', 'group-member', ADMIN_ID)
    setupUserConfig('group-noise')

    const messageHandler = getMessageHandler()
    expect(messageHandler).not.toBeNull()

    const groupMessage: IncomingMessage = {
      user: { id: 'group-member', username: 'groupmember', isAdmin: false },
      contextId: 'group-noise',
      contextType: 'group',
      contextName: 'Noise',
      contextParentName: 'Platform',
      isMentioned: false,
      text: 'hello team',
      platformInstanceId: 'test-instance',
    }

    const { reply } = createMockReply()
    await messageHandler!(groupMessage, reply)

    const db = getDrizzleDb()
    const knownGroup = db
      .select()
      .from(knownGroupContexts)
      .where(and(eq(knownGroupContexts.provider, 'mock'), eq(knownGroupContexts.contextId, 'group-noise')))
      .get()
    const adminObservation = db
      .select()
      .from(groupAdminObservations)
      .where(
        and(
          eq(groupAdminObservations.provider, 'mock'),
          eq(groupAdminObservations.contextId, 'group-noise'),
          eq(groupAdminObservations.userId, 'group-member'),
        ),
      )
      .get()

    expect(knownGroup).toBeUndefined()
    expect(adminObservation).toBeUndefined()
    expect(processMessageCallCount).toBe(0)
  })

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
      .where(and(eq(knownGroupContexts.provider, 'mock'), eq(knownGroupContexts.contextId, scopedGroup('group-obs'))))
      .get()
    const adminObservation = db
      .select()
      .from(groupAdminObservations)
      .where(
        and(
          eq(groupAdminObservations.provider, 'mock'),
          eq(groupAdminObservations.contextId, scopedGroup('group-obs')),
          eq(groupAdminObservations.userId, 'obs-user'),
        ),
      )
      .get()

    expect(knownGroup).toBeDefined()
    expect(adminObservation).toBeDefined()
  })

  test('setupBot registers chat interaction handler when supported', () => {
    addUser('auth-user', ADMIN_ID)
    setupUserConfig('auth-user')

    const {
      provider: mockChat,
      getMessageHandler: getRegisteredMessageHandler,
      getInteractionHandler,
    } = createMockChatForBot()
    setupBot(
      mockChat,
      ADMIN_ID,
      withSynchronousQueue({
        processMessage: (): Promise<void> => Promise.resolve(),
      }),
    )

    expect(getRegisteredMessageHandler()).not.toBeNull()
    expect(getInteractionHandler()).not.toBeNull()
  })

  test('setupBot preserves provider binding when registering interaction handlers', () => {
    const baseProvider = createMockChat()
    const provider: ChatProvider & {
      registrationCount: number
      interactionHandler: ((interaction: IncomingInteraction, reply: ReplyFn) => Promise<void>) | null
    } = {
      ...baseProvider,
      registrationCount: 0,
      interactionHandler: null,
      onInteraction(handler: (interaction: IncomingInteraction, reply: ReplyFn) => Promise<void>): void {
        this.registrationCount += 1
        this.interactionHandler = handler
      },
    }

    setupBot(
      provider,
      ADMIN_ID,
      withSynchronousQueue({
        processMessage: (): Promise<void> => Promise.resolve(),
      }),
    )

    expect(provider.registrationCount).toBe(1)
    expect(provider.interactionHandler).not.toBeNull()
  })

  test('setupBot registers commands and handlers only once per provider instance', () => {
    const commandHandlers = new Map<string, CommandHandler>()
    const commandRegistrationCounts = new Map<string, number>()
    let messageRegistrationCount = 0
    let interactionRegistrationCount = 0

    const provider: ChatProvider = {
      ...createMockChat({ commandHandlers }),
      registerCommand(name: string, handler: CommandHandler): void {
        commandRegistrationCounts.set(name, incrementRegistrationCount(commandRegistrationCounts.get(name)))
        commandHandlers.set(name, handler)
      },
      onMessage(_handler: (msg: IncomingMessage, reply: ReplyFn) => Promise<void>): void {
        messageRegistrationCount = incrementRegistrationCount(messageRegistrationCount)
      },
      onInteraction(_handler: (interaction: IncomingInteraction, reply: ReplyFn) => Promise<void>): void {
        interactionRegistrationCount = incrementRegistrationCount(interactionRegistrationCount)
      },
    }

    setupBot(
      provider,
      ADMIN_ID,
      withSynchronousQueue({
        processMessage: (): Promise<void> => Promise.resolve(),
      }),
    )

    expect(() =>
      setupBot(
        provider,
        ADMIN_ID,
        withSynchronousQueue({
          processMessage: (): Promise<void> => Promise.resolve(),
        }),
      ),
    ).not.toThrow()
    expect([...commandRegistrationCounts.values()]).toSatisfy((counts) => counts.every((count) => count === 1))
    expect(messageRegistrationCount).toBe(1)
    expect(interactionRegistrationCount).toBe(1)
  })

  test('interaction handler replies with allowlist hint for non-allowlisted groups', async () => {
    const { provider: mockChat, getInteractionHandler } = createMockChatForBot()
    setupBot(
      mockChat,
      ADMIN_ID,
      withSynchronousQueue({
        processMessage: (): Promise<void> => Promise.resolve(),
      }),
    )

    const interactionHandler = getInteractionHandler()
    expect(interactionHandler).not.toBeNull()

    const { reply, textCalls } = createMockReply()
    const interaction: IncomingInteraction = {
      kind: 'button',
      user: { id: 'auth-user', username: 'authuser', isAdmin: false },
      contextId: 'group-missing',
      contextType: 'group',
      platformInstanceId: 'test-instance',
      storageContextId: 'group-missing',
      callbackData: 'wizard_confirm',
    }

    await interactionHandler!(interaction, reply)

    expect(textCalls).toHaveLength(1)
    expect(textCalls[0]).toContain('group-missing')
  })

  test('interaction handler replies with member hint for allowlisted groups', async () => {
    addAuthorizedGroupForPlatform('group-allowed', ADMIN_ID)

    const { provider: mockChat, getInteractionHandler } = createMockChatForBot()
    setupBot(
      mockChat,
      ADMIN_ID,
      withSynchronousQueue({
        processMessage: (): Promise<void> => Promise.resolve(),
      }),
    )

    const interactionHandler = getInteractionHandler()
    expect(interactionHandler).not.toBeNull()

    const { reply, textCalls } = createMockReply()
    const interaction: IncomingInteraction = {
      kind: 'button',
      user: { id: 'auth-user', username: 'authuser', isAdmin: false },
      contextId: 'group-allowed',
      contextType: 'group',
      platformInstanceId: 'test-instance',
      storageContextId: 'group-allowed',
      callbackData: 'wizard_confirm',
    }

    await interactionHandler!(interaction, reply)

    expect(textCalls).toHaveLength(1)
    expect(textCalls[0]).toContain('Ask a group admin to add you')
  })

  test('interaction handler replies with error message when routeInteraction throws', async () => {
    // Import the real module first to restore later
    const { routeInteraction: realRouteInteraction } = await import('../src/chat/interaction-router.js')

    // Mock routeInteraction to throw an error
    void mock.module('../src/chat/interaction-router.js', () => ({
      routeInteraction: (): Promise<boolean> => {
        throw new Error('Simulated routing failure')
      },
    }))

    addUser('auth-user', ADMIN_ID)
    setupUserConfig('auth-user')

    const { provider: mockChat, getInteractionHandler } = createMockChatForBot()
    setupBot(
      mockChat,
      ADMIN_ID,
      withSynchronousQueue({
        processMessage: (): Promise<void> => Promise.resolve(),
      }),
    )

    const interactionHandler = getInteractionHandler()
    expect(interactionHandler).not.toBeNull()

    const { reply, textCalls } = createMockReply()
    const interaction: IncomingInteraction = {
      kind: 'button',
      user: { id: 'auth-user', username: 'authuser', isAdmin: false },
      contextId: 'auth-user',
      contextType: 'dm',
      platformInstanceId: 'test-instance',
      storageContextId: 'auth-user',
      callbackData: 'wizard_confirm',
    }

    await interactionHandler!(interaction, reply)

    // Should show user-visible error when routeInteraction fails
    expect(textCalls.length).toBeGreaterThan(0)
    expect(textCalls[0]).toContain('Something went wrong')

    // Restore the real module to prevent mock pollution
    void mock.module('../src/chat/interaction-router.js', () => ({
      routeInteraction: realRouteInteraction,
    }))
  })

  describe('Username resolution on first message', () => {
    test('resolves username to real ID on first message', async () => {
      // Add user by username (placeholder ID, like /user add @newuser)
      addUser('placeholder-uuid', ADMIN_ID, 'newuser')
      const messageHandler = getMessageHandler()
      expect(messageHandler).not.toBeNull()
      const { reply } = createMockReply()
      // First message from real user ID with that username
      const msg = { ...createDmMessage('real-555', '', 'newuser'), text: 'hello' }
      setupUserConfig('real-555')
      await messageHandler!(msg, reply)
      expect(processMessageCallCount).toBe(1)
      expect(isAuthorized('real-555')).toBe(true)
    })

    test('subsequent messages from resolved user pass authorization', async () => {
      addUser('placeholder-uuid-2', ADMIN_ID, 'resolveduser')
      const messageHandler = getMessageHandler()
      expect(messageHandler).not.toBeNull()
      const { reply: reply1 } = createMockReply()
      // First message - resolves username
      const msg1 = { ...createDmMessage('real-666', '', 'resolveduser'), text: 'hello' }
      setupUserConfig('real-666')
      await messageHandler!(msg1, reply1)
      expect(processMessageCallCount).toBe(1)

      // Second message - should use real ID directly
      const { reply: reply2 } = createMockReply()
      const msg2 = { ...createDmMessage('real-666', '', 'resolveduser'), text: 'hello' }
      await messageHandler!(msg2, reply2)
      expect(processMessageCallCount).toBe(2)
    })
  })

  describe('Access revoked during session', () => {
    test('drops message after user is removed', async () => {
      addUser('removable-user', ADMIN_ID)
      setupUserConfig('removable-user')
      const messageHandler = getMessageHandler()
      expect(messageHandler).not.toBeNull()

      // First message — authorized
      const { reply: reply1 } = createMockReply()
      await messageHandler!({ ...createDmMessage('removable-user'), text: 'hello' }, reply1)
      expect(processMessageCallCount).toBe(1)

      // Remove user
      removeUser('removable-user')

      // Second message — should be dropped
      const { reply: reply2, textCalls } = createMockReply()
      await messageHandler!({ ...createDmMessage('removable-user'), text: 'hello' }, reply2)
      expect(processMessageCallCount).toBe(1)
      expect(textCalls).toHaveLength(0)
    })
  })

  // ---------------------------------------------------------------------------
  // createObservedCommandHandler wrapper behaviors: observation / denial / reply
  // ---------------------------------------------------------------------------

  test('records group admin observations for group commands before handling', async () => {
    addUser('group-admin-cmd', ADMIN_ID)
    addAuthorizedGroupForPlatform('group-obs-cmd', ADMIN_ID)
    setupUserConfig('group-admin-cmd')

    const commandHandlers = new Map<
      string,
      (msg: IncomingMessage, reply: ReplyFn, auth: ReturnType<typeof createAuth>) => Promise<void>
    >()
    const mockChat = createMockChat({ commandHandlers })
    setupBot(
      mockChat,
      ADMIN_ID,
      withSynchronousQueue({
        processMessage: (): Promise<void> => Promise.resolve(),
      }),
    )

    const helpHandler = commandHandlers.get('help')
    expect(helpHandler).not.toBeUndefined()

    const groupMessage = createGroupMessage('group-admin-cmd', '/help', true, 'group-obs-cmd')
    groupMessage.contextName = 'ObsCmd'
    groupMessage.contextParentName = 'Platform'

    const { reply } = createMockReply()
    await helpHandler!(groupMessage, reply, createAuth('group-admin-cmd', { isGroupAdmin: true }))

    const db = getDrizzleDb()
    const knownGroup = db
      .select()
      .from(knownGroupContexts)
      .where(
        and(eq(knownGroupContexts.provider, 'mock'), eq(knownGroupContexts.contextId, scopedGroup('group-obs-cmd'))),
      )
      .get()
    const adminObservation = db
      .select()
      .from(groupAdminObservations)
      .where(
        and(
          eq(groupAdminObservations.provider, 'mock'),
          eq(groupAdminObservations.contextId, scopedGroup('group-obs-cmd')),
          eq(groupAdminObservations.userId, 'group-admin-cmd'),
        ),
      )
      .get()

    expect(knownGroup).toBeDefined()
    expect(adminObservation).toBeDefined()
  })

  test('does not record group observation for DM command handler', async () => {
    addUser('dm-cmd-user', ADMIN_ID)
    setupUserConfig('dm-cmd-user')

    const commandHandlers = new Map<
      string,
      (msg: IncomingMessage, reply: ReplyFn, auth: ReturnType<typeof createAuth>) => Promise<void>
    >()
    const mockChat = createMockChat({ commandHandlers })
    setupBot(
      mockChat,
      ADMIN_ID,
      withSynchronousQueue({
        processMessage: (): Promise<void> => Promise.resolve(),
      }),
    )

    const helpHandler = commandHandlers.get('help')
    expect(helpHandler).not.toBeUndefined()

    const dmMessage = createDmMessage('dm-cmd-user', '/help')
    const { reply } = createMockReply()
    await helpHandler!(dmMessage, reply, createAuth('dm-cmd-user', { isGroupAdmin: false }))

    const adminObservation = getDrizzleDb()
      .select()
      .from(groupAdminObservations)
      .where(eq(groupAdminObservations.userId, 'dm-cmd-user'))
      .get()

    expect(adminObservation).toBeUndefined()
  })

  test('does not record group observation for non-admin group command handler', async () => {
    addUser('non-admin-cmd', ADMIN_ID)
    addAuthorizedGroupForPlatform('group-noadmin-cmd', ADMIN_ID)
    setupUserConfig('non-admin-cmd')

    const commandHandlers = new Map<
      string,
      (msg: IncomingMessage, reply: ReplyFn, auth: ReturnType<typeof createAuth>) => Promise<void>
    >()
    const mockChat = createMockChat({ commandHandlers })
    setupBot(
      mockChat,
      ADMIN_ID,
      withSynchronousQueue({
        processMessage: (): Promise<void> => Promise.resolve(),
      }),
    )

    const helpHandler = commandHandlers.get('help')
    expect(helpHandler).not.toBeUndefined()

    const groupMessage = createGroupMessage('non-admin-cmd', '/help', false, 'group-noadmin-cmd')
    groupMessage.contextName = 'NoAdmin'
    const { reply } = createMockReply()
    await helpHandler!(groupMessage, reply, createAuth('non-admin-cmd', { isGroupAdmin: false }))

    const adminObservation = getDrizzleDb()
      .select()
      .from(groupAdminObservations)
      .where(
        and(
          eq(groupAdminObservations.provider, 'mock'),
          eq(groupAdminObservations.contextId, scopedGroup('group-noadmin-cmd')),
          eq(groupAdminObservations.userId, 'non-admin-cmd'),
        ),
      )
      .get()

    expect(adminObservation).toBeUndefined()
  })

  test('denies group command execution when group is not allowlisted', async () => {
    const commandHandlers = new Map<
      string,
      (msg: IncomingMessage, reply: ReplyFn, auth: ReturnType<typeof createAuth>) => Promise<void>
    >()
    const mockChat = createMockChat({ commandHandlers })
    setupBot(
      mockChat,
      ADMIN_ID,
      withSynchronousQueue({
        processMessage: (): Promise<void> => Promise.resolve(),
      }),
    )

    const helpHandler = commandHandlers.get('help')
    expect(helpHandler).not.toBeUndefined()

    const groupMessage = createGroupMessage('group-user', '/help', false, 'group-denied-cmd')
    const { reply, textCalls } = createMockReply()
    await helpHandler!(groupMessage, reply, createAuth('group-user', { isGroupAdmin: true }))

    expect(textCalls).toHaveLength(1)
    expect(textCalls[0]).toContain('group-denied-cmd')
  })

  test('denies group command execution when group is allowlisted but user is not permitted', async () => {
    addAuthorizedGroupForPlatform('group-denied-members-cmd', ADMIN_ID)

    const commandHandlers = new Map<
      string,
      (msg: IncomingMessage, reply: ReplyFn, auth: ReturnType<typeof createAuth>) => Promise<void>
    >()
    const mockChat = createMockChat({ commandHandlers })
    setupBot(
      mockChat,
      ADMIN_ID,
      withSynchronousQueue({
        processMessage: (): Promise<void> => Promise.resolve(),
      }),
    )

    const helpHandler = commandHandlers.get('help')
    expect(helpHandler).not.toBeUndefined()

    const groupMessage = createGroupMessage('group-user', '/help', false, 'group-denied-members-cmd')
    const { reply, textCalls } = createMockReply()
    await helpHandler!(groupMessage, reply, createAuth('group-user', { isGroupAdmin: true }))

    expect(textCalls).toHaveLength(1)
    expect(textCalls[0]).toContain('Ask a group admin to add you')
  })

  test('emits message:replied for command reply path', async () => {
    addUser('group-admin-reply', ADMIN_ID)
    addAuthorizedGroupForPlatform('group-reply-cmd', ADMIN_ID)
    setupUserConfig('group-admin-reply')

    const repliedEvents: DebugEvent[] = []
    const listener = makeRepliedEventListener(repliedEvents, 'group-admin-reply')
    subscribe(listener)

    try {
      const commandHandlers = new Map<
        string,
        (msg: IncomingMessage, reply: ReplyFn, auth: ReturnType<typeof createAuth>) => Promise<void>
      >()
      const mockChat = createMockChat({ commandHandlers })
      setupBot(
        mockChat,
        ADMIN_ID,
        withSynchronousQueue({
          processMessage: (): Promise<void> => Promise.resolve(),
        }),
      )

      const helpHandler = commandHandlers.get('help')
      expect(helpHandler).not.toBeUndefined()

      const { reply } = createMockReply()
      await helpHandler!(
        createGroupMessage('group-admin-reply', '/help', true, 'group-reply-cmd'),
        reply,
        createAuth('group-admin-reply'),
      )

      expect(repliedEvents).toHaveLength(1)
    } finally {
      unsubscribe(listener)
    }
  })
})

describe('Open DM Access — wizard bypass (setupBot)', () => {
  let processMessageCallCount = 0
  let lastProcessedStorageId: string | null = null

  let getMessageHandler: () => ((msg: IncomingMessage, reply: ReplyFn) => Promise<void>) | null

  beforeEach(async () => {
    // Reset mutable state to defaults
    processMessageCallCount = 0
    lastProcessedStorageId = null

    // Register mocks
    mockLogger()

    await setupTestDb()
    seedCommonTestPlatformInstances()

    const botDeps = withSynchronousQueue({
      processMessage: (_reply: ReplyFn, storageContextId: string, _chatUserId: string): Promise<void> => {
        processMessageCallCount++
        lastProcessedStorageId = storageContextId
        return Promise.resolve()
      },
    })

    const { provider: mockChat, getMessageHandler: getHandler } = createMockChatForBot()
    getMessageHandler = getHandler

    setupBot(mockChat, ADMIN_ID, botDeps)
  })

  test('open-access user message reaches processMessage instead of wizard', async () => {
    // realistic setup; auth here comes from the pre-inserted users row, not open access
    setOpenDmAccess(TEST_PLATFORM_ID, true)
    // Add as open-access user (no config — normally triggers wizard)
    addUser('demo-bypass-1', 'open-access', 'demouser')

    const messageHandler = getMessageHandler()
    const { reply } = createMockReply()
    await messageHandler!({ ...createDmMessage('demo-bypass-1', '', 'demouser'), text: 'hello' }, reply)

    // Should reach processMessage, not be intercepted by wizard
    expect(processMessageCallCount).toBe(1)
    expect(lastProcessedStorageId).toBe(scopedDm('demo-bypass-1'))
  })
})

describe('Attachment workspace integration (setupBot)', () => {
  const RELAY_ADMIN = 'relay-admin'
  let capturedStorageId: string | null = null
  let attachmentIdsAtProcessingTime: readonly string[] = []
  let lastProcessedText: string
  let getMessageHandler: () => ((msg: IncomingMessage, reply: ReplyFn) => Promise<void>) | null

  beforeEach(async () => {
    capturedStorageId = null
    attachmentIdsAtProcessingTime = []
    lastProcessedText = ''
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()

    const botDeps = withSynchronousQueue({
      processMessage: (
        _reply: ReplyFn,
        storageContextId: string,
        _chatUserId: string,
        _username: string | null,
        userText: string,
      ): Promise<void> => {
        capturedStorageId = storageContextId
        lastProcessedText = userText
        attachmentIdsAtProcessingTime = listActiveAttachments(storageContextId).map((ref) => ref.attachmentId)
        return Promise.resolve()
      },
    })

    const { provider: mockChat, getMessageHandler: getHandler } = createMockChatForBot()
    getMessageHandler = getHandler
    setupBot(mockChat, RELAY_ADMIN, botDeps)
  })

  test('persists incoming files into the workspace for an authorized user', async () => {
    addUser('relay-user', RELAY_ADMIN)
    setupUserConfig('relay-user')
    const noOverrides: Partial<IncomingFile> | undefined = undefined
    const file = makeFile(noOverrides)
    const msg: IncomingMessage = { ...createDmMessage('relay-user'), files: [file] }
    const { reply } = createMockReply()

    await getMessageHandler()!(msg, reply)

    expect(capturedStorageId).toBe(scopedDm('relay-user'))
    expect(attachmentIdsAtProcessingTime).toHaveLength(1)
    assert.ok(attachmentIdsAtProcessingTime[0] !== undefined)
    expect(attachmentIdsAtProcessingTime[0].startsWith('att_')).toBe(true)
  })

  test('does not persist anything when an authorized message has no files', async () => {
    addUser('relay-user2', RELAY_ADMIN)
    setupUserConfig('relay-user2')

    const msg: IncomingMessage = { ...createDmMessage('relay-user2') }
    const { reply } = createMockReply()
    await getMessageHandler()!(msg, reply)

    expect(listActiveAttachments(scopedDm('relay-user2'))).toEqual([])
  })

  test('does not persist files for an unauthorized user', async () => {
    const file = makeFile({ fileId: 'secret' })
    const msg: IncomingMessage = { ...createDmMessage('unauth-user'), files: [file] }
    const { reply } = createMockReply()

    await getMessageHandler()!(msg, reply)

    expect(listActiveAttachments('unauth-user')).toEqual([])
  })

  test('text-only follow-up does not carry prior attachments in the prompt manifest', async () => {
    addUser('relay-user3', RELAY_ADMIN)
    setupUserConfig('relay-user3')
    const { reply } = createMockReply()

    const fileMsg: IncomingMessage = {
      ...createDmMessage('relay-user3'),
      files: [makeFile({ filename: 'first.pdf' })],
    }
    await getMessageHandler()!(fileMsg, reply)
    expect(attachmentIdsAtProcessingTime).toHaveLength(1)
    const firstAttachmentId = attachmentIdsAtProcessingTime[0]!
    assert.ok(firstAttachmentId !== undefined)
    expect(lastProcessedText).toContain('Available attachments')
    expect(lastProcessedText).toContain(firstAttachmentId)

    const textMsg: IncomingMessage = { ...createDmMessage('relay-user3'), text: 'what was that about?' }
    await getMessageHandler()!(textMsg, reply)

    expect(lastProcessedText).not.toContain('Available attachments')
    expect(lastProcessedText).not.toContain(firstAttachmentId)
    expect(lastProcessedText).toBe('what was that about?')
  })

  test('forwarded attachment stays bound to its own message, not a later text message', async () => {
    addUser('relay-user4', RELAY_ADMIN)
    setupUserConfig('relay-user4')
    const { reply } = createMockReply()

    const forwardedMsg: IncomingMessage = {
      ...createDmMessage('relay-user4'),
      files: [makeFile({ filename: 'forwarded.png', mimeType: 'image/png', forwardedFrom: 'Alice' })],
    }
    await getMessageHandler()!(forwardedMsg, reply)
    expect(attachmentIdsAtProcessingTime).toHaveLength(1)
    const forwardedAttachmentId = attachmentIdsAtProcessingTime[0]!
    assert.ok(forwardedAttachmentId !== undefined)
    expect(lastProcessedText).toContain(forwardedAttachmentId)

    const textMsg: IncomingMessage = { ...createDmMessage('relay-user4'), text: 'thanks' }
    await getMessageHandler()!(textMsg, reply)

    expect(lastProcessedText).not.toContain('Available attachments')
    expect(lastProcessedText).not.toContain(forwardedAttachmentId)
    expect(lastProcessedText).toBe('thanks')
  })
})

describe('getThreadScopedStorageContextId', () => {
  test('should return userId for DM context', () => {
    const threadId: string | undefined = undefined
    const result = getThreadScopedStorageContextId('user123', 'dm', threadId)
    expect(result).toBe('user123')
  })

  test('should return groupId for main chat (no thread)', () => {
    const threadId: string | undefined = undefined
    const result = getThreadScopedStorageContextId('group456', 'group', threadId)
    expect(result).toBe('group456')
  })

  test('should return groupId:threadId for thread', () => {
    const result = getThreadScopedStorageContextId('group456', 'group', 'thread789')
    expect(result).toBe('group456:thread789')
  })
})

// ---------------------------------------------------------------------------
// Analytics observation of the authorized message/turn lifecycle
// ---------------------------------------------------------------------------

type RecordedFacts = { observer: AnalyticsObserver; facts: AnalyticsSourceFact[] }

function createFactRecorder(): RecordedFacts {
  const facts: AnalyticsSourceFact[] = []
  return {
    facts,
    observer: {
      observe: (fact: AnalyticsSourceFact): void => {
        facts.push(fact)
      },
      flush: (): Promise<void> => Promise.resolve(),
      stop: (): Promise<void> => Promise.resolve(),
    },
  }
}

function factsOfType<T extends AnalyticsSourceFact['type']>(
  facts: readonly AnalyticsSourceFact[],
  type: T,
): Extract<AnalyticsSourceFact, { type: T }>[] {
  return facts.filter((fact): fact is Extract<AnalyticsSourceFact, { type: T }> => fact.type === type)
}

function acceptedFacts(
  facts: readonly AnalyticsSourceFact[],
): Extract<AnalyticsSourceFact, { type: 'chat_message_accepted' }>[] {
  return factsOfType(facts, 'chat_message_accepted')
}

function firstFactOfType<T extends AnalyticsSourceFact['type']>(
  facts: readonly AnalyticsSourceFact[],
  type: T,
): Extract<AnalyticsSourceFact, { type: T }> {
  const matches = factsOfType(facts, type)
  assert.ok(matches.length > 0, `expected at least one ${type} fact, got: ${facts.map((f) => f.type).join(',')}`)
  const first = matches[0]
  assert.ok(first !== undefined)
  return first
}

function decideGuestLocalAggregateOnly(fact: AnalyticsSourceFact): EligibilityDecision {
  if (fact.source.actorRole !== 'guest') return { allowed: false, reason: 'mode_off' }
  return { allowed: true, lane: 'local_aggregate', policyVersion: 0, collectionEligibility: null, deliveryGrant: null }
}

function analyticsBotDeps(observer: AnalyticsObserver, processMessage?: BotDeps['processMessage']): BotDeps {
  return withSynchronousQueue({
    processMessage: processMessage ?? ((): Promise<void> => Promise.resolve()),
    analyticsObserver: observer,
  })
}

function setupObservedCommandBot(observer: AnalyticsObserver): {
  commandHandlers: Map<string, CommandHandler>
} {
  const commandHandlers = new Map<string, CommandHandler>()
  const mockChat = createMockChat({ commandHandlers })
  setupBot(mockChat, ADMIN_ID, analyticsBotDeps(observer))
  return { commandHandlers }
}

describe('Analytics observation (setupBot)', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()
    runRegistry.clear()
  })

  afterEach(() => {
    runRegistry.clear()
  })

  test('denied, blocked, unauthorized-group, ignored chatter, and pre-auth receipt emit no chat_message_accepted', async () => {
    const { observer, facts } = createFactRecorder()
    const { provider: mockChat, getMessageHandler } = createMockChatForBot()
    setupBot(mockChat, ADMIN_ID, analyticsBotDeps(observer))
    const messageHandler = getMessageHandler()
    assert.ok(messageHandler !== null)

    addUser('blocked-user', ADMIN_ID)
    blockUser('blocked-user', TEST_PLATFORM_ID)
    addAuthorizedGroupForPlatform('group-ignored', ADMIN_ID)
    addGroupMemberForPlatform('group-ignored', 'chatter-user', ADMIN_ID)

    const receivedEvents: DebugEvent[] = []
    const listener = (event: DebugEvent): void => {
      receivedEvents.push(event)
    }
    subscribe(listener)
    try {
      // Denied DM (unknown user)
      await messageHandler({ ...createDmMessage('denied-user'), text: 'hello' }, createMockReply().reply)
      // Blocked user
      await messageHandler({ ...createDmMessage('blocked-user'), text: 'hello' }, createMockReply().reply)
      // Unauthorized group (mentioned, gets denial reply)
      await messageHandler(
        createGroupMessage('stranger-user', '@bot hello', false, 'group-unauthorized'),
        createMockReply().reply,
      )
      // Ignored group chatter (authorized member, no mention)
      await messageHandler(
        { ...createGroupMessage('chatter-user', 'random chatter', false, 'group-ignored'), commandMatch: '' },
        createMockReply().reply,
      )
    } finally {
      unsubscribe(listener)
    }

    expect(acceptedFacts(facts)).toHaveLength(0)
    // Positive controls: the observer was wired (bounded auth_checked emitted for each
    // post-auth decision) and the pre-auth debug receipt still fired for debug clients.
    expect(factsOfType(facts, 'auth_checked').length).toBe(4)
    expect(receivedEvents.filter((event) => event.type === 'message:received').length).toBe(4)
  })

  test('emits bounded auth_checked outcomes and reasons', async () => {
    const { observer, facts } = createFactRecorder()
    const { provider: mockChat, getMessageHandler } = createMockChatForBot()
    setupBot(mockChat, ADMIN_ID, analyticsBotDeps(observer))
    const messageHandler = getMessageHandler()
    assert.ok(messageHandler !== null)

    addUser('member-user', ADMIN_ID)
    addUser('blocked-user-2', ADMIN_ID)
    blockUser('blocked-user-2', TEST_PLATFORM_ID)

    await messageHandler({ ...createDmMessage('member-user'), text: 'hi' }, createMockReply().reply)
    await messageHandler({ ...createDmMessage('blocked-user-2'), text: 'hi' }, createMockReply().reply)
    await messageHandler({ ...createDmMessage('unknown-user-2'), text: 'hi' }, createMockReply().reply)
    await messageHandler(createGroupMessage('stranger-2', '@bot hi', false, 'group-nowhere'), createMockReply().reply)

    const authFacts = factsOfType(facts, 'auth_checked')
    expect(authFacts.map((fact) => `${fact.outcome}:${fact.reason}`)).toEqual([
      'granted:member',
      'denied:blocked',
      'denied:unknown_user',
      'denied:group_unauthorized',
    ])
  })

  describe('observed command analytics', () => {
    test('authorized first DM /start emits one chat_message_accepted with invocation_mode command', async () => {
      addUser('start-user', ADMIN_ID)
      const { observer, facts } = createFactRecorder()
      const { commandHandlers } = setupObservedCommandBot(observer)
      const startHandler = commandHandlers.get('start')
      assert.ok(startHandler !== undefined)

      await startHandler(createDmMessage('start-user', 'start'), createMockReply().reply, createAuth('start-user'))

      const accepted = acceptedFacts(facts)
      expect(accepted).toHaveLength(1)
      const fact = accepted[0]!
      expect(fact.source.invocationMode).toBe('command')
      expect(fact.isCommand).toBe(true)
      expect(fact.command).toBe('start')
      expect(fact.source.contextType).toBe('dm')
      expect(fact.source.actorRole).toBe('member')
      expect(fact.source.platformInstanceId).toBe(TEST_PLATFORM_ID)
    })

    test('/config emits one chat_message_accepted with command config', async () => {
      addUser('config-user', ADMIN_ID)
      const { observer, facts } = createFactRecorder()
      const { commandHandlers } = setupObservedCommandBot(observer)
      const configHandler = commandHandlers.get('config')
      assert.ok(configHandler !== undefined)

      await configHandler(createDmMessage('config-user', 'config'), createMockReply().reply, createAuth('config-user'))

      const accepted = acceptedFacts(facts)
      expect(accepted).toHaveLength(1)
      expect(accepted[0]!.command).toBe('config')
      expect(accepted[0]!.source.invocationMode).toBe('command')
    })

    test('coding-session command emits one chat_message_accepted with command acp', async () => {
      addUser('acp-user', ADMIN_ID)
      const pluginId = 'acp'
      contributionRegistry.deregister(pluginId)
      contributionRegistry.register(
        pluginId,
        {
          tools: [],
          promptFragments: [],
          commands: [{ name: 'acp', description: 'Coding sessions', execute: (): Promise<void> => Promise.resolve() }],
          jobs: [],
        },
        makePluginCommandManifest(pluginId, ['acp']),
      )
      try {
        const { observer, facts } = createFactRecorder()
        const { commandHandlers } = setupObservedCommandBot(observer)
        const acpHandler = commandHandlers.get('plugin_acp_acp')
        assert.ok(acpHandler !== undefined)

        await acpHandler(createDmMessage('acp-user', 'plugin_acp_acp'), createMockReply().reply, createAuth('acp-user'))

        const accepted = acceptedFacts(facts)
        expect(accepted).toHaveLength(1)
        expect(accepted[0]!.command).toBe('acp')
        expect(accepted[0]!.source.invocationMode).toBe('command')
      } finally {
        contributionRegistry.deregister(pluginId)
      }
    })

    test('denied command emits no chat_message_accepted', async () => {
      const { observer, facts } = createFactRecorder()
      const { commandHandlers } = setupObservedCommandBot(observer)
      const helpHandler = commandHandlers.get('help')
      assert.ok(helpHandler !== undefined)

      await helpHandler(createDmMessage('stranger-cmd', 'help'), createMockReply().reply, createAuth('stranger-cmd'))

      expect(acceptedFacts(facts)).toHaveLength(0)
      expect(factsOfType(facts, 'auth_checked')).toHaveLength(1)
    })

    test('command replies emit reply_sent with a null turn key', async () => {
      addUser('help-user', ADMIN_ID)
      const { observer, facts } = createFactRecorder()
      const { commandHandlers } = setupObservedCommandBot(observer)
      const helpHandler = commandHandlers.get('help')
      assert.ok(helpHandler !== undefined)

      await helpHandler(createDmMessage('help-user', 'help'), createMockReply().reply, createAuth('help-user'))

      const replyFacts = factsOfType(facts, 'reply_sent')
      expect(replyFacts).toHaveLength(1)
      expect(replyFacts[0]!.source.rawTurnId).toBeNull()
      expect(replyFacts[0]!.delivery).toBe('success')
    })
  })

  test('allowed DM emits one accepted fact with authoritative scope, role, and invocation mode', async () => {
    addUser('dm-accepted', ADMIN_ID)
    const { observer, facts } = createFactRecorder()
    const { provider: mockChat, getMessageHandler } = createMockChatForBot()
    setupBot(mockChat, ADMIN_ID, analyticsBotDeps(observer))

    await getMessageHandler()!({ ...createDmMessage('dm-accepted'), text: 'hello' }, createMockReply().reply)

    const accepted = acceptedFacts(facts)
    expect(accepted).toHaveLength(1)
    const fact = accepted[0]!
    expect(fact.source.platform).toBe('telegram')
    expect(fact.source.platformInstanceId).toBe(TEST_PLATFORM_ID)
    expect(fact.source.storageContextId).toBe(scopedDm('dm-accepted'))
    expect(fact.source.configContextId).toBe(scopedDm('dm-accepted'))
    expect(fact.source.nativeContextId).toBe('dm-accepted')
    expect(fact.source.contextType).toBe('dm')
    expect(fact.source.actorRole).toBe('member')
    expect(fact.source.invocationMode).toBe('normal')
    expect(fact.isCommand).toBe(false)
    expect(fact.command).toBe('none')
    expect(fact.inputCount).toBe(1)
    expect(fact.inputLengthChars).toBe(5)
    expect(fact.attachmentCount).toBe(0)
  })

  test('allowed mentioned group message emits one accepted fact with group scope', async () => {
    addAuthorizedGroupForPlatform('group-accepted', ADMIN_ID)
    addGroupMemberForPlatform('group-accepted', 'group-member-a', ADMIN_ID)
    const { observer, facts } = createFactRecorder()
    const { provider: mockChat, getMessageHandler } = createMockChatForBot()
    setupBot(mockChat, ADMIN_ID, analyticsBotDeps(observer))

    await getMessageHandler()!(
      createGroupMessage('group-member-a', '@bot hello', false, 'group-accepted'),
      createMockReply().reply,
    )

    const accepted = acceptedFacts(facts)
    expect(accepted).toHaveLength(1)
    const fact = accepted[0]!
    expect(fact.source.contextType).toBe('group')
    expect(fact.source.storageContextId).toBe(scopedGroup('group-accepted'))
    expect(fact.source.configContextId).toBe(scopedGroup('group-accepted'))
    expect(fact.source.nativeContextId).toBe('group-accepted')
    expect(fact.source.actorRole).toBe('member')
    expect(fact.source.invocationMode).toBe('normal')
  })

  test('bot admin messages map to analytics role admin', async () => {
    addUser('bot-admin-user', ADMIN_ID)
    addAdmin('bot-admin-user', TEST_PLATFORM_ID)
    const { observer, facts } = createFactRecorder()
    const { provider: mockChat, getMessageHandler } = createMockChatForBot()
    setupBot(mockChat, ADMIN_ID, analyticsBotDeps(observer))

    await getMessageHandler()!({ ...createDmMessage('bot-admin-user'), text: 'hi' }, createMockReply().reply)

    const accepted = acceptedFacts(facts)
    expect(accepted).toHaveLength(1)
    expect(accepted[0]!.source.actorRole).toBe('admin')
  })

  test('group admin messages map to analytics role admin', async () => {
    addAuthorizedGroupForPlatform('group-admin-scope', ADMIN_ID)
    const { observer, facts } = createFactRecorder()
    const { provider: mockChat, getMessageHandler } = createMockChatForBot()
    setupBot(mockChat, ADMIN_ID, analyticsBotDeps(observer))

    await getMessageHandler()!(
      createGroupMessage('platform-admin-user', '@bot hi', true, 'group-admin-scope'),
      createMockReply().reply,
    )

    const accepted = acceptedFacts(facts)
    expect(accepted).toHaveLength(1)
    expect(accepted[0]!.source.actorRole).toBe('admin')
  })

  test('queued turn emits turn_started, turn_completed, and reply_sent bound to the raw turn id', async () => {
    addUser('turn-user', ADMIN_ID)
    const { observer, facts } = createFactRecorder()
    const registry = createTurnContextRegistry()
    const { provider: mockChat, getMessageHandler } = createMockChatForBot()
    setupBot(mockChat, ADMIN_ID, {
      ...analyticsBotDeps(observer, async (reply: ReplyFn): Promise<void> => {
        await reply.text('turn reply')
      }),
      analyticsTurnRegistry: registry,
    })

    await getMessageHandler()!({ ...createDmMessage('turn-user'), text: 'hello' }, createMockReply().reply)
    await waitFor(() => factsOfType(facts, 'turn_completed').length === 1)

    const started = firstFactOfType(facts, 'turn_started')
    expect(started.incomingMessageCount).toBe(1)
    expect(started.queueWaitMs).toBeGreaterThanOrEqual(0)
    expect(started.source.rawTurnId).toBe('test-turn-id')

    const completed = firstFactOfType(facts, 'turn_completed')
    expect(completed.outcome).toBe('ok')
    expect(completed.durationMs).toBeGreaterThanOrEqual(0)
    expect(completed.replyCount).toBe(1)
    expect(completed.source.rawTurnId).toBe('test-turn-id')

    const replied = firstFactOfType(facts, 'reply_sent')
    expect(replied.delivery).toBe('success')
    expect(replied.partCount).toBe(1)
    expect(replied.source.rawTurnId).toBe('test-turn-id')

    expect(registry.resolve('test-turn-id')?.rawTurnId).toBe('test-turn-id')
  })

  test('turn failure emits turn_completed llm_error with duration but no raw exception message', async () => {
    addUser('failing-turn-user', ADMIN_ID)
    const { observer, facts } = createFactRecorder()
    const { provider: mockChat, getMessageHandler } = createMockChatForBot()
    setupBot(
      mockChat,
      ADMIN_ID,
      analyticsBotDeps(observer, (): Promise<void> => Promise.reject(new Error('raw-sensitive-llm-boom'))),
    )

    await getMessageHandler()!({ ...createDmMessage('failing-turn-user'), text: 'hello' }, createMockReply().reply)
    await waitFor(() => factsOfType(facts, 'turn_completed').length === 1)

    const completed = firstFactOfType(facts, 'turn_completed')
    expect(completed.outcome).toBe('llm_error')
    expect(completed.durationMs).toBeGreaterThanOrEqual(0)
    expect(JSON.stringify(facts)).not.toContain('raw-sensitive-llm-boom')
  })

  test('allowed guest produces only aggregate auth_granted, message_accepted, and guest_turn increments', async () => {
    addAuthorizedGroupForPlatform('group-guest', ADMIN_ID)
    setGuestMode(scopedGroup('group-guest'), true)

    const recording = createRecordingSinks()
    const health = createRecordingHealth()
    const normalizerEnv: NormalizerEnv = {
      hmacKey: Buffer.alloc(32, 9),
      keyVersion: KeyVersionSchema.parse('v1'),
      installId: 'install-test',
      appVersion: VersionStringSchema.parse('1.0.0'),
      policyVersion: 0,
      ingestedAtMs: Date.now(),
    }
    const observer = createAnalyticsObserver({
      decide: decideGuestLocalAggregateOnly,
      normalizerEnv: () => normalizerEnv,
      health,
      log: { warn: () => {} },
      sinks: recording.sinks,
    })

    let turnPromise: Promise<void> | null = null
    const { provider: mockChat, getMessageHandler } = createMockChatForBot()
    setupBot(mockChat, ADMIN_ID, {
      processMessage: async (reply: ReplyFn): Promise<void> => {
        await reply.text('guest reply')
      },
      enqueueMessage: (item, reply, handler): void => {
        turnPromise = handler(buildSyncCoalescedItem(item, reply, 'guest-turn-id'))
      },
      analyticsObserver: observer,
    })

    await getMessageHandler()!(
      createGroupMessage('guest-user-1', '@bot hello', false, 'group-guest'),
      createMockReply().reply,
    )
    assert.ok(turnPromise !== null)
    await turnPromise
    await observer.flush()

    const counterMetrics = recording.aggregates
      .map((item) => item.increment)
      .filter((increment) => increment.kind === 'counter')
      .map((increment) => increment.metric)
      .sort()
    expect(counterMetrics).toEqual(['auth_granted', 'guest_turn', 'message_accepted'])
    expect(recording.aggregates.filter((item) => item.increment.kind === 'histogram')).toEqual([])
    expect(recording.events).toEqual([])
    expect(health.counts.observer_failure).toBe(0)
  })
})

describe('withRephraseCapture', () => {
  const boundaryKeys = {
    actorKey: PseudonymSchema.parse('v1.p-actor'),
    conversationKey: PseudonymSchema.parse('v1.p-conversation'),
    turnKey: PseudonymSchema.parse('v1.p-turn'),
  }

  type CaptureCall = Readonly<{
    actorKey: unknown
    conversationKey: unknown
    turnKey: unknown
    capturedAtMs: number
    text: string
  }>

  function createBoundary(overrides?: { deriveNull?: boolean }): {
    boundary: RephraseBoundaryDeps
    captures: CaptureCall[]
    sources: { turnKey: unknown; rawTurnId: string }[]
  } {
    const captures: CaptureCall[] = []
    const sources: { turnKey: unknown; rawTurnId: string }[] = []
    return {
      captures,
      sources,
      boundary: {
        handoff: {
          captureText: (input) => {
            captures.push(input)
          },
          completeTurn: () => undefined,
          withdraw: () => undefined,
        },
        deriveKeys: () => (overrides?.deriveNull === true ? null : boundaryKeys),
        noteTurnSource: (turnKey, rawTurnId) => {
          sources.push({ turnKey, rawTurnId })
        },
        nowMs: () => 1_700_000_000_000,
      },
    }
  }

  const invoke = (
    processMessage: BotDeps['processMessage'],
    text: string,
    actorRole?: 'guest' | 'member',
  ): Promise<void> =>
    processMessage(
      createMockReply().reply,
      'scoped:ctx',
      'user-42',
      null,
      text,
      'dm',
      undefined,
      undefined,
      [],
      'turn-1',
      actorRole,
    )

  test('captures text with derived keys after authorization and still runs the turn', async () => {
    const { boundary, captures, sources } = createBoundary()
    const inner = mock((): Promise<void> => Promise.resolve())
    const deps = withRephraseCapture({ processMessage: inner, rephrase: boundary })
    await invoke(deps.processMessage, 'please create a task', 'member')
    expect(inner).toHaveBeenCalledTimes(1)
    expect(captures).toHaveLength(1)
    expect(captures[0]).toEqual({
      actorKey: boundaryKeys.actorKey,
      conversationKey: boundaryKeys.conversationKey,
      turnKey: boundaryKeys.turnKey,
      capturedAtMs: 1_700_000_000_000,
      text: 'please create a task',
    })
    expect(sources).toEqual([{ turnKey: boundaryKeys.turnKey, rawTurnId: 'turn-1' }])
  })

  test('commands, guests, and underivable identities are never captured', async () => {
    const { boundary, captures } = createBoundary()
    const deps = withRephraseCapture({ processMessage: () => Promise.resolve(), rephrase: boundary })
    await invoke(deps.processMessage, '/config', 'member')
    await invoke(deps.processMessage, 'guest message', 'guest')
    expect(captures).toHaveLength(0)
    const nullBoundary = createBoundary({ deriveNull: true })
    const nullDeps = withRephraseCapture({ processMessage: () => Promise.resolve(), rephrase: nullBoundary.boundary })
    await invoke(nullDeps.processMessage, 'please create a task', 'member')
    expect(nullBoundary.captures).toHaveLength(0)
  })

  test('returns the original deps when no rephrase boundary is configured', () => {
    const inner = mock((): Promise<void> => Promise.resolve())
    const deps: BotDeps = { processMessage: inner }
    expect(withRephraseCapture(deps)).toBe(deps)
  })

  test('a capture failure never breaks the turn', async () => {
    const throwingBoundary: RephraseBoundaryDeps = {
      handoff: {
        captureText: () => {
          throw new Error('capture exploded')
        },
        completeTurn: () => undefined,
        withdraw: () => undefined,
      },
      deriveKeys: () => boundaryKeys,
    }
    const inner = mock((): Promise<void> => Promise.resolve())
    const deps = withRephraseCapture({ processMessage: inner, rephrase: throwingBoundary })
    await expect(invoke(deps.processMessage, 'please create a task', 'member')).resolves.toBeUndefined()
    expect(inner).toHaveBeenCalledTimes(1)
  })
})
