// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { KonturTalkUpdate } from '../../../src/chat/kontur-talk/schema.js'

type RecordedRequest = { method: string; path: string; body: unknown }

export type FakeKonturTalkServer = {
  baseUrl: string
  enqueueUpdates(updates: readonly KonturTalkUpdate[]): void
  whenPollPending(): Promise<void>
  requests(): readonly RecordedRequest[]
  sentRequests(): readonly unknown[]
  stop(): Promise<void>
  assertClean(): void
}

const isBotEndpoint = (pathname: string, endpoint: string): boolean =>
  new RegExp(`^/bot/[^/]+/${endpoint}$`, 'u').test(pathname)

export function startFakeKonturTalkServer(): Promise<FakeKonturTalkServer> {
  const updateBatches: KonturTalkUpdate[][] = []
  const recordedRequests: RecordedRequest[] = []
  const sends: unknown[] = []
  let markPollPending: () => void = () => {}
  const pollPending = new Promise<void>((resolve) => {
    markPollPending = resolve
  })
  let resolveHeldPoll: ((response: Response) => void) | null = null
  let stopped = false

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    idleTimeout: 1,
    async fetch(request) {
      const url = new URL(request.url)
      if (request.method === 'GET' && isBotEndpoint(url.pathname, 'get_updates')) {
        recordedRequests.push({ method: request.method, path: `${url.pathname}${url.search}`, body: undefined })
        const batch = updateBatches.shift()
        if (batch !== undefined) return Response.json({ updates: batch })
        if (resolveHeldPoll !== null) return new Response('poll already pending', { status: 409 })
        return new Promise<Response>((resolve) => {
          resolveHeldPoll = resolve
          markPollPending()
        })
      }
      if (request.method === 'POST' && isBotEndpoint(url.pathname, 'send_message')) {
        const body: unknown = await request.json().catch(() => null)
        recordedRequests.push({ method: request.method, path: url.pathname, body })
        sends.push(body)
        return Response.json({ event_id: `sent-${String(sends.length)}` })
      }
      return new Response('not found', { status: 404 })
    },
  })

  return Promise.resolve({
    baseUrl: `http://127.0.0.1:${String(server.port)}`,
    enqueueUpdates(updates) {
      updateBatches.push([...updates])
    },
    whenPollPending: () => pollPending,
    requests: () => recordedRequests.slice(),
    sentRequests: () => sends.slice(),
    stop(): Promise<void> {
      if (stopped) return Promise.resolve()
      stopped = true
      resolveHeldPoll?.(Response.json({ updates: [] }))
      resolveHeldPoll = null
      return server.stop()
    },
    assertClean() {
      if (!stopped) throw new Error('fake Kontur Talk server was not stopped')
      if (updateBatches.length > 0) throw new Error('fake Kontur Talk server has unconsumed update batches')
      if (resolveHeldPoll !== null) throw new Error('fake Kontur Talk server still has a pending poll')
    },
  })
}
