import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { addAuthorizedGroup } from '../../../src/authorized-groups.js'
import type { ButtonInteractionLike } from '../../../src/chat/discord/buttons.js'
import type { CommandHandler } from '../../../src/chat/types.js'
import { addGroupMember } from '../../../src/groups.js'
import { addUser } from '../../../src/users.js'
import { createMockReply, mockLogger, setupTestDb } from '../../utils/test-helpers.js'

const stringCommandMatch = (commandMatch: string | RegExpMatchArray | null | undefined): string => {
  assert(typeof commandMatch === 'string')
  return commandMatch
}

type MockInteractionOverrides = Partial<
  Readonly<{
    userId: string
    username: string
    channelId: string
    channelType: number
    customId: string
    threadId: string
    isAdmin: boolean
  }>
>

const createMockInteraction = (overrides: MockInteractionOverrides | undefined): ButtonInteractionLike => {
  let userId = 'unauthorized-user'
  let username = 'unauthorized'
  let channelId = 'channel-123'
  let channelType = 0
  let customId = '/testcommand'
  let threadId: string | undefined
  const isAdmin = overrides !== undefined && overrides.isAdmin === true

  if (overrides !== undefined) {
    if (overrides.userId !== undefined) {
      userId = overrides.userId
    }
    if (overrides.username !== undefined) {
      username = overrides.username
    }
    if (overrides.channelId !== undefined) {
      channelId = overrides.channelId
    }
    if (overrides.channelType !== undefined) {
      channelType = overrides.channelType
    }
    if (overrides.customId !== undefined) {
      customId = overrides.customId
    }
    threadId = overrides.threadId
  }

  return {
    user: { id: userId, username, bot: false, isAdmin },
    customId,
    channelId,
    channel: {
      id: channelId,
      type: channelType,
      send: (): Promise<{ id: string; edit: () => Promise<void> }> =>
        Promise.resolve({ id: 'msg-1', edit: (): Promise<void> => Promise.resolve() }),
      sendTyping: (): Promise<void> => Promise.resolve(),
    },
    message: {
      id: 'msg-123',
      channelId,
      threadId,
    },
    deferUpdate: (): Promise<void> => Promise.resolve(),
  }
}

const requireCapturedAuth = (
  auth: { allowed: boolean; isBotAdmin: boolean; isGroupAdmin: boolean; storageContextId: string } | null,
): { allowed: boolean; isBotAdmin: boolean; isGroupAdmin: boolean; storageContextId: string } => {
  if (auth === null) {
    throw new Error('Expected captured auth to be set')
  }

  return auth
}

describe('routeButtonFallback', () => {
  const originalAdminUserId = process.env['ADMIN_USER_ID']
  let routeButtonFallback: typeof import('../../../src/chat/discord/button-dispatch.js').routeButtonFallback
  let capturedAuth: { allowed: boolean; isBotAdmin: boolean; isGroupAdmin: boolean; storageContextId: string } | null =
    null
  let commandCalled = false

  const mockCommandHandler: CommandHandler = (_msg, _reply, auth): Promise<void> => {
    commandCalled = true
    capturedAuth = {
      allowed: auth.allowed,
      isBotAdmin: auth.isBotAdmin,
      isGroupAdmin: auth.isGroupAdmin,
      storageContextId: auth.storageContextId,
    }
    return Promise.resolve()
  }

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()

    // Set admin user
    process.env['ADMIN_USER_ID'] = 'admin-123'
    addUser('admin-123', 'bot-admin', 'adminuser')

    // Import module under test
    const module = await import('../../../src/chat/discord/button-dispatch.js')
    routeButtonFallback = module.routeButtonFallback

    capturedAuth = null
    commandCalled = false
  })

  afterEach(() => {
    if (originalAdminUserId === undefined) {
      delete process.env['ADMIN_USER_ID']
    } else {
      process.env['ADMIN_USER_ID'] = originalAdminUserId
    }
    capturedAuth = null
    commandCalled = false
  })

  describe('authorization', () => {
    test('blocks unauthorized users from executing commands via buttons', async () => {
      const interaction = createMockInteraction({
        userId: 'unauthorized-user',
        username: 'hacker',
        customId: '/help',
      })
      const commands = new Map<string, CommandHandler>([['help', mockCommandHandler]])

      await routeButtonFallback(interaction, interaction.channel!, 'channel-123', 'group', 'admin-123', commands, null)

      // Unauthorized users should NOT be able to execute commands
      expect(commandCalled).toBe(false)
    })

    test('allows configured bot admin to execute commands via buttons in allowlisted groups', async () => {
      addAuthorizedGroup('channel-123', 'admin-123')

      const interaction = createMockInteraction({
        userId: 'admin-123',
        username: 'adminuser',
        customId: '/help',
      })
      const commands = new Map<string, CommandHandler>([['help', mockCommandHandler]])
      createMockReply()

      await routeButtonFallback(interaction, interaction.channel!, 'channel-123', 'group', 'admin-123', commands, null)

      expect(commandCalled).toBe(true)
      const auth = requireCapturedAuth(capturedAuth)
      expect(auth.allowed).toBe(true)
      expect(auth.isBotAdmin).toBe(true)
    })

    test('allows group members to execute commands in groups', async () => {
      addAuthorizedGroup('channel-123', 'admin-123')
      // This tests that group members (not just bot admins) can use buttons
      const groupMemberId = 'group-member'
      // Add user as group member (added by admin)
      addGroupMember('channel-123', groupMemberId, 'admin-123')

      const interaction = createMockInteraction({
        userId: groupMemberId,
        username: 'member',
        customId: '/help',
      })
      const commands = new Map<string, CommandHandler>([['help', mockCommandHandler]])
      createMockReply()

      await routeButtonFallback(interaction, interaction.channel!, 'channel-123', 'group', 'admin-123', commands, null)

      // Group members should be allowed (with isBotAdmin: false)
      expect(commandCalled).toBe(true)
      const auth = requireCapturedAuth(capturedAuth)
      expect(auth.allowed).toBe(true)
      expect(auth.isBotAdmin).toBe(false)
    })
  })

  describe('storage context', () => {
    test('uses thread-scoped storage context ID for threads', async () => {
      const authorizedUserId = 'authorized-user'
      addAuthorizedGroup('channel-123', 'admin-123')
      addUser(authorizedUserId, 'authorized', 'authorizeduser')

      const interaction = createMockInteraction({
        userId: authorizedUserId,
        username: 'authorizeduser',
        customId: '/help',
        threadId: 'thread-456',
      })
      const commands = new Map<string, CommandHandler>([['help', mockCommandHandler]])
      createMockReply()

      await routeButtonFallback(interaction, interaction.channel!, 'channel-123', 'group', 'admin-123', commands, null)

      expect(commandCalled).toBe(true)
      // For threads, storageContextId should be contextId:threadId
      expect(requireCapturedAuth(capturedAuth).storageContextId).toBe('channel-123:thread-456')
    })

    test('uses plain context ID for non-thread group messages', async () => {
      const authorizedUserId = 'authorized-user'
      addAuthorizedGroup('channel-123', 'admin-123')
      addUser(authorizedUserId, 'authorized', 'authorizeduser')

      const interaction = createMockInteraction({
        userId: authorizedUserId,
        username: 'authorizeduser',
        customId: '/help',
        // No threadId
      })
      const commands = new Map<string, CommandHandler>([['help', mockCommandHandler]])
      createMockReply()

      await routeButtonFallback(interaction, interaction.channel!, 'channel-123', 'group', 'admin-123', commands, null)

      expect(commandCalled).toBe(true)
      expect(requireCapturedAuth(capturedAuth).storageContextId).toBe('channel-123')
    })

    test('uses user ID for DM context', async () => {
      const authorizedUserId = 'authorized-user'
      addUser(authorizedUserId, 'authorized', 'authorizeduser')

      const interaction = createMockInteraction({
        userId: authorizedUserId,
        username: 'authorizeduser',
        customId: '/help',
        // DM channel
        channelType: 1,
      })
      const commands = new Map<string, CommandHandler>([['help', mockCommandHandler]])
      createMockReply()

      await routeButtonFallback(
        interaction,
        interaction.channel!,
        // In DMs, contextId is the user ID
        authorizedUserId,
        'dm',
        'admin-123',
        commands,
        null,
      )

      expect(commandCalled).toBe(true)
      expect(requireCapturedAuth(capturedAuth).storageContextId).toBe(authorizedUserId)
    })
  })

  describe('admin flags', () => {
    test('distinguishes between bot admin and group admin', async () => {
      addAuthorizedGroup('channel-123', 'admin-123')
      // A group admin who is NOT a bot admin
      const groupAdminId = 'group-admin'
      // Add as group member (not bot admin), added by admin
      addGroupMember('channel-123', groupAdminId, 'admin-123')

      const interaction = createMockInteraction({
        userId: groupAdminId,
        username: 'groupadmin',
        customId: '/help',
        // Platform admin (Discord permissions)
        isAdmin: true,
      })
      const commands = new Map<string, CommandHandler>([['help', mockCommandHandler]])
      createMockReply()

      await routeButtonFallback(interaction, interaction.channel!, 'channel-123', 'group', 'admin-123', commands, null)

      expect(commandCalled).toBe(true)
      // Should be allowed, not a bot admin, but IS a group admin
      const auth = requireCapturedAuth(capturedAuth)
      expect(auth.allowed).toBe(true)
      expect(auth.isBotAdmin).toBe(false)
      expect(auth.isGroupAdmin).toBe(true)
    })

    test('bot admin has both isBotAdmin and isGroupAdmin true in groups', async () => {
      addAuthorizedGroup('channel-123', 'admin-123')
      // The configured admin user
      const interaction = createMockInteraction({
        userId: 'admin-123',
        username: 'adminuser',
        customId: '/help',
      })
      const commands = new Map<string, CommandHandler>([['help', mockCommandHandler]])
      createMockReply()

      await routeButtonFallback(interaction, interaction.channel!, 'channel-123', 'group', 'admin-123', commands, null)

      expect(commandCalled).toBe(true)
      const auth = requireCapturedAuth(capturedAuth)
      expect(auth.isBotAdmin).toBe(true)
      expect(auth.isGroupAdmin).toBe(true)
    })
  })

  describe('non-command handling', () => {
    test('routes non-command button presses to messageHandler', async () => {
      let messageHandlerCalled = false
      const mockMessageHandler = (): Promise<void> => {
        messageHandlerCalled = true
        return Promise.resolve()
      }

      const interaction = createMockInteraction({
        userId: 'any-user',
        username: 'user',
        // Doesn't start with /
        customId: 'not-a-command',
      })
      const commands = new Map<string, CommandHandler>()

      await routeButtonFallback(
        interaction,
        interaction.channel!,
        'channel-123',
        'group',
        'admin-123',
        commands,
        mockMessageHandler,
      )

      expect(messageHandlerCalled).toBe(true)
    })

    test('ignores non-command buttons when messageHandler is null', async () => {
      const interaction = createMockInteraction({
        userId: 'any-user',
        username: 'user',
        customId: 'not-a-command',
      })
      const commands = new Map<string, CommandHandler>()

      // Should not throw
      await routeButtonFallback(interaction, interaction.channel!, 'channel-123', 'group', 'admin-123', commands, null)

      // No assertion needed - test passes if no error is thrown
      expect(true).toBe(true)
    })

    test('routes unknown commands to messageHandler', async () => {
      let messageHandlerCalled = false
      const mockMessageHandler = (): Promise<void> => {
        messageHandlerCalled = true
        return Promise.resolve()
      }

      const interaction = createMockInteraction({
        userId: 'any-user',
        username: 'user',
        customId: '/unknowncommand',
      })
      const commands = new Map<string, CommandHandler>([['help', mockCommandHandler]])

      await routeButtonFallback(
        interaction,
        interaction.channel!,
        'channel-123',
        'group',
        'admin-123',
        commands,
        mockMessageHandler,
      )

      expect(messageHandlerCalled).toBe(true)
      // Command handler should not be called
      expect(commandCalled).toBe(false)
    })
  })

  describe('command parsing', () => {
    test('parses command with arguments correctly', async () => {
      const authorizedUserId = 'authorized-user'
      addAuthorizedGroup('channel-123', 'admin-123')
      addUser(authorizedUserId, 'authorized', 'authorizeduser')

      let receivedMatch = ''
      const mockCommandWithArgs: CommandHandler = (msg): Promise<void> => {
        receivedMatch = stringCommandMatch(msg.commandMatch)
        return Promise.resolve()
      }

      const interaction = createMockInteraction({
        userId: authorizedUserId,
        username: 'authorizeduser',
        customId: '/test arg1 arg2',
      })
      const commands = new Map<string, CommandHandler>([['test', mockCommandWithArgs]])

      await routeButtonFallback(interaction, interaction.channel!, 'channel-123', 'group', 'admin-123', commands, null)

      expect(receivedMatch).toBe('arg1 arg2')
    })

    test('matches exact command without arguments', async () => {
      const authorizedUserId = 'authorized-user'
      addAuthorizedGroup('channel-123', 'admin-123')
      addUser(authorizedUserId, 'authorized', 'authorizeduser')

      let receivedMatch = 'non-empty'
      const mockCommandNoArgs: CommandHandler = (msg): Promise<void> => {
        receivedMatch = stringCommandMatch(msg.commandMatch)
        return Promise.resolve()
      }

      const interaction = createMockInteraction({
        userId: authorizedUserId,
        username: 'authorizeduser',
        customId: '/test',
      })
      const commands = new Map<string, CommandHandler>([['test', mockCommandNoArgs]])

      await routeButtonFallback(interaction, interaction.channel!, 'channel-123', 'group', 'admin-123', commands, null)

      expect(receivedMatch).toBe('')
    })
  })

  describe('text trimming', () => {
    test('trims whitespace from command text', async () => {
      const authorizedUserId = 'authorized-user'
      addAuthorizedGroup('channel-123', 'admin-123')
      addUser(authorizedUserId, 'authorized', 'authorizeduser')

      const interaction = createMockInteraction({
        userId: authorizedUserId,
        username: 'authorizeduser',
        // Extra whitespace
        customId: '  /help  ',
      })
      const commands = new Map<string, CommandHandler>([['help', mockCommandHandler]])

      await routeButtonFallback(interaction, interaction.channel!, 'channel-123', 'group', 'admin-123', commands, null)

      expect(commandCalled).toBe(true)
    })

    test('handles command with extra spaces around arguments', async () => {
      const authorizedUserId = 'authorized-user'
      addAuthorizedGroup('channel-123', 'admin-123')
      addUser(authorizedUserId, 'authorized', 'authorizeduser')

      let receivedMatch = ''
      let commandWasCalled = false
      const mockCommand: CommandHandler = (msg): Promise<void> => {
        commandWasCalled = true
        receivedMatch = stringCommandMatch(msg.commandMatch)
        return Promise.resolve()
      }

      const interaction = createMockInteraction({
        userId: authorizedUserId,
        username: 'authorizeduser',
        // Extra whitespace
        customId: '  /test   arg1   arg2  ',
      })
      const commands = new Map<string, CommandHandler>([['test', mockCommand]])

      await routeButtonFallback(interaction, interaction.channel!, 'channel-123', 'group', 'admin-123', commands, null)

      // The match is trimmed, so extra whitespace around args is preserved
      // but leading/trailing whitespace is removed
      expect(commandWasCalled).toBe(true)
      expect(receivedMatch).toBe('arg1   arg2')
    })
  })

  describe('thread handling', () => {
    test('handles thread ID from interaction message', async () => {
      const authorizedUserId = 'authorized-user'
      addAuthorizedGroup('channel-123', 'admin-123')
      addUser(authorizedUserId, 'authorized', 'authorizeduser')

      const interaction = createMockInteraction({
        userId: authorizedUserId,
        username: 'authorizeduser',
        customId: '/help',
        threadId: 'thread-789',
      })
      const commands = new Map<string, CommandHandler>([['help', mockCommandHandler]])

      await routeButtonFallback(interaction, interaction.channel!, 'channel-123', 'group', 'admin-123', commands, null)

      expect(commandCalled).toBe(true)
      expect(requireCapturedAuth(capturedAuth).storageContextId).toBe('channel-123:thread-789')
    })

    test('handles undefined thread ID', async () => {
      const authorizedUserId = 'authorized-user'
      addAuthorizedGroup('channel-123', 'admin-123')
      addUser(authorizedUserId, 'authorized', 'authorizeduser')

      const interaction = createMockInteraction({
        userId: authorizedUserId,
        username: 'authorizeduser',
        customId: '/help',
        // No threadId specified
      })
      const commands = new Map<string, CommandHandler>([['help', mockCommandHandler]])

      await routeButtonFallback(interaction, interaction.channel!, 'channel-123', 'group', 'admin-123', commands, null)

      expect(commandCalled).toBe(true)
      expect(requireCapturedAuth(capturedAuth).storageContextId).toBe('channel-123')
    })
  })

  describe('platform admin detection', () => {
    test('detects platform admin from user isAdmin property', async () => {
      addAuthorizedGroup('channel-123', 'admin-123')
      const groupMemberId = 'group-member'
      // Add as group member
      addGroupMember('channel-123', groupMemberId, 'admin-123')

      // This user has platform admin privileges
      const interaction = createMockInteraction({
        userId: groupMemberId,
        username: 'groupadmin',
        customId: '/help',
        isAdmin: true,
      })
      const commands = new Map<string, CommandHandler>([['help', mockCommandHandler]])

      await routeButtonFallback(interaction, interaction.channel!, 'channel-123', 'group', 'admin-123', commands, null)

      expect(commandCalled).toBe(true)
      expect(requireCapturedAuth(capturedAuth).isGroupAdmin).toBe(true)
    })

    test('detects platform admin from bot admin ID match', async () => {
      addAuthorizedGroup('channel-123', 'admin-123')
      // User matches adminUserId but doesn't have explicit isAdmin property
      const interaction = createMockInteraction({
        userId: 'admin-123',
        username: 'adminuser',
        customId: '/help',
        // isAdmin not set explicitly
      })
      const commands = new Map<string, CommandHandler>([['help', mockCommandHandler]])

      await routeButtonFallback(interaction, interaction.channel!, 'channel-123', 'group', 'admin-123', commands, null)

      expect(commandCalled).toBe(true)
      const auth = requireCapturedAuth(capturedAuth)
      expect(auth.isBotAdmin).toBe(true)
      expect(auth.isGroupAdmin).toBe(true)
    })
  })

  describe('createFallbackMessage', () => {
    test('creates message with empty username', async () => {
      const authorizedUserId = 'authorized-user'
      addUser(authorizedUserId, 'authorized', 'authorizeduser')

      const { createFallbackMessage } = await import('../../../src/chat/discord/button-dispatch.js')

      const interaction = createMockInteraction({
        userId: authorizedUserId,
        username: '',
        customId: '/help',
      })

      const result = createFallbackMessage(interaction, 'channel-123', 'group', false)

      expect(result.user.username).toBeNull()
    })
  })
})
