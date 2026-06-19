// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test, beforeEach, mock } from 'bun:test'
import assert from 'node:assert/strict'

import { and, eq } from 'drizzle-orm'

import { listActiveAttachments } from '../src/attachments/index.js'
import {
  checkAuthorizationExtended as checkAuthorizationExtendedScoped,
  getThreadScopedStorageContextId,
} from '../src/auth.js'
import { addAuthorizedGroup } from '../src/authorized-groups.js'
import { setupBot, type BotDeps } from '../src/bot.js'
import { clearGroupAdminLiveCache } from '../src/chat/group-admin-live.js'
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
import { setConfig, setConfigValue } from '../src/config.js'
import { getDrizzleDb } from '../src/db/drizzle.js'
import { groupAdminObservations, groupUserObservations, knownGroupContexts } from '../src/db/schema.js'
import { subscribe, unsubscribe, type DebugEvent } from '../src/debug/event-bus.js'
import { listManageableGroups } from '../src/group-settings/access.js'
import { upsertGroupAdminObservation, upsertKnownGroupContext } from '../src/group-settings/registry.js'
import { addGroupMember } from '../src/groups.js'
import { addAdmin } from '../src/instances/admin-store.js'
import { setContextSettings } from '../src/instances/context-store.js'
import { setOpenDmAccess } from '../src/instances/platform-store.js'
import { getTaskInstance, insertTaskInstance } from '../src/instances/task-store.js'
import { contributionRegistry } from '../src/plugins/contributions.js'
import { PLUGIN_API_VERSION, type PluginManifest } from '../src/plugins/types.js'
import { KANEO_PLUGIN_CREDENTIAL_KEY } from '../src/types/config.js'
import {
  addUser as addScopedUser,
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

const enqueueMessageSynchronously: NonNullable<BotDeps['enqueueMessage']> = (item, reply, handler): void => {
  void handler({
    text: item.text,
    userId: item.userId,
    username: item.username,
    storageContextId: item.storageContextId,
    configContextId: item.configContextId,
    contextType: item.contextType,
    newAttachmentIds: item.newAttachmentIds,
    voiceStagedIds: item.voiceStagedIds,
    reply,
    turnId: 'test-turn-id',
  }).catch(() => {})
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

function makePluginCommandManifest(pluginId: string): PluginManifest {
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
      commands: ['sync'],
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
  let getMessageHandler: () => ((msg: IncomingMessage, reply: ReplyFn) => Promise<void>) | null

  beforeEach(async () => {
    capturedStorageId = null
    attachmentIdsAtProcessingTime = []
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()

    const botDeps = withSynchronousQueue({
      processMessage: (_reply: ReplyFn, storageContextId: string, _chatUserId: string): Promise<void> => {
        capturedStorageId = storageContextId
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
