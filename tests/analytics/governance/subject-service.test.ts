// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { eq } from 'drizzle-orm'

import {
  deleteSubjectData,
  exportSubjectData,
  resumeUnresolvedDeletions,
  withdrawSubject,
} from '../../../src/analytics/governance/subject-service.js'
import * as schema from '../../../src/db/schema.js'
import { setupTestDb } from '../../utils/test-helpers.js'
import {
  actorKeyFor,
  allDeliveries,
  allowCollectionRef,
  allowGrantFor,
  GENERATIONS,
  govActorKeyFor,
  grantKeyFor,
  IDENTITY_A,
  IDENTITY_B,
  makeSubjectDeps,
  refKeyFor,
  seedDelivery,
  seedRefAssociation,
  seedSink,
  seedSubjectEvent,
  T,
} from '../subject-fixtures.js'

describe('subject-service', () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>

  beforeEach(async () => {
    db = await setupTestDb()
  })

  test('exportSubjectData derives keys from the authenticated identity and delegates to the export builder', () => {
    seedSubjectEvent(db, IDENTITY_A, {
      keyVersion: 'v3',
      storageGeneration: GENERATIONS.active,
      sourceRefKey: 'ref-svc-export',
      eventId: 'ev-svc-export',
    })
    seedSubjectEvent(db, IDENTITY_B, {
      keyVersion: 'v3',
      storageGeneration: GENERATIONS.active,
      sourceRefKey: 'ref-svc-other',
      eventId: 'ev-svc-other',
    })

    const result = exportSubjectData(IDENTITY_A, makeSubjectDeps(db), T + 1000)
    expect(result.productAnalytics.events).toHaveLength(1)
    expect(JSON.stringify(result)).not.toContain('ev-svc-other')
  })

  test('withdrawSubject denies, revokes, cancels, seals, deletes, and fires the withdrawal hook in one workflow', () => {
    const ref = allowCollectionRef(db, IDENTITY_A, 'v3')
    const grant = allowGrantFor(db, IDENTITY_A, 'v3')
    const eventId = seedSubjectEvent(db, IDENTITY_A, {
      keyVersion: 'v3',
      storageGeneration: GENERATIONS.active,
      sourceRefKey: 'ref-svc-wd',
      eventId: 'ev-svc-wd',
    })
    seedRefAssociation(db, { eventId, refKey: ref.refKey, keyVersion: ref.keyVersion, generation: ref.generation })
    seedSink(db, 'sv-wd')
    seedDelivery(db, { eventId, sinkVersionId: 'sv-wd', state: 'pending', grant })
    const withdrawn: string[] = []

    const result = withdrawSubject(
      IDENTITY_A,
      {
        ...makeSubjectDeps(db),
        onSubjectWithdraw: (identity) => {
          withdrawn.push(identity.platformUserId)
        },
      },
      T + 10,
    )

    expect(result.state).toBe('completed')
    expect(withdrawn).toEqual(['user-a'])

    const preference = db
      .select()
      .from(schema.analyticsPreferences)
      .where(eq(schema.analyticsPreferences.governanceActorKey, govActorKeyFor(IDENTITY_A, 'v3')))
      .get()
    expect(preference?.localLongitudinal).toBe('deny')
    expect(preference?.externalPseudonymous).toBe('deny')

    const refRow = db
      .select()
      .from(schema.analyticsCollectionEligibility)
      .where(eq(schema.analyticsCollectionEligibility.refKey, refKeyFor(IDENTITY_A, 'v3')))
      .get()
    expect(refRow?.state).toBe('deny')
    const grantRow = db
      .select()
      .from(schema.analyticsEligibilityGrants)
      .where(eq(schema.analyticsEligibilityGrants.grantKey, grantKeyFor(IDENTITY_A, 'v3')))
      .get()
    expect(grantRow?.state).toBe('deny')

    expect(allDeliveries(db)).toHaveLength(0)
    expect(db.select().from(schema.analyticsEvents).all()).toHaveLength(0)
    expect(db.select().from(schema.analyticsEventCollectionRefs).all()).toHaveLength(0)

    const audit = db.select().from(schema.analyticsPolicyAudit).all()
    expect(audit.some((row) => row.action === 'withdraw')).toBe(true)
    expect(audit.some((row) => row.action === 'delete_requested')).toBe(true)
    expect(audit.some((row) => row.action === 'delete_completed')).toBe(true)

    const intervals = db.select().from(schema.analyticsCensorIntervals).all()
    expect(intervals.map((row) => row.kind)).toEqual(['withdrawal', 'withdrawal', 'withdrawal'])
  })

  test('deleteSubjectData seals targets, runs the workflow, and destroys the ciphertext', () => {
    seedSubjectEvent(db, IDENTITY_A, {
      keyVersion: 'v3',
      storageGeneration: GENERATIONS.active,
      sourceRefKey: 'ref-svc-del',
      eventId: 'ev-svc-del',
    })

    const result = deleteSubjectData(IDENTITY_A, makeSubjectDeps(db), T + 10)
    expect(result.state).toBe('completed')

    const requests = db.select().from(schema.analyticsDeletionRequests).all()
    expect(requests).toHaveLength(1)
    expect(requests[0]?.state).toBe('completed')
    const bundle = db.select().from(schema.analyticsDeletionTargetBundles).all()
    expect(bundle[0]?.targetCiphertext).toBe('')
  })

  test('resumeUnresolvedDeletions completes a previously failed request without the native identity', () => {
    seedSubjectEvent(db, IDENTITY_A, {
      keyVersion: 'v3',
      storageGeneration: GENERATIONS.active,
      sourceRefKey: 'ref-svc-resume',
      eventId: 'ev-svc-resume',
    })
    seedSink(db, 'sv-resume')
    seedDelivery(db, {
      eventId: 'ev-svc-resume',
      sinkVersionId: 'sv-resume',
      state: 'delivered',
      deliveredAtMs: T,
      remoteReceiptHash: 'rh-r',
    })

    const refuse = (): null => null
    const confirm = (): { remoteReceiptHash: string } => ({ remoteReceiptHash: 'remote-ok' })
    let remoteBehavior: typeof refuse | typeof confirm = refuse
    const deps = {
      ...makeSubjectDeps(db),
      requestRemoteDeletion: (): { remoteReceiptHash: string } | null => remoteBehavior(),
    }
    expect(() => deleteSubjectData(IDENTITY_A, deps, T + 10)).toThrow()
    expect(db.select().from(schema.analyticsEvents).all()).toHaveLength(1)

    remoteBehavior = confirm
    const resumed = resumeUnresolvedDeletions(deps, T + 20)
    expect(resumed).toEqual(['completed'])
    expect(db.select().from(schema.analyticsEvents).all()).toHaveLength(0)
  })

  test('actor keys for another member are never touched by withdrawal', () => {
    allowCollectionRef(db, IDENTITY_B, 'v3')
    seedSubjectEvent(db, IDENTITY_B, {
      keyVersion: 'v3',
      storageGeneration: GENERATIONS.active,
      sourceRefKey: 'ref-svc-b',
      eventId: 'ev-svc-b',
    })

    withdrawSubject(IDENTITY_A, makeSubjectDeps(db), T + 10)

    expect(
      db
        .select()
        .from(schema.analyticsEvents)
        .all()
        .map((row) => row.eventId),
    ).toEqual(['ev-svc-b'])
    const refRow = db.select().from(schema.analyticsCollectionEligibility).all()
    expect(refRow[0]?.state).toBe('allow')
    const remaining = db.select().from(schema.analyticsEvents).all()
    expect(remaining.map((row) => row.actorKey)).toEqual([actorKeyFor(IDENTITY_B, 'v3')])
  })
})
