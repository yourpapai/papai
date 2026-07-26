// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { runReconciliation } from '../../../src/analytics/jobs/reconcile.js'
import { mockLogger, setupTestDb } from '../../utils/test-helpers.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

describe('reconcile job module', () => {
  let db: Db

  beforeEach(async () => {
    mockLogger()
    db = await setupTestDb()
  })

  test('empty analytics state reconciles to zero', () => {
    const report = runReconciliation({ nowMs: 1_700_000_000_000, apply: false }, { getDrizzleDb: () => db })
    expect(report.status).toBe('reconciled')
    expect(report.durableUsage.unexplainedDeltaTotal).toBe(0)
    expect(report.liveEpochs).toEqual([])
    expect(report.delivery.conserved).toBe(true)
  })
})
