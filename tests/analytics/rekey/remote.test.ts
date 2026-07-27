// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { planRekeyRun } from '../../../src/analytics/governance/generation-store.js'
import { copyChildrenMaterializationsBackfillIn } from '../../../src/analytics/rekey/copy-children.js'
import { copyChildrenPreferencesCollectionGrantsIn } from '../../../src/analytics/rekey/copy-governance.js'
import {
  copyChildrenDeliveryDeletionIn,
  copyParentsIn,
  REKEY_HELD_NEXT_ATTEMPT_MS,
} from '../../../src/analytics/rekey/copy.js'
import type { RekeyFullKeyMaterial } from '../../../src/analytics/rekey/dual-write.js'
import { remoteDeleteIn, remoteResendIn } from '../../../src/analytics/rekey/remote.js'
import type { RekeyRemoteEgress } from '../../../src/analytics/rekey/remote.js'
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
  const run = getRekeyRun(RUN_ID, depsOf(db))
  if (run === null) throw new Error('run missing')
  db.transaction((tx) => {
    copyParentsIn(tx, run, MATERIAL)
    copyChildrenMaterializationsBackfillIn(tx, run, MATERIAL)
    copyChildrenPreferencesCollectionGrantsIn(tx, run, MATERIAL)
    copyChildrenDeliveryDeletionIn(tx, run, MATERIAL)
  })
}

type FakeEgress = RekeyRemoteEgress & { calls: readonly string[] }

const createFakeEgress = (): FakeEgress => {
  const calls: string[] = []
  return {
    calls,
    pauseEgress: () => {
      calls.push('pause')
    },
    requestActorDeletion: (oldActorKey) => {
      calls.push(`delete:${oldActorKey}`)
      return { remoteReceiptHash: `receipt:${oldActorKey}` }
    },
    resumeEgress: () => {
      calls.push('resume')
    },
  }
}

describe('rekey remote transition', () => {
  let db: Db

  beforeEach(async () => {
    db = await setupTestDb()
    seedRekeySourceGraph(db)
    planRun(db)
    runFullCopy(db)
  })

  test('remote_delete deletes old remote actor versions and reconciles while preserving rows and receipts', () => {
    const egress = createFakeEgress()
    const run = mustRun(db)
    db.transaction((tx) => {
      remoteDeleteIn(tx, run, egress, NOW + 10)
    })
    expect(egress.calls).toEqual(['delete:v1.p-actor'])
    const oldRows = db.$client
      .query<{ state: string; deleted_at_ms: number | null; remote_receipt_hash: string | null }, []>(
        `SELECT d.state AS state, d.deleted_at_ms AS deleted_at_ms, d.remote_receipt_hash AS remote_receipt_hash
           FROM analytics_deliveries d JOIN analytics_events e ON e.event_id = d.event_id
          WHERE e.storage_generation = 'gen-1' ORDER BY d.state`,
      )
      .all()
    const delivered = oldRows.find((row) => row.remote_receipt_hash !== null)
    expect(oldRows).toHaveLength(2)
    expect(delivered?.state).toBe('deleted')
    expect(delivered?.deleted_at_ms).toBe(NOW + 10)
    const pending = oldRows.find((row) => row.remote_receipt_hash === null)
    expect(pending?.state).toBe('cancelled')
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_delivery_deletion_receipts`)).toBe(1)
    const heldShadows = db.$client
      .query<{ next_attempt_at_ms: number }, []>(
        `SELECT d.next_attempt_at_ms AS next_attempt_at_ms
           FROM analytics_deliveries d JOIN analytics_events e ON e.event_id = d.event_id
          WHERE e.storage_generation = 'gen-2'`,
      )
      .all()
    for (const row of heldShadows) expect(row.next_attempt_at_ms).toBe(REKEY_HELD_NEXT_ATTEMPT_MS)
  })

  test('remote_delete is idempotent across a restart', () => {
    const egress = createFakeEgress()
    const run = mustRun(db)
    db.transaction((tx) => {
      remoteDeleteIn(tx, run, egress, NOW + 10)
    })
    db.transaction((tx) => {
      remoteDeleteIn(tx, run, egress, NOW + 20)
    })
    expect(egress.calls).toEqual(['delete:v1.p-actor'])
  })

  test('remote_resend enqueues only still-eligible new-generation rows after deletions reconcile', () => {
    const egress = createFakeEgress()
    const run = mustRun(db)
    db.transaction((tx) => {
      remoteDeleteIn(tx, run, egress, NOW + 10)
    })
    const resent = db.transaction((tx) => remoteResendIn(tx, run, NOW + 30))
    expect(resent).toBe(2)
    const rearmed = db.$client
      .query<{ next_attempt_at_ms: number; state: string }, []>(
        `SELECT d.next_attempt_at_ms AS next_attempt_at_ms, d.state AS state
           FROM analytics_deliveries d JOIN analytics_events e ON e.event_id = d.event_id
          WHERE e.storage_generation = 'gen-2'`,
      )
      .all()
    for (const row of rearmed) {
      expect(row.state).toBe('pending')
      expect(row.next_attempt_at_ms).toBe(NOW + 30)
    }
  })

  test('remote_resend keeps rows held when the grant is no longer current', () => {
    const egress = createFakeEgress()
    const run = mustRun(db)
    db.transaction((tx) => {
      remoteDeleteIn(tx, run, egress, NOW + 10)
    })
    db.$client.run(`UPDATE analytics_eligibility_grants SET state = 'deny', generation = 2 WHERE key_version = 'v2'`)
    const resent = db.transaction((tx) => remoteResendIn(tx, run, NOW + 30))
    expect(resent).toBe(0)
    const held = db.$client
      .query<{ n: number }, [number]>(
        `SELECT COUNT(*) AS n FROM analytics_deliveries d JOIN analytics_events e ON e.event_id = d.event_id
          WHERE e.storage_generation = 'gen-2' AND d.next_attempt_at_ms = ?`,
      )
      .get(REKEY_HELD_NEXT_ATTEMPT_MS)
    expect(held?.n).toBe(2)
  })
})
