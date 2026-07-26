// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { eq } from 'drizzle-orm'

import { openDeletionTargets } from '../../src/analytics/governance/deletion-target-store.js'
import { deleteSubjectData, resumeUnresolvedDeletions } from '../../src/analytics/governance/subject-service.js'
import type { SubjectServiceDeps } from '../../src/analytics/governance/subject-service.js'
import * as schema from '../../src/db/schema.js'
import { setupTestDb } from '../utils/test-helpers.js'
import {
  actorKeyFor,
  allDeliveries,
  allReceipts,
  allowCollectionRef,
  allowGrantFor,
  GENERATIONS,
  GKEYS,
  IDENTITY_A,
  IDENTITY_B,
  KEYRING,
  makeSubjectDeps,
  publishSnapshot,
  seedAttempt,
  seedDelivery,
  seedFeatureDays,
  seedFriction,
  seedRefAssociation,
  seedSession,
  seedSink,
  seedSubjectEvent,
  T,
} from './subject-fixtures.js'

describe('authenticated subject deletion', () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>

  const seedFullGraph = (): string => {
    const eventId = seedSubjectEvent(db, IDENTITY_A, {
      keyVersion: 'v3',
      storageGeneration: GENERATIONS.active,
      sourceRefKey: 'ref-full-del',
      eventId: 'ev-full-del',
      turnKey: 'v1.t-full-del',
    })
    seedSession(db, {
      sessionKey: 'sess-full-del',
      storageGeneration: GENERATIONS.active,
      actorKey: actorKeyFor(IDENTITY_A, 'v3'),
      eventId,
      startMs: T,
      endMs: T + 1000,
    })
    seedAttempt(db, {
      attemptKey: 'att-full-del',
      storageGeneration: GENERATIONS.active,
      actorKey: actorKeyFor(IDENTITY_A, 'v3'),
      turnKey: 'v1.t-full-del',
      eventId,
    })
    seedFriction(db, {
      turnKey: 'v1.t-full-del',
      storageGeneration: GENERATIONS.active,
      actorKey: actorKeyFor(IDENTITY_A, 'v3'),
      eventId,
    })
    seedFeatureDays(db, { actorKey: actorKeyFor(IDENTITY_A, 'v3'), storageGeneration: GENERATIONS.active, eventId })
    return eventId
  }

  beforeEach(async () => {
    db = await setupTestDb()
  })

  const requireFirstRequestId = (): string => {
    const requests = db.select().from(schema.analyticsDeletionRequests).all()
    if (requests.length !== 1 || requests[0] === undefined) throw new Error('expected exactly one deletion request')
    return requests[0].requestId
  }

  test('deletes events, sessions, attempts, friction, feature days, refs, and deliveries across every key version and generation', () => {
    const eventId = seedFullGraph()
    const ref = allowCollectionRef(db, IDENTITY_A, 'v3')
    seedRefAssociation(db, { eventId, refKey: ref.refKey, keyVersion: ref.keyVersion, generation: ref.generation })
    seedSubjectEvent(db, IDENTITY_A, {
      keyVersion: 'v1',
      storageGeneration: GENERATIONS.retired,
      sourceRefKey: 'ref-del-old',
      eventId: 'ev-del-old',
    })
    seedSubjectEvent(db, IDENTITY_A, {
      keyVersion: 'v2',
      storageGeneration: GENERATIONS.shadow,
      sourceRefKey: 'ref-del-mid',
      eventId: 'ev-del-mid',
    })
    seedSink(db, 'sv-del-1')
    const grant = allowGrantFor(db, IDENTITY_A, 'v3')
    seedDelivery(db, { eventId, sinkVersionId: 'sv-del-1', state: 'pending', grant })
    seedSubjectEvent(db, IDENTITY_B, {
      keyVersion: 'v3',
      storageGeneration: GENERATIONS.active,
      sourceRefKey: 'ref-del-keep',
      eventId: 'ev-del-keep',
    })

    const result = deleteSubjectData(IDENTITY_A, makeSubjectDeps(db), T + 10)

    expect(result.state).toBe('completed')
    expect(
      db
        .select()
        .from(schema.analyticsEvents)
        .all()
        .map((row) => row.eventId),
    ).toEqual(['ev-del-keep'])
    expect(db.select().from(schema.analyticsSessions).all()).toHaveLength(0)
    expect(db.select().from(schema.analyticsGoalAttempts).all()).toHaveLength(0)
    expect(db.select().from(schema.analyticsTurnFriction).all()).toHaveLength(0)
    expect(db.select().from(schema.analyticsFeatureOpportunityDays).all()).toHaveLength(0)
    expect(db.select().from(schema.analyticsFeatureUseDays).all()).toHaveLength(0)
    expect(db.select().from(schema.analyticsEventCollectionRefs).all()).toHaveLength(0)
    expect(allDeliveries(db)).toHaveLength(0)
  })

  test('sending rows are never silently deleted: they are settled via remote deletion with an independent minimal receipt', () => {
    const eventId = seedFullGraph()
    seedSink(db, 'sv-del-sending')
    const grant = allowGrantFor(db, IDENTITY_A, 'v3')
    seedDelivery(db, { eventId, sinkVersionId: 'sv-del-sending', state: 'sending', grant, sendStartedAtMs: T })
    const remoteCalls: string[] = []

    const result = deleteSubjectData(
      IDENTITY_A,
      {
        ...makeSubjectDeps(db),
        requestRemoteDeletion: (sinkVersionId) => {
          remoteCalls.push(sinkVersionId)
          return { remoteReceiptHash: 'remote-sending' }
        },
      },
      T + 10,
    )

    expect(result.state).toBe('completed')
    expect(remoteCalls).toEqual(['sv-del-sending'])
    const receipts = allReceipts(db)
    expect(receipts).toHaveLength(1)
    expect(receipts[0]?.state).toBe('reconciled')
    const serialized = JSON.stringify(receipts)
    expect(serialized).not.toContain(eventId)
    expect(serialized).not.toContain(actorKeyFor(IDENTITY_A, 'v3'))
    expect(serialized).not.toContain(grant.grantKey)
  })

  test('restricted event FKs reject deleting events before delivery rows; the workflow order succeeds', () => {
    const eventId = seedFullGraph()
    seedSink(db, 'sv-del-fk')
    const grant = allowGrantFor(db, IDENTITY_A, 'v3')
    seedDelivery(db, { eventId, sinkVersionId: 'sv-del-fk', state: 'pending', grant })

    expect(() => db.delete(schema.analyticsEvents).where(eq(schema.analyticsEvents.eventId, eventId)).run()).toThrow()

    const result = deleteSubjectData(IDENTITY_A, makeSubjectDeps(db), T + 10)
    expect(result.state).toBe('completed')
    expect(allDeliveries(db)).toHaveLength(0)
  })

  test('a published snapshot containing the contribution is unpublished before completion', () => {
    seedFullGraph()
    publishSnapshot(db, 'snap-del', GENERATIONS.active)

    const result = deleteSubjectData(IDENTITY_A, makeSubjectDeps(db), T + 10)

    expect(result.state).toBe('completed')
    const publication = db
      .select()
      .from(schema.analyticsSnapshotPublications)
      .where(eq(schema.analyticsSnapshotPublications.snapshotId, 'snap-del'))
      .get()
    expect(publication?.state).toBe('invalidated')
  })

  test('right-censor withdrawal intervals are written for every retained actor key version', () => {
    seedFullGraph()

    deleteSubjectData(IDENTITY_A, makeSubjectDeps(db), T + 10)

    const intervals = db.select().from(schema.analyticsCensorIntervals).all()
    expect(intervals.map((row) => row.actorKey).sort()).toEqual(
      [actorKeyFor(IDENTITY_A, 'v1'), actorKeyFor(IDENTITY_A, 'v2'), actorKeyFor(IDENTITY_A, 'v3')].sort(),
    )
    for (const row of intervals) {
      expect(row.kind).toBe('withdrawal')
      expect(row.startMs).toBe(T + 10)
    }
  })

  test('the sealed target bundle is destroyed after completion; only the minimal audit result remains', () => {
    seedFullGraph()

    deleteSubjectData(IDENTITY_A, makeSubjectDeps(db), T + 10)

    const bundle = db.select().from(schema.analyticsDeletionTargetBundles).all()
    expect(bundle).toHaveLength(1)
    expect(bundle[0]?.targetCiphertext).toBe('')
    expect(bundle[0]?.destroyedAt).toBe(T + 10)
    expect(bundle[0]?.targetHash.length).toBe(64)
    const requests = db.select().from(schema.analyticsDeletionRequests).all()
    expect(requests[0]?.state).toBe('completed')
    const audit = db.select().from(schema.analyticsPolicyAudit).all()
    expect(audit.some((row) => row.action === 'delete_requested')).toBe(true)
    expect(audit.some((row) => row.action === 'delete_completed')).toBe(true)
  })

  test('restart/resume: a failed request resumes from the sealed bundle without the native identity', () => {
    const eventId = seedFullGraph()
    seedSink(db, 'sv-del-resume')
    seedDelivery(db, {
      eventId,
      sinkVersionId: 'sv-del-resume',
      state: 'delivered',
      deliveredAtMs: T,
      remoteReceiptHash: 'rh-resume',
    })
    const refuse = (): null => null
    const confirm = (): { remoteReceiptHash: string } => ({ remoteReceiptHash: 'remote-resume' })
    let remoteBehavior: typeof refuse | typeof confirm = refuse
    const deps = {
      ...makeSubjectDeps(db),
      requestRemoteDeletion: (): { remoteReceiptHash: string } | null => remoteBehavior(),
    }

    expect(() => deleteSubjectData(IDENTITY_A, deps, T + 10)).toThrow()
    expect(db.select().from(schema.analyticsEvents).all().length).toBeGreaterThan(0)

    const targets = openDeletionTargets(
      { requestId: requireFirstRequestId(), encryptionKeys: [KEYRING.governance.activeKey] },
      { getDrizzleDb: (): typeof db => db },
    )
    expect(targets).not.toBeNull()
    expect(targets?.analyticsActorKeys).toContain(actorKeyFor(IDENTITY_A, 'v3'))

    remoteBehavior = confirm
    const outcomes = resumeUnresolvedDeletions(deps, T + 20)
    expect(outcomes).toEqual(['completed'])
    expect(db.select().from(schema.analyticsEvents).all()).toHaveLength(0)
    expect(allReceipts(db)).toHaveLength(1)
    const bundle = db.select().from(schema.analyticsDeletionTargetBundles).all()[0]
    expect(bundle?.targetCiphertext).toBe('')
  })

  test('resume survives a governance rekey: a bundle sealed under the old key opens with the rotated keyring', () => {
    const eventId = seedFullGraph()
    seedSink(db, 'sv-del-rekey')
    seedDelivery(db, {
      eventId,
      sinkVersionId: 'sv-del-rekey',
      state: 'delivered',
      deliveredAtMs: T,
      remoteReceiptHash: 'rh-rekey',
    })
    const preRekeyKeyrings = {
      analytics: KEYRING.analytics,
      governance: {
        kind: 'available',
        activeVersion: 'v1',
        activeKey: GKEYS.v1,
        keys: new Map([['v1', GKEYS.v1]]),
      },
    } as const
    const refuse = (): null => null
    const confirm = (): { remoteReceiptHash: string } => ({ remoteReceiptHash: 'remote-rekey' })
    let remoteBehavior: typeof refuse | typeof confirm = refuse
    const depsWith = (keyrings: SubjectServiceDeps['keyrings']): SubjectServiceDeps => ({
      ...makeSubjectDeps(db),
      keyrings,
      requestRemoteDeletion: (): { remoteReceiptHash: string } | null => remoteBehavior(),
    })

    expect(() => deleteSubjectData(IDENTITY_A, depsWith(preRekeyKeyrings), T + 10)).toThrow()
    expect(db.select().from(schema.analyticsDeletionRequests).all()[0]?.state).toBe('failed')

    const rotatedKeyrings = {
      analytics: KEYRING.analytics,
      governance: {
        kind: 'available',
        activeVersion: 'v3',
        activeKey: GKEYS.v3,
        keys: new Map([
          ['v1', GKEYS.v1],
          ['v2', GKEYS.v2],
          ['v3', GKEYS.v3],
        ]),
      },
    } as const
    remoteBehavior = confirm
    const outcomes = resumeUnresolvedDeletions(depsWith(rotatedKeyrings), T + 20)

    expect(outcomes).toEqual(['completed'])
    expect(db.select().from(schema.analyticsEvents).all()).toHaveLength(0)
    expect(allReceipts(db)).toHaveLength(1)
    expect(db.select().from(schema.analyticsDeletionTargetBundles).all()[0]?.targetCiphertext).toBe('')
  })

  test('another member is completely untouched by deletion', () => {
    seedFullGraph()
    const keepId = seedSubjectEvent(db, IDENTITY_B, {
      keyVersion: 'v3',
      storageGeneration: GENERATIONS.active,
      sourceRefKey: 'ref-del-b',
      eventId: 'ev-del-b',
      turnKey: 'v1.t-del-b',
    })
    seedSession(db, {
      sessionKey: 'sess-del-b',
      storageGeneration: GENERATIONS.active,
      actorKey: actorKeyFor(IDENTITY_B, 'v3'),
      eventId: keepId,
      startMs: T,
      endMs: T + 1000,
    })

    deleteSubjectData(IDENTITY_A, makeSubjectDeps(db), T + 10)

    expect(
      db
        .select()
        .from(schema.analyticsEvents)
        .all()
        .map((row) => row.eventId),
    ).toEqual(['ev-del-b'])
    expect(
      db
        .select()
        .from(schema.analyticsSessions)
        .all()
        .map((row) => row.sessionKey),
    ).toEqual(['sess-del-b'])
  })
})
