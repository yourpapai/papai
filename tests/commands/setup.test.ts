// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { addAuthorizedGroup } from '../../src/authorized-groups.js'
import { toScopedContextId } from '../../src/chat/scoped-context.js'
import type { ChatCapability, ChatProvider, CommandHandler, ReplyFn } from '../../src/chat/types.js'
import { registerSetupCommand } from '../../src/commands/setup.js'
import type { SetupCommandDeps } from '../../src/commands/setup.js'
import { setConfig } from '../../src/config.js'
import { setKaneoWorkspace } from '../../src/users.js'
import {
  createAuth,
  createDmMessage,
  createGroupMessage,
  createMockChatWithCommandHandlers,
  createMockReply,
  mockLogger,
  setupTestDb,
} from '../utils/test-helpers.js'

const startSetupForTarget = async (
  userId: string,
  reply: ReplyFn,
  targetContextId: string,
  platformInstanceId: string,
  deps: SetupCommandDeps,
): Promise<void> => {
  const module = await import('../../src/commands/setup.js')
  return module.startSetupForTarget(userId, reply, targetContextId, platformInstanceId, deps)
}

const getConfigWithExistingApiKey = (_contextId: string, key: string): string | null => {
  const values: Record<string, string> = { kaneo_apikey: 'existing-key' }
  return Object.prototype.hasOwnProperty.call(values, key) ? values[key]! : null
}

const noContextSettings: SetupCommandDeps['getContextSettings'] = () => null

const SCOPED_GROUP_1 = toScopedContextId({ platformInstanceId: 'telegram-default', nativeContextId: 'group-1' })
const SCOPED_ADMIN_1 = toScopedContextId({ platformInstanceId: 'telegram-default', nativeContextId: 'admin-1' })

function createRouterLikeSetupChat(
  sourceProvider: ChatProvider,
  commandHandlers: Map<string, CommandHandler>,
): ChatProvider {
  return {
    ...createMockChatWithCommandHandlers({
      capabilities: new Set<ChatCapability>([
        'interactions.callbacks',
        'messages.buttons',
        'messages.delete',
        'messages.files',
        'files.receive',
      ]),
    }).provider,
    name: 'router',
    registerCommand: (name: string, handler: CommandHandler): void => {
      commandHandlers.set(name, handler)
    },
    getInstance: (id: string) => (id === 'mattermost-no-affordances' ? { provider: sourceProvider } : null),
  } as ChatProvider
}

describe('/setup command', () => {
  let setupHandler: CommandHandler | null = null
  const originalKaneoAutoProvision = process.env['KANEO_AUTO_PROVISION']

  const requireSetupHandler = (): CommandHandler => {
    if (setupHandler === null) {
      throw new Error('setup handler was not registered')
    }
    return setupHandler
  }

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    const { provider, commandHandlers } = createMockChatWithCommandHandlers()
    registerSetupCommand(provider, (_userId: string) => true)
    const registeredSetupHandler = commandHandlers.get('setup')
    if (registeredSetupHandler === undefined) {
      throw new Error('setup handler was not registered')
    }
    setupHandler = registeredSetupHandler
    if (originalKaneoAutoProvision === undefined) {
      delete process.env['KANEO_AUTO_PROVISION']
    } else {
      process.env['KANEO_AUTO_PROVISION'] = originalKaneoAutoProvision
    }
  })

  test('starts with a personal/group selector in DM', async () => {
    const { reply, buttonCalls } = createMockReply()

    await requireSetupHandler()(createDmMessage('user-1'), reply, createAuth('user-1'))

    expect(buttonCalls[0]).toContain('What do you want to configure?')
  })

  test('uses source instance affordances instead of router aggregate affordances', async () => {
    const commandHandlers = new Map<string, CommandHandler>()
    const sourceProvider = createMockChatWithCommandHandlers({ capabilities: new Set<ChatCapability>() }).provider
    registerSetupCommand(createRouterLikeSetupChat(sourceProvider, commandHandlers), (_userId: string) => true)
    const handler = commandHandlers.get('setup')
    assert.ok(handler !== undefined, 'setup handler was not registered')
    const { reply, textCalls, buttonCalls } = createMockReply()
    const msg = { ...createDmMessage('user-1'), platformInstanceId: 'mattermost-no-affordances' }

    await handler(msg, reply, createAuth('user-1'))

    expect(buttonCalls).toHaveLength(0)
    expect(textCalls.some((text) => text.includes('does not support automatic deletion'))).toBe(true)
    expect(textCalls.some((text) => text.includes('What do you want to configure?'))).toBe(true)
  })

  test('group admin gets a DM-only redirect', async () => {
    const { reply, textCalls } = createMockReply()

    await requireSetupHandler()(
      createGroupMessage('user-1', '/setup', true, 'group-1'),
      reply,
      createAuth('user-1', { isGroupAdmin: true }),
    )

    expect(textCalls[0]).toBe(
      'Group settings are configured in direct messages with the bot. Open a DM with me and run /setup.',
    )
  })

  test('non-admin group user gets the admin-only restriction', async () => {
    const { reply, textCalls } = createMockReply()

    await requireSetupHandler()(createGroupMessage('user-1', '/setup', false, 'group-1'), reply, createAuth('user-1'))

    expect(textCalls[0]).toBe(
      'Only group admins can configure group settings, and group settings are configured in direct messages with the bot.',
    )
  })

  test('group setup denial uses allowlist-specific unauthorized guidance', async () => {
    const { reply, textCalls } = createMockReply()

    await requireSetupHandler()(
      createGroupMessage('user-1', '/setup', true, 'group-1'),
      reply,
      createAuth('user-1', { allowed: false, reason: 'group_not_allowed', isGroupAdmin: true }),
    )

    expect(textCalls[0]).toBe(
      'This group is not authorized to use this bot. Ask the bot admin to run `/group add group-1` in a DM with the bot.',
    )
  })

  test('first-time allowlisted group setup provisions and stops before wizard', async () => {
    process.env['KANEO_AUTO_PROVISION'] = 'true'
    addAuthorizedGroup('group-1', 'admin-1')

    const { reply, textCalls } = createMockReply()
    const provisionConfigs: Array<{ publicUrl: string | undefined; internalUrl: string | undefined }> = []
    const deps: SetupCommandDeps = {
      isAuthorizedGroup: () => true,
      provisionAndConfigure: (_userId, _username, config) => {
        provisionConfigs.push(config)
        return Promise.resolve({
          status: 'provisioned',
          email: 'group-1-a1b2c3d4@pap.ai',
          password: 'pw-1',
          kaneoUrl: 'https://kaneo.test',
          apiKey: 'key-1',
          workspaceId: 'ws-1',
        })
      },
      createWizard: () => ({ success: true, prompt: 'wizard-started' }),
      getConfig: () => null,
      getKaneoWorkspace: () => null,
      getContextSettings: () => ({
        contextId: 'group-1',
        taskInstanceId: 'kaneo-prod',
        platformInstanceId: 'telegram-default',
      }),
      getTaskInstance: () => ({
        id: 'kaneo-prod',
        type: 'kaneo',
        config: { baseUrl: 'https://kaneo.invalid' },
        status: 'active',
        createdAt: '2026-05-23T00:00:00.000Z',
      }),
      startTaskInstanceSelection: () => ({ status: 'assigned', taskProvider: 'kaneo' }),
    }

    await startSetupForTarget('admin-1', reply, 'group-1', 'telegram-default', deps)

    expect(textCalls.some((text) => text.includes('group Kaneo account has been created'))).toBe(true)
    expect(textCalls.some((text) => text.includes('Run /setup again when you are ready to continue'))).toBe(true)
    expect(textCalls.some((text) => text.includes('wizard-started'))).toBe(false)
    expect(provisionConfigs).toEqual([{ publicUrl: 'https://kaneo.invalid', internalUrl: undefined }])
  })

  test('first-time allowlisted group setup with auto-provision disabled continues into wizard', async () => {
    process.env['KANEO_AUTO_PROVISION'] = 'false'

    const { reply, textCalls } = createMockReply()
    const provisionConfigs: Array<{ publicUrl: string | undefined; internalUrl: string | undefined }> = []
    const deps: SetupCommandDeps = {
      isAuthorizedGroup: () => true,
      provisionAndConfigure: (_userId, _username, config) => {
        provisionConfigs.push(config)
        return Promise.resolve({
          status: 'provisioned',
          email: 'group-1-a1b2c3d4@pap.ai',
          password: 'pw-1',
          kaneoUrl: 'https://kaneo.test',
          apiKey: 'key-1',
          workspaceId: 'ws-1',
        })
      },
      createWizard: () => ({ success: true, prompt: 'wizard-started' }),
      getConfig: () => null,
      getKaneoWorkspace: () => null,
      getContextSettings: () => ({
        contextId: 'group-1',
        taskInstanceId: 'kaneo-prod',
        platformInstanceId: 'telegram-default',
      }),
      getTaskInstance: () => ({
        id: 'kaneo-prod',
        type: 'kaneo',
        config: { baseUrl: 'https://kaneo.invalid' },
        status: 'active',
        createdAt: '2026-05-23T00:00:00.000Z',
      }),
      startTaskInstanceSelection: () => ({ status: 'assigned', taskProvider: 'kaneo' }),
    }

    await startSetupForTarget('admin-1', reply, 'group-1', 'telegram-default', deps)

    expect(textCalls.some((text) => text.includes('Continuing with the setup process now.'))).toBe(true)
    expect(textCalls.some((text) => text.includes('wizard-started'))).toBe(true)
    expect(provisionConfigs).toEqual([{ publicUrl: 'https://kaneo.invalid', internalUrl: undefined }])
  })

  test('subsequent allowlisted group setup skips provisioning and starts the wizard', async () => {
    addAuthorizedGroup('group-1', 'admin-1')
    setConfig('group-1', 'kaneo_apikey', 'existing-key')
    setKaneoWorkspace('group-1', 'existing-workspace')

    const { reply, textCalls } = createMockReply()
    let provisionCalls = 0
    const deps: SetupCommandDeps = {
      isAuthorizedGroup: () => true,
      provisionAndConfigure: () => {
        provisionCalls++
        return Promise.resolve({ status: 'failed', error: 'should not be called' })
      },
      createWizard: () => ({ success: true, prompt: 'wizard-started' }),
      getConfig: getConfigWithExistingApiKey,
      getKaneoWorkspace: () => 'existing-workspace',
      getContextSettings: () => ({
        contextId: 'group-1',
        taskInstanceId: 'kaneo-prod',
        platformInstanceId: 'telegram-default',
      }),
      getTaskInstance: () => ({
        id: 'kaneo-prod',
        type: 'kaneo',
        config: { baseUrl: 'https://kaneo.invalid' },
        status: 'active',
        createdAt: '2026-05-23T00:00:00.000Z',
      }),
      startTaskInstanceSelection: () => ({ status: 'assigned', taskProvider: 'kaneo' }),
    }

    await startSetupForTarget('admin-1', reply, 'group-1', 'telegram-default', deps)

    expect(provisionCalls).toBe(0)
    expect(textCalls).toContain('wizard-started')
  })

  test('non-allowlisted group target is blocked before wizard creation', async () => {
    const { reply, textCalls } = createMockReply()
    const deps: SetupCommandDeps = {
      isAuthorizedGroup: () => false,
      provisionAndConfigure: () => Promise.resolve({ status: 'failed', error: 'should not be called' }),
      createWizard: () => ({ success: true, prompt: 'wizard-started' }),
      getConfig: () => null,
      getKaneoWorkspace: () => null,
      getContextSettings: () => ({
        contextId: 'group-1',
        taskInstanceId: 'kaneo-prod',
        platformInstanceId: 'telegram-default',
      }),
      getTaskInstance: () => ({
        id: 'kaneo-prod',
        type: 'kaneo',
        config: { baseUrl: 'https://kaneo.invalid' },
        status: 'active',
        createdAt: '2026-05-23T00:00:00.000Z',
      }),
      startTaskInstanceSelection: () => ({ status: 'assigned', taskProvider: 'kaneo' }),
    }

    await startSetupForTarget('admin-1', reply, 'group-1', 'telegram-default', deps)

    expect(textCalls[0]).toContain('/group add group-1')
  })

  test('accepts scoped group target during authorized group validation', async () => {
    const { reply, textCalls } = createMockReply()
    const authorizedLookups: string[] = []
    const deps: SetupCommandDeps = {
      isAuthorizedGroup: (groupId) => {
        authorizedLookups.push(groupId)
        return groupId === SCOPED_GROUP_1
      },
      provisionAndConfigure: () => Promise.resolve({ status: 'failed', error: 'should not be called' }),
      createWizard: () => ({ success: true, prompt: 'wizard-started' }),
      getConfig: () => 'existing-key',
      getKaneoWorkspace: () => 'existing-workspace',
      getContextSettings: () => ({
        contextId: SCOPED_GROUP_1,
        taskInstanceId: 'kaneo-prod',
        platformInstanceId: 'telegram-default',
      }),
      getTaskInstance: () => ({
        id: 'kaneo-prod',
        type: 'kaneo',
        config: { baseUrl: 'https://kaneo.invalid' },
        status: 'active',
        createdAt: '2026-05-23T00:00:00.000Z',
      }),
      startTaskInstanceSelection: () => ({ status: 'assigned', taskProvider: 'kaneo' }),
    }

    await startSetupForTarget('admin-1', reply, SCOPED_GROUP_1, 'telegram-default', deps)

    expect(authorizedLookups).toEqual([SCOPED_GROUP_1])
    expect(textCalls).toEqual(['wizard-started'])
  })

  test('does not treat scoped personal target as a group', async () => {
    const { reply, textCalls } = createMockReply()
    const authorizedLookups: string[] = []
    const deps: SetupCommandDeps = {
      isAuthorizedGroup: (groupId) => {
        authorizedLookups.push(groupId)
        return false
      },
      provisionAndConfigure: () => Promise.resolve({ status: 'failed', error: 'should not be called' }),
      createWizard: () => ({ success: true, prompt: 'wizard-started' }),
      getConfig: () => 'existing-key',
      getKaneoWorkspace: () => 'existing-workspace',
      getContextSettings: () => ({
        contextId: SCOPED_ADMIN_1,
        taskInstanceId: 'kaneo-prod',
        platformInstanceId: 'telegram-default',
      }),
      getTaskInstance: () => ({
        id: 'kaneo-prod',
        type: 'kaneo',
        config: { baseUrl: 'https://kaneo.invalid' },
        status: 'active',
        createdAt: '2026-05-23T00:00:00.000Z',
      }),
      startTaskInstanceSelection: () => ({ status: 'assigned', taskProvider: 'kaneo' }),
    }

    await startSetupForTarget('admin-1', reply, SCOPED_ADMIN_1, 'telegram-default', deps)

    expect(authorizedLookups).toEqual([])
    expect(textCalls).toEqual(['wizard-started'])
  })

  test('starts task instance selection when target has no assignment', async () => {
    const { reply, textCalls } = createMockReply()
    const deps: SetupCommandDeps = {
      isAuthorizedGroup: () => true,
      provisionAndConfigure: () => Promise.resolve({ status: 'failed', error: 'should not be called' }),
      createWizard: () => ({ success: true, prompt: 'wizard-started' }),
      getConfig: () => null,
      getKaneoWorkspace: () => null,
      getContextSettings: () => null,
      getTaskInstance: () => null,
      startTaskInstanceSelection: (_userId, _targetContextId, platformInstanceId) => {
        expect(platformInstanceId).toBe('mattermost-source')
        return { status: 'pending', response: 'choose a task tracker' }
      },
    }

    await startSetupForTarget('admin-1', reply, 'admin-1', 'mattermost-source', deps)

    expect(textCalls).toEqual(['choose a task tracker'])
  })

  test('provisions newly assigned group Kaneo task instance before starting wizard', async () => {
    process.env['KANEO_AUTO_PROVISION'] = 'false'
    const { reply, textCalls } = createMockReply()
    let provisionCalls = 0
    const provisionConfigs: Array<{ publicUrl: string | undefined; internalUrl: string | undefined }> = []
    let getContextSettingsImpl: SetupCommandDeps['getContextSettings'] = noContextSettings
    const deps: SetupCommandDeps = {
      isAuthorizedGroup: () => true,
      provisionAndConfigure: (_userId, _username, config) => {
        provisionCalls++
        provisionConfigs.push(config)
        return Promise.resolve({
          status: 'provisioned',
          email: 'group-1-a1b2c3d4@pap.ai',
          password: 'pw-1',
          kaneoUrl: 'https://kaneo.test',
          apiKey: 'key-1',
          workspaceId: 'ws-1',
        })
      },
      createWizard: () => ({ success: true, prompt: 'wizard-started' }),
      getConfig: () => null,
      getKaneoWorkspace: () => null,
      getContextSettings: (...args) => getContextSettingsImpl(...args),
      getTaskInstance: () => ({
        id: 'kaneo-prod',
        type: 'kaneo',
        config: { baseUrl: 'https://kaneo.public.invalid', internalUrl: 'https://kaneo.internal.invalid' },
        status: 'active',
        createdAt: '2026-05-23T00:00:00.000Z',
      }),
      startTaskInstanceSelection: () => {
        getContextSettingsImpl = (): ReturnType<SetupCommandDeps['getContextSettings']> => ({
          contextId: 'group-1',
          taskInstanceId: 'kaneo-prod',
          platformInstanceId: 'telegram-default',
        })
        return { status: 'assigned', taskProvider: 'kaneo' }
      },
    }

    await startSetupForTarget('admin-1', reply, 'group-1', 'telegram-default', deps)

    expect(provisionCalls).toBe(1)
    expect(provisionConfigs).toEqual([
      {
        publicUrl: 'https://kaneo.public.invalid',
        internalUrl: 'https://kaneo.internal.invalid',
      },
    ])
    expect(textCalls.some((text) => text.includes('Continuing with the setup process now.'))).toBe(true)
    expect(textCalls).toContain('wizard-started')
  })

  test('reports missing assigned Kaneo task instance URL before starting wizard', async () => {
    const { reply, textCalls } = createMockReply()
    let provisionCalls = 0
    const deps: SetupCommandDeps = {
      isAuthorizedGroup: () => true,
      provisionAndConfigure: (_userId, _username, config) => {
        provisionCalls++
        expect(config).toEqual({ publicUrl: ' ', internalUrl: undefined })
        return Promise.resolve({ status: 'failed', error: 'Kaneo task instance public URL is missing' })
      },
      createWizard: () => ({ success: true, prompt: 'wizard-started' }),
      getConfig: () => null,
      getKaneoWorkspace: () => null,
      getContextSettings: () => ({
        contextId: 'group-1',
        taskInstanceId: 'kaneo-prod',
        platformInstanceId: 'telegram-default',
      }),
      getTaskInstance: () => ({
        id: 'kaneo-prod',
        type: 'kaneo',
        config: { baseUrl: ' ' },
        status: 'active',
        createdAt: '2026-05-23T00:00:00.000Z',
      }),
      startTaskInstanceSelection: () => ({ status: 'assigned', taskProvider: 'kaneo' }),
    }

    await startSetupForTarget('admin-1', reply, 'group-1', 'telegram-default', deps)

    expect(provisionCalls).toBe(1)
    expect(textCalls).toEqual([
      'Kaneo account could not be created for this group: Kaneo task instance public URL is missing',
    ])
  })
})
