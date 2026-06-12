// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import type { CommandHandler } from '../../src/chat/types.js'
import { registerStartCommand } from '../../src/commands/start.js'
import type { StartCommandDeps } from '../../src/commands/start.js'
import { addUser as addScopedUser, isAuthorized as isAuthorizedScoped } from '../../src/users.js'
import {
  createMockReply,
  createMockChatWithCommandHandlers,
  mockLogger,
  seedCommonTestPlatformInstances,
  setupTestDb,
} from '../utils/test-helpers.js'

const TEST_PLATFORM_ID = 'test-instance'

const addUser = (userId: string, addedBy: string, username: string | undefined): void => {
  addScopedUser({ userId, platformInstanceId: TEST_PLATFORM_ID, addedBy, username })
}

const isAuthorized = (userId: string): boolean => isAuthorizedScoped(userId, TEST_PLATFORM_ID)

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
    seedCommonTestPlatformInstances()
    capturedFormatted = null
    lastHandler = null
    registerStartCommand(mockChat)
    const registeredHandler = commandHandlers.get('start')
    if (registeredHandler === undefined) {
      lastHandler = null
      return
    }
    lastHandler = registeredHandler
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
      platformInstanceId: 'test-instance',
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
    expect(capturedFormatted).toContain('/config')
    expect(capturedFormatted).not.toContain('/setup')
  })

  test('demo mode off: unknown user is NOT auto-added via /start', async () => {
    const msg = {
      user: { id: 'no-demo-1', username: 'nouser', isAdmin: false },
      contextId: 'no-demo-1',
      contextType: 'dm' as const,
      text: '/start',
      platformInstanceId: 'test-instance',
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
      platformInstanceId: 'test-instance',
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
    expect(capturedFormatted).toContain('/config')
    expect(capturedFormatted).not.toContain('/setup')
  })

  test('demo mode auto-add routes through generic auto-provision hook', async () => {
    process.env['DEMO_MODE'] = 'true'
    const autoProvisionCalls: Array<{ contextId: string; chatUserId: string; username: string | null }> = []
    const deps: StartCommandDeps = {
      maybeAutoProvision: (_reply, contextId, chatUserId, username) => {
        autoProvisionCalls.push({ contextId, chatUserId, username })
        return Promise.resolve(true)
      },
    }
    const { provider, commandHandlers: localCommandHandlers } = createMockChatWithCommandHandlers()
    registerStartCommand(provider, deps)
    const handler = localCommandHandlers.get('start')
    const { reply } = createMockReply()

    await handler!(
      {
        user: { id: 'demo-start-generic', username: 'generic-user', isAdmin: false },
        contextId: 'demo-start-generic',
        contextType: 'dm',
        text: '/start',
        platformInstanceId: TEST_PLATFORM_ID,
        commandMatch: 'start',
        isMentioned: false,
      },
      reply,
      {
        allowed: true,
        isBotAdmin: false,
        isGroupAdmin: false,
        storageContextId: 'demo-start-generic',
      },
    )

    expect(autoProvisionCalls).toEqual([
      { contextId: 'demo-start-generic', chatUserId: 'demo-start-generic', username: 'generic-user' },
    ])
  })

  test('demo mode auto-add continues when generic auto-provision hook throws', async () => {
    process.env['DEMO_MODE'] = 'true'
    const deps: StartCommandDeps = {
      maybeAutoProvision: () => {
        throw new Error('auto provision exploded')
      },
    }
    const { provider, commandHandlers: localCommandHandlers } = createMockChatWithCommandHandlers()
    registerStartCommand(provider, deps)
    const handler = localCommandHandlers.get('start')
    const reply = {
      text: (): Promise<void> => Promise.resolve(),
      formatted: (content: string): Promise<void> => {
        capturedFormatted = content
        return Promise.resolve()
      },
      file: (): Promise<void> => Promise.resolve(),
      typing: (): void => {},
      buttons: (): Promise<void> => Promise.resolve(),
    }

    await handler!(
      {
        user: { id: 'demo-start-throws', username: 'generic-user', isAdmin: false },
        contextId: 'demo-start-throws',
        contextType: 'dm',
        text: '/start',
        platformInstanceId: TEST_PLATFORM_ID,
        commandMatch: 'start',
        isMentioned: false,
      },
      reply,
      {
        allowed: true,
        isBotAdmin: false,
        isGroupAdmin: false,
        storageContextId: 'demo-start-throws',
      },
    )

    expect(isAuthorized('demo-start-throws')).toBe(true)
    expect(capturedFormatted).toContain('Welcome')
  })
})
