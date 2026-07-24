// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import {
  closeEpoch,
  getEpochState,
  incrementEpochSourceCounter,
  markOpenEpochsStaleOnStartup,
  openEpoch,
  requireOpenEpoch,
} from '../../../src/analytics/storage/epoch-store.js'
import * as schema from '../../../src/db/schema.js'
import { setupTestDb } from '../../utils/test-helpers.js'
import { TEST_EPOCH_ID, type Db } from '../storage-fixtures.js'

describe('analytics epoch storage', () => {
  let db: Db

  beforeEach(async () => {
    db = await setupTestDb()
  })

  test('legal open to closed transition', () => {
    openEpoch({ epochId: TEST_EPOCH_ID, startedAtMs: 1700000000000 }, { getDrizzleDb: () => db })
    closeEpoch({ epochId: TEST_EPOCH_ID, closedAtMs: 1700000000001 }, { getDrizzleDb: () => db })
    expect(getEpochState({ epochId: TEST_EPOCH_ID }, { getDrizzleDb: () => db })?.state).toBe('closed')
  })

  test('startup marks stale open epochs older than threshold', () => {
    openEpoch({ epochId: TEST_EPOCH_ID, startedAtMs: 1700000000000 }, { getDrizzleDb: () => db })
    markOpenEpochsStaleOnStartup({ nowMs: 1700003600000, staleThresholdMs: 1000 }, { getDrizzleDb: () => db })
    expect(getEpochState({ epochId: TEST_EPOCH_ID }, { getDrizzleDb: () => db })?.state).toBe('stale_open')
  })

  test('close timestamps are monotonic', () => {
    openEpoch({ epochId: TEST_EPOCH_ID, startedAtMs: 1700000000000 }, { getDrizzleDb: () => db })
    closeEpoch({ epochId: TEST_EPOCH_ID, closedAtMs: 1700000000002 }, { getDrizzleDb: () => db })
    expect(() =>
      closeEpoch({ epochId: TEST_EPOCH_ID, closedAtMs: 1700000000001 }, { getDrizzleDb: () => db }),
    ).toThrow()
  })

  test('bounded dispositions for epoch source counters', () => {
    openEpoch({ epochId: TEST_EPOCH_ID, startedAtMs: 1700000000000 }, { getDrizzleDb: () => db })
    incrementEpochSourceCounter(
      { epochId: TEST_EPOCH_ID, utcDay: '2026-01-01', sourceFamily: 'llm', disposition: 'canonical', value: 1 },
      { getDrizzleDb: () => db },
    )
    const row = db.select().from(schema.analyticsEpochSourceCounters).get()
    expect(row).toBeDefined()
    expect(row?.value).toBe(1)

    expect(() =>
      incrementEpochSourceCounter(
        { epochId: TEST_EPOCH_ID, utcDay: '2026-01-01', sourceFamily: 'llm', disposition: 'invalid', value: 1 },
        { getDrizzleDb: () => db },
      ),
    ).toThrow()
  })

  test('requireOpenEpoch throws for missing epoch', () => {
    expect(() => requireOpenEpoch({ epochId: 'missing' }, { getDrizzleDb: () => db })).toThrow()
  })

  test('requireOpenEpoch throws for closed epoch', () => {
    openEpoch({ epochId: TEST_EPOCH_ID, startedAtMs: 1700000000000 }, { getDrizzleDb: () => db })
    closeEpoch({ epochId: TEST_EPOCH_ID, closedAtMs: 1700000000001 }, { getDrizzleDb: () => db })
    expect(() => requireOpenEpoch({ epochId: TEST_EPOCH_ID }, { getDrizzleDb: () => db })).toThrow()
  })
})
