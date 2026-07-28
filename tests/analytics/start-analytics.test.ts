// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { eq } from 'drizzle-orm'

import { createContributorTracker } from '../../src/analytics/aggregate-contributors.js'
import { ANALYTICS_HMAC_KEYRING_ENV } from '../../src/analytics/config.js'
import { VersionStringSchema } from '../../src/analytics/controlled-types.js'
import type { QueuedAggregateIncrement } from '../../src/analytics/runtime.js'
import type { AnalyticsSourceContext, ChatMessageAcceptedFact } from '../../src/analytics/source-facts.js'
import {
  createProductionSinks,
  getActiveAnalyticsRuntime,
  startAnalytics,
  stopAnalytics,
} from '../../src/analytics/start-analytics.js'
import { getOpenEpoch, openEpoch } from '../../src/analytics/storage/epoch-store.js'
import { toScopedContextId } from '../../src/chat/scoped-context.js'
import * as schema from '../../src/db/schema.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

const EPOCH_ID = 'epoch-prod-1'
const UTC_DAY = '2023-11-14'

const counterItem = (contributorKey: string | null): QueuedAggregateIncrement => ({
  increment: { kind: 'counter', metric: 'message_accepted', delta: 1 },
  utcDay: UTC_DAY,
  contributorKey,
  dimensions: {
    platform: 'telegram',
    context_type: 'dm',
    actor_role: 'member',
    task_provider: 'none',
    app_version: VersionStringSchema.parse('6.10.0'),
  },
})

const counterRow = (db: Db): { value: number; contributorCount: number | null } => {
  const row = db
    .select({
      value: schema.analyticsDailyCounters.value,
      contributorCount: schema.analyticsDailyCounters.contributorCount,
    })
    .from(schema.analyticsDailyCounters)
    .get()
  if (row === undefined) throw new Error('no counter row written')
  return row
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

const messageFact = (ordinal: number, baseMs: number): ChatMessageAcceptedFact => ({
  version: 1,
  type: 'chat_message_accepted',
  sourceEventId: `se-overflow-${ordinal}`,
  occurredAtMs: baseMs + ordinal,
  source: memberSource,
  inputCount: 1,
  inputLengthChars: 200,
  attachmentCount: 0,
  isCommand: false,
  command: 'none',
})

const restoreKeyringEnv = (saved: string | undefined): void => {
  if (saved === undefined) {
    Reflect.deleteProperty(process.env, ANALYTICS_HMAC_KEYRING_ENV)
    return
  }
  process.env[ANALYTICS_HMAC_KEYRING_ENV] = saved
}

describe('start-analytics', () => {
  let db: Db

  beforeEach(async () => {
    db = await setupTestDb()
  })

  test('stop without start is an idempotent no-op', async () => {
    await expect(stopAnalytics()).resolves.toBeUndefined()
    expect(typeof startAnalytics).toBe('function')
  })

  test('the production aggregate sink persists the distinct contributor count per cell', async () => {
    openEpoch({ epochId: EPOCH_ID, startedAtMs: 1700000000000 }, { getDrizzleDb: () => db })
    const sinks = createProductionSinks({
      epochId: EPOCH_ID,
      tracker: createContributorTracker(),
      getDrizzleDb: () => db,
    })
    await sinks.writeAggregates([counterItem('ck-a'), counterItem('ck-b'), counterItem('ck-a')])
    expect(counterRow(db)).toEqual({ value: 3, contributorCount: 2 })
  })

  test('the production aggregate sink records a null contributor count when the contributor key is unavailable', async () => {
    openEpoch({ epochId: EPOCH_ID, startedAtMs: 1700000000000 }, { getDrizzleDb: () => db })
    const sinks = createProductionSinks({
      epochId: EPOCH_ID,
      tracker: createContributorTracker(),
      getDrizzleDb: () => db,
    })
    await sinks.writeAggregates([counterItem(null)])
    expect(counterRow(db)).toEqual({ value: 1, contributorCount: null })
  })

  test('the live observer records the epoch-bound controlled overflow row on a full queue', async () => {
    mockLogger()
    db.update(schema.analyticsPolicy).set({ localMode: 'local_aggregate' }).run()
    const previousKeyring = process.env[ANALYTICS_HMAC_KEYRING_ENV]
    process.env[ANALYTICS_HMAC_KEYRING_ENV] = `v1:${'ab'.repeat(32)}`
    try {
      startAnalytics()
      const active = getActiveAnalyticsRuntime()
      assert(active !== null)
      const open = getOpenEpoch({ getDrizzleDb: () => db })
      assert(open !== null)
      const baseMs = Date.now() - 5000
      for (let ordinal = 0; ordinal < 1026; ordinal += 1) active.observer.observe(messageFact(ordinal, baseMs))

      const overflowRows = db
        .select()
        .from(schema.analyticsEpochSourceCounters)
        .where(eq(schema.analyticsEpochSourceCounters.disposition, 'controlled_overflow'))
        .all()
      expect(overflowRows.length).toBeGreaterThanOrEqual(1)
      for (const row of overflowRows) expect(row.epochId).toBe(open.epochId)
      expect(overflowRows.reduce((sum, row) => sum + row.value, 0)).toBe(2)
    } finally {
      restoreKeyringEnv(previousKeyring)
      await stopAnalytics()
    }
  })
})
