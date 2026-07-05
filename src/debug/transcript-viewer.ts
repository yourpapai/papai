// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getPluginAdminConfig } from '../plugins/store.js'

export type ViewerMagiConfig = { baseUrl: string; token: string }

export function getViewerMagiConfig(): ViewerMagiConfig | null {
  const baseUrl = getPluginAdminConfig('acp', 'magi_base_url')
  const token = getPluginAdminConfig('acp', 'magi_token')
  if (baseUrl === undefined || baseUrl.trim() === '' || token === undefined || token.trim() === '') return null
  return { baseUrl: baseUrl.trim().replace(/\/+$/u, ''), token: token.trim() }
}

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>

const ALLOWED_QUERY = new Set(['after', 'limit'])

export async function proxyTranscriptHistory(
  url: URL,
  token: string,
  cfg: ViewerMagiConfig,
  fetchImpl: FetchImpl = fetch,
): Promise<Response> {
  const params = new URLSearchParams()
  for (const [k, v] of url.searchParams) if (ALLOWED_QUERY.has(k)) params.set(k, v)
  const qs = params.toString()
  const target = `${cfg.baseUrl}/t/${encodeURIComponent(token)}/transcript${qs === '' ? '' : `?${qs}`}`
  const upstream = await fetchImpl(target, {
    headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  })
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' },
  })
}
