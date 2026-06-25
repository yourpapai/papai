// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { fetchCodingCredentials, patchCodingCredentials, setCsrfToken } from '../../../client/settings/fetchers.js'
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
})
