// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { createTrpcClient, type FetchImplementation, type TrpcBuildResult } from './trpc.js'

function requireClient(result: TrpcBuildResult): Extract<TrpcBuildResult, { ok: true }>['client'] {
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.code)
  return result.client
}

function capturingFetch(requests: Request[]): FetchImplementation {
  return (input, init) => {
    requests.push(new Request(input, init))
    return Promise.resolve(Response.json({ result: { data: { json: { id: 'synthetic-dashboard-id' } } } }))
  }
}

function firstRequest(requests: readonly Request[]): Request {
  const request = requests[0]
  if (request === undefined) throw new Error('Expected one request')
  return request
}

test('sends the session cookie only as a header and unwraps a tRPC mutation', async () => {
  const requests: Request[] = []
  const client = requireClient(
    createTrpcClient({
      baseUrl: 'http://127.0.0.1:4400',
      fetchImpl: capturingFetch(requests),
      sessionCookie: 'synthetic-session-cookie',
      timeoutMs: 1_000,
    }),
  )

  const result = await client.mutate('dashboard.create', {
    name: '[SYNTHETIC ONLY] papai analytics PoC',
    projectId: 'papai-analytics-poc',
  })
  const request = firstRequest(requests)
  const body = await request.text()

  expect(result).toEqual({ id: 'synthetic-dashboard-id' })
  expect(request.url).toBe('http://127.0.0.1:4400/api/trpc/dashboard.create')
  expect(request.headers.get('cookie')).toBe('session=synthetic-session-cookie')
  expect(body).not.toContain('synthetic-session-cookie')
  expect(JSON.parse(body)).toEqual({
    json: {
      name: '[SYNTHETIC ONLY] papai analytics PoC',
      projectId: 'papai-analytics-poc',
    },
  })
})

test('encodes a protected query in the unbatched tRPC envelope', async () => {
  const requests: Request[] = []
  const client = requireClient(
    createTrpcClient({
      baseUrl: 'http://127.0.0.1:4400',
      fetchImpl: capturingFetch(requests),
      sessionCookie: 'synthetic-session-cookie',
      timeoutMs: 1_000,
    }),
  )

  await client.query('dashboard.list', { projectId: 'papai-analytics-poc' })

  const request = firstRequest(requests)
  const input = new URL(request.url).searchParams.get('input')
  expect(input).toBe(JSON.stringify({ json: { projectId: 'papai-analytics-poc' } }))
  expect(request.method).toBe('GET')
})

test('rejects resolver-dependent localhost for session-cookie requests', () => {
  const result = createTrpcClient({
    baseUrl: 'http://localhost:4400',
    fetchImpl: fetch,
    sessionCookie: 'synthetic-session-cookie',
    timeoutMs: 1_000,
  })

  expect(result).toEqual({ code: 'ENDPOINT_NOT_LOOPBACK', ok: false })
})
