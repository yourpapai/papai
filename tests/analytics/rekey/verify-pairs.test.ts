// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { planRekeyRun } from '../../../src/analytics/governance/generation-store.js'
import { copyParentsIn } from '../../../src/analytics/rekey/copy.js'
import type { RekeyFullKeyMaterial } from '../../../src/analytics/rekey/dual-write.js'
import { getRekeyRun } from '../../../src/analytics/rekey/run-store.js'
import { eventIdsIn, listRunPairsIn, loadParentPairsIn } from '../../../src/analytics/rekey/verify-pairs.js'
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

describe('rekey verify pair loading', () => {
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

  test('eventIdsIn lists generation parents ordered by id', () => {
    db.transaction((tx) => {
      expect(eventIdsIn(tx, SOURCE_GEN)).toEqual(['ev-1', 'ev-2', 'ev-extra'])
      expect(eventIdsIn(tx, TARGET_GEN)).toEqual([])
    })
  })

  test('loadParentPairsIn joins decrypted mappings to existing parents in both generations', () => {
    const run = mustRun(db)
    db.transaction((tx) => {
      copyParentsIn(tx, run, MATERIAL)
      const { pairs, shadowToActive } = loadParentPairsIn(tx, run, [GOV_KEY_V2])
      expect(pairs).toHaveLength(3)
      expect(shadowToActive.size).toBe(3)
      for (const pair of pairs) {
        expect(shadowToActive.get(pair.shadowEventId)).toBe(pair.activeEventId)
      }
    })
  })

  test('listRunPairsIn decrypts every retained mapping domain for verifier-only checks', () => {
    const run = mustRun(db)
    db.transaction((tx) => {
      copyParentsIn(tx, run, MATERIAL)
      const pairs = listRunPairsIn(tx, RUN_ID, [GOV_KEY_V2])
      expect(pairs.length).toBeGreaterThan(0)
      expect(pairs.every((pair) => pair.domain === 'event-source-ref:v1')).toBe(true)
    })
  })

  test('a mapping no retained key can open fails the verifier instead of being skipped', () => {
    const run = mustRun(db)
    db.transaction((tx) => {
      copyParentsIn(tx, run, MATERIAL)
    })
    expect(() =>
      db.transaction((tx) => {
        listRunPairsIn(tx, RUN_ID, [Buffer.alloc(32, 99)])
      }),
    ).toThrow()
  })
})
