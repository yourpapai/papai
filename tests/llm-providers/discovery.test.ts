// tests/llm-providers/discovery.test.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { fetchProviderModels } from '../../src/llm-providers/discovery.js'
import { restoreFetch, setMockFetch } from '../utils/test-helpers.js'

const okResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('fetchProviderModels', () => {
  test('verified + models on 200 with {data:[{id}]}', async () => {
    setMockFetch(() => Promise.resolve(okResponse({ data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }] })))
    const r = await fetchProviderModels('https://x/v1', 'sk')
    restoreFetch()
    expect(r.status).toBe('verified')
    expect(r.models).toEqual(['gpt-4o', 'gpt-4o-mini'])
  })

  test('unverified on 401', async () => {
    setMockFetch(() => Promise.resolve(okResponse({ error: 'bad' }, 401)))
    const r = await fetchProviderModels('https://x/v1', 'sk')
    restoreFetch()
    expect(r.status).toBe('unverified')
    expect(r.error).toBe('authentication failed')
  })

  test('error on network failure', async () => {
    setMockFetch(() => Promise.reject(new Error('ECONNREFUSED')))
    const r = await fetchProviderModels('https://x/v1', 'sk')
    restoreFetch()
    expect(r.status).toBe('error')
  })
})
