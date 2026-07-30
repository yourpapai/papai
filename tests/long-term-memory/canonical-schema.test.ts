// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import {
  memoryCanonicalCaptureAttempts,
  memoryCanonicalEvents,
  memoryCanonicalState,
  memoryProjectionOutbox,
} from '../../src/db/schema.js'
import { setupTestDb } from '../utils/test-helpers.js'

const requireDefined = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error('expected value to be defined')
  return value
}

const EVENT = {
  eventId: 'evt-1',
  idempotencyIdentity: 'ident-1',
  contentIdentity: 'content-1',
  scopeId: 'user-1',
  scopeType: 'personal',
  kind: 'fact',
  content: 'likes dark mode',
  confidence: 0.9,
  source: 'background',
  eventTime: '2026-07-30T00:00:00.000Z',
  ingestTime: '2026-07-30T00:00:01.000Z',
  lastObservedAt: '2026-07-30T00:00:00.000Z',
  schemaVersion: 1,
  captureVersion: 'v1',
} satisfies typeof memoryCanonicalEvents.$inferInsert

describe('canonical capture schema', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('the canonical tables start empty — the migration backfills nothing', () => {
    expect(getDrizzleDb().select().from(memoryCanonicalEvents).all()).toHaveLength(0)
    expect(getDrizzleDb().select().from(memoryProjectionOutbox).all()).toHaveLength(0)
    expect(getDrizzleDb().select().from(memoryCanonicalCaptureAttempts).all()).toHaveLength(0)
  })

  test('the migration records exactly one cutover marker', () => {
    const rows = getDrizzleDb().select().from(memoryCanonicalState).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe('singleton')
    expect(rows[0]?.cutoverAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u)
  })

  test('idempotency_identity is UNIQUE — a second event for one identity is rejected', () => {
    getDrizzleDb().insert(memoryCanonicalEvents).values(EVENT).run()
    expect(() => {
      getDrizzleDb()
        .insert(memoryCanonicalEvents)
        .values({ ...EVENT, eventId: 'evt-2' })
        .run()
    }).toThrow()
  })

  test('outbox positions are monotonic and never reused after deletion', () => {
    const db = getDrizzleDb()
    db.insert(memoryCanonicalEvents).values(EVENT).run()
    db.insert(memoryProjectionOutbox)
      .values({ eventId: 'evt-1', op: 'capture', state: 'pending', enqueuedAt: EVENT.ingestTime })
      .run()
    const first = requireDefined(db.select().from(memoryProjectionOutbox).all()[0]).position

    db.delete(memoryProjectionOutbox).run()
    db.insert(memoryProjectionOutbox)
      .values({ eventId: 'evt-1', op: 'observe', state: 'pending', enqueuedAt: EVENT.ingestTime })
      .run()
    const second = requireDefined(db.select().from(memoryProjectionOutbox).all()[0]).position

    expect(second).toBeGreaterThan(first)
  })
})
