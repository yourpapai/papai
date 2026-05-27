// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { recurringTasks, users } from '../../src/db/schema.js'
import { recurringForSubject } from '../../src/stats/per-table.js'
import { mockLogger, seedCommonTestPlatformInstances, setupTestDb } from '../utils/test-helpers.js'

describe('recurringForSubject', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()
    getDrizzleDb()
      .insert(users)
      .values([
        { platformUserId: 'u1', platformInstanceId: 'legacy-single', addedBy: 'test' },
        { platformUserId: 'other', platformInstanceId: 'legacy-single', addedBy: 'test' },
      ])
      .run()
  })

  test('returns zero-shape when subject has no recurring tasks', () => {
    const result = recurringForSubject('u1')

    expect(result).toEqual({
      total: 0,
      enabled: 0,
      disabled: 0,
      distinctProjects: 0,
      nextRunWithin7d: 0,
      distinctRrulePatterns: 0,
    })
  })

  test('aggregates total, enabled/disabled, distinct projects, next-run-within-7d, distinct rrule patterns', () => {
    const now = Date.now()
    const within7d = new Date(now + 2 * 24 * 60 * 60 * 1000).toISOString()
    const beyond7d = new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString()

    getDrizzleDb()
      .insert(recurringTasks)
      .values([
        {
          id: 'r1',
          userId: 'u1',
          projectId: 'p1',
          title: 't',
          enabled: '1',
          rrule: 'FREQ=DAILY',
          nextRun: within7d,
        },
        {
          id: 'r2',
          userId: 'u1',
          projectId: 'p1',
          title: 't',
          enabled: '1',
          rrule: 'FREQ=DAILY',
          nextRun: within7d,
        },
        {
          id: 'r3',
          userId: 'u1',
          projectId: 'p2',
          title: 't',
          enabled: '0',
          rrule: 'FREQ=WEEKLY',
          nextRun: beyond7d,
        },
        {
          id: 'r4',
          userId: 'u1',
          projectId: 'p2',
          title: 't',
          enabled: '1',
          rrule: null,
          nextRun: null,
        },
        {
          id: 'r5',
          userId: 'other',
          projectId: 'p9',
          title: 't',
          enabled: '1',
          rrule: 'FREQ=MONTHLY',
          nextRun: within7d,
        },
      ])
      .run()

    const result = recurringForSubject('u1')

    expect(result.total).toBe(4)
    expect(result.enabled).toBe(3)
    expect(result.disabled).toBe(1)
    expect(result.distinctProjects).toBe(2)
    expect(result.nextRunWithin7d).toBe(2)
    expect(result.distinctRrulePatterns).toBe(2)
  })
})
