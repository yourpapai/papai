// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'

import { planRekeyRun } from '../../../src/analytics/governance/generation-store.js'
import {
  abortRekeyRun,
  getNonterminalRekeyRun,
  getRekeyRun,
  REKEY_LOGICAL_PHASE_ORDER,
  REKEY_SUBPHASE_SEQUENCE,
} from '../../../src/analytics/rekey/run-store.js'
import { setupTestDb } from '../../utils/test-helpers.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

const NOW = 1700000000000

const depsOf = (db: Db): Readonly<{ getDrizzleDb: () => Db }> => ({ getDrizzleDb: (): Db => db })

const planRun = (db: Db, runId = 'run-1', target = 'gen-2'): void => {
  planRekeyRun(
    {
      runId,
      sourceGeneration: 'gen-1',
      targetGeneration: target,
      fromVersions: ['v1'],
      toVersions: ['v2'],
      sourceHighWater: 'hw-1',
      planHash: createHash('sha256').update(`plan:${runId}`).digest('hex'),
      nowMs: NOW,
    },
    depsOf(db),
  )
}

describe('rekey run store', () => {
  let db: Db

  beforeEach(async () => {
    db = await setupTestDb()
  })

  test('frozen logical phase order and checkpoint names match the plan', () => {
    expect(REKEY_LOGICAL_PHASE_ORDER).toEqual([
      'plan',
      'dual_write',
      'copy_parents',
      'copy_children',
      'verify',
      'cutover_fence',
      'swap',
      'snapshot_republish',
      'remote_delete',
      'remote_resend',
      'retire',
    ])
    expect(REKEY_SUBPHASE_SEQUENCE).toEqual([
      'dual_write.identity',
      'dual_write.governance',
      'copy_parents.events_sources',
      'copy_children.materializations_backfill',
      'copy_children.preferences_collection_grants',
      'copy_children.delivery_deletion',
      'verify.local_graph',
      'cutover.fence_drain_delta',
      'cutover.snapshot_quiesced',
      'swap.active_generation',
      'snapshot_republish.quiesce_build_switch',
      'remote_delete',
      'remote_resend',
      'retire.waiting_horizon',
    ])
  })

  test('getRekeyRun and getNonterminalRekeyRun read persisted state', () => {
    expect(getNonterminalRekeyRun(depsOf(db))).toBeNull()
    planRun(db)
    const run = getRekeyRun('run-1', depsOf(db))
    expect(run?.phase).toBe('plan')
    expect(run?.status).toBe('planned')
    expect(getNonterminalRekeyRun(depsOf(db))?.runId).toBe('run-1')
  })

  test('abort of a pristine plan releases the unique run slot', () => {
    planRun(db)
    expect(abortRekeyRun({ runId: 'run-1', nowMs: NOW + 1 }, depsOf(db))).toBe('aborted')
    expect(getRekeyRun('run-1', depsOf(db))?.status).toBe('aborted')
    expect(getNonterminalRekeyRun(depsOf(db))).toBeNull()
    planRun(db, 'run-2', 'gen-3')
    expect(getNonterminalRekeyRun(depsOf(db))?.runId).toBe('run-2')
  })

  test('abort is rejected once a mapping exists and the run stays resumable', () => {
    planRun(db)
    db.$client.run(
      `INSERT INTO analytics_rekey_mappings (run_id, domain, old_key_hash, mapping_ciphertext, mapping_hash, state)
       VALUES ('run-1', 'thread:v1', 'h', 'c', 'm', 'mapped')`,
    )
    expect(abortRekeyRun({ runId: 'run-1', nowMs: NOW + 1 }, depsOf(db))).toBe('rejected')
    const run = getRekeyRun('run-1', depsOf(db))
    expect(run?.status).toBe('planned')
    expect(getNonterminalRekeyRun(depsOf(db))?.runId).toBe('run-1')
  })

  test('abort is rejected once a target-generation row exists', () => {
    planRun(db)
    db.$client.run(`INSERT INTO analytics_process_epochs (epoch_id, state, started_at_ms) VALUES ('ep-1', 'open', 0)`)
    db.$client.run(
      `INSERT INTO analytics_events (
         event_id, storage_generation, process_epoch_id, source_ref_key, source_kind,
         schema_version, event_name, event_version, occurred_at_ms, ingested_at_ms, source,
         attribution_quality, app_version, deployment_key, key_version, platform,
         platform_instance_key, context_type, actor_role, task_provider, invocation_mode,
         policy_version, eligibility, max_class, props_json, expires_at_ms
       ) VALUES (
         'ev-target', 'gen-2', 'ep-1', 'src-1', 'live',
         1, 'llm_completed', 1, 0, 0, 'live',
         'native', '6.10.0', 'v1.p-deploy', 'v2', 'telegram',
         'v2.p-platform', 'dm', 'admin', 'none', 'normal',
         1, 'allowed', 'C0', '{}', 1
       )`,
    )
    expect(abortRekeyRun({ runId: 'run-1', nowMs: NOW + 1 }, depsOf(db))).toBe('rejected')
  })

  test('abort of an unknown or terminal run is rejected', () => {
    expect(abortRekeyRun({ runId: 'missing', nowMs: NOW }, depsOf(db))).toBe('rejected')
    planRun(db)
    expect(abortRekeyRun({ runId: 'run-1', nowMs: NOW }, depsOf(db))).toBe('aborted')
    expect(abortRekeyRun({ runId: 'run-1', nowMs: NOW + 1 }, depsOf(db))).toBe('rejected')
  })
})
