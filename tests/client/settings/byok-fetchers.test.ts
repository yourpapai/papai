// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { fetchAdminByok } from '../../../client/settings/admin-fetchers.js'
import { fetchByok, patchByok, setCsrfToken, toggleByok } from '../../../client/settings/fetchers.js'
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
    captured.push({ url, init })
    return Promise.resolve(json(payload))
  })
}

const parseBody = (body: BodyInit | null | undefined): unknown => (typeof body === 'string' ? JSON.parse(body) : null)
const methodOf = (init: RequestInit): string => (init.method ?? 'GET').toUpperCase()

describe('BYOK fetchers', () => {
  test('fetchByok encodes contextId in the query string', async () => {
    installFetch({ enabled: false, complete: false, missing: [], fields: [] })

    const result = await fetchByok('ctx:space/name')

    expect(result.enabled).toBe(false)
    expect(captured[0]?.url).toBe('/settings/api/byok?contextId=ctx%3Aspace%2Fname')
  })

  test('patchByok PATCHes context values as JSON', async () => {
    installFetch({ ok: true })

    await patchByok({ contextId: 'ctx-1', values: { main_model: 'gpt', llm_baseurl: 'https://llm.invalid/v1' } })

    expect(methodOf(captured[0]!.init)).toBe('PATCH')
    expect(captured[0]?.url).toBe('/settings/api/byok')
    expect(parseBody(captured[0]?.init.body)).toEqual({
      contextId: 'ctx-1',
      values: { main_model: 'gpt', llm_baseurl: 'https://llm.invalid/v1' },
    })
  })

  test('fetchAdminByok GETs admin BYOK summaries', async () => {
    installFetch({ contexts: [] })

    const result = await fetchAdminByok()

    expect(result.contexts).toEqual([])
    expect(captured[0]?.url).toBe('/settings/api/admin/byok')
    expect(methodOf(captured[0]!.init)).toBe('GET')
  })

  test('toggleByok PATCHes an enable action as JSON', async () => {
    installFetch({ ok: true, contextId: 'ctx-1', enabled: true })

    await toggleByok({ contextId: 'ctx-1', enabled: true })

    expect(methodOf(captured[0]!.init)).toBe('PATCH')
    expect(captured[0]?.url).toBe('/settings/api/byok')
    expect(parseBody(captured[0]?.init.body)).toEqual({ contextId: 'ctx-1', action: 'enable' })
  })

  test('toggleByok PATCHes a disable action as JSON', async () => {
    installFetch({ ok: true, contextId: 'ctx-1', enabled: false })

    await toggleByok({ contextId: 'ctx-1', enabled: false })

    expect(parseBody(captured[0]?.init.body)).toEqual({ contextId: 'ctx-1', action: 'disable' })
  })
})
