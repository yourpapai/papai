// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { analyticsSinks } from '../../../../src/db/schema.js'
import { routeSettingsApi } from '../../../../src/debug/settings-api-router.js'
import { handleAdminAnalyticsRoutes } from '../../../../src/debug/settings/admin/analytics-routes.js'
import type { AdminAnalyticsRouteDeps } from '../../../../src/debug/settings/admin/analytics-routes.js'
import { addAdmin } from '../../../../src/instances/admin-store.js'
import { addUser } from '../../../../src/users.js'
import { KEYRING } from '../../../analytics/subject-fixtures.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from '../helpers.js'

const CANARY_ENDPOINT = 'https://sinks.example.net/ingest/CANARY-ENDPOINT-9f3'
const CANARY_SECRET = 'CANARY-SECRET-77aa'

const SinkViewSchema = z
  .object({
    sinkVersionId: z.string(),
    logicalSinkId: z.string(),
    version: z.number(),
    kind: z.string(),
    egressMode: z.string(),
    state: z.string(),
    payloadSchemaVersion: z.number(),
    configFingerprint: z.string(),
    verifiedAtMs: z.number().nullable(),
    createdAtMs: z.number(),
    disabledAtMs: z.number().nullable(),
  })
  .strict()

const CodeSchema = z.object({ code: z.string() })
const StatusSchema = z.object({ status: z.string() })
const CreatedSinkSchema = z.object({ sink: SinkViewSchema })

const AdminViewSchema = z.object({
  configVersion: z.number(),
  mode: z.object({
    localMode: z.enum(['off', 'local_aggregate', 'local_pseudonymous']),
    externalAggregateEnabled: z.boolean(),
    externalPseudonymousEnabled: z.boolean(),
  }),
  effective: z.object({
    killSwitchActive: z.boolean(),
    localMode: z.enum(['off', 'local_aggregate', 'local_pseudonymous']),
    externalAggregateEnabled: z.boolean(),
    externalPseudonymousEnabled: z.boolean(),
  }),
  policy: z.object({
    policyVersion: z.number().nullable(),
    noticeVersion: z.number().nullable(),
    purpose: z.string().nullable(),
    controllerContact: z.string().nullable(),
    lawfulBasisMode: z.enum(['consent', 'legitimate_interest']).nullable(),
    retainedEventHorizonDays: z.number().nullable(),
    reviewDateMs: z.number().nullable(),
    acknowledgedAtMs: z.number().nullable(),
    policyEffectiveAtMs: z.number().nullable(),
    subjectRightsLookupHorizonDays: z.literal(90),
  }),
  readiness: z.object({ ready: z.boolean(), missing: z.array(z.string()) }),
  sinks: z.array(SinkViewSchema),
  openPanel: z.object({ blocked: z.boolean(), reasons: z.array(z.string()) }),
  snapshot: z.object({ snapshotId: z.string(), publishedAtMs: z.number(), ageMs: z.number() }).nullable(),
})

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

const GOVERNANCE_FIELDS = {
  policyVersion: 1,
  noticeVersion: 1,
  controllerContact: 'privacy@example.com',
  purpose: 'product improvement',
  lawfulBasisMode: 'consent',
  retainedEventHorizonDays: 30,
  reviewDateMs: 1_800_000_000_000,
  acknowledge: true as const,
}

describe('settings admin analytics routes', () => {
  let adminSession: SettingsSession
  let userSession: SettingsSession
  let deps: AdminAnalyticsRouteDeps
  let db: Awaited<ReturnType<typeof setupTestDb>>
  let probeOk: boolean

  const call = (path: string, init: RequestInit = {}): Promise<Response> =>
    handleAdminAnalyticsRoutes(new Request(`https://x${path}`, init), new URL(`https://x${path}`), deps)

  const admin = (withCsrf = false): Record<string, string> => authHeaders(adminSession, withCsrf)

  const patch = (body: unknown): Promise<Response> =>
    call('/settings/api/admin/analytics', {
      method: 'PATCH',
      headers: admin(true),
      body: JSON.stringify(body),
    })

  const getView = async (): Promise<z.infer<typeof AdminViewSchema>> => {
    const res = await call('/settings/api/admin/analytics', { headers: admin() })
    expect(res.status).toBe(200)
    return AdminViewSchema.parse(await res.json())
  }

  const createSink = (overrides: Record<string, unknown> = {}): Promise<Response> =>
    call('/settings/api/admin/analytics/sinks', {
      method: 'POST',
      headers: admin(true),
      body: JSON.stringify({
        logicalSinkId: 'ext-pseudo',
        kind: 'webhook',
        egressMode: 'pseudonymous',
        endpoint: CANARY_ENDPOINT,
        secret: CANARY_SECRET,
        ...overrides,
      }),
    })

  beforeEach(async () => {
    mockLogger()
    db = await setupTestDb()
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'admin-1', platformInstanceId: 'pi-1', addedBy: 'boot', username: undefined })
    addUser({ userId: 'user-1', platformInstanceId: 'pi-1', addedBy: 'admin-1', username: undefined })
    addAdmin('admin-1', 'pi-1')
    adminSession = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'admin-1' })
    userSession = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'user-1' })
    probeOk = true
    deps = {
      getDrizzleDb: (): typeof db => db,
      analyticsKeyring: KEYRING.analytics,
      governanceKeyring: KEYRING.governance,
      probe: (): Promise<Readonly<{ ok: boolean; failureClass?: string }>> =>
        Promise.resolve(probeOk ? { ok: true } : { ok: false, failureClass: 'network' }),
    }
  })

  test('GET requires an authenticated admin', async () => {
    const unauthenticated = await call('/settings/api/admin/analytics')
    expect(unauthenticated.status).toBe(401)

    const nonAdmin = await call('/settings/api/admin/analytics', { headers: authHeaders(userSession) })
    expect(nonAdmin.status).toBe(403)
  })

  test('every mutation requires CSRF', async () => {
    const mutations: readonly { method: string; path: string }[] = [
      { method: 'PATCH', path: '/settings/api/admin/analytics' },
      { method: 'POST', path: '/settings/api/admin/analytics/sinks' },
      { method: 'POST', path: '/settings/api/admin/analytics/sinks/s:v1/verify' },
      { method: 'POST', path: '/settings/api/admin/analytics/sinks/s:v1/rotate' },
      { method: 'POST', path: '/settings/api/admin/analytics/sinks/s:v1/disable' },
      { method: 'POST', path: '/settings/api/admin/analytics/reconcile' },
    ]
    for (const mutation of mutations) {
      const res = await call(mutation.path, { method: mutation.method, headers: admin(false), body: '{}' })
      expect(res.status).toBe(403)
    }
  })

  test('GET returns the admin view with read-only horizon evidence and no sinks by default', async () => {
    const view = await getView()
    expect(view.policy.subjectRightsLookupHorizonDays).toBe(90)
    expect(view.readiness.ready).toBe(false)
    expect(view.readiness.missing.length).toBeGreaterThan(0)
    expect(view.sinks).toEqual([])
    expect(view.effective.killSwitchActive).toBe(false)
    expect(view.openPanel.blocked).toBe(true)
    expect(view.openPanel.reasons).toContain('missing_delete_actor')
  })

  test('PATCH rejects the read-only horizon and unknown keys', async () => {
    const horizon = await patch({ expectedConfigVersion: 1, subjectRightsLookupHorizonDays: 30 })
    expect(horizon.status).toBe(422)
    const unknown = await patch({ expectedConfigVersion: 1, bogus: true })
    expect(unknown.status).toBe(422)
  })

  test('PATCH enforces config version and downward-only retention', async () => {
    const mismatch = await patch({ expectedConfigVersion: 99, purpose: 'x' })
    expect(mismatch.status).toBe(409)
    expect(CodeSchema.parse(await mismatch.json()).code).toBe('config_version_mismatch')

    const view = await getView()
    const set = await patch({ expectedConfigVersion: view.configVersion, retainedEventHorizonDays: 30 })
    expect(set.status).toBe(200)
    const raise = await patch({ expectedConfigVersion: view.configVersion + 1, retainedEventHorizonDays: 60 })
    expect(raise.status).toBe(422)
    expect(CodeSchema.parse(await raise.json()).code).toBe('retention_increase_forbidden')
  })

  test('PATCH acknowledges review and completes governance readiness', async () => {
    const view = await getView()
    const res = await patch({ expectedConfigVersion: view.configVersion, ...GOVERNANCE_FIELDS })
    expect(res.status).toBe(200)
    const after = AdminViewSchema.parse(await res.json())
    expect(after.readiness.ready).toBe(true)
    expect(after.policy.acknowledgedAtMs).not.toBeNull()
  })

  test('pseudonymous enablement is refused without an enabled pseudonymous sink', async () => {
    const view = await getView()
    await patch({ expectedConfigVersion: view.configVersion, ...GOVERNANCE_FIELDS })
    const after = await getView()
    const res = await patch({ expectedConfigVersion: after.configVersion, externalPseudonymousEnabled: true })
    expect(res.status).toBe(422)
    expect(CodeSchema.parse(await res.json()).code).toBe('no_enabled_pseudonymous_sink')
  })

  test('pseudonymous enablement is refused while governance is incomplete', async () => {
    const view = await getView()
    const res = await patch({ expectedConfigVersion: view.configVersion, localMode: 'local_pseudonymous' })
    expect(res.status).toBe(422)
    expect(CodeSchema.parse(await res.json()).code).toBe('governance_incomplete')
  })

  test('kill switch is read-only and authoritative over stored settings', async () => {
    process.env['ANALYTICS_KILL_SWITCH'] = '1'
    try {
      const view = await getView()
      expect(view.effective.killSwitchActive).toBe(true)
      expect(view.effective.localMode).toBe('off')
      expect(view.mode.localMode).toBe('local_aggregate')
    } finally {
      delete process.env['ANALYTICS_KILL_SWITCH']
    }
  })

  test('sink create stores an encrypted pending version and never echoes credentials', async () => {
    const res = await createSink()
    expect(res.status).toBe(201)
    const text = JSON.stringify(await res.json())
    expect(text).not.toContain('CANARY')
    const view = CreatedSinkSchema.parse(JSON.parse(text)).sink
    expect(view.state).toBe('pending_verification')

    const row = db.select().from(analyticsSinks).where(eq(analyticsSinks.sinkVersionId, view.sinkVersionId)).get()
    expect(row).toBeDefined()
    const listed = JSON.stringify(await (await call('/settings/api/admin/analytics', { headers: admin() })).json())
    expect(listed).not.toContain('CANARY')
    expect(listed).not.toContain(row!.endpointCiphertext)
    expect(listed).not.toContain(row!.secretCiphertext)
  })

  test('sink create rejects non-HTTPS endpoints', async () => {
    const res = await createSink({ endpoint: 'http://insecure.example.net/hook' })
    expect(res.status).toBe(422)
  })

  test('verify enables a gated sink and reports controlled gate denials', async () => {
    const created = CreatedSinkSchema.parse(await (await createSink()).json()).sink
    const denied = await call(`/settings/api/admin/analytics/sinks/${created.sinkVersionId}/verify`, {
      method: 'POST',
      headers: admin(true),
      body: JSON.stringify({
        ...FULL_GATE,
        capabilities: { ...FULL_GATE.capabilities, deleteActor: false },
      }),
    })
    expect(denied.status).toBe(200)
    expect(z.object({ status: z.string(), reason: z.string() }).parse(await denied.json()).reason).toBe(
      'missing_delete_actor',
    )

    const ok = await call(`/settings/api/admin/analytics/sinks/${created.sinkVersionId}/verify`, {
      method: 'POST',
      headers: admin(true),
      body: JSON.stringify(FULL_GATE),
    })
    expect(ok.status).toBe(200)
    const body = StatusSchema.parse(await ok.json())
    expect(body.status).toBe('enabled')
    expect(JSON.stringify(body)).not.toContain('CANARY')

    const again = await call(`/settings/api/admin/analytics/sinks/${created.sinkVersionId}/verify`, {
      method: 'POST',
      headers: admin(true),
      body: JSON.stringify(FULL_GATE),
    })
    expect(again.status).toBe(409)

    const missing = await call('/settings/api/admin/analytics/sinks/nope:v1/verify', {
      method: 'POST',
      headers: admin(true),
      body: JSON.stringify(FULL_GATE),
    })
    expect(missing.status).toBe(404)
  })

  test('verify failure returns a controlled failure class without credentials', async () => {
    const created = CreatedSinkSchema.parse(await (await createSink()).json()).sink
    probeOk = false
    const res = await call(`/settings/api/admin/analytics/sinks/${created.sinkVersionId}/verify`, {
      method: 'POST',
      headers: admin(true),
      body: JSON.stringify(FULL_GATE),
    })
    expect(res.status).toBe(200)
    const body = z.object({ status: z.string(), failureClass: z.string() }).parse(await res.json())
    expect(body.status).toBe('verification_failed')
    expect(body.failureClass).toBe('network')
    expect(JSON.stringify(body)).not.toContain('CANARY')
  })

  test('rotate verifies the successor then atomically switches', async () => {
    const created = CreatedSinkSchema.parse(await (await createSink()).json()).sink
    await call(`/settings/api/admin/analytics/sinks/${created.sinkVersionId}/verify`, {
      method: 'POST',
      headers: admin(true),
      body: JSON.stringify(FULL_GATE),
    })
    const rotated = await call(`/settings/api/admin/analytics/sinks/${created.sinkVersionId}/rotate`, {
      method: 'POST',
      headers: admin(true),
      body: JSON.stringify({
        kind: 'webhook',
        egressMode: 'pseudonymous',
        endpoint: 'https://sinks.example.net/ingest/CANARY-ENDPOINT-v2',
        secret: 'CANARY-SECRET-v2',
        ...FULL_GATE,
      }),
    })
    expect(rotated.status).toBe(200)
    const body = z.object({ status: z.string(), sink: SinkViewSchema }).parse(await rotated.json())
    expect(body.status).toBe('rotated')
    expect(JSON.stringify(body)).not.toContain('CANARY')
    const successor = SinkViewSchema.parse(body.sink)
    expect(successor.version).toBe(2)
    expect(successor.state).toBe('enabled')

    const rows = db.select().from(analyticsSinks).all()
    expect(rows.find((row) => row.sinkVersionId === created.sinkVersionId)?.state).toBe('disabled')
  })

  test('rotate without an enabled predecessor is a conflict', async () => {
    const created = CreatedSinkSchema.parse(await (await createSink()).json()).sink
    const res = await call(`/settings/api/admin/analytics/sinks/${created.sinkVersionId}/rotate`, {
      method: 'POST',
      headers: admin(true),
      body: JSON.stringify({
        kind: 'webhook',
        egressMode: 'pseudonymous',
        endpoint: CANARY_ENDPOINT,
        secret: CANARY_SECRET,
        ...FULL_GATE,
      }),
    })
    expect(res.status).toBe(409)
  })

  test('disable soft-disables only enabled versions; there is no hard-delete route', async () => {
    const created = CreatedSinkSchema.parse(await (await createSink()).json()).sink
    const notEnabled = await call(`/settings/api/admin/analytics/sinks/${created.sinkVersionId}/disable`, {
      method: 'POST',
      headers: admin(true),
      body: '{}',
    })
    expect(notEnabled.status).toBe(409)

    await call(`/settings/api/admin/analytics/sinks/${created.sinkVersionId}/verify`, {
      method: 'POST',
      headers: admin(true),
      body: JSON.stringify(FULL_GATE),
    })
    const disabled = await call(`/settings/api/admin/analytics/sinks/${created.sinkVersionId}/disable`, {
      method: 'POST',
      headers: admin(true),
      body: '{}',
    })
    expect(disabled.status).toBe(200)
    expect(StatusSchema.parse(await disabled.json()).status).toBe('disabled')

    const hardDelete = await call(`/settings/api/admin/analytics/sinks/${created.sinkVersionId}`, {
      method: 'DELETE',
      headers: admin(true),
    })
    expect(hardDelete.status).toBe(405)
  })

  test('pseudonymous enablement succeeds once a pseudonymous sink is enabled', async () => {
    const view = await getView()
    await patch({ expectedConfigVersion: view.configVersion, ...GOVERNANCE_FIELDS })
    const created = CreatedSinkSchema.parse(await (await createSink()).json()).sink
    await call(`/settings/api/admin/analytics/sinks/${created.sinkVersionId}/verify`, {
      method: 'POST',
      headers: admin(true),
      body: JSON.stringify(FULL_GATE),
    })
    const after = await getView()
    const res = await patch({ expectedConfigVersion: after.configVersion, externalPseudonymousEnabled: true })
    expect(res.status).toBe(200)
    expect(AdminViewSchema.parse(await res.json()).mode.externalPseudonymousEnabled).toBe(true)
  })

  test('reconcile returns counts-only reports and assesses release requests', async () => {
    const denied = await call('/settings/api/admin/analytics/reconcile', {
      method: 'POST',
      headers: admin(true),
      body: JSON.stringify({ release: { utcDay: '2026-01-01', drillThrough: true } }),
    })
    expect(denied.status).toBe(422)
    expect(CodeSchema.parse(await denied.json()).code).toBe('release_denied')

    const ok = await call('/settings/api/admin/analytics/reconcile', {
      method: 'POST',
      headers: admin(true),
      body: JSON.stringify({ apply: true, release: { utcDay: '2026-01-01' } }),
    })
    expect(ok.status).toBe(200)
    const body = z
      .object({
        status: z.string(),
        delivery: z.object({ total: z.number(), conserved: z.boolean() }),
        releaseAssessment: z.object({ ok: z.boolean() }).optional(),
      })
      .parse(await ok.json())
    expect(['reconciled', 'gap', 'delta']).toContain(body.status)
    expect(body.delivery.total).toBe(0)
    expect(body.releaseAssessment?.ok).toBe(true)
  })

  test('unowned admin analytics paths fall through to 404 and methods to 405', async () => {
    const unknown = await routeSettingsApi(
      new Request('https://x/settings/api/admin/analytics/bogus', { headers: admin() }),
      new URL('https://x/settings/api/admin/analytics/bogus'),
    )
    expect(unknown).toBeNull()

    const wrongMethod = await routeSettingsApi(
      new Request('https://x/settings/api/admin/analytics', { method: 'DELETE', headers: admin(true) }),
      new URL('https://x/settings/api/admin/analytics'),
    )
    expect(wrongMethod).not.toBeNull()
    expect(wrongMethod!.status).toBe(405)
  })
})
