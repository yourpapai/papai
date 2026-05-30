// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import type { ChatCapability, CommandHandler } from '../../src/chat/types.js'
import { registerHelpCommand } from '../../src/commands/help.js'
import {
  createDmMessage,
  createGroupMessage,
  createMockChatWithCommandHandlers,
  mockLogger,
} from '../utils/test-helpers.js'

describe('help command', () => {
  let capturedText: string | null = null
  let lastHandler: CommandHandler | null = null

  const { provider: mockChat, commandHandlers } = createMockChatWithCommandHandlers()

  const mockReply = {
    text: (content: string): Promise<void> => {
      capturedText = content
      return Promise.resolve()
    },
    formatted: (): Promise<void> => Promise.resolve(),
    file: (): Promise<void> => Promise.resolve(),
    typing: (): void => {},
    buttons: (): Promise<void> => Promise.resolve(),
  }

  beforeEach(() => {
    mockLogger()
    capturedText = null
    lastHandler = null
    registerHelpCommand(mockChat)
    const registeredHelpHandler = commandHandlers.get('help')
    if (registeredHelpHandler === undefined) {
      throw new Error('help handler was not registered')
    }
    lastHandler = registeredHelpHandler
  })

  test('DM help shows user management commands for admin', async () => {
    const dmMsg = createDmMessage('user1', '/help')

    const auth = {
      allowed: true,
      isBotAdmin: true,
      isGroupAdmin: false,
      storageContextId: 'user1',
    }

    await lastHandler!(dmMsg, mockReply, auth)

    expect(capturedText).toContain('/user add')
    expect(capturedText).toContain('/user remove')
    expect(capturedText).toContain('/users')
    expect(capturedText).toContain('/group add <group-id>')
    expect(capturedText).toContain('/group remove <group-id>')
    expect(capturedText).toContain('/groups')
    expect(capturedText).toContain('/config')
    expect(capturedText).toContain('/clear')
    expect(capturedText).toContain('/context')
  })

  test('DM help shows /config and core commands for non-admin users', async () => {
    const dmMsg = createDmMessage('user1', '/help')

    const auth = {
      allowed: true,
      isBotAdmin: false,
      isGroupAdmin: false,
      storageContextId: 'user1',
    }

    await lastHandler!(dmMsg, mockReply, auth)

    expect(capturedText).toContain('/help')
    expect(capturedText).not.toContain('/setup')
    expect(capturedText).toContain('/config — View or edit personal settings, or choose a group to configure from DM')
    expect(capturedText).toContain('/clear')
    expect(capturedText).toContain('/context')
    expect(capturedText).not.toContain('/user add')
    expect(capturedText).not.toContain('Admin commands:')
  })

  test('Group help shows group commands', async () => {
    const groupMsg = createGroupMessage('user1', '/help', false, 'group1')

    const auth = {
      allowed: true,
      isBotAdmin: false,
      isGroupAdmin: false,
      storageContextId: 'group1',
    }

    await lastHandler!(groupMsg, mockReply, auth)

    expect(capturedText).toContain('/group adduser <user-id|@username>')
    expect(capturedText).toContain('/group deluser <user-id|@username>')
    expect(capturedText).toContain('/group users')
    expect(capturedText).toContain('@botname')
    // Not shown to regular members
    expect(capturedText).not.toContain('/setup')
    expect(capturedText).not.toContain('Admin commands:')
    expect(capturedText).not.toContain('/config')
  })

  test('Group admin help no longer advertises in-group /setup or /config', async () => {
    const groupMsg = createGroupMessage('admin1', '/help', true, 'group1')

    const auth = {
      allowed: true,
      isBotAdmin: false,
      isGroupAdmin: true,
      storageContextId: 'group1',
    }

    await lastHandler!(groupMsg, mockReply, auth)

    expect(capturedText).toContain('Group settings are configured in DM with the bot')
    expect(capturedText).toContain('The group must be authorized before it can use the bot in the group chat.')
    expect(capturedText).not.toContain('/setup')
    expect(capturedText).not.toContain('/config — View group configuration')
    expect(capturedText).toContain('/clear')
    expect(capturedText).toContain('Admin commands:')
  })
})

describe('buildHelpText', () => {
  test('/help in DM includes /context for non-admin users', async () => {
    const { buildHelpText } = await import('../../src/commands/help.js')
    const helpText = buildHelpText(new Set<ChatCapability>(['messages.buttons']), 'dm', {
      isBotAdmin: false,
      isGroupAdmin: false,
    })

    expect(helpText).toContain('/context')
    expect(helpText).not.toContain('Admin commands:')
  })

  test('/help on provider without file support does not append stale /context deferral note for admin', async () => {
    const { buildHelpText } = await import('../../src/commands/help.js')
    const noFileCapabilities = new Set<ChatCapability>(['interactions.callbacks', 'messages.buttons', 'users.resolve'])
    const noFileHelp = buildHelpText(noFileCapabilities, 'dm', {
      isBotAdmin: true,
      isGroupAdmin: false,
    })

    expect(noFileHelp).toContain('/context')
    expect(noFileHelp).not.toContain('deferred')
  })

  test('/help on provider without file support still mentions /context for non-admin', async () => {
    const { buildHelpText } = await import('../../src/commands/help.js')
    const noFileCapabilities = new Set<ChatCapability>(['interactions.callbacks', 'messages.buttons'])
    const noFileHelp = buildHelpText(noFileCapabilities, 'dm', {
      isBotAdmin: false,
      isGroupAdmin: false,
    })
    expect(noFileHelp).toContain('/context')
    expect(noFileHelp).not.toContain('deferred')
  })

  test('/help on provider with file support does not contain stale deferral note', async () => {
    const { buildHelpText } = await import('../../src/commands/help.js')
    const fileCapabilities = new Set<ChatCapability>(['interactions.callbacks', 'messages.buttons', 'messages.files'])
    const fileHelp = buildHelpText(fileCapabilities, 'dm', {
      isBotAdmin: true,
      isGroupAdmin: false,
    })
    expect(fileHelp).not.toContain('deferred')
  })
})
