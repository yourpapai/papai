// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import type { AnalyticsObserver } from '../src/analytics/runtime.js'
import type { AnalyticsSourceFact } from '../src/analytics/source-facts.js'
import { registerCommands } from '../src/bot-command-wiring.js'
import type { CommandHandler } from '../src/chat/types.js'
import { addUser } from '../src/users.js'
import {
  createAuth,
  createDmMessage,
  createMockChat,
  createMockReply,
  mockLogger,
  seedCommonTestPlatformInstances,
  setupTestDb,
} from './utils/test-helpers.js'

const TEST_PLATFORM_ID = 'test-instance'

function createFactRecorder(): { observer: AnalyticsObserver; facts: AnalyticsSourceFact[] } {
  const facts: AnalyticsSourceFact[] = []
  return {
    facts,
    observer: {
      observe: (fact: AnalyticsSourceFact): void => {
        facts.push(fact)
      },
      flush: (): Promise<void> => Promise.resolve(),
      stop: (): Promise<void> => Promise.resolve(),
    },
  }
}

describe('registerCommands analytics wiring', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()
  })

  test('authorized command emits auth_checked and one accepted fact with command invocation mode', async () => {
    addUser({ userId: 'wired-user', platformInstanceId: TEST_PLATFORM_ID, addedBy: 'test' })
    const { observer, facts } = createFactRecorder()
    const commandHandlers = new Map<string, CommandHandler>()
    registerCommands(createMockChat({ commandHandlers }), 'admin', observer)
    const helpHandler = commandHandlers.get('help')
    assert.ok(helpHandler !== undefined)

    await helpHandler(createDmMessage('wired-user', 'help'), createMockReply().reply, createAuth('wired-user'))

    const authFacts = facts.filter((fact) => fact.type === 'auth_checked')
    const accepted = facts.filter((fact) => fact.type === 'chat_message_accepted')
    expect(authFacts).toHaveLength(1)
    expect(accepted).toHaveLength(1)
    const fact = accepted[0]!
    assert.ok(fact.type === 'chat_message_accepted')
    expect(fact.source.invocationMode).toBe('command')
    expect(fact.command).toBe('help')
    expect(fact.source.rawTurnId).toBeNull()
  })

  test('denied command emits only a denied auth_checked fact', async () => {
    const { observer, facts } = createFactRecorder()
    const commandHandlers = new Map<string, CommandHandler>()
    registerCommands(createMockChat({ commandHandlers }), 'admin', observer)
    const helpHandler = commandHandlers.get('help')
    assert.ok(helpHandler !== undefined)

    await helpHandler(createDmMessage('stranger-wired', 'help'), createMockReply().reply, createAuth('stranger-wired'))

    const authFacts = facts.filter((fact) => fact.type === 'auth_checked')
    expect(authFacts).toHaveLength(1)
    const authFact = authFacts[0]!
    assert.ok(authFact.type === 'auth_checked')
    expect(authFact.outcome).toBe('denied')
    expect(facts.filter((fact) => fact.type === 'chat_message_accepted')).toHaveLength(0)
  })

  test('reply_sent for a command reply carries a null turn key', async () => {
    addUser({ userId: 'reply-user', platformInstanceId: TEST_PLATFORM_ID, addedBy: 'test' })
    const { observer, facts } = createFactRecorder()
    const commandHandlers = new Map<string, CommandHandler>()
    registerCommands(createMockChat({ commandHandlers }), 'admin', observer)
    const helpHandler = commandHandlers.get('help')
    assert.ok(helpHandler !== undefined)

    await helpHandler(createDmMessage('reply-user', 'help'), createMockReply().reply, createAuth('reply-user'))

    const replyFacts = facts.filter((fact) => fact.type === 'reply_sent')
    expect(replyFacts).toHaveLength(1)
    const replyFact = replyFacts[0]!
    assert.ok(replyFact.type === 'reply_sent')
    expect(replyFact.source.rawTurnId).toBeNull()
    expect(replyFact.delivery).toBe('success')
    expect(replyFact.partCount).toBeGreaterThan(0)
  })

  test('without an observer the wrapper behaves exactly as before', async () => {
    addUser({ userId: 'plain-user', platformInstanceId: TEST_PLATFORM_ID, addedBy: 'test' })
    const commandHandlers = new Map<string, CommandHandler>()
    registerCommands(createMockChat({ commandHandlers }), 'admin')
    const helpHandler = commandHandlers.get('help')
    assert.ok(helpHandler !== undefined)

    const { reply, textCalls } = createMockReply()
    await helpHandler(createDmMessage('plain-user', 'help'), reply, createAuth('plain-user'))
    expect(textCalls.length).toBeGreaterThan(0)
  })
})
