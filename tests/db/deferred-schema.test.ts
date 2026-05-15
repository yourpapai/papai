// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, it } from 'bun:test'

import { eq } from 'drizzle-orm'

import { scheduledPrompts } from '../../src/db/deferred-schema.js'
import { getDrizzleDb } from '../../src/db/drizzle.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('scheduledPrompts schema', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  it('has a timezone column', () => {
    expect(scheduledPrompts.timezone).toBeDefined()
  })

  it('stores and retrieves a timezone value', () => {
    const db = getDrizzleDb()
    const id = crypto.randomUUID()
    const fireAt = new Date(Date.now() + 60_000).toISOString()

    db.insert(scheduledPrompts)
      .values({
        id,
        createdByUserId: 'u1',
        prompt: 'test',
        fireAt,
        rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
        dtstartUtc: fireAt,
        timezone: 'America/New_York',
        status: 'active',
        mentionUserIds: '[]',
        executionMetadata: '{}',
      })
      .run()

    const row = db.select().from(scheduledPrompts).where(eq(scheduledPrompts.id, id)).get()
    expect(row).not.toBeUndefined()
    expect(row!.timezone).toBe('America/New_York')
  })

  it('timezone defaults to null for rows without it', () => {
    const db = getDrizzleDb()
    const id = crypto.randomUUID()
    const fireAt = new Date(Date.now() + 60_000).toISOString()

    db.insert(scheduledPrompts)
      .values({
        id,
        createdByUserId: 'u1',
        prompt: 'test',
        fireAt,
        status: 'active',
        mentionUserIds: '[]',
        executionMetadata: '{}',
      })
      .run()

    const row = db.select().from(scheduledPrompts).where(eq(scheduledPrompts.id, id)).get()
    expect(row).not.toBeUndefined()
    expect(row!.timezone).toBeNull()
  })
})
