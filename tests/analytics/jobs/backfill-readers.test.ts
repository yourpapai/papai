// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import {
  computeBound,
  formatHighWaterKey,
  hashHighWaterKey,
  highWaterBoundMs,
  readLlmBatch,
} from '../../../src/analytics/jobs/backfill-readers.js'
import * as schema from '../../../src/db/schema.js'
import { mockLogger, setupTestDb } from '../../utils/test-helpers.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

const KEY = Buffer.alloc(32, 7)

const rowAt = (
  rows: readonly { occurredAt: number; eventId: string }[],
  index: number,
): { occurredAt: number; eventId: string } => {
  const row = rows[index]
  if (row === undefined) throw new Error('expected row')
  return row
}

const boundKeyOf = (bound: { occurredAt: number; eventId: string } | null): string =>
  bound === null ? 'none' : formatHighWaterKey(bound, 'llm_usage_events', KEY, 'v1')

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

  test('formatHighWaterKey keeps the ms bound but never the raw event id', () => {
    insertLlm(db, 'e-9', 42)
    const persisted = boundKeyOf(computeBound(db, 'llm_usage_events', 0))
    expect(persisted).toMatch(/^42:v1\.[-_A-Za-z0-9]+$/u)
    expect(persisted).not.toContain('e-9')
    expect(highWaterBoundMs(persisted)).toBe(42)
  })
})
