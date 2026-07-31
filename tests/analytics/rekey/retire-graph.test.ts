// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { planRekeyRun } from '../../../src/analytics/governance/generation-store.js'
import { deleteOldGovernanceIn, deleteOldGraphIn } from '../../../src/analytics/rekey/retire-graph.js'
import { getRekeyRun } from '../../../src/analytics/rekey/run-store.js'
import type { AnalyticsRekeyRunRow } from '../../../src/db/schema.js'
import { setupTestDb } from '../../utils/test-helpers.js'
import { countRows, NOW, seedRekeySourceGraph, SOURCE_GEN, TARGET_GEN } from './fixtures.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

const RUN_ID = 'run-1'

const depsOf = (db: Db): Readonly<{ getDrizzleDb: () => Db }> => ({ getDrizzleDb: (): Db => db })

const mustRun = (db: Db): AnalyticsRekeyRunRow => {
  const run = getRekeyRun(RUN_ID, depsOf(db))
  if (run === null) throw new Error('run missing')
  return run
}

describe('rekey retirement graph deletion', () => {
  let db: Db

  beforeEach(async () => {
    db = await setupTestDb()
    seedRekeySourceGraph(db)
    planRekeyRun(
      {
        runId: RUN_ID,
        sourceGeneration: SOURCE_GEN,
        targetGeneration: TARGET_GEN,
        fromVersions: ['v1'],
        toVersions: ['v2'],
        sourceHighWater: 'hw-1',
        planHash: 'plan-hash',
        nowMs: NOW,
      },
      depsOf(db),
    )
  })

  test('deleteOldGraphIn removes the source graph in FK-safe order and keeps audit evidence', () => {
    db.transaction((tx) => {
      deleteOldGraphIn(tx, mustRun(db))
    })
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_events WHERE storage_generation = 'gen-1'`)).toBe(0)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_events WHERE storage_generation = 'gen-0'`)).toBe(1)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_sessions WHERE storage_generation = 'gen-1'`)).toBe(0)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_session_events`)).toBe(0)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_goal_attempts WHERE storage_generation = 'gen-1'`)).toBe(
      0,
    )
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_turn_friction WHERE storage_generation = 'gen-1'`)).toBe(
      0,
    )
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_deliveries`)).toBe(0)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_delivery_deletion_receipts`)).toBe(1)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_deletion_requests`)).toBe(1)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_backfill_runs`)).toBe(1)
  })

  test('deleteOldGovernanceIn removes only from-version governance rows', () => {
    db.$client.run(
      `INSERT INTO analytics_preferences (
         governance_actor_key, key_version, local_longitudinal, external_pseudonymous,
         policy_version, source, effective_at, updated_at
       ) VALUES ('v2.p-gov-actor', 'v2', 'allow', 'allow', 1, 'settings', 0, 0)`,
    )
    db.transaction((tx) => {
      deleteOldGovernanceIn(tx, mustRun(db))
    })
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_preferences WHERE key_version = 'v1'`)).toBe(0)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_preferences WHERE key_version = 'v2'`)).toBe(1)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_eligibility_grants WHERE key_version = 'v1'`)).toBe(0)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_collection_eligibility WHERE key_version = 'v1'`)).toBe(0)
  })
})
