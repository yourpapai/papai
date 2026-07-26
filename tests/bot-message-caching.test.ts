// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { and, eq } from 'drizzle-orm'

import { getThreadScopedStorageContextId } from '../src/auth.js'
import { addAuthorizedGroup } from '../src/authorized-groups.js'
import { cacheObservedIncomingMessage } from '../src/bot-message-caching.js'
import { setupBot, type BotDeps } from '../src/bot.js'
import { getScopeKey } from '../src/chat/context-scope.js'
import type { IncomingMessage, ReplyFn } from '../src/chat/types.js'
import * as schema from '../src/db/schema.js'
import { addGroupMember } from '../src/groups.js'
import { addUser } from '../src/users.js'
import {
  createAuth,
  createDmMessage,
  createGroupMessage,
  createMockChatForBot,
  createMockReply,
  flushPendingWrites,
  getTestDb,
  mockLogger,
  seedCommonTestPlatformInstances,
  setupTestDb,
} from './utils/test-helpers.js'

const ADMIN_ID = 'admin-1'
const PLATFORM_ID = 'test-instance'

const scopedStorageContextId = (contextId: string, contextType: 'dm' | 'group'): string =>
  getThreadScopedStorageContextId(contextId, contextType, undefined, PLATFORM_ID)

const botDeps: BotDeps = {
  processMessage: (): Promise<void> => Promise.resolve(),
  enqueueMessage: (): void => {},
}

function findCachedRow(contextId: string, messageId: string): typeof schema.messageMetadata.$inferSelect | undefined {
  return getTestDb()
    .select()
    .from(schema.messageMetadata)
    .where(and(eq(schema.messageMetadata.contextId, contextId), eq(schema.messageMetadata.messageId, messageId)))
    .get()
}

describe('bot message caching (onIncomingMessage)', () => {
  let getMessageHandler: () => ((msg: IncomingMessage, reply: ReplyFn) => Promise<void>) | null

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()
    const { provider, getMessageHandler: getHandler } = createMockChatForBot()
    getMessageHandler = getHandler
    setupBot(provider, ADMIN_ID, botDeps)
  })

  test('caches an observed DM message with null group_context_id', async () => {
    addUser({ userId: 'cache-user', platformInstanceId: PLATFORM_ID, addedBy: ADMIN_ID, username: 'cacheuser' })
    const handler = getMessageHandler()
    expect(handler).not.toBeNull()
    const { reply } = createMockReply()
    await handler!({ ...createDmMessage('cache-user', '', 'cacheuser'), text: 'hello dm', messageId: 'dm-1' }, reply)
    await flushPendingWrites()

    const row = findCachedRow(scopedStorageContextId('cache-user', 'dm'), 'dm-1')
    expect(row).toBeDefined()
    expect(row?.text).toBe('hello dm')
    expect(row?.authorId).toBe('cache-user')
    expect(row?.authorUsername).toBe('cacheuser')
    expect(row?.groupContextId).toBeNull()
  })

  test('caches a non-mention group message with the derived group_context_id', async () => {
    const groupStorageContextId = scopedStorageContextId('group1', 'group')
    addAuthorizedGroup(groupStorageContextId, ADMIN_ID)
    addGroupMember(groupStorageContextId, 'cache-user', ADMIN_ID)
    const handler = getMessageHandler()
    expect(handler).not.toBeNull()
    const { reply } = createMockReply()
    // Non-mention, non-command group chatter: handleMessage ignores it, but
    // onIncomingMessage must still record it for group-wide history search.
    const msg: IncomingMessage = {
      ...createGroupMessage('cache-user', 'plain group chatter', false, 'group1'),
      commandMatch: '',
      messageId: 'g-1',
    }
    await handler!(msg, reply)
    await flushPendingWrites()

    const row = findCachedRow(groupStorageContextId, 'g-1')
    expect(row).toBeDefined()
    expect(row?.text).toBe('plain group chatter')
    expect(row?.groupContextId).toBe(
      getScopeKey('group', {
        storageContextId: groupStorageContextId,
        chatUserId: 'cache-user',
        contextType: 'group',
      }),
    )
  })

  test('does not cache a command message', async () => {
    addUser({ userId: 'cache-user', platformInstanceId: PLATFORM_ID, addedBy: ADMIN_ID })
    const handler = getMessageHandler()
    expect(handler).not.toBeNull()
    const { reply } = createMockReply()
    await handler!({ ...createDmMessage('cache-user', 'config'), text: '/config', messageId: 'cmd-1' }, reply)
    await flushPendingWrites()

    expect(findCachedRow(scopedStorageContextId('cache-user', 'dm'), 'cmd-1')).toBeUndefined()
  })

  describe('cacheObservedIncomingMessage guards', () => {
    test('does not cache when auth is not allowed', async () => {
      const auth = createAuth('guard-user', { allowed: false })
      cacheObservedIncomingMessage({ ...createDmMessage('guard-user'), text: 'hi', messageId: 'gd-1' }, auth)
      await flushPendingWrites()

      expect(findCachedRow('guard-user', 'gd-1')).toBeUndefined()
    })

    test('does not cache when messageId is missing', async () => {
      const auth = createAuth('guard-user')
      cacheObservedIncomingMessage({ ...createDmMessage('guard-user'), text: 'hi' }, auth)
      await flushPendingWrites()

      const rows = getTestDb().select().from(schema.messageMetadata).all()
      expect(rows).toHaveLength(0)
    })

    test('does not throw when text is empty (no embed attempted)', async () => {
      const auth = { ...createAuth('guard-user'), configContextId: 'guard-user' }
      expect(() =>
        cacheObservedIncomingMessage({ ...createDmMessage('guard-user'), text: '   ', messageId: 'gd-2' }, auth),
      ).not.toThrow()
      await flushPendingWrites()

      expect(getTestDb().select().from(schema.messageEmbeddings).all()).toHaveLength(0)
    })

    test('does not throw when text is present but no embedding LLM config resolves', async () => {
      const auth = { ...createAuth('guard-user'), configContextId: 'guard-user' }
      expect(() =>
        cacheObservedIncomingMessage({ ...createDmMessage('guard-user'), text: 'hi', messageId: 'gd-3' }, auth),
      ).not.toThrow()
      await flushPendingWrites()
      // Let the fire-and-forget embed promise settle.
      await new Promise((resolve) => {
        setTimeout(resolve, 0)
      })

      expect(getTestDb().select().from(schema.messageEmbeddings).all()).toHaveLength(0)
    })
  })
})
