// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { eq } from 'drizzle-orm'

import type { AnalyticsEventV1 } from '../../src/analytics/contracts.js'
import { KeyVersionSchema, VersionStringSchema } from '../../src/analytics/controlled-types.js'
import {
  deleteCanonicalEventsForRef,
  insertEligibleCanonicalEvent,
} from '../../src/analytics/governance/collection-serialization.js'
import { deriveCollectionRefKey, setEligibilityState } from '../../src/analytics/governance/collection-store.js'
import type { CollectionEligibilityRef } from '../../src/analytics/governance/eligibility.js'
import { normalize } from '../../src/analytics/normalizer.js'
import type { NormalizationResult, NormalizerEnv } from '../../src/analytics/normalizer.js'
import type { AnalyticsSourceContext } from '../../src/analytics/source-facts.js'
import { openEpoch } from '../../src/analytics/storage/epoch-store.js'
import { toScopedContextId } from '../../src/chat/scoped-context.js'
import * as schema from '../../src/db/schema.js'
import { setupTestDb } from '../utils/test-helpers.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

const KEY = Buffer.alloc(32, 7)
const EPOCH_ID = 'epoch-race-1'
const NOW = 1_700_000_000_000

const env: NormalizerEnv = {
  hmacKey: KEY,
  keyVersion: KeyVersionSchema.parse('v1'),
  installId: 'install-uuid-1',
  appVersion: VersionStringSchema.parse('6.10.0'),
  policyVersion: 3,
  ingestedAtMs: NOW + 500,
}

const memberSource: AnalyticsSourceContext = {
  platform: 'telegram',
  platformInstanceId: 'pi-1',
  chatUserId: 'user-42',
  nativeContextId: 'user-42',
  storageContextId: toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'user-42' }),
  configContextId: toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'user-42' }),
  contextType: 'dm',
  actorRole: 'member',
  taskInstanceId: null,
  taskProvider: 'none',
  invocationMode: 'normal',
  rawTurnId: 'turn-raw-1',
}

const unwrap = (result: NormalizationResult): AnalyticsEventV1 => {
  if (result.status !== 'ok') throw new Error(`expected ok, got rejection: ${result.reason}`)
  return result.event
}

const buildEvent = (sourceEventId: string): AnalyticsEventV1 =>
  unwrap(
    normalize(
      {
        version: 1,
        type: 'chat_message_accepted',
        sourceEventId,
        occurredAtMs: NOW,
        source: memberSource,
        inputCount: 1,
        inputLengthChars: 200,
        attachmentCount: 0,
        isCommand: false,
        command: 'none',
      },
      env,
    ),
  )

const refFor = (keyVersion: string): string =>
  deriveCollectionRefKey({ key: KEY, keyVersion, platformInstanceId: 'pi-1', platformUserId: 'user-42' })

const allowRef = (db: Db, keyVersion: string): CollectionEligibilityRef => {
  const refKey = refFor(keyVersion)
  const { generation } = setEligibilityState(
    { refKey, keyVersion, state: 'allow', policyVersion: 3, nowMs: NOW },
    { getDrizzleDb: () => db },
  )
  return { refKey, keyVersion, generation }
}

const eventRows = (db: Db): readonly { eventId: string }[] =>
  db.select({ eventId: schema.analyticsEvents.eventId }).from(schema.analyticsEvents).all()

const associationRows = (db: Db): readonly { eventId: string; refKey: string }[] =>
  db
    .select({
      eventId: schema.analyticsEventCollectionRefs.eventId,
      refKey: schema.analyticsEventCollectionRefs.refKey,
    })
    .from(schema.analyticsEventCollectionRefs)
    .all()

const counterValue = (db: Db, disposition: string): number => {
  const rows = db
    .select({ value: schema.analyticsEpochSourceCounters.value })
    .from(schema.analyticsEpochSourceCounters)
    .where(eq(schema.analyticsEpochSourceCounters.disposition, disposition))
    .all()
  return rows.reduce((sum, row) => sum + row.value, 0)
}

const rawEventRowJson = (db: Db): string => {
  const row = db.select().from(schema.analyticsEvents).get()
  return JSON.stringify(row ?? null)
}

const expectInsertedEventId = (result: ReturnType<typeof insertEligibleCanonicalEvent>): string => {
  if (result.status !== 'inserted') throw new Error(`expected inserted, got ${result.status}`)
  return result.eventId
}

describe('collection writer race fence', () => {
  let db: Db

  beforeEach(async () => {
    db = await setupTestDb()
    openEpoch({ epochId: EPOCH_ID, startedAtMs: NOW }, { getDrizzleDb: () => db })
  })

  test('allowed ref: one transaction inserts event, association, and epoch opportunity/canonical counters', () => {
    const ref = allowRef(db, 'v1')
    const result = insertEligibleCanonicalEvent(
      { event: buildEvent('se-1'), processEpochId: EPOCH_ID, collectionRef: ref },
      { getDrizzleDb: () => db },
    )
    expect(result.status).toBe('inserted')
    expect(eventRows(db)).toHaveLength(1)
    const associations = associationRows(db)
    expect(associations).toHaveLength(1)
    expect(associations[0]?.refKey).toBe(ref.refKey)
    expect(counterValue(db, 'opportunity')).toBe(1)
    expect(counterValue(db, 'canonical')).toBe(1)
  })

  test('canonical payload and stored row never contain the collection ref', () => {
    const ref = allowRef(db, 'v1')
    const event = buildEvent('se-2')
    insertEligibleCanonicalEvent({ event, processEpochId: EPOCH_ID, collectionRef: ref }, { getDrizzleDb: () => db })
    expect(JSON.stringify(event)).not.toContain(ref.refKey)
    expect(rawEventRowJson(db)).not.toContain(ref.refKey)
  })

  test('deny committed before the writer produces no canonical, association, or counter rows', () => {
    const ref = allowRef(db, 'v1')
    setEligibilityState(
      { refKey: ref.refKey, keyVersion: ref.keyVersion, state: 'deny', policyVersion: 3, nowMs: NOW + 10 },
      { getDrizzleDb: () => db },
    )
    const result = insertEligibleCanonicalEvent(
      { event: buildEvent('se-3'), processEpochId: EPOCH_ID, collectionRef: ref },
      { getDrizzleDb: () => db },
    )
    expect(result.status).toBe('not_eligible')
    expect(eventRows(db)).toHaveLength(0)
    expect(associationRows(db)).toHaveLength(0)
    expect(counterValue(db, 'canonical')).toBe(0)
    expect(counterValue(db, 'governance_ineligible')).toBe(1)
  })

  test('writer committed before deny is found through the association and deleted', () => {
    const ref = allowRef(db, 'v1')
    const inserted = insertEligibleCanonicalEvent(
      { event: buildEvent('se-4'), processEpochId: EPOCH_ID, collectionRef: ref },
      { getDrizzleDb: () => db },
    )
    const insertedEventId = expectInsertedEventId(inserted)
    setEligibilityState(
      { refKey: ref.refKey, keyVersion: ref.keyVersion, state: 'deny', policyVersion: 3, nowMs: NOW + 10 },
      { getDrizzleDb: () => db },
    )
    const deleted = deleteCanonicalEventsForRef({ refKey: ref.refKey }, { getDrizzleDb: () => db })
    expect(deleted.deletedEventIds).toEqual([insertedEventId])
    expect(eventRows(db)).toHaveLength(0)
    expect(associationRows(db)).toHaveLength(0)
  })

  test('the same fences hold across retained key versions', () => {
    const ref = allowRef(db, 'v2')
    setEligibilityState(
      { refKey: ref.refKey, keyVersion: ref.keyVersion, state: 'deny', policyVersion: 3, nowMs: NOW + 10 },
      { getDrizzleDb: () => db },
    )
    const denied = insertEligibleCanonicalEvent(
      { event: buildEvent('se-5'), processEpochId: EPOCH_ID, collectionRef: ref },
      { getDrizzleDb: () => db },
    )
    expect(denied.status).toBe('not_eligible')
    expect(eventRows(db)).toHaveLength(0)

    const allowedRef = allowRef(db, 'v3')
    const inserted = insertEligibleCanonicalEvent(
      { event: buildEvent('se-6'), processEpochId: EPOCH_ID, collectionRef: allowedRef },
      { getDrizzleDb: () => db },
    )
    expect(inserted.status).toBe('inserted')
    setEligibilityState(
      {
        refKey: allowedRef.refKey,
        keyVersion: allowedRef.keyVersion,
        state: 'deny',
        policyVersion: 3,
        nowMs: NOW + 20,
      },
      { getDrizzleDb: () => db },
    )
    const deleted = deleteCanonicalEventsForRef({ refKey: allowedRef.refKey }, { getDrizzleDb: () => db })
    expect(deleted.deletedEventIds).toHaveLength(1)
    expect(eventRows(db)).toHaveLength(0)
    expect(associationRows(db)).toHaveLength(0)
  })

  test('re-inserting the same logical event dedupes and never double-counts the canonical disposition', () => {
    const ref = allowRef(db, 'v1')
    const event = buildEvent('se-7')
    const first = insertEligibleCanonicalEvent(
      { event, processEpochId: EPOCH_ID, collectionRef: ref },
      { getDrizzleDb: () => db },
    )
    const second = insertEligibleCanonicalEvent(
      { event, processEpochId: EPOCH_ID, collectionRef: ref },
      { getDrizzleDb: () => db },
    )
    expect(first.status).toBe('inserted')
    expect(second.status).toBe('already_present')
    expect(eventRows(db)).toHaveLength(1)
    expect(associationRows(db)).toHaveLength(1)
    expect(counterValue(db, 'canonical')).toBe(1)
  })
})
