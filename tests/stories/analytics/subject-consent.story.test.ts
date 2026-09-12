// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { z } from 'zod'

import { getActiveAnalyticsRuntime } from '../../../src/analytics/start-analytics.js'
import { getDrizzleDb } from '../../../src/db/drizzle.js'
import {
  analyticsCollectionEligibility,
  analyticsEventCollectionRefs,
  analyticsEvents,
} from '../../../src/db/schema.js'
import { scenario } from '../harness/scenario.js'
import { answer } from '../harness/scripted-llm.js'

const AdminViewSchema = z.object({ configVersion: z.number(), mode: z.object({ localMode: z.string() }) })
const PreferenceSchema = z.object({
  localLongitudinal: z.string(),
  externalPseudonymous: z.string(),
  effectiveAtMs: z.number().nullable(),
})
const PreferenceViewSchema = z.object({ preference: PreferenceSchema, subjectRightsAvailable: z.boolean() })
const PreferenceWriteSchema = z.object({ ok: z.literal(true), preference: PreferenceSchema })

const eligibilityRows = (): readonly { refKey: string; state: string; generation: number }[] =>
  getDrizzleDb()
    .select({
      refKey: analyticsCollectionEligibility.refKey,
      state: analyticsCollectionEligibility.state,
      generation: analyticsCollectionEligibility.generation,
    })
    .from(analyticsCollectionEligibility)
    .all()

const canonicalEventCount = (): number => getDrizzleDb().select().from(analyticsEvents).all().length

const associatedRefKeys = (): readonly string[] =>
  getDrizzleDb()
    .select({ refKey: analyticsEventCollectionRefs.refKey })
    .from(analyticsEventCollectionRefs)
    .all()
    .map(({ refKey }) => refKey)

const flushAnalytics = async (): Promise<void> => {
  await getActiveAnalyticsRuntime()?.observer.flush()
}

scenario(
  'SCN-analytics-consent-grant: consent through settings grants the collection ref that makes the pseudonymous lane admit',
  async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    given.assign(dm, given.taskInstance())
    given.analyticsRuntime('governed')

    const admin = await given.settingsAdminSession(alice)
    const view = AdminViewSchema.parse(
      await (await when.settingsRequest(admin, '/settings/api/admin/analytics')).json(),
    )
    const switched = await when.settingsRequest(admin, '/settings/api/admin/analytics', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedConfigVersion: view.configVersion,
        localMode: 'local_pseudonymous',
        acknowledge: true,
      }),
    })
    then.responseStatus(switched, 200)
    expect(AdminViewSchema.parse(await switched.json()).mode.localMode).toBe('local_pseudonymous')

    // Before consent the lane is on but the subject has no eligibility ref, so
    // the decision denies with `governance_incomplete` and writes nothing.
    given.llm([answer('First reply.')])
    await when.message(alice, dm, 'hello')
    then.replyTo(alice).equals('First reply.')
    await flushAnalytics()
    expect(canonicalEventCount()).toBe(0)
    expect(eligibilityRows()).toEqual([])

    const before = PreferenceViewSchema.parse(
      await (await when.settingsRequest(admin, '/settings/api/analytics/preferences')).json(),
    )
    expect(before.subjectRightsAvailable).toBe(true)
    expect(before.preference.localLongitudinal).toBe('unknown')

    const granted = await when.settingsRequest(admin, '/settings/api/analytics/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ localLongitudinal: 'allow' }),
    })
    then.responseStatus(granted, 200)
    expect(PreferenceWriteSchema.parse(await granted.json()).preference.localLongitudinal).toBe('allow')

    const allowed = eligibilityRows()
    expect(allowed).toHaveLength(1)
    expect(allowed[0]?.state).toBe('allow')
    // The ref is a derived pseudonym: the row must not carry the raw subject.
    expect(allowed[0]?.refKey).not.toContain(alice.id)

    given.llm([answer('Second reply.')])
    await when.message(alice, dm, 'still here')
    then.replyTo(alice).equals('Second reply.')
    await flushAnalytics()
    const admitted = canonicalEventCount()
    expect(admitted).toBeGreaterThan(0)
    expect(new Set(associatedRefKeys())).toEqual(new Set([allowed[0]?.refKey ?? '']))
    expect(associatedRefKeys()).toHaveLength(admitted)

    const withdrawn = await when.settingsRequest(admin, '/settings/api/analytics/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ localLongitudinal: 'deny' }),
    })
    then.responseStatus(withdrawn, 200)
    const revoked = eligibilityRows()
    expect(revoked[0]?.state).toBe('deny')
    expect(revoked[0]?.generation).toBe(2)

    given.llm([answer('Third reply.')])
    await when.message(alice, dm, 'and now')
    then.replyTo(alice).equals('Third reply.')
    await flushAnalytics()
    expect(canonicalEventCount()).toBe(admitted)

    expect(JSON.stringify(world.events.all())).not.toContain(allowed[0]?.refKey ?? 'unreachable')
  },
  { testTimeoutMs: 20000 },
)

const ExportSchema = z.object({
  productAnalytics: z.object({
    events: z.array(z.object({ eventId: z.string(), eventName: z.string() })),
    sessions: z.array(z.unknown()),
    deliveries: z.array(z.unknown()),
  }),
  governance: z.object({
    preference: z.object({ localLongitudinal: z.string(), externalPseudonymous: z.string() }).nullable(),
    audit: z.array(z.object({ action: z.string() })),
  }),
  outOfScope: z.string(),
  coverage: z.literal('analytics_only'),
})
const WithdrawSchema = z.object({
  status: z.string(),
  eventsRemoved: z.number(),
  deliveryRowsRemoved: z.number(),
  censorsApplied: z.number(),
})
const DeleteSchema = z.object({ status: z.string(), coverage: z.literal('analytics_only') })

scenario(
  'SCN-analytics-subject-rights: a consenting subject exports, withdraws, and deletes their analytics record through settings',
  async ({ given, when, then }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    given.assign(dm, given.taskInstance())
    given.analyticsRuntime('governed')

    const admin = await given.settingsAdminSession(alice)
    const view = AdminViewSchema.parse(
      await (await when.settingsRequest(admin, '/settings/api/admin/analytics')).json(),
    )
    then.responseStatus(
      await when.settingsRequest(admin, '/settings/api/admin/analytics', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedConfigVersion: view.configVersion,
          localMode: 'local_pseudonymous',
          acknowledge: true,
        }),
      }),
      200,
    )
    then.responseStatus(
      await when.settingsRequest(admin, '/settings/api/analytics/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ localLongitudinal: 'allow' }),
      }),
      200,
    )

    given.llm([answer('Logged.')])
    await when.message(alice, dm, 'record something')
    then.replyTo(alice).equals('Logged.')
    await flushAnalytics()
    expect(canonicalEventCount()).toBeGreaterThan(0)

    // A write route without the CSRF header is rejected before it touches any
    // subject data, so the export below still sees the full record.
    then.responseStatus(
      await when.settingsRequest(admin, '/settings/api/analytics/export', { method: 'POST' }, { csrf: false }),
      403,
    )

    const exported = await when.settingsRequest(admin, '/settings/api/analytics/export', { method: 'POST' })
    then.responseStatus(exported, 200)
    expect(exported.headers.get('Content-Disposition')).toContain('papai-analytics-export.json')
    const record = ExportSchema.parse(await exported.json())
    expect(record.productAnalytics.events.length).toBeGreaterThan(0)
    expect(record.governance.preference?.localLongitudinal).toBe('allow')
    expect(record.governance.audit.map(({ action }) => action)).toContain('allow')
    expect(JSON.stringify(record)).not.toContain(alice.id)

    const withdrawn = await when.settingsRequest(admin, '/settings/api/analytics/withdraw', { method: 'POST' })
    then.responseStatus(withdrawn, 200)
    const result = WithdrawSchema.parse(await withdrawn.json())
    expect(result.status).toBe('completed')
    expect(result.eventsRemoved).toBeGreaterThan(0)
    expect(canonicalEventCount()).toBe(0)

    const afterWithdrawal = ExportSchema.parse(
      await (await when.settingsRequest(admin, '/settings/api/analytics/export', { method: 'POST' })).json(),
    )
    expect(afterWithdrawal.productAnalytics.events).toEqual([])

    const deleted = await when.settingsRequest(admin, '/settings/api/analytics/delete', { method: 'POST' })
    then.responseStatus(deleted, 200)
    expect(DeleteSchema.parse(await deleted.json()).status).toBe('completed')
    expect(eligibilityRows().every((row) => row.state === 'deny')).toBe(true)
  },
  { testTimeoutMs: 20000 },
)
