// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'

import {
  getViewerMagiConfig,
  proxyTranscriptHistory,
  proxyTranscriptStream,
  routeTranscriptPaths,
} from '../../src/debug/transcript-viewer.js'
import type { ViewerMagiConfig } from '../../src/debug/transcript-viewer.js'
import { setPluginAdminConfig } from '../../src/plugins/store.js'
import { mockLogger, restoreFetch, setMockFetch, setupTestDb } from '../utils/test-helpers.js'

const PUBLIC_DIR = path.resolve(import.meta.dir, '../../public')

// Locally (and in CI's `check` job, which downloads the `build` job's
// `public/` artifact) `bun build:client` may already have produced these
// files, so we can't rely on ambient absence to exercise the missing-file
// 404 path. Deterministically hide the real file for the duration of the
// test, then restore it, so the assertion holds regardless of build state.
async function withFileHidden(fileName: string, run: () => Promise<void>): Promise<void> {
  const filePath = path.join(PUBLIC_DIR, fileName)
  const hiddenPath = `${filePath}.test-hidden`
  const existed = await fs
    .access(filePath)
    .then(() => true)
    .catch(() => false)
  if (existed) await fs.rename(filePath, hiddenPath)
  try {
    await run()
  } finally {
    if (existed) await fs.rename(hiddenPath, filePath)
  }
}

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
    const response = await proxyTranscriptHistory(url, 'tok_z', cfg, new AbortController().signal, fetchImpl)

    expect(seen.url).toBe('https://magi.example/t/tok_z/transcript?after=5&limit=100')
    expect(seen.auth).toBe('Bearer sekret')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ events: [], nextCursor: null })
  })

  test('passes through a magi 404', async () => {
    const fetchImpl = (): Promise<Response> => Promise.resolve(new Response('not found', { status: 404 }))

    const url = new URL('https://papai.example/t/tok_z/transcript')
    const response = await proxyTranscriptHistory(url, 'tok_z', cfg, new AbortController().signal, fetchImpl)

    expect(response.status).toBe(404)
  })

  test('returns 502 without throwing when the upstream fetch rejects', async () => {
    mockLogger()
    const fetchImpl = (): Promise<Response> => Promise.reject(new Error('DNS lookup failed'))

    const url = new URL('https://papai.example/t/tok_z/transcript')
    const response = await proxyTranscriptHistory(url, 'tok_z', cfg, new AbortController().signal, fetchImpl)

    expect(response.status).toBe(502)
  })

  test('does not leak upstream Set-Cookie/X-Powered-By headers', async () => {
    const fetchImpl = (): Promise<Response> =>
      Promise.resolve(
        new Response('{}', {
          status: 200,
          headers: { 'Set-Cookie': 'session=abc', 'X-Powered-By': 'Express', 'Content-Type': 'application/json' },
        }),
      )

    const url = new URL('https://papai.example/t/tok_z/transcript')
    const response = await proxyTranscriptHistory(url, 'tok_z', cfg, new AbortController().signal, fetchImpl)

    expect(response.headers.get('set-cookie')).toBeNull()
    expect(response.headers.get('x-powered-by')).toBeNull()
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

  test('returns 502 without throwing when the upstream fetch rejects', async () => {
    mockLogger()
    const clientSignal = new AbortController().signal
    const fetchImpl = (): Promise<Response> => Promise.reject(new Error('connection reset'))

    const response = await proxyTranscriptStream('tok_z', cfg, clientSignal, fetchImpl)

    expect(response.status).toBe(502)
  })

  test('does not leak upstream Set-Cookie/X-Powered-By headers', async () => {
    const clientSignal = new AbortController().signal
    const stream = new ReadableStream<Uint8Array>({
      start(controller): void {
        controller.enqueue(new TextEncoder().encode('data: hello\n\n'))
        controller.close()
      },
    })
    const fetchImpl = (): Promise<Response> =>
      Promise.resolve(
        new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream', 'Set-Cookie': 'session=abc', 'X-Powered-By': 'Express' },
        }),
      )

    const response = await proxyTranscriptStream('tok_z', cfg, clientSignal, fetchImpl)

    expect(response.headers.get('set-cookie')).toBeNull()
    expect(response.headers.get('x-powered-by')).toBeNull()
  })
})

describe('routeTranscriptPaths', () => {
  test('falls through null for a non-/t path', async () => {
    const url = new URL('https://papai.example/settings')
    const response = await routeTranscriptPaths(new Request(url), url)

    expect(response).toBeNull()
  })

  test('returns 404 for an unknown /t/<token>/<sub> subpath', async () => {
    await setupTestDb()
    const url = new URL('https://papai.example/t/tok_z/bogus')
    const response = await routeTranscriptPaths(new Request(url), url)

    expect(response).not.toBeNull()
    expect(response?.status).toBe(404)
  })

  test('returns 503 for /t/<token>/stream when magi is not configured', async () => {
    await setupTestDb()
    const url = new URL('https://papai.example/t/tok_z/stream')
    const response = await routeTranscriptPaths(new Request(url), url)

    expect(response).not.toBeNull()
    expect(response?.status).toBe(503)
  })

  test('returns 503 for /t/<token>/transcript when magi is not configured', async () => {
    await setupTestDb()
    const url = new URL('https://papai.example/t/tok_z/transcript')
    const response = await routeTranscriptPaths(new Request(url), url)

    expect(response).not.toBeNull()
    expect(response?.status).toBe(503)
  })

  // The shell/asset routes must 404 cleanly when public/transcript.{html,js,css}
  // is missing (e.g. build:client hasn't run yet) rather than let Bun.file 500
  // later. Hide the real file for the duration of the test so this holds even
  // when a build already populated public/ (as CI's `check` job does).
  test('cleanly 404s the shell route for a bare /t/<token> while the file is missing', async () => {
    await withFileHidden('transcript.html', async () => {
      const url = new URL('https://papai.example/t/tok_z')
      const response = await routeTranscriptPaths(new Request(url), url)

      expect(response).not.toBeNull()
      expect(response?.status).toBe(404)
    })
  })

  test('cleanly 404s the /t.js asset route while the file is missing', async () => {
    await withFileHidden('transcript.js', async () => {
      const url = new URL('https://papai.example/t.js')
      const response = await routeTranscriptPaths(new Request(url), url)

      expect(response).not.toBeNull()
      expect(response?.status).toBe(404)
    })
  })

  test('cleanly 404s the /t.css asset route while the file is missing', async () => {
    await withFileHidden('transcript.css', async () => {
      const url = new URL('https://papai.example/t.css')
      const response = await routeTranscriptPaths(new Request(url), url)

      expect(response).not.toBeNull()
      expect(response?.status).toBe(404)
    })
  })

  test('returns 404 for an empty token', async () => {
    const url = new URL('https://papai.example/t/')
    const response = await routeTranscriptPaths(new Request(url), url)

    expect(response).not.toBeNull()
    expect(response?.status).toBe(404)
  })

  test('decodes a percent-encoded token exactly once before re-encoding upstream', async () => {
    await setupTestDb()
    setPluginAdminConfig('acp', 'magi_base_url', 'https://magi.example', 'test')
    setPluginAdminConfig('acp', 'magi_token', 'sekret', 'test')
    const seen = { url: '' }
    setMockFetch((fetchUrl: string): Promise<Response> => {
      seen.url = fetchUrl
      return Promise.resolve(new Response('{}', { status: 200 }))
    })
    try {
      // "tok@z" percent-encoded once, as it would arrive in a real request path.
      const url = new URL('https://papai.example/t/tok%40z/transcript')
      await routeTranscriptPaths(new Request(url), url)
    } finally {
      restoreFetch()
    }

    expect(seen.url).toBe('https://magi.example/t/tok%40z/transcript')
  })
})
