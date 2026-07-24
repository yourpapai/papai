// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { and, eq } from 'drizzle-orm'

import { incrementNormalizationRejection } from '../../../src/analytics/storage/rejection-store.js'
import * as schema from '../../../src/db/schema.js'
import { setupTestDb } from '../../utils/test-helpers.js'
import type { Db } from '../storage-fixtures.js'

describe('analytics rejection storage', () => {
  let db: Db

  beforeEach(async () => {
    db = await setupTestDb()
  })

  test('rejection counter persists source type and bounded reason', () => {
    incrementNormalizationRejection(
      { utcDay: '2026-01-01', sourceEventType: 'llm_completed', reason: 'schema_version_mismatch', count: 3 },
      { getDrizzleDb: () => db },
    )

    const row = db
      .select()
      .from(schema.analyticsNormalizationRejections)
      .where(
        and(
          eq(schema.analyticsNormalizationRejections.utcDay, '2026-01-01'),
          eq(schema.analyticsNormalizationRejections.sourceEventType, 'llm_completed'),
        ),
      )
      .get()
    expect(row).toBeDefined()
    expect(row?.reason).toBe('schema_version_mismatch')
    expect(row?.count).toBe(3)
  })

  test('rejection table has no payload column', () => {
    const columns = db.$client
      .query<{ name: string }, []>("SELECT name FROM pragma_table_info('analytics_normalization_rejections')")
      .all()
    const names = columns.map((c) => c.name)
    expect(names).not.toContain('payload')
    expect(names).toEqual(['utc_day', 'source_event_type', 'reason', 'count'])
  })
})
