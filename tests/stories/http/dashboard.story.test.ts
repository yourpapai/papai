// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

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
