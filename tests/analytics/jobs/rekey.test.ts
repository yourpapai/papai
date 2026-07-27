// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { PseudonymSchema } from '../../../src/analytics/controlled-types.js'
import { insertEligibleCanonicalEvent } from '../../../src/analytics/governance/collection-serialization.js'
import type { CollectionSerializationDeps } from '../../../src/analytics/governance/collection-serialization.js'
import { setEligibilityState } from '../../../src/analytics/governance/collection-store.js'
import {
  openDeletionTargetsIn,
  sealDeletionTargetsIn,
} from '../../../src/analytics/governance/deletion-target-store.js'
import { resolveActive } from '../../../src/analytics/governance/generation-store.js'
import { setGrantState } from '../../../src/analytics/governance/grant-store.js'
import { getPreference, setPreference, withdrawPreference } from '../../../src/analytics/governance/preference-store.js'
import type { GenerationTransitionCoordinator } from '../../../src/analytics/governance/snapshot-invalidator.js'
import {
  abortRekeyAction,
  applyRekeyAction,
  computeRekeyPlanHash,
  planRekeyAction,
  verifyRekeyAction,
} from '../../../src/analytics/jobs/rekey.js'
import type { RekeyWorkflowDeps } from '../../../src/analytics/jobs/rekey.js'
import { REKEY_HELD_NEXT_ATTEMPT_MS } from '../../../src/analytics/rekey/copy.js'
import { createRekeyCutoverFence } from '../../../src/analytics/rekey/cutover-fence.js'
import type { RekeyFullKeyMaterial } from '../../../src/analytics/rekey/dual-write.js'
import { createGovernanceDualWriteResolver } from '../../../src/analytics/rekey/governance-dual-write.js'
import type { RekeyRemoteEgress } from '../../../src/analytics/rekey/remote.js'
import { getNonterminalRekeyRun, getRekeyRun, REKEY_SUBPHASE_SEQUENCE } from '../../../src/analytics/rekey/run-store.js'
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
} from '../rekey/fixtures.js'
import { makeTestEvent } from '../storage-fixtures.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

const DAY_MS = 86_400_000
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

const INTERRUPTIBLE_SUBPHASES = REKEY_SUBPHASE_SEQUENCE.filter((subphase) => subphase !== 'retire.waiting_horizon')

type FakeCoordinator = GenerationTransitionCoordinator & { calls: readonly string[] }

const createFakeCoordinator = (): FakeCoordinator => {
  const calls: string[] = []
  return {
    calls,
    quiesceQueries: () => {
      calls.push('quiesce')
    },
    closeSourceConnections: () => {
      calls.push('close')
    },
    buildTargetSnapshot: ({ targetGeneration }) => {
      calls.push(`build:${targetGeneration}`)
      return { snapshotId: `snap-${targetGeneration}-1`, pathHash: 'path-hash', sourceHighWater: 'hw-1' }
    },
    remountAndVerify: ({ snapshotId, expectedGeneration }) => {
      calls.push(`remount:${snapshotId}:${expectedGeneration}`)
      return true
    },
    resumeQueries: () => {
      calls.push('resume')
    },
    unlinkSourceFile: ({ sourceGeneration }) => {
      calls.push(`unlink:${sourceGeneration}`)
    },
  }
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
  coordinator: FakeCoordinator
  egress: FakeEgress
  completedSubphases: readonly string[]
  setClock: (nowMs: number) => void
  failAfter: (subphase: string | null) => void
}>

const createHarness = (db: Db): Harness => {
  let clock = NOW
  let failAfterSubphase: string | null = null
  const completed: string[] = []
  const coordinator = createFakeCoordinator()
  const egress = createFakeEgress()
  const deps: RekeyWorkflowDeps = {
    getDrizzleDb: () => db,
    keyMaterial: () => MATERIAL,
    coordinator,
    egress,
    fence: createRekeyCutoverFence({ getDrizzleDb: () => db }),
    retainedEventHorizonDays: 30,
    nowMs: () => clock,
    onSubphaseComplete: (subphase) => {
      completed.push(subphase)
      if (failAfterSubphase === subphase) throw new Error(`simulated crash after ${subphase}`)
    },
  }
  return {
    deps,
    coordinator,
    egress,
    completedSubphases: completed,
    setClock: (nowMs) => {
      clock = nowMs
    },
    failAfter: (subphase) => {
      failAfterSubphase = subphase
    },
  }
}

const depsOf = (db: Db): Readonly<{ getDrizzleDb: () => Db }> => ({ getDrizzleDb: (): Db => db })

const planViaAction = (deps: RekeyWorkflowDeps): Readonly<{ runId: string; planHash: string }> =>
  planRekeyAction(PLAN_REQUEST, deps)

const runRow = (db: Db, runId: string): ReturnType<typeof getRekeyRun> => getRekeyRun(runId, depsOf(db))

const counterValue = (db: Db, disposition: string): number => {
  const row = db.$client
    .query<{ value: number }, [string]>(`SELECT value FROM analytics_epoch_source_counters WHERE disposition = ?`)
    .get(disposition)
  return row?.value ?? 0
}

const completeSeededDeletionRequest = (db: Db): void => {
  db.$client.run(
    `UPDATE analytics_deletion_requests SET state = 'completed', completed_at_ms = 1 WHERE request_id = 'del-1'`,
  )
  db.$client.run(
    `UPDATE analytics_deletion_target_bundles SET target_ciphertext = '', destroyed_at = 1 WHERE request_id = 'del-1'`,
  )
}

const insertLive = (db: Db, eventId: string): string => {
  const base = makeTestEvent()
  const deps: CollectionSerializationDeps = {
    getDrizzleDb: () => db,
    getRekeyKeyMaterial: () => ({ toVersion: 'v2', toKey: ANALYTICS_KEY_V2, encryptionKey: GOV_KEY_V2 }),
  }
  const result = insertEligibleCanonicalEvent(
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
  if (!('eventId' in result)) throw new Error('delta source opportunity was not eligible')
  return result.eventId
}

const resolver = createGovernanceDualWriteResolver({
  getGovernanceKey: () => ({ toVersion: 'v2', toKey: GOV_KEY_V2 }),
})

describe('rekey CLI actions', () => {
  let db: Db

  beforeEach(async () => {
    db = await setupTestDb()
    seedRekeySourceGraph(db)
  })

  test('plan persists a planned run bound to the current database state and rejects a second nonterminal run', () => {
    const harness = createHarness(db)
    const planned = planViaAction(harness.deps)
    expect(planned.runId.startsWith('rekey-')).toBe(true)
    expect(planned.planHash).toBe(computeRekeyPlanHash(PLAN_REQUEST, harness.deps))
    const run = runRow(db, planned.runId)
    expect(run?.status).toBe('planned')
    expect(run?.phase).toBe('plan')
    expect(run?.planHash).toBe(planned.planHash)
    expect(() => planRekeyAction({ ...PLAN_REQUEST, targetGeneration: 'gen-3' }, harness.deps)).toThrow()
  })

  test('apply requires the plan artifact hash produced in the same database state', () => {
    const harness = createHarness(db)
    const planned = planViaAction(harness.deps)
    expect(() => applyRekeyAction({ runId: planned.runId, planHash: 'stale-hash' }, harness.deps)).toThrow()
    expect(runRow(db, planned.runId)?.status).toBe('planned')
  })

  test('apply drives the frozen phase order through the swap to the retire horizon', () => {
    const harness = createHarness(db)
    const planned = planViaAction(harness.deps)
    const result = applyRekeyAction({ runId: planned.runId, planHash: planned.planHash }, harness.deps)
    expect(harness.completedSubphases).toEqual(REKEY_SUBPHASE_SEQUENCE)
    expect(result.phase).toBe('retire')
    expect(result.subphase).toBe('retire.waiting_horizon')
    expect(result.retired).toBe(false)
    expect(result.refusedReasons).toContain('horizon')
    const run = runRow(db, planned.runId)
    expect(run?.status).toBe('running')
    expect(run?.swapCompletedAtMs).toBe(NOW)
    expect(run?.retireNotBeforeMs).toBe(NOW + 90 * DAY_MS)
    expect(resolveActive(depsOf(db)).generation).toBe(TARGET_GEN)
    expect(harness.egress.calls).toEqual(['pause', 'delete:v1.p-actor', 'resume'])
    expect(harness.coordinator.calls).toEqual([
      'quiesce',
      'close',
      `build:${TARGET_GEN}`,
      `remount:snap-${TARGET_GEN}-1:${TARGET_GEN}`,
      'resume',
      `unlink:${SOURCE_GEN}`,
    ])
    const verified = verifyRekeyAction({ runId: planned.runId }, harness.deps)
    expect(verified.equation.ok).toBe(true)
    expect(verified.content.ok).toBe(true)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_events WHERE storage_generation = 'gen-2'`)).toBe(3)
  })

  test('apply after the horizon destroys the mappings, removes the old graph, and completes the run', () => {
    const harness = createHarness(db)
    const planned = planViaAction(harness.deps)
    applyRekeyAction({ runId: planned.runId, planHash: planned.planHash }, harness.deps)
    completeSeededDeletionRequest(db)
    harness.setClock(NOW + 90 * DAY_MS)
    const result = applyRekeyAction({ runId: planned.runId, planHash: planned.planHash }, harness.deps)
    expect(result.retired).toBe(true)
    const run = runRow(db, planned.runId)
    expect(run?.status).toBe('completed')
    expect(run?.phase).toBe('retire')
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_events WHERE storage_generation = 'gen-1'`)).toBe(0)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_events WHERE storage_generation = 'gen-2'`)).toBe(3)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_events WHERE storage_generation = 'gen-0'`)).toBe(1)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_rekey_mappings WHERE state != 'destroyed'`)).toBe(0)
  })

  test('abort is legal only for a pristine plan; later attempts keep one resumable run and admit no new target', () => {
    const harness = createHarness(db)
    const first = planViaAction(harness.deps)
    expect(abortRekeyAction({ runId: first.runId }, harness.deps)).toBe('aborted')
    const second = planViaAction(harness.deps)
    harness.failAfter('dual_write.identity')
    expect(() => applyRekeyAction({ runId: second.runId, planHash: second.planHash }, harness.deps)).toThrow()
    harness.failAfter(null)
    expect(abortRekeyAction({ runId: second.runId }, harness.deps)).toBe('rejected')
    expect(runRow(db, second.runId)?.status).toBe('paused')
    expect(getNonterminalRekeyRun(depsOf(db))?.runId).toBe(second.runId)
    expect(() => planRekeyAction({ ...PLAN_REQUEST, targetGeneration: 'gen-3' }, harness.deps)).toThrow()
  })

  test('interruption immediately after every subphase commit pauses the run and resume stays idempotent', () => {
    const harness = createHarness(db)
    const planned = planViaAction(harness.deps)
    for (const subphase of INTERRUPTIBLE_SUBPHASES) {
      harness.failAfter(subphase)
      expect(() => applyRekeyAction({ runId: planned.runId, planHash: planned.planHash }, harness.deps)).toThrow()
      expect(runRow(db, planned.runId)?.subphase).toBe(subphase)
      expect(runRow(db, planned.runId)?.status).toBe('paused')
      expect(abortRekeyAction({ runId: planned.runId }, harness.deps)).toBe('rejected')
      expect(getNonterminalRekeyRun(depsOf(db))?.runId).toBe(planned.runId)
      harness.failAfter(null)
    }
    const result = applyRekeyAction({ runId: planned.runId, planHash: planned.planHash }, harness.deps)
    expect(result.phase).toBe('retire')
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_events`)).toBe(7)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_sessions`)).toBe(2)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_deliveries`)).toBe(4)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_preferences`)).toBe(2)
    expect(
      countRows(db, `SELECT COUNT(*) AS n FROM analytics_rekey_mappings WHERE domain = 'event-source-ref:v1'`),
    ).toBe(3)
    const verified = verifyRekeyAction({ runId: planned.runId }, harness.deps)
    expect(verified.equation.ok).toBe(true)
    expect(verified.content.ok).toBe(true)
  })

  test('post-high-water deltas dual-write once, survive interruption, and stay bound by every generation deny', () => {
    const harness = createHarness(db)
    const planned = planViaAction(harness.deps)
    harness.failAfter('dual_write.governance')
    expect(() => applyRekeyAction({ runId: planned.runId, planHash: planned.planHash }, harness.deps)).toThrow()
    harness.failAfter(null)
    insertLive(db, 'v1.ev-delta')
    setPreference(
      {
        governanceActorKey: 'v1.p-gov-actor',
        keyVersion: 'v1',
        lane: 'external_pseudonymous',
        value: 'deny',
        policyVersion: 1,
        source: 'settings',
        nowMs: NOW + 5,
      },
      { getDrizzleDb: () => db, dualWriteResolver: resolver },
    )
    withdrawPreference(
      {
        governanceActorKey: 'v1.p-gov-actor',
        keyVersion: 'v1',
        policyVersion: 1,
        source: 'authenticated_request',
        nowMs: NOW + 6,
      },
      { getDrizzleDb: () => db, dualWriteResolver: resolver },
    )
    const result = applyRekeyAction({ runId: planned.runId, planHash: planned.planHash }, harness.deps)
    expect(result.phase).toBe('retire')
    expect(counterValue(db, 'opportunity')).toBe(1)
    expect(counterValue(db, 'canonical')).toBe(1)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_events WHERE storage_generation = 'gen-1'`)).toBe(4)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_events WHERE storage_generation = 'gen-2'`)).toBe(4)
    expect(getPreference('v1.p-gov-actor', depsOf(db))?.externalPseudonymous).toBe('deny')
    const verified = verifyRekeyAction({ runId: planned.runId }, harness.deps)
    expect(verified.equation.ok).toBe(true)
    expect(verified.content.ok).toBe(true)
    completeSeededDeletionRequest(db)
    harness.setClock(NOW + 90 * DAY_MS)
    applyRekeyAction({ runId: planned.runId, planHash: planned.planHash }, harness.deps)
    expect(getPreference('v1.p-gov-actor', depsOf(db))).toBeNull()
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_preferences WHERE key_version = 'v2'`)).toBe(1)
  })

  const RETENTION_DELTA_EXPIRY = NOW + 7 * DAY_MS

  const mutateAllDeltaClasses = (deltaDb: Db): void => {
    const deltaEventId = insertLive(deltaDb, 'v1.ev-delta')
    setPreference(
      {
        governanceActorKey: 'v1.p-gov-actor',
        keyVersion: 'v1',
        lane: 'external_pseudonymous',
        value: 'deny',
        policyVersion: 1,
        source: 'settings',
        nowMs: NOW + 5,
      },
      { getDrizzleDb: () => deltaDb, dualWriteResolver: resolver },
    )
    withdrawPreference(
      {
        governanceActorKey: 'v1.p-gov-actor',
        keyVersion: 'v1',
        policyVersion: 1,
        source: 'authenticated_request',
        nowMs: NOW + 6,
      },
      { getDrizzleDb: () => deltaDb, dualWriteResolver: resolver },
    )
    setEligibilityState(
      { refKey: 'v1.p-colref', keyVersion: 'v1', state: 'deny', policyVersion: 1, nowMs: NOW + 7 },
      { getDrizzleDb: () => deltaDb, dualWriteResolver: resolver },
    )
    setGrantState(
      { grantKey: 'v1.p-grant', keyVersion: 'v1', state: 'deny', policyVersion: 1, nowMs: NOW + 8 },
      { getDrizzleDb: () => deltaDb, dualWriteResolver: resolver },
    )
    deltaDb.$client.run(
      `INSERT INTO analytics_goal_attempts (
         attempt_key, storage_generation, turn_key, goal, actor_key, conversation_key,
         start_ms, mature_at_ms, outcome, resolved_at_ms, anchor_event_id, outcome_version
       ) VALUES ('v1.p-goal-attempt-delta', 'gen-1', 'v1.p-turn-delta', 'task_done', 'v1.p-actor', 'v1.p-conversation',
                 ?, ?, 'immediate_success', ?, ?, 1)`,
      [NOW + 10, NOW + 5010, NOW + 510, deltaEventId],
    )
    deltaDb.$client.run(
      `INSERT INTO analytics_sessions (
         session_key, storage_generation, actor_key, conversation_key, start_ms, end_ms,
         duration_ms, activity_count, turn_count, first_event_id, last_event_id, sessionization_version
       ) VALUES ('v1.p-session-delta', 'gen-1', 'v1.p-actor', 'v1.p-conversation', ?, ?, 1000, 1, 1, ?, ?, 1)`,
      [NOW + 10, NOW + 1010, deltaEventId, deltaEventId],
    )
    deltaDb.$client.run(
      `INSERT INTO analytics_session_events (session_key, event_id, occurred_at_ms, extends_session, sessionization_version)
       VALUES ('v1.p-session-delta', ?, ?, 0, 1)`,
      [deltaEventId, NOW + 10],
    )
    deltaDb.$client.run(
      `INSERT INTO analytics_backfill_runs (run_id, source_table, high_water_row_key, policy_cutoff_ms, status, started_at_ms)
       VALUES ('bf-2', 'llm_usage_events', 'row-3', 0, 'completed', 0)`,
    )
    deltaDb.$client.run(
      `INSERT INTO analytics_backfill_event_map (run_id, event_id, source_ref_key) VALUES ('bf-2', ?, 'src-delta')`,
      [deltaEventId],
    )
    deltaDb.$client.run(
      `INSERT INTO analytics_deliveries (
         event_id, sink_version_id, grant_key, grant_key_version, grant_generation, state,
         attempts, next_attempt_at_ms, delivered_at_ms, remote_receipt_hash, payload_schema_version
       ) VALUES (?, 'sink-1', 'v1.p-grant', 'v1', 1, 'delivered', 1, 0, ?, 'rh-delta', 1)`,
      [deltaEventId, NOW + 600],
    )
    deltaDb.$client.run(
      `INSERT INTO analytics_deletion_requests (request_id, governance_actor_key, key_version, state, policy_version, requested_at_ms)
       VALUES ('del-2', 'v1.p-gov-actor', 'v1', 'requested', 1, 0)`,
    )
    deltaDb.transaction((tx) => {
      sealDeletionTargetsIn(tx, {
        requestId: 'del-2',
        encryptionKey: GOV_KEY_V1,
        nowMs: 0,
        targets: {
          analyticsActorKeys: ['v1.p-actor'],
          governanceActorKeys: ['v1.p-gov-actor'],
          collectionRefKeys: ['v1.p-colref'],
          grantKeys: ['v1.p-grant'],
        },
      })
    })
    deltaDb.$client.run(
      `INSERT INTO analytics_delivery_deletion_receipts (
         deletion_request_id, sink_version_id, state, remote_receipt_hash, requested_at_ms
       ) VALUES ('del-2', 'sink-1', 'reconciled', 'rrh-2', 0)`,
    )
    deltaDb.$client.run(`UPDATE analytics_events SET expires_at_ms = ? WHERE event_id = 'ev-1'`, [
      RETENTION_DELTA_EXPIRY,
    ])
  }

  test('post-high-water deltas across every mutation class survive interruption and stay bound by every generation deny', () => {
    const harness = createHarness(db)
    const planned = planViaAction(harness.deps)
    harness.failAfter('dual_write.governance')
    expect(() => applyRekeyAction({ runId: planned.runId, planHash: planned.planHash }, harness.deps)).toThrow()
    harness.failAfter(null)
    mutateAllDeltaClasses(db)
    harness.failAfter('copy_children.delivery_deletion')
    expect(() => applyRekeyAction({ runId: planned.runId, planHash: planned.planHash }, harness.deps)).toThrow()
    expect(runRow(db, planned.runId)?.status).toBe('paused')
    harness.failAfter(null)
    const result = applyRekeyAction({ runId: planned.runId, planHash: planned.planHash }, harness.deps)
    expect(result.phase).toBe('retire')
    expect(resolveActive(depsOf(db)).generation).toBe(TARGET_GEN)
    expect(counterValue(db, 'opportunity')).toBe(1)
    expect(counterValue(db, 'canonical')).toBe(1)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_events WHERE storage_generation = 'gen-1'`)).toBe(4)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_events WHERE storage_generation = 'gen-2'`)).toBe(4)
    expect(
      countRows(db, `SELECT COUNT(*) AS n FROM analytics_rekey_mappings WHERE domain = 'event-source-ref:v1'`),
    ).toBe(4)
    expect(getPreference('v1.p-gov-actor', depsOf(db))?.externalPseudonymous).toBe('deny')
    expect(
      countRows(
        db,
        `SELECT COUNT(*) AS n FROM analytics_preferences WHERE key_version = 'v2' AND external_pseudonymous = 'deny'`,
      ),
    ).toBe(1)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_collection_eligibility WHERE state = 'deny'`)).toBe(2)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_eligibility_grants WHERE state = 'deny'`)).toBe(2)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_goal_attempts WHERE storage_generation = 'gen-2'`)).toBe(
      2,
    )
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_sessions WHERE storage_generation = 'gen-2'`)).toBe(2)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_session_events`)).toBe(6)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_backfill_event_map`)).toBe(2)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_deliveries`)).toBe(6)
    expect(
      countRows(
        db,
        `SELECT COUNT(*) AS n FROM analytics_deliveries d
          JOIN analytics_events e ON e.event_id = d.event_id
         WHERE e.storage_generation = 'gen-2' AND d.state = 'pending' AND d.next_attempt_at_ms = ${REKEY_HELD_NEXT_ATTEMPT_MS}`,
      ),
    ).toBe(3)
    const del2 = db.$client
      .query<{ key_version: string }, []>(
        `SELECT key_version FROM analytics_deletion_requests WHERE request_id = 'del-2'`,
      )
      .get()
    expect(del2?.key_version).toBe('v2')
    const targets = db.transaction((tx) =>
      openDeletionTargetsIn(tx, { requestId: 'del-2', encryptionKeys: [GOV_KEY_V2] }),
    )
    expect(targets?.analyticsActorKeys).toHaveLength(2)
    const shadowExpiry = db.$client
      .query<{ expires_at_ms: number }, []>(
        `SELECT expires_at_ms FROM analytics_events WHERE storage_generation = 'gen-2' AND source_ref_key = 'src-1'`,
      )
      .get()
    expect(shadowExpiry?.expires_at_ms).toBe(RETENTION_DELTA_EXPIRY)
    const verified = verifyRekeyAction({ runId: planned.runId }, harness.deps)
    expect(verified.equation.ok).toBe(true)
    expect(verified.content.ok).toBe(true)
    completeSeededDeletionRequest(db)
    db.$client.run(
      `UPDATE analytics_deletion_requests SET state = 'completed', completed_at_ms = 1 WHERE request_id = 'del-2'`,
    )
    db.$client.run(
      `UPDATE analytics_deletion_target_bundles SET target_ciphertext = '', destroyed_at = 1 WHERE request_id = 'del-2'`,
    )
    harness.setClock(NOW + 90 * DAY_MS)
    const retired = applyRekeyAction({ runId: planned.runId, planHash: planned.planHash }, harness.deps)
    expect(retired.retired).toBe(true)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_events WHERE storage_generation = 'gen-1'`)).toBe(0)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_events WHERE storage_generation = 'gen-2'`)).toBe(4)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_preferences WHERE key_version = 'v1'`)).toBe(0)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_collection_eligibility WHERE key_version = 'v1'`)).toBe(0)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_eligibility_grants WHERE key_version = 'v1'`)).toBe(0)
    expect(
      countRows(
        db,
        `SELECT COUNT(*) AS n FROM analytics_collection_eligibility WHERE key_version = 'v2' AND state = 'deny'`,
      ),
    ).toBe(1)
    expect(
      countRows(
        db,
        `SELECT COUNT(*) AS n FROM analytics_eligibility_grants WHERE key_version = 'v2' AND state = 'deny'`,
      ),
    ).toBe(1)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_delivery_deletion_receipts`)).toBe(2)
  })
})
