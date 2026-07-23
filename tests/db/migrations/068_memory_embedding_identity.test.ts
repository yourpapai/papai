// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { eq } from 'drizzle-orm'

import { getDrizzleDb } from '../../../src/db/drizzle.js'
import { migration068MemoryEmbeddingIdentity } from '../../../src/db/migrations/068_memory_embedding_identity.js'
import { memoryRecords } from '../../../src/db/schema.js'
import { setupTestDb } from '../../utils/test-helpers.js'

const baseRow = {
  scopeId: 'user-1',
  scopeType: 'personal' as const,
  kind: 'fact' as const,
  content: 'anything',
  tags: '[]',
  confidence: 1,
  status: 'active' as const,
  source: 'explicit' as const,
  evidence: '{}',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  lastSeenAt: '2026-07-01T00:00:00.000Z',
}

describe('migration 068 embedding identity', () => {
  test('migration id is 068_memory_embedding_identity', () => {
    expect(migration068MemoryEmbeddingIdentity.id).toBe('068_memory_embedding_identity')
  })

  test('round-trips the four identity columns', async () => {
    await setupTestDb()

    getDrizzleDb()
      .insert(memoryRecords)
      .values({
        ...baseRow,
        id: 'rec-1',
        embedding: Buffer.from(new Float32Array([0.1, 0.2]).buffer),
        embeddingModel: 'text-embedding-3-small',
        embeddingDimension: 2,
        embeddingVersion: 'text-embedding-3-small:2',
        embeddedAt: '2026-07-01T00:00:00.000Z',
      })
      .run()

    const row = getDrizzleDb().select().from(memoryRecords).where(eq(memoryRecords.id, 'rec-1')).get()
    expect(row?.embeddingModel).toBe('text-embedding-3-small')
    expect(row?.embeddingDimension).toBe(2)
    expect(row?.embeddingVersion).toBe('text-embedding-3-small:2')
    expect(row?.embeddedAt).toBe('2026-07-01T00:00:00.000Z')
  })

  test('leaves identity columns null for a record with no embedding', async () => {
    await setupTestDb()

    getDrizzleDb()
      .insert(memoryRecords)
      .values({ ...baseRow, id: 'rec-2' })
      .run()

    const row = getDrizzleDb().select().from(memoryRecords).where(eq(memoryRecords.id, 'rec-2')).get()
    expect(row?.embeddingVersion).toBeNull()
    expect(row?.embeddingModel).toBeNull()
    expect(row?.embeddingDimension).toBeNull()
    expect(row?.embeddedAt).toBeNull()
  })
})
