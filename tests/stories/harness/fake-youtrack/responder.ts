// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { handleFakeYouTrackRequest } from './router.js'
import { createFakeYouTrackState, type FakeYouTrackCtx } from './state.js'

const readJsonBody = async (request: Request): Promise<unknown> => {
  const hasBody = request.method === 'POST' || request.method === 'PUT'
  if (!hasBody) return undefined
  const text = await request.text()
  if (text.length === 0) return undefined
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(
      `Fake YouTrack expected valid JSON for ${request.method} ${new URL(request.url).pathname}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    )
  }
}

/** Dispatcher transport for the fake YouTrack API: adapts a Request into the
 *  router's transport-free Ctx. Register with http.serveHost('youtrack.invalid', ...).
 *  Fresh state per call — a scenario is a fresh world, so nothing ever resets. */
export const createFakeYouTrackResponder = (): ((request: Request) => Promise<Response>) => {
  const state = createFakeYouTrackState()
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    const ctx: FakeYouTrackCtx = {
      method: request.method,
      path: url.pathname,
      query: url.searchParams,
      body: await readJsonBody(request),
      state,
    }
    return handleFakeYouTrackRequest(ctx)
  }
}
