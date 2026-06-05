// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { z } from 'zod'

import { listAuthorizedGroups } from '../../../../src/authorized-groups.js'
import { isScopedContextId, toScopedContextId, toScopedThreadContextId } from '../../../../src/chat/scoped-context.js'
import { handleAdminSystemAccessRoutes } from '../../../../src/debug/settings/admin/system-access-routes.js'
import { addAdmin } from '../../../../src/instances/admin-store.js'
import { addUser, listUsers } from '../../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from '../helpers.js'

const OkResponseSchema = z.object({ ok: z.literal(true) })

describe('settings admin system/access routes', () => {
  let adminSession: SettingsSession
  let userSession: SettingsSession

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'admin-1', platformInstanceId: 'pi-1', addedBy: 'boot', username: undefined })
    addUser({ userId: 'user-1', platformInstanceId: 'pi-1', addedBy: 'admin-1', username: undefined })
    addAdmin('admin-1', 'pi-1')
    adminSession = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'admin-1' })
    userSession = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'user-1' })
  })

  test('GET system returns an LLM snapshot with masked api key', async () => {
    const url = new URL('https://x/settings/api/admin/system')
    const res = await handleAdminSystemAccessRoutes(
      new Request(url, { headers: authHeaders(adminSession) }),
      url,
      '/settings/api/admin/system',
    )
    expect(res.status).toBe(200)
    const body = z.object({ config: z.record(z.string(), z.unknown()) }).parse(await res.json())
    expect(body.config).toBeDefined()
  })

  test('POST users adds an authorized user', async () => {
    const url = new URL('https://x/settings/api/admin/users')
    const res = await handleAdminSystemAccessRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'newbie' }),
      }),
      url,
      '/settings/api/admin/users',
    )
    expect(res.status).toBe(200)
    expect(listUsers('pi-1').some((u) => u.platform_user_id === 'newbie')).toBe(true)
  })

  test('non-admin POST users returns 403', async () => {
    const url = new URL('https://x/settings/api/admin/users')
    const res = await handleAdminSystemAccessRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(userSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'sneaky' }),
      }),
      url,
      '/settings/api/admin/users',
    )
    expect(res.status).toBe(403)
  })

  test('admin POST system without CSRF returns 403', async () => {
    const url = new URL('https://x/settings/api/admin/system')
    const res = await handleAdminSystemAccessRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(adminSession, false), 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'main_model', value: 'gpt-4' }),
      }),
      url,
      '/settings/api/admin/system',
    )
    expect(res.status).toBe(403)
  })

  test('admin POST system with unknown key returns 422', async () => {
    const url = new URL('https://x/settings/api/admin/system')
    const res = await handleAdminSystemAccessRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'nope', value: 'x' }),
      }),
      url,
      '/settings/api/admin/system',
    )
    expect(res.status).toBe(422)
    const body = z.object({ error: z.string() }).parse(await res.json())
    expect(body.error).toBe('invalid request')
  })

  test('admin DELETE users removes the user', async () => {
    const postUrl = new URL('https://x/settings/api/admin/users')
    await handleAdminSystemAccessRoutes(
      new Request(postUrl, {
        method: 'POST',
        headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'to-remove' }),
      }),
      postUrl,
      '/settings/api/admin/users',
    )
    assert(
      listUsers('pi-1').some((u) => u.platform_user_id === 'to-remove'),
      'user should exist before delete',
    )

    const deleteUrl = new URL('https://x/settings/api/admin/users')
    const res = await handleAdminSystemAccessRoutes(
      new Request(deleteUrl, {
        method: 'DELETE',
        headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'to-remove' }),
      }),
      deleteUrl,
      '/settings/api/admin/users',
    )
    expect(res.status).toBe(200)
    OkResponseSchema.parse(await res.json())
    expect(listUsers('pi-1').some((u) => u.platform_user_id === 'to-remove')).toBe(false)
  })

  test('admin GET groups returns 200 with groups array', async () => {
    const url = new URL('https://x/settings/api/admin/groups')
    const res = await handleAdminSystemAccessRoutes(
      new Request(url, { headers: authHeaders(adminSession) }),
      url,
      '/settings/api/admin/groups',
    )
    expect(res.status).toBe(200)
    const body = z.object({ groups: z.array(z.unknown()) }).parse(await res.json())
    expect(Array.isArray(body.groups)).toBe(true)
  })

  test('admin POST groups adds group and GET reflects it', async () => {
    const postUrl = new URL('https://x/settings/api/admin/groups')
    const postRes = await handleAdminSystemAccessRoutes(
      new Request(postUrl, {
        method: 'POST',
        headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId: 'g-1' }),
      }),
      postUrl,
      '/settings/api/admin/groups',
    )
    expect(postRes.status).toBe(200)
    OkResponseSchema.parse(await postRes.json())
    const expected = toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'g-1' })
    const groups = listAuthorizedGroups()
    assert(
      groups.some((g) => g.group_id === expected),
      'group g-1 should be listed (scoped) after POST',
    )
  })

  test('admin DELETE groups removes the group', async () => {
    const scopedDel = toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'g-del' })
    const postUrl = new URL('https://x/settings/api/admin/groups')
    await handleAdminSystemAccessRoutes(
      new Request(postUrl, {
        method: 'POST',
        headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId: 'g-del' }),
      }),
      postUrl,
      '/settings/api/admin/groups',
    )
    assert(
      listAuthorizedGroups().some((g) => g.group_id === scopedDel),
      'group should exist before delete',
    )

    const deleteUrl = new URL('https://x/settings/api/admin/groups')
    const res = await handleAdminSystemAccessRoutes(
      new Request(deleteUrl, {
        method: 'DELETE',
        headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId: scopedDel }),
      }),
      deleteUrl,
      '/settings/api/admin/groups',
    )
    expect(res.status).toBe(200)
    expect(listAuthorizedGroups().some((g) => g.group_id === scopedDel)).toBe(false)
  })

  test('POST groups scopes a raw native id to the admin platform instance', async () => {
    const url = new URL('https://x/settings/api/admin/groups')
    const res = await handleAdminSystemAccessRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId: 'rawchan' }),
      }),
      url,
      '/settings/api/admin/groups',
    )
    expect(res.status).toBe(200)
    const expected = toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'rawchan' })
    expect(listAuthorizedGroups().some((g) => g.group_id === expected)).toBe(true)
  })

  test('POST groups stores an already-scoped id unchanged', async () => {
    const scoped = toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'chan-9' })
    expect(isScopedContextId(scoped)).toBe(true)
    const url = new URL('https://x/settings/api/admin/groups')
    await handleAdminSystemAccessRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId: scoped }),
      }),
      url,
      '/settings/api/admin/groups',
    )
    expect(listAuthorizedGroups().some((g) => g.group_id === scoped)).toBe(true)
  })

  test('POST groups normalizes a thread-scoped id to its main group context', async () => {
    const main = toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'chan-t' })
    const threaded = toScopedThreadContextId({
      platformInstanceId: 'pi-1',
      nativeContextId: 'chan-t',
      threadId: 'topic-1',
    })
    const url = new URL('https://x/settings/api/admin/groups')
    const res = await handleAdminSystemAccessRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId: threaded }),
      }),
      url,
      '/settings/api/admin/groups',
    )
    expect(res.status).toBe(200)
    expect(listAuthorizedGroups().some((g) => g.group_id === main)).toBe(true)
    expect(listAuthorizedGroups().some((g) => g.group_id === threaded)).toBe(false)
  })

  test('POST groups rejects a whitespace-only id with 422', async () => {
    const url = new URL('https://x/settings/api/admin/groups')
    const res = await handleAdminSystemAccessRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId: '   ' }),
      }),
      url,
      '/settings/api/admin/groups',
    )
    expect(res.status).toBe(422)
  })
})
