// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { PseudonymSchema } from '../../src/analytics/controlled-types.js'
import { insertEligibleCanonicalEvent } from '../../src/analytics/governance/collection-serialization.js'
import type { CollectionSerializationDeps } from '../../src/analytics/governance/collection-serialization.js'
import { decideEligibility } from '../../src/analytics/governance/eligibility.js'
import type { EligibilityInput } from '../../src/analytics/governance/eligibility.js'
import { resolveActive } from '../../src/analytics/governance/generation-store.js'
import type { GenerationTransitionCoordinator } from '../../src/analytics/governance/snapshot-invalidator.js'
import { stageSnapshotPublication } from '../../src/analytics/governance/snapshot-publication-store.js'
import { applyRekeyAction, planRekeyAction, verifyRekeyAction } from '../../src/analytics/jobs/rekey.js'
import type { RekeyWorkflowDeps } from '../../src/analytics/jobs/rekey.js'
import { createRekeyCutoverFence, MUTABLE_WRITER_CLASSES } from '../../src/analytics/rekey/cutover-fence.js'
import type { RekeyCutoverFence } from '../../src/analytics/rekey/cutover-fence.js'
import type { RekeyFullKeyMaterial } from '../../src/analytics/rekey/dual-write.js'
import type { RekeyRemoteEgress } from '../../src/analytics/rekey/remote.js'
import { getRekeyRun } from '../../src/analytics/rekey/run-store.js'
import { closeEpoch, openEpoch } from '../../src/analytics/storage/epoch-store.js'
import { setupTestDb } from '../utils/test-helpers.js'
import {
  ANALYTICS_KEY_V2,
  countRows,
  GOV_KEY_V1,
  GOV_KEY_V2,
  NOW,
  seedRekeySourceGraph,
  SOURCE_GEN,
  TARGET_GEN,
} from './rekey/fixtures.js'
import { makeTestEvent } from './storage-fixtures.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

const PLAN_REQUEST = {
  sourceGeneration: SOURCE_GEN,
  targetGeneration: TARGET_GEN,
  fromVersions: ['v1'],
  toVersions: ['v2'],
} as const

const MATERIAL: RekeyFullKeyMaterial = {
  toVersion: 'v2',
  analyticsToKey: ANALYTICS_KEY_V2,
  governanceToKey: GOV_KEY_V2,
  encryptionKey: GOV_KEY_V2,
  encryptionKeys: [GOV_KEY_V2, GOV_KEY_V1],
}

const depsOf = (db: Db): Readonly<{ getDrizzleDb: () => Db }> => ({ getDrizzleDb: (): Db => db })

type FakeCoordinator = GenerationTransitionCoordinator & {
  calls: readonly string[]
  failQuiesce: boolean
  failBuild: boolean
  failRemountOnce: boolean
}

const createFakeCoordinator = (): FakeCoordinator => {
  const calls: string[] = []
  const state: FakeCoordinator = {
    calls,
    failQuiesce: false,
    failBuild: false,
    failRemountOnce: false,
    quiesceQueries: () => {
      if (state.failQuiesce) throw new Error('metabase quiesce failed')
      calls.push('quiesce')
    },
    closeSourceConnections: () => {
      calls.push('close')
    },
    buildTargetSnapshot: ({ targetGeneration }) => {
      if (state.failBuild) throw new Error('target snapshot build failed')
      calls.push(`build:${targetGeneration}`)
      return { snapshotId: `snap-${targetGeneration}-1`, pathHash: 'path-hash', sourceHighWater: 'hw-1' }
    },
    remountAndVerify: ({ snapshotId, expectedGeneration }) => {
      calls.push(`remount:${snapshotId}:${expectedGeneration}`)
      if (state.failRemountOnce) {
        state.failRemountOnce = false
        return false
      }
      return true
    },
    resumeQueries: () => {
      calls.push('resume')
    },
    unlinkSourceFile: ({ sourceGeneration }) => {
      calls.push(`unlink:${sourceGeneration}`)
    },
  }
  return state
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

type Harness = Readonly<{
  deps: RekeyWorkflowDeps
  fence: RekeyCutoverFence
  coordinator: FakeCoordinator
  egress: FakeEgress
  failAfter: (subphase: string | null) => void
  corruptShadowOnQuiesce: () => void
}>

const createHarness = (db: Db): Harness => {
  let failAfterSubphase: string | null = null
  let corruptOnQuiesce = false
  const coordinator = createFakeCoordinator()
  const egress = createFakeEgress()
  const fence = createRekeyCutoverFence({ getDrizzleDb: () => db })
  const deps: RekeyWorkflowDeps = {
    getDrizzleDb: () => db,
    keyMaterial: () => MATERIAL,
    coordinator,
    egress,
    fence,
    retainedEventHorizonDays: 30,
    nowMs: () => NOW,
    onSubphaseComplete: (subphase) => {
      if (corruptOnQuiesce && subphase === 'cutover.snapshot_quiesced') {
        corruptOnQuiesce = false
        deleteShadowOfExtra(db)
      }
      if (failAfterSubphase === subphase) throw new Error(`simulated crash after ${subphase}`)
    },
  }
  return {
    deps,
    fence,
    coordinator,
    egress,
    failAfter: (subphase) => {
      failAfterSubphase = subphase
    },
    corruptShadowOnQuiesce: () => {
      corruptOnQuiesce = true
    },
  }
}

const deleteShadowOfExtra = (db: Db): void => {
  db.$client.run(
    `DELETE FROM analytics_event_collection_refs
      WHERE event_id IN (SELECT event_id FROM analytics_events WHERE storage_generation = 'gen-2' AND event_name = 'chat_message_accepted')`,
  )
  db.$client.run(
    `DELETE FROM analytics_events WHERE storage_generation = 'gen-2' AND event_name = 'chat_message_accepted'`,
  )
}

const seedSourcePublication = (db: Db): void => {
  db.$client.run(
    `INSERT INTO analytics_snapshot_publications (snapshot_id, storage_generation, path_hash, source_high_water, state, published_at)
     VALUES ('snap-old', 'gen-1', 'old-path', 'hw-0', 'published', 1)`,
  )
}

const driveToVerifyBoundary = (harness: Harness): Readonly<{ runId: string; planHash: string }> => {
  const planned = planRekeyAction(PLAN_REQUEST, harness.deps)
  harness.failAfter('verify.local_graph')
  expect(() => applyRekeyAction({ runId: planned.runId, planHash: planned.planHash }, harness.deps)).toThrow()
  harness.failAfter(null)
  return planned
}

const runRow = (db: Db, runId: string): ReturnType<typeof getRekeyRun> => getRekeyRun(runId, depsOf(db))

const insertLive = (db: Db, eventId: string): void => {
  const base = makeTestEvent()
  const deps: CollectionSerializationDeps = {
    getDrizzleDb: () => db,
    getRekeyKeyMaterial: () => ({ toVersion: 'v2', toKey: ANALYTICS_KEY_V2, encryptionKey: GOV_KEY_V2 }),
  }
  insertEligibleCanonicalEvent(
    {
      event: makeTestEvent({
        event: { ...base.event, id: PseudonymSchema.parse(eventId) },
        correlation: {
          ...base.correlation,
          turn_key: PseudonymSchema.parse('v1.p-turn-delta'),
          session_key: PseudonymSchema.parse('v1.p-session-delta'),
        },
      }),
      processEpochId: 'epoch-1',
      collectionRef: { refKey: 'v1.p-colref', keyVersion: 'v1', generation: 1 },
    },
    deps,
  )
}

const publicationStates = (db: Db): readonly Readonly<{ snapshotId: string; state: string; generation: string }>[] =>
  db.$client
    .query<{ snapshot_id: string; state: string; storage_generation: string }, []>(
      `SELECT snapshot_id, state, storage_generation FROM analytics_snapshot_publications ORDER BY snapshot_id`,
    )
    .all()
    .map((row) => ({ snapshotId: row.snapshot_id, state: row.state, generation: row.storage_generation }))

const KILL_SWITCH_INPUT: EligibilityInput = {
  lane: 'external_pseudonymous',
  killSwitchActive: true,
  localMode: 'local_pseudonymous',
  externalAggregateEnabled: true,
  externalPseudonymousEnabled: true,
  lawfulBasis: 'consent',
  governanceReady: true,
  policyVersion: 1,
  policyEffectiveAtMs: null,
  nowMs: NOW,
  actorRole: 'member',
  localPreference: 'allow',
  externalPreference: 'allow',
  sink: {
    approved: true,
    capabilities: { callerControlledIdempotency: true, deterministicReconciliation: true, deleteActor: true },
  },
  collectionEligibility: { refKey: 'v1.p-colref', keyVersion: 'v1', generation: 1 },
  deliveryGrant: { grantKey: 'v1.p-grant', keyVersion: 'v1', generation: 1 },
}

describe('rekey cutover races', () => {
  let db: Db

  beforeEach(async () => {
    db = await setupTestDb()
  })

  test('pointer swap stays impossible until every admitted writer class drains; late admissions are rejected', async () => {
    for (const writerClass of MUTABLE_WRITER_CLASSES) {
      const raceDb = await setupTestDb()
      seedRekeySourceGraph(raceDb)
      const harness = createHarness(raceDb)
      const planned = driveToVerifyBoundary(harness)
      const admission = harness.fence.admit(writerClass)
      expect(admission).not.toBeNull()
      expect(() => applyRekeyAction({ runId: planned.runId, planHash: planned.planHash }, harness.deps)).toThrow()
      expect(runRow(raceDb, planned.runId)?.phase).toBe('cutover')
      expect(runRow(raceDb, planned.runId)?.status).toBe('paused')
      expect(resolveActive(depsOf(raceDb)).generation).toBe(SOURCE_GEN)
      expect(harness.fence.admit('intent')).toBeNull()
      admission?.release()
      const result = applyRekeyAction({ runId: planned.runId, planHash: planned.planHash }, harness.deps)
      expect(result.phase).toBe('retire')
      expect(resolveActive(depsOf(raceDb)).generation).toBe(TARGET_GEN)
    }
  })

  test('a post-high-water opportunity admitted before the fence is caught up during the drain', () => {
    seedRekeySourceGraph(db)
    const harness = createHarness(db)
    const planned = driveToVerifyBoundary(harness)
    insertLive(db, 'v1.ev-delta')
    const result = applyRekeyAction({ runId: planned.runId, planHash: planned.planHash }, harness.deps)
    expect(result.phase).toBe('retire')
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_events WHERE storage_generation = 'gen-2'`)).toBe(4)
    const verified = verifyRekeyAction({ runId: planned.runId }, harness.deps)
    expect(verified.equation.ok).toBe(true)
    expect(verified.content.ok).toBe(true)
  })

  test('egress stays paused from before the cutover until remote_resend completes', () => {
    seedRekeySourceGraph(db)
    const harness = createHarness(db)
    const planned = driveToVerifyBoundary(harness)
    harness.failAfter('swap.active_generation')
    expect(() => applyRekeyAction({ runId: planned.runId, planHash: planned.planHash }, harness.deps)).toThrow()
    harness.failAfter(null)
    expect(harness.egress.calls).toEqual(['pause'])
    expect(resolveActive(depsOf(db)).generation).toBe(TARGET_GEN)
    const result = applyRekeyAction({ runId: planned.runId, planHash: planned.planHash }, harness.deps)
    expect(result.phase).toBe('retire')
    expect(harness.egress.calls).toEqual(['pause', 'delete:v1.p-actor', 'resume'])
  })
})

describe('rekey snapshot cutover interruption', () => {
  let db: Db

  beforeEach(async () => {
    db = await setupTestDb()
    seedRekeySourceGraph(db)
    seedSourcePublication(db)
  })

  test('a failure before close keeps the source pointer and publication and never enters snapshot_republish', () => {
    const harness = createHarness(db)
    const planned = driveToVerifyBoundary(harness)
    harness.coordinator.failQuiesce = true
    expect(() => applyRekeyAction({ runId: planned.runId, planHash: planned.planHash }, harness.deps)).toThrow()
    expect(runRow(db, planned.runId)?.phase).toBe('cutover')
    expect(runRow(db, planned.runId)?.status).toBe('paused')
    expect(resolveActive(depsOf(db)).generation).toBe(SOURCE_GEN)
    expect(publicationStates(db)).toEqual([{ snapshotId: 'snap-old', state: 'published', generation: SOURCE_GEN }])
    harness.coordinator.failQuiesce = false
    const result = applyRekeyAction({ runId: planned.runId, planHash: planned.planHash }, harness.deps)
    expect(result.phase).toBe('retire')
    const published = publicationStates(db).filter((row) => row.state === 'published')
    expect(published).toEqual([{ snapshotId: `snap-${TARGET_GEN}-1`, state: 'published', generation: TARGET_GEN }])
    expect(harness.coordinator.calls).toEqual([
      'quiesce',
      'close',
      `build:${TARGET_GEN}`,
      `remount:snap-${TARGET_GEN}-1:${TARGET_GEN}`,
      'resume',
      `unlink:${SOURCE_GEN}`,
    ])
  })

  test('an after-close/pre-swap restart re-drains, re-verifies, and idempotently re-closes before the swap', () => {
    const harness = createHarness(db)
    const planned = driveToVerifyBoundary(harness)
    harness.corruptShadowOnQuiesce()
    expect(() => applyRekeyAction({ runId: planned.runId, planHash: planned.planHash }, harness.deps)).toThrow()
    expect(runRow(db, planned.runId)?.phase).toBe('cutover')
    expect(runRow(db, planned.runId)?.subphase).toBe('cutover.snapshot_quiesced')
    expect(resolveActive(depsOf(db)).generation).toBe(SOURCE_GEN)
    expect(publicationStates(db)).toEqual([{ snapshotId: 'snap-old', state: 'published', generation: SOURCE_GEN }])
    expect(harness.coordinator.calls).toEqual(['quiesce', 'close'])
    const result = applyRekeyAction({ runId: planned.runId, planHash: planned.planHash }, harness.deps)
    expect(result.phase).toBe('retire')
    expect(harness.coordinator.calls).toEqual([
      'quiesce',
      'close',
      'quiesce',
      'close',
      `build:${TARGET_GEN}`,
      `remount:snap-${TARGET_GEN}-1:${TARGET_GEN}`,
      'resume',
      `unlink:${SOURCE_GEN}`,
    ])
    const verified = verifyRekeyAction({ runId: planned.runId }, harness.deps)
    expect(verified.equation.ok).toBe(true)
  })

  test('a failure during the target build keeps BI down with the old publication invalidated and resumes the same run', () => {
    const harness = createHarness(db)
    const planned = driveToVerifyBoundary(harness)
    harness.failAfter('swap.active_generation')
    expect(() => applyRekeyAction({ runId: planned.runId, planHash: planned.planHash }, harness.deps)).toThrow()
    harness.failAfter(null)
    harness.coordinator.failBuild = true
    expect(() => applyRekeyAction({ runId: planned.runId, planHash: planned.planHash }, harness.deps)).toThrow()
    expect(runRow(db, planned.runId)?.phase).toBe('snapshot_republish')
    expect(runRow(db, planned.runId)?.status).toBe('paused')
    expect(resolveActive(depsOf(db)).generation).toBe(TARGET_GEN)
    expect(publicationStates(db)).toEqual([{ snapshotId: 'snap-old', state: 'invalidated', generation: SOURCE_GEN }])
    expect(() =>
      stageSnapshotPublication(
        {
          snapshotId: 'snap-ordinary',
          storageGeneration: TARGET_GEN,
          pathHash: 'p',
          sourceHighWater: 'hw',
          nowMs: NOW,
        },
        depsOf(db),
      ),
    ).toThrow()
    harness.coordinator.failBuild = false
    const result = applyRekeyAction({ runId: planned.runId, planHash: planned.planHash }, harness.deps)
    expect(result.phase).toBe('retire')
    const published = publicationStates(db).filter((row) => row.state === 'published')
    expect(published).toEqual([{ snapshotId: `snap-${TARGET_GEN}-1`, state: 'published', generation: TARGET_GEN }])
    expect(harness.coordinator.calls.filter((call) => call.startsWith('build'))).toHaveLength(1)
  })

  test('a remount verification failure keeps one staged row and a restart promotes it without rebuilding', () => {
    const harness = createHarness(db)
    const planned = driveToVerifyBoundary(harness)
    harness.failAfter('swap.active_generation')
    expect(() => applyRekeyAction({ runId: planned.runId, planHash: planned.planHash }, harness.deps)).toThrow()
    harness.failAfter(null)
    harness.coordinator.failRemountOnce = true
    expect(() => applyRekeyAction({ runId: planned.runId, planHash: planned.planHash }, harness.deps)).toThrow()
    expect(runRow(db, planned.runId)?.phase).toBe('snapshot_republish')
    const staged = publicationStates(db).filter((row) => row.state === 'staged')
    expect(staged).toEqual([{ snapshotId: `snap-${TARGET_GEN}-1`, state: 'staged', generation: TARGET_GEN }])
    const result = applyRekeyAction({ runId: planned.runId, planHash: planned.planHash }, harness.deps)
    expect(result.phase).toBe('retire')
    expect(harness.coordinator.calls.filter((call) => call.startsWith('build'))).toHaveLength(1)
    const published = publicationStates(db).filter((row) => row.state === 'published')
    expect(published).toEqual([{ snapshotId: `snap-${TARGET_GEN}-1`, state: 'published', generation: TARGET_GEN }])
  })
})

describe('rekey compromise mode', () => {
  let db: Db

  beforeEach(async () => {
    db = await setupTestDb()
    seedRekeySourceGraph(db)
  })

  test('the kill switch stops egress and an unsafe rotation breaks the cohort epoch without alias rewrite', () => {
    const decision = decideEligibility(KILL_SWITCH_INPUT)
    expect(decision.allowed).toBe(false)
    const egress = createFakeEgress()
    egress.pauseEgress({ runId: 'compromise-1', nowMs: NOW })
    expect(egress.calls).toEqual(['pause'])
    closeEpoch({ epochId: 'epoch-1', closedAtMs: NOW + 10 }, depsOf(db))
    openEpoch({ epochId: 'epoch-2', startedAtMs: NOW + 10 }, depsOf(db))
    const epochs = db.$client
      .query<{ epoch_id: string; state: string; closed_at_ms: number | null }, []>(
        `SELECT epoch_id, state, closed_at_ms FROM analytics_process_epochs ORDER BY epoch_id`,
      )
      .all()
    expect(epochs).toEqual([
      { epoch_id: 'epoch-1', state: 'closed', closed_at_ms: NOW + 10 },
      { epoch_id: 'epoch-2', state: 'open', closed_at_ms: null },
    ])
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_rekey_mappings`)).toBe(0)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_rekey_runs`)).toBe(0)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_deliveries WHERE state = 'pending'`)).toBe(1)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_events WHERE storage_generation = 'gen-1'`)).toBe(3)
  })
})
