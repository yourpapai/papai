// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { HttpFetch } from './context.js'

export type YouTrackRequester = {
  request(path: string, init?: RequestInit): Promise<unknown>
  getJson(path: string): Promise<unknown>
  getText(path: string): Promise<string>
  readonly baseUrl: string
  readonly token: string
  readonly httpFetch: HttpFetch
}

type RequesterState = { baseUrl: string; token: string; httpFetch: HttpFetch }

function toHeaderRecord(headers: RequestInit['headers']): Record<string, string> {
  if (headers === undefined) return {}
  if (headers instanceof Headers) return Object.fromEntries(headers.entries())
  if (Array.isArray(headers)) return Object.fromEntries(headers)
  return headers
}

async function requestJson(state: RequesterState, path: string, init?: RequestInit): Promise<unknown> {
  const res = await state.httpFetch(`${state.baseUrl}/api${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${state.token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...toHeaderRecord(init?.headers),
    },
  })
  if (!res.ok) {
    throw new Error(`YouTrack API ${res.status} for ${path}`)
  }
  if (res.status === 204) return undefined
  const body = await res.text()
  return body === '' ? undefined : JSON.parse(body)
}

async function requestText(state: RequesterState, path: string): Promise<string> {
  const res = await state.httpFetch(`${state.baseUrl}/api${path}`, {
    headers: {
      Authorization: `Bearer ${state.token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  })
  if (!res.ok) {
    throw new Error(`YouTrack API ${res.status} for ${path}`)
  }
  return res.text()
}

export function createYouTrackRequester(opts: {
  baseUrl: string
  token: string
  httpFetch: HttpFetch
}): YouTrackRequester {
  const state: RequesterState = {
    baseUrl: opts.baseUrl.replace(/\/+$/u, ''),
    token: opts.token,
    httpFetch: opts.httpFetch,
  }

  return {
    request: (path, init) => requestJson(state, path, init),
    getJson: (path) => requestJson(state, path),
    getText: (path) => requestText(state, path),
    baseUrl: state.baseUrl,
    token: state.token,
    httpFetch: state.httpFetch,
  }
}
