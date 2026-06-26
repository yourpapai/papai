// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { handleCodingReposRoutes } from '../../../src/debug/settings/coding-repos-routes.js'
import { resolveSettingsPrincipal } from '../../../src/settings/principal.js'
import { addUser } from '../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from './helpers.js'

const PLATFORM_INSTANCE_ID = 'pi-repos-test'
const USER_ID = 'u-repos-1'

const RepoItemSchema = z.object({
  repoId: z.string(),
  name: z.string(),
  repoUrl: z.string(),
  baseBranch: z.string(),
  permissionPreset: z.enum(['autonomous', 'cautious', 'readonly']),
})

const GetResponseSchema = z.object({
  repos: z.array(RepoItemSchema),
})

const PostResponseSchema = z.object({
  ok: z.literal(true),
  repoId: z.string(),
  contextId: z.string(),
})

const DeleteResponseSchema = z.object({
  ok: z.literal(true),
  contextId: z.string(),
})

const ErrorResponseSchema = z.object({ error: z.string() })

function get(path: string, session: SettingsSession): Request {
  return new Request(`https://x${path}`, { headers: authHeaders(session) })
}

function post(path: string, session: SettingsSession, body: unknown): Request {
  return new Request(`https://x${path}`, {
    method: 'POST',
    headers: {
      ...authHeaders(session, true),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

function del(path: string, session: SettingsSession): Request {
  return new Request(`https://x${path}`, {
    method: 'DELETE',
    headers: authHeaders(session, true),
  })
}

describe('coding-repos routes', () => {
  let session: SettingsSession
  let personalConfigContextId: string

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({ id: PLATFORM_INSTANCE_ID })
    addUser({
      userId: USER_ID,
      platformInstanceId: PLATFORM_INSTANCE_ID,
      addedBy: 'admin',
      username: undefined,
    })
    session = await establishSession({
      platformInstanceId: PLATFORM_INSTANCE_ID,
      platformUserId: USER_ID,
    })
    personalConfigContextId = resolveSettingsPrincipal(PLATFORM_INSTANCE_ID, USER_ID).personalConfigContextId
  })

  test('GET returns empty repos list initially', async () => {
    const url = new URL('https://x/settings/api/coding-repos')
    const res = await handleCodingReposRoutes(get('/settings/api/coding-repos', session), url)
    expect(res.status).toBe(200)
    const body = GetResponseSchema.parse(await res.json())
    expect(body.repos).toEqual([])
  })

  test('POST adds a repo and GET lists it', async () => {
    const postUrl = new URL('https://x/settings/api/coding-repos')
    const postRes = await handleCodingReposRoutes(
      post('/settings/api/coding-repos', session, {
        name: 'my-repo',
        repoUrl: 'https://github.com/acme/my-repo.git',
        baseBranch: 'main',
        permissionPreset: 'cautious',
      }),
      postUrl,
    )
    expect(postRes.status).toBe(200)
    const postBody = PostResponseSchema.parse(await postRes.json())
    expect(postBody.ok).toBe(true)
    expect(postBody.contextId).toBe(personalConfigContextId)
    expect(typeof postBody.repoId).toBe('string')

    const getUrl = new URL('https://x/settings/api/coding-repos')
    const getRes = await handleCodingReposRoutes(get('/settings/api/coding-repos', session), getUrl)
    expect(getRes.status).toBe(200)
    const getBody = GetResponseSchema.parse(await getRes.json())
    expect(getBody.repos).toHaveLength(1)
    expect(getBody.repos[0]?.name).toBe('my-repo')
    expect(getBody.repos[0]?.repoUrl).toBe('https://github.com/acme/my-repo.git')
  })

  test('POST rejects non-https url with 422', async () => {
    const url = new URL('https://x/settings/api/coding-repos')
    const res = await handleCodingReposRoutes(
      post('/settings/api/coding-repos', session, {
        name: 'bad',
        repoUrl: 'http://github.com/acme/repo.git',
        baseBranch: 'main',
        permissionPreset: 'cautious',
      }),
      url,
    )
    expect(res.status).toBe(422)
    const body = ErrorResponseSchema.parse(await res.json())
    expect(body.error).toBeTypeOf('string')
  })

  test('POST rejects invalid preset with 422', async () => {
    const url = new URL('https://x/settings/api/coding-repos')
    const res = await handleCodingReposRoutes(
      post('/settings/api/coding-repos', session, {
        name: 'bad',
        repoUrl: 'https://github.com/acme/repo.git',
        baseBranch: 'main',
        permissionPreset: 'bogus',
      }),
      url,
    )
    expect(res.status).toBe(422)
  })

  test('POST rejects empty name with 422', async () => {
    const url = new URL('https://x/settings/api/coding-repos')
    const res = await handleCodingReposRoutes(
      post('/settings/api/coding-repos', session, {
        name: '',
        repoUrl: 'https://github.com/acme/repo.git',
        baseBranch: 'main',
        permissionPreset: 'cautious',
      }),
      url,
    )
    expect(res.status).toBe(422)
  })

  test('DELETE removes a repo', async () => {
    const postUrl = new URL('https://x/settings/api/coding-repos')
    const postRes = await handleCodingReposRoutes(
      post('/settings/api/coding-repos', session, {
        name: 'to-delete',
        repoUrl: 'https://github.com/acme/del.git',
        baseBranch: 'main',
        permissionPreset: 'readonly',
      }),
      postUrl,
    )
    const { repoId } = PostResponseSchema.parse(await postRes.json())

    const delUrl = new URL(`https://x/settings/api/coding-repos?repoId=${repoId}`)
    const delRes = await handleCodingReposRoutes(del(`/settings/api/coding-repos?repoId=${repoId}`, session), delUrl)
    expect(delRes.status).toBe(200)
    const delBody = DeleteResponseSchema.parse(await delRes.json())
    expect(delBody.ok).toBe(true)

    const getUrl = new URL('https://x/settings/api/coding-repos')
    const getRes = await handleCodingReposRoutes(get('/settings/api/coding-repos', session), getUrl)
    const getBody = GetResponseSchema.parse(await getRes.json())
    expect(getBody.repos).toHaveLength(0)
  })

  test('DELETE without repoId returns 400', async () => {
    const url = new URL('https://x/settings/api/coding-repos')
    const res = await handleCodingReposRoutes(del('/settings/api/coding-repos', session), url)
    expect(res.status).toBe(400)
  })

  test('POST to unmanageable context is forbidden', async () => {
    const url = new URL('https://x/settings/api/coding-repos')
    const res = await handleCodingReposRoutes(
      post('/settings/api/coding-repos', session, {
        contextId: 'pi:telegram:ctx:stranger',
        name: 'x',
        repoUrl: 'https://github.com/a/b.git',
        baseBranch: 'main',
        permissionPreset: 'cautious',
      }),
      url,
    )
    expect(res.status).toBe(403)
  })

  test('POST without CSRF returns 403', async () => {
    const url = new URL('https://x/settings/api/coding-repos')
    const req = new Request('https://x/settings/api/coding-repos', {
      method: 'POST',
      headers: {
        ...authHeaders(session, false),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'x',
        repoUrl: 'https://github.com/a/b.git',
        baseBranch: 'main',
        permissionPreset: 'cautious',
      }),
    })
    const res = await handleCodingReposRoutes(req, url)
    expect(res.status).toBe(403)
  })

  test('unauthenticated request returns 401', async () => {
    const url = new URL('https://x/settings/api/coding-repos')
    const res = await handleCodingReposRoutes(new Request(url), url)
    expect(res.status).toBe(401)
  })

  test('unsupported method returns 405', async () => {
    const url = new URL('https://x/settings/api/coding-repos')
    const res = await handleCodingReposRoutes(new Request(url, { method: 'PATCH', headers: authHeaders(session) }), url)
    expect(res.status).toBe(405)
  })

  test('GET with explicit contextId returns that context repos', async () => {
    const postUrl = new URL('https://x/settings/api/coding-repos')
    await handleCodingReposRoutes(
      post('/settings/api/coding-repos', session, {
        name: 'personal-repo',
        repoUrl: 'https://github.com/acme/personal.git',
        baseBranch: 'main',
        permissionPreset: 'autonomous',
      }),
      postUrl,
    )

    const getUrl = new URL(`https://x/settings/api/coding-repos?contextId=${personalConfigContextId}`)
    const getRes = await handleCodingReposRoutes(
      get(`/settings/api/coding-repos?contextId=${personalConfigContextId}`, session),
      getUrl,
    )
    expect(getRes.status).toBe(200)
    const getBody = GetResponseSchema.parse(await getRes.json())
    expect(getBody.repos).toHaveLength(1)
  })
})
