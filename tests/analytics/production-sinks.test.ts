// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { createContributorTracker } from '../../src/analytics/aggregate-contributors.js'
import { VersionStringSchema } from '../../src/analytics/controlled-types.js'
import { createProductionSinks } from '../../src/analytics/production-sinks.js'
import type { QueuedAggregateIncrement } from '../../src/analytics/runtime.js'
import { openEpoch } from '../../src/analytics/storage/epoch-store.js'
import * as schema from '../../src/db/schema.js'
import { setupTestDb } from '../utils/test-helpers.js'

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

describe('production sinks', () => {
  let db: Db

  beforeEach(async () => {
    db = await setupTestDb()
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
})
