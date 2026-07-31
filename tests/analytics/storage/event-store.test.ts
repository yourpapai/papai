// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { eq } from 'drizzle-orm'

import { insertCanonicalEvent, insertCanonicalEventForBackfill } from '../../../src/analytics/storage/event-store.js'
import * as schema from '../../../src/db/schema.js'
import { setupTestDb } from '../../utils/test-helpers.js'
import {
  ALT_STORAGE_GENERATION,
  countEvents,
  createTestBackfillRun,
  createTestEpoch,
  eventInsertInput,
  getBackfillMapRow,
  makeTestEvent,
  TEST_EPOCH_ID,
  TEST_RUN_ID,
  type Db,
} from '../storage-fixtures.js'

describe('analytics event storage', () => {
  let db: Db

  beforeEach(async () => {
    db = await setupTestDb()
  })

  test('inserting the same canonical event twice swallows duplicate and keeps durable epoch', () => {
    createTestEpoch(db)
    const event = makeTestEvent()
    const input = eventInsertInput(event)

    const first = insertCanonicalEvent(input, { getDrizzleDb: () => db })
    expect(first.status).toBe('created')

    const second = insertCanonicalEvent(input, { getDrizzleDb: () => db })
    expect(second.status).toBe('already_present')
    expect(second.processEpochId).toBe(first.processEpochId)
    expect(second.eventId).toBe(first.eventId)
    expect(countEvents(db)).toBe(1)
  })

  test('same logical event in distinct storage generations gets distinct physical ids', () => {
    createTestEpoch(db)
    const event = makeTestEvent()

    const first = insertCanonicalEvent(eventInsertInput(event), { getDrizzleDb: () => db })
    const second = insertCanonicalEvent(
      { ...eventInsertInput(event), storageGeneration: ALT_STORAGE_GENERATION },
      { getDrizzleDb: () => db },
    )

    expect(first.status).toBe('created')
    expect(second.status).toBe('created')
    expect(first.eventId).not.toBe(second.eventId)
    expect(countEvents(db)).toBe(2)

    const rows = db.select().from(schema.analyticsEvents).all()
    for (const row of rows) {
      expect(row.eventId).not.toBe(event.event.id)
    }
  })

  test('insertCanonicalEventForBackfill writes map only on first creation', () => {
    createTestEpoch(db)
    createTestBackfillRun(db)
    const event = makeTestEvent()
    const input = { ...eventInsertInput(event), runId: TEST_RUN_ID }

    const first = insertCanonicalEventForBackfill(input, { getDrizzleDb: () => db })
    expect(first.status).toBe('created')
    expect(getBackfillMapRow(db, event.event.id)).toBeDefined()

    const second = insertCanonicalEventForBackfill(input, { getDrizzleDb: () => db })
    expect(second.status).toBe('already_present')
    expect(countEvents(db)).toBe(1)
    const maps = db.select().from(schema.analyticsBackfillEventMap).all()
    expect(maps.length).toBe(1)
  })

  test('backfill event transaction rolls back when map insert fails', () => {
    createTestEpoch(db)
    const event = makeTestEvent()
    const input = { ...eventInsertInput(event), runId: 'non-existent-run' }

    expect(() => insertCanonicalEventForBackfill(input, { getDrizzleDb: () => db })).toThrow()
    expect(countEvents(db)).toBe(0)
  })

  test('insert rejects a missing epoch', () => {
    const event = makeTestEvent()
    expect(() => insertCanonicalEvent(eventInsertInput(event), { getDrizzleDb: () => db })).toThrow()
  })

  test('insert rejects a closed epoch', () => {
    db.insert(schema.analyticsProcessEpochs)
      .values({ epochId: TEST_EPOCH_ID, state: 'open', startedAtMs: 1700000000000 })
      .run()
    db.update(schema.analyticsProcessEpochs)
      .set({ state: 'closed', closedAtMs: 1700000000001 })
      .where(eq(schema.analyticsProcessEpochs.epochId, TEST_EPOCH_ID))
      .run()
    const event = makeTestEvent()
    expect(() => insertCanonicalEvent(eventInsertInput(event), { getDrizzleDb: () => db })).toThrow()
  })
})
