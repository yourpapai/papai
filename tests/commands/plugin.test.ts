// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { registerPluginCommand } from '../../src/commands/plugin.js'
import {
  createAuth,
  createDmMessage,
  createMockChatWithCommandHandlers,
  createMockReply,
  mockLogger,
  setupTestDb,
} from '../utils/test-helpers.js'

describe('registerPluginCommand', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('registers plugin management list command for bot admin', async () => {
    const { provider, commandHandlers } = createMockChatWithCommandHandlers()
    registerPluginCommand(provider, 'admin-user')

    const handler = commandHandlers.get('plugin')
    expect(handler).toBeDefined()

    const { reply, textCalls } = createMockReply()
    await handler!(
      { ...createDmMessage('admin-user', '/plugin list'), commandMatch: 'list' },
      reply,
      createAuth('admin-user', { isBotAdmin: true }),
    )

    expect(textCalls[0]).toContain('No plugins discovered')
  })
})
