// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { webRateLimit } from '../../src/db/schema.js'
import { webFetchesForSubject } from '../../src/stats/per-table-usage.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('webFetchesForSubject', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns zero when subject has no rate-limit rows', () => {
    expect(webFetchesForSubject('nobody')).toEqual({ totalRequests: 0 })
  })

  test('sums the count column across all rate-limit windows for the actor', () => {
    getDrizzleDb()
      .insert(webRateLimit)
      .values([
        { actorId: 'u1', windowStart: 1000, count: 3 },
        { actorId: 'u1', windowStart: 2000, count: 5 },
        { actorId: 'other', windowStart: 1000, count: 99 },
      ])
      .run()

    expect(webFetchesForSubject('u1').totalRequests).toBe(8)
  })
})
