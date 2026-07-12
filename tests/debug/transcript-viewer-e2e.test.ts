// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { HistoryResponseSchema } from '../../client/transcript/fetcher-schemas.js'
import { routeTranscriptPaths } from '../../src/debug/transcript-viewer.js'
import { mintTranscriptToken } from '../../src/mcp-server/token.js'
import { setPluginAdminConfig } from '../../src/plugins/store.js'
import { setupTestDb } from '../utils/test-helpers.js'

const STUB_SESSION_ID = 'stub-session-id'

describe('transcript viewer end-to-end against a stub magi', () => {
  let server: ReturnType<typeof Bun.serve> | null = null
  let baseUrl = ''
  let token = ''

  beforeEach(async () => {
    await setupTestDb()
    token = mintTranscriptToken(STUB_SESSION_ID)

    server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === `/sessions/${STUB_SESSION_ID}/transcript`) {
          return new Response(
            JSON.stringify({
              events: [
                {
                  seq: 0,
                  ts: '2026-07-05T00:00:00.000Z',
                  type: 'update',
                  payload: { sessionUpdate: 'agent_message_chunk', content: 'hi' },
                },
              ],
              nextCursor: null,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        if (url.pathname === `/sessions/${STUB_SESSION_ID}/stream`) {
          const body = new ReadableStream<Uint8Array>({
            start(controller): void {
              controller.enqueue(
                new TextEncoder().encode(
                  `event: update\ndata: ${JSON.stringify({
                    seq: 0,
                    ts: '2026-07-05T00:00:00.000Z',
                    type: 'update',
                    payload: { sessionUpdate: 'agent_message_chunk', content: 'hi' },
                  })}\n\n`,
                ),
              )
              controller.enqueue(new TextEncoder().encode('event: end\ndata: {}\n\n'))
              controller.close()
            },
          })
          return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
        }
        return new Response('not found', { status: 404 })
      },
    })
    baseUrl = server.url.origin

    setPluginAdminConfig('acp', 'magi_base_url', baseUrl, 'test')
    setPluginAdminConfig('acp', 'magi_token', 'stub-bearer', 'test')
  })

  afterEach(async () => {
    await server?.stop(true)
    server = null
    baseUrl = ''
  })

  test('proxies paginated history from the stub magi transcript endpoint', async () => {
    const url = new URL(`https://papai.example/t/${token}/transcript`)
    const response = await routeTranscriptPaths(new Request(url), url)

    expect(response).not.toBeNull()
    expect(response?.status).toBe(200)
    const body = HistoryResponseSchema.parse(await response?.json())
    expect(body.events).toHaveLength(1)
    expect(body.nextCursor).toBeNull()
    expect(body.events[0]).toMatchObject({
      seq: 0,
      type: 'update',
      payload: { sessionUpdate: 'agent_message_chunk', content: 'hi' },
    })
  })

  test('proxies the SSE stream byte-for-byte from the stub magi stream endpoint', async () => {
    const url = new URL(`https://papai.example/t/${token}/stream`)
    const response = await routeTranscriptPaths(new Request(url), url)

    expect(response).not.toBeNull()
    expect(response?.status).toBe(200)
    expect(response?.headers.get('content-type')).toBe('text/event-stream')
    const text = await response?.text()
    expect(text).toContain('event: update')
    expect(text).toContain('"content":"hi"')
    expect(text).toContain('event: end')
  })
})
