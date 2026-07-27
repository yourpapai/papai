// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { computeRetireNotBeforeMs, planRekeyRun } from '../../../src/analytics/governance/generation-store.js'
import { copyChildrenMaterializationsBackfillIn } from '../../../src/analytics/rekey/copy-children.js'
import { copyChildrenPreferencesCollectionGrantsIn } from '../../../src/analytics/rekey/copy-governance.js'
import { copyChildrenDeliveryDeletionIn, copyParentsIn } from '../../../src/analytics/rekey/copy.js'
import type { RekeyFullKeyMaterial } from '../../../src/analytics/rekey/dual-write.js'
import {
  evaluateRetirementIn,
  executeRetirementIn,
  RetirementRefusedError,
} from '../../../src/analytics/rekey/retire.js'
import type { RetirementEvaluation } from '../../../src/analytics/rekey/retire.js'
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

const RETIRE_NOT_BEFORE = computeRetireNotBeforeMs({ swapCompletedAtMs: NOW + 100, retainedEventHorizonDays: 30 })

const seedPostRemoteState = (db: Db): void => {
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
  const run = getRekeyRun(RUN_ID, depsOf(db))
  if (run === null) throw new Error('run missing')
  db.transaction((tx) => {
    copyParentsIn(tx, run, MATERIAL)
    copyChildrenMaterializationsBackfillIn(tx, run, MATERIAL)
    copyChildrenPreferencesCollectionGrantsIn(tx, run, MATERIAL)
    copyChildrenDeliveryDeletionIn(tx, run, MATERIAL)
  })
  db.$client.run(
    `UPDATE analytics_rekey_runs
        SET phase = 'remote', subphase = 'remote_resend', status = 'running',
            swap_completed_at_ms = ?, retire_not_before_ms = ?
      WHERE run_id = 'run-1'`,
    [NOW + 100, RETIRE_NOT_BEFORE],
  )
  db.$client.run(`UPDATE analytics_active_generation SET active_generation = 'gen-2', updated_at_ms = ?`, [NOW + 100])
  db.$client.run(
    `UPDATE analytics_deliveries SET state = 'deleted', delete_requested_at_ms = 1, deleted_at_ms = 1
      WHERE event_id IN (SELECT event_id FROM analytics_events WHERE storage_generation = 'gen-1') AND state = 'delivered'`,
  )
  db.$client.run(
    `UPDATE analytics_deliveries SET state = 'cancelled'
      WHERE event_id IN (SELECT event_id FROM analytics_events WHERE storage_generation = 'gen-1') AND state = 'pending'`,
  )
  db.$client.run(
    `UPDATE analytics_deletion_requests SET state = 'completed', completed_at_ms = 1 WHERE request_id = 'del-1'`,
  )
  db.$client.run(
    `UPDATE analytics_deletion_target_bundles SET target_ciphertext = '', destroyed_at = 1 WHERE request_id = 'del-1'`,
  )
}

const evaluate = (db: Db, nowMs: number, extras?: { snapshotConsumerOpen?: () => boolean }): RetirementEvaluation => {
  const run = mustRun(db)
  return db.transaction((tx) =>
    evaluateRetirementIn(tx, run, {
      nowMs,
      encryptionKeys: [GOV_KEY_V2],
      snapshotConsumerOpen: extras?.snapshotConsumerOpen,
    }),
  )
}

describe('rekey retirement', () => {
  let db: Db

  beforeEach(async () => {
    db = await setupTestDb()
    seedRekeySourceGraph(db)
    seedPostRemoteState(db)
  })

  test('retirement is refused at every millisecond before retire_not_before_ms', () => {
    expect(evaluate(db, RETIRE_NOT_BEFORE - 2).ok).toBe(false)
    expect(evaluate(db, RETIRE_NOT_BEFORE - 1).refusedReasons).toContain('horizon')
    expect(evaluate(db, RETIRE_NOT_BEFORE).ok).toBe(true)
    expect(evaluate(db, RETIRE_NOT_BEFORE + 1).ok).toBe(true)
  })

  test('retirement is refused while an unresolved deletion target depends on the mapping', () => {
    db.$client.run(
      `UPDATE analytics_deletion_requests SET state = 'requested', completed_at_ms = NULL WHERE request_id = 'del-1'`,
    )
    expect(evaluate(db, RETIRE_NOT_BEFORE).refusedReasons).toContain('deletion_target')
  })

  test('retirement is refused while a staged or published artifact is bound to the source generation', () => {
    db.$client.run(
      `INSERT INTO analytics_snapshot_publications (snapshot_id, storage_generation, path_hash, source_high_water, state, published_at)
       VALUES ('snap-src', 'gen-1', 'p', 'hw', 'published', 1)`,
    )
    expect(evaluate(db, RETIRE_NOT_BEFORE).refusedReasons).toContain('publication_bound')
  })

  test('minimal invalidated publication metadata may remain as non-serving audit evidence', () => {
    db.$client.run(
      `INSERT INTO analytics_snapshot_publications (snapshot_id, storage_generation, path_hash, source_high_water, state, published_at, invalidated_at)
       VALUES ('snap-src-inv', 'gen-1', 'p', 'hw', 'invalidated', 1, 2)`,
    )
    expect(evaluate(db, RETIRE_NOT_BEFORE).ok).toBe(true)
  })

  test('retirement is refused while an open snapshot consumer remains bound', () => {
    expect(evaluate(db, RETIRE_NOT_BEFORE, { snapshotConsumerOpen: () => true }).refusedReasons).toContain(
      'consumer_open',
    )
  })

  test('retirement is refused while local verification is incomplete', () => {
    db.$client.run(
      `DELETE FROM analytics_rekey_mappings WHERE domain = 'event-source-ref:v1' AND old_key_hash LIKE '%' LIMIT 0`,
    )
    db.$client.run(
      `INSERT INTO analytics_events (
         event_id, storage_generation, process_epoch_id, source_ref_key, source_kind,
         schema_version, event_name, event_version, occurred_at_ms, ingested_at_ms, source,
         attribution_quality, app_version, deployment_key, key_version, platform,
         platform_instance_key, context_type, actor_role, task_provider, invocation_mode,
         policy_version, eligibility, max_class, props_json, expires_at_ms
       ) VALUES (
         'ev-late', 'gen-1', 'epoch-1', 'src-late', 'live',
         1, 'llm_completed', 1, 0, 0, 'live',
         'native', '6.10.0', 'v1.p-deploy', 'v1', 'telegram',
         'v1.p-platform', 'dm', 'admin', 'none', 'normal',
         1, 'allowed', 'C0', '{}', 1
       )`,
    )
    expect(evaluate(db, RETIRE_NOT_BEFORE).refusedReasons).toContain('local_verification_incomplete')
  })

  test('retirement is refused while remote verification is incomplete', () => {
    db.$client.run(
      `UPDATE analytics_deliveries SET state = 'delete_pending', deleted_at_ms = NULL
        WHERE event_id IN (SELECT event_id FROM analytics_events WHERE storage_generation = 'gen-1') AND state = 'deleted'`,
    )
    expect(evaluate(db, RETIRE_NOT_BEFORE).refusedReasons).toContain('remote_verification_incomplete')
  })

  test('retirement is refused while a retained-generation deny cannot be resolved to the target', () => {
    db.$client.run(`DELETE FROM analytics_eligibility_grants WHERE key_version = 'v2'`)
    expect(evaluate(db, RETIRE_NOT_BEFORE).refusedReasons).toContain('unresolved_deny')
  })

  test('a restart re-evaluates and still refuses', () => {
    expect(evaluate(db, RETIRE_NOT_BEFORE - 1).ok).toBe(false)
    expect(evaluate(db, RETIRE_NOT_BEFORE - 1).ok).toBe(false)
    expect(getRekeyRun(RUN_ID, depsOf(db))?.status).toBe('running')
  })

  test('execute destroys mappings, removes the old graph in FK order, keeps audit evidence, and completes the run', () => {
    const run = mustRun(db)
    db.transaction((tx) => {
      executeRetirementIn(tx, run, {
        nowMs: RETIRE_NOT_BEFORE,
        encryptionKeys: [GOV_KEY_V2],
      })
    })
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_events WHERE storage_generation = 'gen-1'`)).toBe(0)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_events WHERE storage_generation = 'gen-2'`)).toBe(3)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_events WHERE storage_generation = 'gen-0'`)).toBe(1)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_sessions WHERE storage_generation = 'gen-1'`)).toBe(0)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_goal_attempts WHERE storage_generation = 'gen-1'`)).toBe(
      0,
    )
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_preferences WHERE key_version = 'v1'`)).toBe(0)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_eligibility_grants WHERE key_version = 'v1'`)).toBe(0)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_collection_eligibility WHERE key_version = 'v1'`)).toBe(0)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_delivery_deletion_receipts`)).toBe(1)
    const mappings = db.$client
      .query<{ state: string; mapping_ciphertext: string }, []>(
        `SELECT state, mapping_ciphertext FROM analytics_rekey_mappings`,
      )
      .all()
    expect(mappings.length).toBeGreaterThan(0)
    for (const row of mappings) {
      expect(row.state).toBe('destroyed')
      expect(row.mapping_ciphertext).toBe('')
    }
    const completed = getRekeyRun(RUN_ID, depsOf(db))
    expect(completed?.status).toBe('completed')
    expect(completed?.phase).toBe('retire')
  })

  test('execute before the boundary throws RetirementRefusedError and changes nothing', () => {
    const run = mustRun(db)
    const before = countRows(db, `SELECT COUNT(*) AS n FROM analytics_events`)
    expect(() =>
      db.transaction((tx) => {
        executeRetirementIn(tx, run, { nowMs: RETIRE_NOT_BEFORE - 1, encryptionKeys: [GOV_KEY_V2] })
      }),
    ).toThrow(RetirementRefusedError)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_events`)).toBe(before)
    expect(getRekeyRun(RUN_ID, depsOf(db))?.status).toBe('running')
  })
})
