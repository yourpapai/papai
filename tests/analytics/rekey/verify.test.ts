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
import { verifyShadowEquationIn } from '../../../src/analytics/rekey/verify.js'
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

export const MATERIAL: RekeyFullKeyMaterial = {
  toVersion: 'v2',
  analyticsToKey: ANALYTICS_KEY_V2,
  governanceToKey: GOV_KEY_V2,
  encryptionKey: GOV_KEY_V2,
  encryptionKeys: [GOV_KEY_V2, GOV_KEY_V1],
}

export const depsOf = (db: Db): Readonly<{ getDrizzleDb: () => Db }> => ({ getDrizzleDb: (): Db => db })

export const mustRun = (db: Db): AnalyticsRekeyRunRow => {
  const run = getRekeyRun(RUN_ID, depsOf(db))
  if (run === null) throw new Error('run missing')
  return run
}

export const planRun = (db: Db): void => {
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

export const runFullCopy = (db: Db): void => {
  const run = mustRun(db)
  db.transaction((tx) => {
    copyParentsIn(tx, run, MATERIAL)
    copyChildrenMaterializationsBackfillIn(tx, run, MATERIAL)
    copyChildrenPreferencesCollectionGrantsIn(tx, run, MATERIAL)
    copyChildrenDeliveryDeletionIn(tx, run, MATERIAL)
  })
}

describe('rekey shadow equation', () => {
  let db: Db

  beforeEach(async () => {
    db = await setupTestDb()
    seedRekeySourceGraph(db)
    planRun(db)
  })

  test('the shadow equation holds after a complete copy', () => {
    runFullCopy(db)
    const report = db.transaction((tx) => verifyShadowEquationIn(tx, mustRun(db), [GOV_KEY_V2]))
    expect(report.activeParentCount).toBe(3)
    expect(report.shadowParentCount).toBe(3)
    expect(report.mappedPairCount).toBe(3)
    expect(report.countsEqual).toBe(true)
    expect(report.hashesEqual).toBe(true)
    expect(report.activeHash).toBe(report.normalizedShadowHash)
    expect(report.ok).toBe(true)
  })

  test('an unmapped one-sided shadow breaks the equation and cannot be balanced', () => {
    runFullCopy(db)
    db.$client.run(
      `INSERT INTO analytics_events (
         event_id, storage_generation, process_epoch_id, source_ref_key, source_kind,
         schema_version, event_name, event_version, occurred_at_ms, ingested_at_ms, source,
         attribution_quality, app_version, deployment_key, key_version, platform,
         platform_instance_key, context_type, actor_role, task_provider, invocation_mode,
         policy_version, eligibility, max_class, props_json, expires_at_ms
       ) VALUES (
         'ev-orphan-shadow', 'gen-2', 'epoch-1', 'src-orphan', 'live',
         1, 'llm_completed', 1, 0, 0, 'live',
         'native', '6.10.0', 'v2.p-deploy', 'v2', 'telegram',
         'v2.p-platform', 'dm', 'admin', 'none', 'normal',
         1, 'allowed', 'C0', '{}', 1
       )`,
    )
    const report = db.transaction((tx) => verifyShadowEquationIn(tx, mustRun(db), [GOV_KEY_V2]))
    expect(report.ok).toBe(false)
    expect(report.countsEqual).toBe(false)
  })

  test('a missing shadow parent breaks the equation even when counters would agree', () => {
    runFullCopy(db)
    db.$client.run(
      `DELETE FROM analytics_event_collection_refs WHERE event_id IN (SELECT event_id FROM analytics_events WHERE storage_generation = 'gen-2' AND event_name = 'tool_completed')`,
    )
    db.$client.run(
      `DELETE FROM analytics_backfill_event_map WHERE event_id IN (SELECT event_id FROM analytics_events WHERE storage_generation = 'gen-2' AND event_name = 'tool_completed')`,
    )
    db.$client.run(
      `DELETE FROM analytics_deliveries WHERE event_id IN (SELECT event_id FROM analytics_events WHERE storage_generation = 'gen-2' AND event_name = 'tool_completed')`,
    )
    db.$client.run(
      `DELETE FROM analytics_session_events WHERE event_id IN (SELECT event_id FROM analytics_events WHERE storage_generation = 'gen-2' AND event_name = 'tool_completed')`,
    )
    db.$client.run(`DELETE FROM analytics_events WHERE storage_generation = 'gen-2' AND event_name = 'tool_completed'`)
    const report = db.transaction((tx) => verifyShadowEquationIn(tx, mustRun(db), [GOV_KEY_V2]))
    expect(report.ok).toBe(false)
  })
})
