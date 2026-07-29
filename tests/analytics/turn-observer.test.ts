// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { AuthorizedTurnSeed } from '../../src/analytics/bot-observer.js'
import type { AnalyticsSourceContext } from '../../src/analytics/source-facts.js'
import {
  buildGuestTurnAggregateFact,
  buildTurnCompletedFact,
  buildTurnStartedFact,
  buildTurnSteeredFact,
  buildTurnStopRequestedFact,
  mergeAnalyticsTurnSeeds,
  nextSteerOrdinal,
} from '../../src/analytics/turn-observer.js'
import type { QueueItem } from '../../src/message-queue/types.js'
import { RunRegistry } from '../../src/run-control/registry.js'
import { createMockReply } from '../utils/test-helpers.js'

function sourceOf(overrides: Partial<AnalyticsSourceContext> = {}): AnalyticsSourceContext {
  return {
    platform: 'telegram',
    platformInstanceId: 'test-instance',
    chatUserId: 'u1',
    nativeContextId: 'u1',
    storageContextId: 'pi:dGVzdA:ctx:dTE',
    configContextId: 'pi:dGVzdA:ctx:dTE',
    contextType: 'dm',
    actorRole: 'member',
    taskInstanceId: null,
    taskProvider: 'none',
    invocationMode: 'normal',
    rawTurnId: null,
    ...overrides,
  }
}

function seedOf(overrides: Partial<AuthorizedTurnSeed> = {}): AuthorizedTurnSeed {
  return {
    sourceEventId: 'seed-1',
    acceptedAtMs: 1000,
    acceptedAtMonotonicMs: 100,
    source: sourceOf(),
    inputCount: 1,
    inputLength: 5,
    attachmentCount: 0,
    ...overrides,
  }
}

function queueItemOf(seed: AuthorizedTurnSeed | undefined): QueueItem {
  return {
    text: 'hi',
    userId: 'u1',
    username: null,
    storageContextId: 'ctx',
    contextType: 'dm',
    newAttachmentIds: [],
    voiceStagedIds: [],
    ...(seed === undefined ? {} : { analyticsTurnSeed: seed }),
  }
}

describe('mergeAnalyticsTurnSeeds', () => {
  test('returns undefined when no item carries a seed', () => {
    expect(mergeAnalyticsTurnSeeds([queueItemOf(undefined)])).toBeUndefined()
  })

  test('coalescing retains the last actor source and sums input and attachment counts', () => {
    const first = seedOf({
      sourceEventId: 'seed-a',
      acceptedAtMs: 1000,
      acceptedAtMonotonicMs: 100,
      source: sourceOf({ chatUserId: 'u-first', actorRole: 'member' }),
      inputLength: 5,
      attachmentCount: 1,
    })
    const last = seedOf({
      sourceEventId: 'seed-b',
      acceptedAtMs: 1400,
      acceptedAtMonotonicMs: 300,
      source: sourceOf({ chatUserId: 'u-last', actorRole: 'admin' }),
      inputLength: 7,
      attachmentCount: 2,
    })
    const merged = mergeAnalyticsTurnSeeds([queueItemOf(first), queueItemOf(last)])
    expect(merged).toBeDefined()
    expect(merged?.source).toBe(last.source)
    expect(merged?.sourceEventId).toBe('seed-b')
    expect(merged?.inputCount).toBe(2)
    expect(merged?.inputLength).toBe(12)
    expect(merged?.attachmentCount).toBe(3)
  })

  test('keeps the earliest accept timestamps for monotonic queue-wait measurement', () => {
    const first = seedOf({ acceptedAtMs: 1000, acceptedAtMonotonicMs: 100 })
    const last = seedOf({ acceptedAtMs: 1400, acceptedAtMonotonicMs: 300 })
    const merged = mergeAnalyticsTurnSeeds([queueItemOf(first), queueItemOf(last)])
    expect(merged?.acceptedAtMs).toBe(1000)
    expect(merged?.acceptedAtMonotonicMs).toBe(100)
  })
})

describe('turn fact builders', () => {
  test('turn_started carries coalesced counts and monotonic queue wait', () => {
    const seed = seedOf({ inputCount: 2, attachmentCount: 3 })
    const source = sourceOf({ rawTurnId: 'turn-1' })
    const fact = buildTurnStartedFact(seed, source, 42)
    expect(fact.type).toBe('turn_started')
    expect(fact.incomingMessageCount).toBe(2)
    expect(fact.attachmentCount).toBe(3)
    expect(fact.queueWaitMs).toBe(42)
    expect(fact.source.rawTurnId).toBe('turn-1')
    expect(fact.sourceEventId).toBe('seed-1:turn_started')
  })

  test('turn_completed carries outcome, monotonic duration, and reply count without error text', () => {
    const seed = seedOf()
    const fact = buildTurnCompletedFact(seed, sourceOf({ rawTurnId: 'turn-1' }), {
      outcome: 'llm_error',
      durationMs: 120,
      replyCount: 1,
    })
    expect(fact.type).toBe('turn_completed')
    expect(fact.outcome).toBe('llm_error')
    expect(fact.durationMs).toBe(120)
    expect(fact.replyCount).toBe(1)
    expect(fact.finishReason).toBe('unknown')
    expect(JSON.stringify(fact)).not.toContain('boom')
    expect(fact.sourceEventId).toBe('seed-1:turn_completed')
  })

  test('guest turn aggregate carries per-turn counts and the accept day', () => {
    const seed = seedOf({ acceptedAtMs: Date.UTC(2026, 6, 24, 12) })
    const fact = buildGuestTurnAggregateFact(seed, sourceOf({ actorRole: 'guest' }), 'ok')
    expect(fact.type).toBe('guest_turn_aggregate')
    expect(fact.utcDay).toBe('2026-07-24')
    expect(fact.turns).toBe(1)
    expect(fact.successfulTurns).toBe(1)
    expect(fact.failedTurns).toBe(0)
    expect(fact.contextCount).toBe(1)
  })

  test('guest turn aggregate marks failures', () => {
    const fact = buildGuestTurnAggregateFact(seedOf(), sourceOf({ actorRole: 'guest' }), 'llm_error')
    expect(fact.successfulTurns).toBe(0)
    expect(fact.failedTurns).toBe(1)
  })
})

describe('steering and stop fact builders', () => {
  test('turn_steered carries ordinal, length, and ack without steer text', () => {
    const fact = buildTurnSteeredFact(sourceOf({ rawTurnId: 'turn-9' }), {
      sourceEventId: 'steer-1',
      ordinal: 2,
      steerLengthChars: 14,
      ackSent: true,
    })
    expect(fact.type).toBe('turn_steered')
    expect(fact.ordinal).toBe(2)
    expect(fact.steerLengthChars).toBe(14)
    expect(fact.ackSent).toBe(true)
    expect(fact.source.rawTurnId).toBe('turn-9')
    expect(JSON.stringify(fact)).not.toContain('only project X')
  })

  test('turn_stop_requested carries only the bounded stage', () => {
    const fact = buildTurnStopRequestedFact(sourceOf({ rawTurnId: 'turn-9' }), 'forced')
    expect(fact.type).toBe('turn_stop_requested')
    expect(fact.stage).toBe('forced')
    expect(fact.source.rawTurnId).toBe('turn-9')
  })

  test('steer ordinals are monotonic per run and reset across runs', () => {
    const registry = new RunRegistry()
    const runA = registry.begin('ctx-a', { turnId: 'a', reply: createMockReply().reply, originatingMessageIds: [] })
    const runB = registry.begin('ctx-b', { turnId: 'b', reply: createMockReply().reply, originatingMessageIds: [] })
    expect(nextSteerOrdinal(runA)).toBe(1)
    expect(nextSteerOrdinal(runA)).toBe(2)
    expect(nextSteerOrdinal(runB)).toBe(1)
  })
})
