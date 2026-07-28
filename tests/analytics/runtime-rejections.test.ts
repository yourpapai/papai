// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { KeyVersionSchema, VersionStringSchema } from '../../src/analytics/controlled-types.js'
import type { EligibilityDecision } from '../../src/analytics/governance/eligibility.js'
import type { NormalizerEnv } from '../../src/analytics/normalizer.js'
import { createAnalyticsObserver } from '../../src/analytics/runtime.js'
import type { AnalyticsRuntimeDeps, NormalizationRejection } from '../../src/analytics/runtime.js'
import { createRecordingHealth, createRecordingSinks } from '../../src/analytics/runtime.testing.js'
import type { AnalyticsSourceContext, ChatMessageAcceptedFact } from '../../src/analytics/source-facts.js'
import { incrementNormalizationRejection } from '../../src/analytics/storage/rejection-store.js'
import { toScopedContextId } from '../../src/chat/scoped-context.js'
import * as schema from '../../src/db/schema.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

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
  sourceEventId: `se-rej-${ordinal}`,
  occurredAtMs: 1_700_000_000_000 + ordinal,
  source: memberSource,
  inputCount: 1,
  inputLengthChars: 200,
  attachmentCount: 0,
  isCommand: false,
  command: 'none',
})

const expiredFact = (ordinal: number): ChatMessageAcceptedFact => ({ ...messageFact(ordinal), occurredAtMs: 0 })

const aggregateDecision: EligibilityDecision = {
  allowed: true,
  lane: 'local_aggregate',
  policyVersion: 3,
  collectionEligibility: null,
  deliveryGrant: null,
}

const warnings: { meta: Record<string, unknown>; message: string }[] = []
const log = {
  warn: (meta: Record<string, unknown>, message: string): void => {
    warnings.push({ meta, message })
  },
}

const rejectionRows = (db: Db): readonly { utcDay: string; sourceEventType: string; reason: string; count: number }[] =>
  db.select().from(schema.analyticsNormalizationRejections).all()

const makeObserver = (
  db: Db,
  overrides: Partial<AnalyticsRuntimeDeps>,
): {
  observer: ReturnType<typeof createAnalyticsObserver>
  sinks: ReturnType<typeof createRecordingSinks>
  health: ReturnType<typeof createRecordingHealth>
  recorded: NormalizationRejection[]
} => {
  const sinks = createRecordingSinks()
  const health = createRecordingHealth()
  const recorded: NormalizationRejection[] = []
  const observer = createAnalyticsObserver({
    decide: () => aggregateDecision,
    normalizerEnv: () => env,
    health,
    log,
    sinks: sinks.sinks,
    onNormalizationRejection: (rejection) => {
      recorded.push(rejection)
      incrementNormalizationRejection(rejection, { getDrizzleDb: () => db })
    },
    ...overrides,
  })
  return { observer, sinks, health, recorded }
}

describe('live normalization rejection accounting', () => {
  let db: Db

  beforeEach(async () => {
    mockLogger()
    db = await setupTestDb()
  })

  test('a rejected fact produces one bounded rejection row with the fact day/type/reason and one health increment', async () => {
    const { observer, sinks, health } = makeObserver(db, {})
    observer.observe(expiredFact(1))
    await observer.flush()
    expect(rejectionRows(db)).toEqual([
      { utcDay: '1970-01-01', sourceEventType: 'chat_message_accepted', reason: 'invalid_value', count: 1 },
    ])
    expect(health.counts.normalization_rejection).toBe(1)
    expect(sinks.events).toHaveLength(0)
    expect(sinks.aggregates).toHaveLength(0)
  })

  test('a burst of N rejections of the same type and reason accumulates into a single bounded row', async () => {
    const { observer, health } = makeObserver(db, {})
    for (let ordinal = 1; ordinal <= 5; ordinal += 1) observer.observe(expiredFact(ordinal))
    await observer.flush()
    expect(rejectionRows(db)).toEqual([
      { utcDay: '1970-01-01', sourceEventType: 'chat_message_accepted', reason: 'invalid_value', count: 5 },
    ])
    expect(health.counts.normalization_rejection).toBe(5)
  })

  test('a fact dropped because the normalizer env is unavailable is recorded with the fact day and type', async () => {
    const { observer, sinks, health, recorded } = makeObserver(db, { normalizerEnv: () => null })
    expect(() => {
      observer.observe(messageFact(1))
    }).not.toThrow()
    await observer.flush()
    expect(recorded).toEqual([
      { utcDay: '2023-11-14', sourceEventType: 'chat_message_accepted', reason: 'normalizer_unavailable' },
    ])
    expect(rejectionRows(db)).toEqual([
      { utcDay: '2023-11-14', sourceEventType: 'chat_message_accepted', reason: 'normalizer_unavailable', count: 1 },
    ])
    expect(health.counts.normalization_rejection).toBe(1)
    expect(sinks.events).toHaveLength(0)
    expect(sinks.aggregates).toHaveLength(0)
  })

  test('the chat path never throws and the fact stays dropped when rejection accounting itself fails', async () => {
    const { observer, sinks, health } = makeObserver(db, {
      onNormalizationRejection: () => {
        throw new Error('rejection store offline')
      },
    })
    expect(() => {
      observer.observe(expiredFact(1))
    }).not.toThrow()
    await observer.flush()
    expect(health.counts.normalization_rejection).toBe(1)
    expect(health.counts.observer_failure).toBe(1)
    expect(sinks.events).toHaveLength(0)
    expect(sinks.aggregates).toHaveLength(0)
    const warning = warnings[warnings.length - 1]
    expect(JSON.stringify(warning?.meta)).not.toContain('rejection store offline')
  })
})
