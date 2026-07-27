// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { planRekeyRun } from '../../../src/analytics/governance/generation-store.js'
import { copyChildrenPreferencesCollectionGrantsIn } from '../../../src/analytics/rekey/copy-governance.js'
import type { RekeyFullKeyMaterial } from '../../../src/analytics/rekey/dual-write.js'
import { getRekeyRun } from '../../../src/analytics/rekey/run-store.js'
import type { AnalyticsRekeyRunRow } from '../../../src/db/schema.js'
import { setupTestDb } from '../../utils/test-helpers.js'
import {
  ANALYTICS_KEY_V2,
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

describe('rekey governance mirror copy', () => {
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

  test('copy_children mirrors preferences, eligibility, and grants under target key versions', () => {
    db.transaction((tx) => {
      copyChildrenPreferencesCollectionGrantsIn(tx, mustRun(db), MATERIAL)
    })
    const preferences = db.$client
      .query<{ governance_actor_key: string; key_version: string; local_longitudinal: string }, []>(
        `SELECT governance_actor_key, key_version, local_longitudinal FROM analytics_preferences ORDER BY key_version`,
      )
      .all()
    expect(preferences).toHaveLength(2)
    expect(preferences[1]?.key_version).toBe('v2')
    expect(preferences[1]?.governance_actor_key.startsWith('v2.')).toBe(true)
    expect(preferences[1]?.local_longitudinal).toBe(preferences[0]?.local_longitudinal)
    const eligibility = db.$client
      .query<{ ref_key: string; key_version: string; state: string; generation: number }, []>(
        `SELECT ref_key, key_version, state, generation FROM analytics_collection_eligibility ORDER BY key_version`,
      )
      .all()
    expect(eligibility).toHaveLength(2)
    expect(eligibility[1]?.state).toBe(eligibility[0]?.state)
    expect(eligibility[1]?.generation).toBe(eligibility[0]?.generation)
    const grants = db.$client
      .query<{ grant_key: string; key_version: string; state: string }, []>(
        `SELECT grant_key, key_version, state FROM analytics_eligibility_grants ORDER BY key_version`,
      )
      .all()
    expect(grants).toHaveLength(2)
    expect(grants[1]?.state).toBe(grants[0]?.state)
  })

  test('the governance mirror is idempotent on resume', () => {
    db.transaction((tx) => {
      copyChildrenPreferencesCollectionGrantsIn(tx, mustRun(db), MATERIAL)
    })
    db.transaction((tx) => {
      copyChildrenPreferencesCollectionGrantsIn(tx, mustRun(db), MATERIAL)
    })
    const counts = db.$client
      .query<{ preferences: number; eligibility: number; grants: number }, []>(
        `SELECT (SELECT COUNT(*) FROM analytics_preferences) AS preferences,
                (SELECT COUNT(*) FROM analytics_collection_eligibility) AS eligibility,
                (SELECT COUNT(*) FROM analytics_eligibility_grants) AS grants`,
      )
      .get()
    expect(counts).toEqual({ preferences: 2, eligibility: 2, grants: 2 })
  })
})
