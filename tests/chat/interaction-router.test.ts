// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { eq } from 'drizzle-orm'

import { getAiOutputSettings } from '../../src/ai-output-settings.js'
import { addAuthorizedGroup, removeAuthorizedGroup } from '../../src/authorized-groups.js'
import { buildDiscordInteraction } from '../../src/chat/discord/interaction-helpers.js'
import { routeInteraction } from '../../src/chat/interaction-router.js'
import { toScopedContextId, toScopedThreadContextId } from '../../src/chat/scoped-context.js'
import { buildTelegramInteraction } from '../../src/chat/telegram/interaction-helpers.js'
import type { AuthorizationResult, IncomingInteraction, ReplyFn } from '../../src/chat/types.js'
import { serializeCallbackData } from '../../src/config-editor/callback-data.js'
import { handleEditorCallback, handleEditorMessage, startEditor } from '../../src/config-editor/handlers.js'
import { createEditorSession, deleteEditorSession, getEditorSession } from '../../src/config-editor/state.js'
import { getConfig, setConfigValue } from '../../src/config.js'
import { upsertGroupAdminObservation, upsertKnownGroupContext } from '../../src/group-settings/registry.js'
import {
  createGroupSettingsSession,
  deleteGroupSettingsSession,
  getActiveGroupSettingsTarget,
} from '../../src/group-settings/state.js'
import { setContextSettings } from '../../src/instances/context-store.js'
import { insertTaskInstance } from '../../src/instances/task-store.js'
import { pluginRegistry } from '../../src/plugins/registry.js'
import type { DiscoveredPlugin } from '../../src/plugins/types.js'
import { PLUGIN_API_VERSION } from '../../src/plugins/types.js'
import { KANEO_PLUGIN_CREDENTIAL_KEY, KANEO_PLUGIN_WORKSPACE_KEY } from '../../src/types/config.js'
import { createWizardSession } from '../../src/wizard/state.js'
import { deleteWizardSession } from '../../src/wizard/state.js'
import { mockLogger, seedCommonTestPlatformInstances, setupTestDb } from '../utils/test-helpers.js'

const interaction: IncomingInteraction = {
  kind: 'button',
  user: { id: 'user-1', username: 'alice', isAdmin: false },
  contextId: 'ctx-1',
  contextType: 'dm',
  platformInstanceId: 'test-instance',
  storageContextId: 'ctx-1',
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

const createMockAuth = (allowed: boolean): AuthorizationResult => ({
  allowed,
  isBotAdmin: false,
  isGroupAdmin: false,
  storageContextId: 'ctx-1',
})

const captureReplyText = (replies: string[]): ReplyFn['text'] => {
  return (content: string, ..._rest: [] | [Parameters<ReplyFn['text']>[1]]): Promise<void> => {
    replies.push(content)
    return Promise.resolve()
  }
}

function setupAuthorizedGroupForUser(userId: string, command: 'config' | 'setup'): void {
  const scopedGroupId = toScopedContextId({
    platformInstanceId: interaction.platformInstanceId,
    nativeContextId: 'group-9',
  })
  upsertKnownGroupContext({
    contextId: scopedGroupId,
    provider: 'telegram',
    displayName: 'Operations',
    parentName: 'Platform',
  })
  upsertGroupAdminObservation({
    provider: 'telegram',
    contextId: scopedGroupId,
    userId,
    username: interaction.user.username,
    isAdmin: true,
  })
  addAuthorizedGroup(scopedGroupId, 'admin-1')
  createGroupSettingsSession({
    userId,
    platformInstanceId: interaction.platformInstanceId,
    command,
    stage: 'active',
    targetContextId: scopedGroupId,
  })
}

function assignKaneoContext(contextId: string): void {
  insertTaskInstance({
    id: `${contextId}-kaneo`,
    type: 'kaneo',
    config: { baseUrl: 'https://kaneo.invalid' },
    status: 'active',
  })
  setContextSettings({ contextId, taskInstanceId: `${contextId}-kaneo`, platformInstanceId: 'telegram-default' })
}

function registerActivePlugin(pluginId: string): void {
  const plugin: DiscoveredPlugin = {
    manifest: {
      id: pluginId,
      name: 'Interaction Router Config Plugin',
      version: '1.0.0',
      description: 'Plugin-owned config callback regression test',
      apiVersion: PLUGIN_API_VERSION,
      main: 'index.ts',
      contributes: {
        tools: [],
        promptFragments: [],
        commands: [],
        jobs: [],
        configKeys: ['api_token'],
        taskProviderTypes: [],
      },
      permissions: [],
      defaultEnabled: true,
      activationTimeoutMs: 5000,
      requiredTaskCapabilities: [],
      requiredChatCapabilities: [],
      configRequirements: [{ key: 'api_token', label: 'API Token', required: true, sensitive: true, scope: 'context' }],
      providerCapabilities: [],
      providerConfigSchema: [],
      providerAllowedHosts: [],
    },
    pluginDir: `/tmp/${pluginId}`,
    entryPoint: `/tmp/${pluginId}/index.ts`,
    manifestHash: `hash-${pluginId}`,
  }

  pluginRegistry.registerDiscovered(plugin)
  pluginRegistry.approve(plugin.manifest.id, 'admin', plugin.manifestHash)
  pluginRegistry.markActive(plugin.manifest.id)
}

describe('routeInteraction', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()
    pluginRegistry.clearForTesting()
    deleteWizardSession(interaction.user.id, interaction.contextId)
    deleteEditorSession(interaction.user.id, interaction.contextId)
    deleteEditorSession(
      interaction.user.id,
      toScopedContextId({ platformInstanceId: interaction.platformInstanceId, nativeContextId: 'group-9' }),
    )
    deleteGroupSettingsSession(interaction.user.id)
    deleteGroupSettingsSession(interaction.user.id, interaction.platformInstanceId)
  })

  test('routes gsel callbacks through the group settings interaction dependency', async () => {
    const calls: string[] = []
    const handled = await routeInteraction(
      { ...interaction, callbackData: 'gsel:scope:group' },
      reply,
      createMockAuth(true),
      {
        handleGroupSettingsInteraction: () => {
          calls.push('gsel')
          return Promise.resolve(true)
        },
        handleConfigInteraction: () => Promise.resolve(false),
        handleWizardInteraction: () => Promise.resolve(false),
        handlePluginInteraction: () => Promise.resolve(false),
        handleToolToggleInteraction: () => Promise.resolve(false),
      },
    )

    expect(handled).toBe(true)
    expect(calls).toEqual(['gsel'])
  })

  test('routes cfg callbacks through the config interaction dependency', async () => {
    const calls: string[] = []
    const handled = await routeInteraction(interaction, reply, createMockAuth(true), {
      handleGroupSettingsInteraction: () => Promise.resolve(false),
      handleConfigInteraction: () => {
        calls.push('cfg')
        return Promise.resolve(true)
      },
      handleWizardInteraction: () => Promise.resolve(false),
      handlePluginInteraction: () => Promise.resolve(false),
      handleToolToggleInteraction: () => Promise.resolve(false),
    })

    expect(handled).toBe(true)
    expect(calls).toEqual(['cfg'])
  })

  test('compact config callbacks fail closed when routed through the wrong inferred context', async () => {
    const callbackData = serializeCallbackData(
      { action: 'edit', key: 'timezone' },
      'managed-group-context-with-a-very-long-stable-storage-id',
    )
    const replies: string[] = []

    const handled = await routeInteraction(
      { ...interaction, callbackData },
      {
        ...reply,
        text: captureReplyText(replies),
      },
      createMockAuth(true),
    )

    expect(handled).toBe(true)
    expect(replies).toEqual(['This action is no longer valid. Please start over with /config.'])
  })

  test('routes telegram cfg fallback with scoped auth context instead of native interaction storage', async () => {
    const telegramInteraction = buildTelegramInteraction(
      {
        from: { id: 42, username: 'alice' },
        chat: { id: 100, type: 'supergroup' },
        callbackQuery: { data: 'cfg:edit:timezone', message: { message_id: 7, message_thread_id: 5 } },
      },
      true,
      'telegram-secondary',
    )
    expect(telegramInteraction).not.toBeNull()
    const scopedThreadId = toScopedThreadContextId({
      platformInstanceId: 'telegram-secondary',
      nativeContextId: '100',
      threadId: '5',
    })
    const seenStorageIds: string[] = []

    const handled = await routeInteraction(
      telegramInteraction!,
      reply,
      { ...createMockAuth(true), storageContextId: scopedThreadId },
      {
        handleGroupSettingsInteraction: () => Promise.resolve(false),
        handleConfigInteraction: (routedInteraction) => {
          seenStorageIds.push(routedInteraction.storageContextId)
          return Promise.resolve(true)
        },
        handleWizardInteraction: () => Promise.resolve(false),
        handlePluginInteraction: () => Promise.resolve(false),
      },
    )

    expect(handled).toBe(true)
    expect(telegramInteraction!.storageContextId).toBe('100:5')
    expect(seenStorageIds).toEqual([scopedThreadId])
  })

  test('routes discord plugin fallback with scoped auth context instead of native interaction storage', async () => {
    const discordInteraction = buildDiscordInteraction(
      {
        user: { id: 'user-1', username: 'alice' },
        customId: 'plg:toggle',
        channelId: 'channel-1',
        channel: { type: 0 },
        message: { id: 'message-1' },
      },
      true,
      'discord-secondary',
    )
    expect(discordInteraction).not.toBeNull()
    const scopedContextId = toScopedContextId({ platformInstanceId: 'discord-secondary', nativeContextId: 'channel-1' })
    const seenStorageIds: string[] = []

    const handled = await routeInteraction(
      discordInteraction!,
      reply,
      { ...createMockAuth(true), storageContextId: scopedContextId },
      {
        handleGroupSettingsInteraction: () => Promise.resolve(false),
        handleConfigInteraction: () => Promise.resolve(false),
        handleWizardInteraction: () => Promise.resolve(false),
        handlePluginInteraction: (routedInteraction) => {
          seenStorageIds.push(routedInteraction.storageContextId)
          return Promise.resolve(true)
        },
      },
    )

    expect(handled).toBe(true)
    expect(discordInteraction!.storageContextId).toBe('channel-1')
    expect(seenStorageIds).toEqual([scopedContextId])
  })

  test('routes tool toggle callbacks with scoped auth context instead of native interaction storage', async () => {
    const scopedContextId = toScopedContextId({ platformInstanceId: 'telegram-secondary', nativeContextId: 'user-1' })
    const seenStorageIds: string[] = []

    const handled = await routeInteraction(
      { ...interaction, callbackData: 'tgl:dom:memo:dXNlci0x', storageContextId: 'user-1' },
      reply,
      { ...createMockAuth(true), storageContextId: scopedContextId },
      {
        handleGroupSettingsInteraction: () => Promise.resolve(false),
        handleConfigInteraction: () => Promise.resolve(false),
        handleWizardInteraction: () => Promise.resolve(false),
        handlePluginInteraction: () => Promise.resolve(false),
        handleToolToggleInteraction: (routedInteraction) => {
          seenStorageIds.push(routedInteraction.storageContextId)
          return Promise.resolve(true)
        },
      },
    )

    expect(handled).toBe(true)
    expect(seenStorageIds).toEqual([scopedContextId])
  })

  test('routes wizard callbacks through the wizard interaction dependency', async () => {
    const calls: string[] = []
    const handled = await routeInteraction(
      { ...interaction, callbackData: 'wizard_confirm' },
      reply,
      createMockAuth(true),
      {
        handleGroupSettingsInteraction: () => Promise.resolve(false),
        handleConfigInteraction: () => Promise.resolve(false),
        handleWizardInteraction: () => {
          calls.push('wizard')
          return Promise.resolve(true)
        },
        handlePluginInteraction: () => Promise.resolve(false),
        handleToolToggleInteraction: () => Promise.resolve(false),
      },
    )

    expect(handled).toBe(true)
    expect(calls).toEqual(['wizard'])
  })

  test('routes encoded wizard callbacks using the target group context instead of thread storage context', async () => {
    const replies: string[] = []
    createGroupSettingsSession({
      userId: interaction.user.id,
      command: 'setup',
      stage: 'active',
      targetContextId: 'group-9',
    })

    const handled = await routeInteraction(
      {
        ...interaction,
        contextId: 'group-9',
        contextType: 'group',
        storageContextId: 'group-9:thread-1',
        callbackData: `wizard_confirm@${Buffer.from('group-9').toString('base64url')}`,
      },
      {
        ...reply,
        text: captureReplyText(replies),
      },
      {
        ...createMockAuth(true),
        storageContextId: 'group-9:thread-1',
        configContextId: 'group-9',
      },
    )

    expect(handled).toBe(true)
    expect(replies).toEqual(['Error: Wizard session not found'])
  })

  test('routes perm: callbacks to handlePermissionInteraction', async () => {
    const calls: string[] = []
    const handled = await routeInteraction(
      { ...interaction, callbackData: 'perm:a:abcd1234' },
      reply,
      createMockAuth(true),
      {
        handleGroupSettingsInteraction: () => Promise.resolve(false),
        handleConfigInteraction: () => Promise.resolve(false),
        handleWizardInteraction: () => Promise.resolve(false),
        handlePluginInteraction: () => Promise.resolve(false),
        handleToolToggleInteraction: () => Promise.resolve(false),
        handlePermissionInteraction: () => {
          calls.push('perm')
          return Promise.resolve(true)
        },
      },
    )

    expect(handled).toBe(true)
    expect(calls).toEqual(['perm'])
  })

  test('returns false for unrecognized callback prefixes', async () => {
    const handled = await routeInteraction(
      { ...interaction, callbackData: 'unknown:action' },
      reply,
      createMockAuth(true),
      {
        handleGroupSettingsInteraction: () => Promise.resolve(false),
        handleConfigInteraction: () => Promise.resolve(false),
        handleWizardInteraction: () => Promise.resolve(false),
        handlePluginInteraction: () => Promise.resolve(false),
        handleToolToggleInteraction: () => Promise.resolve(false),
      },
    )

    expect(handled).toBe(false)
  })

  test('replies when wizard edit is clicked without an active session', async () => {
    const replies: string[] = []
    const handled = await routeInteraction(
      { ...interaction, callbackData: 'wizard_edit' },
      {
        ...reply,
        text: captureReplyText(replies),
      },
      createMockAuth(true),
    )

    expect(handled).toBe(true)
    expect(replies).toEqual(['No active setup session. Type /setup to start.'])
  })

  test('uses the active group target for cfg callbacks received in DM', async () => {
    setupAuthorizedGroupForUser(interaction.user.id, 'config')
    const scopedGroupId = toScopedContextId({
      platformInstanceId: interaction.platformInstanceId,
      nativeContextId: 'group-9',
    })
    const session = createEditorSession({
      userId: interaction.user.id,
      storageContextId: scopedGroupId,
      editingKey: 'timezone',
    })

    const buttonReplies: string[] = []
    const handled = await routeInteraction(
      {
        ...interaction,
        callbackData: serializeCallbackData({ action: 'cancel', sessionToken: session.sessionToken }, scopedGroupId),
      },
      {
        ...reply,
        buttons: (content: string): Promise<void> => {
          buttonReplies.push(content)
          return Promise.resolve()
        },
      },
      createMockAuth(true),
    )

    expect(handled).toBe(true)
    expect(buttonReplies[0]).toContain('Changes cancelled')
  })

  test('clears stale active DM-selected group target when cfg callback access is lost', async () => {
    setupAuthorizedGroupForUser(interaction.user.id, 'config')
    const scopedGroupId = toScopedContextId({
      platformInstanceId: interaction.platformInstanceId,
      nativeContextId: 'group-9',
    })

    const db = (await import('../../src/db/drizzle.js')).getDrizzleDb()
    const { groupAdminObservations } = await import('../../src/db/schema.js')
    db.delete(groupAdminObservations).where(eq(groupAdminObservations.contextId, scopedGroupId)).run()

    const replies: string[] = []
    const handled = await routeInteraction(
      { ...interaction, callbackData: serializeCallbackData({ action: 'cancel' }, scopedGroupId) },
      {
        ...reply,
        text: captureReplyText(replies),
      },
      createMockAuth(true),
    )

    expect(handled).toBe(true)
    expect(replies).toEqual([
      'You are no longer recognized as an admin for that group. Run /config or /setup again to choose a different target.',
    ])
    expect(getActiveGroupSettingsTarget(interaction.user.id)).toBeNull()
  })

  test('clears stale active DM-selected group target when cfg callback allowlist access is lost', async () => {
    setupAuthorizedGroupForUser(interaction.user.id, 'config')
    const scopedGroupId = toScopedContextId({
      platformInstanceId: interaction.platformInstanceId,
      nativeContextId: 'group-9',
    })

    expect(removeAuthorizedGroup(scopedGroupId)).toBe(true)

    const replies: string[] = []
    const handled = await routeInteraction(
      { ...interaction, callbackData: serializeCallbackData({ action: 'cancel' }, scopedGroupId) },
      {
        ...reply,
        text: captureReplyText(replies),
      },
      createMockAuth(true),
    )

    expect(handled).toBe(true)
    expect(replies).toEqual([
      'That group is no longer authorized for bot use. Ask the bot admin to run `/group add group-9` in DM, then run /config or /setup again.',
    ])
    expect(getActiveGroupSettingsTarget(interaction.user.id)).toBeNull()
  })

  test('compact cfg cancel callback fails closed after DM target selection changes', async () => {
    setupAuthorizedGroupForUser(interaction.user.id, 'config')
    const originalTarget = 'managed-group-context-with-a-very-long-stable-storage-id'
    const callbackData = serializeCallbackData({ action: 'cancel' }, originalTarget)

    createGroupSettingsSession({
      userId: interaction.user.id,
      platformInstanceId: interaction.platformInstanceId,
      command: 'config',
      stage: 'active',
      targetContextId: toScopedContextId({
        platformInstanceId: interaction.platformInstanceId,
        nativeContextId: 'group-9',
      }),
    })

    const replies: string[] = []
    const handled = await routeInteraction(
      { ...interaction, callbackData },
      {
        ...reply,
        text: captureReplyText(replies),
      },
      createMockAuth(true),
    )

    expect(handled).toBe(true)
    expect(replies).toEqual(['This action is no longer valid. Please start over with /config.'])
  })

  test('compact cfg back callback fails closed after DM target selection changes', async () => {
    setupAuthorizedGroupForUser(interaction.user.id, 'config')
    const originalTarget = 'managed-group-context-with-a-very-long-stable-storage-id'
    const callbackData = serializeCallbackData({ action: 'back' }, originalTarget)

    createGroupSettingsSession({
      userId: interaction.user.id,
      platformInstanceId: interaction.platformInstanceId,
      command: 'config',
      stage: 'active',
      targetContextId: toScopedContextId({
        platformInstanceId: interaction.platformInstanceId,
        nativeContextId: 'group-9',
      }),
    })

    const replies: string[] = []
    const handled = await routeInteraction(
      { ...interaction, callbackData },
      {
        ...reply,
        text: captureReplyText(replies),
      },
      createMockAuth(true),
    )

    expect(handled).toBe(true)
    expect(replies).toEqual(['This action is no longer valid. Please start over with /config.'])
  })

  test('compact cfg setup callback fails closed after DM target selection changes', async () => {
    setupAuthorizedGroupForUser(interaction.user.id, 'config')
    const originalTarget = 'managed-group-context-with-a-very-long-stable-storage-id'
    const callbackData = serializeCallbackData({ action: 'setup' }, originalTarget)

    createGroupSettingsSession({
      userId: interaction.user.id,
      platformInstanceId: interaction.platformInstanceId,
      command: 'config',
      stage: 'active',
      targetContextId: toScopedContextId({
        platformInstanceId: interaction.platformInstanceId,
        nativeContextId: 'group-9',
      }),
    })

    const replies: string[] = []
    const handled = await routeInteraction(
      { ...interaction, callbackData },
      {
        ...reply,
        text: captureReplyText(replies),
      },
      createMockAuth(true),
    )

    expect(handled).toBe(true)
    expect(replies).toEqual(['This action is no longer valid. Please start over with /config.'])
  })

  test('raw legacy cfg cancel callback fails closed in DM when a group target is active', async () => {
    setupAuthorizedGroupForUser(interaction.user.id, 'config')

    const replies: string[] = []
    const handled = await routeInteraction(
      { ...interaction, callbackData: 'cfg:cancel' },
      {
        ...reply,
        text: captureReplyText(replies),
      },
      createMockAuth(true),
    )

    expect(handled).toBe(true)
    expect(replies).toEqual(['This action is no longer valid. Please start over with /config.'])
  })

  test('blocks encoded cfg callback target when admin access is removed', async () => {
    setupAuthorizedGroupForUser(interaction.user.id, 'config')

    const db = (await import('../../src/db/drizzle.js')).getDrizzleDb()
    const { groupAdminObservations } = await import('../../src/db/schema.js')
    db.delete(groupAdminObservations)
      .where(
        eq(
          groupAdminObservations.contextId,
          toScopedContextId({ platformInstanceId: interaction.platformInstanceId, nativeContextId: 'group-9' }),
        ),
      )
      .run()

    const replies: string[] = []
    const handled = await routeInteraction(
      {
        ...interaction,
        callbackData: `cfg:cancel@${Buffer.from('group-9').toString('base64url')}`,
      },
      {
        ...reply,
        text: captureReplyText(replies),
      },
      createMockAuth(true),
    )

    expect(handled).toBe(true)
    expect(replies).toEqual([
      'You are no longer recognized as an admin for that group. Run /config or /setup again to choose a different target.',
    ])
    expect(getActiveGroupSettingsTarget(interaction.user.id)).toBeNull()
  })

  test('allows encoded personal cfg callback target in DM', async () => {
    setupAuthorizedGroupForUser(interaction.user.id, 'config')

    const db = (await import('../../src/db/drizzle.js')).getDrizzleDb()
    const { groupAdminObservations } = await import('../../src/db/schema.js')
    db.delete(groupAdminObservations)
      .where(
        eq(
          groupAdminObservations.contextId,
          toScopedContextId({ platformInstanceId: interaction.platformInstanceId, nativeContextId: 'group-9' }),
        ),
      )
      .run()

    const session = createEditorSession({
      userId: interaction.user.id,
      storageContextId: interaction.user.id,
      editingKey: 'timezone',
    })

    const buttonReplies: string[] = []
    const handled = await routeInteraction(
      {
        ...interaction,
        callbackData: serializeCallbackData(
          { action: 'cancel', sessionToken: session.sessionToken },
          interaction.user.id,
        ),
      },
      {
        ...reply,
        buttons: (content: string): Promise<void> => {
          buttonReplies.push(content)
          return Promise.resolve()
        },
      },
      createMockAuth(true),
    )

    expect(handled).toBe(true)
    expect(buttonReplies[0]).toContain('Changes cancelled')
  })

  test('saves encoded legacy personal cfg callback with unscoped editor session', async () => {
    const session = createEditorSession({
      userId: interaction.user.id,
      storageContextId: interaction.user.id,
      editingKey: 'timezone',
    })
    handleEditorMessage(interaction.user.id, interaction.user.id, 'Europe/Berlin')

    const handled = await routeInteraction(
      {
        ...interaction,
        callbackData: serializeCallbackData(
          { action: 'save', key: 'timezone', sessionToken: session.sessionToken },
          interaction.user.id,
        ),
      },
      reply,
      createMockAuth(true),
    )

    expect(handled).toBe(true)
    expect(getConfig(interaction.user.id, 'timezone')).toBe('Europe/Berlin')
    expect(
      getConfig(
        toScopedContextId({ platformInstanceId: interaction.platformInstanceId, nativeContextId: interaction.user.id }),
        'timezone',
      ),
    ).toBeNull()
  })

  test('prefers replaceButtons for cfg callback responses with buttons when available', async () => {
    const session = createEditorSession({
      userId: interaction.user.id,
      storageContextId: interaction.user.id,
      editingKey: 'timezone',
    })

    const replaceButtons = mock(() => Promise.resolve())
    const buttons = mock(() => Promise.resolve())

    const handled = await routeInteraction(
      {
        ...interaction,
        callbackData: serializeCallbackData(
          { action: 'cancel', sessionToken: session.sessionToken },
          interaction.user.id,
        ),
      },
      {
        ...reply,
        buttons,
        replaceButtons,
      },
      createMockAuth(true),
    )

    expect(handled).toBe(true)
    expect(replaceButtons).toHaveBeenCalledTimes(1)
    expect(buttons).not.toHaveBeenCalled()
  })

  test('saves edited config into the selected group context instead of the DM user context', async () => {
    setupAuthorizedGroupForUser(interaction.user.id, 'config')
    const scopedGroupId = toScopedContextId({
      platformInstanceId: interaction.platformInstanceId,
      nativeContextId: 'group-9',
    })
    createEditorSession({
      userId: interaction.user.id,
      storageContextId: scopedGroupId,
      editingKey: 'timezone',
    })
    handleEditorMessage(interaction.user.id, scopedGroupId, 'Europe/Berlin')
    const activeSession = getEditorSession(interaction.user.id, scopedGroupId)
    expect(activeSession).not.toBeNull()

    await routeInteraction(
      {
        ...interaction,
        callbackData: `cfg:save:timezone~${activeSession!.sessionToken}@${Buffer.from(scopedGroupId).toString('base64url')}`,
      },
      reply,
      createMockAuth(true),
    )

    expect(getConfig(scopedGroupId, 'timezone')).toBe('Europe/Berlin')
    expect(getConfig('group-9', 'timezone')).toBeNull()
    expect(getConfig(interaction.user.id, 'timezone')).toBeNull()
  })

  test('stale same-target cancel callback with an older session token fails closed', async () => {
    const userId = interaction.user.id
    const storageContextId = interaction.storageContextId

    startEditor(userId, storageContextId, 'timezone')
    handleEditorMessage(userId, storageContextId, 'UTC')
    const olderSession = getEditorSession(userId, storageContextId)

    startEditor(userId, storageContextId, 'timezone')
    handleEditorMessage(userId, storageContextId, 'Europe/Berlin')
    const activeSession = getEditorSession(userId, storageContextId)

    const replies: string[] = []
    const handled = await routeInteraction(
      {
        ...interaction,
        callbackData: serializeCallbackData({ action: 'cancel', sessionToken: olderSession?.sessionToken }),
      },
      {
        ...reply,
        text: captureReplyText(replies),
      },
      createMockAuth(true),
    )

    expect(handled).toBe(true)
    expect(replies).toEqual(['This action is no longer valid. Please start over with /config.'])
    expect(getEditorSession(userId, storageContextId)).toMatchObject({
      editingKey: 'timezone',
      pendingValue: 'Europe/Berlin',
      sessionToken: activeSession?.sessionToken,
    })

    handleEditorCallback(userId, storageContextId, 'back', undefined, activeSession?.sessionToken)
  })

  test('stale same-target back callback with an older session token fails closed', async () => {
    const userId = interaction.user.id
    const storageContextId = interaction.storageContextId

    startEditor(userId, storageContextId, 'timezone')
    handleEditorMessage(userId, storageContextId, 'UTC')
    const olderSession = getEditorSession(userId, storageContextId)

    startEditor(userId, storageContextId, 'timezone')
    handleEditorMessage(userId, storageContextId, 'Europe/Berlin')
    const activeSession = getEditorSession(userId, storageContextId)

    const replies: string[] = []
    const handled = await routeInteraction(
      {
        ...interaction,
        callbackData: serializeCallbackData({ action: 'back', sessionToken: olderSession?.sessionToken }),
      },
      {
        ...reply,
        text: captureReplyText(replies),
      },
      createMockAuth(true),
    )

    expect(handled).toBe(true)
    expect(replies).toEqual(['This action is no longer valid. Please start over with /config.'])
    expect(getEditorSession(userId, storageContextId)).toMatchObject({
      editingKey: 'timezone',
      pendingValue: 'Europe/Berlin',
      sessionToken: activeSession?.sessionToken,
    })

    handleEditorCallback(userId, storageContextId, 'back', undefined, activeSession?.sessionToken)
  })

  test('updates AI output setting for encoded target context', async () => {
    setupAuthorizedGroupForUser(interaction.user.id, 'config')
    const scopedGroupId = toScopedContextId({
      platformInstanceId: interaction.platformInstanceId,
      nativeContextId: 'group-9',
    })
    const buttonReplies: string[] = []

    const handled = await routeInteraction(
      {
        ...interaction,
        callbackData: `cfg:ai:toolVisibility:on@${Buffer.from('group-9').toString('base64url')}`,
      },
      {
        ...reply,
        buttons: (content: string): Promise<void> => {
          buttonReplies.push(content)
          return Promise.resolve()
        },
      },
      createMockAuth(true),
    )

    expect(handled).toBe(true)
    expect(getAiOutputSettings(scopedGroupId).toolVisibility).toBe('on')
    expect(getAiOutputSettings('group-9').toolVisibility).toBe('off')
    expect(getAiOutputSettings(interaction.user.id).toolVisibility).toBe('off')
    expect(buttonReplies[0]).toContain('Tool calls: on')
  })

  test('rejects group AI output callback targeting another context', async () => {
    const replies: string[] = []

    const handled = await routeInteraction(
      {
        ...interaction,
        contextId: 'group-9',
        contextType: 'group',
        storageContextId: 'group-9',
        callbackData: `cfg:ai:toolVisibility:on@${Buffer.from('other-context').toString('base64url')}`,
      },
      {
        ...reply,
        text: captureReplyText(replies),
      },
      {
        ...createMockAuth(true),
        storageContextId: 'group-9',
        isGroupAdmin: true,
      },
    )

    expect(handled).toBe(true)
    expect(getAiOutputSettings('other-context').toolVisibility).toBe('off')
    expect(getAiOutputSettings('group-9').toolVisibility).toBe('off')
    expect(replies).toEqual(['This action is no longer valid. Please start over with /config.'])
  })

  test('blocks non-admin group member from changing group AI output settings', async () => {
    const replies: string[] = []

    const handled = await routeInteraction(
      {
        ...interaction,
        contextId: 'group-9',
        contextType: 'group',
        storageContextId: 'group-9',
        callbackData: 'cfg:ai:detailLevel:raw',
      },
      {
        ...reply,
        text: captureReplyText(replies),
      },
      {
        ...createMockAuth(true),
        storageContextId: 'group-9',
        isGroupAdmin: false,
      },
    )

    expect(handled).toBe(true)
    expect(getAiOutputSettings('group-9').detailLevel).toBe('sanitized')
    expect(replies).toEqual(['Only group admins can change AI output visibility for this group.'])
  })

  test('starts setup for the selected group target', async () => {
    const scopedGroupId = toScopedContextId({
      platformInstanceId: interaction.platformInstanceId,
      nativeContextId: 'group-9',
    })
    upsertKnownGroupContext({
      contextId: scopedGroupId,
      provider: 'telegram',
      displayName: 'Operations',
      parentName: 'Platform',
    })
    addAuthorizedGroup(scopedGroupId, 'admin-1')
    assignKaneoContext(scopedGroupId)
    setConfigValue(scopedGroupId, KANEO_PLUGIN_CREDENTIAL_KEY, 'test-kaneo-key')
    setConfigValue(scopedGroupId, KANEO_PLUGIN_WORKSPACE_KEY, 'workspace-9')
    upsertGroupAdminObservation({
      provider: 'telegram',
      contextId: scopedGroupId,
      userId: interaction.user.id,
      username: interaction.user.username,
      isAdmin: true,
    })
    createGroupSettingsSession({
      userId: interaction.user.id,
      platformInstanceId: interaction.platformInstanceId,
      command: 'setup',
      stage: 'choose_group',
    })

    const replies: string[] = []
    const handled = await routeInteraction(
      { ...interaction, callbackData: 'gsel:group:group-9' },
      {
        ...reply,
        text: captureReplyText(replies),
      },
      createMockAuth(true),
    )

    expect(handled).toBe(true)
    expect(replies[0]).toContain('Welcome to papai configuration wizard!')
  })

  test('blocks encoded wizard callback target when admin access is removed', async () => {
    setupAuthorizedGroupForUser(interaction.user.id, 'setup')

    const db = (await import('../../src/db/drizzle.js')).getDrizzleDb()
    const { groupAdminObservations } = await import('../../src/db/schema.js')
    db.delete(groupAdminObservations)
      .where(
        eq(
          groupAdminObservations.contextId,
          toScopedContextId({ platformInstanceId: interaction.platformInstanceId, nativeContextId: 'group-9' }),
        ),
      )
      .run()

    const replies: string[] = []
    const handled = await routeInteraction(
      {
        ...interaction,
        callbackData: `wizard_confirm@${Buffer.from('group-9').toString('base64url')}`,
      },
      {
        ...reply,
        text: captureReplyText(replies),
      },
      createMockAuth(true),
    )

    expect(handled).toBe(true)
    expect(replies).toEqual([
      'You are no longer recognized as an admin for that group. Run /config or /setup again to choose a different target.',
    ])
    expect(getActiveGroupSettingsTarget(interaction.user.id)).toBeNull()
  })

  test('allows encoded personal wizard callback target in DM', async () => {
    const replies: string[] = []
    const handled = await routeInteraction(
      {
        ...interaction,
        callbackData: `wizard_edit@${Buffer.from(interaction.user.id).toString('base64url')}`,
      },
      {
        ...reply,
        text: captureReplyText(replies),
      },
      createMockAuth(true),
    )

    expect(handled).toBe(true)
    expect(replies).toEqual(['No active setup session. Type /setup to start.'])
  })

  test('confirms encoded legacy personal wizard callback with unscoped wizard session', async () => {
    createWizardSession({
      userId: interaction.user.id,
      storageContextId: interaction.user.id,
      totalSteps: 1,
      taskProvider: 'kaneo',
      initialData: { timezone: 'Europe/Berlin' },
    })

    const replies: string[] = []
    const handled = await routeInteraction(
      {
        ...interaction,
        callbackData: `wizard_confirm@${Buffer.from(interaction.user.id).toString('base64url')}`,
      },
      {
        ...reply,
        text: captureReplyText(replies),
      },
      createMockAuth(true),
    )

    expect(handled).toBe(true)
    expect(replies[0]).toContain('Configuration saved successfully')
    expect(getConfig(interaction.user.id, 'timezone')).toBe('Europe/Berlin')
  })

  test('edits encoded legacy personal wizard callback with unscoped wizard session', async () => {
    createWizardSession({
      userId: interaction.user.id,
      storageContextId: interaction.user.id,
      totalSteps: 1,
      taskProvider: 'kaneo',
      initialData: { timezone: 'Europe/Berlin' },
    })

    const replies: string[] = []
    const handled = await routeInteraction(
      {
        ...interaction,
        callbackData: `wizard_edit@${Buffer.from(interaction.user.id).toString('base64url')}`,
      },
      {
        ...reply,
        text: captureReplyText(replies),
      },
      createMockAuth(true),
    )

    expect(handled).toBe(true)
    expect(replies[0]).toContain('Editing configuration from the beginning')
  })

  test('cancels encoded legacy personal wizard callback with unscoped wizard session', async () => {
    createWizardSession({
      userId: interaction.user.id,
      storageContextId: interaction.user.id,
      totalSteps: 1,
      taskProvider: 'kaneo',
      initialData: { timezone: 'Europe/Berlin' },
    })

    const replies: string[] = []
    const handled = await routeInteraction(
      {
        ...interaction,
        callbackData: `wizard_cancel@${Buffer.from(interaction.user.id).toString('base64url')}`,
      },
      {
        ...reply,
        text: captureReplyText(replies),
      },
      createMockAuth(true),
    )

    expect(handled).toBe(true)
    expect(replies).toEqual(['❌ Wizard cancelled. Type /setup to restart.'])
  })

  test('restarts encoded legacy personal wizard callback with unscoped wizard session', async () => {
    createWizardSession({
      userId: interaction.user.id,
      storageContextId: interaction.user.id,
      totalSteps: 1,
      taskProvider: 'kaneo',
      initialData: { timezone: 'Europe/Berlin' },
    })

    const replies: string[] = []
    const handled = await routeInteraction(
      {
        ...interaction,
        callbackData: `wizard_restart@${Buffer.from(interaction.user.id).toString('base64url')}`,
      },
      {
        ...reply,
        text: captureReplyText(replies),
      },
      createMockAuth(true),
    )

    expect(handled).toBe(true)
    expect(replies).toEqual(['Restarting wizard... Type /setup to begin.'])
  })

  test('blocks unauthorized users with unauthorized message', async () => {
    const replies: string[] = []
    const handled = await routeInteraction(
      { ...interaction, callbackData: 'cfg:edit:timezone' },
      {
        ...reply,
        text: captureReplyText(replies),
      },
      createMockAuth(false),
    )

    expect(handled).toBe(true)
    expect(replies).toEqual(['You are not authorized to use this bot.'])
  })

  test('blocks wizard callbacks for unauthorized users', async () => {
    const replies: string[] = []
    const handled = await routeInteraction(
      { ...interaction, callbackData: 'wizard_confirm' },
      {
        ...reply,
        text: captureReplyText(replies),
      },
      createMockAuth(false),
    )

    expect(handled).toBe(true)
    expect(replies).toEqual(['You are not authorized to use this bot.'])
  })

  test('replies with no active session when wizard_cancel clicked without active wizard', async () => {
    const replies: string[] = []
    const handled = await routeInteraction(
      { ...interaction, callbackData: 'wizard_cancel' },
      {
        ...reply,
        text: captureReplyText(replies),
      },
      createMockAuth(true),
    )

    expect(handled).toBe(true)
    expect(replies).toEqual(['No active setup session. Type /setup to start.'])
  })

  test('prefers replaceText for wizard no-session cancel replies when available', async () => {
    const replaceText = mock(() => Promise.resolve())
    const text = mock(() => Promise.resolve())

    const handled = await routeInteraction(
      { ...interaction, callbackData: 'wizard_cancel' },
      {
        ...reply,
        text,
        replaceText,
      },
      createMockAuth(true),
    )

    expect(handled).toBe(true)
    expect(replaceText).toHaveBeenCalledWith('No active setup session. Type /setup to start.')
    expect(text).not.toHaveBeenCalled()
  })

  test('replies with no active session when wizard_restart clicked without active wizard', async () => {
    const replies: string[] = []
    const handled = await routeInteraction(
      { ...interaction, callbackData: 'wizard_restart' },
      {
        ...reply,
        text: captureReplyText(replies),
      },
      createMockAuth(true),
    )

    expect(handled).toBe(true)
    expect(replies).toEqual(['No active setup session. Type /setup to start.'])
  })

  test('replies with error when unknown config callback data is received', async () => {
    const replies: string[] = []
    const handled = await routeInteraction(
      { ...interaction, callbackData: 'cfg:invalid:callback' },
      {
        ...reply,
        text: captureReplyText(replies),
      },
      createMockAuth(true),
    )

    expect(handled).toBe(true)
    expect(replies).toEqual(['This action is no longer valid. Please start over with /config.'])
  })

  test('opens plugin-owned context config editor through shared cfg callback path', async () => {
    const pluginId = 'interaction-router-plugin-context'
    registerActivePlugin(pluginId)
    const buttonReplies: string[] = []

    const handled = await routeInteraction(
      {
        ...interaction,
        callbackData: `cfg:edit:plugin:${pluginId}:api_token@${Buffer.from(interaction.user.id).toString('base64url')}`,
      },
      {
        ...reply,
        buttons: (content: string): Promise<void> => {
          buttonReplies.push(content)
          return Promise.resolve()
        },
      },
      createMockAuth(true),
    )

    expect(handled).toBe(true)
    expect(buttonReplies).toHaveLength(1)
    expect(buttonReplies[0]).toContain('Edit API Token')
    expect(buttonReplies[0]).toContain('Current value: (not set)')
  })

  test('replies with error when config editor callback cannot be handled', async () => {
    const replies: string[] = []
    const handled = await routeInteraction(
      { ...interaction, callbackData: 'cfg:save:timezone' },
      {
        ...reply,
        text: captureReplyText(replies),
      },
      createMockAuth(true),
    )

    expect(handled).toBe(true)
    expect(replies).toEqual(['This action is no longer valid. Please start over with /config.'])
  })
})
