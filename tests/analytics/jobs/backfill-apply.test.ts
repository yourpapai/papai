// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { applyBackfillDecision } from '../../../src/analytics/jobs/backfill-apply.js'
import type { LlmUsageEventRow } from '../../../src/db/llm-usage-events-schema.js'
import * as schema from '../../../src/db/schema.js'
import { mockLogger, setupTestDb } from '../../utils/test-helpers.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

const KEY = Buffer.alloc(32, 5)

const row: LlmUsageEventRow = {
  eventId: 'e-apply',
  occurredAt: 1_700_000_000_000,
  turnId: null,
  storageContextId: 'sc',
  contextType: 'dm',
  chatUserId: 'u',
  model: 'm',
  modelRole: 'main',
  inputTokens: 1,
  outputTokens: 1,
  stepCount: 0,
  toolCallCount: 0,
  messageCount: 0,
  finishReason: null,
  durationMs: 1,
  responseId: null,
  error: null,
  forwardedAt: null,
  forwardAttempts: 0,
  forwardError: null,
}

const seedRun = (db: Db): void => {
  db.insert(schema.analyticsBackfillRuns)
    .values({
      runId: 'run-apply',
      sourceTable: 'llm_usage_events',
      highWaterRowKey: '1700000000000:e-apply',
      policyCutoffMs: 0,
      status: 'running',
      startedAtMs: 1_700_000_000_000,
    })
    .run()
}

describe('backfill apply', () => {
  let db: Db

  beforeEach(async () => {
    mockLogger()
    db = await setupTestDb()
    seedRun(db)
  })

  test('first application writes counter and provenance; second is skipped', () => {
    const ctx = { runId: 'run-apply', sourceTable: 'llm_usage_events' as const, key: KEY, keyVersion: 'v1' }
    const decision = {
      kind: 'aggregate_only' as const,
      increments: [{ kind: 'counter' as const, metric: 'llm_completed' as const, delta: 1 }],
    }
    expect(applyBackfillDecision(db, ctx, row, decision)).toBe('applied')
    expect(applyBackfillDecision(db, ctx, row, decision)).toBe('skipped')
    const contributions = db.select().from(schema.analyticsBackfillAggregateContributions).all()
    expect(contributions).toHaveLength(1)
    expect(contributions[0]?.delta).toBe(1)
  })

  test('rejected decisions record provenance and a rejection count', () => {
    const ctx = { runId: 'run-apply', sourceTable: 'llm_usage_events' as const, key: KEY, keyVersion: 'v1' }
    expect(applyBackfillDecision(db, ctx, row, { kind: 'rejected', reason: 'invalid_value' })).toBe('applied')
    expect(applyBackfillDecision(db, ctx, row, { kind: 'rejected', reason: 'invalid_value' })).toBe('skipped')
    const rejections = db.select().from(schema.analyticsNormalizationRejections).all()
    expect(rejections).toHaveLength(1)
    expect(rejections[0]?.count).toBe(1)
  })
})
