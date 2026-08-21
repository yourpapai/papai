// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { scenario } from '../harness/scenario.js'

scenario(
  'SCN-http-auth-claim: a single-use code exchanges for a session that authorizes reads',
  async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    const session = await given.settingsSession(alice)

    // The minted session authorizes an authenticated settings read; anonymous callers are rejected.
    const authorized = await when.settingsRequest(session, '/settings/api/bootstrap')
    then.responseStatus(authorized, 200)
    const anonymous = await when.request('/settings/api/bootstrap')
    then.responseStatus(anonymous, 401)

    // A code cannot be replayed: the first exchange succeeds, the second is rejected.
    const principal = { platformInstanceId: alice.platformInstanceId, platformUserId: alice.id }
    const code = world.fixtures.issueSettingsAuthCode(principal, world.clock.now().getTime())
    const first = await when.request('/settings/auth/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
    then.responseStatus(first, 200)
    then.responseJson(await first.json()).contains('csrfToken')
    const replay = await when.request('/settings/auth/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
    then.responseStatus(replay, 401)
  },
)

scenario(
  'SCN-http-settings-auth-validation: malformed exchanges and invalid logout sessions are rejected',
  async ({ given, when, then }) => {
    const alice = given.user('alice')
    const session = await given.settingsSession(alice)

    const malformed = await when.request('/settings/auth/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not valid json',
    })
    then.responseStatus(malformed, 400)
    const missingCode = await when.request('/settings/auth/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    then.responseStatus(missingCode, 400)
    then.responseStatus(await when.request('/settings/auth/exchange'), 405)

    const csrfRejected = await when.settingsRequest(
      session,
      '/settings/auth/logout',
      { method: 'POST' },
      { csrf: false },
    )
    then.responseStatus(csrfRejected, 403)

    const logout = await when.settingsRequest(session, '/settings/auth/logout', { method: 'POST' })
    then.responseStatus(logout, 200)
    then.responseStatus(await when.settingsRequest(session, '/settings/api/bootstrap'), 401)
    then.responseStatus(await when.request('/settings/auth/logout', { method: 'POST' }), 401)
  },
)
