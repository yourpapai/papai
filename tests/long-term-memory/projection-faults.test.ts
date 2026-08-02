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
import { applyOutboxItem, MAX_PROJECTION_ATTEMPTS } from '../../src/long-term-memory/projection-apply.js'
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

const firstPosition = (): number => {
  const head = outbox()[0]
  if (head === undefined) throw new Error('no outbox rows')
  return head.position
}

/** Injects a fault at exactly the B3 boundary: on the shadow-row write, mid-transaction. */
const failTheShadowWrite = (): void => {
  getDrizzleDb().run(
    sql`CREATE TRIGGER fail_projection_insert BEFORE INSERT ON memory_projection_records
        BEGIN SELECT RAISE(ABORT, 'injected projection fault'); END`,
  )
}

const clearTheFault = (): void => {
  getDrizzleDb().run(sql`DROP TRIGGER IF EXISTS fail_projection_insert`)
}

const applyUnderFault = (position: number, times: number): void => {
  failTheShadowWrite()
  for (let attempt = 0; attempt < times; attempt += 1) applyOutboxItem(position, NOW)
  clearTheFault()
}

describe('projection apply faults', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    captureCanonicalEvent(input(), 'rec-1', NOW)
  })

  afterEach(() => {
    clearTheFault()
  })

  test('B3 is unreachable: a fault mid-apply leaves no shadow row and no completed item', () => {
    const position = firstPosition()
    applyUnderFault(position, 1)

    expect(shadow()).toHaveLength(0)
    expect(outbox()[0]?.state).toBe('pending')
  })

  test('a failed apply reports failed rather than throwing', () => {
    failTheShadowWrite()
    const position = firstPosition()
    const run = (): unknown => applyOutboxItem(position, NOW)

    expect(run).not.toThrow()
    clearTheFault()
  })

  test('the attempt count and error survive the rolled-back transaction', () => {
    applyUnderFault(firstPosition(), 1)

    expect(outbox()[0]?.attemptCount).toBe(1)
    expect(outbox()[0]?.lastAttemptAt).toBe(NOW)
    expect(outbox()[0]?.lastError).toContain('injected projection fault')
  })

  test('the item stays pending while attempts remain', () => {
    applyUnderFault(firstPosition(), MAX_PROJECTION_ATTEMPTS - 1)

    expect(outbox()[0]?.attemptCount).toBe(MAX_PROJECTION_ATTEMPTS - 1)
    expect(outbox()[0]?.state).toBe('pending')
  })

  test('the item fails terminally once the attempt bound is reached', () => {
    applyUnderFault(firstPosition(), MAX_PROJECTION_ATTEMPTS)

    expect(outbox()[0]?.attemptCount).toBe(MAX_PROJECTION_ATTEMPTS)
    expect(outbox()[0]?.state).toBe('failed')
  })

  test('a terminal failure leaves the canonical evidence untouched', () => {
    applyUnderFault(firstPosition(), MAX_PROJECTION_ATTEMPTS)

    expect(shadow()).toHaveLength(0)
    expect(outbox()).toHaveLength(1)
  })

  test('apply recovers once the fault clears', () => {
    const position = firstPosition()
    applyUnderFault(position, 1)

    expect(applyOutboxItem(position, NOW)).toBe('applied')
    expect(shadow()).toHaveLength(1)
    expect(outbox()[0]?.state).toBe('complete')
  })
})
