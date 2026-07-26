// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import {
  computeBound,
  formatRowKey,
  hashHighWaterKey,
  readLlmBatch,
} from '../../../src/analytics/jobs/backfill-readers.js'
import * as schema from '../../../src/db/schema.js'
import { mockLogger, setupTestDb } from '../../utils/test-helpers.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

const rowAt = (
  rows: readonly { occurredAt: number; eventId: string }[],
  index: number,
): { occurredAt: number; eventId: string } => {
  const row = rows[index]
  if (row === undefined) throw new Error('expected row')
  return row
}

const boundKeyOf = (bound: { occurredAt: number; eventId: string } | null): string =>
  bound === null ? 'none' : formatRowKey(bound)

const insertLlm = (db: Db, eventId: string, occurredAt: number): void => {
  db.insert(schema.llmUsageEvents)
    .values({
      eventId,
      occurredAt,
      turnId: null,
      storageContextId: 'sc',
      contextType: 'dm',
      chatUserId: 'u',
      model: 'm',
      modelRole: 'main',
      inputTokens: 1,
      outputTokens: 1,
      stepCount: 0,
      toolCallCount: 0,
      messageCount: 0,
      finishReason: null,
      durationMs: 1,
      responseId: null,
      error: null,
    })
    .run()
}

describe('backfill readers', () => {
  let db: Db

  beforeEach(async () => {
    mockLogger()
    db = await setupTestDb()
  })

  test('high-water hash is bounded and stable', () => {
    expect(hashHighWaterKey('1000:e-1')).toBe(hashHighWaterKey('1000:e-1'))
    expect(hashHighWaterKey('1000:e-1')).toHaveLength(16)
    expect(hashHighWaterKey('1000:e-1')).not.toContain('e-1')
  })

  test('computeBound returns the latest keyset row at or after the cutoff', () => {
    insertLlm(db, 'e-1', 1000)
    insertLlm(db, 'e-2', 2000)
    insertLlm(db, 'e-0', 500)
    expect(computeBound(db, 'llm_usage_events', 0)).toEqual({ occurredAt: 2000, eventId: 'e-2' })
    expect(computeBound(db, 'llm_usage_events', 1500)).toEqual({ occurredAt: 2000, eventId: 'e-2' })
    expect(computeBound(db, 'llm_usage_events', 3000)).toBeNull()
  })

  test('readLlmBatch paginates by keyset without offset and stays within the bound', () => {
    for (const [id, at] of [
      ['e-1', 1000],
      ['e-2', 1000],
      ['e-3', 2000],
      ['e-4', 3000],
    ] as const) {
      insertLlm(db, id, at)
    }
    const bound = { occurredAt: 2000, eventId: 'e-3' }
    const first = readLlmBatch(db, { cutoffMs: 0, bound, cursor: null, limit: 2 })
    expect(first.map((row) => row.eventId)).toEqual(['e-1', 'e-2'])
    const second = readLlmBatch(db, { cutoffMs: 0, bound, cursor: rowAt(first, 1), limit: 2 })
    expect(second.map((row) => row.eventId)).toEqual(['e-3'])
  })

  test('formatRowKey round-trips through bound computation', () => {
    insertLlm(db, 'e-9', 42)
    const bound = computeBound(db, 'llm_usage_events', 0)
    expect(boundKeyOf(bound)).toBe('42:e-9')
  })
})
