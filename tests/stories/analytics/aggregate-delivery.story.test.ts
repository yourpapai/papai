// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

import { AnalyticsAggregateReleaseV1Schema } from '../../../src/analytics/delivery/aggregate-release.js'
import { CAPTURED_SINK_ENDPOINT, SYNTHETIC_SINK_TOKEN } from '../../../src/analytics/delivery/captured-sink.testing.js'
import { createSinkVersion } from '../../../src/analytics/delivery/sink-service.js'
import { analyticsDailyCounters } from '../../../src/db/analytics-schema.js'
import { getDrizzleDb } from '../../../src/db/drizzle.js'
import { analyticsAggregateDeliveries, analyticsAggregateReleases, analyticsSinks } from '../../../src/db/schema.js'
import { scenario } from '../harness/scenario.js'

const DAY_MS = 86_400_000

const completeUtcDay = (nowMs: number): string => new Date(nowMs - 2 * DAY_MS).toISOString().slice(0, 10)

const seedEnabledAggregateSink = (nowMs: number): string => {
  const view = createSinkVersion(
    {
      logicalSinkId: 'story-aggregate-sink',
      kind: 'webhook',
      egressMode: 'aggregate',
      endpoint: CAPTURED_SINK_ENDPOINT,
      secret: SYNTHETIC_SINK_TOKEN,
      nowMs,
    },
    { getDrizzleDb, probe: () => Promise.resolve({ ok: true }) },
  )
  getDrizzleDb()
    .update(analyticsSinks)
    .set({ state: 'enabled', verifiedAtMs: nowMs })
    .where(eq(analyticsSinks.sinkVersionId, view.sinkVersionId))
    .run()
  return view.sinkVersionId
}

const insertFinalizedCounter = (input: {
  utcDay: string
  metric: string
  value: number
  contributorCount: number
}): void => {
  getDrizzleDb()
    .insert(analyticsDailyCounters)
    .values({
      utcDay: input.utcDay,
      definitionVersion: 1,
      platform: 'all',
      contextType: 'all',
      actorRole: 'all',
      taskProvider: 'all',
      appVersion: 'all',
      metric: input.metric,
      value: input.value,
      finalized: true,
      partialDay: false,
      restartGapDetected: false,
      lateEventCount: 0,
      reconciliationStatus: 'complete_epoch',
      disclosureScope: 'local_only',
      contributorBasis: 'eligible_actor',
      contributorCount: input.contributorCount,
      threshold: null,
    })
    .run()
}

const AdminAnalyticsViewSchema = z.looseObject({
  configVersion: z.number(),
  mode: z.looseObject({ externalAggregateEnabled: z.boolean() }),
})

const ReleaseExecutionSchema = z.looseObject({
  releaseExecution: z.object({
    status: z.string(),
    releaseId: z.string(),
    releaseHash: z.string(),
    cellCount: z.number(),
  }),
})

const ReleaseDeniedSchema = z.looseObject({ code: z.string(), reason: z.string().optional() })

const disclosureScopeOf = (utcDay: string, metric: string): string | null => {
  const row = getDrizzleDb()
    .select({ disclosureScope: analyticsDailyCounters.disclosureScope })
    .from(analyticsDailyCounters)
    .where(and(eq(analyticsDailyCounters.utcDay, utcDay), eq(analyticsDailyCounters.metric, metric)))
    .get()
  return row?.disclosureScope ?? null
}

scenario(
  'SCN-analytics-aggregate-release-settings: an operator enables the aggregate lane, executes a release through settings, and a re-execute is idempotent',
  async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    given.analyticsRuntime('governed')
    const admin = await given.settingsAdminSession(alice)
    const nowMs = world.clock.now().getTime()
    const utcDay = completeUtcDay(nowMs)
    const sinkVersionId = seedEnabledAggregateSink(nowMs)
    insertFinalizedCounter({ utcDay, metric: 'turn_started', value: 250, contributorCount: 40 })
    insertFinalizedCounter({ utcDay, metric: 'message_accepted', value: 7, contributorCount: 3 })

    const view = await when.settingsRequest(admin, '/settings/api/admin/analytics')
    then.responseStatus(view, 200)
    const { configVersion } = AdminAnalyticsViewSchema.parse(await view.json())

    const patch = await when.settingsRequest(admin, '/settings/api/admin/analytics', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedConfigVersion: configVersion, externalAggregateEnabled: true }),
    })
    then.responseStatus(patch, 200)
    expect(AdminAnalyticsViewSchema.parse(await patch.json()).mode.externalAggregateEnabled).toBe(true)

    const releaseBody = JSON.stringify({ release: { utcDay, sinkVersionId, execute: true } })
    const released = await when.settingsRequest(admin, '/settings/api/admin/analytics/reconcile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: releaseBody,
    })
    then.responseStatus(released, 200)
    const execution = ReleaseExecutionSchema.parse(await released.json()).releaseExecution
    expect(execution.status).toBe('released')
    expect(execution.cellCount).toBe(1)
    expect(execution.releaseHash).toMatch(/^[0-9a-f]{64}$/u)

    const releases = getDrizzleDb().select().from(analyticsAggregateReleases).all()
    expect(releases).toHaveLength(1)
    const payload = AnalyticsAggregateReleaseV1Schema.parse(JSON.parse(releases[0]!.payloadJson))
    expect(payload.utc_day).toBe(utcDay)
    expect(payload.cells).toHaveLength(1)

    const deliveries = getDrizzleDb().select().from(analyticsAggregateDeliveries).all()
    expect(deliveries).toHaveLength(1)
    expect(deliveries[0]).toMatchObject({
      releaseId: execution.releaseId,
      sinkVersionId,
      state: 'pending',
      attempts: 0,
    })

    expect(disclosureScopeOf(utcDay, 'turn_started')).toBe('external_eligible')
    expect(disclosureScopeOf(utcDay, 'message_accepted')).toBe('suppressed')

    const repeated = await when.settingsRequest(admin, '/settings/api/admin/analytics/reconcile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: releaseBody,
    })
    then.responseStatus(repeated, 200)
    const repeatExecution = ReleaseExecutionSchema.parse(await repeated.json()).releaseExecution
    expect(repeatExecution).toMatchObject({ status: 'already_released', releaseId: execution.releaseId, cellCount: 0 })
    expect(getDrizzleDb().select().from(analyticsAggregateReleases).all()).toHaveLength(1)
  },
  { testTimeoutMs: 15000 },
)

scenario(
  'SCN-analytics-aggregate-release-denials: release requests are denied without a sink, with an incomplete day, and for drill-through, and non-admins cannot execute',
  async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    const bob = given.user('bob')
    given.analyticsRuntime('governed')
    const admin = await given.settingsAdminSession(alice)
    const memberSession = await when.settingsSession(bob)
    const nowMs = world.clock.now().getTime()
    const utcDay = completeUtcDay(nowMs)
    const sinkVersionId = seedEnabledAggregateSink(nowMs)
    insertFinalizedCounter({ utcDay, metric: 'turn_started', value: 250, contributorCount: 40 })

    const postRelease = (session: typeof admin, body: unknown): Promise<Response> =>
      when.settingsRequest(session, '/settings/api/admin/analytics/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

    const forbidden = await postRelease(memberSession, { release: { utcDay, sinkVersionId, execute: true } })
    then.responseStatus(forbidden, 403)

    const missingSink = await postRelease(admin, { release: { utcDay, execute: true } })
    then.responseStatus(missingSink, 422)
    expect(ReleaseDeniedSchema.parse(await missingSink.json()).code).toBe('release_sink_required')

    const unknownSink = await postRelease(admin, {
      release: { utcDay, sinkVersionId: 'story-aggregate-sink:v99', execute: true },
    })
    then.responseStatus(unknownSink, 422)
    expect(ReleaseDeniedSchema.parse(await unknownSink.json()).code).toBe('release_sink_unavailable')

    const today = new Date(nowMs).toISOString().slice(0, 10)
    const incompleteDay = await postRelease(admin, { release: { utcDay: today, sinkVersionId, execute: true } })
    then.responseStatus(incompleteDay, 422)
    const incomplete = ReleaseDeniedSchema.parse(await incompleteDay.json())
    expect(incomplete).toMatchObject({ code: 'release_denied', reason: 'incomplete_day' })

    const drillThrough = await postRelease(admin, {
      release: { utcDay, sinkVersionId, execute: true, drillThrough: true },
    })
    then.responseStatus(drillThrough, 422)
    const drill = ReleaseDeniedSchema.parse(await drillThrough.json())
    expect(drill).toMatchObject({ code: 'release_denied', reason: 'drill_through' })

    const assessmentOnly = await postRelease(admin, { release: { utcDay, sinkVersionId } })
    then.responseStatus(assessmentOnly, 200)

    expect(getDrizzleDb().select().from(analyticsAggregateReleases).all()).toHaveLength(0)
    expect(getDrizzleDb().select().from(analyticsAggregateDeliveries).all()).toHaveLength(0)
  },
  { testTimeoutMs: 15000 },
)
