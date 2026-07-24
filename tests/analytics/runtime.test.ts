// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { KeyVersionSchema, VersionStringSchema } from '../../src/analytics/controlled-types.js'
import type { EligibilityDecision } from '../../src/analytics/governance/eligibility.js'
import type { NormalizerEnv } from '../../src/analytics/normalizer.js'
import { createAnalyticsObserver } from '../../src/analytics/runtime.js'
import type { AnalyticsRuntimeDeps } from '../../src/analytics/runtime.js'
import { createRecordingHealth, createRecordingSinks } from '../../src/analytics/runtime.testing.js'
import type {
  AnalyticsSourceContext,
  ChatMessageAcceptedFact,
  TurnSteeredFact,
} from '../../src/analytics/source-facts.js'
import { toScopedContextId } from '../../src/chat/scoped-context.js'

const env: NormalizerEnv = {
  hmacKey: Buffer.alloc(32, 7),
  keyVersion: KeyVersionSchema.parse('v1'),
  installId: 'install-uuid-1',
  appVersion: VersionStringSchema.parse('6.10.0'),
  policyVersion: 3,
  ingestedAtMs: 1_700_000_000_500,
}

const memberSource: AnalyticsSourceContext = {
  platform: 'telegram',
  platformInstanceId: 'pi-1',
  chatUserId: 'user-42',
  nativeContextId: 'user-42',
  storageContextId: toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'user-42' }),
  configContextId: toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'user-42' }),
  contextType: 'dm',
  actorRole: 'member',
  taskInstanceId: null,
  taskProvider: 'none',
  invocationMode: 'normal',
  rawTurnId: 'turn-raw-1',
}

const messageFact = (ordinal: number): ChatMessageAcceptedFact => ({
  version: 1,
  type: 'chat_message_accepted',
  sourceEventId: `se-${ordinal}`,
  occurredAtMs: 1_700_000_000_000 + ordinal,
  source: memberSource,
  inputCount: 1,
  inputLengthChars: 200,
  attachmentCount: 0,
  isCommand: false,
  command: 'none',
})

const steeredFact = (ordinal: number): TurnSteeredFact => ({
  version: 1,
  type: 'turn_steered',
  sourceEventId: `se-steer-${ordinal}`,
  occurredAtMs: 1_700_000_000_000 + ordinal,
  source: memberSource,
  ordinal: 1,
  steerLengthChars: 50,
  ackSent: true,
})

const pseudonymousDecision: EligibilityDecision = {
  allowed: true,
  lane: 'local_pseudonymous',
  policyVersion: 3,
  collectionEligibility: { refKey: 'ref-1', keyVersion: 'v1', generation: 1 },
  deliveryGrant: null,
}

const aggregateDecision: EligibilityDecision = {
  allowed: true,
  lane: 'local_aggregate',
  policyVersion: 3,
  collectionEligibility: null,
  deliveryGrant: null,
}

const deniedDecision: EligibilityDecision = { allowed: false, reason: 'mode_off' }

const warnings: { meta: Record<string, unknown>; message: string }[] = []
const log = {
  warn: (meta: Record<string, unknown>, message: string): void => {
    warnings.push({ meta, message })
  },
}

type RuntimeHarness = Readonly<{
  observer: ReturnType<typeof createAnalyticsObserver>
  sinks: ReturnType<typeof createRecordingSinks>
  health: ReturnType<typeof createRecordingHealth>
}>

const makeRuntime = (decide: AnalyticsRuntimeDeps['decide'], queueCapacity?: number): RuntimeHarness => {
  const sinks = createRecordingSinks()
  const health = createRecordingHealth()
  const deps: AnalyticsRuntimeDeps = {
    decide,
    normalizerEnv: () => env,
    health,
    log,
    sinks: sinks.sinks,
    ...(queueCapacity === undefined ? {} : { queueCapacity }),
  }
  return { observer: createAnalyticsObserver(deps), sinks, health }
}

const firstOf = <T>(items: readonly T[]): T => {
  const item = items[0]
  if (item === undefined) throw new Error('expected at least one item')
  return item
}

describe('analytics runtime', () => {
  test('bounded queue: capacity 2, 3 safe facts, two writes plus one queue_full loss', async () => {
    const { observer, sinks, health } = makeRuntime(() => pseudonymousDecision, 2)
    observer.observe(steeredFact(1))
    observer.observe(steeredFact(2))
    observer.observe(steeredFact(3))
    await observer.flush()
    expect(sinks.events).toHaveLength(2)
    expect(health.counts.queue_full).toBe(1)
  })

  test('aggregate increments use a separate bounded queue and never hold source facts', async () => {
    const { observer, sinks, health } = makeRuntime(() => aggregateDecision, 1)
    observer.observe(messageFact(1))
    observer.observe(messageFact(2))
    await observer.flush()
    expect(sinks.events).toHaveLength(0)
    expect(sinks.aggregates).toHaveLength(1)
    expect(health.counts.queue_full).toBe(1)
    const item = firstOf(sinks.aggregates)
    expect(item.increment).toEqual({ kind: 'counter', metric: 'message_accepted', delta: 1 })
    expect(item.utcDay).toBe('2023-11-14')
    expect(JSON.stringify(item)).not.toContain('user-42')
  })

  test('pseudonymous lane enqueues the normalized event with the exact collection ref sidecar', async () => {
    const { observer, sinks } = makeRuntime(() => pseudonymousDecision)
    observer.observe(messageFact(1))
    await observer.flush()
    expect(sinks.events).toHaveLength(1)
    const item = firstOf(sinks.events)
    expect(item.collectionRef).toEqual({ refKey: 'ref-1', keyVersion: 'v1', generation: 1 })
    expect(item.event.event.name).toBe('chat_message_accepted')
    expect(JSON.stringify(item.event)).not.toContain('ref-1')
    expect(sinks.aggregates).toHaveLength(1)
  })

  test('denied decisions enqueue nothing', async () => {
    const { observer, sinks, health } = makeRuntime(() => deniedDecision)
    observer.observe(messageFact(1))
    await observer.flush()
    expect(sinks.events).toHaveLength(0)
    expect(sinks.aggregates).toHaveLength(0)
    expect(health.counts.queue_full).toBe(0)
  })

  test('a pseudonymous decision missing its collection ref fails closed', async () => {
    const broken: EligibilityDecision = { ...pseudonymousDecision, collectionEligibility: null }
    const { observer, sinks, health } = makeRuntime(() => broken)
    observer.observe(messageFact(1))
    await observer.flush()
    expect(sinks.events).toHaveLength(0)
    expect(health.counts.observer_failure).toBe(1)
  })

  test('observe never throws and never logs fact payloads when a dependency throws', () => {
    const throwing = (): EligibilityDecision => {
      throw new Error('storage offline for user-42')
    }
    const { observer, health } = makeRuntime(throwing)
    expect(() => {
      observer.observe(messageFact(1))
    }).not.toThrow()
    expect(health.counts.observer_failure).toBe(1)
    const warning = firstOf(warnings.slice(-1))
    const serialized = JSON.stringify(warning.meta)
    expect(serialized).not.toContain('user-42')
    expect(serialized).not.toContain('storage offline')
    expect(warning.meta['factType']).toBe('chat_message_accepted')
  })

  test('flush is idempotent and stop drains then closes', async () => {
    const { observer, sinks } = makeRuntime(() => pseudonymousDecision)
    observer.observe(messageFact(1))
    await observer.flush()
    await observer.flush()
    expect(sinks.events).toHaveLength(1)
    observer.observe(messageFact(2))
    await observer.stop()
    expect(sinks.events).toHaveLength(2)
    observer.observe(messageFact(3))
    await observer.flush()
    expect(sinks.events).toHaveLength(2)
  })
})
