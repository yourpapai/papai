// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { buildSubjectExport } from '../../../src/analytics/governance/subject-export.js'
import { deriveSubjectKeys, flattenSubjectKeys } from '../../../src/analytics/governance/subject-keys.js'
import * as schema from '../../../src/db/schema.js'
import { setupTestDb } from '../../utils/test-helpers.js'
import {
  actorKeyFor,
  allowGrantFor,
  GENERATIONS,
  govActorKeyFor,
  IDENTITY_A,
  IDENTITY_B,
  KEYRING,
  makeSubjectDeps,
  seedDelivery,
  seedSession,
  seedSink,
  seedSubjectEvent,
  T,
} from '../subject-fixtures.js'

describe('buildSubjectExport', () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>

  beforeEach(async () => {
    db = await setupTestDb()
  })

  test('finds the subject across every retained key version and storage generation', () => {
    seedSubjectEvent(db, IDENTITY_A, {
      keyVersion: 'v1',
      storageGeneration: GENERATIONS.retired,
      sourceRefKey: 'ref-retired',
      eventId: 'ev-retired',
    })
    seedSubjectEvent(db, IDENTITY_A, {
      keyVersion: 'v2',
      storageGeneration: GENERATIONS.shadow,
      sourceRefKey: 'ref-shadow',
      eventId: 'ev-shadow',
    })
    seedSubjectEvent(db, IDENTITY_A, {
      keyVersion: 'v3',
      storageGeneration: GENERATIONS.active,
      sourceRefKey: 'ref-active',
      eventId: 'ev-active',
    })
    seedSubjectEvent(db, IDENTITY_B, {
      keyVersion: 'v3',
      storageGeneration: GENERATIONS.active,
      sourceRefKey: 'ref-other',
      eventId: 'ev-other',
    })

    const keys = flattenSubjectKeys(deriveSubjectKeys(IDENTITY_A, KEYRING))
    const result = buildSubjectExport(keys, makeSubjectDeps(db), T + 1000)

    expect(result.productAnalytics.events.map((event) => event.eventName)).toEqual([
      'turn_started',
      'turn_started',
      'turn_started',
    ])
    const ids = result.productAnalytics.events.map((event) => event.occurredAtMs)
    expect(ids).toHaveLength(3)
    expect(JSON.stringify(result)).not.toContain('ev-other')
  })

  test('dedupes physical generation copies of one source opportunity, preferring the active generation', () => {
    seedSubjectEvent(db, IDENTITY_A, {
      keyVersion: 'v1',
      storageGeneration: GENERATIONS.retired,
      sourceRefKey: 'ref-shared',
      eventId: 'ev-copy-retired',
      occurredAtMs: T - 1000,
    })
    seedSubjectEvent(db, IDENTITY_A, {
      keyVersion: 'v2',
      storageGeneration: GENERATIONS.shadow,
      sourceRefKey: 'ref-shared',
      eventId: 'ev-copy-shadow',
      occurredAtMs: T - 1000,
    })
    seedSubjectEvent(db, IDENTITY_A, {
      keyVersion: 'v3',
      storageGeneration: GENERATIONS.active,
      sourceRefKey: 'ref-shared',
      eventId: 'ev-copy-active',
      occurredAtMs: T - 1000,
    })

    const keys = flattenSubjectKeys(deriveSubjectKeys(IDENTITY_A, KEYRING))
    const result = buildSubjectExport(keys, makeSubjectDeps(db), T + 1000)

    expect(result.productAnalytics.events).toHaveLength(1)
    expect(result.productAnalytics.events[0]?.storageGeneration).toBe(GENERATIONS.active)
  })

  test('includes sessions, deliveries, current preference, and audit for the subject only', () => {
    const eventId = seedSubjectEvent(db, IDENTITY_A, {
      keyVersion: 'v3',
      storageGeneration: GENERATIONS.active,
      sourceRefKey: 'ref-full',
      eventId: 'ev-full',
    })
    seedSession(db, {
      sessionKey: 'sess-full',
      storageGeneration: GENERATIONS.active,
      actorKey: actorKeyFor(IDENTITY_A, 'v3'),
      eventId,
      startMs: T,
      endMs: T + 5000,
    })
    seedSink(db, 'sv-full')
    const grant = allowGrantFor(db, IDENTITY_A, 'v3')
    seedDelivery(db, {
      eventId,
      sinkVersionId: 'sv-full',
      state: 'delivered',
      grant,
      deliveredAtMs: T + 100,
    })
    db.insert(schema.analyticsPreferences)
      .values({
        governanceActorKey: govActorKeyFor(IDENTITY_A, 'v3'),
        keyVersion: 'v3',
        localLongitudinal: 'deny',
        externalPseudonymous: 'allow',
        policyVersion: 3,
        source: 'settings',
        effectiveAt: T,
        updatedAt: T,
      })
      .run()
    db.insert(schema.analyticsPreferences)
      .values({
        governanceActorKey: govActorKeyFor(IDENTITY_B, 'v3'),
        keyVersion: 'v3',
        localLongitudinal: 'allow',
        externalPseudonymous: 'allow',
        policyVersion: 3,
        source: 'settings',
        effectiveAt: T,
        updatedAt: T,
      })
      .run()
    db.insert(schema.analyticsPolicyAudit)
      .values({
        auditId: 'audit-subject',
        governanceActorKey: govActorKeyFor(IDENTITY_A, 'v3'),
        action: 'deny',
        policyVersion: 3,
        occurredAt: T,
        result: 'applied',
        failureClass: null,
      })
      .run()

    const keys = flattenSubjectKeys(deriveSubjectKeys(IDENTITY_A, KEYRING))
    const result = buildSubjectExport(keys, makeSubjectDeps(db), T + 1000)

    expect(result.productAnalytics.sessions.map((session) => session.sessionKey)).toEqual(['sess-full'])
    expect(result.productAnalytics.deliveries).toEqual([
      { sinkVersionId: 'sv-full', state: 'delivered', deliveredAtMs: T + 100 },
    ])
    expect(result.governance.preference).toEqual({ localLongitudinal: 'deny', externalPseudonymous: 'allow' })
    expect(result.governance.audit.map((row) => row.auditId)).toEqual(['audit-subject'])
    expect(JSON.stringify(result.governance)).not.toContain(govActorKeyFor(IDENTITY_B, 'v3'))
  })

  test('hides rows at the exact expiry deadline and never exposes secrets, endpoints, or native IDs', () => {
    seedSubjectEvent(db, IDENTITY_A, {
      keyVersion: 'v3',
      storageGeneration: GENERATIONS.active,
      sourceRefKey: 'ref-expiry',
      eventId: 'ev-expiry',
      expiresAtMs: T,
    })

    const keys = flattenSubjectKeys(deriveSubjectKeys(IDENTITY_A, KEYRING))
    const before = buildSubjectExport(keys, makeSubjectDeps(db), T - 1)
    const at = buildSubjectExport(keys, makeSubjectDeps(db), T)
    expect(before.productAnalytics.events).toHaveLength(1)
    expect(at.productAnalytics.events).toHaveLength(0)

    const serialized = JSON.stringify(before)
    expect(serialized).not.toContain('user-a')
    expect(serialized).not.toContain('pi-1')
    expect(serialized).not.toContain('ct-endpoint')
    expect(serialized).not.toContain('ct-secret')
  })

  test('keeps governance and product analytics in separate top-level objects and notes out-of-scope stores', () => {
    const keys = flattenSubjectKeys(deriveSubjectKeys(IDENTITY_A, KEYRING))
    const result = buildSubjectExport(keys, makeSubjectDeps(db), T + 1000)
    expect(Object.keys(result).sort()).toEqual(['governance', 'outOfScope', 'productAnalytics'])
    expect(result.outOfScope).toContain('chat history')
  })
})
