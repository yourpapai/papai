// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { asc, sql } from 'drizzle-orm'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import {
  memoryProjectionOutbox,
  type MemoryProjectionOutboxRow,
  memoryProjectionRecords,
  type MemoryProjectionRecordRow,
} from '../../src/db/schema.js'
import { captureCanonicalEvent } from '../../src/long-term-memory/canonical-capture.js'
import { MAX_PROJECTION_ATTEMPTS } from '../../src/long-term-memory/projection-apply.js'
import {
  drainProjectionOutbox,
  PROJECTION_DRAIN_LIMIT,
  projectionCheckpoint,
  repairFailedProjections,
} from '../../src/long-term-memory/projection-drain.js'
import type { MemoryRecordInput } from '../../src/long-term-memory/types.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const NOW = '2026-08-02T15:00:00.000Z'

const input = (overrides: Partial<MemoryRecordInput> = {}): MemoryRecordInput => ({
  id: 'rec-1',
  scopeId: 'user-1',
  scopeType: 'personal',
  kind: 'fact',
  content: 'likes dark mode',
  summary: null,
  tags: ['ui'],
  confidence: 0.9,
  status: 'active',
  source: 'background',
  evidence: {},
  createdAt: '2026-08-01T12:00:00.000Z',
  updatedAt: '2026-08-01T12:00:00.000Z',
  lastSeenAt: '2026-08-01T12:00:00.000Z',
  ...overrides,
})

const shadow = (): MemoryProjectionRecordRow[] => getDrizzleDb().select().from(memoryProjectionRecords).all()
const outbox = (): MemoryProjectionOutboxRow[] =>
  getDrizzleDb().select().from(memoryProjectionOutbox).orderBy(asc(memoryProjectionOutbox.position)).all()

const captureMany = (count: number): void => {
  for (let index = 0; index < count; index += 1) {
    captureCanonicalEvent(input({ id: `rec-${index}`, content: `fact number ${index}` }), `rec-${index}`, NOW)
  }
}

const failTheShadowWrite = (): void => {
  getDrizzleDb().run(
    sql`CREATE TRIGGER fail_projection_insert BEFORE INSERT ON memory_projection_records
        BEGIN SELECT RAISE(ABORT, 'injected projection fault'); END`,
  )
}

const clearTheFault = (): void => {
  getDrizzleDb().run(sql`DROP TRIGGER IF EXISTS fail_projection_insert`)
}

const drainUnderFault = (times: number): void => {
  failTheShadowWrite()
  for (let attempt = 0; attempt < times; attempt += 1) drainProjectionOutbox(NOW)
  clearTheFault()
}

describe('drainProjectionOutbox', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  afterEach(() => {
    clearTheFault()
    delete process.env['MEMORY_CANONICAL_PROJECTION']
  })

  test('an empty outbox drains to zeros', () => {
    expect(drainProjectionOutbox(NOW)).toEqual({ applied: 0, superseded: 0, failed: 0, remaining: 0 })
  })

  test('a drain applies every pending item and reports the counts', () => {
    captureMany(3)

    expect(drainProjectionOutbox(NOW)).toEqual({ applied: 3, superseded: 0, failed: 0, remaining: 0 })
    expect(shadow()).toHaveLength(3)
  })

  test('B2 is holdable: without a drain the item stays pending and no shadow row exists', () => {
    captureMany(1)

    expect(outbox()[0]?.state).toBe('pending')
    expect(shadow()).toHaveLength(0)
  })

  test('a second drain finds nothing left to do', () => {
    captureMany(2)
    drainProjectionOutbox(NOW)

    expect(drainProjectionOutbox(NOW)).toEqual({ applied: 0, superseded: 0, failed: 0, remaining: 0 })
  })

  test('a superseded item is counted separately from an applied one', () => {
    // Two distinct events (different content, hence different idempotency identity) that
    // fold to the same shadow row (same recordId). The second-drained one carries an
    // event time strictly earlier than the first, so `winsAgainst` rejects it and it
    // resolves as 'superseded' rather than overwriting the incumbent shadow row.
    captureCanonicalEvent(input({ evidence: { timestamps: ['2026-08-05T00:00:00.000Z'] } }), 'rec-1', NOW)
    captureCanonicalEvent(
      input({ content: 'likes light mode', evidence: { timestamps: ['2026-08-01T00:00:00.000Z'] } }),
      'rec-1',
      NOW,
    )

    expect(drainProjectionOutbox(NOW)).toEqual({ applied: 1, superseded: 1, failed: 0, remaining: 0 })
    expect(shadow()).toHaveLength(1)
    expect(shadow()[0]?.content).toBe('likes dark mode')
  })

  test('the drain stops at the cap and reports the remainder', () => {
    captureMany(PROJECTION_DRAIN_LIMIT + 5)
    const result = drainProjectionOutbox(NOW)

    expect(result.applied).toBe(PROJECTION_DRAIN_LIMIT)
    expect(result.remaining).toBe(5)
  })

  test('a following drain clears the remainder', () => {
    captureMany(PROJECTION_DRAIN_LIMIT + 5)
    drainProjectionOutbox(NOW)

    expect(drainProjectionOutbox(NOW).applied).toBe(5)
    expect(shadow()).toHaveLength(PROJECTION_DRAIN_LIMIT + 5)
  })

  test('the kill switch off drains nothing and writes no shadow row', () => {
    captureMany(2)
    process.env['MEMORY_CANONICAL_PROJECTION'] = 'off'

    expect(drainProjectionOutbox(NOW)).toEqual({ applied: 0, superseded: 0, failed: 0, remaining: 0 })
    expect(shadow()).toHaveLength(0)
    expect(outbox()[0]?.state).toBe('pending')
  })

  test('failing items are counted and left for retry', () => {
    captureMany(2)
    failTheShadowWrite()
    const result = drainProjectionOutbox(NOW)
    clearTheFault()

    expect(result).toEqual({ applied: 0, superseded: 0, failed: 2, remaining: 2 })
    expect(outbox().every((row) => row.state === 'pending')).toBe(true)
    expect(shadow()).toHaveLength(0)
  })
})

describe('projectionCheckpoint', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('an undrained outbox has no checkpoint', () => {
    captureMany(2)

    expect(projectionCheckpoint()).toBeNull()
  })

  test('the checkpoint is the highest completed position', () => {
    captureMany(3)
    drainProjectionOutbox(NOW)
    const positions = outbox().map((row) => row.position)

    expect(projectionCheckpoint()).toBe(Math.max(...positions))
  })

  test('the checkpoint is the highest completed position, not the highest position overall', () => {
    captureMany(3)
    getDrizzleDb().run(
      sql`CREATE TRIGGER fail_last_projection BEFORE INSERT ON memory_projection_records
          WHEN NEW.record_id = 'rec-2'
          BEGIN SELECT RAISE(ABORT, 'injected projection fault for last item'); END`,
    )
    drainProjectionOutbox(NOW)
    getDrizzleDb().run(sql`DROP TRIGGER IF EXISTS fail_last_projection`)
    const rows = outbox()

    expect(rows.map((row) => row.state)).toEqual(['complete', 'complete', 'pending'])
    expect(projectionCheckpoint()).toBe(2)
    expect(projectionCheckpoint()).not.toBe(Math.max(...rows.map((row) => row.position)))
  })
})

describe('repairFailedProjections', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  afterEach(() => {
    clearTheFault()
  })

  test('nothing to repair returns zero', () => {
    expect(repairFailedProjections()).toBe(0)
  })

  test('a terminally failed item is re-driven to pending with a cleared error', () => {
    captureMany(1)
    drainUnderFault(MAX_PROJECTION_ATTEMPTS)

    expect(outbox()[0]?.state).toBe('failed')
    expect(repairFailedProjections()).toBe(1)
    expect(outbox()[0]?.state).toBe('pending')
    expect(outbox()[0]?.attemptCount).toBe(0)
    expect(outbox()[0]?.lastError).toBeNull()
  })

  test('a repaired item applies on the next drain', () => {
    captureMany(1)
    drainUnderFault(MAX_PROJECTION_ATTEMPTS)
    repairFailedProjections()

    expect(drainProjectionOutbox(NOW).applied).toBe(1)
    expect(shadow()).toHaveLength(1)
  })
})
