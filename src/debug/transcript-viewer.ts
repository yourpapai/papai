// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

import { logger } from '../logger.js'
import { getPluginAdminConfig } from '../plugins/store.js'

const log = logger.child({ scope: 'debug:transcript-viewer' })

const PUBLIC_DIR = path.resolve(import.meta.dir, '../../public')

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
  clientSignal: AbortSignal,
  fetchImpl: FetchImpl = fetch,
): Promise<Response> {
  const params = new URLSearchParams()
  for (const [k, v] of url.searchParams) if (ALLOWED_QUERY.has(k)) params.set(k, v)
  const qs = params.toString()
  const target = `${cfg.baseUrl}/t/${encodeURIComponent(token)}/transcript${qs === '' ? '' : `?${qs}`}`
  let upstream: Response
  try {
    upstream = await fetchImpl(target, {
      headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/json' },
      signal: AbortSignal.any([clientSignal, AbortSignal.timeout(15_000)]),
    })
  } catch (error) {
    log.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'transcript history upstream fetch failed',
    )
    return new Response('upstream unavailable', { status: 502 })
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' },
  })
}

export async function proxyTranscriptStream(
  token: string,
  cfg: ViewerMagiConfig,
  clientSignal: AbortSignal,
  fetchImpl: FetchImpl = fetch,
): Promise<Response> {
  const target = `${cfg.baseUrl}/t/${encodeURIComponent(token)}/stream`
  let upstream: Response
  try {
    upstream = await fetchImpl(target, {
      headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'text/event-stream' },
      signal: clientSignal,
    })
  } catch (error) {
    log.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'transcript stream upstream fetch failed',
    )
    return new Response('upstream unavailable', { status: 502 })
  }
  if (!upstream.ok || upstream.body === null) {
    return new Response('upstream stream unavailable', { status: upstream.ok ? 502 : upstream.status })
  }
  return new Response(upstream.body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  })
}

async function serveAsset(file: 'transcript.js' | 'transcript.css', contentType: string): Promise<Response> {
  const filePath = path.join(PUBLIC_DIR, file)
  const bunFile = Bun.file(filePath)
  if (!(await bunFile.exists())) return new Response('Not found', { status: 404 })
  return new Response(bunFile, { headers: { 'Content-Type': contentType } })
}

async function serveShell(): Promise<Response> {
  const filePath = path.join(PUBLIC_DIR, 'transcript.html')
  const bunFile = Bun.file(filePath)
  if (!(await bunFile.exists())) return new Response('Not found', { status: 404 })
  return new Response(bunFile, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

function decodeToken(rawToken: string): string {
  try {
    return decodeURIComponent(rawToken)
  } catch {
    return rawToken
  }
}

/**
 * Deliberately PUBLIC, no-auth capability-token routes: possession of the
 * opaque `/t/<token>` token is the access control, mirrored from magi. Mounted
 * before the debug-server auth gate — do not move this behind it.
 */
export async function routeTranscriptPaths(req: Request, url: URL): Promise<Response | null> {
  if (url.pathname === '/t.js') return serveAsset('transcript.js', 'text/javascript')
  if (url.pathname === '/t.css') return serveAsset('transcript.css', 'text/css')
  if (!url.pathname.startsWith('/t/')) return null
  const rest = url.pathname.slice('/t/'.length)
  const slash = rest.indexOf('/')
  const rawToken = slash === -1 ? rest : rest.slice(0, slash)
  const sub = slash === -1 ? '' : rest.slice(slash + 1)
  if (rawToken === '') return new Response('Not found', { status: 404 })
  const token = decodeToken(rawToken)
  if (sub === '') return serveShell()
  if (sub === 'stream' || sub === 'transcript') {
    const cfg = getViewerMagiConfig()
    if (cfg === null) return new Response('transcript viewer not configured', { status: 503 })
    const response =
      sub === 'stream'
        ? await proxyTranscriptStream(token, cfg, req.signal)
        : await proxyTranscriptHistory(url, token, cfg, req.signal)
    return response
  }
  return new Response('Not found', { status: 404 })
}
