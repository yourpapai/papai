// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { resolveMagiPermission } from '../../src/chat/magi-permission-client.js'

interface RecordedCall {
  url: string
  method: string | undefined
  body: string | undefined
}

const makeRecordingHttpFetch = (
  calls: RecordedCall[],
  response: Response,
): ((url: string, init?: RequestInit) => Promise<Response>) => {
  return (url, init) => {
    const method = init?.method
    const body = typeof init?.body === 'string' ? init.body : undefined
    calls.push({ url, method, body })
    return Promise.resolve(response)
  }
}

test('resolveMagiPermission POSTs toolCallId + decision to magi', async () => {
  const calls: RecordedCall[] = []
  const httpFetch = makeRecordingHttpFetch(calls, new Response('{}', { status: 200 }))
  const ok = await resolveMagiPermission('sess-1', 'mcp-1', 'allow', {
    config: { baseUrl: 'https://magi.example', token: 'tok' },
    httpFetch,
  })
  expect(ok).toBe(true)
  expect(calls[0]!.url).toBe('https://magi.example/sessions/sess-1/permission')
  expect(calls[0]!.method).toBe('POST')
  expect(JSON.parse(calls[0]!.body!)).toEqual({ toolCallId: 'mcp-1', decision: 'allow' })
})

test('resolveMagiPermission returns false when magi is not configured', async () => {
  const ok = await resolveMagiPermission('sess-1', 'mcp-1', 'deny', { config: null })
  expect(ok).toBe(false)
})

test('resolveMagiPermission returns false on a non-2xx magi response', async () => {
  const httpFetch = (): Promise<Response> => Promise.resolve(new Response('{"error":"gone"}', { status: 409 }))
  const ok = await resolveMagiPermission('sess-1', 'mcp-1', 'allow', {
    config: { baseUrl: 'https://magi.example', token: 'tok' },
    httpFetch,
  })
  expect(ok).toBe(false)
})
