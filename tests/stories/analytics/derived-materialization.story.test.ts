// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { z } from 'zod'

import { getActiveAnalyticsRuntime } from '../../../src/analytics/start-analytics.js'
import {
  analyticsFeatureOpportunityDays,
  analyticsSessions,
  analyticsTurnFriction,
} from '../../../src/db/analytics-derive-schema.js'
import { getDrizzleDb } from '../../../src/db/drizzle.js'
import { scenario } from '../harness/scenario.js'
import { answer, callCapability } from '../harness/scripted-llm.js'

const AdminViewSchema = z.object({ configVersion: z.number(), mode: z.object({ localMode: z.string() }) })

const sessionRows = (): readonly { actorKey: string; turnCount: number }[] =>
  getDrizzleDb()
    .select({ actorKey: analyticsSessions.actorKey, turnCount: analyticsSessions.turnCount })
    .from(analyticsSessions)
    .all()

const featureDayRows = (): readonly { feature: string; actorKey: string }[] =>
  getDrizzleDb()
    .select({ feature: analyticsFeatureOpportunityDays.feature, actorKey: analyticsFeatureOpportunityDays.actorKey })
    .from(analyticsFeatureOpportunityDays)
    .all()

const frictionRows = (): readonly { turnKey: string }[] =>
  getDrizzleDb().select({ turnKey: analyticsTurnFriction.turnKey }).from(analyticsTurnFriction).all()

scenario(
  'SCN-analytics-derived-materialization: the derive job materializes sessions, friction, and feature days from the events of a consenting subject',
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

    // Nothing to derive before the turns run.
    await when.analyticsJobs()
    expect(sessionRows()).toEqual([])

    given.llm([callCapability('tasks.create', { title: 'Ship the report' }), answer('Created it.')])
    await when.message(alice, dm, 'create a task called Ship the report')
    then.replyTo(alice).equals('Created it.')

    given.llm([answer('Here they are.')])
    await when.message(alice, dm, 'list them')
    then.replyTo(alice).equals('Here they are.')
    await getActiveAnalyticsRuntime()?.observer.flush()

    await when.analyticsJobs()

    const sessions = sessionRows()
    expect(sessions.length).toBeGreaterThan(0)
    expect(sessions.reduce((total, row) => total + row.turnCount, 0)).toBeGreaterThan(0)
    // The derived rows key on the actor pseudonym, never on the chat identity.
    expect(sessions.every((row) => !row.actorKey.includes(alice.id))).toBe(true)
    expect(frictionRows().length).toBeGreaterThan(0)
    expect(featureDayRows().length).toBeGreaterThan(0)
  },
  { testTimeoutMs: 25000 },
)
