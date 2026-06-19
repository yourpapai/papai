// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { MattermostApiError, makeMattermostApiFetch } from '../../../src/chat/mattermost/api-fetch.js'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

describe('makeMattermostApiFetch', () => {
  afterEach(() => {
    restoreFetch()
  })

  test('GET returns parsed JSON and sends bearer auth to baseUrl', async () => {
    const seen: { url: string; auth: string | null } = { url: '', auth: null }
    setMockFetch((url, init) => {
      seen.url = url
      const headers = new Headers(init.headers)
      seen.auth = headers.get('Authorization')
      return Promise.resolve(new Response(JSON.stringify({ id: 'p1' }), { status: 200 }))
    })

    const apiFetch = makeMattermostApiFetch('https://mm.example.com', 'tok-123')
    const result = await apiFetch('GET', '/api/v4/posts/p1', undefined)

    expect(result).toEqual({ id: 'p1' })
    expect(seen.url).toBe('https://mm.example.com/api/v4/posts/p1')
    expect(seen.auth).toBe('Bearer tok-123')
  })

  test('non-2xx throws MattermostApiError carrying the status', async () => {
    setMockFetch(() => Promise.resolve(new Response('nope', { status: 404 })))
    const apiFetch = makeMattermostApiFetch('https://mm.example.com', 'tok')

    const promise = apiFetch('GET', '/api/v4/posts/x', undefined)
    await expect(promise).rejects.toBeInstanceOf(MattermostApiError)
    await expect(promise).rejects.toBeInstanceOf(Error)
    await expect(promise).rejects.toHaveProperty('status', 404)
  })
})
