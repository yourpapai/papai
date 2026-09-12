// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { handleFakeYouTrackRequest } from './router.js'
import { createFakeYouTrackState, type FakeYouTrackCtx } from './state.js'

/**
 * Attachment uploads are the one non-JSON body the provider sends: a multipart
 * form whose single `upload` part carries the file. The router only ever needs
 * the part's name, type and size, so the body is normalized to that shape
 * rather than retaining the bytes.
 */
const readMultipartBody = async (request: Request): Promise<unknown> => {
  const form = await request.formData()
  const parts: Record<string, unknown> = {}
  for (const [name, value] of form.entries()) {
    if (typeof value === 'string') {
      parts[name] = value
      continue
    }
    const file = value as Blob & { name?: string }
    parts[name] = { name: file.name ?? name, type: file.type, size: file.size }
  }
  return parts
}

const readJsonBody = async (request: Request): Promise<unknown> => {
  const hasBody = request.method === 'POST' || request.method === 'PUT'
  if (!hasBody) return undefined
  if ((request.headers.get('content-type') ?? '').startsWith('multipart/form-data')) {
    return readMultipartBody(request)
  }
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
