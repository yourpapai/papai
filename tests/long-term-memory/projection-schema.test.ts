// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { memoryProjectionRecords, type MemoryProjectionRecordRow } from '../../src/db/schema.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const rows = (): MemoryProjectionRecordRow[] => getDrizzleDb().select().from(memoryProjectionRecords).all()

const seed = (): void => {
  getDrizzleDb()
    .insert(memoryProjectionRecords)
    .values({
      projectionKey: 'rec-1',
      recordId: 'rec-1',
      eventId: 'evt-1',
      idempotencyIdentity: 'ident-1',
      contentIdentity: 'content-1',
      scopeId: 'user-1',
      scopeType: 'personal',
      threadContextId: null,
      kind: 'fact',
      content: 'likes dark mode',
      summary: null,
      tags: '["ui"]',
      confidence: 0.9,
      source: 'background',
      actorIds: '[]',
      provenance: '{}',
      eventTime: '2026-08-02T12:00:00.000Z',
      lastObservedAt: '2026-08-02T12:00:00.000Z',
      validFrom: null,
      validUntil: null,
      expiresAt: null,
      schemaVersion: 1,
      captureVersion: 'v1',
      projectedAt: '2026-08-02T13:00:00.000Z',
    })
    .run()
}

describe('memory_projection_records', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('the migration creates an empty table', () => {
    expect(rows()).toEqual([])
  })

  test('a row round-trips every column', () => {
    seed()

    expect(rows()).toEqual([
      {
        projectionKey: 'rec-1',
        recordId: 'rec-1',
        eventId: 'evt-1',
        idempotencyIdentity: 'ident-1',
        contentIdentity: 'content-1',
        scopeId: 'user-1',
        scopeType: 'personal',
        threadContextId: null,
        kind: 'fact',
        content: 'likes dark mode',
        summary: null,
        tags: '["ui"]',
        confidence: 0.9,
        source: 'background',
        actorIds: '[]',
        provenance: '{}',
        eventTime: '2026-08-02T12:00:00.000Z',
        lastObservedAt: '2026-08-02T12:00:00.000Z',
        validFrom: null,
        validUntil: null,
        expiresAt: null,
        schemaVersion: 1,
        captureVersion: 'v1',
        projectedAt: '2026-08-02T13:00:00.000Z',
      },
    ])
  })

  test('projection_key is the primary key, so a second row with the same key is rejected', () => {
    seed()

    expect(seed).toThrow()
  })

  test('scope_type rejects a value outside the enum', () => {
    const bad = (): void => {
      getDrizzleDb().run(`
        INSERT INTO memory_projection_records
          (projection_key, event_id, idempotency_identity, content_identity, scope_id, scope_type,
           kind, content, confidence, source, event_time, last_observed_at, schema_version,
           capture_version, projected_at)
        VALUES ('k', 'e', 'i', 'c', 's', 'organisation', 'fact', 'x', 1, 'background',
                '2026-08-02T12:00:00.000Z', '2026-08-02T12:00:00.000Z', 1, 'v1', '2026-08-02T12:00:00.000Z')
      `)
    }

    expect(bad).toThrow()
  })
})
