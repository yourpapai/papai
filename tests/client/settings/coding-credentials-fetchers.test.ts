// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  clearCodingCredentials,
  fetchCodingCredentials,
  patchCodingCredentials,
} from '../../../client/settings/coding-credentials-fetchers.js'
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

/** Alias matching the plan's naming convention for new tests. */
const installFetchStub = installFetch

/** Returns the most recently captured request. */
const lastRequest = (): CapturedFetchCall => {
  const last = captured[captured.length - 1]
  if (last === undefined) throw new Error('No requests captured')
  return last
}

const parseBody = (body: BodyInit | null | undefined): unknown => (typeof body === 'string' ? JSON.parse(body) : null)
const methodOf = (init: RequestInit): string => (init.method ?? 'GET').toUpperCase()

describe('coding credentials fetchers', () => {
  test('fetchCodingCredentials GETs the namespaced endpoint and parses', async () => {
    installFetch({
      namespace: 'agent-provider',
      configured: false,
      complete: false,
      missing: ['provider_api_key'],
      fields: [
        {
          key: 'provider_api_key',
          label: 'Anthropic API Key',
          required: true,
          sensitive: true,
          hasValue: false,
          value: '',
        },
      ],
    })
    const res = await fetchCodingCredentials('pi:telegram:ctx:u1')
    expect(res.configured).toBe(false)
    expect(captured[0]?.url).toContain('/settings/api/coding-credentials?contextId=pi%3Atelegram%3Actx%3Au1')
    expect(methodOf(captured[0]!.init)).toBe('GET')
  })

  test('patchCodingCredentials PATCHes values as JSON', async () => {
    installFetch({ ok: true })
    await patchCodingCredentials({ contextId: 'pi:telegram:ctx:u1', values: { provider_api_key: 'sk-1' } })
    expect(methodOf(captured[0]!.init)).toBe('PATCH')
    expect(captured[0]?.url).toBe('/settings/api/coding-credentials')
    expect(parseBody(captured[0]?.init.body)).toEqual({
      contextId: 'pi:telegram:ctx:u1',
      values: { provider_api_key: 'sk-1' },
    })
  })

  test('fetchCodingCredentials sends namespace; patch includes it', async () => {
    installFetchStub({
      namespace: 'forge',
      configured: false,
      complete: false,
      missing: ['forge_token'],
      fields: [
        { key: 'forge_token', label: 'Code-host token', required: true, sensitive: true, hasValue: false, value: '' },
      ],
    })
    await fetchCodingCredentials('pi:telegram:ctx:u1', 'forge')
    expect(lastRequest().url).toContain('namespace=forge')

    installFetchStub({ ok: true })
    await patchCodingCredentials({
      contextId: 'pi:telegram:ctx:u1',
      namespace: 'forge',
      values: { forge_token: 'ghp_1' },
    })
    expect(parseBody(lastRequest().init.body)).toMatchObject({ namespace: 'forge' })
  })

  test('clearCodingCredentials PATCHes clear:true for the default namespace', async () => {
    installFetch({ ok: true })
    await clearCodingCredentials({ contextId: 'pi:telegram:ctx:u1' })
    expect(methodOf(captured[0]!.init)).toBe('PATCH')
    expect(captured[0]?.url).toBe('/settings/api/coding-credentials')
    expect(parseBody(captured[0]?.init.body)).toEqual({ contextId: 'pi:telegram:ctx:u1', clear: true })
  })

  test('clearCodingCredentials includes namespace for forge', async () => {
    installFetch({ ok: true })
    await clearCodingCredentials({ contextId: 'pi:telegram:ctx:u1', namespace: 'forge' })
    expect(parseBody(lastRequest().init.body)).toEqual({
      contextId: 'pi:telegram:ctx:u1',
      namespace: 'forge',
      clear: true,
    })
  })
})
