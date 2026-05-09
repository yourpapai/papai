import { beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import type { ChatProvider, CommandHandler } from '../../src/chat/types.js'
import { registerAdminCommands } from '../../src/commands/admin.js'
import { registerClearCommand } from '../../src/commands/clear.js'
import { registerConfigCommand } from '../../src/commands/config.js'
import { addUser } from '../../src/users.js'
import {
  createAuth,
  createDmMessage,
  createGroupMessage,
  createMockChatWithCommandHandlers,
  createMockReply,
  mockLogger,
  setupTestDb,
} from '../utils/test-helpers.js'

function firstCall(calls: readonly string[]): string {
  assert(calls.length > 0, 'Expected at least one call')
  return calls[0]!
}

describe('command context restrictions', () => {
  let mockChat: ChatProvider
  let commandHandlers: Map<string, CommandHandler>
  const adminUserId = 'admin123'

  const checkAuthorization = (userId: string): boolean => {
    return userId === adminUserId
  }

  beforeEach(async () => {
    mockLogger()
    // Setup test database with migrations
    await setupTestDb()

    // Add admin user
    addUser(adminUserId, adminUserId)

    // Setup mock chat provider
    const { provider, commandHandlers: handlers } = createMockChatWithCommandHandlers()
    mockChat = provider
    commandHandlers = handlers

    // Register commands
    registerClearCommand(mockChat, checkAuthorization, adminUserId)
    registerConfigCommand(mockChat, checkAuthorization)
    registerAdminCommands(mockChat, adminUserId)
  })

  describe('/clear command', () => {
    test('rejected for non-admin in group', async () => {
      const handler = commandHandlers.get('clear')
      expect(handler).toBeDefined()

      const msg = createGroupMessage('user456', '', false, 'group1')
      const auth = createAuth('user456')

      const { reply, textCalls } = createMockReply()
      await handler!(msg, reply, auth)

      expect(firstCall(textCalls)).toBe('Only group admins can run this command.')
    })

    test('allowed for group admin in group', async () => {
      const handler = commandHandlers.get('clear')

      const msg = createGroupMessage('user456', '', true, 'group1')
      const auth = createAuth('user456', { isGroupAdmin: true })

      const { reply, textCalls } = createMockReply()
      await handler!(msg, reply, auth)

      expect(firstCall(textCalls)).toBe('Conversation history, memory, and attachments cleared.')
    })

    test('allowed for regular user in DM', async () => {
      const handler = commandHandlers.get('clear')

      const msg = createDmMessage('user456')
      // Make user authorized
      addUser('user456', adminUserId)
      const auth = createAuth('user456')
      auth.storageContextId = 'user456'

      const { reply, textCalls } = createMockReply()
      await handler!(msg, reply, auth)

      expect(firstCall(textCalls)).toBe('Conversation history, memory, and attachments cleared.')
    })
  })

  describe('/config command', () => {
    test('non-admin in group gets the DM-only admin restriction', async () => {
      const handler = commandHandlers.get('config')
      expect(handler).toBeDefined()

      const msg = createGroupMessage('user456', '', false, 'group1')
      const auth = createAuth('user456')

      const { reply, textCalls } = createMockReply()
      await handler!(msg, reply, auth)

      expect(firstCall(textCalls)).toBe(
        'Only group admins can configure group settings, and group settings are configured in direct messages with the bot.',
      )
    })

    test('group admin in group gets a DM-only redirect', async () => {
      const handler = commandHandlers.get('config')

      const msg = createGroupMessage('user456', '', true, 'group1')
      const auth = createAuth('user456', { isGroupAdmin: true })

      const { reply, textCalls } = createMockReply()
      await handler!(msg, reply, auth)

      expect(firstCall(textCalls)).toBe(
        'Group settings are configured in direct messages with the bot. Open a DM with me and run /config.',
      )
    })

    test('allowed for regular user in DM', async () => {
      const handler = commandHandlers.get('config')

      const msg = createDmMessage('user456')
      // Make user authorized
      addUser('user456', adminUserId)
      const auth = createAuth('user456')
      auth.storageContextId = 'user456'

      const { reply, buttonCalls } = createMockReply()
      await handler!(msg, reply, auth)

      expect(firstCall(buttonCalls)).toContain('What do you want to configure?')
    })
  })

  describe('/user command', () => {
    test('rejected in group', async () => {
      const handler = commandHandlers.get('user')
      expect(handler).toBeDefined()

      const msg = createGroupMessage(adminUserId, '', true, 'group1')
      msg.commandMatch = 'add user789'

      const { reply, textCalls } = createMockReply()
      await handler!(msg, reply, createAuth(adminUserId, { isBotAdmin: true, isGroupAdmin: true }))

      expect(firstCall(textCalls)).toBe('This command is only available in direct messages.')
    })

    test('allowed in DM for admin', async () => {
      const handler = commandHandlers.get('user')

      const msg = createDmMessage(adminUserId)
      msg.commandMatch = 'add user789'

      const { reply, textCalls } = createMockReply()
      await handler!(msg, reply, createAuth(adminUserId, { isBotAdmin: true }))

      expect(firstCall(textCalls)).toBe('User @user789 authorized.')
    })
  })

  describe('/users command', () => {
    test('rejected in group', async () => {
      const handler = commandHandlers.get('users')
      expect(handler).toBeDefined()

      const msg = createGroupMessage(adminUserId, '', true, 'group1')

      const { reply, textCalls } = createMockReply()
      await handler!(msg, reply, createAuth(adminUserId, { isBotAdmin: true, isGroupAdmin: true }))

      expect(firstCall(textCalls)).toBe('This command is only available in direct messages.')
    })

    test('allowed in DM for admin', async () => {
      const handler = commandHandlers.get('users')

      const msg = createDmMessage(adminUserId)

      const { reply, textCalls } = createMockReply()
      await handler!(msg, reply, createAuth(adminUserId, { isBotAdmin: true }))

      expect(firstCall(textCalls)).toContain(adminUserId)
      expect(firstCall(textCalls)).toContain('(admin)')
    })
  })
})
