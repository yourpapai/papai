// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { planRekeyRun } from '../../../src/analytics/governance/generation-store.js'
import type { GenerationTransitionCoordinator } from '../../../src/analytics/governance/snapshot-invalidator.js'
import { createRekeyCutoverFence } from '../../../src/analytics/rekey/cutover-fence.js'
import type { RekeyCutoverFence } from '../../../src/analytics/rekey/cutover-fence.js'
import type { RekeyFullKeyMaterial } from '../../../src/analytics/rekey/dual-write.js'
import type { RekeyRemoteEgress } from '../../../src/analytics/rekey/remote.js'
import { getRekeyRun } from '../../../src/analytics/rekey/run-store.js'
import { runRekeySubphase } from '../../../src/analytics/rekey/subphases.js'
import type { RekeySubphaseContext } from '../../../src/analytics/rekey/subphases.js'
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

const COORDINATOR: GenerationTransitionCoordinator = {
  quiesceQueries: () => undefined,
  closeSourceConnections: () => undefined,
  buildTargetSnapshot: () => ({ snapshotId: 'snap-1', pathHash: 'p', sourceHighWater: 'hw' }),
  remountAndVerify: () => true,
  resumeQueries: () => undefined,
  unlinkSourceFile: () => undefined,
}

type Harness = Readonly<{ ctx: RekeySubphaseContext; fence: RekeyCutoverFence; egressCalls: readonly string[] }>

const createHarness = (db: Db): Harness => {
  const egressCalls: string[] = []
  const egress: RekeyRemoteEgress = {
    pauseEgress: () => {
      egressCalls.push('pause')
    },
    requestActorDeletion: (oldActorKey) => {
      egressCalls.push(`delete:${oldActorKey}`)
      return { remoteReceiptHash: `receipt:${oldActorKey}` }
    },
    resumeEgress: () => {
      egressCalls.push('resume')
    },
  }
  const fence = createRekeyCutoverFence({ getDrizzleDb: () => db })
  return {
    fence,
    egressCalls,
    ctx: {
      getDrizzleDb: () => db,
      coordinator: COORDINATOR,
      egress,
      fence,
      retainedEventHorizonDays: 30,
      nowMs: () => NOW,
    },
  }
}

const mustRun = (db: Db): NonNullable<ReturnType<typeof getRekeyRun>> => {
  const run = getRekeyRun(RUN_ID, depsOf(db))
  if (run === null) throw new Error('run missing')
  return run
}

const planVerifiedRun = (db: Db): void => {
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
  db.$client.run(
    `UPDATE analytics_rekey_runs SET phase = 'verify', subphase = 'verify.local_graph', status = 'running' WHERE run_id = 'run-1'`,
  )
}

describe('rekey subphase runner', () => {
  let db: Db

  beforeEach(async () => {
    db = await setupTestDb()
    seedRekeySourceGraph(db)
  })

  test('dual_write.identity installs encrypted mappings and the checkpoint in one transaction', () => {
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
    const harness = createHarness(db)
    expect(runRekeySubphase('dual_write.identity', mustRun(db), MATERIAL, harness.ctx)).toBeNull()
    const run = mustRun(db)
    expect(run.phase).toBe('dual_write')
    expect(run.subphase).toBe('dual_write.identity')
    expect(run.status).toBe('running')
    expect(run.mappedCount).toBeGreaterThan(0)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_rekey_mappings WHERE domain = 'thread:v1'`)).toBe(2)
    expect(
      countRows(db, `SELECT COUNT(*) AS n FROM analytics_rekey_mappings WHERE domain = 'event-source-ref:v1'`),
    ).toBe(0)
  })

  test('fence_drain_delta refuses while a writer is admitted and resumes after release', () => {
    planVerifiedRun(db)
    const harness = createHarness(db)
    const admission = harness.fence.admit('derive')
    expect(admission).not.toBeNull()
    expect(() => runRekeySubphase('cutover.fence_drain_delta', mustRun(db), MATERIAL, harness.ctx)).toThrow()
    expect(mustRun(db).phase).toBe('cutover')
    expect(mustRun(db).subphase).toBeNull()
    expect(harness.egressCalls).toEqual(['pause'])
    admission?.release()
    expect(runRekeySubphase('cutover.fence_drain_delta', mustRun(db), MATERIAL, harness.ctx)).toBeNull()
    expect(mustRun(db).subphase).toBe('cutover.fence_drain_delta')
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_events WHERE storage_generation = 'gen-2'`)).toBe(3)
  })

  test('remote_delete reconciles old deliveries and checkpoints atomically', () => {
    planVerifiedRun(db)
    const harness = createHarness(db)
    expect(runRekeySubphase('copy_parents.events_sources', mustRun(db), MATERIAL, harness.ctx)).toBeNull()
    expect(runRekeySubphase('copy_children.delivery_deletion', mustRun(db), MATERIAL, harness.ctx)).toBeNull()
    expect(runRekeySubphase('remote_delete', mustRun(db), MATERIAL, harness.ctx)).toBeNull()
    expect(mustRun(db).subphase).toBe('remote_delete')
    expect(harness.egressCalls).toEqual(['delete:v1.p-actor'])
    const oldStates = db.$client
      .query<{ state: string }, []>(
        `SELECT d.state AS state FROM analytics_deliveries d JOIN analytics_events e ON e.event_id = d.event_id
          WHERE e.storage_generation = 'gen-1' ORDER BY d.state`,
      )
      .all()
      .map((row) => row.state)
    expect(oldStates).toEqual(['cancelled', 'deleted'])
  })
})
