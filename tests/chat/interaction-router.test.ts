// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { eq } from 'drizzle-orm'

import { addAuthorizedGroup, removeAuthorizedGroup } from '../../src/authorized-groups.js'
import { routeInteraction } from '../../src/chat/interaction-router.js'
import type { AuthorizationResult, IncomingInteraction, ReplyFn } from '../../src/chat/types.js'
import { handleEditorMessage } from '../../src/config-editor/handlers.js'
import { createEditorSession, deleteEditorSession } from '../../src/config-editor/state.js'
import { getConfig, setConfig } from '../../src/config.js'
import { upsertGroupAdminObservation, upsertKnownGroupContext } from '../../src/group-settings/registry.js'
import {
  createGroupSettingsSession,
  deleteGroupSettingsSession,
  getActiveGroupSettingsTarget,
} from '../../src/group-settings/state.js'
import { setKaneoWorkspace } from '../../src/users.js'
import { deleteWizardSession } from '../../src/wizard/state.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const interaction: IncomingInteraction = {
  kind: 'button',
  user: { id: 'user-1', username: 'alice', isAdmin: false },
  contextId: 'ctx-1',
  contextType: 'dm',
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
  upsertKnownGroupContext({
    contextId: 'group-9',
    provider: 'telegram',
    displayName: 'Operations',
    parentName: 'Platform',
  })
  upsertGroupAdminObservation({
    provider: 'telegram',
    contextId: 'group-9',
    userId,
    username: interaction.user.username,
    isAdmin: true,
  })
  addAuthorizedGroup('group-9', 'admin-1')
  createGroupSettingsSession({
    userId,
    command,
    stage: 'active',
    targetContextId: 'group-9',
  })
}

describe('routeInteraction', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    deleteWizardSession(interaction.user.id, interaction.contextId)
    deleteEditorSession(interaction.user.id, interaction.contextId)
    deleteEditorSession(interaction.user.id, 'group-9')
    deleteGroupSettingsSession(interaction.user.id)
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
    })

    expect(handled).toBe(true)
    expect(calls).toEqual(['cfg'])
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

  test('returns false for unrecognized callback prefixes', async () => {
    const handled = await routeInteraction(
      { ...interaction, callbackData: 'unknown:action' },
      reply,
      createMockAuth(true),
      {
        handleGroupSettingsInteraction: () => Promise.resolve(false),
        handleConfigInteraction: () => Promise.resolve(false),
        handleWizardInteraction: () => Promise.resolve(false),
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
    createEditorSession({
      userId: interaction.user.id,
      storageContextId: 'group-9',
      editingKey: 'timezone',
    })

    const buttonReplies: string[] = []
    const handled = await routeInteraction(
      { ...interaction, callbackData: 'cfg:cancel' },
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

    const db = (await import('../../src/db/drizzle.js')).getDrizzleDb()
    const { groupAdminObservations } = await import('../../src/db/schema.js')
    db.delete(groupAdminObservations).where(eq(groupAdminObservations.contextId, 'group-9')).run()

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
    expect(replies).toEqual([
      'You are no longer recognized as an admin for that group. Run /config or /setup again to choose a different target.',
    ])
    expect(getActiveGroupSettingsTarget(interaction.user.id)).toBeNull()
  })

  test('clears stale active DM-selected group target when cfg callback allowlist access is lost', async () => {
    setupAuthorizedGroupForUser(interaction.user.id, 'config')

    expect(removeAuthorizedGroup('group-9')).toBe(true)

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
    expect(replies).toEqual([
      'That group is no longer authorized for bot use. Ask the bot admin to run `/group add <group-id>` in DM, then run /config or /setup again.',
    ])
    expect(getActiveGroupSettingsTarget(interaction.user.id)).toBeNull()
  })

  test('blocks encoded cfg callback target when admin access is removed', async () => {
    setupAuthorizedGroupForUser(interaction.user.id, 'config')

    const db = (await import('../../src/db/drizzle.js')).getDrizzleDb()
    const { groupAdminObservations } = await import('../../src/db/schema.js')
    db.delete(groupAdminObservations).where(eq(groupAdminObservations.contextId, 'group-9')).run()

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
    db.delete(groupAdminObservations).where(eq(groupAdminObservations.contextId, 'group-9')).run()

    createEditorSession({
      userId: interaction.user.id,
      storageContextId: interaction.user.id,
      editingKey: 'timezone',
    })

    const buttonReplies: string[] = []
    const handled = await routeInteraction(
      {
        ...interaction,
        callbackData: `cfg:cancel@${Buffer.from(interaction.user.id).toString('base64url')}`,
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

  test('prefers replaceButtons for cfg callback responses with buttons when available', async () => {
    createEditorSession({
      userId: interaction.user.id,
      storageContextId: interaction.storageContextId,
      editingKey: 'timezone',
    })

    const replaceButtons = mock(() => Promise.resolve())
    const buttons = mock(() => Promise.resolve())

    const handled = await routeInteraction(
      { ...interaction, callbackData: 'cfg:cancel' },
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
    createEditorSession({
      userId: interaction.user.id,
      storageContextId: 'group-9',
      editingKey: 'timezone',
    })
    handleEditorMessage(interaction.user.id, 'group-9', 'Europe/Berlin')

    await routeInteraction({ ...interaction, callbackData: 'cfg:save:timezone' }, reply, createMockAuth(true))

    expect(getConfig('group-9', 'timezone')).toBe('Europe/Berlin')
    expect(getConfig(interaction.user.id, 'timezone')).toBeNull()
  })

  test('starts setup for the selected group target', async () => {
    upsertKnownGroupContext({
      contextId: 'group-9',
      provider: 'telegram',
      displayName: 'Operations',
      parentName: 'Platform',
    })
    addAuthorizedGroup('group-9', 'admin-1')
    setConfig('group-9', 'kaneo_apikey', 'test-kaneo-key')
    setKaneoWorkspace('group-9', 'workspace-9')
    upsertGroupAdminObservation({
      provider: 'telegram',
      contextId: 'group-9',
      userId: interaction.user.id,
      username: interaction.user.username,
      isAdmin: true,
    })
    createGroupSettingsSession({
      userId: interaction.user.id,
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
    db.delete(groupAdminObservations).where(eq(groupAdminObservations.contextId, 'group-9')).run()

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
