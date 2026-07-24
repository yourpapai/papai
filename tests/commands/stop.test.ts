// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import type { AnalyticsObserver } from '../../src/analytics/runtime.js'
import type { AnalyticsSourceFact } from '../../src/analytics/source-facts.js'
import type { CommandHandler } from '../../src/chat/types.js'
import { registerStopCommand } from '../../src/commands/stop.js'
import { runRegistry } from '../../src/run-control/registry.js'
import {
  createAuth,
  createDmMessage,
  createMockChatWithCommandHandlers,
  createMockReply,
  mockLogger,
  seedCommonTestPlatformInstances,
  setupTestDb,
} from '../utils/test-helpers.js'

describe('/stop command', () => {
  beforeEach(() => {
    mockLogger()
    runRegistry.clear()
  })
  afterEach(() => runRegistry.clear())

  function getHandler(): CommandHandler {
    const { provider, commandHandlers } = createMockChatWithCommandHandlers()
    registerStopCommand(provider)
    const handler = commandHandlers.get('stop')
    if (handler === undefined) throw new Error('stop handler not registered')
    return handler
  }

  test('no active run: replies that nothing is running', async () => {
    const handler = getHandler()
    const { reply, textCalls } = createMockReply()
    await handler(createDmMessage('user-1'), reply, createAuth('user-1'))
    expect(textCalls.some((t) => /nothing is running/iu.test(t))).toBe(true)
  })

  test('first /stop on an active run sets stopRequested and acks winding down', async () => {
    const handler = getHandler()
    const run = runRegistry.begin('user-1', { turnId: 't1', reply: createMockReply().reply, originatingMessageIds: [] })
    const { reply, textCalls } = createMockReply()
    await handler(createDmMessage('user-1'), reply, createAuth('user-1'))
    expect(run.stopRequested).toBe(true)
    expect(run.abortController.signal.aborted).toBe(false)
    expect(textCalls.some((t) => /winding down/iu.test(t))).toBe(true)
  })

  test('second /stop while stopping force-aborts', async () => {
    const handler = getHandler()
    const run = runRegistry.begin('user-1', { turnId: 't1', reply: createMockReply().reply, originatingMessageIds: [] })
    run.stopRequested = true
    const { reply, textCalls } = createMockReply()
    await handler(createDmMessage('user-1'), reply, createAuth('user-1'))
    expect(run.abortController.signal.aborted).toBe(true)
    expect(textCalls.some((t) => /immediately/iu.test(t))).toBe(true)
  })

  test('unauthorized user is rejected without touching the run', async () => {
    const handler = getHandler()
    const run = runRegistry.begin('user-1', { turnId: 't1', reply: createMockReply().reply, originatingMessageIds: [] })
    const { reply, textCalls } = createMockReply()
    await handler(createDmMessage('user-1'), reply, createAuth('user-1', { allowed: false }))
    expect(run.stopRequested).toBe(false)
    expect(textCalls).toHaveLength(0)
  })
})

describe('/stop command analytics', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()
    runRegistry.clear()
  })
  afterEach(() => runRegistry.clear())

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

  function getObservedHandler(observer: AnalyticsObserver): CommandHandler {
    const { provider, commandHandlers } = createMockChatWithCommandHandlers()
    registerStopCommand(provider, observer)
    const handler = commandHandlers.get('stop')
    if (handler === undefined) throw new Error('stop handler not registered')
    return handler
  }

  function stopFacts(
    facts: readonly AnalyticsSourceFact[],
  ): Extract<AnalyticsSourceFact, { type: 'turn_stop_requested' }>[] {
    return facts.filter(
      (fact): fact is Extract<AnalyticsSourceFact, { type: 'turn_stop_requested' }> =>
        fact.type === 'turn_stop_requested',
    )
  }

  test('first graceful request emits exactly one turn_stop_requested with stage graceful', async () => {
    const { observer, facts } = createFactRecorder()
    const handler = getObservedHandler(observer)
    runRegistry.begin('user-1', { turnId: 't-grace', reply: createMockReply().reply })

    await handler(createDmMessage('user-1'), createMockReply().reply, createAuth('user-1'))

    const stops = stopFacts(facts)
    expect(stops).toHaveLength(1)
    expect(stops[0]!.stage).toBe('graceful')
    expect(stops[0]!.source.rawTurnId).toBe('t-grace')
    expect(stops[0]!.source.invocationMode).toBe('command')
  })

  test('subsequent forced request emits exactly one turn_stop_requested with stage forced', async () => {
    const { observer, facts } = createFactRecorder()
    const handler = getObservedHandler(observer)
    const run = runRegistry.begin('user-1', { turnId: 't-forced', reply: createMockReply().reply })
    run.stopRequested = true

    await handler(createDmMessage('user-1'), createMockReply().reply, createAuth('user-1'))

    const stops = stopFacts(facts)
    expect(stops).toHaveLength(1)
    expect(stops[0]!.stage).toBe('forced')
    expect(stops[0]!.source.rawTurnId).toBe('t-forced')
  })

  test('graceful then forced emits exactly one fact per stage', async () => {
    const { observer, facts } = createFactRecorder()
    const handler = getObservedHandler(observer)
    runRegistry.begin('user-1', { turnId: 't-both', reply: createMockReply().reply })

    await handler(createDmMessage('user-1'), createMockReply().reply, createAuth('user-1'))
    await handler(createDmMessage('user-1'), createMockReply().reply, createAuth('user-1'))

    expect(stopFacts(facts).map((fact) => fact.stage)).toEqual(['graceful', 'forced'])
  })

  test('no active run emits no stop fact', async () => {
    const { observer, facts } = createFactRecorder()
    const handler = getObservedHandler(observer)

    await handler(createDmMessage('user-1'), createMockReply().reply, createAuth('user-1'))

    expect(stopFacts(facts)).toHaveLength(0)
  })
})
