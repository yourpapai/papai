// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { planRekeyRun } from '../../../src/analytics/governance/generation-store.js'
import { copyChildrenMaterializationsBackfillIn } from '../../../src/analytics/rekey/copy-children.js'
import { copyChildrenPreferencesCollectionGrantsIn } from '../../../src/analytics/rekey/copy-governance.js'
import { copyChildrenDeliveryDeletionIn, copyParentsIn } from '../../../src/analytics/rekey/copy.js'
import type { RekeyFullKeyMaterial } from '../../../src/analytics/rekey/dual-write.js'
import { getRekeyRun } from '../../../src/analytics/rekey/run-store.js'
import type { AnalyticsRekeyRunRow } from '../../../src/db/schema.js'
import { setupTestDb } from '../../utils/test-helpers.js'
import {
  ANALYTICS_KEY_V2,
  countRows,
  GOV_KEY_V1,
  GOV_KEY_V2,
  NOW,
  seedRekeySourceGraph,
  SOURCE_GEN,
  TARGET_GEN,
} from './fixtures.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

const RUN_ID = 'run-1'

const MATERIAL: RekeyFullKeyMaterial = {
  toVersion: 'v2',
  analyticsToKey: ANALYTICS_KEY_V2,
  governanceToKey: GOV_KEY_V2,
  encryptionKey: GOV_KEY_V2,
  encryptionKeys: [GOV_KEY_V2, GOV_KEY_V1],
}

const depsOf = (db: Db): Readonly<{ getDrizzleDb: () => Db }> => ({ getDrizzleDb: (): Db => db })

const mustRun = (db: Db): AnalyticsRekeyRunRow => {
  const run = getRekeyRun(RUN_ID, depsOf(db))
  if (run === null) throw new Error('run missing')
  return run
}

const planRun = (db: Db): void => {
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
}

const runFullCopy = (db: Db): void => {
  const run = mustRun(db)
  db.transaction((tx) => {
    copyParentsIn(tx, run, MATERIAL)
    copyChildrenMaterializationsBackfillIn(tx, run, MATERIAL)
    copyChildrenPreferencesCollectionGrantsIn(tx, run, MATERIAL)
    copyChildrenDeliveryDeletionIn(tx, run, MATERIAL)
  })
}

type ShadowSessionRow = Readonly<{
  session_key: string
  actor_key: string
  first_event_id: string
  last_event_id: string
}>

const mustShadowSession = (db: Db): ShadowSessionRow => {
  const row = db.$client
    .query<ShadowSessionRow, []>(
      `SELECT session_key, actor_key, first_event_id, last_event_id FROM analytics_sessions WHERE storage_generation = 'gen-2'`,
    )
    .get()
  if (row === undefined || row === null) throw new Error('shadow session missing')
  return row
}

describe('rekey copy children', () => {
  let db: Db

  beforeEach(async () => {
    db = await setupTestDb()
    seedRekeySourceGraph(db)
    planRun(db)
  })

  test('children refuse to point at a missing target-shadow parent', () => {
    const run = mustRun(db)
    expect(() =>
      db.transaction((tx) => {
        copyChildrenMaterializationsBackfillIn(tx, run, MATERIAL)
      }),
    ).toThrow()
  })

  test('copy_children materializes sessions, attempts, friction, feature days, censor, and backfill maps', () => {
    runFullCopy(db)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_sessions WHERE storage_generation = 'gen-2'`)).toBe(1)
    const shadowSession = mustShadowSession(db)
    expect(shadowSession.session_key.startsWith('v2.')).toBe(true)
    expect(shadowSession.actor_key.startsWith('v2.')).toBe(true)
    const shadowEventIds = db.$client
      .query<{ event_id: string }, []>(`SELECT event_id FROM analytics_events WHERE storage_generation = 'gen-2'`)
      .all()
      .map((row) => row.event_id)
    expect(shadowEventIds).toContain(shadowSession.first_event_id)
    expect(shadowEventIds).toContain(shadowSession.last_event_id)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_session_events`)).toBe(4)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_goal_attempts WHERE storage_generation = 'gen-2'`)).toBe(
      1,
    )
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_turn_friction WHERE storage_generation = 'gen-2'`)).toBe(
      1,
    )
    expect(
      countRows(db, `SELECT COUNT(*) AS n FROM analytics_feature_opportunity_days WHERE storage_generation = 'gen-2'`),
    ).toBe(1)
    expect(
      countRows(db, `SELECT COUNT(*) AS n FROM analytics_feature_use_days WHERE storage_generation = 'gen-2'`),
    ).toBe(1)
    const censor = db.$client
      .query<{ actor_key: string }, []>(`SELECT actor_key FROM analytics_censor_intervals ORDER BY actor_key`)
      .all()
    expect(censor).toHaveLength(2)
    expect(censor[1]?.actor_key.startsWith('v2.')).toBe(true)
    const backfillCoverage = db.$client
      .query<{ source_ref_key: string }, []>(
        `SELECT m.source_ref_key AS source_ref_key
           FROM analytics_backfill_event_map m
           JOIN analytics_events e ON e.event_id = m.event_id
          WHERE e.storage_generation = 'gen-1'`,
      )
      .all()
    for (const row of backfillCoverage) {
      const shadow = db.$client
        .query<{ event_id: string }, [string]>(
          `SELECT event_id FROM analytics_events WHERE storage_generation = 'gen-2' AND source_ref_key = ?`,
        )
        .get(row.source_ref_key)
      expect(shadow).toBeDefined()
    }
  })
})
