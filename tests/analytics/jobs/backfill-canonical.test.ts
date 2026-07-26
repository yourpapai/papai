// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { llmCompletedFixture } from '../../../src/analytics/contracts.js'
import { routeFutureCanonicalDecision } from '../../../src/analytics/jobs/backfill-canonical.js'
import * as schema from '../../../src/db/schema.js'
import { mockLogger, setupTestDb } from '../../utils/test-helpers.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

describe('backfill canonical routing guards', () => {
  let db: Db

  beforeEach(async () => {
    mockLogger()
    db = await setupTestDb()
  })

  test('pre-eligibility occurrences are refused before any write', () => {
    const result = routeFutureCanonicalDecision(
      {
        event: llmCompletedFixture,
        collectionRef: { refKey: 'ref-1', keyVersion: 'v1', generation: 1 },
        processEpochId: 'epoch-x',
        runId: 'run-x',
        sourceRefKey: 'v1.ref-x',
        consentCutoffMs: llmCompletedFixture.event.occurred_at_ms + 1,
      },
      { getDrizzleDb: () => db },
    )
    expect(result).toBe('pre_eligibility')
    expect(db.select().from(schema.analyticsEvents).all()).toHaveLength(0)
    expect(db.select().from(schema.analyticsBackfillEventMap).all()).toHaveLength(0)
  })
})
