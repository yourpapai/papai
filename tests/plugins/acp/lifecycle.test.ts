// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

import { activate, jsonResponse, options, runtimeCtx } from './support.js'

type HttpFetch = (url: string, init?: RequestInit) => Promise<Response>

function bodyString(init: RequestInit | undefined): string {
  const b = init?.body
  return typeof b === 'string' ? b : ''
}

function parsedBody(init: RequestInit | undefined): unknown {
  const s = bodyString(init)
  return s === '' ? null : JSON.parse(s)
}

// Module-scope helpers defined outside test blocks to satisfy no-conditional-in-test.

// Returns [fetch, postCallsRef] — fetch records calls to /permission into the postCallsRef array
// and routes GET /permissions → permissionsBody, POST /permission → { resolved: true }.
// Each call creates a fresh Response to avoid body-already-used errors on concurrent reads.
function makePermissionFetch(permissionsBody: unknown): [HttpFetch, Array<{ url: string; body: unknown }>] {
  const postCalls: Array<{ url: string; body: unknown }> = []
  const permissionsJson = JSON.stringify(permissionsBody)
  const routes: Array<readonly [string, (b: unknown) => Response]> = [
    [
      'http://magi:8787/sessions/s-1/permissions',
      (): Response => new Response(permissionsJson, { status: 200, headers: { 'Content-Type': 'application/json' } }),
    ],
    [
      'http://magi:8787/sessions/s-1/permission',
      (b: unknown): Response => {
        postCalls.push({ url: 'http://magi:8787/sessions/s-1/permission', body: b })
        return new Response('{"resolved":true}', { status: 200, headers: { 'Content-Type': 'application/json' } })
      },
    ],
  ]
  const routeMap = new Map(routes)
  const fetch: HttpFetch = (url: string, init?: RequestInit): Promise<Response> => {
    const body = parsedBody(init)
    const handler = routeMap.get(url)
    return Promise.resolve(handler ? handler(body) : jsonResponse(null, 404))
  }
  return [fetch, postCalls]
}

describe('acp finish_session tool', () => {
  test('POSTs /sessions/:id/finish with defaulted message and action=pr, returns magi body', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = []
    const httpFetch: HttpFetch = (url, init) => {
      calls.push({ url, init })
      return Promise.resolve(jsonResponse({ merged: true }))
    }
    const { tools } = activate(httpFetch)
    const result = await tools
      .get('finish_session')!
      .execute({ sessionId: 's-1', action: 'pr' }, runtimeCtx(), options())
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('http://magi:8787/sessions/s-1/finish')
    expect(parsedBody(calls[0]!.init)).toEqual({
      message: 'Apply changes from magi coding session',
      action: 'pr',
    })
    expect(result).toEqual({ merged: true })
  })

  test('explicit message, title, body are forwarded', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = []
    const httpFetch: HttpFetch = (url, init) => {
      calls.push({ url, init })
      return Promise.resolve(jsonResponse({ merged: true }))
    }
    const { tools } = activate(httpFetch)
    await tools
      .get('finish_session')!
      .execute(
        { sessionId: 's-1', action: 'pr', message: 'my commit', title: 'My PR', body: 'Some body text' },
        runtimeCtx(),
        options(),
      )
    expect(parsedBody(calls[0]!.init)).toEqual({
      message: 'my commit',
      action: 'pr',
      title: 'My PR',
      body: 'Some body text',
    })
  })

  test('missing sessionId returns invalid_input, httpFetch not called', async () => {
    const httpFetch = mock((): Promise<Response> => Promise.resolve(jsonResponse({})))
    const { tools } = activate(httpFetch)
    const result = await tools.get('finish_session')!.execute({ action: 'pr' }, runtimeCtx(), options())
    expect(result).toHaveProperty('error', 'invalid_input')
    expect(httpFetch).not.toHaveBeenCalled()
  })

  test('action not in push|pr returns invalid_input, httpFetch not called', async () => {
    const httpFetch = mock((): Promise<Response> => Promise.resolve(jsonResponse({})))
    const { tools } = activate(httpFetch)
    const result = await tools
      .get('finish_session')!
      .execute({ sessionId: 's-1', action: 'squash' }, runtimeCtx(), options())
    expect(result).toHaveProperty('error', 'invalid_input')
    expect(httpFetch).not.toHaveBeenCalled()
  })

  test('not configured returns not_configured without calling httpFetch', async () => {
    const httpFetch = mock((): Promise<Response> => Promise.resolve(jsonResponse({})))
    const { tools } = activate(httpFetch)
    const result = await tools.get('finish_session')!.execute(
      { sessionId: 's-1', action: 'push' },
      runtimeCtx(() => undefined),
      options(),
    )
    expect(result).toEqual({ error: 'not_configured', message: 'magi base URL or token is not configured' })
    expect(httpFetch).not.toHaveBeenCalled()
  })
})

describe('acp cancel_session tool', () => {
  test('POSTs /sessions/:id/cancel and returns magi body', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = []
    const httpFetch: HttpFetch = (url, init) => {
      calls.push({ url, init })
      return Promise.resolve(jsonResponse({ cancelled: true }))
    }
    const { tools } = activate(httpFetch)
    const result = await tools.get('cancel_session')!.execute({ sessionId: 's-1' }, runtimeCtx(), options())
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('http://magi:8787/sessions/s-1/cancel')
    expect(result).toEqual({ cancelled: true })
  })

  test('missing sessionId returns invalid_input, httpFetch not called', async () => {
    const httpFetch = mock((): Promise<Response> => Promise.resolve(jsonResponse({})))
    const { tools } = activate(httpFetch)
    const result = await tools.get('cancel_session')!.execute({}, runtimeCtx(), options())
    expect(result).toHaveProperty('error', 'invalid_input')
    expect(httpFetch).not.toHaveBeenCalled()
  })

  test('not configured returns not_configured without calling httpFetch', async () => {
    const httpFetch = mock((): Promise<Response> => Promise.resolve(jsonResponse({})))
    const { tools } = activate(httpFetch)
    const result = await tools.get('cancel_session')!.execute(
      { sessionId: 's-1' },
      runtimeCtx(() => undefined),
      options(),
    )
    expect(result).toEqual({ error: 'not_configured', message: 'magi base URL or token is not configured' })
    expect(httpFetch).not.toHaveBeenCalled()
  })
})

describe('acp answer_permission tool', () => {
  test('GETs pending permissions and POSTs a decision for each toolCallId', async () => {
    const [httpFetch, postCalls] = makePermissionFetch([
      { toolCallId: 't1', title: 'x' },
      { toolCallId: 't2', title: 'y' },
    ])
    const { tools } = activate(httpFetch)
    const result = await tools
      .get('answer_permission')!
      .execute({ sessionId: 's-1', decision: 'allow' }, runtimeCtx(), options())
    expect(postCalls).toHaveLength(2)
    expect(postCalls[0]!.url).toBe('http://magi:8787/sessions/s-1/permission')
    expect(postCalls[1]!.url).toBe('http://magi:8787/sessions/s-1/permission')
    expect(postCalls[0]!.body).toEqual({ toolCallId: 't1', decision: 'allow' })
    expect(postCalls[1]!.body).toEqual({ toolCallId: 't2', decision: 'allow' })
    expect(result).toEqual({ resolved: 2, decision: 'allow' })
  })

  test('no pending permissions returns resolved:0 without POSTing', async () => {
    const [httpFetch, postCalls] = makePermissionFetch([])
    const { tools } = activate(httpFetch)
    const result = await tools
      .get('answer_permission')!
      .execute({ sessionId: 's-1', decision: 'allow' }, runtimeCtx(), options())
    expect(postCalls).toHaveLength(0)
    expect(result).toEqual({ resolved: 0, message: 'no pending permission requests' })
  })

  test('missing sessionId returns invalid_input, httpFetch not called', async () => {
    const httpFetch = mock((): Promise<Response> => Promise.resolve(jsonResponse({})))
    const { tools } = activate(httpFetch)
    const result = await tools.get('answer_permission')!.execute({ decision: 'allow' }, runtimeCtx(), options())
    expect(result).toHaveProperty('error', 'invalid_input')
    expect(httpFetch).not.toHaveBeenCalled()
  })

  test('bad decision returns invalid_input, httpFetch not called', async () => {
    const httpFetch = mock((): Promise<Response> => Promise.resolve(jsonResponse({})))
    const { tools } = activate(httpFetch)
    const result = await tools
      .get('answer_permission')!
      .execute({ sessionId: 's-1', decision: 'maybe' }, runtimeCtx(), options())
    expect(result).toHaveProperty('error', 'invalid_input')
    expect(httpFetch).not.toHaveBeenCalled()
  })

  test('not configured returns not_configured without calling httpFetch', async () => {
    const httpFetch = mock((): Promise<Response> => Promise.resolve(jsonResponse({})))
    const { tools } = activate(httpFetch)
    const result = await tools.get('answer_permission')!.execute(
      { sessionId: 's-1', decision: 'deny' },
      runtimeCtx(() => undefined),
      options(),
    )
    expect(result).toEqual({ error: 'not_configured', message: 'magi base URL or token is not configured' })
    expect(httpFetch).not.toHaveBeenCalled()
  })
})
