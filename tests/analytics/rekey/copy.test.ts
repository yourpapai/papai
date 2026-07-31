// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { openDeletionTargets } from '../../../src/analytics/governance/deletion-target-store.js'
import { planRekeyRun } from '../../../src/analytics/governance/generation-store.js'
import { copyChildrenMaterializationsBackfillIn } from '../../../src/analytics/rekey/copy-children.js'
import { copyChildrenPreferencesCollectionGrantsIn } from '../../../src/analytics/rekey/copy-governance.js'
import {
  copyChildrenDeliveryDeletionIn,
  copyParentsIn,
  REKEY_HELD_NEXT_ATTEMPT_MS,
} from '../../../src/analytics/rekey/copy.js'
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

describe('rekey FK-ordered copy', () => {
  let db: Db

  beforeEach(async () => {
    db = await setupTestDb()
    seedRekeySourceGraph(db)
    planRun(db)
  })

  test('copy_parents creates one shadow parent per source parent with remapped keys and mirrored refs', () => {
    const copied = db.transaction((tx) => copyParentsIn(tx, mustRun(db), MATERIAL))
    expect(copied).toBe(3)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_events WHERE storage_generation = 'gen-2'`)).toBe(3)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_events WHERE storage_generation = 'gen-0'`)).toBe(1)
    expect(
      countRows(db, `SELECT COUNT(*) AS n FROM analytics_rekey_mappings WHERE domain = 'event-source-ref:v1'`),
    ).toBe(3)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_event_collection_refs`)).toBe(6)
    const shadow = db.$client
      .query<{ key_version: string; actor_key: string | null }, []>(
        `SELECT key_version, actor_key FROM analytics_events WHERE storage_generation = 'gen-2' AND event_name = 'llm_completed'`,
      )
      .get()
    expect(shadow?.key_version).toBe('v2')
    expect(shadow?.actor_key?.startsWith('v2.')).toBe(true)
  })

  test('copy_parents is idempotent across interruption and resume', () => {
    db.transaction((tx) => copyParentsIn(tx, mustRun(db), MATERIAL))
    const second = db.transaction((tx) => copyParentsIn(tx, mustRun(db), MATERIAL))
    expect(second).toBe(0)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_events`)).toBe(7)
  })

  test('copy_children holds shadow deliveries, preserves old rows and receipts, and reseals deletion targets', () => {
    runFullCopy(db)
    const deliveries = db.$client
      .query<{ event_gen: string; state: string; grant_key: string; remote_receipt_hash: string | null }, []>(
        `SELECT e.storage_generation AS event_gen, d.state AS state, d.grant_key AS grant_key,
                d.remote_receipt_hash AS remote_receipt_hash
           FROM analytics_deliveries d JOIN analytics_events e ON e.event_id = d.event_id
          ORDER BY e.storage_generation, d.state`,
      )
      .all()
    const oldRows = deliveries.filter((row) => row.event_gen === 'gen-1')
    const shadowRows = deliveries.filter((row) => row.event_gen === 'gen-2')
    expect(oldRows.map((row) => row.state).sort()).toEqual(['delivered', 'pending'])
    expect(oldRows.find((row) => row.state === 'delivered')?.remote_receipt_hash).toBe('rh-1')
    expect(shadowRows).toHaveLength(2)
    for (const row of shadowRows) {
      expect(row.state).toBe('pending')
      expect(row.grant_key.startsWith('v2.')).toBe(true)
      expect(row.remote_receipt_hash).toBeNull()
    }
    const heldAttempts = db.$client
      .query<{ next_attempt_at_ms: number }, []>(
        `SELECT d.next_attempt_at_ms AS next_attempt_at_ms
           FROM analytics_deliveries d JOIN analytics_events e ON e.event_id = d.event_id
          WHERE e.storage_generation = 'gen-2'`,
      )
      .all()
    for (const row of heldAttempts) expect(row.next_attempt_at_ms).toBe(REKEY_HELD_NEXT_ATTEMPT_MS)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_delivery_deletion_receipts`)).toBe(1)
    const targets = openDeletionTargets({ requestId: 'del-1', encryptionKeys: [GOV_KEY_V2] }, depsOf(db))
    expect(targets).not.toBeNull()
    expect(targets?.analyticsActorKeys).toContain('v1.p-actor')
    expect(targets?.analyticsActorKeys.some((key) => key.startsWith('v2.'))).toBe(true)
    expect(targets?.governanceActorKeys.some((key) => key.startsWith('v2.'))).toBe(true)
    expect(targets?.collectionRefKeys.some((key) => key.startsWith('v2.'))).toBe(true)
    expect(targets?.grantKeys.some((key) => key.startsWith('v2.'))).toBe(true)
    const request = db.$client
      .query<{ key_version: string; state: string }, []>(
        `SELECT key_version, state FROM analytics_deletion_requests WHERE request_id = 'del-1'`,
      )
      .get()
    expect(request?.key_version).toBe('v2')
    expect(request?.state).toBe('requested')
  })

  test('the full copy is idempotent on resume with no source/event duplicates', () => {
    runFullCopy(db)
    runFullCopy(db)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_events`)).toBe(7)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_sessions`)).toBe(2)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_deliveries`)).toBe(4)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_preferences`)).toBe(2)
    expect(
      countRows(db, `SELECT COUNT(*) AS n FROM analytics_rekey_mappings WHERE domain = 'event-source-ref:v1'`),
    ).toBe(3)
  })
})
