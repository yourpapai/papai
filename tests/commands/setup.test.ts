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
import { setConfigValue } from '../../src/config.js'
import type { TaskProviderTypeDescriptor } from '../../src/providers/registry.js'
import { KANEO_PLUGIN_CREDENTIAL_KEY, KANEO_PLUGIN_WORKSPACE_KEY } from '../../src/types/config.js'
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
  const values: Record<string, string> = {
    [KANEO_PLUGIN_CREDENTIAL_KEY]: 'existing-key',
    [KANEO_PLUGIN_WORKSPACE_KEY]: 'existing-workspace',
  }
  return Object.prototype.hasOwnProperty.call(values, key) ? values[key]! : null
}

const noContextSettings: SetupCommandDeps['getContextSettings'] = () => null
const noTaskProviderDescriptor: SetupCommandDeps['getTaskProviderDescriptor'] = () => {}
const genericAutoProvisionDescriptorForType = (_type: string): TaskProviderTypeDescriptor =>
  GENERIC_AUTO_PROVISION_DESCRIPTOR

const SCOPED_GROUP_1 = toScopedContextId({ platformInstanceId: 'telegram-default', nativeContextId: 'group-1' })
const SCOPED_ADMIN_1 = toScopedContextId({ platformInstanceId: 'telegram-default', nativeContextId: 'admin-1' })
const GENERIC_AUTO_PROVISION_DESCRIPTOR: TaskProviderTypeDescriptor = {
  type: 'youtrack',
  displayName: 'Generic Auto-Provisioned Provider',
  source: { plugin: 'task-provider-generic' },
  autoProvision: () => true,
  instanceConfigSchema: [],
  contextConfigSchema: [
    {
      key: 'token',
      label: 'Access Token',
      required: true,
      sensitive: true,
      scope: 'context',
    },
  ],
  capabilities: new Set(),
  traits: new Set(),
}

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

  test('first-time allowlisted group setup dispatches through the assigned provider descriptor', async () => {
    addAuthorizedGroup('group-1', 'admin-1')

    const { reply, textCalls } = createMockReply()
    const autoProvisionCalls: Array<{ contextId: string; chatUserId: string; username: string | null }> = []
    const configLookups: string[] = []
    const deps: SetupCommandDeps = {
      isAuthorizedGroup: () => true,
      maybeAutoProvision: async (provisionReply, contextId, chatUserId, username) => {
        autoProvisionCalls.push({ contextId, chatUserId, username })
        await provisionReply.text('generic auto provisioning reply')
        return true
      },
      createWizard: () => ({ success: true, prompt: 'wizard-started' }),
      getConfigValue: (_contextId, key) => {
        configLookups.push(key)
        return null
      },
      getContextSettings: () => ({
        contextId: 'group-1',
        taskInstanceId: 'youtrack-prod',
        platformInstanceId: 'telegram-default',
      }),
      getTaskInstance: () => ({
        id: 'youtrack-prod',
        type: 'youtrack',
        config: { baseUrl: 'https://youtrack.invalid' },
        status: 'active',
        createdAt: '2026-05-23T00:00:00.000Z',
      }),
      getTaskProviderDescriptor: genericAutoProvisionDescriptorForType,
      startTaskInstanceSelection: () => ({ status: 'assigned', taskProvider: 'youtrack' }),
    }

    await startSetupForTarget('admin-1', reply, 'group-1', 'telegram-default', deps)

    expect(configLookups).toEqual(['plugin:task-provider-generic:provider:token'])
    expect(autoProvisionCalls).toEqual([{ contextId: 'group-1', chatUserId: 'group-1', username: null }])
    expect(textCalls).toContain('generic auto provisioning reply')
    expect(textCalls.some((text) => text.includes('wizard-started'))).toBe(false)
  })

  test('first-time allowlisted group setup continues into wizard when generic auto-provision does not provision', async () => {
    const { reply, textCalls } = createMockReply()
    const autoProvisionCalls: Array<{ contextId: string; chatUserId: string; username: string | null }> = []
    const deps: SetupCommandDeps = {
      isAuthorizedGroup: () => true,
      maybeAutoProvision: async (provisionReply, contextId, chatUserId, username) => {
        autoProvisionCalls.push({ contextId, chatUserId, username })
        await provisionReply.text('generic auto provisioning reply')
        return false
      },
      createWizard: () => ({ success: true, prompt: 'wizard-started' }),
      getConfigValue: () => null,
      getContextSettings: () => ({
        contextId: 'group-1',
        taskInstanceId: 'youtrack-prod',
        platformInstanceId: 'telegram-default',
      }),
      getTaskInstance: () => ({
        id: 'youtrack-prod',
        type: 'youtrack',
        config: { baseUrl: 'https://youtrack.invalid' },
        status: 'active',
        createdAt: '2026-05-23T00:00:00.000Z',
      }),
      getTaskProviderDescriptor: genericAutoProvisionDescriptorForType,
      startTaskInstanceSelection: () => ({ status: 'assigned', taskProvider: 'youtrack' }),
    }

    await startSetupForTarget('admin-1', reply, 'group-1', 'telegram-default', deps)

    expect(autoProvisionCalls).toEqual([{ contextId: 'group-1', chatUserId: 'group-1', username: null }])
    expect(textCalls).toContain('generic auto provisioning reply')
    expect(textCalls.some((text) => text.includes('wizard-started'))).toBe(true)
  })

  test('subsequent allowlisted group setup skips provisioning and starts the wizard', async () => {
    addAuthorizedGroup('group-1', 'admin-1')
    setConfigValue('group-1', KANEO_PLUGIN_CREDENTIAL_KEY, 'existing-key')
    setConfigValue('group-1', KANEO_PLUGIN_WORKSPACE_KEY, 'existing-workspace')

    const { reply, textCalls } = createMockReply()
    let provisionCalls = 0
    const deps: SetupCommandDeps = {
      isAuthorizedGroup: () => true,
      maybeAutoProvision: () => {
        provisionCalls++
        return Promise.resolve(true)
      },
      createWizard: () => ({ success: true, prompt: 'wizard-started' }),
      getConfigValue: getConfigWithExistingApiKey,
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
      getTaskProviderDescriptor: noTaskProviderDescriptor,
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
      maybeAutoProvision: () => Promise.resolve(true),
      createWizard: () => ({ success: true, prompt: 'wizard-started' }),
      getConfigValue: () => null,
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
      getTaskProviderDescriptor: noTaskProviderDescriptor,
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
      maybeAutoProvision: () => Promise.resolve(true),
      createWizard: () => ({ success: true, prompt: 'wizard-started' }),
      getConfigValue: () => 'existing-key',
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
      getTaskProviderDescriptor: noTaskProviderDescriptor,
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
      maybeAutoProvision: () => Promise.resolve(true),
      createWizard: () => ({ success: true, prompt: 'wizard-started' }),
      getConfigValue: () => 'existing-key',
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
      getTaskProviderDescriptor: noTaskProviderDescriptor,
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
      maybeAutoProvision: () => Promise.resolve(true),
      createWizard: () => ({ success: true, prompt: 'wizard-started' }),
      getConfigValue: () => null,
      getContextSettings: () => null,
      getTaskInstance: () => null,
      getTaskProviderDescriptor: noTaskProviderDescriptor,
      startTaskInstanceSelection: (_userId, _targetContextId, platformInstanceId) => {
        expect(platformInstanceId).toBe('mattermost-source')
        return { status: 'pending', response: 'choose a task tracker' }
      },
    }

    await startSetupForTarget('admin-1', reply, 'admin-1', 'mattermost-source', deps)

    expect(textCalls).toEqual(['choose a task tracker'])
  })

  test('newly assigned group task instance stops at successful provider-descriptor auto-provision', async () => {
    const { reply, textCalls } = createMockReply()
    let provisionCalls = 0
    const autoProvisionCalls: Array<{ contextId: string; chatUserId: string; username: string | null }> = []
    let getContextSettingsImpl: SetupCommandDeps['getContextSettings'] = noContextSettings
    const deps: SetupCommandDeps = {
      isAuthorizedGroup: () => true,
      maybeAutoProvision: async (provisionReply, contextId, chatUserId, username) => {
        provisionCalls++
        autoProvisionCalls.push({ contextId, chatUserId, username })
        await provisionReply.text('generic auto provisioning reply')
        return true
      },
      createWizard: () => ({ success: true, prompt: 'wizard-started' }),
      getConfigValue: () => null,
      getContextSettings: (...args) => getContextSettingsImpl(...args),
      getTaskInstance: () => ({
        id: 'youtrack-prod',
        type: 'youtrack',
        config: { baseUrl: 'https://youtrack.invalid' },
        status: 'active',
        createdAt: '2026-05-23T00:00:00.000Z',
      }),
      getTaskProviderDescriptor: genericAutoProvisionDescriptorForType,
      startTaskInstanceSelection: () => {
        getContextSettingsImpl = (): ReturnType<SetupCommandDeps['getContextSettings']> => ({
          contextId: 'group-1',
          taskInstanceId: 'youtrack-prod',
          platformInstanceId: 'telegram-default',
        })
        return { status: 'assigned', taskProvider: 'youtrack' }
      },
    }

    await startSetupForTarget('admin-1', reply, 'group-1', 'telegram-default', deps)

    expect(provisionCalls).toBe(1)
    expect(autoProvisionCalls).toEqual([{ contextId: 'group-1', chatUserId: 'group-1', username: null }])
    expect(textCalls).toContain('generic auto provisioning reply')
    expect(textCalls.some((text) => text.includes('wizard-started'))).toBe(false)
  })

  test('continues to wizard when generic auto-provision hook does not provision the group', async () => {
    const { reply, textCalls } = createMockReply()
    let provisionCalls = 0
    const deps: SetupCommandDeps = {
      isAuthorizedGroup: () => true,
      maybeAutoProvision: (_reply, contextId, chatUserId, username) => {
        provisionCalls++
        expect({ contextId, chatUserId, username }).toEqual({
          contextId: 'group-1',
          chatUserId: 'group-1',
          username: null,
        })
        return Promise.resolve(false)
      },
      createWizard: () => ({ success: true, prompt: 'wizard-started' }),
      getConfigValue: () => null,
      getContextSettings: () => ({
        contextId: 'group-1',
        taskInstanceId: 'youtrack-prod',
        platformInstanceId: 'telegram-default',
      }),
      getTaskInstance: () => ({
        id: 'youtrack-prod',
        type: 'youtrack',
        config: { baseUrl: ' ' },
        status: 'active',
        createdAt: '2026-05-23T00:00:00.000Z',
      }),
      getTaskProviderDescriptor: genericAutoProvisionDescriptorForType,
      startTaskInstanceSelection: () => ({ status: 'assigned', taskProvider: 'youtrack' }),
    }

    await startSetupForTarget('admin-1', reply, 'group-1', 'telegram-default', deps)

    expect(provisionCalls).toBe(1)
    expect(textCalls).toEqual(['wizard-started'])
  })
})
