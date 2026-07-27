// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { runCensorMaturitySweep } from '../../../src/analytics/jobs/censor-maturity.js'
import { createRekeyCutoverFence } from '../../../src/analytics/rekey/cutover-fence.js'
import * as schema from '../../../src/db/schema.js'
import { mockLogger, setupTestDb } from '../../utils/test-helpers.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

const NOW = 1_700_000_000_000

const seedCutoverRun = (db: Db): void => {
  db.insert(schema.analyticsRekeyRuns)
    .values({
      runId: 'run-cutover-censor',
      sourceGeneration: 'gen-1',
      targetGeneration: 'gen-2',
      fromVersions: JSON.stringify(['v1']),
      toVersions: JSON.stringify(['v2']),
      sourceHighWater: 'hw-1',
      phase: 'cutover',
      subphase: null,
      planHash: 'plan-hash-1',
      status: 'running',
      createdAt: NOW - 1000,
      updatedAt: NOW - 1000,
    })
    .run()
}

describe('censor maturity sweep', () => {
  let db: Db

  beforeEach(async () => {
    mockLogger()
    db = await setupTestDb()
  })

  test('writes nothing when no withdrawn actors exist', () => {
    expect(runCensorMaturitySweep({ getDrizzleDb: () => db })).toBe(0)
    expect(db.select().from(schema.analyticsCensorIntervals).all()).toHaveLength(0)
  })

  test('a held cutover fence skips the sweep without writes or outstanding admissions', () => {
    seedCutoverRun(db)
    const fence = createRekeyCutoverFence({ getDrizzleDb: () => db })
    expect(runCensorMaturitySweep({ getDrizzleDb: () => db, fence })).toBe(0)
    expect(db.select().from(schema.analyticsCensorIntervals).all()).toHaveLength(0)
    expect(fence.outstanding().derive).toBe(0)
  })
})
