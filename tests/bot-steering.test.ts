// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import type { AnalyticsObserver } from '../src/analytics/runtime.js'
import type { AnalyticsSourceFact } from '../src/analytics/source-facts.js'
import { getThreadScopedStorageContextId } from '../src/auth.js'
import { setupBot } from '../src/bot.js'
import type { BotDeps } from '../src/bot.js'
import type { ReplyFn } from '../src/chat/types.js'
import { setConfigValue } from '../src/config.js'
import { setConfig } from '../src/config.testing.js'
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
          messageIds: args[0].messageId === undefined ? [] : [args[0].messageId],
          segments:
            args[0].messageId === undefined
              ? []
              : [{ messageId: args[0].messageId, text: args[0].text, username: args[0].username }],
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
    const run = runRegistry.begin(storageContextId, { turnId: 't1', reply: runReply, originatingMessageIds: [] })

    const { reply, textCalls } = createMockReply()
    const messageHandler = getMessageHandler()
    expect(messageHandler).not.toBeNull()

    await messageHandler!({ ...createDmMessage(userId), text: 'only project X' }, reply)

    expect(run.steerQueue).toEqual([{ text: 'only project X' }])
    expect(textCalls.some((c) => c.includes('folding'))).toBe(true)
    expect(enqueueCallCount).toBe(0)
  })
})

describe('mid-run steering analytics', () => {
  let facts: AnalyticsSourceFact[]
  let getMessageHandler: () => ((msg: ReturnType<typeof createDmMessage>, reply: ReplyFn) => Promise<void>) | null

  function steeredFacts(): Extract<AnalyticsSourceFact, { type: 'turn_steered' }>[] {
    return facts.filter(
      (fact): fact is Extract<AnalyticsSourceFact, { type: 'turn_steered' }> => fact.type === 'turn_steered',
    )
  }

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()
    runRegistry.clear()
    facts = []

    const observer: AnalyticsObserver = {
      observe: (fact: AnalyticsSourceFact): void => {
        facts.push(fact)
      },
      flush: (): Promise<void> => Promise.resolve(),
      stop: (): Promise<void> => Promise.resolve(),
    }
    const { provider: mockChat, getMessageHandler: getHandler } = createMockChatForBot()
    getMessageHandler = getHandler as typeof getMessageHandler

    const botDeps: BotDeps = {
      processMessage: (): Promise<void> => Promise.resolve(),
      enqueueMessage: (): void => {},
      analyticsObserver: observer,
    }

    setupBot(mockChat, ADMIN_ID, botDeps)
  })

  afterEach(() => {
    runRegistry.clear()
  })

  test('emits turn_steered with ordinal, bounded length, and ack result but never the steer text', async () => {
    const userId = 'steer-user-analytics'
    addUser(userId, ADMIN_ID)
    const storageContextId = scopedDm(userId)
    const { reply: runReply } = createMockReply()
    runRegistry.begin(storageContextId, { turnId: 't-steer-1', reply: runReply })

    const messageHandler = getMessageHandler()
    assert.ok(messageHandler !== null)
    const { reply, textCalls } = createMockReply()
    await messageHandler({ ...createDmMessage(userId), text: 'only project X' }, reply)
    await messageHandler({ ...createDmMessage(userId), text: 'and also Y' }, reply)

    expect(textCalls.filter((c) => c.includes('folding'))).toHaveLength(2)
    const steered = steeredFacts()
    expect(steered).toHaveLength(2)
    expect(steered.map((fact) => fact.ordinal)).toEqual([1, 2])
    expect(steered.map((fact) => fact.steerLengthChars)).toEqual([14, 10])
    expect(steered.map((fact) => fact.ackSent)).toEqual([true, true])
    expect(steered.map((fact) => fact.source.rawTurnId)).toEqual(['t-steer-1', 't-steer-1'])
    expect(steered.map((fact) => fact.source.invocationMode)).toEqual(['normal', 'normal'])
    expect(JSON.stringify(facts)).not.toContain('only project X')
    expect(JSON.stringify(facts)).not.toContain('and also Y')
    expect(facts.filter((fact) => fact.type === 'turn_started')).toHaveLength(0)
  })
})
