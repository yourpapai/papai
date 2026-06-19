// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { getThreadScopedStorageContextId } from '../src/auth.js'
import { setupBot } from '../src/bot.js'
import type { BotDeps } from '../src/bot.js'
import type { ReplyFn } from '../src/chat/types.js'
import { setConfig, setConfigValue } from '../src/config.js'
import { setContextSettings } from '../src/instances/context-store.js'
import { insertTaskInstance, getTaskInstance } from '../src/instances/task-store.js'
import { runRegistry } from '../src/run-control/registry.js'
import { KANEO_PLUGIN_CREDENTIAL_KEY } from '../src/types/config.js'
import { addUser as addScopedUser } from '../src/users.js'
import {
  createDmMessage,
  createMockChatForBot,
  createMockReply,
  mockLogger,
  seedCommonTestPlatformInstances,
  setupTestDb,
} from './utils/test-helpers.js'

const TEST_PLATFORM_ID = 'test-instance'
const ADMIN_ID = 'steering-admin'

function scopedDm(userId: string): string {
  return getThreadScopedStorageContextId(userId, 'dm', undefined, TEST_PLATFORM_ID)
}

function addUser(userId: string, addedBy: string): void {
  addScopedUser({ userId, platformInstanceId: TEST_PLATFORM_ID, addedBy })
}

function setupUserConfig(userId: string): void {
  const contextIds = new Set([userId, scopedDm(userId)])
  for (const contextId of contextIds) {
    const taskInstanceId = `${contextId}-kaneo-test`
    if (getTaskInstance(taskInstanceId) === null) {
      insertTaskInstance({
        id: taskInstanceId,
        type: 'kaneo',
        config: { baseUrl: 'https://kaneo.invalid' },
        status: 'active',
      })
    }
    setContextSettings({ contextId, taskInstanceId, platformInstanceId: 'telegram-default' })
    setConfigValue(contextId, KANEO_PLUGIN_CREDENTIAL_KEY, 'test-kaneo-key')
    setConfig(contextId, 'timezone', 'UTC')
  }
}

describe('mid-run steering routing', () => {
  let getMessageHandler: () => ((msg: ReturnType<typeof createDmMessage>, reply: ReplyFn) => Promise<void>) | null
  let enqueueCallCount: number

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()
    runRegistry.clear()
    enqueueCallCount = 0

    const { provider: mockChat, getMessageHandler: getHandler } = createMockChatForBot()
    getMessageHandler = getHandler as typeof getMessageHandler

    const botDeps: BotDeps = {
      processMessage: (): Promise<void> => Promise.resolve(),
      enqueueMessage: (...args): void => {
        enqueueCallCount++
        // invoke the handler synchronously so tests don't need to tick
        void args[2]({
          text: args[0].text,
          userId: args[0].userId,
          username: args[0].username,
          storageContextId: args[0].storageContextId,
          configContextId: args[0].configContextId,
          contextType: args[0].contextType,
          newAttachmentIds: args[0].newAttachmentIds,
          voiceStagedIds: args[0].voiceStagedIds,
          reply: args[1],
          turnId: 'test-turn-id',
        }).catch(() => {})
      },
    }

    setupBot(mockChat, ADMIN_ID, botDeps)
  })

  afterEach(() => {
    runRegistry.clear()
  })

  test('a message during an active run is pushed to the steer queue with an ack and does not enqueue a turn', async () => {
    const userId = 'steer-user-1'
    addUser(userId, ADMIN_ID)
    setupUserConfig(userId)

    const storageContextId = scopedDm(userId)

    // Simulate an active run for the DM user's storage context
    const { reply: runReply } = createMockReply()
    const run = runRegistry.begin(storageContextId, { turnId: 't1', reply: runReply })

    const { reply, textCalls } = createMockReply()
    const messageHandler = getMessageHandler()
    expect(messageHandler).not.toBeNull()

    await messageHandler!({ ...createDmMessage(userId), text: 'only project X' }, reply)

    expect(run.steerQueue).toEqual([{ text: 'only project X' }])
    expect(textCalls.some((c) => c.includes('folding'))).toBe(true)
    expect(enqueueCallCount).toBe(0)
  })
})
