// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { memoryProjectionRecords } from '../../src/db/memory-projection-schema.js'
import { setupTestDb } from '../utils/test-helpers.js'

describe('memory-projection-schema', () => {
  test('memoryProjectionRecords inserts and reads a full row', async () => {
    await setupTestDb()

    getDrizzleDb()
      .insert(memoryProjectionRecords)
      .values({
        projectionKey: 'rec-1',
        eventId: 'evt-1',
        idempotencyIdentity: 'ident-1',
        contentIdentity: 'content-1',
        scopeId: 'user-1',
        scopeType: 'personal',
        kind: 'fact',
        content: 'likes dark mode',
        confidence: 0.9,
        source: 'background',
        eventTime: '2026-08-02T00:00:00.000Z',
        lastObservedAt: '2026-08-02T00:00:00.000Z',
        schemaVersion: 1,
        captureVersion: 'v1',
        projectedAt: '2026-08-02T00:00:01.000Z',
      })
      .run()

    const row = getDrizzleDb().select().from(memoryProjectionRecords).get()
    expect(row?.projectionKey).toBe('rec-1')
    expect(row?.tags).toBe('[]')
    expect(row?.actorIds).toBe('[]')
    expect(row?.provenance).toBe('{}')
    expect(row?.recordId).toBeNull()
  })
})
