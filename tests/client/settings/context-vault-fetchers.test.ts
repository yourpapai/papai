// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  createVaultToken,
  fetchVaultTokens,
  revokeVaultToken,
} from '../../../client/settings/context-vault-fetchers.js'
import { setCsrfToken } from '../../../client/settings/fetchers.js'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

type CapturedFetchCall = Readonly<{ url: string; init: RequestInit }>

const captured: CapturedFetchCall[] = []

beforeEach(() => {
  captured.length = 0
})

afterEach(() => {
  restoreFetch()
  setCsrfToken('')
})

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })

const installFetch = (payload: unknown): void => {
  setMockFetch((url, init) => {
    captured.push({ url, init: init ?? {} })
    return Promise.resolve(json(payload))
  })
}

const lastRequest = (): CapturedFetchCall => {
  const last = captured[captured.length - 1]
  if (last === undefined) throw new Error('No requests captured')
  return last
}

const parseBody = (body: BodyInit | null | undefined): unknown => (typeof body === 'string' ? JSON.parse(body) : null)
const methodOf = (init: RequestInit): string => (init.method ?? 'GET').toUpperCase()

const tokensPayload = {
  tokens: [{ tokenId: 't1', label: 'laptop indexer', createdAt: 1, lastUsedAt: null, revokedAt: null }],
}

describe('context-vault fetchers', () => {
  test('fetchVaultTokens GETs the tokens endpoint with contextId and parses', async () => {
    installFetch(tokensPayload)
    const res = await fetchVaultTokens('pi:telegram:ctx:u1')
    expect(captured[0]?.url).toContain('/settings/api/context-vault/tokens?contextId=pi%3Atelegram%3Actx%3Au1')
    expect(res.tokens).toHaveLength(1)
    expect(res.tokens[0]?.label).toBe('laptop indexer')
  })

  test('createVaultToken POSTs label and contextId and returns the plaintext-once payload', async () => {
    installFetch({ ok: true, tokenId: 't-new', plaintext: 'cv-secret', contextId: 'pi:telegram:ctx:u1' })
    const res = await createVaultToken({ contextId: 'pi:telegram:ctx:u1', label: 'ci indexer' })
    const req = lastRequest()
    expect(req.url).toContain('/settings/api/context-vault/tokens')
    expect(methodOf(req.init)).toBe('POST')
    expect(parseBody(req.init.body)).toMatchObject({ contextId: 'pi:telegram:ctx:u1', label: 'ci indexer' })
    expect(res.plaintext).toBe('cv-secret')
  })

  test('revokeVaultToken issues DELETE with tokenId and contextId query params', async () => {
    installFetch({ ok: true, contextId: 'pi:telegram:ctx:u1' })
    await revokeVaultToken({ contextId: 'pi:telegram:ctx:u1', tokenId: 't1' })
    const req = lastRequest()
    expect(methodOf(req.init)).toBe('DELETE')
    expect(req.url).toContain('tokenId=t1')
    expect(req.url).toContain('contextId=pi%3Atelegram%3Actx%3Au1')
  })

  test('fetchVaultTokens rejects on a non-OK response', async () => {
    setMockFetch(() => Promise.resolve(new Response('{"error":"boom"}', { status: 500 })))
    await expect(fetchVaultTokens('pi:telegram:ctx:u1')).rejects.toThrow()
  })
})
