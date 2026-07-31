// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import type { OpenPanelTrackRequest } from './mapping.js'
import { createOpenPanelTransport } from './transport.js'
import type { FetchImplementation, TransportBuildResult } from './transport.js'

const REQUEST: OpenPanelTrackRequest = {
  type: 'track',
  payload: {
    name: 'turn_completed',
    profileId: 'syn_0123456789abcdef0123456789abcdef',
    properties: {
      __timestamp: '2026-05-01T10:00:00.000Z',
      event_id: 'c'.repeat(64),
      schema_version: 1,
    },
  },
}

function requireTransport(result: TransportBuildResult): Extract<TransportBuildResult, { ok: true }> {
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.code)
  return result
}

function firstRequest(requests: readonly Request[]): Request {
  const request = requests[0]
  if (request === undefined) throw new Error('Expected one captured request')
  return request
}

function abortOnlyFetch(signals: AbortSignal[]): FetchImplementation {
  return (_input, init) => {
    const signal = init?.signal
    if (!(signal instanceof AbortSignal)) return Promise.reject(new Error('missing timeout signal'))
    signals.push(signal)
    return new Promise<Response>((_resolve, reject) => {
      signal.addEventListener(
        'abort',
        () => {
          reject(new Error('request aborted'))
        },
        { once: true },
      )
    })
  }
}

function firstSignal(signals: readonly AbortSignal[]): AbortSignal {
  const signal = signals[0]
  if (signal === undefined) throw new Error('Expected a captured AbortSignal')
  return signal
}

test('posts the SDK-native shape to numeric loopback with credentials only in headers', async () => {
  const captured: Request[] = []
  const secret = 'synthetic-local-secret'
  const transport = createOpenPanelTransport({
    baseUrl: 'http://127.0.0.1:4400',
    clientId: 'synthetic-client',
    clientSecret: secret,
    fetchImpl: (input, init) => {
      captured.push(new Request(input, init))
      return Promise.resolve(Response.json({ success: true }))
    },
  })

  const result = await requireTransport(transport).send(REQUEST)
  const sent = firstRequest(captured)
  const sentBody = await sent.text()
  expect(result).toEqual({ kind: 'delivered', status: 200 })
  expect(sent.url).toBe('http://127.0.0.1:4400/api/track')
  expect(sent.headers.get('openpanel-client-id')).toBe('synthetic-client')
  expect(sent.headers.get('openpanel-client-secret')).toBe(secret)
  expect(JSON.parse(sentBody)).toEqual(REQUEST)
  expect(`${sent?.url}${sentBody}`).not.toContain(secret)
})

test('rejects non-loopback endpoints and URL credentials', () => {
  const remote = createOpenPanelTransport({
    baseUrl: 'https://analytics.example.com',
    clientId: 'synthetic-client',
    clientSecret: 'synthetic-local-secret',
    fetchImpl: fetch,
  })
  const embedded = createOpenPanelTransport({
    baseUrl: 'http://user:password@127.0.0.1:4400',
    clientId: 'synthetic-client',
    clientSecret: 'synthetic-local-secret',
    fetchImpl: fetch,
  })
  const resolverDependent = createOpenPanelTransport({
    baseUrl: 'http://localhost:4400',
    clientId: 'synthetic-client',
    clientSecret: 'synthetic-local-secret',
    fetchImpl: fetch,
  })

  expect(remote).toEqual({ code: 'ENDPOINT_NOT_LOOPBACK', ok: false })
  expect(embedded).toEqual({ code: 'URL_CREDENTIALS_FORBIDDEN', ok: false })
  expect(resolverDependent).toEqual({ code: 'ENDPOINT_NOT_LOOPBACK', ok: false })
})

test('simulates a lost acknowledgement after one successful request', async () => {
  let calls = 0
  const transport = createOpenPanelTransport({
    baseUrl: 'http://127.0.0.1:4400',
    clientId: 'synthetic-client',
    clientSecret: 'synthetic-local-secret',
    fetchImpl: () => {
      calls += 1
      return Promise.resolve(new Response(null, { status: 202 }))
    },
    simulateAmbiguousSuccesses: 1,
  })

  const sender = requireTransport(transport).send
  const first = await sender(REQUEST)
  const second = await sender(REQUEST)

  expect(calls).toBe(2)
  expect(first).toEqual({ errorClass: 'ambiguous_ack', kind: 'ambiguous' })
  expect(second).toEqual({ kind: 'delivered', status: 202 })
})

test('bounds a stalled numeric-loopback request with an abort timeout', async () => {
  const signals: AbortSignal[] = []
  const transport = requireTransport(
    createOpenPanelTransport({
      baseUrl: 'http://127.0.0.1:4400',
      clientId: 'synthetic-client',
      clientSecret: 'synthetic-local-secret',
      fetchImpl: abortOnlyFetch(signals),
      timeoutMs: 5,
    }),
  )

  const result = await transport.send(REQUEST)

  expect(result).toEqual({ errorClass: 'network_unknown', kind: 'ambiguous' })
  expect(signals).toHaveLength(1)
  expect(firstSignal(signals).aborted).toBe(true)
})
