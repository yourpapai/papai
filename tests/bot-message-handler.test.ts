// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'

import type { AuthorizedTurnSeed } from '../src/analytics/bot-observer.js'
import type { AnalyticsObserver } from '../src/analytics/runtime.js'
import type { AnalyticsSourceContext, AnalyticsSourceFact } from '../src/analytics/source-facts.js'
import { createTurnContextRegistry } from '../src/analytics/turn-context.js'
import { processQueuedTurn, type BotDeps } from '../src/bot-message-handler.js'
import type { CoalescedItem } from '../src/message-queue/types.js'
import { createMockReply, mockLogger } from './utils/test-helpers.js'

function createSource(actorRole: AnalyticsSourceContext['actorRole'] = 'member'): AnalyticsSourceContext {
  return {
    platform: 'telegram',
    platformInstanceId: 'test-instance',
    chatUserId: 'user-1',
    nativeContextId: 'user-1',
    storageContextId: 'test-instance:user-1',
    configContextId: 'test-instance:user-1',
    contextType: 'dm',
    actorRole,
    taskInstanceId: null,
    taskProvider: 'none',
    invocationMode: 'normal',
    rawTurnId: null,
  }
}

function createSeed(source: AnalyticsSourceContext): AuthorizedTurnSeed {
  return {
    sourceEventId: 'seed-event-1',
    acceptedAtMs: Date.now(),
    acceptedAtMonotonicMs: performance.now(),
    source,
    inputCount: 1,
    inputLength: 5,
    attachmentCount: 0,
  }
}

function createCoalesced(replyText: (text: string) => Promise<void>, seed?: AuthorizedTurnSeed): CoalescedItem {
  return {
    text: 'hello',
    userId: 'user-1',
    username: null,
    storageContextId: 'test-instance:user-1',
    configContextId: 'test-instance:user-1',
    contextType: 'dm',
    newAttachmentIds: [],
    voiceStagedIds: [],
    reply: { ...createMockReply().reply, text: replyText },
    turnId: 'turn-1',
    messageIds: [],
    segments: [],
    analyticsTurnSeed: seed,
  }
}

function createFactObserver(facts: AnalyticsSourceFact[]): AnalyticsObserver {
  return {
    observe: (fact: AnalyticsSourceFact): void => {
      facts.push(fact)
    },
    flush: (): Promise<void> => Promise.resolve(),
    stop: (): Promise<void> => Promise.resolve(),
  }
}

function factTypes(facts: readonly AnalyticsSourceFact[]): string[] {
  return facts.map((fact) => fact.type)
}

function factsOfType<T extends AnalyticsSourceFact['type']>(
  facts: readonly AnalyticsSourceFact[],
  type: T,
): Extract<AnalyticsSourceFact, { type: T }>[] {
  return facts.filter((fact): fact is Extract<AnalyticsSourceFact, { type: T }> => fact.type === type)
}

describe('processQueuedTurn', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('emits turn_started, reply_sent, and turn_completed around a successful queued turn', async () => {
    const facts: AnalyticsSourceFact[] = []
    const registry = createTurnContextRegistry()
    const seed = createSeed(createSource())
    const deps: BotDeps = {
      processMessage: async (reply): Promise<void> => {
        await reply.text('turn reply')
      },
      analyticsObserver: createFactObserver(facts),
      analyticsTurnRegistry: registry,
    }

    await processQueuedTurn(
      createCoalesced(() => Promise.resolve(), seed),
      deps,
    )

    expect(factTypes(facts)).toEqual(['turn_started', 'reply_sent', 'turn_completed'])
    const [started] = factsOfType(facts, 'turn_started')
    assert.ok(started !== undefined)
    expect(started.source.rawTurnId).toBe('turn-1')
    expect(started.incomingMessageCount).toBe(1)
    expect(started.queueWaitMs).toBeGreaterThanOrEqual(0)
    const [replied] = factsOfType(facts, 'reply_sent')
    assert.ok(replied !== undefined)
    expect(replied.delivery).toBe('success')
    expect(replied.partCount).toBe(1)
    expect(replied.source.rawTurnId).toBe('turn-1')
    const [completed] = factsOfType(facts, 'turn_completed')
    assert.ok(completed !== undefined)
    expect(completed.outcome).toBe('ok')
    expect(completed.durationMs).toBeGreaterThanOrEqual(0)
    expect(completed.replyCount).toBe(1)
    expect(completed.source.rawTurnId).toBe('turn-1')
    assert.ok(registry.resolve('turn-1') !== null)
    expect(registry.resolve('turn-1')?.rawTurnId).toBe('turn-1')
  })

  test('marks llm_error with duration but never leaks the raw exception message', async () => {
    const facts: AnalyticsSourceFact[] = []
    const seed = createSeed(createSource())
    const deps: BotDeps = {
      processMessage: (): Promise<void> => Promise.reject(new Error('sensitive-boom-xyz')),
      analyticsObserver: createFactObserver(facts),
      analyticsTurnRegistry: createTurnContextRegistry(),
    }

    await expect(
      processQueuedTurn(
        createCoalesced(() => Promise.resolve(), seed),
        deps,
      ),
    ).rejects.toThrow('sensitive-boom-xyz')

    const [completed] = factsOfType(facts, 'turn_completed')
    assert.ok(completed !== undefined)
    expect(completed.outcome).toBe('llm_error')
    expect(completed.durationMs).toBeGreaterThanOrEqual(0)
    expect(JSON.stringify(facts)).not.toContain('sensitive-boom-xyz')
  })

  test('guest turns emit only the guest aggregate and skip the registry', async () => {
    const facts: AnalyticsSourceFact[] = []
    const registry = createTurnContextRegistry()
    const seed = createSeed(createSource('guest'))
    const deps: BotDeps = {
      processMessage: async (reply): Promise<void> => {
        await reply.text('guest reply')
      },
      analyticsObserver: createFactObserver(facts),
      analyticsTurnRegistry: registry,
    }

    await processQueuedTurn(
      createCoalesced(() => Promise.resolve(), seed),
      deps,
    )

    expect(factTypes(facts)).toEqual(['guest_turn_aggregate'])
    const [aggregate] = factsOfType(facts, 'guest_turn_aggregate')
    assert.ok(aggregate !== undefined)
    expect(aggregate.turns).toBe(1)
    expect(aggregate.successfulTurns).toBe(1)
    expect(aggregate.failedTurns).toBe(0)
    expect(registry.resolve('turn-1')).toBeNull()
  })

  test('runs the turn without analytics when no observer is configured', async () => {
    let called = 0
    const deps: BotDeps = {
      processMessage: async (reply): Promise<void> => {
        called += 1
        await reply.text('plain reply')
      },
    }

    await processQueuedTurn(
      createCoalesced(() => Promise.resolve(), undefined),
      deps,
    )

    expect(called).toBe(1)
  })
})
