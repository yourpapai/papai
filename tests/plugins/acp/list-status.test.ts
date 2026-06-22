// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

import { activate, jsonResponse, options, runtimeCtx, runtimeCtxWithKv } from './support.js'

type HttpFetch = (url: string, init?: RequestInit) => Promise<Response>

describe('acp list_sessions tool', () => {
  test('filters to kv-known sessions only, default filter=active', async () => {
    let seenUrl = ''
    const httpFetch: HttpFetch = (url) => {
      seenUrl = url
      return Promise.resolve(
        jsonResponse([
          { id: 's-1', status: 'running' },
          { id: 's-2', status: 'running' },
        ]),
      )
    }
    const store = new Map<string, string>()
    store.set('session:s-1', '1')
    const tools = activate(httpFetch)
    const result = await tools.get('list_sessions')!.execute({}, runtimeCtxWithKv(store), options())
    expect(seenUrl).toContain('filter=active')
    expect(result).toEqual([{ id: 's-1', status: 'running' }])
  })

  test('explicit filter is forwarded in the URL', async () => {
    let seenUrl = ''
    const httpFetch: HttpFetch = (url) => {
      seenUrl = url
      return Promise.resolve(jsonResponse([]))
    }
    const store = new Map<string, string>()
    const tools = activate(httpFetch)
    await tools.get('list_sessions')!.execute({ filter: 'waiting' }, runtimeCtxWithKv(store), options())
    expect(seenUrl).toContain('filter=waiting')
  })

  test('invalid filter returns invalid_input without calling httpFetch', async () => {
    const httpFetch = mock((): Promise<Response> => Promise.resolve(jsonResponse([])))
    const store = new Map<string, string>()
    const tools = activate(httpFetch)
    const result = await tools.get('list_sessions')!.execute({ filter: 'bogus' }, runtimeCtxWithKv(store), options())
    expect(result).toHaveProperty('error', 'invalid_input')
    expect(result).toHaveProperty('message', expect.stringContaining('filter'))
    expect(httpFetch).not.toHaveBeenCalled()
  })

  test('not configured returns not_configured without calling httpFetch', async () => {
    const httpFetch = mock((): Promise<Response> => Promise.resolve(jsonResponse([])))
    const store = new Map<string, string>()
    const tools = activate(httpFetch)
    const result = await tools.get('list_sessions')!.execute(
      {},
      runtimeCtxWithKv(store, () => undefined),
      options(),
    )
    expect(result).toEqual({ error: 'not_configured', message: 'magi base URL or token is not configured' })
    expect(httpFetch).not.toHaveBeenCalled()
  })
})

describe('acp session_status tool', () => {
  test('GETs /sessions/:id and returns the magi body', async () => {
    let seenUrl = ''
    const httpFetch: HttpFetch = (url) => {
      seenUrl = url
      return Promise.resolve(jsonResponse({ id: 's-1', status: 'running', output: 'done' }))
    }
    const tools = activate(httpFetch)
    const result = await tools.get('session_status')!.execute({ sessionId: 's-1' }, runtimeCtx(), options())
    expect(seenUrl).toBe('http://magi:8787/sessions/s-1')
    expect(result).toEqual({ id: 's-1', status: 'running', output: 'done' })
  })

  test('missing sessionId returns invalid_input without calling httpFetch', async () => {
    const httpFetch = mock((): Promise<Response> => Promise.resolve(jsonResponse({})))
    const tools = activate(httpFetch)
    const result = await tools.get('session_status')!.execute({}, runtimeCtx(), options())
    expect(result).toEqual({ error: 'invalid_input', message: 'sessionId is required' })
    expect(httpFetch).not.toHaveBeenCalled()
  })

  test('not configured returns not_configured without calling httpFetch', async () => {
    const httpFetch = mock((): Promise<Response> => Promise.resolve(jsonResponse({})))
    const tools = activate(httpFetch)
    const result = await tools.get('session_status')!.execute(
      { sessionId: 's-1' },
      runtimeCtx(() => undefined),
      options(),
    )
    expect(result).toEqual({ error: 'not_configured', message: 'magi base URL or token is not configured' })
    expect(httpFetch).not.toHaveBeenCalled()
  })
})
