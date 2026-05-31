// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { getThreadScopedStorageContextId } from '../src/auth.js'
import { setupBot, type BotDeps } from '../src/bot.js'
import type { IncomingMessage } from '../src/chat/types.js'
import { setConfig, setConfigValue } from '../src/config.js'
import { setContextSettings } from '../src/instances/context-store.js'
import { insertTaskInstance, getTaskInstance } from '../src/instances/task-store.js'
import { KANEO_PLUGIN_CREDENTIAL_KEY } from '../src/types/config.js'
import { addUser as addScopedUser } from '../src/users.js'
import {
  createDmMessage,
  createMockChatForBot,
  createMockChatWithCommandHandlers,
  createMockReply,
  mockLogger,
  seedCommonTestPlatformInstances,
  setupTestDb,
} from './utils/test-helpers.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_PLATFORM_ID = 'test-instance'
const ADMIN_ID = 'char-test-admin'

// ---------------------------------------------------------------------------
// Helpers (mirror the pattern from bot.test.ts)
// ---------------------------------------------------------------------------

function scopedDm(userId: string): string {
  return getThreadScopedStorageContextId(userId, 'dm', undefined, TEST_PLATFORM_ID)
}

function addUser(userId: string, addedBy: string): void {
  addScopedUser({ userId, platformInstanceId: TEST_PLATFORM_ID, addedBy })
}

/**
 * Set up a context so `autoStartWizardIfNeeded` finds an existing task assignment
 * and does NOT intercept the message to start the setup wizard.
 */
function setupUserConfig(userId: string): void {
  for (const contextId of new Set([userId, scopedDm(userId)])) {
    const taskInstanceId = `${contextId}-kaneo-char-test`
    if (getTaskInstance(taskInstanceId) === null) {
      insertTaskInstance({
        id: taskInstanceId,
        type: 'kaneo',
        config: { url: 'https://kaneo.invalid' },
        status: 'active',
      })
    }
    setContextSettings({ contextId, taskInstanceId, platformInstanceId: 'telegram-default' })
    setConfigValue(contextId, KANEO_PLUGIN_CREDENTIAL_KEY, 'test-kaneo-key')
    setConfig(contextId, 'timezone', 'UTC')
  }
}

/**
 * Build a BotDeps that replaces `enqueueMessage` with the provided spy and
 * uses a no-op `processMessage` (queue handler path never reached in these tests).
 */
function makeDepsWithEnqueueSpy(enqueueSpy: NonNullable<BotDeps['enqueueMessage']>): BotDeps {
  return {
    processMessage: (): Promise<void> => Promise.resolve(),
    enqueueMessage: enqueueSpy,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('bot interception characterization', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()
  })

  test('a normal authorized DM message is enqueued to the orchestrator', async () => {
    // Arrange: authorize a regular user and give them a task assignment so the
    // setup wizard does NOT auto-start (which would intercept the message).
    addUser('char-normal-user', ADMIN_ID)
    setupUserConfig('char-normal-user')

    const enqueue = mock(() => undefined)
    const deps = makeDepsWithEnqueueSpy(enqueue)

    const { provider, getMessageHandler } = createMockChatForBot()
    setupBot(provider, ADMIN_ID, deps)

    const handler = getMessageHandler()
    expect(handler).not.toBeNull()

    const { reply } = createMockReply()
    const msg: IncomingMessage = { ...createDmMessage('char-normal-user'), text: 'create a task please' }

    // Act: drive the message through the full onIncomingMessage path.
    await handler!(msg, reply)

    // Assert: the message reached the enqueue gate — maybeInterceptWizard
    // returned false (no wizard/editor/selector session active) and handleMessage
    // called queueMessage with the injected spy.
    expect(enqueue).toHaveBeenCalledTimes(1)
  })

  test('a command invoked via the command router does NOT reach enqueueMessage', async () => {
    // Commands are dispatched through registered command handlers, not through
    // onMessage, so the enqueue path is never entered for command traffic.
    const enqueue = mock(() => undefined)
    const deps = makeDepsWithEnqueueSpy(enqueue)

    const { provider, commandHandlers } = createMockChatWithCommandHandlers()
    setupBot(provider, ADMIN_ID, deps)

    // The 'help' command handler was registered via registerHelpCommand.
    const helpHandler = commandHandlers.get('help')
    expect(helpHandler).toBeDefined()

    const { reply } = createMockReply()
    const msg: IncomingMessage = { ...createDmMessage(ADMIN_ID), text: '/help', commandMatch: 'help' }

    // Act: simulate the platform routing /help to the command handler directly.
    // The auth argument is not used by the help handler itself; we pass a minimal
    // authorized auth object matching the admin user.
    await helpHandler!(msg, reply, {
      allowed: true,
      isBotAdmin: true,
      isGroupAdmin: false,
      storageContextId: scopedDm(ADMIN_ID),
      configContextId: scopedDm(ADMIN_ID),
    })

    // Assert: the command handler handled the request without touching the
    // enqueue path — confirming commands bypass the message queue.
    expect(enqueue).not.toHaveBeenCalled()
  })
})
