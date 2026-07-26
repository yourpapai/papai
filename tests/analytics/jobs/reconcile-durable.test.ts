// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { reconcileDurableUsage } from '../../../src/analytics/jobs/reconcile-durable.js'
import * as schema from '../../../src/db/schema.js'
import { mockLogger, setupTestDb } from '../../utils/test-helpers.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

describe('durable usage reconciliation module', () => {
  let db: Db

  beforeEach(async () => {
    mockLogger()
    db = await setupTestDb()
  })

  test('no completed runs means no coverage and zero delta', () => {
    const report = reconcileDurableUsage(db, 'gen-1')
    expect(report.perSourceDay).toEqual([])
    expect(report.unexplainedDeltaTotal).toBe(0)
    expect(report.associationViolations).toBe(0)
  })

  test('covered usage rows without provenance produce an unexplained delta', () => {
    db.insert(schema.analyticsBackfillRuns)
      .values({
        runId: 'run-gap',
        sourceTable: 'llm_usage_events',
        highWaterRowKey: '1000:e-1',
        policyCutoffMs: 0,
        status: 'completed',
        startedAtMs: 1000,
      })
      .run()
    db.insert(schema.llmUsageEvents)
      .values({
        eventId: 'e-1',
        occurredAt: 1000,
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
      })
      .run()
    const report = reconcileDurableUsage(db, 'gen-1')
    expect(report.unexplainedDeltaTotal).toBe(1)
    expect(report.perSourceDay[0]?.usageRows).toBe(1)
  })
})
