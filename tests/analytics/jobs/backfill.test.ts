// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { rollbackBackfillRun, runBackfillJob } from '../../../src/analytics/jobs/backfill.js'
import type { BackfillJobInput } from '../../../src/analytics/jobs/backfill.js'
import * as schema from '../../../src/db/schema.js'
import { mockLogger, setupTestDb } from '../../utils/test-helpers.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

const KEY = Buffer.alloc(32, 11)
const NOW = 1_700_000_000_000

const input = (over?: Partial<BackfillJobInput>): BackfillJobInput => ({
  source: 'all',
  batchSize: 50,
  dryRun: false,
  resume: false,
  cutoffMs: 0,
  key: KEY,
  keyVersion: 'v1',
  nowMs: NOW,
  ...over,
})

describe('backfill job module', () => {
  let db: Db

  beforeEach(async () => {
    mockLogger()
    db = await setupTestDb()
  })

  test('empty sources yield empty summaries with no writes', () => {
    const result = runBackfillJob(input(), { getDrizzleDb: () => db })
    expect(result.runs).toHaveLength(2)
    for (const run of result.runs) {
      expect(run.status).toBe('empty')
      expect(run.scanned).toBe(0)
    }
    expect(db.select().from(schema.analyticsBackfillRuns).all()).toHaveLength(0)
  })

  test('dry-run on empty sources performs no writes', () => {
    const result = runBackfillJob(input({ dryRun: true }), { getDrizzleDb: () => db })
    for (const run of result.runs) expect(run.scanned).toBe(0)
    expect(db.select().from(schema.analyticsBackfillRuns).all()).toHaveLength(0)
  })

  test('rollback of an unknown run removes nothing', () => {
    const removed = rollbackBackfillRun({ runId: 'backfill-v1:llm_usage_events' }, { getDrizzleDb: () => db })
    expect(removed).toEqual({ removedContributions: 0, removedEvents: 0 })
  })
})
