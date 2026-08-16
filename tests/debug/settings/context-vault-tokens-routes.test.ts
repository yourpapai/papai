// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { handleContextVaultTokensRoutes } from '../../../src/debug/settings/context-vault-tokens-routes.js'
import { resolveSettingsPrincipal } from '../../../src/settings/principal.js'
import { addUser } from '../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from './helpers.js'

const PLATFORM_INSTANCE_ID = 'pi-vault-test'
const USER_ID = 'u-vault-1'
const ROUTE = '/settings/api/context-vault/tokens'

const TokenItemSchema = z
  .object({
    tokenId: z.string(),
    label: z.string(),
    createdAt: z.number(),
    lastUsedAt: z.number().nullable(),
    revokedAt: z.number().nullable(),
  })
  .strict()

const GetResponseSchema = z.object({
  tokens: z.array(TokenItemSchema),
})

const PostResponseSchema = z.object({
  ok: z.literal(true),
  tokenId: z.string(),
  plaintext: z.string(),
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

describe('context-vault tokens routes', () => {
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

  test('GET returns an empty tokens list initially', async () => {
    const url = new URL(`https://x${ROUTE}`)
    const res = await handleContextVaultTokensRoutes(get(ROUTE, session), url)
    expect(res.status).toBe(200)
    const body = GetResponseSchema.parse(await res.json())
    expect(body.tokens).toEqual([])
  })

  test('POST creates a token and returns the plaintext exactly once', async () => {
    const postUrl = new URL(`https://x${ROUTE}`)
    const postRes = await handleContextVaultTokensRoutes(post(ROUTE, session, { label: 'laptop indexer' }), postUrl)
    expect(postRes.status).toBe(200)
    const postBody = PostResponseSchema.parse(await postRes.json())
    expect(postBody.contextId).toBe(personalConfigContextId)
    expect(postBody.plaintext).toMatch(/^[0-9a-f]{64}$/u)

    const getUrl = new URL(`https://x${ROUTE}`)
    const getRes = await handleContextVaultTokensRoutes(get(ROUTE, session), getUrl)
    const getBody = GetResponseSchema.parse(await getRes.json())
    expect(getBody.tokens).toHaveLength(1)
    expect(getBody.tokens[0]?.tokenId).toBe(postBody.tokenId)
    expect(getBody.tokens[0]?.label).toBe('laptop indexer')
    expect(getBody.tokens[0]?.revokedAt).toBeNull()
  })

  test('DELETE revokes a token', async () => {
    const postUrl = new URL(`https://x${ROUTE}`)
    const postRes = await handleContextVaultTokensRoutes(post(ROUTE, session, { label: 'to-revoke' }), postUrl)
    const { tokenId } = PostResponseSchema.parse(await postRes.json())

    const delUrl = new URL(`https://x${ROUTE}?tokenId=${tokenId}`)
    const delRes = await handleContextVaultTokensRoutes(del(`${ROUTE}?tokenId=${tokenId}`, session), delUrl)
    expect(delRes.status).toBe(200)
    const delBody = DeleteResponseSchema.parse(await delRes.json())
    expect(delBody.ok).toBe(true)

    const getUrl = new URL(`https://x${ROUTE}`)
    const getRes = await handleContextVaultTokensRoutes(get(ROUTE, session), getUrl)
    const getBody = GetResponseSchema.parse(await getRes.json())
    expect(getBody.tokens[0]?.revokedAt).not.toBeNull()
  })

  test('DELETE without tokenId returns 400', async () => {
    const url = new URL(`https://x${ROUTE}`)
    const res = await handleContextVaultTokensRoutes(del(ROUTE, session), url)
    expect(res.status).toBe(400)
    ErrorResponseSchema.parse(await res.json())
  })

  test('DELETE an unknown tokenId returns 404', async () => {
    const url = new URL(`https://x${ROUTE}?tokenId=no-such-token`)
    const res = await handleContextVaultTokensRoutes(del(`${ROUTE}?tokenId=no-such-token`, session), url)
    expect(res.status).toBe(404)
    ErrorResponseSchema.parse(await res.json())
  })

  test('POST without CSRF returns 403', async () => {
    const url = new URL(`https://x${ROUTE}`)
    const req = new Request(`https://x${ROUTE}`, {
      method: 'POST',
      headers: {
        ...authHeaders(session, false),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ label: 'x' }),
    })
    const res = await handleContextVaultTokensRoutes(req, url)
    expect(res.status).toBe(403)
  })

  test('unauthenticated request returns 401', async () => {
    const url = new URL(`https://x${ROUTE}`)
    const res = await handleContextVaultTokensRoutes(new Request(url), url)
    expect(res.status).toBe(401)
  })

  test('unsupported method returns 405', async () => {
    const url = new URL(`https://x${ROUTE}`)
    const res = await handleContextVaultTokensRoutes(
      new Request(url, { method: 'PATCH', headers: authHeaders(session) }),
      url,
    )
    expect(res.status).toBe(405)
  })

  test('POST to an unmanageable context is forbidden', async () => {
    const url = new URL(`https://x${ROUTE}`)
    const res = await handleContextVaultTokensRoutes(
      post(ROUTE, session, { contextId: 'pi:telegram:ctx:stranger', label: 'x' }),
      url,
    )
    expect(res.status).toBe(403)
  })

  test('POST with a missing label returns 422', async () => {
    const url = new URL(`https://x${ROUTE}`)
    const res = await handleContextVaultTokensRoutes(post(ROUTE, session, {}), url)
    expect(res.status).toBe(422)
    ErrorResponseSchema.parse(await res.json())
  })

  test('POST with an empty label returns 422', async () => {
    const url = new URL(`https://x${ROUTE}`)
    const res = await handleContextVaultTokensRoutes(post(ROUTE, session, { label: '' }), url)
    expect(res.status).toBe(422)
  })

  test('POST with an unexpected field returns 422', async () => {
    const url = new URL(`https://x${ROUTE}`)
    const res = await handleContextVaultTokensRoutes(post(ROUTE, session, { label: 'x', tokenHash: 'spoof' }), url)
    expect(res.status).toBe(422)
  })

  test('GET with explicit contextId returns that context tokens', async () => {
    const postUrl = new URL(`https://x${ROUTE}`)
    await handleContextVaultTokensRoutes(post(ROUTE, session, { label: 'personal token' }), postUrl)

    const path = `${ROUTE}?contextId=${personalConfigContextId}`
    const getUrl = new URL(`https://x${path}`)
    const getRes = await handleContextVaultTokensRoutes(get(path, session), getUrl)
    expect(getRes.status).toBe(200)
    const getBody = GetResponseSchema.parse(await getRes.json())
    expect(getBody.tokens).toHaveLength(1)
  })
})
