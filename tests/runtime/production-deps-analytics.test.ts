// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import type { AnalyticsObserver } from '../../src/analytics/runtime.js'
import type { AnalyticsSourceFact } from '../../src/analytics/source-facts.js'
import { createTurnContextRegistry } from '../../src/analytics/turn-context.js'
import { getThreadScopedStorageContextId } from '../../src/auth.js'
import { ChatRouter } from '../../src/chat/router.js'
import type { CommandHandler, IncomingMessage, ReplyFn } from '../../src/chat/types.js'
import { runRegistry } from '../../src/run-control/registry.js'
import { createProductionRuntimeDeps } from '../../src/runtime/production-deps.js'
import { addUser } from '../../src/users.js'
import {
  createAuth,
  createDmMessage,
  createMockChat,
  createMockReply,
  mockLogger,
  seedCommonTestPlatformInstances,
  setupTestDb,
} from '../utils/test-helpers.js'

const TEST_PLATFORM_ID = 'test-instance'
const ADMIN_ID = 'admin-analytics-di'

type ProductionAnalyticsHarness = Readonly<{
  facts: AnalyticsSourceFact[]
  getMessageHandler: () => ((msg: IncomingMessage, reply: ReplyFn) => Promise<void>) | null
  commandHandlers: Map<string, CommandHandler>
}>

function factsOfType<T extends AnalyticsSourceFact['type']>(
  facts: readonly AnalyticsSourceFact[],
  type: T,
): Extract<AnalyticsSourceFact, { type: T }>[] {
  return facts.filter((fact): fact is Extract<AnalyticsSourceFact, { type: T }> => fact.type === type)
}

function setupProductionAnalyticsBot(): ProductionAnalyticsHarness {
  const facts: AnalyticsSourceFact[] = []
  const observer: AnalyticsObserver = {
    observe: (fact: AnalyticsSourceFact): void => {
      facts.push(fact)
    },
    flush: (): Promise<void> => Promise.resolve(),
    stop: (): Promise<void> => Promise.resolve(),
  }
  const registry = createTurnContextRegistry()
  const commandHandlers = new Map<string, CommandHandler>()
  let messageHandler: ((msg: IncomingMessage, reply: ReplyFn) => Promise<void>) | null = null
  const mockProvider = createMockChat({
    commandHandlers,
    onMessageHandler: (handler): void => {
      messageHandler = handler
    },
  })
  const router = new ChatRouter(() => mockProvider)
  const deps = createProductionRuntimeDeps({}, { analytics: { observer, registry } })
  deps.application.setupBot(router, ADMIN_ID)
  router.addInstance(TEST_PLATFORM_ID, 'telegram', {})
  return { facts, getMessageHandler: () => messageHandler, commandHandlers }
}

describe('production analytics dependency injection', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()
    runRegistry.clear()
  })

  afterEach(() => {
    runRegistry.clear()
  })

  test('the state-owned observer instance reaches the normal message path', async () => {
    addUser({ userId: 'di-user', platformInstanceId: TEST_PLATFORM_ID, addedBy: ADMIN_ID })
    const harness = setupProductionAnalyticsBot()
    const storageContextId = getThreadScopedStorageContextId('di-user', 'dm', undefined, TEST_PLATFORM_ID)
    const { reply: runReply } = createMockReply()
    runRegistry.begin(storageContextId, { turnId: 't-di-run', reply: runReply })

    const messageHandler = harness.getMessageHandler()
    assert.ok(messageHandler !== null)
    await messageHandler({ ...createDmMessage('di-user'), text: 'steer this run' }, createMockReply().reply)

    expect(factsOfType(harness.facts, 'auth_checked')).toHaveLength(1)
    const accepted = factsOfType(harness.facts, 'chat_message_accepted')
    expect(accepted).toHaveLength(1)
    expect(accepted[0]?.source.invocationMode).toBe('normal')
    const steered = factsOfType(harness.facts, 'turn_steered')
    expect(steered).toHaveLength(1)
    expect(steered[0]?.source.rawTurnId).toBe('t-di-run')
  })

  test('the same state-owned observer instance reaches the observed command wrapper', async () => {
    addUser({ userId: 'di-cmd-user', platformInstanceId: TEST_PLATFORM_ID, addedBy: ADMIN_ID })
    const harness = setupProductionAnalyticsBot()

    const helpHandler = harness.commandHandlers.get('help')
    assert.ok(helpHandler !== undefined)
    await helpHandler(createDmMessage('di-cmd-user', 'help'), createMockReply().reply, createAuth('di-cmd-user'))

    const authFacts = factsOfType(harness.facts, 'auth_checked')
    expect(authFacts).toHaveLength(1)
    expect(authFacts[0]?.outcome).toBe('granted')
    const accepted = factsOfType(harness.facts, 'chat_message_accepted')
    expect(accepted).toHaveLength(1)
    expect(accepted[0]?.source.invocationMode).toBe('command')
    expect(accepted[0]?.command).toBe('help')
  })
})
