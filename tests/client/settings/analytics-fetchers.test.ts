// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import {
  createAnalyticsSink,
  deleteAnalyticsData,
  disableAnalyticsSink,
  exportAnalyticsData,
  fetchAdminAnalytics,
  fetchAnalyticsPreferences,
  patchAdminAnalytics,
  putAnalyticsPreferences,
  reconcileAnalytics,
  rotateAnalyticsSink,
  verifyAnalyticsSink,
  withdrawAnalytics,
} from '../../../client/settings/analytics-fetchers.js'
import { setCsrfToken } from '../../../client/settings/fetchers.js'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

const json = (payload: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })

const preferencesPayload = {
  notice: {
    policyVersion: 1,
    noticeVersion: 1,
    purpose: 'product improvement',
    controllerContact: 'privacy@example.com',
    lawfulBasisMode: 'consent',
    policyEffectiveAtMs: null,
  },
  preference: { localLongitudinal: 'allow', externalPseudonymous: 'unknown', effectiveAtMs: 123 },
  explanation: 'Aggregate analytics count events in daily totals.',
  subjectRightsAvailable: true,
} as const

const sinkView = {
  sinkVersionId: 'ext:v1',
  logicalSinkId: 'ext',
  version: 1,
  kind: 'webhook',
  egressMode: 'pseudonymous',
  state: 'pending_verification',
  payloadSchemaVersion: 1,
  configFingerprint: 'fp-1',
  verifiedAtMs: null,
  createdAtMs: 100,
  disabledAtMs: null,
} as const

const adminPayload = {
  configVersion: 3,
  mode: { localMode: 'local_aggregate', externalAggregateEnabled: false, externalPseudonymousEnabled: false },
  effective: {
    killSwitchActive: false,
    localMode: 'local_aggregate',
    externalAggregateEnabled: false,
    externalPseudonymousEnabled: false,
  },
  policy: {
    policyVersion: 1,
    noticeVersion: 1,
    purpose: 'product improvement',
    controllerContact: 'privacy@example.com',
    lawfulBasisMode: 'consent',
    retainedEventHorizonDays: 30,
    reviewDateMs: 100,
    acknowledgedAtMs: 100,
    policyEffectiveAtMs: null,
    subjectRightsLookupHorizonDays: 90,
  },
  readiness: { ready: true, missing: [] },
  sinks: [sinkView],
  openPanel: { blocked: true, reasons: ['missing_delete_actor'] },
  snapshot: null,
} as const

const exportPayload = {
  productAnalytics: { events: [], sessions: [], deliveries: [] },
  governance: { preference: null, audit: [] },
  coverage: 'analytics_only',
  outOfScope: 'This export covers analytics data only.',
} as const

const withdrawPayload = { status: 'completed', eventsRemoved: 1, deliveryRowsRemoved: 0, censorsApplied: 2 } as const
const deletePayload = { status: 'completed', coverage: 'analytics_only' } as const

const methodOf = (init: RequestInit): string => (init.method ?? 'GET').toUpperCase()
const csrfOf = (init: RequestInit): string => new Headers(init.headers).get('X-Settings-CSRF') ?? ''
const bodyOf = (init: RequestInit): string => (typeof init.body === 'string' ? init.body : '')
const withdrawOrDeletePayload = (url: string): unknown => (url.endsWith('/withdraw') ? withdrawPayload : deletePayload)

const FULL_GATE = {
  capabilities: { callerControlledIdempotency: true, deterministicReconciliation: true, deleteActor: true },
  processorReview: {
    subprocessorReviewed: true,
    residencyReviewed: true,
    deletionPathReviewed: true,
    incidentReviewed: true,
    transferReviewed: true,
    noSecondaryUse: true,
  },
  httpsPolicyApproved: true,
} as const

afterEach(() => {
  restoreFetch()
  setCsrfToken('')
})

describe('analytics fetchers', () => {
  test('fetchAnalyticsPreferences GETs the actor preferences path', async () => {
    let seenUrl = ''
    setMockFetch((url) => {
      seenUrl = url
      return Promise.resolve(json(preferencesPayload))
    })
    const result = await fetchAnalyticsPreferences()
    expect(seenUrl).toBe('/settings/api/analytics/preferences')
    expect(result.subjectRightsAvailable).toBe(true)
  })

  test('putAnalyticsPreferences PUTs with CSRF and only the lane payload', async () => {
    setCsrfToken('csrf-an')
    let seenMethod = ''
    let seenBody = ''
    let seenCsrf = ''
    setMockFetch((_url, init) => {
      seenMethod = methodOf(init)
      seenBody = bodyOf(init)
      seenCsrf = csrfOf(init)
      return Promise.resolve(json({ ok: true, preference: preferencesPayload.preference }))
    })
    await putAnalyticsPreferences({ localLongitudinal: 'deny' })
    expect(seenMethod).toBe('PUT')
    expect(seenBody).toBe(JSON.stringify({ localLongitudinal: 'deny' }))
    expect(seenCsrf).toBe('csrf-an')
  })

  test('exportAnalyticsData POSTs and requires a no-store cache control header', async () => {
    setCsrfToken('csrf-an')
    let seenMethod = ''
    setMockFetch((_url, init) => {
      seenMethod = methodOf(init)
      return Promise.resolve(
        json(exportPayload, 200, {
          'Cache-Control': 'no-store',
          'Content-Disposition': 'attachment; filename="papai-analytics-export.json"',
        }),
      )
    })
    const result = await exportAnalyticsData()
    expect(seenMethod).toBe('POST')
    expect(result.filename).toBe('papai-analytics-export.json')
    expect(result.data.coverage).toBe('analytics_only')
  })

  test('exportAnalyticsData throws when the no-store header is missing', async () => {
    setMockFetch(() => Promise.resolve(json(exportPayload)))
    await expect(exportAnalyticsData()).rejects.toThrow('no-store')
  })

  test('withdrawAnalytics and deleteAnalyticsData POST with CSRF', async () => {
    setCsrfToken('csrf-an')
    const seen: string[] = []
    setMockFetch((url, init) => {
      seen.push(`${methodOf(init)} ${url}`)
      return Promise.resolve(json(withdrawOrDeletePayload(url)))
    })
    await withdrawAnalytics()
    await deleteAnalyticsData()
    expect(seen).toEqual(['POST /settings/api/analytics/withdraw', 'POST /settings/api/analytics/delete'])
  })

  test('fetchAdminAnalytics and patchAdminAnalytics hit the admin path', async () => {
    setCsrfToken('csrf-an')
    const seen: string[] = []
    setMockFetch((url, init) => {
      seen.push(`${methodOf(init)} ${url}`)
      return Promise.resolve(json(adminPayload))
    })
    await fetchAdminAnalytics()
    await patchAdminAnalytics({ expectedConfigVersion: 3, retainedEventHorizonDays: 30 })
    expect(seen).toEqual(['GET /settings/api/admin/analytics', 'PATCH /settings/api/admin/analytics'])
  })

  test('sink lifecycle fetchers call the versioned endpoints', async () => {
    setCsrfToken('csrf-an')
    const seen: string[] = []
    setMockFetch((url, init) => {
      seen.push(`${methodOf(init)} ${url}`)
      return Promise.resolve(json({ status: 'enabled', sink: sinkView }))
    })
    await createAnalyticsSink({
      logicalSinkId: 'ext',
      kind: 'webhook',
      egressMode: 'pseudonymous',
      endpoint: 'https://sink.example.net/hook',
      secret: 'write-only-secret',
    })
    await verifyAnalyticsSink('ext:v1', FULL_GATE)
    await rotateAnalyticsSink('ext:v1', {
      kind: 'webhook',
      egressMode: 'pseudonymous',
      endpoint: 'https://sink.example.net/hook2',
      secret: 'rotated-secret',
      ...FULL_GATE,
    })
    await disableAnalyticsSink('ext:v1')
    expect(seen).toEqual([
      'POST /settings/api/admin/analytics/sinks',
      'POST /settings/api/admin/analytics/sinks/ext%3Av1/verify',
      'POST /settings/api/admin/analytics/sinks/ext%3Av1/rotate',
      'POST /settings/api/admin/analytics/sinks/ext%3Av1/disable',
    ])
  })

  test('reconcileAnalytics POSTs to the reconcile endpoint', async () => {
    setCsrfToken('csrf-an')
    let seenUrl = ''
    setMockFetch((url) => {
      seenUrl = url
      return Promise.resolve(
        json({
          status: 'reconciled',
          liveEpochs: [],
          delivery: { total: 0, uniquePairs: 0, byState: {}, excludedNonActiveGeneration: 0, conserved: true },
          associationViolations: 0,
          eventsByName: {},
          eventsByAttributionQuality: {},
        }),
      )
    })
    const result = await reconcileAnalytics({ apply: true })
    expect(seenUrl).toBe('/settings/api/admin/analytics/reconcile')
    expect(result.status).toBe('reconciled')
  })
})
