// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import type { CommandHandler } from '../../src/chat/types.js'
import { registerStartCommand } from '../../src/commands/start.js'
import { addUser, isAuthorized } from '../../src/users.js'
import { createMockChatWithCommandHandlers, mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('start command — demo mode auto-add', () => {
  let lastHandler: CommandHandler | null = null
  let capturedFormatted: string | null = null

  const { provider: mockChat, commandHandlers } = createMockChatWithCommandHandlers()

  const mockReply = {
    text: (): Promise<void> => Promise.resolve(),
    formatted: (content: string): Promise<void> => {
      capturedFormatted = content
      return Promise.resolve()
    },
    file: (): Promise<void> => Promise.resolve(),
    typing: (): void => {},
    buttons: (): Promise<void> => Promise.resolve(),
  }

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    capturedFormatted = null
    lastHandler = null
    registerStartCommand(mockChat)
    lastHandler = commandHandlers.get('start') ?? null
  })

  afterEach(() => {
    delete process.env['DEMO_MODE']
  })

  test('demo mode: unknown DM user is auto-added via /start', async () => {
    process.env['DEMO_MODE'] = 'true'
    const msg = {
      user: { id: 'demo-start-1', username: 'startuser', isAdmin: false },
      contextId: 'demo-start-1',
      contextType: 'dm' as const,
      text: '/start',
      commandMatch: 'start',
      isMentioned: false,
    }
    const auth = {
      allowed: true,
      isBotAdmin: false,
      isGroupAdmin: false,
      storageContextId: 'demo-start-1',
    }

    await lastHandler!(msg, mockReply, auth)

    expect(isAuthorized('demo-start-1')).toBe(true)
    expect(capturedFormatted).toContain('Welcome')
  })

  test('demo mode off: unknown user is NOT auto-added via /start', async () => {
    const msg = {
      user: { id: 'no-demo-1', username: 'nouser', isAdmin: false },
      contextId: 'no-demo-1',
      contextType: 'dm' as const,
      text: '/start',
      commandMatch: 'start',
      isMentioned: false,
    }
    const auth = {
      allowed: true,
      isBotAdmin: false,
      isGroupAdmin: false,
      storageContextId: 'no-demo-1',
    }

    await lastHandler!(msg, mockReply, auth)

    expect(isAuthorized('no-demo-1')).toBe(false)
  })

  test('demo mode: already-authorized user is not re-added', async () => {
    process.env['DEMO_MODE'] = 'true'
    addUser('existing-1', 'admin', 'existing')
    const msg = {
      user: { id: 'existing-1', username: 'existing', isAdmin: false },
      contextId: 'existing-1',
      contextType: 'dm' as const,
      text: '/start',
      commandMatch: 'start',
      isMentioned: false,
    }
    const auth = {
      allowed: true,
      isBotAdmin: true,
      isGroupAdmin: false,
      storageContextId: 'existing-1',
    }

    await lastHandler!(msg, mockReply, auth)

    expect(isAuthorized('existing-1')).toBe(true)
    expect(capturedFormatted).toContain('Welcome')
  })
})
