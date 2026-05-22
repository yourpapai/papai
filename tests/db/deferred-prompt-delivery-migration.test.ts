// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { eq } from 'drizzle-orm'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { alertPrompts, scheduledPrompts } from '../../src/db/schema.js'
import { setupTestDb } from '../utils/test-helpers.js'

describe('migration 025: deferred prompt delivery targets', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('scheduled_prompts stores explicit creator and delivery fields', () => {
    const db = getDrizzleDb()
    db.insert(scheduledPrompts)
      .values({
        id: 'sp1',
        createdByUserId: 'u1',
        createdByUsername: 'ki',
        deliveryContextId: '-1001',
        deliveryContextType: 'group',
        deliveryThreadId: '42',
        audience: 'personal',
        mentionUserIds: '["u1"]',
        prompt: 'remind me',
        fireAt: '2027-01-01T00:00:00.000Z',
      })
      .run()

    const row = db.select().from(scheduledPrompts).where(eq(scheduledPrompts.id, 'sp1')).get()
    expect(row).not.toBeUndefined()
    expect(row!.createdByUserId).toBe('u1')
    expect(row!.deliveryContextId).toBe('-1001')
    expect(row!.audience).toBe('personal')
  })

  test('alert_prompts stores explicit creator and delivery fields', () => {
    const db = getDrizzleDb()
    db.insert(alertPrompts)
      .values({
        id: 'ap1',
        createdByUserId: 'u2',
        createdByUsername: 'alex',
        deliveryContextId: 'chan-1',
        deliveryContextType: 'group',
        deliveryThreadId: 'root-1',
        audience: 'shared',
        mentionUserIds: '[]',
        prompt: 'notify channel',
        condition: '{"field":"task.status","op":"eq","value":"done"}',
      })
      .run()

    const row = db.select().from(alertPrompts).where(eq(alertPrompts.id, 'ap1')).get()
    expect(row).not.toBeUndefined()
    expect(row!.createdByUserId).toBe('u2')
    expect(row!.deliveryContextId).toBe('chan-1')
    expect(row!.audience).toBe('shared')
  })
})
