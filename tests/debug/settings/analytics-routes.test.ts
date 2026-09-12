// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { eq } from 'drizzle-orm'
import { z } from 'zod'

import type { AnalyticsEventV1 } from '../../../src/analytics/contracts.js'
import { KeyVersionSchema, VersionStringSchema } from '../../../src/analytics/controlled-types.js'
import { insertEligibleCanonicalEvent } from '../../../src/analytics/governance/collection-serialization.js'
import { getEligibilityRef } from '../../../src/analytics/governance/collection-store.js'
import { normalize } from '../../../src/analytics/normalizer.js'
import type { NormalizationResult } from '../../../src/analytics/normalizer.js'
import type { AnalyticsSourceContext } from '../../../src/analytics/source-facts.js'
import { openEpoch } from '../../../src/analytics/storage/epoch-store.js'
import { toScopedContextId } from '../../../src/chat/scoped-context.js'
import {
  analyticsCollectionEligibility,
  analyticsEpochSourceCounters,
  analyticsEvents,
  analyticsPolicyAudit,
  analyticsDeliveries,
} from '../../../src/db/schema.js'
import { routeSettingsApi } from '../../../src/debug/settings-api-router.js'
import { handleAnalyticsRoutes } from '../../../src/debug/settings/analytics-routes.js'
import type { AnalyticsActorRouteDeps } from '../../../src/debug/settings/analytics-routes.js'
import { addUser } from '../../../src/users.js'
import { AKEYS, IDENTITY_A, makeSubjectDeps, refKeyFor, seedSubjectEvent } from '../../analytics/subject-fixtures.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from './helpers.js'

const PreferencesResponseSchema = z.object({
  notice: z.object({
    policyVersion: z.number().nullable(),
    noticeVersion: z.number().nullable(),
    purpose: z.string().nullable(),
    controllerContact: z.string().nullable(),
    lawfulBasisMode: z.enum(['consent', 'legitimate_interest']).nullable(),
    policyEffectiveAtMs: z.number().nullable(),
  }),
  preference: z.object({
    localLongitudinal: z.enum(['allow', 'deny', 'unknown']),
    externalPseudonymous: z.enum(['allow', 'deny', 'unknown']),
    effectiveAtMs: z.number().nullable(),
  }),
  explanation: z.string(),
  subjectRightsAvailable: z.boolean(),
})

const PreferenceUpdateSchema = z.object({
  ok: z.literal(true),
  preference: PreferencesResponseSchema.shape.preference,
})

const WithdrawSchema = z.object({
  status: z.literal('completed'),
  eventsRemoved: z.number(),
  deliveryRowsRemoved: z.number(),
  censorsApplied: z.number(),
})

const DeleteSchema = z.object({
  status: z.enum(['completed', 'in_progress', 'failed', 'requested']),
  coverage: z.literal('analytics_only'),
})

const PATHS = {
  preferences: '/settings/api/analytics/preferences',
  export: '/settings/api/analytics/export',
  withdraw: '/settings/api/analytics/withdraw',
  delete: '/settings/api/analytics/delete',
} as const

const ROUTE_EPOCH_ID = 'epoch-route-wiring'

const routeWiringSource = (): AnalyticsSourceContext => ({
  platform: 'telegram',
  platformInstanceId: 'pi-1',
  chatUserId: 'user-a',
  nativeContextId: 'user-a',
  storageContextId: toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'user-a' }),
  configContextId: toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'user-a' }),
  contextType: 'dm',
  actorRole: 'member',
  taskInstanceId: null,
  taskProvider: 'none',
  invocationMode: 'normal',
  rawTurnId: 'turn-route-1',
})

const buildRouteWiringEvent = (sourceEventId: string, nowMs: number): AnalyticsEventV1 => {
  const result: NormalizationResult = normalize(
    {
      version: 1,
      type: 'chat_message_accepted',
      sourceEventId,
      occurredAtMs: nowMs,
      source: routeWiringSource(),
      inputCount: 1,
      inputLengthChars: 200,
      attachmentCount: 0,
      isCommand: false,
      command: 'none',
    },
    {
      hmacKey: AKEYS.v3,
      keyVersion: KeyVersionSchema.parse('v3'),
      installId: 'install-route-1',
      appVersion: VersionStringSchema.parse('6.14.0'),
      policyVersion: 3,
      ingestedAtMs: nowMs + 1,
    },
  )
  if (result.status !== 'ok') throw new Error(`expected ok, got rejection: ${result.reason}`)
  return result.event
}

const MUTATIONS: readonly { method: string; path: string; body: unknown }[] = [
  { method: 'PUT', path: PATHS.preferences, body: { localLongitudinal: 'deny' } },
  { method: 'POST', path: PATHS.export, body: {} },
  { method: 'POST', path: PATHS.withdraw, body: {} },
  { method: 'POST', path: PATHS.delete, body: {} },
]

describe('settings analytics actor routes', () => {
  let session: SettingsSession
  let deps: AnalyticsActorRouteDeps
  let db: Awaited<ReturnType<typeof setupTestDb>>

  const call = (path: string, init: RequestInit = {}): Promise<Response> =>
    handleAnalyticsRoutes(new Request(`https://x${path}`, init), new URL(`https://x${path}`), deps)

  const authed = (withCsrf = false): Record<string, string> => authHeaders(session, withCsrf)

  beforeEach(async () => {
    mockLogger()
    db = await setupTestDb()
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'user-a', platformInstanceId: 'pi-1', addedBy: 'boot', username: undefined })
    addUser({ userId: 'user-b', platformInstanceId: 'pi-1', addedBy: 'boot', username: undefined })
    session = await establishSession(IDENTITY_A)
    deps = { subject: makeSubjectDeps(db) }
  })

  test('every endpoint requires an authenticated settings session', async () => {
    const endpoints: readonly { method: string; path: string }[] = [
      { method: 'GET', path: PATHS.preferences },
      { method: 'POST', path: PATHS.export },
      { method: 'POST', path: PATHS.withdraw },
      { method: 'POST', path: PATHS.delete },
    ]
    for (const endpoint of endpoints) {
      const res = await call(endpoint.path, { method: endpoint.method })
      expect(res.status).toBe(401)
    }
  })

  test('every mutation requires CSRF', async () => {
    for (const mutation of MUTATIONS) {
      const res = await call(mutation.path, {
        method: mutation.method,
        headers: authed(false),
        body: JSON.stringify(mutation.body),
      })
      expect(res.status).toBe(403)
    }
  })

  test('GET returns notice, plain-language explanation, and unknown defaults', async () => {
    const res = await call(PATHS.preferences, { headers: authed() })
    expect(res.status).toBe(200)
    const body = PreferencesResponseSchema.parse(await res.json())
    expect(body.preference).toEqual({
      localLongitudinal: 'unknown',
      externalPseudonymous: 'unknown',
      effectiveAtMs: null,
    })
    expect(body.subjectRightsAvailable).toBe(true)
    expect(body.explanation.length).toBeGreaterThan(0)
  })

  test('PUT accepts allow/deny per lane and reflects them in GET', async () => {
    const put = await call(PATHS.preferences, {
      method: 'PUT',
      headers: authed(true),
      body: JSON.stringify({ localLongitudinal: 'allow', externalPseudonymous: 'deny' }),
    })
    expect(put.status).toBe(200)
    const updated = PreferenceUpdateSchema.parse(await put.json())
    expect(updated.preference.localLongitudinal).toBe('allow')
    expect(updated.preference.externalPseudonymous).toBe('deny')
    expect(updated.preference.effectiveAtMs).not.toBeNull()

    const get = await call(PATHS.preferences, { headers: authed() })
    const body = PreferencesResponseSchema.parse(await get.json())
    expect(body.preference.localLongitudinal).toBe('allow')
    expect(body.preference.externalPseudonymous).toBe('deny')
  })

  test('PUT rejects unknown keys, unknown writes, and missing lanes', async () => {
    const cases: unknown[] = [
      { localLongitudinal: 'unknown' },
      { externalPseudonymous: 'maybe' },
      { localLongitudinal: 'allow', extra: true },
      { contextId: 'group:1', localLongitudinal: 'allow' },
      {},
    ]
    for (const body of cases) {
      const res = await call(PATHS.preferences, {
        method: 'PUT',
        headers: authed(true),
        body: JSON.stringify(body),
      })
      expect(res.status).toBe(422)
    }
  })

  test('actor identity supplied in body or query is rejected', async () => {
    const byBody = await call(PATHS.preferences, {
      method: 'PUT',
      headers: authed(true),
      body: JSON.stringify({ localLongitudinal: 'deny', platformUserId: 'user-b' }),
    })
    expect(byBody.status).toBe(422)

    const byQuery = await call(`${PATHS.preferences}?actorId=user-b`, { headers: authed() })
    expect(byQuery.status).toBe(422)

    const byUserIdQuery = await call(`${PATHS.withdraw}?platformUserId=user-b`, {
      method: 'POST',
      headers: authed(true),
      body: '{}',
    })
    expect(byUserIdQuery.status).toBe(422)
  })

  test('preference writes append governance audit without creating events or deliveries', async () => {
    const before = {
      events: db.select().from(analyticsEvents).all().length,
      deliveries: db.select().from(analyticsDeliveries).all().length,
      audit: db.select().from(analyticsPolicyAudit).all().length,
    }
    const res = await call(PATHS.preferences, {
      method: 'PUT',
      headers: authed(true),
      body: JSON.stringify({ localLongitudinal: 'deny' }),
    })
    expect(res.status).toBe(200)
    expect(db.select().from(analyticsEvents).all().length).toBe(before.events)
    expect(db.select().from(analyticsDeliveries).all().length).toBe(before.deliveries)
    expect(db.select().from(analyticsPolicyAudit).all().length).toBeGreaterThan(before.audit)
  })

  test('export returns an analytics-only download with no-store cache control', async () => {
    seedSubjectEvent(db, IDENTITY_A, { keyVersion: 'v3', storageGeneration: 'gen-1', sourceRefKey: 'ref-export' })
    const res = await call(PATHS.export, { method: 'POST', headers: authed(true), body: '{}' })
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toContain('no-store')
    expect(res.headers.get('Content-Disposition')).toContain('attachment')
    const body = z
      .looseObject({
        coverage: z.literal('analytics_only'),
        outOfScope: z.string(),
        productAnalytics: z.looseObject({ events: z.array(z.unknown()) }),
      })
      .parse(await res.json())
    expect(body.coverage).toBe('analytics_only')
    expect(body.outOfScope.length).toBeGreaterThan(0)
    expect(body.productAnalytics.events.length).toBeGreaterThan(0)
  })

  test('withdraw runs the atomic workflow and never creates product events', async () => {
    seedSubjectEvent(db, IDENTITY_A, { keyVersion: 'v3', storageGeneration: 'gen-1', sourceRefKey: 'ref-withdraw' })
    const eventsBefore = db.select().from(analyticsEvents).all().length
    const res = await call(PATHS.withdraw, { method: 'POST', headers: authed(true), body: '{}' })
    expect(res.status).toBe(200)
    const body = WithdrawSchema.parse(await res.json())
    expect(body.eventsRemoved).toBe(1)
    expect(body.censorsApplied).toBeGreaterThan(0)
    expect(JSON.stringify(body)).not.toContain('user-a')
    expect(db.select().from(analyticsEvents).all().length).toBe(eventsBefore - 1)
    const get = await call(PATHS.preferences, { headers: authed() })
    const pref = PreferencesResponseSchema.parse(await get.json())
    expect(pref.preference.localLongitudinal).toBe('deny')
    expect(pref.preference.externalPseudonymous).toBe('deny')
  })

  test('delete queues an authenticated request and returns its status without identity', async () => {
    const res = await call(PATHS.delete, { method: 'POST', headers: authed(true), body: '{}' })
    expect(res.status).toBe(200)
    const body = DeleteSchema.parse(await res.json())
    expect(body.status).toBe('completed')
    expect(JSON.stringify(body)).not.toContain('user-a')
    expect(JSON.stringify(body)).not.toContain('pi-1')
  })

  test('one user session cannot touch another user preference', async () => {
    const otherSession = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'user-b' })
    const res = await call(PATHS.preferences, {
      method: 'PUT',
      headers: authHeaders(otherSession, true),
      body: JSON.stringify({ localLongitudinal: 'allow' }),
    })
    expect(res.status).toBe(200)
    const mine = PreferencesResponseSchema.parse(await (await call(PATHS.preferences, { headers: authed() })).json())
    expect(mine.preference.localLongitudinal).toBe('unknown')
  })

  test('unowned methods and paths yield 405/404 through the settings router', async () => {
    const del = await routeSettingsApi(
      new Request(`https://x${PATHS.preferences}`, { method: 'DELETE', headers: authed(true) }),
      new URL(`https://x${PATHS.preferences}`),
    )
    expect(del).not.toBeNull()
    expect(del!.status).toBe(405)

    const unknown = await routeSettingsApi(
      new Request('https://x/settings/api/analytics/unknown', { headers: authed() }),
      new URL('https://x/settings/api/analytics/unknown'),
    )
    expect(unknown).toBeNull()
  })

  test('PUT localLongitudinal allow provisions the actor collection eligibility ref', async () => {
    const put = await call(PATHS.preferences, {
      method: 'PUT',
      headers: authed(true),
      body: JSON.stringify({ localLongitudinal: 'allow' }),
    })
    expect(put.status).toBe(200)
    const updated = PreferenceUpdateSchema.parse(await put.json())
    expect(updated.preference.localLongitudinal).toBe('allow')

    const ref = getEligibilityRef(refKeyFor(IDENTITY_A, 'v3'), { getDrizzleDb: () => db })
    expect(ref).not.toBeNull()
    expect(ref?.keyVersion).toBe('v3')
  })

  test('PUT localLongitudinal deny revokes eligibility with a generation bump and is idempotent', async () => {
    const allow = await call(PATHS.preferences, {
      method: 'PUT',
      headers: authed(true),
      body: JSON.stringify({ localLongitudinal: 'allow' }),
    })
    expect(allow.status).toBe(200)
    const allowedRow = db
      .select({ generation: analyticsCollectionEligibility.generation })
      .from(analyticsCollectionEligibility)
      .where(eq(analyticsCollectionEligibility.refKey, refKeyFor(IDENTITY_A, 'v3')))
      .get()
    expect(allowedRow).toBeDefined()

    const deny = await call(PATHS.preferences, {
      method: 'PUT',
      headers: authed(true),
      body: JSON.stringify({ localLongitudinal: 'deny' }),
    })
    expect(deny.status).toBe(200)
    const deniedRow = db
      .select()
      .from(analyticsCollectionEligibility)
      .where(eq(analyticsCollectionEligibility.refKey, refKeyFor(IDENTITY_A, 'v3')))
      .get()
    expect(deniedRow?.state).toBe('deny')
    expect(deniedRow?.generation).toBeGreaterThan(allowedRow!.generation)
    expect(getEligibilityRef(refKeyFor(IDENTITY_A, 'v3'), { getDrizzleDb: () => db })).toBeNull()

    const denyAgain = await call(PATHS.preferences, {
      method: 'PUT',
      headers: authed(true),
      body: JSON.stringify({ localLongitudinal: 'deny' }),
    })
    expect(denyAgain.status).toBe(200)
    expect(
      db
        .select({ state: analyticsCollectionEligibility.state })
        .from(analyticsCollectionEligibility)
        .where(eq(analyticsCollectionEligibility.refKey, refKeyFor(IDENTITY_A, 'v3')))
        .get()?.state,
    ).toBe('deny')
  })

  test('PUT without localLongitudinal leaves collection eligibility untouched', async () => {
    const allow = await call(PATHS.preferences, {
      method: 'PUT',
      headers: authed(true),
      body: JSON.stringify({ localLongitudinal: 'allow' }),
    })
    expect(allow.status).toBe(200)

    const externalOnly = await call(PATHS.preferences, {
      method: 'PUT',
      headers: authed(true),
      body: JSON.stringify({ externalPseudonymous: 'allow' }),
    })
    expect(externalOnly.status).toBe(200)
    expect(getEligibilityRef(refKeyFor(IDENTITY_A, 'v3'), { getDrizzleDb: () => db })).not.toBeNull()
  })

  test('eligibility provisioned via the route gates canonical inserts and denial fails closed', async () => {
    const nowMs = Date.now()
    openEpoch({ epochId: ROUTE_EPOCH_ID, startedAtMs: nowMs }, { getDrizzleDb: () => db })
    const buildEvent = (sourceEventId: string): AnalyticsEventV1 => buildRouteWiringEvent(sourceEventId, nowMs)

    const allow = await call(PATHS.preferences, {
      method: 'PUT',
      headers: authed(true),
      body: JSON.stringify({ localLongitudinal: 'allow' }),
    })
    expect(allow.status).toBe(200)
    const ref = getEligibilityRef(refKeyFor(IDENTITY_A, 'v3'), { getDrizzleDb: () => db })
    expect(ref).not.toBeNull()

    const inserted = insertEligibleCanonicalEvent(
      { event: buildEvent('se-route-1'), processEpochId: ROUTE_EPOCH_ID, collectionRef: ref! },
      { getDrizzleDb: () => db },
    )
    expect(inserted.status).toBe('inserted')
    expect(db.select({ eventId: analyticsEvents.eventId }).from(analyticsEvents).all()).toHaveLength(1)

    const deny = await call(PATHS.preferences, {
      method: 'PUT',
      headers: authed(true),
      body: JSON.stringify({ localLongitudinal: 'deny' }),
    })
    expect(deny.status).toBe(200)
    expect(getEligibilityRef(refKeyFor(IDENTITY_A, 'v3'), { getDrizzleDb: () => db })).toBeNull()

    const refused = insertEligibleCanonicalEvent(
      { event: buildEvent('se-route-2'), processEpochId: ROUTE_EPOCH_ID, collectionRef: ref! },
      { getDrizzleDb: () => db },
    )
    expect(refused.status).toBe('not_eligible')
    expect(db.select({ eventId: analyticsEvents.eventId }).from(analyticsEvents).all()).toHaveLength(1)
    const counterTotal = (disposition: string): number =>
      db
        .select({ value: analyticsEpochSourceCounters.value })
        .from(analyticsEpochSourceCounters)
        .where(eq(analyticsEpochSourceCounters.disposition, disposition))
        .all()
        .reduce((sum, row) => sum + row.value, 0)
    expect(counterTotal('governance_ineligible')).toBe(1)
    expect(counterTotal('canonical')).toBe(1)
  })
})
