// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { handleFakeKaneoRequest } from './router.js'
import { createFakeKaneoState, type FakeKaneoCtx } from './state.js'

const readJsonBody = async (request: Request): Promise<unknown> => {
  const hasBody = request.method === 'POST' || request.method === 'PUT' || request.method === 'DELETE'
  if (!hasBody) return undefined
  const text = await request.text()
  if (text.length === 0) return undefined
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(
      `Fake Kaneo expected valid JSON for ${request.method} ${new URL(request.url).pathname}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    )
  }
}

/** Dispatcher transport for the fake Kaneo API: adapts a Request into the
 *  router's transport-free Ctx. Register with http.serveHost('kaneo.invalid', ...).
 *  Fresh state per call — a scenario is a fresh world, so nothing ever resets. */
export const createFakeKaneoResponder = (): ((request: Request) => Promise<Response>) => {
  const state = createFakeKaneoState()
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    let body: unknown
    try {
      body = await readJsonBody(request)
    } catch {
      return new Response(JSON.stringify({ error: 'request body is not valid JSON' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      })
    }
    const ctx: FakeKaneoCtx = {
      method: request.method,
      path: url.pathname,
      query: url.searchParams,
      body,
      state,
    }
    return handleFakeKaneoRequest(ctx)
  }
}
