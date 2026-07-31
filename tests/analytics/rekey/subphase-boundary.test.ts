// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { planRekeyRun, resolveActive } from '../../../src/analytics/governance/generation-store.js'
import type { GenerationTransitionCoordinator } from '../../../src/analytics/governance/snapshot-invalidator.js'
import { createRekeyCutoverFence } from '../../../src/analytics/rekey/cutover-fence.js'
import type { RekeyFullKeyMaterial } from '../../../src/analytics/rekey/dual-write.js'
import type { RekeyRemoteEgress } from '../../../src/analytics/rekey/remote.js'
import { getRekeyRun } from '../../../src/analytics/rekey/run-store.js'
import { runSnapshotRepublishSwitch, runSwapActiveGeneration } from '../../../src/analytics/rekey/subphase-boundary.js'
import type { RekeySubphaseContext } from '../../../src/analytics/rekey/subphase-shared.js'
import { runRekeySubphase } from '../../../src/analytics/rekey/subphases.js'
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

const RUN_ID = 'run-boundary'
const DAY_MS = 86_400_000

const MATERIAL: RekeyFullKeyMaterial = {
  toVersion: 'v2',
  analyticsToKey: ANALYTICS_KEY_V2,
  governanceToKey: GOV_KEY_V2,
  encryptionKey: GOV_KEY_V2,
  encryptionKeys: [GOV_KEY_V2, GOV_KEY_V1],
}

const depsOf = (db: Db): Readonly<{ getDrizzleDb: () => Db }> => ({ getDrizzleDb: (): Db => db })

type Harness = Readonly<{ ctx: RekeySubphaseContext; coordinatorCalls: readonly string[] }>

const createHarness = (db: Db): Harness => {
  const coordinatorCalls: string[] = []
  const coordinator: GenerationTransitionCoordinator = {
    quiesceQueries: () => {
      coordinatorCalls.push('quiesce')
    },
    closeSourceConnections: () => {
      coordinatorCalls.push('close')
    },
    buildTargetSnapshot: () => {
      coordinatorCalls.push('build')
      return { snapshotId: 'snap-1', pathHash: 'p', sourceHighWater: 'hw' }
    },
    remountAndVerify: () => {
      coordinatorCalls.push('remount')
      return true
    },
    resumeQueries: () => {
      coordinatorCalls.push('resume')
    },
    unlinkSourceFile: () => {
      coordinatorCalls.push('unlink')
    },
  }
  const egress: RekeyRemoteEgress = {
    pauseEgress: () => undefined,
    requestActorDeletion: () => null,
    resumeEgress: () => undefined,
  }
  return {
    coordinatorCalls,
    ctx: {
      getDrizzleDb: (): Db => db,
      coordinator,
      egress,
      fence: createRekeyCutoverFence({ getDrizzleDb: (): Db => db }),
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

const driveCopies = (db: Db, harness: Harness): void => {
  for (const subphase of [
    'dual_write.identity',
    'dual_write.governance',
    'copy_parents.events_sources',
    'copy_children.materializations_backfill',
    'copy_children.preferences_collection_grants',
    'copy_children.delivery_deletion',
  ] as const) {
    expect(runRekeySubphase(subphase, mustRun(db), MATERIAL, harness.ctx)).toBeNull()
  }
}

describe('rekey boundary subphases', () => {
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

  test('swap updates the pointer, invalidates source publications, and sets the retirement boundary', () => {
    db.$client.run(
      `INSERT INTO analytics_snapshot_publications (snapshot_id, storage_generation, path_hash, source_high_water, state, published_at)
       VALUES ('snap-old', 'gen-1', 'old-path', 'hw-0', 'published', 1)`,
    )
    const harness = createHarness(db)
    driveCopies(db, harness)
    runSwapActiveGeneration(mustRun(db), MATERIAL, harness.ctx)
    expect(resolveActive(depsOf(db)).generation).toBe(TARGET_GEN)
    const run = mustRun(db)
    expect(run.subphase).toBe('swap.active_generation')
    expect(run.swapCompletedAtMs).toBe(NOW)
    expect(run.retireNotBeforeMs).toBe(NOW + 90 * DAY_MS)
    const state = db.$client
      .query<{ state: string }, []>(`SELECT state FROM analytics_snapshot_publications WHERE snapshot_id = 'snap-old'`)
      .get()
    expect(state?.state).toBe('invalidated')
  })

  test('snapshot republish resumes past the switch when the run already owns a published row', () => {
    db.$client.run(
      `INSERT INTO analytics_snapshot_publications (snapshot_id, storage_generation, path_hash, source_high_water, state, published_at, transition_run_id)
       VALUES ('snap-new', 'gen-2', 'new-path', 'hw-1', 'published', 1, 'run-boundary')`,
    )
    const harness = createHarness(db)
    runSnapshotRepublishSwitch(mustRun(db), harness.ctx)
    expect(mustRun(db).subphase).toBe('snapshot_republish.quiesce_build_switch')
    expect(harness.coordinatorCalls).toEqual([])
  })
})
