// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../../src/db/drizzle.js'
import { messageEmbeddings } from '../../../src/db/message-embeddings-schema.js'
import { migration071MessageEmbeddings } from '../../../src/db/migrations/071_message_embeddings.js'
import { mockLogger, setupTestDb } from '../../utils/test-helpers.js'

describe('migration 071_message_embeddings', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('migration id is 071_message_embeddings', () => {
    expect(migration071MessageEmbeddings.id).toBe('071_message_embeddings')
  })

  test('creates the message_embeddings table with the expected columns', () => {
    const db = getDrizzleDb().$client
    const cols = db
      .query<{ name: string; notnull: number; pk: number }, []>(`PRAGMA table_info(message_embeddings)`)
      .all()
    const names = cols.map((c) => c.name)
    for (const expected of [
      'context_id',
      'message_id',
      'embedding',
      'embedding_model',
      'embedding_dim',
      'embedded_at',
    ]) {
      expect(names).toContain(expected)
    }
    const pkCols = cols
      .filter((c) => c.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((c) => c.name)
    expect(pkCols).toEqual(['context_id', 'message_id'])
  })

  test('embedding column is nullable/blob', () => {
    const db = getDrizzleDb().$client
    const row = db
      .query<{ type: string; notnull: number }, []>(
        `SELECT type, "notnull" FROM pragma_table_info('message_embeddings') WHERE name='embedding'`,
      )
      .get()
    expect(row?.type).toBe('BLOB')
    expect(row?.notnull).toBe(0)
  })

  test('a row can be inserted with a null embedding', () => {
    const db = getDrizzleDb().$client
    db.prepare(
      `INSERT INTO message_embeddings (context_id, message_id, embedding, embedding_model, embedding_dim, embedded_at)
       VALUES ('c1', 'm1', NULL, NULL, NULL, NULL)`,
    ).run()
    const n = db.query<{ n: number }, []>(`SELECT COUNT(*) as n FROM message_embeddings`).get()
    expect(n?.n).toBe(1)
  })

  test('drizzle schema inserts and reads back an embedding blob', () => {
    const db = getDrizzleDb()
    const embedding = new Uint8Array([1, 2, 3, 4])
    db.insert(messageEmbeddings)
      .values({
        contextId: 'c1',
        messageId: 'm1',
        embedding,
        embeddingModel: 'text-embedding-3-small',
        embeddingDim: 4,
        embeddedAt: '2026-07-26T00:00:00.000Z',
      })
      .run()
    const row = db.select().from(messageEmbeddings).get()
    expect(row?.contextId).toBe('c1')
    expect(row?.messageId).toBe('m1')
    expect(row?.embeddingModel).toBe('text-embedding-3-small')
    expect(row?.embeddingDim).toBe(4)
    expect(row?.embeddedAt).toBe('2026-07-26T00:00:00.000Z')
  })
})
