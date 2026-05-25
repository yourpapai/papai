// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import type { AuthorizationResult, ChatProvider, CommandHandler, ResolveUserContext } from '../../src/chat/types.js'
import { registerGroupCommand } from '../../src/commands/group.js'
import { checkAuthorizationExtended } from '../../src/auth.js'
import { toScopedContextId } from '../../src/chat/scoped-context.js'
import { upsertGroupUserObservation, upsertKnownGroupContext } from '../../src/group-settings/registry.js'
import {
  createAuth,
  createDmMessage,
  createGroupMessage,
  createMockChat,
  createMockReply,
  mockLogger,
  setupTestDb,
  TELEGRAM_LIKE_CAPABILITIES,
} from '../utils/test-helpers.js'

const getFirstReply = (textCalls: readonly string[]): string | null => {
  const firstReply = textCalls[0]
  if (firstReply === undefined) {
    return null
  }
  return firstReply
}

const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
}

const createGroupStorageAuth = (contextId: string, ...args: [] | [Parameters<typeof createAuth>[1]]): AuthorizationResult => {
  const options = args[0]
  if (options === undefined) {
    return {
      ...createAuth(contextId, {}),
      configContextId: contextId,
    }
  }
  return {
    ...createAuth(contextId, options),
    configContextId: contextId,
  }
}

// Label-lookup helpers defined outside test blocks — required by no-conditional-in-test
function resolveGroupLabelByKnownId(groupId: string): Promise<string | null> {
  if (groupId === 'group-123') return Promise.resolve('Engineering Chat')
  return Promise.resolve(null)
}

function resolveUserLabelForAdmin1(userId: string): Promise<string | null> {
  if (userId === 'admin1') return Promise.resolve('John Johnson (@itsmike)')
  return Promise.resolve(null)
}

function resolveUserLabelByContextId(userId: string, context: ResolveUserContext | undefined): Promise<string | null> {
  if (userId !== 'admin1') return Promise.resolve(null)
  if (context !== undefined && context.contextId === 'group-123') return Promise.resolve('Alice One (@admin1)')
  if (context !== undefined && context.contextId === 'group-456') return Promise.resolve('Alice Two (@admin1)')
  return Promise.resolve(null)
}

function resolveUserLabelForMembersAndAdder(userId: string): Promise<string | null> {
  if (userId === 'user1') return Promise.resolve('John Johnson (@itsmike)')
  if (userId === 'admin1') return Promise.resolve('Jane Admin (@janeadmin)')
  return Promise.resolve(null)
}

const createBlockingLabelLookup = (): {
  readonly lookup: () => Promise<string | null>
  readonly getMaxInFlight: () => number
  readonly stopBlocking: () => void
  readonly releaseAll: () => void
} => {
  let shouldBlock = true
  let inFlight = 0
  let maxInFlight = 0
  let releases: Array<() => void> = []

  return {
    lookup: () => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)

      if (!shouldBlock) {
        inFlight -= 1
        return Promise.resolve(null)
      }

      return new Promise((resolve) => {
        releases = [
          ...releases,
          (): void => {
            inFlight -= 1
            resolve(null)
          },
        ]
      })
    },
    getMaxInFlight: () => maxInFlight,
    stopBlocking: () => {
      shouldBlock = false
    },
    releaseAll: () => {
      const currentReleases = releases
      releases = []
      currentReleases.forEach((release) => {
        release()
      })
    },
  }
}

describe('group commands', () => {
  let mockChat: ChatProvider
  let commandHandlers: Map<string, CommandHandler>
  let lastReply: string | null

  beforeEach(async () => {
    mockLogger()
    // Setup test database with migrations
    await setupTestDb()

    // Setup mock chat provider with custom resolveUserId
    commandHandlers = new Map()
    mockChat = createMockChat({
      commandHandlers,
      resolveUserId: (username: string, _context): Promise<string | null> => {
        const clean = username.startsWith('@') ? username.slice(1) : username
        if (clean === 'user1') return Promise.resolve('user1_id')
        if (clean === 'user2') return Promise.resolve('user2_id')
        if (/^\d+$/u.test(clean)) return Promise.resolve(clean)
        return Promise.resolve(null)
      },
    })

    // Register the group command
    registerGroupCommand(mockChat)

    lastReply = null
  })

  describe('adduser', () => {
    test('adds user when admin', async () => {
      const handler = commandHandlers.get('group')
      expect(handler).toBeDefined()

      const { reply, textCalls } = createMockReply()
      await handler!(
        createGroupMessage('admin1', 'adduser @user1', true),
        reply,
        createGroupStorageAuth('group1', { isGroupAdmin: true }),
      )

      lastReply = getFirstReply(textCalls)
      expect(lastReply).toBe('User @user1 added to this group.')
    })

    test('rejects non-admins', async () => {
      const handler = commandHandlers.get('group')

      const { reply, textCalls } = createMockReply()
      await handler!(createGroupMessage('user1', 'adduser @user2', false), reply, createGroupStorageAuth('group1'))

      lastReply = getFirstReply(textCalls)
      expect(lastReply).toBe('Only group admins can add users.')
    })

    test('requires username argument', async () => {
      const handler = commandHandlers.get('group')

      const { reply, textCalls } = createMockReply()
      await handler!(createGroupMessage('admin1', 'adduser', true), reply, createGroupStorageAuth('group1', { isGroupAdmin: true }))

      lastReply = getFirstReply(textCalls)
      expect(lastReply).toBe('Usage: /group adduser <user-id|@username>')
    })

    test('rejects invalid user format', async () => {
      const handler = commandHandlers.get('group')

      const { reply, textCalls } = createMockReply()
      await handler!(
        createGroupMessage('admin1', 'adduser invalid@user', true),
        reply,
        createGroupStorageAuth('group1', { isGroupAdmin: true }),
      )

      lastReply = getFirstReply(textCalls)
      expect(lastReply).toBe('Please provide a valid user mention or ID.')
    })

    test('accepts numeric user ID', async () => {
      const handler = commandHandlers.get('group')

      const { reply, textCalls } = createMockReply()
      await handler!(
        createGroupMessage('admin1', 'adduser 12345', true),
        reply,
        createGroupStorageAuth('group1', { isGroupAdmin: true }),
      )

      lastReply = getFirstReply(textCalls)
      expect(lastReply).toBe('User 12345 added to this group.')
    })

    test('adduser persists member in DB', async () => {
      const handler = commandHandlers.get('group')
      expect(handler).toBeDefined()

      const { reply } = createMockReply()
      await handler!(
        createGroupMessage('admin1', 'adduser @user1', true),
        reply,
        createGroupStorageAuth('group1', { isGroupAdmin: true }),
      )

      const { listGroupMembers } = await import('../../src/groups.js')
      const members = listGroupMembers('group1')
      // Should store the resolved ID, not the username
      expect(members.some((m) => m.user_id === 'user1_id')).toBe(true)
    })

    test('resolves username to user ID before storing', async () => {
      const handler = commandHandlers.get('group')
      expect(handler).toBeDefined()

      const { reply } = createMockReply()
      await handler!(
        createGroupMessage('admin1', 'adduser @user2', true),
        reply,
        createGroupStorageAuth('group1', { isGroupAdmin: true }),
      )

      const { listGroupMembers } = await import('../../src/groups.js')
      const members = listGroupMembers('group1')
      // Should store the resolved ID, not the username
      expect(members.some((m) => m.user_id === 'user2_id')).toBe(true)
      expect(members.some((m) => m.user_id === 'user2')).toBe(false)
    })

    test('handles unresolved username gracefully', async () => {
      const handler = commandHandlers.get('group')
      expect(handler).toBeDefined()

      const { reply, textCalls } = createMockReply()
      await handler!(
        createGroupMessage('admin1', 'adduser @unknown_user', true),
        reply,
        createGroupStorageAuth('group1', { isGroupAdmin: true }),
      )

      // With users.resolve capability but null result, should error not fall back
      lastReply = getFirstReply(textCalls)
      expect(lastReply).toBe("Couldn't resolve that username. Use an explicit user ID.")

      // No member should have been added
      const { listGroupMembers } = await import('../../src/groups.js')
      const members = listGroupMembers('group1')
      expect(members.some((m) => m.user_id === 'unknown_user')).toBe(false)
    })

    test('passes msg context and platform instance into ChatProvider.resolveUserId', async () => {
      let lastResolveContext: ResolveUserContext | null = null
      const contextHandlers = new Map<string, CommandHandler>()
      const contextChat = createMockChat({
        commandHandlers: contextHandlers,
        resolveUserId: (_username: string, context: ResolveUserContext): Promise<string | null> => {
          lastResolveContext = context
          return Promise.resolve('resolved-id')
        },
      })
      registerGroupCommand(contextChat)
      const handler = contextHandlers.get('group')
      expect(handler).toBeDefined()

      const { reply } = createMockReply()
      await handler!(
        createGroupMessage('admin1', 'adduser @alice', true, 'channel-42'),
        reply,
        createGroupStorageAuth('group1', { isGroupAdmin: true }),
      )

      expect(lastResolveContext).not.toBeNull()
      expect(lastResolveContext!.contextId).toBe('channel-42')
      expect(lastResolveContext!.contextType).toBe('group')
      expect(lastResolveContext!.platformInstanceId).toBe('test-instance')
    })
  })

  describe('deluser', () => {
    test('removes user when admin', async () => {
      // First add a user
      const { addGroupMember } = await import('../../src/groups.js')
      addGroupMember('group1', 'user1', 'admin1')

      const handler = commandHandlers.get('group')

      const { reply, textCalls } = createMockReply()
      await handler!(
        createGroupMessage('admin1', 'deluser user1', true),
        reply,
        createGroupStorageAuth('group1', { isGroupAdmin: true }),
      )

      lastReply = getFirstReply(textCalls)
      expect(lastReply).toBe('User user1 removed from this group.')
    })

    test('rejects non-admins', async () => {
      const handler = commandHandlers.get('group')

      const { reply, textCalls } = createMockReply()
      await handler!(createGroupMessage('user1', 'deluser user2', false), reply, createGroupStorageAuth('group1'))

      lastReply = getFirstReply(textCalls)
      expect(lastReply).toBe('Only group admins can remove users.')
    })

    test('requires username argument', async () => {
      const handler = commandHandlers.get('group')

      const { reply, textCalls } = createMockReply()
      await handler!(createGroupMessage('admin1', 'deluser', true), reply, createGroupStorageAuth('group1', { isGroupAdmin: true }))

      lastReply = getFirstReply(textCalls)
      expect(lastReply).toBe('Usage: /group deluser <user-id|@username>')
    })

    test('rejects invalid user format', async () => {
      const handler = commandHandlers.get('group')

      const { reply, textCalls } = createMockReply()
      await handler!(
        createGroupMessage('admin1', 'deluser invalid@user', true),
        reply,
        createGroupStorageAuth('group1', { isGroupAdmin: true }),
      )

      lastReply = getFirstReply(textCalls)
      expect(lastReply).toBe('Please provide a valid user mention or ID.')
    })

    test('handles non-existent user gracefully', async () => {
      const handler = commandHandlers.get('group')

      const { reply, textCalls } = createMockReply()
      await handler!(
        createGroupMessage('admin1', 'deluser nonexistent', true),
        reply,
        createGroupStorageAuth('group1', { isGroupAdmin: true }),
      )

      lastReply = getFirstReply(textCalls)
      expect(lastReply).toBe('User nonexistent removed from this group.')
    })

    test('deluser removes member from DB', async () => {
      const { addGroupMember, listGroupMembers, isGroupMember } = await import('../../src/groups.js')
      addGroupMember('group1', 'user1', 'admin1')

      const handler = commandHandlers.get('group')
      expect(handler).toBeDefined()

      const { reply } = createMockReply()
      await handler!(
        createGroupMessage('admin1', 'deluser user1', true),
        reply,
        createGroupStorageAuth('group1', { isGroupAdmin: true }),
      )

      const members = listGroupMembers('group1')
      expect(members.some((m) => m.user_id === 'user1')).toBe(false)
      expect(isGroupMember('group1', 'user1')).toBe(false)
    })
  })

  describe('users', () => {
    test('group members are isolated by platform-scoped context id', async () => {
      const telegramGroup = createGroupMessage('admin', 'adduser user-1', true, 'shared-group')
      telegramGroup.platformInstanceId = 'telegram-default'
      const discordGroup = createGroupMessage('admin', 'users', true, 'shared-group')
      discordGroup.platformInstanceId = 'discord-default'
      const telegramAuth: AuthorizationResult = {
        allowed: true,
        isBotAdmin: false,
        isGroupAdmin: true,
        storageContextId: 'pi:dGVsZWdyYW0tZGVmYXVsdA:ctx:c2hhcmVkLWdyb3Vw',
        configContextId: 'pi:dGVsZWdyYW0tZGVmYXVsdA:ctx:c2hhcmVkLWdyb3Vw',
      }
      const discordAuth: AuthorizationResult = {
        allowed: true,
        isBotAdmin: false,
        isGroupAdmin: true,
        storageContextId: 'pi:ZGlzY29yZC1kZWZhdWx0:ctx:c2hhcmVkLWdyb3Vw',
        configContextId: 'pi:ZGlzY29yZC1kZWZhdWx0:ctx:c2hhcmVkLWdyb3Vw',
      }
      const telegramReply = createMockReply()
      const discordReply = createMockReply()
      const handler = commandHandlers.get('group')
      expect(handler).toBeDefined()

      await handler!(telegramGroup, telegramReply.reply, telegramAuth)
      await handler!(discordGroup, discordReply.reply, discordAuth)

      expect(discordReply.textCalls.at(-1)).toBe('No members in this group yet.')
    })

    test('lists empty group', async () => {
      const handler = commandHandlers.get('group')

      const { reply, textCalls } = createMockReply()
      await handler!(createGroupMessage('user1', 'users', false), reply, createGroupStorageAuth('group1'))

      lastReply = getFirstReply(textCalls)
      expect(lastReply).toBe('No members in this group yet.')
    })

    test('lists group members', async () => {
      // Add some users
      const { addGroupMember } = await import('../../src/groups.js')
      addGroupMember('group1', 'user1', 'admin1')
      addGroupMember('group1', 'user2', 'admin1')

      const handler = commandHandlers.get('group')

      const { reply, textCalls } = createMockReply()
      await handler!(createGroupMessage('user1', 'users', false), reply, createGroupStorageAuth('group1'))

      lastReply = getFirstReply(textCalls)
      expect(lastReply).toContain('Group members:')
      expect(lastReply).toContain('user1')
      expect(lastReply).toContain('user2')
      expect(lastReply).toContain('added by admin1')
    })

    test('accessible to any member (not just admins)', async () => {
      const { addGroupMember } = await import('../../src/groups.js')
      addGroupMember('group1', 'user1', 'admin1')

      const handler = commandHandlers.get('group')

      const { reply, textCalls } = createMockReply()
      await handler!(createGroupMessage('user1', 'users', false), reply, createGroupStorageAuth('group1'))

      lastReply = getFirstReply(textCalls)
      expect(lastReply).toContain('Group members:')
    })
  })

  describe('context validation', () => {
    test('rejects non-admin DM add', async () => {
      const handler = commandHandlers.get('group')

      const { reply, textCalls } = createMockReply()
      await handler!(createDmMessage('user1', 'add group-123'), reply, createAuth('user1'))

      lastReply = getFirstReply(textCalls)
      expect(lastReply).toBe('Only bot admins can manage authorized groups.')
    })

    test('rejects non-admin DM list', async () => {
      const groupsHandler = commandHandlers.get('groups')
      expect(groupsHandler).toBeDefined()

      const { reply, textCalls } = createMockReply()
      await groupsHandler!(createDmMessage('user1'), reply, createAuth('user1'))

      lastReply = getFirstReply(textCalls)
      expect(lastReply).toBe('Only bot admins can list authorized groups.')
    })
  })

  describe('DM admin group authorization', () => {
    test('registers separate /groups command', () => {
      expect(commandHandlers.has('groups')).toBe(true)
    })

    test('adds an authorized group in DM for bot admin', async () => {
      const handler = commandHandlers.get('group')
      expect(handler).toBeDefined()

      const { reply, textCalls } = createMockReply()
      await handler!(createDmMessage('admin1', 'add group-123'), reply, createAuth('admin1', { isBotAdmin: true }))

      expect(textCalls[0]).toBe('Group group-123 authorized.')

      const { isAuthorizedGroup } = await import('../../src/authorized-groups.js')
      expect(isAuthorizedGroup(toScopedContextId({ platformInstanceId: 'test-instance', nativeContextId: 'group-123' }))).toBe(true)
    })

    test('adds native group id as platform-scoped authorized group in DM', async () => {
      const handler = commandHandlers.get('group')
      const scopedGroupId = toScopedContextId({ platformInstanceId: 'telegram-default', nativeContextId: 'shared-group' })
      expect(handler).toBeDefined()

      const message = createDmMessage('admin1', 'add shared-group')
      message.platformInstanceId = 'telegram-default'
      const { reply, textCalls } = createMockReply()
      await handler!(message, reply, createAuth('admin1', { isBotAdmin: true }))

      expect(textCalls[0]).toBe('Group shared-group authorized.')
      const { isAuthorizedGroup } = await import('../../src/authorized-groups.js')
      expect(isAuthorizedGroup(scopedGroupId)).toBe(true)
      const auth = checkAuthorizationExtended('platform-admin', null, 'shared-group', 'group', undefined, true, 'telegram-default')
      expect(auth.allowed).toBe(true)
    })

    test('adds already-scoped group id without double scoping in DM', async () => {
      const handler = commandHandlers.get('group')
      const scopedGroupId = toScopedContextId({ platformInstanceId: 'telegram-default', nativeContextId: 'shared-group' })
      expect(handler).toBeDefined()

      const message = createDmMessage('admin1', `add ${scopedGroupId}`)
      message.platformInstanceId = 'telegram-default'
      const { reply, textCalls } = createMockReply()
      await handler!(message, reply, createAuth('admin1', { isBotAdmin: true }))

      expect(textCalls[0]).toBe(`Group ${scopedGroupId} authorized.`)
      const { isAuthorizedGroup } = await import('../../src/authorized-groups.js')
      expect(isAuthorizedGroup(scopedGroupId)).toBe(true)
      expect(
        isAuthorizedGroup(toScopedContextId({ platformInstanceId: 'telegram-default', nativeContextId: scopedGroupId })),
      ).toBe(false)
    })

    test('removes an authorized group in DM for bot admin', async () => {
      const { addAuthorizedGroup, isAuthorizedGroup } = await import('../../src/authorized-groups.js')
      const scopedGroupId = toScopedContextId({ platformInstanceId: 'test-instance', nativeContextId: 'group-123' })
      addAuthorizedGroup(scopedGroupId, 'admin1')

      const handler = commandHandlers.get('group')
      expect(handler).toBeDefined()

      const { reply, textCalls } = createMockReply()
      await handler!(createDmMessage('admin1', 'remove group-123'), reply, createAuth('admin1', { isBotAdmin: true }))

      expect(textCalls[0]).toBe('Group group-123 removed.')
      expect(isAuthorizedGroup(scopedGroupId)).toBe(false)
    })

    test('removes native group id as platform-scoped authorized group in DM', async () => {
      const { addAuthorizedGroup, isAuthorizedGroup } = await import('../../src/authorized-groups.js')
      const scopedGroupId = toScopedContextId({ platformInstanceId: 'telegram-default', nativeContextId: 'shared-group' })
      addAuthorizedGroup(scopedGroupId, 'admin1')
      const handler = commandHandlers.get('group')
      expect(handler).toBeDefined()

      const message = createDmMessage('admin1', 'remove shared-group')
      message.platformInstanceId = 'telegram-default'
      const { reply, textCalls } = createMockReply()
      await handler!(message, reply, createAuth('admin1', { isBotAdmin: true }))

      expect(textCalls[0]).toBe('Group shared-group removed.')
      expect(isAuthorizedGroup(scopedGroupId)).toBe(false)
    })

    test('removes already-scoped group id without double scoping in DM', async () => {
      const { addAuthorizedGroup, isAuthorizedGroup } = await import('../../src/authorized-groups.js')
      const scopedGroupId = toScopedContextId({ platformInstanceId: 'telegram-default', nativeContextId: 'shared-group' })
      addAuthorizedGroup(scopedGroupId, 'admin1')
      const handler = commandHandlers.get('group')
      expect(handler).toBeDefined()

      const message = createDmMessage('admin1', `remove ${scopedGroupId}`)
      message.platformInstanceId = 'telegram-default'
      const { reply, textCalls } = createMockReply()
      await handler!(message, reply, createAuth('admin1', { isBotAdmin: true }))

      expect(textCalls[0]).toBe(`Group ${scopedGroupId} removed.`)
      expect(isAuthorizedGroup(scopedGroupId)).toBe(false)
    })

    test('reports when removing a group that was not authorized', async () => {
      const handler = commandHandlers.get('group')
      expect(handler).toBeDefined()

      const { reply, textCalls } = createMockReply()
      await handler!(
        createDmMessage('admin1', 'remove missing-group'),
        reply,
        createAuth('admin1', { isBotAdmin: true }),
      )

      expect(textCalls[0]).toBe('Group missing-group was not authorized.')
    })

    test('lists authorized groups via /groups for bot admin in DM', async () => {
      const { addAuthorizedGroup } = await import('../../src/authorized-groups.js')
      addAuthorizedGroup('group-123', 'admin1')
      addAuthorizedGroup('group-456', 'admin2')

      const groupsHandler = commandHandlers.get('groups')
      expect(groupsHandler).toBeDefined()

      const { reply, textCalls } = createMockReply()
      await groupsHandler!(createDmMessage('admin1'), reply, createAuth('admin1', { isBotAdmin: true }))

      expect(textCalls[0]).toContain('Authorized groups:')
      expect(textCalls[0]).toContain('group-123')
      expect(textCalls[0]).toContain('group-456')
    })

    test('shows empty authorized group list via /groups', async () => {
      const groupsHandler = commandHandlers.get('groups')
      expect(groupsHandler).toBeDefined()

      const { reply, textCalls } = createMockReply()
      await groupsHandler!(createDmMessage('admin1'), reply, createAuth('admin1', { isBotAdmin: true }))

      expect(textCalls[0]).toBe('No authorized groups.')
    })

    test('requires group id for DM add', async () => {
      const handler = commandHandlers.get('group')
      expect(handler).toBeDefined()

      const { reply, textCalls } = createMockReply()
      await handler!(createDmMessage('admin1', 'add'), reply, createAuth('admin1', { isBotAdmin: true }))

      expect(textCalls[0]).toBe('Usage: /group add <group-id> | /group remove <group-id> | /groups')
    })

    test('requires group id for DM remove', async () => {
      const handler = commandHandlers.get('group')
      expect(handler).toBeDefined()

      const { reply, textCalls } = createMockReply()
      await handler!(createDmMessage('admin1', 'remove'), reply, createAuth('admin1', { isBotAdmin: true }))

      expect(textCalls[0]).toBe('Usage: /group add <group-id> | /group remove <group-id> | /groups')
    })

    test('shows DM admin usage for unknown DM subcommand', async () => {
      const handler = commandHandlers.get('group')
      expect(handler).toBeDefined()

      const { reply, textCalls } = createMockReply()
      await handler!(createDmMessage('admin1', 'unknown group-123'), reply, createAuth('admin1', { isBotAdmin: true }))

      expect(textCalls[0]).toContain('Unknown subcommand')
      expect(textCalls[0]).toContain('/group add <group-id>')
      expect(textCalls[0]).toContain('/group remove <group-id>')
      expect(textCalls[0]).toContain('/groups')
    })

    test('rejects /groups in group chats', async () => {
      const groupsHandler = commandHandlers.get('groups')
      expect(groupsHandler).toBeDefined()

      const { reply, textCalls } = createMockReply()
      await groupsHandler!(createGroupMessage('admin1', '', true), reply, createAuth('admin1', { isBotAdmin: true }))

      expect(textCalls[0]).toBe('This command is only available in direct messages.')
    })
  })

  describe('unknown subcommand', () => {
    test('shows usage for unknown subcommand', async () => {
      const handler = commandHandlers.get('group')

      const { reply, textCalls } = createMockReply()
      await handler!(createGroupMessage('user1', 'unknown', false), reply, createGroupStorageAuth('group1'))

      lastReply = getFirstReply(textCalls)
      expect(lastReply).toContain('Unknown subcommand')
      expect(lastReply).toContain('Usage: /group adduser <user-id|@username>')
    })

    test('shows usage when no subcommand', async () => {
      const handler = commandHandlers.get('group')

      const message = createGroupMessage('user1', '', false)
      message.commandMatch = ''

      const { reply, textCalls } = createMockReply()
      await handler!(message, reply, createGroupStorageAuth('group1'))

      lastReply = getFirstReply(textCalls)
      expect(lastReply).toContain('Usage: /group adduser <user-id|@username>')
    })
  })

  describe('username resolution capability gating', () => {
    let noResolveChat: ChatProvider
    let noResolveHandlers: Map<string, CommandHandler>

    beforeEach(async () => {
      mockLogger()
      await setupTestDb()

      noResolveHandlers = new Map()
      noResolveChat = createMockChat({
        commandHandlers: noResolveHandlers,
        capabilities: TELEGRAM_LIKE_CAPABILITIES,
      })
      registerGroupCommand(noResolveChat)
    })

    test('adduser @username errors when provider lacks users.resolve', async () => {
      const handler = noResolveHandlers.get('group')
      expect(handler).toBeDefined()

      const { reply, textCalls } = createMockReply()
      await handler!(
        createGroupMessage('admin1', 'adduser @someone', true),
        reply,
        createGroupStorageAuth('group1', { isGroupAdmin: true }),
      )

      expect(textCalls[0]).toBe('This chat provider does not support username lookup. Use an explicit user ID.')
    })

    test('deluser @username errors when provider lacks users.resolve', async () => {
      const handler = noResolveHandlers.get('group')
      expect(handler).toBeDefined()

      const { reply, textCalls } = createMockReply()
      await handler!(
        createGroupMessage('admin1', 'deluser @someone', true),
        reply,
        createGroupStorageAuth('group1', { isGroupAdmin: true }),
      )

      expect(textCalls[0]).toBe('This chat provider does not support username lookup. Use an explicit user ID.')
    })

    test('adduser with plain ID still works when provider lacks users.resolve', async () => {
      const handler = noResolveHandlers.get('group')
      expect(handler).toBeDefined()

      const { reply, textCalls } = createMockReply()
      await handler!(
        createGroupMessage('admin1', 'adduser 12345', true),
        reply,
        createGroupStorageAuth('group1', { isGroupAdmin: true }),
      )

      expect(textCalls[0]).toBe('User 12345 added to this group.')
    })

    test('adduser @username uses source instance capability before router resolution', async () => {
      let aggregateResolveCalls = 0
      const routerHandlers = new Map<string, CommandHandler>()
      const sourceProvider = createMockChat({ capabilities: TELEGRAM_LIKE_CAPABILITIES })
      const aggregateProvider = createMockChat({
        commandHandlers: routerHandlers,
        resolveUserId: (): Promise<string | null> => {
          aggregateResolveCalls += 1
          return Promise.resolve(null)
        },
      })
      const routerProvider: ChatProvider & {
        readonly getInstance: (id: string) => { readonly provider: ChatProvider } | null
      } = {
        ...aggregateProvider,
        getInstance: (_id: string): { readonly provider: ChatProvider } | null => ({ provider: sourceProvider }),
      }
      registerGroupCommand(routerProvider)
      const handler = routerHandlers.get('group')
      expect(handler).toBeDefined()

      const { reply, textCalls } = createMockReply()
      await handler!(
        createGroupMessage('admin1', 'adduser @alice', true),
        reply,
        createGroupStorageAuth('group1', { isGroupAdmin: true }),
      )

      expect(textCalls[0]).toBe('This chat provider does not support username lookup. Use an explicit user ID.')
      expect(aggregateResolveCalls).toBe(0)
    })
  })

  describe('readable label resolution', () => {
    test('lists authorized groups with resolved group and user labels', async () => {
      const labeledHandlers = new Map<string, CommandHandler>()
      const labeledChat = createMockChat({
        commandHandlers: labeledHandlers,
        resolveGroupLabel: resolveGroupLabelByKnownId,
        resolveUserLabel: resolveUserLabelForAdmin1,
      })
      registerGroupCommand(labeledChat)

      const { addAuthorizedGroup } = await import('../../src/authorized-groups.js')
      addAuthorizedGroup('group-123', 'admin1')

      const handler = labeledHandlers.get('groups')
      expect(handler).toBeDefined()

      const { reply, textCalls } = createMockReply()
      await handler!(createDmMessage('admin1'), reply, createAuth('admin1', { isBotAdmin: true }))

      expect(textCalls[0]).toContain('Engineering Chat')
      expect(textCalls[0]).toContain('John Johnson (@itsmike)')
      expect(textCalls[0]).not.toContain('group-123 (added by admin1)')
    })

    test('resolves added-by labels separately for each authorized group context', async () => {
      const labeledHandlers = new Map<string, CommandHandler>()
      const labeledChat = createMockChat({
        commandHandlers: labeledHandlers,
        resolveGroupLabel: (groupId: string): Promise<string | null> => Promise.resolve(groupId),
        resolveUserLabel: resolveUserLabelByContextId,
      })
      registerGroupCommand(labeledChat)

      const { addAuthorizedGroup } = await import('../../src/authorized-groups.js')
      addAuthorizedGroup('group-123', 'admin1')
      addAuthorizedGroup('group-456', 'admin1')

      const handler = labeledHandlers.get('groups')
      expect(handler).toBeDefined()

      const { reply, textCalls } = createMockReply()
      await handler!(createDmMessage('admin1'), reply, createAuth('admin1', { isBotAdmin: true }))

      expect(textCalls[0]).toContain('group-123 (added by Alice One (@admin1))')
      expect(textCalls[0]).toContain('group-456 (added by Alice Two (@admin1))')
    })

    test('uses native group id for provider label resolution when stored group is scoped', async () => {
      const seenGroupIds: string[] = []
      const seenContexts: Array<ResolveUserContext | undefined> = []
      const labeledHandlers = new Map<string, CommandHandler>()
      const labeledChat = createMockChat({
        commandHandlers: labeledHandlers,
        resolveGroupLabel: (groupId: string): Promise<string | null> => {
          seenGroupIds.push(groupId)
          return Promise.resolve('Native Group Label')
        },
        resolveUserLabel: (_userId: string, context: ResolveUserContext | undefined): Promise<string | null> => {
          seenContexts.push(context)
          return Promise.resolve('Admin Label')
        },
      })
      registerGroupCommand(labeledChat)

      const { addAuthorizedGroup } = await import('../../src/authorized-groups.js')
      const scopedGroupId = toScopedContextId({ platformInstanceId: 'telegram-default', nativeContextId: 'group-123' })
      addAuthorizedGroup(scopedGroupId, 'admin1')

      const handler = labeledHandlers.get('groups')
      expect(handler).toBeDefined()

      const { reply, textCalls } = createMockReply()
      await handler!(createDmMessage('admin1'), reply, createAuth('admin1', { isBotAdmin: true }))

      expect(seenGroupIds).toEqual(['group-123'])
      expect(seenContexts).toEqual([
        { contextId: 'group-123', contextType: 'group', platformInstanceId: 'telegram-default' },
      ])
      expect(textCalls[0]).toContain('Native Group Label (added by Admin Label)')
    })

    test('routes scoped authorized group labels through the source platform instance', async () => {
      const seenSourceGroupIds: string[] = []
      const labeledHandlers = new Map<string, CommandHandler>()
      const sourceProvider = createMockChat({
        resolveGroupLabel: (groupId: string): Promise<string | null> => {
          seenSourceGroupIds.push(groupId)
          return Promise.resolve('Source Group Label')
        },
        resolveUserLabel: (): Promise<string | null> => Promise.resolve('Source Admin Label'),
      })
      const aggregateProvider = createMockChat({
        commandHandlers: labeledHandlers,
        resolveGroupLabel: (): Promise<string | null> => Promise.resolve(null),
        resolveUserLabel: (): Promise<string | null> => Promise.resolve(null),
      })
      const routerProvider: ChatProvider & {
        readonly getInstance: (id: string) => { readonly provider: ChatProvider } | null
      } = {
        ...aggregateProvider,
        getInstance: (_id: string): { readonly provider: ChatProvider } | null => ({ provider: sourceProvider }),
      }
      registerGroupCommand(routerProvider)

      const { addAuthorizedGroup } = await import('../../src/authorized-groups.js')
      const scopedGroupId = toScopedContextId({ platformInstanceId: 'telegram-default', nativeContextId: 'group-123' })
      addAuthorizedGroup(scopedGroupId, 'admin1')

      const handler = labeledHandlers.get('groups')
      expect(handler).toBeDefined()

      const { reply, textCalls } = createMockReply()
      await handler!(createDmMessage('admin1'), reply, createAuth('admin1', { isBotAdmin: true }))

      expect(seenSourceGroupIds).toEqual(['group-123'])
      expect(textCalls[0]).toContain('Source Group Label')
    })

    test('does not pass DM platform instance into /groups added-by label lookups', async () => {
      const seenContexts: Array<ResolveUserContext | undefined> = []
      const labeledHandlers = new Map<string, CommandHandler>()
      const labeledChat = createMockChat({
        commandHandlers: labeledHandlers,
        resolveGroupLabel: (groupId: string): Promise<string | null> => Promise.resolve(groupId),
        resolveUserLabel: (_userId: string, context: ResolveUserContext | undefined): Promise<string | null> => {
          seenContexts.push(context)
          return Promise.resolve(null)
        },
      })
      registerGroupCommand(labeledChat)

      const { addAuthorizedGroup } = await import('../../src/authorized-groups.js')
      addAuthorizedGroup('group-123', 'admin1')

      const handler = labeledHandlers.get('groups')
      expect(handler).toBeDefined()

      const { reply } = createMockReply()
      await handler!(createDmMessage('admin1'), reply, createAuth('admin1', { isBotAdmin: true }))

      expect(seenContexts).toEqual([{ contextId: 'group-123', contextType: 'group' }])
    })

    test('lists group users with resolved member and adder labels', async () => {
      const labeledHandlers = new Map<string, CommandHandler>()
      const labeledChat = createMockChat({
        commandHandlers: labeledHandlers,
        resolveUserLabel: resolveUserLabelForMembersAndAdder,
      })
      registerGroupCommand(labeledChat)

      const { addGroupMember } = await import('../../src/groups.js')
      addGroupMember('group1', 'user1', 'admin1')

      const handler = labeledHandlers.get('group')
      expect(handler).toBeDefined()

      const { reply, textCalls } = createMockReply()
      await handler!(createGroupMessage('user1', 'users', false), reply, createGroupStorageAuth('group1'))

      expect(textCalls[0]).toContain('John Johnson (@itsmike)')
      expect(textCalls[0]).toContain('added by Jane Admin (@janeadmin)')
    })

    test('passes source platform instance into /group users label lookups', async () => {
      const seenContexts: Array<ResolveUserContext | undefined> = []
      const labeledHandlers = new Map<string, CommandHandler>()
      const labeledChat = createMockChat({
        commandHandlers: labeledHandlers,
        resolveUserLabel: (_userId: string, context: ResolveUserContext | undefined): Promise<string | null> => {
          seenContexts.push(context)
          return Promise.resolve(null)
        },
      })
      registerGroupCommand(labeledChat)

      const { addGroupMember } = await import('../../src/groups.js')
      addGroupMember('group1', 'user1', 'admin1')

      const handler = labeledHandlers.get('group')
      expect(handler).toBeDefined()

      const { reply } = createMockReply()
      await handler!(createGroupMessage('user1', 'users', false), reply, createGroupStorageAuth('group1'))

      expect(seenContexts).toEqual([
        { contextId: 'group1', contextType: 'group', platformInstanceId: 'test-instance' },
        { contextId: 'group1', contextType: 'group', platformInstanceId: 'test-instance' },
      ])
    })

    test('bounds concurrent /groups label lookups', async () => {
      const blockingLookup = createBlockingLabelLookup()
      const labeledHandlers = new Map<string, CommandHandler>()
      const labeledChat = createMockChat({
        commandHandlers: labeledHandlers,
        resolveGroupLabel: (): Promise<string | null> => blockingLookup.lookup(),
        resolveUserLabel: (): Promise<string | null> => blockingLookup.lookup(),
      })
      registerGroupCommand(labeledChat)

      const { addAuthorizedGroup } = await import('../../src/authorized-groups.js')
      for (const index of [1, 2, 3, 4, 5, 6]) {
        addAuthorizedGroup(`group-${index}`, `admin-${index}`)
      }

      const handler = labeledHandlers.get('groups')
      expect(handler).toBeDefined()

      const { reply } = createMockReply()
      const handlerPromise = handler!(createDmMessage('admin1'), reply, createAuth('admin1', { isBotAdmin: true }))

      await flushMicrotasks()

      expect(blockingLookup.getMaxInFlight()).toBe(5)

      blockingLookup.stopBlocking()
      blockingLookup.releaseAll()
      await handlerPromise
    })

    test('bounds concurrent /group users label lookups', async () => {
      const blockingLookup = createBlockingLabelLookup()
      const labeledHandlers = new Map<string, CommandHandler>()
      const labeledChat = createMockChat({
        commandHandlers: labeledHandlers,
        resolveUserLabel: (): Promise<string | null> => blockingLookup.lookup(),
      })
      registerGroupCommand(labeledChat)

      const { addGroupMember } = await import('../../src/groups.js')
      for (const index of [1, 2, 3, 4, 5, 6]) {
        addGroupMember('group1', `user-${index}`, `admin-${index}`)
      }

      const handler = labeledHandlers.get('group')
      expect(handler).toBeDefined()

      const { reply } = createMockReply()
      const handlerPromise = handler!(createGroupMessage('user1', 'users', false), reply, createGroupStorageAuth('group1'))

      await flushMicrotasks()

      expect(blockingLookup.getMaxInFlight()).toBe(5)

      blockingLookup.stopBlocking()
      blockingLookup.releaseAll()
      await handlerPromise
    })

    test('falls back to raw IDs when /groups label resolution returns null', async () => {
      const fallbackHandlers = new Map<string, CommandHandler>()
      const fallbackChat = createMockChat({
        commandHandlers: fallbackHandlers,
        resolveGroupLabel: (_groupId: string): Promise<string | null> => Promise.resolve(null),
        resolveUserLabel: (_userId: string): Promise<string | null> => Promise.resolve(null),
      })
      registerGroupCommand(fallbackChat)

      const { addAuthorizedGroup } = await import('../../src/authorized-groups.js')
      addAuthorizedGroup('group-123', 'admin1')

      const handler = fallbackHandlers.get('groups')
      expect(handler).toBeDefined()

      const { reply, textCalls } = createMockReply()
      await handler!(createDmMessage('admin1'), reply, createAuth('admin1', { isBotAdmin: true }))

      expect(textCalls[0]).toContain('group-123 (added by admin1)')
    })

    test('falls back to raw IDs when /groups label resolution rejects', async () => {
      const fallbackHandlers = new Map<string, CommandHandler>()
      const fallbackChat = createMockChat({
        commandHandlers: fallbackHandlers,
        resolveGroupLabel: (_groupId: string): Promise<string | null> =>
          Promise.reject(new Error('group lookup failed')),
        resolveUserLabel: (_userId: string): Promise<string | null> => Promise.reject(new Error('user lookup failed')),
      })
      registerGroupCommand(fallbackChat)

      const { addAuthorizedGroup } = await import('../../src/authorized-groups.js')
      addAuthorizedGroup('group-123', 'admin1')

      const handler = fallbackHandlers.get('groups')
      expect(handler).toBeDefined()

      const { reply, textCalls } = createMockReply()
      await handler!(createDmMessage('admin1'), reply, createAuth('admin1', { isBotAdmin: true }))

      expect(textCalls[0]).toContain('group-123 (added by admin1)')
    })

    test('falls back to raw IDs when /group users label resolution returns null', async () => {
      const fallbackHandlers = new Map<string, CommandHandler>()
      const fallbackChat = createMockChat({
        commandHandlers: fallbackHandlers,
        resolveUserLabel: (_userId: string): Promise<string | null> => Promise.resolve(null),
      })
      registerGroupCommand(fallbackChat)

      const { addGroupMember } = await import('../../src/groups.js')
      addGroupMember('group1', 'user1', 'admin1')

      const handler = fallbackHandlers.get('group')
      expect(handler).toBeDefined()

      const { reply, textCalls } = createMockReply()
      await handler!(createGroupMessage('user1', 'users', false), reply, createGroupStorageAuth('group1'))

      expect(textCalls[0]).toContain('- user1 (added by admin1)')
    })

    test('falls back to raw IDs when /group users label resolution rejects', async () => {
      const fallbackHandlers = new Map<string, CommandHandler>()
      const fallbackChat = createMockChat({
        commandHandlers: fallbackHandlers,
        resolveUserLabel: (_userId: string): Promise<string | null> => Promise.reject(new Error('user lookup failed')),
      })
      registerGroupCommand(fallbackChat)

      const { addGroupMember } = await import('../../src/groups.js')
      addGroupMember('group1', 'user1', 'admin1')

      const handler = fallbackHandlers.get('group')
      expect(handler).toBeDefined()

      const { reply, textCalls } = createMockReply()
      await handler!(createGroupMessage('user1', 'users', false), reply, createGroupStorageAuth('group1'))

      expect(textCalls[0]).toContain('- user1 (added by admin1)')
    })

    test('uses cached telegram group and adder labels for /groups when live lookup returns null', async () => {
      const telegramHandlers = new Map<string, CommandHandler>()
      const telegramChat: ChatProvider = {
        ...createMockChat({
          commandHandlers: telegramHandlers,
          resolveGroupLabel: (): Promise<string | null> => Promise.resolve(null),
          resolveUserLabel: (): Promise<string | null> => Promise.resolve(null),
        }),
        name: 'telegram',
      }
      registerGroupCommand(telegramChat)

      const { addAuthorizedGroup } = await import('../../src/authorized-groups.js')
      addAuthorizedGroup('-100123', '42')
      upsertKnownGroupContext({
        contextId: '-100123',
        provider: 'telegram',
        displayName: 'Operations',
        parentName: null,
      })
      upsertGroupUserObservation({
        provider: 'telegram',
        contextId: '-100123',
        userId: '42',
        username: 'itsmike',
        displayLabel: 'John Johnson (@itsmike)',
      })

      const handler = telegramHandlers.get('groups')
      expect(handler).toBeDefined()

      const { reply, textCalls } = createMockReply()
      await handler!(createDmMessage('admin1'), reply, createAuth('admin1', { isBotAdmin: true }))

      expect(textCalls[0]).toContain('Operations (added by John Johnson (@itsmike))')
    })

    test('uses cached telegram member and adder labels for /group users when live lookup returns null', async () => {
      const telegramHandlers = new Map<string, CommandHandler>()
      const telegramChat: ChatProvider = {
        ...createMockChat({
          commandHandlers: telegramHandlers,
          resolveUserLabel: (): Promise<string | null> => Promise.resolve(null),
        }),
        name: 'telegram',
      }
      registerGroupCommand(telegramChat)

      const { addGroupMember } = await import('../../src/groups.js')
      addGroupMember('-100123', '99', '42')
      upsertGroupUserObservation({
        provider: 'telegram',
        contextId: '-100123',
        userId: '99',
        username: 'worker99',
        displayLabel: 'Worker Ninety Nine (@worker99)',
      })
      upsertGroupUserObservation({
        provider: 'telegram',
        contextId: '-100123',
        userId: '42',
        username: 'itsmike',
        displayLabel: 'John Johnson (@itsmike)',
      })

      const handler = telegramHandlers.get('group')
      expect(handler).toBeDefined()

      const { reply, textCalls } = createMockReply()
      await handler!(
        createGroupMessage('42', 'users', true, '-100123'),
        reply,
        createGroupStorageAuth('-100123', { isGroupAdmin: true }),
      )

      expect(textCalls[0]).toContain('- Worker Ninety Nine (@worker99) (added by John Johnson (@itsmike))')
    })
  })
})
