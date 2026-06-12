// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { toScopedContextId } from '../../../src/chat/scoped-context.js'
import {
  authenticate,
  parseJsonBody,
  requireCsrf,
  resolveContextScope,
  settingsJson,
} from '../../../src/debug/settings/respond.js'
import { addAdmin } from '../../../src/instances/admin-store.js'
import { addUser } from '../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../utils/test-helpers.js'
import { authHeaders, establishSession } from './helpers.js'

describe('settings respond helpers', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'u-1', platformInstanceId: 'pi-1', addedBy: 'admin', username: undefined })
  })

  test('settingsJson sets status, JSON content type, and extra headers', async () => {
    const res = settingsJson(422, { error: 'bad' }, { 'X-Test': '1' })
    expect(res.status).toBe(422)
    expect(res.headers.get('Content-Type')).toBe('application/json')
    expect(res.headers.get('X-Test')).toBe('1')
    expect(await res.json()).toEqual({ error: 'bad' })
  })

  test('authenticate returns 401 outcome without a session', () => {
    const out = authenticate(new Request('https://x/settings/api/config'))
    expect(out.ok).toBe(false)
    assert(!out.ok)
    expect(out.response.status).toBe(401)
  })

  test('authenticate succeeds with a valid session', async () => {
    const session = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'u-1' })
    const out = authenticate(new Request('https://x/settings/api/config', { headers: authHeaders(session) }))
    expect(out.ok).toBe(true)
  })

  test('requireCsrf rejects a write missing the header', async () => {
    const session = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'u-1' })
    const out = authenticate(
      new Request('https://x/settings/api/config', { method: 'PATCH', headers: authHeaders(session) }),
    )
    expect(out.ok).toBe(true)
    assert(out.ok)
    const blocked = requireCsrf(
      new Request('https://x/settings/api/config', { method: 'PATCH', headers: authHeaders(session) }),
      out.authed,
    )
    expect(blocked?.status).toBe(403)
  })

  test('parseJsonBody returns ok with parsed value', async () => {
    const req = new Request('https://x', { method: 'POST', body: '{"foo":1}' })
    const result = await parseJsonBody(req)
    expect(result.ok).toBe(true)
    assert(result.ok)
    expect(result.value).toEqual({ foo: 1 })
  })

  test('parseJsonBody returns 400 on malformed JSON', async () => {
    const req = new Request('https://x', { method: 'POST', body: 'not-json' })
    const result = await parseJsonBody(req)
    expect(result.ok).toBe(false)
    assert(!result.ok)
    expect(result.response.status).toBe(400)
  })

  test('requireCsrf returns null when CSRF header is present and valid', async () => {
    const session = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'u-1' })
    const req = new Request('https://x/settings/api/config', { method: 'PATCH', headers: authHeaders(session, true) })
    const out = authenticate(req)
    expect(out.ok).toBe(true)
    assert(out.ok)
    const blocked = requireCsrf(
      new Request('https://x/settings/api/config', { method: 'PATCH', headers: authHeaders(session, true) }),
      out.authed,
    )
    expect(blocked).toBeNull()
  })

  test('resolveContextScope falls back to personal when contextId is omitted', async () => {
    const session = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'u-1' })
    const out = authenticate(new Request('https://x', { headers: authHeaders(session) }))
    expect(out.ok).toBe(true)
    assert(out.ok)
    const scope = resolveContextScope(out.authed.principal, 'read', undefined)
    expect(scope.ok).toBe(true)
    assert(scope.ok)
    expect(scope.scope.kind).toBe('personal')
  })

  test("resolveContextScope: bot admin cannot access another user's personal context via group branch", async () => {
    // Register bot admin user and victim user on the same platform instance.
    addUser({ userId: 'admin-u', platformInstanceId: 'pi-1', addedBy: 'admin', username: undefined })
    addAdmin('admin-u', 'pi-1')
    addUser({ userId: 'victim-u', platformInstanceId: 'pi-1', addedBy: 'admin', username: undefined })

    const victimPersonalCtx = toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'victim-u' })
    const session = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'admin-u' })
    const out = authenticate(new Request('https://x', { headers: authHeaders(session) }))
    expect(out.ok).toBe(true)
    assert(out.ok)

    // The admin's own personalConfigContextId differs from victimPersonalCtx, so
    // resolveContextScope will route this into the group branch and must deny it.
    const scope = resolveContextScope(out.authed.principal, 'read', victimPersonalCtx)
    expect(scope.ok).toBe(false)
    assert(!scope.ok)
    expect(scope.response.status).toBe(403)
  })
})
