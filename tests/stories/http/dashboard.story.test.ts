// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { scenario } from '../harness/scenario.js'

scenario(
  'SCN-http-admin-dashboard: the dashboard session authorizes admin reads that reject anonymous callers',
  async ({ given, when, then }) => {
    const alice = given.user('alice')
    given.identity(alice, { providerUserId: 'u-42', login: 'alice-dev', displayName: 'Alice Dev' })

    const anonymous = await when.request('/admin/identity/mappings')
    then.responseStatus(anonymous, 401)

    const session = await given.dashboardSession()
    const mappings = await when.dashboardRequest(session, '/admin/identity/mappings')
    then.responseStatus(mappings, 200)
    then.responseJson(await mappings.json()).contains('alice-dev')
  },
)

scenario(
  'SCN-http-billing-stats-readonly: the dashboard session reads stats that reject anonymous callers',
  async ({ given, when, then }) => {
    const session = await given.dashboardSession()

    const anonymous = await when.request('/stats/global')
    then.responseStatus(anonymous, 401)

    const stats = await when.dashboardRequest(session, '/stats/global?window=7d')
    then.responseStatus(stats, 200)
    then.responseJson(await stats.json()).contains('7d')

    const badWindow = await when.dashboardRequest(session, '/stats/global?window=not-a-window')
    then.responseStatus(badWindow, 400)
  },
)

scenario(
  'SCN-http-debug-live-panels: debug panels require both the world flag and the dashboard session',
  async ({ given, when, then }) => {
    // debugEnabled:true (3rd arg) passes the debug gate; the dashboard gate still applies.
    const noSession = await when.request('/debug')
    then.responseStatus(noSession, 401)

    const session = await given.dashboardSession()
    const panel = await when.dashboardRequest(session, '/debug')
    then.responseStatus(panel, 200)
  },
  { debugEnabled: true },
)

scenario(
  'SCN-http-dashboard-debug-gate: debug paths and the legacy dashboard redirect are hidden when disabled',
  async ({ given, when, then }) => {
    then.responseStatus(await when.request('/debug'), 404)

    const session = await given.dashboardSession()
    then.responseStatus(await when.dashboardRequest(session, '/admin'), 200)
    then.responseStatus(await when.dashboardRequest(session, '/dashboard'), 404)
  },
)

scenario(
  'SCN-http-debug-protected-surfaces: enabled diagnostic reads still require a dashboard session',
  async ({ given, when, then }) => {
    then.responseStatus(await when.request('/logs'), 401)
    then.responseStatus(await when.request('/mcp/status'), 401)

    const session = await given.dashboardSession()
    const status = await when.dashboardRequest(session, '/mcp/status')
    then.responseStatus(status, 200)
    then.responseJson(await status.json()).contains('servers')
    then.responseStatus(await when.dashboardRequest(session, '/mcp/status', { method: 'POST' }), 405)

    const legacyDashboard = await when.dashboardRequest(session, '/dashboard')
    then.responseStatus(legacyDashboard, 301)
    then.responseJson({ location: legacyDashboard.headers.get('Location') }).contains('/debug')
  },
  { debugEnabled: true },
)

scenario(
  'SCN-http-debug-route-family: a dashboard session reads every live diagnostic route',
  async ({ given, when, then, world }) => {
    const alice = given.user('debug-routes-alice')
    const dm = given.dm(alice)
    given.identity(alice, { providerUserId: 'provider-alice', login: 'alice', displayName: 'Alice' })
    given.recurringTask(dm, { title: 'Review routes', nextRun: '2099-01-01T00:00:00.000Z' })
    given.scheduledPrompt(dm, { prompt: 'Review routes', fireAt: '2099-01-01T00:00:00.000Z' })
    given.memo({ userId: world.scopedStorageContextId(dm), content: 'Route memo' })
    const session = await given.dashboardSession()
    const userId = encodeURIComponent(world.scopedStorageContextId(dm))

    const events = await when.dashboardRequest(session, '/events')
    then.responseStatus(events, 200)
    await events.body?.cancel()

    const logs = await when.dashboardRequest(session, '/logs')
    then.responseStatus(logs, 200)
    then.responseJson(await logs.json()).contains('[')

    const stats = await when.dashboardRequest(session, '/logs/stats')
    then.responseStatus(stats, 200)
    then.responseJson(await stats.json()).contains('count')

    const scopes = await when.dashboardRequest(session, '/logs/scopes')
    then.responseStatus(scopes, 200)
    then.responseJson(await scopes.json()).contains('[')

    then.responseStatus(await when.dashboardRequest(session, '/turns/not-found'), 404)
    then.responseStatus(await when.dashboardRequest(session, `/recurring?userId=${userId}`), 200)
    then.responseStatus(await when.dashboardRequest(session, `/deferred?userId=${userId}`), 200)
    then.responseStatus(await when.dashboardRequest(session, `/memos?userId=${userId}`), 200)
    then.responseStatus(
      await when.dashboardRequest(session, `/identity?userId=${encodeURIComponent(alice.id)}&provider=kaneo`),
      200,
    )
  },
  { debugEnabled: true },
)

scenario(
  'SCN-http-dashboard-assets: dashboard assets are session-protected and non-empty',
  async ({ given, when, then }) => {
    const session = await given.dashboardSession()
    const assets = ['/debug.js', '/debug.css', '/admin.js', '/admin.css'] as const
    for (const path of assets) {
      const response = await when.dashboardRequest(session, path)
      then.responseStatus(response, 200)
      expect((await response.text()).length).toBeGreaterThan(0)
    }
  },
  { debugEnabled: true },
)

scenario(
  'SCN-http-operator-data-routes: dashboard data routes preserve authentication and missing-subject contracts',
  async ({ given, when, then }) => {
    then.responseStatus(await when.request('/billing/subjects'), 401)
    then.responseStatus(await when.request('/admin/subjects/unknown/recent-requests'), 401)

    const session = await given.dashboardSession()
    const subjects = await when.dashboardRequest(session, '/billing/subjects?window=all')
    then.responseStatus(subjects, 200)
    then.responseJson(await subjects.json()).contains('subjects')
    then.responseStatus(await when.dashboardRequest(session, '/billing/subject/unknown?window=all'), 404)

    const global = await when.dashboardRequest(session, '/stats/global?window=30d')
    then.responseStatus(global, 200)
    then.responseJson(await global.json()).contains('window')
    then.responseStatus(await when.dashboardRequest(session, '/stats/subject/unknown'), 404)

    const recent = await when.dashboardRequest(session, '/admin/subjects/unknown/recent-requests?limit=2')
    then.responseStatus(recent, 200)
    then.responseJson(await recent.json()).contains('requests')
  },
)
