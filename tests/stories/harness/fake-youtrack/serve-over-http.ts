// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Server } from 'bun'

import { handleFakeYouTrackRequest } from './router.js'
import { createFakeYouTrackState, resetFakeYouTrackState, type FakeYouTrackCtx } from './state.js'

export type FakeYouTrackServer = {
  url: string
  stop(): Promise<void>
  reset(): void
}

/** Live-socket transport for the in-process conformance lane. The T0 story lane
 *  uses createFakeYouTrackResponder (./responder.js) instead: the story sandbox
 *  I/O guard forbids opening a real socket. */
export const startFakeYouTrackServer = (): FakeYouTrackServer => {
  const state = createFakeYouTrackState()
  const server: Server<undefined> = Bun.serve({
    port: 0,
    async fetch(req): Promise<Response> {
      const url = new URL(req.url)
      const hasBody = req.method === 'POST' || req.method === 'PUT'
      const bodyText = hasBody ? await req.text() : ''
      const body: unknown = bodyText.length > 0 ? JSON.parse(bodyText) : undefined
      const ctx: FakeYouTrackCtx = { method: req.method, path: url.pathname, query: url.searchParams, body, state }
      return handleFakeYouTrackRequest(ctx)
    },
  })

  return {
    url: `http://localhost:${server.port}`,
    stop: async (): Promise<void> => {
      await server.stop(true)
    },
    reset: (): void => {
      resetFakeYouTrackState(state)
    },
  }
}
