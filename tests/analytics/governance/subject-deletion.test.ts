// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { eq } from 'drizzle-orm'

import {
  createDeletionRequestIn,
  sealDeletionTargetsIn,
} from '../../../src/analytics/governance/deletion-target-store.js'
import { DeletionIncompleteError, executeDeletionWorkflow } from '../../../src/analytics/governance/subject-deletion.js'
import { deriveSubjectKeys, toDeletionTargetSet } from '../../../src/analytics/governance/subject-keys.js'
import * as schema from '../../../src/db/schema.js'
import { setupTestDb } from '../../utils/test-helpers.js'
import {
  actorKeyFor,
  allDeliveries,
  allEvents,
  allReceipts,
  allowGrantFor,
  GENERATIONS,
  IDENTITY_A,
  IDENTITY_B,
  KEYRING,
  makeSubjectDeps,
  publishSnapshot,
  seedAttempt,
  seedDelivery,
  seedFeatureDays,
  seedFriction,
  seedSession,
  seedSink,
  seedSubjectEvent,
  T,
} from '../subject-fixtures.js'

describe('executeDeletionWorkflow', () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>

  const seedRequest = (requestId: string): void => {
    const targets = toDeletionTargetSet(deriveSubjectKeys(IDENTITY_A, KEYRING))
    db.transaction((tx) => {
      createDeletionRequestIn(tx, {
        requestId,
        governanceActorKey: 'v1.g-subject',
        keyVersion: 'v3',
        policyVersion: 3,
        nowMs: T,
      })
      sealDeletionTargetsIn(tx, { requestId, targets, encryptionKey: KEYRING.governance.activeKey, nowMs: T })
    })
  }

  const subjectEventIds = (dbParam: Awaited<ReturnType<typeof setupTestDb>>): readonly string[] =>
    allEvents(dbParam)
      .filter((row) => row.actorKey === actorKeyFor(IDENTITY_A, 'v3'))
      .map((row) => row.eventId)

  beforeEach(async () => {
    db = await setupTestDb()
  })

  test('removes the subject event graph across generations and leaves other actors untouched', () => {
    seedRequest('req-local')
    const eventId = seedSubjectEvent(db, IDENTITY_A, {
      keyVersion: 'v3',
      storageGeneration: GENERATIONS.active,
      sourceRefKey: 'ref-del',
      eventId: 'ev-del',
      turnKey: 'v1.t-del',
    })
    seedSubjectEvent(db, IDENTITY_A, {
      keyVersion: 'v1',
      storageGeneration: GENERATIONS.retired,
      sourceRefKey: 'ref-del-old',
      eventId: 'ev-del-old',
    })
    seedSubjectEvent(db, IDENTITY_B, {
      keyVersion: 'v3',
      storageGeneration: GENERATIONS.active,
      sourceRefKey: 'ref-keep',
      eventId: 'ev-keep',
    })
    seedSession(db, {
      sessionKey: 'sess-del',
      storageGeneration: GENERATIONS.active,
      actorKey: actorKeyFor(IDENTITY_A, 'v3'),
      eventId,
      startMs: T,
      endMs: T + 1000,
    })
    seedAttempt(db, {
      attemptKey: 'att-del',
      storageGeneration: GENERATIONS.active,
      actorKey: actorKeyFor(IDENTITY_A, 'v3'),
      turnKey: 'v1.t-del',
      eventId,
    })
    seedFriction(db, {
      turnKey: 'v1.t-del',
      storageGeneration: GENERATIONS.active,
      actorKey: actorKeyFor(IDENTITY_A, 'v3'),
      eventId,
    })
    seedFeatureDays(db, { actorKey: actorKeyFor(IDENTITY_A, 'v3'), storageGeneration: GENERATIONS.active, eventId })

    const result = executeDeletionWorkflow({ requestId: 'req-local', nowMs: T + 10 }, makeSubjectDeps(db))

    expect(result.state).toBe('completed')
    expect(subjectEventIds(db)).toEqual([])
    expect(allEvents(db).map((row) => row.eventId)).toEqual(['ev-keep'])
    expect(db.select().from(schema.analyticsSessions).all()).toHaveLength(0)
    expect(db.select().from(schema.analyticsGoalAttempts).all()).toHaveLength(0)
    expect(db.select().from(schema.analyticsTurnFriction).all()).toHaveLength(0)
    expect(db.select().from(schema.analyticsFeatureOpportunityDays).all()).toHaveLength(0)
    expect(db.select().from(schema.analyticsFeatureUseDays).all()).toHaveLength(0)
  })

  test('settles delivery rows in order and writes minimal independent receipts without event or actor keys', () => {
    seedRequest('req-settle')
    const eventId = seedSubjectEvent(db, IDENTITY_A, {
      keyVersion: 'v3',
      storageGeneration: GENERATIONS.active,
      sourceRefKey: 'ref-settle',
      eventId: 'ev-settle',
    })
    seedSink(db, 'sv-pending')
    seedSink(db, 'sv-sending')
    seedSink(db, 'sv-delivered')
    const grant = allowGrantFor(db, IDENTITY_A, 'v3')
    seedDelivery(db, { eventId, sinkVersionId: 'sv-pending', state: 'pending', grant })
    seedDelivery(db, { eventId, sinkVersionId: 'sv-sending', state: 'sending', grant, sendStartedAtMs: T })
    seedDelivery(db, {
      eventId,
      sinkVersionId: 'sv-delivered',
      state: 'delivered',
      grant,
      deliveredAtMs: T,
      remoteReceiptHash: 'rh-1',
    })
    const remoteCalls: string[] = []

    const result = executeDeletionWorkflow(
      { requestId: 'req-settle', nowMs: T + 10 },
      {
        ...makeSubjectDeps(db),
        requestRemoteDeletion: (sinkVersionId) => {
          remoteCalls.push(sinkVersionId)
          return { remoteReceiptHash: `remote-${sinkVersionId}` }
        },
      },
    )

    expect(result.state).toBe('completed')
    expect(remoteCalls.sort()).toEqual(['sv-delivered', 'sv-sending'])
    expect(allDeliveries(db)).toHaveLength(0)
    const receipts = allReceipts(db)
    expect(receipts).toHaveLength(2)
    for (const receipt of receipts) {
      expect(receipt.deletionRequestId).toBe('req-settle')
      expect(receipt.state).toBe('reconciled')
      expect(receipt.remoteReceiptHash).toBe(`remote-${receipt.sinkVersionId}`)
    }
    expect(JSON.stringify(receipts)).not.toContain('ev-settle')
    expect(JSON.stringify(receipts)).not.toContain(actorKeyFor(IDENTITY_A, 'v3'))
  })

  test('records a withdrawal censor interval per retained actor key', () => {
    seedRequest('req-censor')
    seedSubjectEvent(db, IDENTITY_A, {
      keyVersion: 'v3',
      storageGeneration: GENERATIONS.active,
      sourceRefKey: 'ref-censor',
      eventId: 'ev-censor',
    })

    executeDeletionWorkflow({ requestId: 'req-censor', nowMs: T + 10 }, makeSubjectDeps(db))

    const intervals = db.select().from(schema.analyticsCensorIntervals).all()
    expect(intervals.map((row) => row.kind)).toEqual(['withdrawal', 'withdrawal', 'withdrawal'])
    expect(intervals.map((row) => row.actorKey).sort()).toEqual(
      [actorKeyFor(IDENTITY_A, 'v1'), actorKeyFor(IDENTITY_A, 'v2'), actorKeyFor(IDENTITY_A, 'v3')].sort(),
    )
    for (const row of intervals) expect(row.startMs).toBe(T + 10)
  })

  test('unpublishes snapshots containing the contribution and refuses completion while one remains', () => {
    seedRequest('req-snapshot')
    seedSubjectEvent(db, IDENTITY_A, {
      keyVersion: 'v3',
      storageGeneration: GENERATIONS.active,
      sourceRefKey: 'ref-snap',
      eventId: 'ev-snap',
    })
    publishSnapshot(db, 'snap-1', GENERATIONS.active)

    const holding: ReturnType<typeof makeSubjectDeps> = {
      ...makeSubjectDeps(db),
      snapshotInvalidator: () => ({ unpublishedSnapshotIds: [], publishedSnapshotContainsContribution: true }),
    }
    expect(() => executeDeletionWorkflow({ requestId: 'req-snapshot', nowMs: T + 10 }, holding)).toThrow(
      DeletionIncompleteError,
    )

    const ok = executeDeletionWorkflow({ requestId: 'req-snapshot', nowMs: T + 20 }, makeSubjectDeps(db))
    expect(ok.state).toBe('completed')
    const publication = db
      .select()
      .from(schema.analyticsSnapshotPublications)
      .where(eq(schema.analyticsSnapshotPublications.snapshotId, 'snap-1'))
      .get()
    expect(publication?.state).toBe('invalidated')
  })

  test('destroys the target ciphertext on completion and retains only the minimal audit result', () => {
    seedRequest('req-destroy')
    seedSubjectEvent(db, IDENTITY_A, {
      keyVersion: 'v3',
      storageGeneration: GENERATIONS.active,
      sourceRefKey: 'ref-destroy',
      eventId: 'ev-destroy',
    })

    executeDeletionWorkflow({ requestId: 'req-destroy', nowMs: T + 10 }, makeSubjectDeps(db))

    const bundle = db
      .select()
      .from(schema.analyticsDeletionTargetBundles)
      .where(eq(schema.analyticsDeletionTargetBundles.requestId, 'req-destroy'))
      .get()
    expect(bundle?.targetCiphertext).toBe('')
    expect(bundle?.destroyedAt).toBe(T + 10)
    expect(bundle?.targetHash.length).toBeGreaterThan(0)
    const request = db
      .select()
      .from(schema.analyticsDeletionRequests)
      .where(eq(schema.analyticsDeletionRequests.requestId, 'req-destroy'))
      .get()
    expect(request?.state).toBe('completed')
    expect(request?.completedAtMs).toBe(T + 10)
  })

  test('fails the request when remote deletion is refused and keeps the ciphertext for resume', () => {
    seedRequest('req-remote-fail')
    const eventId = seedSubjectEvent(db, IDENTITY_A, {
      keyVersion: 'v3',
      storageGeneration: GENERATIONS.active,
      sourceRefKey: 'ref-rfail',
      eventId: 'ev-rfail',
    })
    seedSink(db, 'sv-remote')
    seedDelivery(db, {
      eventId,
      sinkVersionId: 'sv-remote',
      state: 'delivered',
      deliveredAtMs: T,
      remoteReceiptHash: 'rh-x',
    })

    expect(() =>
      executeDeletionWorkflow(
        { requestId: 'req-remote-fail', nowMs: T + 10 },
        { ...makeSubjectDeps(db), requestRemoteDeletion: () => null },
      ),
    ).toThrow(DeletionIncompleteError)

    const request = db
      .select()
      .from(schema.analyticsDeletionRequests)
      .where(eq(schema.analyticsDeletionRequests.requestId, 'req-remote-fail'))
      .get()
    expect(request?.state).toBe('failed')
    const bundle = db
      .select()
      .from(schema.analyticsDeletionTargetBundles)
      .where(eq(schema.analyticsDeletionTargetBundles.requestId, 'req-remote-fail'))
      .get()
    expect(bundle?.targetCiphertext.length).toBeGreaterThan(0)
    expect(bundle?.destroyedAt).toBeNull()
  })
})
