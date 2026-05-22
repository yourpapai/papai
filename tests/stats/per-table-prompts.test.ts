// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { alertPrompts, scheduledPrompts } from '../../src/db/schema.js'
import { alertsForSubject, scheduledForSubject } from '../../src/stats/per-table.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('scheduledForSubject', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns zero-shape when subject has no scheduled prompts', () => {
    const result = scheduledForSubject('nobody')

    expect(result).toEqual({ total: 0, byStatus: {}, distinctDeliveryTargets: 0 })
  })

  test('aggregates totals, byStatus, and distinct delivery contexts', () => {
    getDrizzleDb()
      .insert(scheduledPrompts)
      .values([
        {
          id: 's1',
          createdByUserId: 'u1',
          deliveryContextId: 'u1',
          prompt: 'p',
          fireAt: '2026-02-01T00:00:00Z',
          status: 'active',
        },
        {
          id: 's2',
          createdByUserId: 'u1',
          deliveryContextId: 'u1',
          prompt: 'p',
          fireAt: '2026-02-02T00:00:00Z',
          status: 'active',
        },
        {
          id: 's3',
          createdByUserId: 'u1',
          deliveryContextId: 'group:42',
          prompt: 'p',
          fireAt: '2026-02-03T00:00:00Z',
          status: 'cancelled',
        },
        {
          id: 's4',
          createdByUserId: 'other',
          deliveryContextId: 'other',
          prompt: 'p',
          fireAt: '2026-02-04T00:00:00Z',
          status: 'active',
        },
      ])
      .run()

    const result = scheduledForSubject('u1')

    expect(result.total).toBe(3)
    expect(result.byStatus).toEqual({ active: 2, cancelled: 1 })
    expect(result.distinctDeliveryTargets).toBe(2)
  })
})

describe('alertsForSubject', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns zero-shape when subject has no alert prompts', () => {
    const result = alertsForSubject('nobody')

    expect(result).toEqual({ total: 0, byStatus: {} })
  })

  test('aggregates totals and byStatus', () => {
    getDrizzleDb()
      .insert(alertPrompts)
      .values([
        { id: 'a1', createdByUserId: 'u1', prompt: 'p', condition: 'c', status: 'active' },
        { id: 'a2', createdByUserId: 'u1', prompt: 'p', condition: 'c', status: 'paused' },
        { id: 'a3', createdByUserId: 'u1', prompt: 'p', condition: 'c', status: 'active' },
        { id: 'a4', createdByUserId: 'other', prompt: 'p', condition: 'c', status: 'active' },
      ])
      .run()

    const result = alertsForSubject('u1')

    expect(result.total).toBe(3)
    expect(result.byStatus).toEqual({ active: 2, paused: 1 })
  })
})
