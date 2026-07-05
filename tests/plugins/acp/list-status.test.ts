// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

import { writeRecord } from '../../../plugins/acp/history.js'
import { activate, jsonResponse, options, runtimeCtx, runtimeCtxWithKv } from './support.js'

type HttpFetch = (url: string, init?: RequestInit) => Promise<Response>

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value))
  return {}
}

function asRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map((row: unknown): Record<string, unknown> => asRecord(row)) : []
}

function readStoredRecord(store: Map<string, string>, sessionId: string): Record<string, unknown> {
  const raw = store.get(`session:${sessionId}`)
  const parsed: unknown = raw === undefined ? {} : JSON.parse(raw)
  return asRecord(parsed)
}

const doneListFetch: HttpFetch = (url) => {
  if (url.includes('/sessions?filter=done'))
    return Promise.resolve(
      jsonResponse([{ id: 's-7', project: 'demo', status: 'done', prUrl: 'https://github.com/a/b/pull/12' }], 200),
    )
  return Promise.resolve(jsonResponse({ error: 'unexpected' }, 500))
}

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
    const { tools } = activate(httpFetch)
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
    const { tools } = activate(httpFetch)
    await tools.get('list_sessions')!.execute({ filter: 'waiting' }, runtimeCtxWithKv(store), options())
    expect(seenUrl).toContain('filter=waiting')
  })

  test('invalid filter returns invalid_input without calling httpFetch', async () => {
    const httpFetch = mock((): Promise<Response> => Promise.resolve(jsonResponse([])))
    const store = new Map<string, string>()
    const { tools } = activate(httpFetch)
    const result = await tools.get('list_sessions')!.execute({ filter: 'bogus' }, runtimeCtxWithKv(store), options())
    expect(result).toHaveProperty('error', 'invalid_input')
    expect(result).toHaveProperty('message', expect.stringContaining('filter'))
    expect(httpFetch).not.toHaveBeenCalled()
  })

  test('not configured returns not_configured without calling httpFetch', async () => {
    const httpFetch = mock((): Promise<Response> => Promise.resolve(jsonResponse([])))
    const store = new Map<string, string>()
    const { tools } = activate(httpFetch)
    const result = await tools.get('list_sessions')!.execute(
      {},
      runtimeCtxWithKv(store, () => undefined),
      options(),
    )
    expect(result).toEqual({ error: 'not_configured', message: 'magi base URL or token is not configured' })
    expect(httpFetch).not.toHaveBeenCalled()
  })

  test('merges local title and prNumber into magi rows', async () => {
    const store = new Map<string, string>()
    writeRecord(runtimeCtxWithKv(store).kv, 's-7', { project: 'demo', title: 'Add a health check', createdAt: 'x' })
    const { tools } = activate(doneListFetch)
    const result = await tools.get('list_sessions')!.execute({ filter: 'done' }, runtimeCtxWithKv(store), options())
    const out = asRows(result)
    expect(out).toHaveLength(1)
    expect(out[0]!['title']).toBe('Add a health check')
    expect(out[0]!['prNumber']).toBe(12)
    const refreshed = readStoredRecord(store, 's-7')
    expect(refreshed['prNumber']).toBe(12)
  })

  test('includes transcriptUrl from the local record when present', async () => {
    const store = new Map<string, string>()
    writeRecord(runtimeCtxWithKv(store).kv, 's-7', {
      project: 'demo',
      title: 'Add a health check',
      createdAt: 'x',
      transcriptUrl: 'https://papai.example/t/tok_z',
    })
    const { tools } = activate(doneListFetch)
    const result = await tools.get('list_sessions')!.execute({ filter: 'done' }, runtimeCtxWithKv(store), options())
    const out = asRows(result)
    expect(out).toHaveLength(1)
    expect(out[0]!['transcriptUrl']).toBe('https://papai.example/t/tok_z')
  })

  test('omits transcriptUrl when the local record has none', async () => {
    const store = new Map<string, string>()
    writeRecord(runtimeCtxWithKv(store).kv, 's-7', { project: 'demo', title: 'Add a health check', createdAt: 'x' })
    const { tools } = activate(doneListFetch)
    const result = await tools.get('list_sessions')!.execute({ filter: 'done' }, runtimeCtxWithKv(store), options())
    const out = asRows(result)
    expect(out).toHaveLength(1)
    expect(out[0]).not.toHaveProperty('transcriptUrl')
  })
})

describe('acp session_status tool', () => {
  test('GETs /sessions/:id and returns the magi body', async () => {
    let seenUrl = ''
    const httpFetch: HttpFetch = (url) => {
      seenUrl = url
      return Promise.resolve(jsonResponse({ id: 's-1', status: 'running', output: 'done' }))
    }
    const { tools } = activate(httpFetch)
    const result = await tools.get('session_status')!.execute({ sessionId: 's-1' }, runtimeCtx(), options())
    expect(seenUrl).toBe('http://magi:8787/sessions/s-1')
    expect(result).toEqual({ id: 's-1', status: 'running', output: 'done' })
  })

  test('missing sessionId returns invalid_input without calling httpFetch', async () => {
    const httpFetch = mock((): Promise<Response> => Promise.resolve(jsonResponse({})))
    const { tools } = activate(httpFetch)
    const result = await tools.get('session_status')!.execute({}, runtimeCtx(), options())
    expect(result).toEqual({ error: 'invalid_input', message: 'sessionId is required' })
    expect(httpFetch).not.toHaveBeenCalled()
  })

  test('not configured returns not_configured without calling httpFetch', async () => {
    const httpFetch = mock((): Promise<Response> => Promise.resolve(jsonResponse({})))
    const { tools } = activate(httpFetch)
    const result = await tools.get('session_status')!.execute(
      { sessionId: 's-1' },
      runtimeCtx(() => undefined),
      options(),
    )
    expect(result).toEqual({ error: 'not_configured', message: 'magi base URL or token is not configured' })
    expect(httpFetch).not.toHaveBeenCalled()
  })
})
