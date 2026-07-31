// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { exportSubjectData } from '../../src/analytics/governance/subject-service.js'
import * as schema from '../../src/db/schema.js'
import { setupTestDb } from '../utils/test-helpers.js'
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
} from './subject-fixtures.js'

describe('authenticated subject export', () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>

  beforeEach(async () => {
    db = await setupTestDb()
  })

  test('two actors in one group across three key versions and generations: only the requester is exported', () => {
    seedSubjectEvent(db, IDENTITY_A, {
      keyVersion: 'v1',
      storageGeneration: GENERATIONS.retired,
      sourceRefKey: 'ref-exp-r1',
      eventId: 'ev-exp-r1',
      eventName: 'turn_started',
      occurredAtMs: T - 3000,
    })
    seedSubjectEvent(db, IDENTITY_A, {
      keyVersion: 'v2',
      storageGeneration: GENERATIONS.shadow,
      sourceRefKey: 'ref-exp-s1',
      eventId: 'ev-exp-s1',
      eventName: 'turn_completed',
      occurredAtMs: T - 2000,
    })
    seedSubjectEvent(db, IDENTITY_A, {
      keyVersion: 'v3',
      storageGeneration: GENERATIONS.active,
      sourceRefKey: 'ref-exp-a1',
      eventId: 'ev-exp-a1',
      eventName: 'llm_completed',
      occurredAtMs: T - 1000,
    })
    seedSubjectEvent(db, IDENTITY_B, {
      keyVersion: 'v1',
      storageGeneration: GENERATIONS.retired,
      sourceRefKey: 'ref-exp-b1',
      eventId: 'ev-exp-b1',
      occurredAtMs: T - 2500,
    })
    seedSubjectEvent(db, IDENTITY_B, {
      keyVersion: 'v3',
      storageGeneration: GENERATIONS.active,
      sourceRefKey: 'ref-exp-b2',
      eventId: 'ev-exp-b2',
      occurredAtMs: T - 500,
    })

    const result = exportSubjectData(IDENTITY_A, makeSubjectDeps(db), T)

    expect(result.productAnalytics.events.map((event) => event.eventId).sort()).toEqual([
      'ev-exp-a1',
      'ev-exp-r1',
      'ev-exp-s1',
    ])
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('ev-exp-b1')
    expect(serialized).not.toContain('ev-exp-b2')
    expect(serialized).not.toContain(actorKeyFor(IDENTITY_B, 'v1'))
    expect(serialized).not.toContain(actorKeyFor(IDENTITY_B, 'v3'))
  })

  test('one source opportunity is exported once even when physical copies exist in several generations', () => {
    for (const [keyVersion, generation, eventId] of [
      ['v1', GENERATIONS.retired, 'ev-dup-retired'],
      ['v2', GENERATIONS.shadow, 'ev-dup-shadow'],
      ['v3', GENERATIONS.active, 'ev-dup-active'],
    ] as const) {
      seedSubjectEvent(db, IDENTITY_A, {
        keyVersion,
        storageGeneration: generation,
        sourceRefKey: 'ref-dup-shared',
        eventId,
        eventName: 'turn_started',
        occurredAtMs: T - 1000,
      })
    }

    const result = exportSubjectData(IDENTITY_A, makeSubjectDeps(db), T)

    expect(result.productAnalytics.events).toHaveLength(1)
    expect(result.productAnalytics.events[0]?.eventId).toBe('ev-dup-active')
  })

  test('sessions, deliveries, current preference, and audit rows belong to the requester only', () => {
    const eventId = seedSubjectEvent(db, IDENTITY_A, {
      keyVersion: 'v3',
      storageGeneration: GENERATIONS.active,
      sourceRefKey: 'ref-exp-full',
      eventId: 'ev-exp-full',
    })
    seedSession(db, {
      sessionKey: 'sess-exp',
      storageGeneration: GENERATIONS.active,
      actorKey: actorKeyFor(IDENTITY_A, 'v3'),
      eventId,
      startMs: T - 1000,
      endMs: T,
    })
    seedSink(db, 'sv-exp')
    const grant = allowGrantFor(db, IDENTITY_A, 'v3')
    seedDelivery(db, { eventId, sinkVersionId: 'sv-exp', state: 'delivered', grant, deliveredAtMs: T - 10 })
    db.insert(schema.analyticsPreferences)
      .values({
        governanceActorKey: govActorKeyFor(IDENTITY_A, 'v3'),
        keyVersion: 'v3',
        localLongitudinal: 'allow',
        externalPseudonymous: 'deny',
        policyVersion: 3,
        source: 'settings',
        effectiveAt: T - 100,
        updatedAt: T - 100,
      })
      .run()
    db.insert(schema.analyticsPolicyAudit)
      .values({
        auditId: 'audit-exp',
        governanceActorKey: govActorKeyFor(IDENTITY_A, 'v3'),
        action: 'deny',
        policyVersion: 3,
        occurredAt: T - 100,
        result: 'applied',
        failureClass: null,
      })
      .run()
    db.insert(schema.analyticsPolicyAudit)
      .values({
        auditId: 'audit-exp-other',
        governanceActorKey: govActorKeyFor(IDENTITY_B, 'v3'),
        action: 'allow',
        policyVersion: 3,
        occurredAt: T - 90,
        result: 'applied',
        failureClass: null,
      })
      .run()

    const result = exportSubjectData(IDENTITY_A, makeSubjectDeps(db), T)

    expect(result.productAnalytics.sessions.map((session) => session.sessionKey)).toEqual(['sess-exp'])
    expect(result.productAnalytics.deliveries).toEqual([
      { sinkVersionId: 'sv-exp', state: 'delivered', deliveredAtMs: T - 10 },
    ])
    expect(result.governance.preference).toEqual({ localLongitudinal: 'allow', externalPseudonymous: 'deny' })
    expect(result.governance.audit.map((row) => row.auditId)).toEqual(['audit-exp'])
  })

  test('no secret keys, native IDs, raw errors, endpoints, or bodies appear anywhere in the export', () => {
    const eventId = seedSubjectEvent(db, IDENTITY_A, {
      keyVersion: 'v3',
      storageGeneration: GENERATIONS.active,
      sourceRefKey: 'ref-exp-leak',
      eventId: 'ev-exp-leak',
      props: { inputPreview: 'redacted', turns: 1 },
    })
    seedSink(db, 'sv-leak')
    const grant = allowGrantFor(db, IDENTITY_A, 'v3')
    seedDelivery(db, {
      eventId,
      sinkVersionId: 'sv-leak',
      state: 'dead',
      grant,
      lastErrorClass: 'http_5xx',
    })

    const result = exportSubjectData(IDENTITY_A, makeSubjectDeps(db), T)
    const serialized = JSON.stringify(result)

    expect(serialized).not.toContain('user-a')
    expect(serialized).not.toContain('pi-1')
    expect(serialized).not.toContain('ct-endpoint')
    expect(serialized).not.toContain('ct-secret')
    expect(serialized).not.toContain('http_5xx')
    for (const key of [...KEYRING.analytics.keys.values(), ...KEYRING.governance.keys.values()]) {
      expect(serialized).not.toContain(key.toString('base64'))
      expect(serialized).not.toContain(key.toString('hex'))
    }
  })

  test('governance and product analytics are separate top-level objects; out-of-scope stores are named', () => {
    const result = exportSubjectData(IDENTITY_A, makeSubjectDeps(db), T)
    expect(Object.keys(result).sort()).toEqual(['governance', 'outOfScope', 'productAnalytics'])
    expect(result.outOfScope).toContain('chat history')
    expect(result.outOfScope).toContain('memory')
  })

  test('a withdrawn subject export describes the retained minimal deny marker explicitly', () => {
    db.insert(schema.analyticsPreferences)
      .values({
        governanceActorKey: govActorKeyFor(IDENTITY_A, 'v3'),
        keyVersion: 'v3',
        localLongitudinal: 'deny',
        externalPseudonymous: 'deny',
        policyVersion: 3,
        source: 'authenticated_request',
        effectiveAt: T - 100,
        updatedAt: T - 100,
      })
      .run()

    const result = exportSubjectData(IDENTITY_A, makeSubjectDeps(db), T)

    expect(result.productAnalytics.events).toHaveLength(0)
    expect(result.governance.preference).toEqual({ localLongitudinal: 'deny', externalPseudonymous: 'deny' })
  })
})
