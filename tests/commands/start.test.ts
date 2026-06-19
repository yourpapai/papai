// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import type { CommandHandler } from '../../src/chat/types.js'
import { registerStartCommand } from '../../src/commands/start.js'
import { createMockChatWithCommandHandlers, mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('start command', () => {
  let handler: CommandHandler | null = null
  const { provider: mockChat, commandHandlers } = createMockChatWithCommandHandlers()

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    registerStartCommand(mockChat)
    handler = commandHandlers.get('start') ?? null
  })

  test('authorized user gets the welcome message', async () => {
    let captured: string | null = null
    const reply = {
      text: (): Promise<void> => Promise.resolve(),
      formatted: (content: string): Promise<void> => {
        captured = content
        return Promise.resolve()
      },
      file: (): Promise<void> => Promise.resolve(),
      typing: (): void => {},
      buttons: (): Promise<undefined> => Promise.resolve(undefined),
    }
    const msg = {
      user: { id: 'u1', username: 'user', isAdmin: false },
      contextId: 'u1',
      contextType: 'dm' as const,
      text: '/start',
      platformInstanceId: 'test-instance',
      commandMatch: 'start',
      isMentioned: false,
    }
    await handler!(msg, reply, { allowed: true, isBotAdmin: false, isGroupAdmin: false, storageContextId: 'u1' })
    expect(captured).not.toBeNull()
    expect(captured!).toContain('Welcome')
    expect(captured!).toContain('/config')
  })

  test('unauthorized user gets the rejection message', async () => {
    let captured: string | null = null
    const reply = {
      text: (content: string): Promise<void> => {
        captured = content
        return Promise.resolve()
      },
      formatted: (): Promise<void> => Promise.resolve(),
      file: (): Promise<void> => Promise.resolve(),
      typing: (): void => {},
      buttons: (): Promise<undefined> => Promise.resolve(undefined),
    }
    const msg = {
      user: { id: 'u2', username: 'user', isAdmin: false },
      contextId: 'u2',
      contextType: 'dm' as const,
      text: '/start',
      platformInstanceId: 'test-instance',
      commandMatch: 'start',
      isMentioned: false,
    }
    await handler!(msg, reply, { allowed: false, isBotAdmin: false, isGroupAdmin: false, storageContextId: 'u2' })
    expect(captured).not.toBeNull()
    expect(captured!).toContain('not authorized')
  })
})
