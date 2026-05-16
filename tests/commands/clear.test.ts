// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { listActiveAttachments, persistIncomingAttachments } from '../../src/attachments/index.js'
import type { ChatProvider, CommandHandler } from '../../src/chat/types.js'
import { registerClearCommand } from '../../src/commands/clear.js'
import { addUser } from '../../src/users.js'
import {
  createAuth,
  createDmMessage,
  createMockChatWithCommandHandlers,
  createMockReply,
  mockLogger,
  setupTestDb,
} from '../utils/test-helpers.js'

describe('/clear command — history and memory only', () => {
  let mockChat: ChatProvider
  let commandHandlers: Map<string, CommandHandler>
  const adminUserId = 'admin-clear'

  const checkAuthorization = (userId: string): boolean => userId === adminUserId

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    addUser(adminUserId, adminUserId)

    const { provider, commandHandlers: handlers } = createMockChatWithCommandHandlers()
    mockChat = provider
    commandHandlers = handlers
    registerClearCommand(mockChat, checkAuthorization, adminUserId)
  })

  test('clears history and memory but leaves attachments in workspace', async () => {
    addUser('clear-user', adminUserId)
    await persistIncomingAttachments({
      contextId: 'clear-user',
      sourceProvider: 'telegram',
      files: [{ fileId: 'tg-1', filename: 'note.txt', content: Buffer.from('note') }],
    })
    expect(listActiveAttachments('clear-user')).toHaveLength(1)

    const handler = commandHandlers.get('clear')
    expect(handler).toBeDefined()
    const auth = createAuth('clear-user')
    auth.storageContextId = 'clear-user'

    const msg = createDmMessage('clear-user', '')

    const { reply, textCalls } = createMockReply()
    await handler!(msg, reply, auth)

    // Attachments must remain in the workspace
    expect(listActiveAttachments('clear-user')).toHaveLength(1)
    expect(textCalls[0]).toContain('memory')
  })

  test('clears history for a target user but leaves attachments', async () => {
    addUser('victim-user', adminUserId)
    await persistIncomingAttachments({
      contextId: 'victim-user',
      sourceProvider: 'telegram',
      files: [{ fileId: 'tg-1', filename: 'a.txt', content: Buffer.from('a') }],
    })
    expect(listActiveAttachments('victim-user')).toHaveLength(1)

    const handler = commandHandlers.get('clear')
    const adminMsg = createDmMessage(adminUserId, '/clear victim-user')
    adminMsg.commandMatch = 'victim-user'
    const auth = createAuth(adminUserId, { isBotAdmin: true })

    const { reply, textCalls } = createMockReply()
    await handler!(adminMsg, reply, auth)

    // Attachments must remain in the workspace
    expect(listActiveAttachments('victim-user')).toHaveLength(1)
    expect(textCalls[0]).toContain('history')
  })
})
