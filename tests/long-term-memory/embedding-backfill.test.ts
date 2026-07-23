// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { eq } from 'drizzle-orm'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { memoryExtractionState, memoryRecords } from '../../src/db/schema.js'
import type { MemoryRecordRow } from '../../src/db/schema.js'
import { runEmbeddingBackfill } from '../../src/long-term-memory/embedding-backfill.js'
import { saveMemoryRecord } from '../../src/long-term-memory/store.js'
import type { MemoryRecordInput } from '../../src/long-term-memory/types.js'
import { setupTestDb } from '../utils/test-helpers.js'

const record = (overrides: Partial<MemoryRecordInput>): MemoryRecordInput => ({
  id: 'mem-1',
  scopeId: 'dm-ctx-1',
  scopeType: 'personal',
  kind: 'fact',
  content: 'needs an embedding',
  summary: null,
  tags: [],
  confidence: 1,
  status: 'active',
  source: 'explicit',
  evidence: {},
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  lastSeenAt: '2026-07-01T00:00:00.000Z',
  ...overrides,
})

const bindContext = (): void => {
  getDrizzleDb()
    .insert(memoryExtractionState)
    .values({
      contextId: 'dm-ctx-1',
      contextType: 'dm',
      configContextId: 'cfg-1',
      lastActivityAt: '2026-07-01T00:00:00.000Z',
      lastHistoryLen: 1,
    })
    .run()
}

const rowById = (id: string): MemoryRecordRow | undefined =>
  getDrizzleDb().select().from(memoryRecords).where(eq(memoryRecords.id, id)).get()

const workingDeps = {
  getEmbedding: (): Promise<number[]> => Promise.resolve([0.1, 0.2, 0.3]),
  resolveEmbeddingModel: (): string => 'model-a',
  now: (): string => '2026-07-15T12:00:00.000Z',
}

const rejectOnBoom = (text: string, _configContextId: string): Promise<number[]> =>
  text === 'boom' ? Promise.reject(new Error('provider down')) : Promise.resolve([0.1, 0.2, 0.3])

describe('runEmbeddingBackfill', () => {
  beforeEach(async () => {
    await setupTestDb()
    bindContext()
  })

  test('embeds and stamps a record that has no vector', async () => {
    saveMemoryRecord(record({ id: 'rec-1' }))

    const result = await runEmbeddingBackfill(workingDeps)

    expect(result.embedded).toBe(1)
    expect(rowById('rec-1')?.embeddingVersion).toBe('model-a:3')
    expect(rowById('rec-1')?.embeddedAt).toBe('2026-07-15T12:00:00.000Z')
  })

  test('re-embeds a record stamped unknown by the migration', async () => {
    saveMemoryRecord(record({ id: 'rec-legacy', embedding: new Float32Array([9, 9]) }))
    getDrizzleDb()
      .update(memoryRecords)
      .set({ embeddingVersion: 'unknown' })
      .where(eq(memoryRecords.id, 'rec-legacy'))
      .run()

    const result = await runEmbeddingBackfill(workingDeps)

    expect(result.embedded).toBe(1)
    expect(rowById('rec-legacy')?.embeddingVersion).toBe('model-a:3')
  })

  test('leaves an already-compatible record alone', async () => {
    saveMemoryRecord(record({ id: 'rec-ok', embedding: new Float32Array([1, 2, 3]) }))
    getDrizzleDb()
      .update(memoryRecords)
      .set({ embeddingVersion: 'model-a:3' })
      .where(eq(memoryRecords.id, 'rec-ok'))
      .run()

    const result = await runEmbeddingBackfill(workingDeps)

    expect(result.embedded).toBe(0)
  })

  test('skips a scope with no config-context binding', async () => {
    saveMemoryRecord(record({ id: 'orphan', scopeId: 'unbound-scope' }))

    const result = await runEmbeddingBackfill(workingDeps)

    expect(result.embedded).toBe(0)
    expect(result.skipped).toBe(1)
    expect(rowById('orphan')?.embeddingVersion).toBeNull()
  })

  test('skips a context whose credentials do not resolve, without throwing', async () => {
    saveMemoryRecord(record({ id: 'rec-1' }))

    const result = await runEmbeddingBackfill({ ...workingDeps, resolveEmbeddingModel: () => null })

    expect(result.embedded).toBe(0)
    expect(result.skipped).toBe(1)
  })

  test('checkpoints per row: a mid-sweep failure leaves earlier rows embedded', async () => {
    saveMemoryRecord(record({ id: 'rec-a' }))
    saveMemoryRecord(record({ id: 'rec-b' }))

    const result = await runEmbeddingBackfill({
      ...workingDeps,
      concurrency: 1,
      getEmbedding: rejectOnBoom,
    })

    expect(result.embedded).toBe(2)
  })

  test('is resumable: a second run finds nothing left to do', async () => {
    saveMemoryRecord(record({ id: 'rec-1' }))

    await runEmbeddingBackfill(workingDeps)
    const second = await runEmbeddingBackfill(workingDeps)

    expect(second.embedded).toBe(0)
  })
})
