// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import {
  memoryCanonicalCaptureAttempts,
  memoryCanonicalEvents,
  memoryCanonicalState,
  memoryProjectionOutbox,
} from '../../src/db/memory-canonical-schema.js'
import { setupTestDb } from '../utils/test-helpers.js'

describe('memory-canonical-schema', () => {
  test('memoryCanonicalEvents inserts and reads a full row', async () => {
    await setupTestDb()

    getDrizzleDb()
      .insert(memoryCanonicalEvents)
      .values({
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
      })
      .run()

    const row = getDrizzleDb().select().from(memoryCanonicalEvents).get()
    expect(row?.eventId).toBe('evt-1')
    expect(row?.tags).toBe('[]')
    expect(row?.actorIds).toBe('[]')
    expect(row?.provenance).toBe('{}')
    expect(row?.supersedes).toBeNull()
    expect(row?.recordId).toBeNull()
  })

  test('memoryProjectionOutbox defaults state to pending and attemptCount to 0', async () => {
    await setupTestDb()

    getDrizzleDb()
      .insert(memoryProjectionOutbox)
      .values({ eventId: 'evt-1', op: 'capture', enqueuedAt: '2026-07-30T00:00:00.000Z' })
      .run()

    const row = getDrizzleDb().select().from(memoryProjectionOutbox).get()
    expect(row?.state).toBe('pending')
    expect(row?.attemptCount).toBe(0)
  })

  test('memoryCanonicalCaptureAttempts records a suppressed outcome with a null eventId', async () => {
    await setupTestDb()

    getDrizzleDb()
      .insert(memoryCanonicalCaptureAttempts)
      .values({
        idempotencyIdentity: 'ident-1',
        contentIdentity: 'content-1',
        scopeId: 'user-1',
        scopeType: 'personal',
        outcome: 'suppressed-duplicate',
        eventId: null,
        eventTime: '2026-07-30T00:00:00.000Z',
        ingestTime: '2026-07-30T00:00:01.000Z',
        captureVersion: 'v1',
      })
      .run()

    const row = getDrizzleDb().select().from(memoryCanonicalCaptureAttempts).get()
    expect(row?.outcome).toBe('suppressed-duplicate')
    expect(row?.eventId).toBeNull()
  })

  test('memoryCanonicalState round-trips the singleton cutover marker', async () => {
    await setupTestDb()

    const row = getDrizzleDb().select().from(memoryCanonicalState).get()
    expect(row?.id).toBe('singleton')
    expect(typeof row?.cutoverAt).toBe('string')
  })
})
