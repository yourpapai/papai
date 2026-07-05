// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  getViewerMagiConfig,
  proxyTranscriptHistory,
  proxyTranscriptStream,
} from '../../src/debug/transcript-viewer.js'
import type { ViewerMagiConfig } from '../../src/debug/transcript-viewer.js'
import { setPluginAdminConfig } from '../../src/plugins/store.js'
import { setupTestDb } from '../utils/test-helpers.js'

describe('getViewerMagiConfig', () => {
  test('returns trimmed baseUrl and token when both configured', async () => {
    await setupTestDb()
    setPluginAdminConfig('acp', 'magi_base_url', 'https://magi.example/', 'test')
    setPluginAdminConfig('acp', 'magi_token', '  sekret  ', 'test')

    expect(getViewerMagiConfig()).toEqual({ baseUrl: 'https://magi.example', token: 'sekret' })
  })

  test('returns null when nothing configured', async () => {
    await setupTestDb()

    expect(getViewerMagiConfig()).toBeNull()
  })
})

describe('proxyTranscriptHistory', () => {
  const cfg: ViewerMagiConfig = { baseUrl: 'https://magi.example', token: 'sekret' }

  test('forwards only after/limit query params with a bearer token', async () => {
    const seen = { url: '', auth: null as string | null }
    const fetchImpl = (url: string, init?: RequestInit): Promise<Response> => {
      seen.url = url
      seen.auth = new Headers(init?.headers).get('Authorization')
      return Promise.resolve(new Response(JSON.stringify({ events: [], nextCursor: null }), { status: 200 }))
    }

    const url = new URL('https://papai.example/t/tok_z/transcript?after=5&limit=100&bogus=1')
    const response = await proxyTranscriptHistory(url, 'tok_z', cfg, fetchImpl)

    expect(seen.url).toBe('https://magi.example/t/tok_z/transcript?after=5&limit=100')
    expect(seen.auth).toBe('Bearer sekret')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ events: [], nextCursor: null })
  })

  test('passes through a magi 404', async () => {
    const fetchImpl = (): Promise<Response> => Promise.resolve(new Response('not found', { status: 404 }))

    const url = new URL('https://papai.example/t/tok_z/transcript')
    const response = await proxyTranscriptHistory(url, 'tok_z', cfg, fetchImpl)

    expect(response.status).toBe(404)
  })
})

function signalOf(init: RequestInit | undefined): AbortSignal | null {
  return init?.signal ?? null
}

describe('proxyTranscriptStream', () => {
  const cfg: ViewerMagiConfig = { baseUrl: 'https://magi.example', token: 'sekret' }

  test('streams SSE frames through with client-signal binding, not a timeout', async () => {
    const seen = { url: '', auth: null as string | null, signal: null as AbortSignal | null }
    const clientSignal = new AbortController().signal
    const stream = new ReadableStream<Uint8Array>({
      start(controller): void {
        controller.enqueue(new TextEncoder().encode('data: hello\n\n'))
        controller.close()
      },
    })
    const fetchImpl = (url: string, init?: RequestInit): Promise<Response> => {
      seen.url = url
      seen.auth = new Headers(init?.headers).get('Authorization')
      seen.signal = signalOf(init)
      return Promise.resolve(new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))
    }

    const response = await proxyTranscriptStream('tok_z', cfg, clientSignal, fetchImpl)

    expect(seen.url).toBe('https://magi.example/t/tok_z/stream')
    expect(seen.auth).toBe('Bearer sekret')
    expect(seen.signal).toBe(clientSignal)
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).toBe('data: hello\n\n')
  })

  test('passes through a magi 404', async () => {
    const clientSignal = new AbortController().signal
    const fetchImpl = (): Promise<Response> => Promise.resolve(new Response('not found', { status: 404 }))

    const response = await proxyTranscriptStream('tok_z', cfg, clientSignal, fetchImpl)

    expect(response.status).toBe(404)
  })
})
