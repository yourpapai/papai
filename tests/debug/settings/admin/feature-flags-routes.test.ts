// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { toScopedContextId } from '../../../../src/chat/scoped-context.js'
import { handleAdminFeatureFlagsRoutes } from '../../../../src/debug/settings/admin/feature-flags-routes.js'
import { addAdmin, SUPER_ADMIN_PLATFORM_ID } from '../../../../src/instances/admin-store.js'
import { addUser } from '../../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from '../helpers.js'

const URL_PATH = 'http://localhost/settings/api/admin/feature-flags'
const PATHNAME = '/settings/api/admin/feature-flags'
const userCtx = toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'u-1' })
const FLAGS_ON = { result_compaction: true, progressive_disclosure: true, semantic_tool_retrieval: false }

const call = (req: Request): Promise<Response> => handleAdminFeatureFlagsRoutes(req, new URL(req.url), PATHNAME)

describe('settings admin feature-flags routes', () => {
  let superSession: SettingsSession
  let botAdminSession: SettingsSession
  let plainSession: SettingsSession
  const savedKill = process.env['TOOL_CONTEXT_REDUCTION_DISABLED']

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    delete process.env['TOOL_CONTEXT_REDUCTION_DISABLED']
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'sa-1', platformInstanceId: 'pi-1', addedBy: 'boot', username: undefined })
    addUser({ userId: 'ba-1', platformInstanceId: 'pi-1', addedBy: 'boot', username: undefined })
    addUser({ userId: 'u-1', platformInstanceId: 'pi-1', addedBy: 'boot', username: 'alice' })
    addAdmin('sa-1', SUPER_ADMIN_PLATFORM_ID)
    addAdmin('ba-1', 'pi-1')
    superSession = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'sa-1' })
    botAdminSession = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'ba-1' })
    plainSession = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'u-1' })
  })

  afterEach(() => {
    if (savedKill === undefined) delete process.env['TOOL_CONTEXT_REDUCTION_DISABLED']
    else process.env['TOOL_CONTEXT_REDUCTION_DISABLED'] = savedKill
  })

  test('returns 404 for an unrecognized pathname', async () => {
    const res = await handleAdminFeatureFlagsRoutes(
      new Request(URL_PATH, { headers: authHeaders(superSession) }),
      new URL(URL_PATH),
      '/settings/api/admin/other',
    )
    expect(res.status).toBe(404)
  })

  test('GET requires a session', async () => {
    const res = await call(new Request(URL_PATH))
    expect(res.status).toBe(401)
  })

  test('GET rejects plain users and plain bot admins', async () => {
    expect((await call(new Request(URL_PATH, { headers: authHeaders(plainSession) }))).status).toBe(403)
    expect((await call(new Request(URL_PATH, { headers: authHeaders(botAdminSession) }))).status).toBe(403)
  })

  test('GET returns the snapshot for a super admin', async () => {
    const res = await call(new Request(URL_PATH, { headers: authHeaders(superSession) }))
    expect(res.status).toBe(200)
    const body = z
      .object({ killSwitchEngaged: z.boolean(), contexts: z.array(z.object({ contextId: z.string() })) })
      .parse(await res.json())
    expect(body.killSwitchEngaged).toBe(false)
    expect(body.contexts.some((c) => c.contextId === userCtx)).toBe(true)
  })

  test('PATCH requires CSRF', async () => {
    const res = await call(
      new Request(URL_PATH, {
        method: 'PATCH',
        headers: authHeaders(superSession),
        body: JSON.stringify({ contextId: userCtx, flags: FLAGS_ON }),
      }),
    )
    expect(res.status).toBe(403)
  })

  test('PATCH round-trips flags and returns the updated row', async () => {
    const FlagsSchema = z.object({
      result_compaction: z.boolean(),
      progressive_disclosure: z.boolean(),
      semantic_tool_retrieval: z.boolean(),
    })
    const res = await call(
      new Request(URL_PATH, {
        method: 'PATCH',
        headers: authHeaders(superSession, true),
        body: JSON.stringify({ contextId: userCtx, flags: FLAGS_ON }),
      }),
    )
    expect(res.status).toBe(200)
    const row = z.object({ flags: FlagsSchema }).parse(await res.json())
    expect(row.flags).toEqual(FLAGS_ON)
    const after = await call(new Request(URL_PATH, { headers: authHeaders(superSession) }))
    const body = z
      .object({ contexts: z.array(z.object({ contextId: z.string(), flags: FlagsSchema })) })
      .parse(await after.json())
    expect(body.contexts.find((c) => c.contextId === userCtx)?.flags).toEqual(FLAGS_ON)
  })

  test('PATCH rejects a plain bot admin', async () => {
    const res = await call(
      new Request(URL_PATH, {
        method: 'PATCH',
        headers: authHeaders(botAdminSession, true),
        body: JSON.stringify({ contextId: userCtx, flags: FLAGS_ON }),
      }),
    )
    expect(res.status).toBe(403)
  })

  test('PATCH rejects an unknown context with 422', async () => {
    const res = await call(
      new Request(URL_PATH, {
        method: 'PATCH',
        headers: authHeaders(superSession, true),
        body: JSON.stringify({ contextId: 'pi:bogus:ctx:bogus', flags: FLAGS_ON }),
      }),
    )
    expect(res.status).toBe(422)
  })

  test('PATCH rejects a schema-invalid body with 422', async () => {
    const res = await call(
      new Request(URL_PATH, {
        method: 'PATCH',
        headers: authHeaders(superSession, true),
        body: JSON.stringify({ contextId: userCtx, flags: { result_compaction: 'yes' } }),
      }),
    )
    expect(res.status).toBe(422)
  })

  test('GET reflects the kill switch', async () => {
    process.env['TOOL_CONTEXT_REDUCTION_DISABLED'] = 'true'
    const res = await call(new Request(URL_PATH, { headers: authHeaders(superSession) }))
    const body = z.object({ killSwitchEngaged: z.boolean() }).parse(await res.json())
    expect(body.killSwitchEngaged).toBe(true)
  })

  test('PUT is not allowed', async () => {
    const res = await call(new Request(URL_PATH, { method: 'PUT', headers: authHeaders(superSession, true) }))
    expect(res.status).toBe(405)
  })

  test('POST is not allowed', async () => {
    const res = await call(new Request(URL_PATH, { method: 'POST', headers: authHeaders(superSession, true) }))
    expect(res.status).toBe(405)
  })
})
