// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import type { CommandHandler } from '../../src/chat/types.js'
import { registerAdminCommands } from '../../src/commands/admin.js'
import * as schema from '../../src/db/schema.js'
import { SUPER_ADMIN_PLATFORM_ID, addAdmin } from '../../src/instances/admin-store.js'
import { addUser as addScopedUser, isAuthorized as isAuthorizedScoped, listUsers } from '../../src/users.js'
import {
  createDmMessage,
  createGroupMessage,
  createMockChatWithCommandHandlers,
  createMockChatWithHandler,
  createMockReply,
  getTestDb,
  mockLogger,
  setupTestDb,
} from '../utils/test-helpers.js'

const ADMIN_ID = 'admin-001'
const TEST_PLATFORM_ID = 'test-instance'

const addUser = (userId: string, addedBy: string, ...args: [] | [username: string]): void => {
  const username = args[0]
  addScopedUser({ userId, platformInstanceId: TEST_PLATFORM_ID, addedBy, username })
}

const addUserOnPlatform = (
  userId: string,
  platformInstanceId: string,
  addedBy: string,
  ...args: [] | [username: string]
): void => {
  const username = args[0]
  addScopedUser({ userId, platformInstanceId, addedBy, username })
}

const isAuthorized = (userId: string): boolean => isAuthorizedScoped(userId, TEST_PLATFORM_ID)

describe('Admin Commands', () => {
  let commandHandlers: Map<string, CommandHandler>

  beforeEach(async () => {
    // Register mocks
    mockLogger()
    process.env['KANEO_CLIENT_URL'] = 'https://kaneo.test'

    await setupTestDb()

    // Add admin user to DB
    addUser(ADMIN_ID, ADMIN_ID)
    addAdmin(ADMIN_ID, TEST_PLATFORM_ID)

    const { provider: mockChat, commandHandlers: handlers } = createMockChatWithCommandHandlers()
    commandHandlers = handlers
    registerAdminCommands(mockChat, ADMIN_ID)
  })

  describe('/user add', () => {
    test('adds user by numeric ID and confirms', async () => {
      const handler = commandHandlers.get('user')
      expect(handler).toBeDefined()
      const { reply, getReplies } = createMockReply()
      await handler!(createDmMessage(ADMIN_ID, 'add 123456'), reply, {
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: ADMIN_ID,
      })
      expect(getReplies()[0]).toContain('123456 authorized.')
      expect(isAuthorized('123456')).toBe(true)
    })

    test('adds user on the command source platform instance', async () => {
      addAdmin(ADMIN_ID, 'mattermost-default')
      const handler = commandHandlers.get('user')
      expect(handler).toBeDefined()
      const { reply } = createMockReply()
      await handler!({ ...createDmMessage(ADMIN_ID, 'add 123456'), platformInstanceId: 'mattermost-default' }, reply, {
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: ADMIN_ID,
      })

      expect(isAuthorizedScoped('123456', 'mattermost-default')).toBe(true)
      expect(isAuthorizedScoped('123456', TEST_PLATFORM_ID)).toBe(false)
    })

    test('allows platform-scoped admin even when they are not the bootstrap admin id', async () => {
      addAdmin('mattermost-admin', 'mattermost-default')
      const handler = commandHandlers.get('user')
      expect(handler).toBeDefined()
      const { reply, getReplies } = createMockReply()
      await handler!(
        { ...createDmMessage('mattermost-admin', 'add 444'), platformInstanceId: 'mattermost-default' },
        reply,
        {
          allowed: true,
          isBotAdmin: true,
          isGroupAdmin: false,
          storageContextId: 'mattermost-admin',
        },
      )

      expect(getReplies()[0]).toContain('444 authorized.')
      expect(isAuthorizedScoped('444', 'mattermost-default')).toBe(true)
    })

    test('adds user by @username and confirms', async () => {
      const handler = commandHandlers.get('user')
      expect(handler).toBeDefined()
      const { reply, getReplies } = createMockReply()
      await handler!(createDmMessage(ADMIN_ID, 'add @alice'), reply, {
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: ADMIN_ID,
      })
      expect(getReplies()).toEqual(['User @alice authorized.'])
      const users = listUsers()
      expect(users.some((u) => u.username === 'alice')).toBe(true)
    })

    test('does not provision username user from global Kaneo env', async () => {
      process.env['KANEO_CLIENT_URL'] = 'https://kaneo.test'
      const handler = commandHandlers.get('user')
      expect(handler).toBeDefined()
      const { reply, getReplies } = createMockReply()

      await handler!(createDmMessage(ADMIN_ID, 'add @alice'), reply, {
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: ADMIN_ID,
      })

      expect(getReplies()).toEqual(['User @alice authorized.'])
      expect(getReplies().join('\n')).not.toContain('Kaneo')
      expect(listUsers().some((u) => u.username === 'alice')).toBe(true)
    })

    test('repeated add by @username is idempotent on the command source platform instance', async () => {
      addAdmin(ADMIN_ID, 'mattermost-default')
      const handler = commandHandlers.get('user')
      expect(handler).toBeDefined()
      const { reply, getReplies } = createMockReply()
      const message = { ...createDmMessage(ADMIN_ID, 'add @alice'), platformInstanceId: 'mattermost-default' }
      const auth = {
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: ADMIN_ID,
      }

      await handler!(message, reply, auth)
      await handler!(message, reply, auth)

      expect(getReplies()).toEqual(['User @alice authorized.', 'User @alice authorized.'])
      expect(listUsers('mattermost-default').filter((user) => user.username === 'alice')).toHaveLength(1)
      expect(listUsers(TEST_PLATFORM_ID).filter((user) => user.username === 'alice')).toHaveLength(0)
    })

    test('rejects non-admin caller', async () => {
      const handler = commandHandlers.get('user')
      expect(handler).toBeDefined()
      addUser('other-user', ADMIN_ID)
      const { reply, getReplies } = createMockReply()
      await handler!(createDmMessage('other-user', 'add 999'), reply, {
        allowed: true,
        isBotAdmin: false,
        isGroupAdmin: false,
        storageContextId: 'other-user',
      })
      expect(getReplies()[0]).toBe('Only the admin can manage users.')
      expect(isAuthorized('999')).toBe(false)
    })

    test('shows usage when identifier is missing', async () => {
      const handler = commandHandlers.get('user')
      expect(handler).toBeDefined()
      const { reply, getReplies } = createMockReply()
      await handler!(createDmMessage(ADMIN_ID, 'add'), reply, {
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: ADMIN_ID,
      })
      expect(getReplies()[0]).toContain('Usage: /user add')
    })

    test('does not provision numeric user from global Kaneo env', async () => {
      const handler = commandHandlers.get('user')
      expect(handler).toBeDefined()
      const { reply, getReplies } = createMockReply()
      await handler!(createDmMessage(ADMIN_ID, 'add 12345'), reply, {
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: ADMIN_ID,
      })

      expect(getReplies()).toEqual(['User 12345 authorized.'])
      expect(isAuthorized('12345')).toBe(true)
    })

    test('skips best-effort provisioning when global Kaneo URL is unset', async () => {
      delete process.env['KANEO_CLIENT_URL']
      const handler = commandHandlers.get('user')
      expect(handler).toBeDefined()
      const { reply, getReplies } = createMockReply()
      await handler!(createDmMessage(ADMIN_ID, 'add 24680'), reply, {
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: ADMIN_ID,
      })

      expect(getReplies()).toEqual(['User 24680 authorized.'])
      expect(isAuthorized('24680')).toBe(true)
    })

    test('rejects invalid identifier format with specific error', async () => {
      const handler = commandHandlers.get('user')
      expect(handler).toBeDefined()
      const { reply, getReplies } = createMockReply()
      await handler!(createDmMessage(ADMIN_ID, 'add some@invalid!id'), reply, {
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: ADMIN_ID,
      })
      expect(getReplies()[0]).toContain('Invalid identifier')
      expect(isAuthorized('some@invalid!id')).toBe(false)
    })
  })

  describe('/user remove', () => {
    test('removes user by ID and confirms', async () => {
      addUser('999', ADMIN_ID)
      const handler = commandHandlers.get('user')
      expect(handler).toBeDefined()
      const { reply, getReplies } = createMockReply()
      await handler!(createDmMessage(ADMIN_ID, 'remove 999'), reply, {
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: ADMIN_ID,
      })
      expect(getReplies()[0]).toContain('removed')
      expect(isAuthorized('999')).toBe(false)
    })

    test('removes user only from the command source platform instance', async () => {
      addAdmin(ADMIN_ID, 'mattermost-default')
      addUserOnPlatform('999', 'mattermost-default', ADMIN_ID)
      addUser('999', ADMIN_ID)
      const handler = commandHandlers.get('user')
      expect(handler).toBeDefined()
      const { reply, getReplies } = createMockReply()
      await handler!({ ...createDmMessage(ADMIN_ID, 'remove 999'), platformInstanceId: 'mattermost-default' }, reply, {
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: ADMIN_ID,
      })

      expect(getReplies()[0]).toContain('removed')
      expect(isAuthorizedScoped('999', 'mattermost-default')).toBe(false)
      expect(isAuthorized('999')).toBe(true)
    })

    test('removes user by @username and confirms', async () => {
      addUser('placeholder-bob', ADMIN_ID, 'bob')
      const handler = commandHandlers.get('user')
      expect(handler).toBeDefined()
      const { reply, getReplies } = createMockReply()
      await handler!(createDmMessage(ADMIN_ID, 'remove @bob'), reply, {
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: ADMIN_ID,
      })
      expect(getReplies()[0]).toContain('removed')
      expect(listUsers().some((u) => u.username === 'bob')).toBe(false)
    })

    test('blocks admin from removing themselves', async () => {
      const handler = commandHandlers.get('user')
      expect(handler).toBeDefined()
      const { reply, getReplies } = createMockReply()
      await handler!(createDmMessage(ADMIN_ID, `remove ${ADMIN_ID}`), reply, {
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: ADMIN_ID,
      })
      expect(getReplies()[0]).toBe('Cannot remove the admin user.')
      expect(isAuthorized(ADMIN_ID)).toBe(true)
    })

    test('rejects non-admin caller', async () => {
      addUser('other-user', ADMIN_ID)
      addUser('victim', ADMIN_ID)
      const handler = commandHandlers.get('user')
      expect(handler).toBeDefined()
      const { reply, getReplies } = createMockReply()
      await handler!(createDmMessage('other-user', 'remove victim'), reply, {
        allowed: true,
        isBotAdmin: false,
        isGroupAdmin: false,
        storageContextId: 'other-user',
      })
      expect(getReplies()[0]).toBe('Only the admin can manage users.')
      expect(isAuthorized('victim')).toBe(true)
    })

    test('returns not found when user does not exist', async () => {
      const handler = commandHandlers.get('user')
      expect(handler).toBeDefined()
      const { reply, getReplies } = createMockReply()
      await handler!(createDmMessage(ADMIN_ID, 'remove nonexistent-user'), reply, {
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: ADMIN_ID,
      })
      expect(getReplies()[0]).toBe('User nonexistent-user not found.')
    })
  })

  describe('/users', () => {
    test('lists all authorized users', async () => {
      addUser('user-a', ADMIN_ID)
      addUser('user-b', ADMIN_ID)
      const handler = commandHandlers.get('users')
      expect(handler).toBeDefined()
      const { reply, getReplies } = createMockReply()
      await handler!(createDmMessage(ADMIN_ID, ''), reply, {
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: ADMIN_ID,
      })
      expect(getReplies()[0]).toContain('user-a')
      expect(getReplies()[0]).toContain('user-b')
    })

    test('lists only users on the command source platform instance', async () => {
      addAdmin(ADMIN_ID, 'mattermost-default')
      addUserOnPlatform('mattermost-user', 'mattermost-default', ADMIN_ID)
      addUser('legacy-user', ADMIN_ID)
      const handler = commandHandlers.get('users')
      expect(handler).toBeDefined()
      const { reply, getReplies } = createMockReply()
      await handler!({ ...createDmMessage(ADMIN_ID, ''), platformInstanceId: 'mattermost-default' }, reply, {
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: ADMIN_ID,
      })

      expect(getReplies()[0]).toContain('mattermost-user')
      expect(getReplies()[0]).not.toContain('legacy-user')
    })

    test('super-admin lists users across all platform instances', async () => {
      addAdmin('super-admin', SUPER_ADMIN_PLATFORM_ID)
      addUserOnPlatform('mattermost-user', 'mattermost-default', ADMIN_ID)
      addUser('legacy-user', ADMIN_ID)
      const handler = commandHandlers.get('users')
      expect(handler).toBeDefined()
      const { reply, getReplies } = createMockReply()
      await handler!({ ...createDmMessage('super-admin', ''), platformInstanceId: 'mattermost-default' }, reply, {
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: 'super-admin',
      })

      expect(getReplies()[0]).toContain('mattermost-user')
      expect(getReplies()[0]).toContain('legacy-user')
    })

    test('allows platform-scoped admin to list their platform users', async () => {
      addAdmin('mattermost-admin', 'mattermost-default')
      addUserOnPlatform('mattermost-user', 'mattermost-default', ADMIN_ID)
      const handler = commandHandlers.get('users')
      expect(handler).toBeDefined()
      const { reply, getReplies } = createMockReply()
      await handler!({ ...createDmMessage('mattermost-admin', ''), platformInstanceId: 'mattermost-default' }, reply, {
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: 'mattermost-admin',
      })

      expect(getReplies()[0]).toContain('mattermost-user')
    })

    test('shows empty message when no users except admin', async () => {
      // Delete all users to simulate empty state
      getTestDb().delete(schema.users).run()
      const handler = commandHandlers.get('users')
      expect(handler).toBeDefined()
      const { reply, getReplies } = createMockReply()
      await handler!(createDmMessage(ADMIN_ID, ''), reply, {
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: ADMIN_ID,
      })
      expect(getReplies()[0]).toBe('No authorized users.')
    })

    test('rejects non-admin caller', async () => {
      addUser('other-user', ADMIN_ID)
      const handler = commandHandlers.get('users')
      expect(handler).toBeDefined()
      const { reply, getReplies } = createMockReply()
      await handler!(createDmMessage('other-user', ''), reply, {
        allowed: true,
        isBotAdmin: false,
        isGroupAdmin: false,
        storageContextId: 'other-user',
      })
      expect(getReplies()[0]).toBe('Only the admin can list users.')
    })
  })

  describe('/announce', () => {
    test('sends announcement to all registered users', async () => {
      addAdmin(ADMIN_ID, 'mattermost-default')
      addUserOnPlatform(ADMIN_ID, 'mattermost-default', ADMIN_ID)
      addUserOnPlatform('user-a', 'mattermost-default', ADMIN_ID)
      addUserOnPlatform('user-b', 'mattermost-default', ADMIN_ID)
      const sentMessages: Array<{ platformInstanceId: string; userId: string; markdown: string }> = []
      const { provider: mockChat, commandHandlers: handlers } = createMockChatWithCommandHandlers({
        sendMessage: (platformInstanceId, target, markdown) => {
          sentMessages.push({ platformInstanceId, userId: target.contextId, markdown })
          return Promise.resolve()
        },
      })
      registerAdminCommands(mockChat, ADMIN_ID)
      const handler = handlers.get('announce')
      expect(handler).toBeDefined()
      const { reply, getReplies } = createMockReply()
      await handler!(
        { ...createDmMessage(ADMIN_ID, 'Hello everyone!'), platformInstanceId: 'mattermost-default' },
        reply,
        {
          allowed: true,
          isBotAdmin: true,
          isGroupAdmin: false,
          storageContextId: ADMIN_ID,
        },
      )
      // Should send to all users (admin + user-a + user-b)
      expect(sentMessages.length).toBe(3)
      expect(sentMessages.every((m) => m.markdown.includes('Hello everyone!'))).toBe(true)
      expect(sentMessages.every((m) => m.platformInstanceId === 'mattermost-default')).toBe(true)
      // Should confirm to admin
      expect(getReplies()[0]).toContain('3')
    })

    test('announces only to users on the command source platform instance', async () => {
      addAdmin(ADMIN_ID, 'mattermost-default')
      addUserOnPlatform('mattermost-user', 'mattermost-default', ADMIN_ID)
      addUser('legacy-user', ADMIN_ID)
      const sentMessages: Array<{ platformInstanceId: string; userId: string; markdown: string }> = []
      const { provider: mockChat, commandHandlers: handlers } = createMockChatWithCommandHandlers({
        sendMessage: (platformInstanceId, target, markdown) => {
          sentMessages.push({ platformInstanceId, userId: target.contextId, markdown })
          return Promise.resolve()
        },
      })
      registerAdminCommands(mockChat, ADMIN_ID)
      const handler = handlers.get('announce')
      expect(handler).toBeDefined()
      const { reply } = createMockReply()
      await handler!(
        { ...createDmMessage(ADMIN_ID, 'Hello platform!'), platformInstanceId: 'mattermost-default' },
        reply,
        {
          allowed: true,
          isBotAdmin: true,
          isGroupAdmin: false,
          storageContextId: ADMIN_ID,
        },
      )

      expect(sentMessages.map((m) => m.userId)).toEqual(['mattermost-user'])
      expect(sentMessages.every((m) => m.platformInstanceId === 'mattermost-default')).toBe(true)
    })

    test('allows platform-scoped admin to announce to their platform users', async () => {
      addAdmin('mattermost-admin', 'mattermost-default')
      addUserOnPlatform('mattermost-user', 'mattermost-default', ADMIN_ID)
      const sentMessages: Array<{ platformInstanceId: string; userId: string; markdown: string }> = []
      const { provider: mockChat, commandHandlers: handlers } = createMockChatWithCommandHandlers({
        sendMessage: (platformInstanceId, target, markdown) => {
          sentMessages.push({ platformInstanceId, userId: target.contextId, markdown })
          return Promise.resolve()
        },
      })
      registerAdminCommands(mockChat, ADMIN_ID)
      const handler = handlers.get('announce')
      expect(handler).toBeDefined()
      const { reply } = createMockReply()
      await handler!(
        { ...createDmMessage('mattermost-admin', 'Hello scoped admins'), platformInstanceId: 'mattermost-default' },
        reply,
        {
          allowed: true,
          isBotAdmin: true,
          isGroupAdmin: false,
          storageContextId: 'mattermost-admin',
        },
      )

      expect(sentMessages.map((m) => m.userId)).toEqual(['mattermost-user'])
    })

    test('rejects non-admin caller', async () => {
      addUser('other-user', ADMIN_ID)
      const handler = commandHandlers.get('announce')
      expect(handler).toBeDefined()
      const { reply, getReplies } = createMockReply()
      await handler!(createDmMessage('other-user', 'Hello'), reply, {
        allowed: true,
        isBotAdmin: false,
        isGroupAdmin: false,
        storageContextId: 'other-user',
      })
      expect(getReplies()[0]).toBe('Only the admin can send announcements.')
    })

    test('rejects in group context', async () => {
      const handler = commandHandlers.get('announce')
      expect(handler).toBeDefined()
      const { reply, getReplies } = createMockReply()
      await handler!(createGroupMessage(ADMIN_ID, 'Hello', false, 'group-1'), reply, {
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: 'group-1',
      })
      expect(getReplies()[0]).toBe('This command is only available in direct messages.')
    })

    test('shows usage when message is empty', async () => {
      const handler = commandHandlers.get('announce')
      expect(handler).toBeDefined()
      const { reply, getReplies } = createMockReply()
      await handler!(createDmMessage(ADMIN_ID, ''), reply, {
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: ADMIN_ID,
      })
      expect(getReplies()[0]).toContain('Usage:')
    })

    test('handles send failures gracefully', async () => {
      addUser('user-a', ADMIN_ID)
      addUser('user-b', ADMIN_ID)
      const sentMessages: string[] = []
      const succeed = (id: string): Promise<void> => {
        sentMessages.push(id)
        return Promise.resolve()
      }
      const perUserSend = new Map<string, (userId: string) => Promise<void>>([
        ['user-a', (_id: string): Promise<void> => Promise.reject(new Error('User blocked bot'))],
        [ADMIN_ID, succeed],
        ['user-b', succeed],
      ])
      const { mockChat, handlers } = createMockChatWithHandler((userId) => perUserSend.get(userId)!(userId))
      registerAdminCommands(mockChat, ADMIN_ID)
      const handler = handlers.get('announce')
      expect(handler).toBeDefined()
      const { reply, getReplies } = createMockReply()
      await handler!(createDmMessage(ADMIN_ID, 'Important update'), reply, {
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: ADMIN_ID,
      })
      // Should report partial success (2 out of 3 sent - admin + user-b, user-a failed)
      const replyText = getReplies()[0]
      expect(replyText).toContain('2')
      expect(replyText).toContain('1')
    })

    test('reports when no users exist', async () => {
      getTestDb().delete(schema.users).run()
      const handler = commandHandlers.get('announce')
      expect(handler).toBeDefined()
      const { reply, getReplies } = createMockReply()
      await handler!(createDmMessage(ADMIN_ID, 'Hello'), reply, {
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: ADMIN_ID,
      })
      expect(getReplies()[0]).toContain('No authorized users')
    })

    test('skips placeholder users when sending announcements', async () => {
      addUser('user-a', ADMIN_ID)
      // Add a placeholder (username-only authorization, no real platform ID)
      addUser(`placeholder-${crypto.randomUUID()}`, ADMIN_ID, 'pending-user')
      const sentUserIds: string[] = []
      const { mockChat, handlers } = createMockChatWithHandler((userId) => {
        sentUserIds.push(userId)
        return Promise.resolve()
      })
      registerAdminCommands(mockChat, ADMIN_ID)
      const handler = handlers.get('announce')
      expect(handler).toBeDefined()
      const { reply } = createMockReply()
      await handler!(createDmMessage(ADMIN_ID, 'Hello'), reply, {
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: ADMIN_ID,
      })
      // Placeholder ID should not be in sent messages
      expect(sentUserIds.every((id) => !id.startsWith('placeholder-'))).toBe(true)
      // Only admin + user-a should receive the message
      expect(sentUserIds.length).toBe(2)
    })
  })
})
