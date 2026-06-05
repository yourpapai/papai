// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

import { removeAuthorizedGroup } from '../authorized-groups.js'
import { authenticate, recordActivity } from '../dashboard-auth/index.js'
import { listAllIdentityMappings } from '../identity/mapping.js'
import { getLogLevel, logger, logMultistream } from '../logger.js'
import { handleAdminRecentRequests, handleAdminSystem } from './admin-system.js'
import { handleAuthClaim, handleAuthLogout, handleAuthWhoami } from './auth-routes.js'
import { handleAdminLlmGet, handleAdminLlmPost, handleBillingSubject, handleBillingSubjects } from './billing-routes.js'
import { handleInstanceApiRoute } from './instance-routes.js'
import { logBuffer, logBufferStream } from './log-buffer.js'
import { handleMcpStatus } from './mcp-routes.js'
import { handleAdminPluginConfigGet, handleAdminPluginConfigPost } from './plugin-config-routes.js'
import {
  handleAuthGroups,
  handleDeferred,
  handleIdentity,
  handleMemos,
  handleRecurring,
} from './server-route-support.js'
import { isSettingsPath, routeSettingsPaths } from './settings-router.js'
import { addClient, init, removeClient, findTurnById } from './state-collector.js'
import { handleStatsGlobal, handleStatsSubject } from './stats-routes.js'

const log = logger.child({ scope: 'debug-server' })

const PUBLIC_DIR = path.resolve(import.meta.dir, '../../public')

const DEFAULT_PORT = 9100
const DEFAULT_HOSTNAME = '127.0.0.1'

function getPort(): number {
  const env = process.env['DEBUG_PORT']
  if (env !== undefined && env !== '') {
    const parsed = Number.parseInt(env, 10)
    if (!Number.isNaN(parsed) && parsed > 0 && parsed < 65536) return parsed
  }
  return DEFAULT_PORT
}

function getHostname(): string {
  const hostname = process.env['DEBUG_HOSTNAME']
  if (hostname !== undefined) return hostname
  return DEFAULT_HOSTNAME
}

function isAuthorizedRequest(req: Readonly<Request>): boolean {
  const session = authenticate(req)
  if (session === null) return false
  recordActivity(session.sessionIdHash, req)
  return true
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
}

function handleEvents(req: Request): Response {
  let ctrl: ReadableStreamDefaultController
  const stream = new ReadableStream({
    start(controller): void {
      ctrl = controller
      addClient(controller)
      req.signal.addEventListener('abort', () => {
        removeClient(controller)
      })
    },
    cancel(): void {
      removeClient(ctrl)
    },
  })
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}

function parseIntParam(value: string | null): number | undefined {
  if (value === null) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isNaN(parsed) ? undefined : parsed
}

function searchParam(value: string | null): string | undefined {
  if (value !== null) return value
  return undefined
}

function handleLogs(url: URL): Response {
  const results = logBuffer.search({
    level: parseIntParam(url.searchParams.get('level')),
    scope: searchParam(url.searchParams.get('scope')),
    turnId: searchParam(url.searchParams.get('turnId')),
    q: searchParam(url.searchParams.get('q')),
    limit: parseIntParam(url.searchParams.get('limit')),
  })

  return jsonResponse(results)
}

export type WebServerRouteOptions = Readonly<{ debugEnabled: boolean }>
type WebServerStartOptions = Readonly<{ debugEnabled?: boolean; logLevel?: string }>
const DEFAULT_ROUTE_OPTIONS: WebServerRouteOptions = { debugEnabled: true }
const DEBUG_ONLY_PATHS = new Set(['/debug', '/debug.js', '/debug.css', '/events', '/logs', '/logs/stats', '/dashboard'])

let server: ReturnType<typeof Bun.serve> | null = null
let routeOptions: WebServerRouteOptions = DEFAULT_ROUTE_OPTIONS

function handleClientFile(prefix: 'debug' | 'admin' | 'settings', pathname: string): Response {
  if (pathname === `/${prefix}`) {
    return new Response(Bun.file(path.join(PUBLIC_DIR, `${prefix}.html`)))
  }
  if (pathname === `/${prefix}.js`) {
    return new Response(Bun.file(path.join(PUBLIC_DIR, `${prefix}.js`)), {
      headers: { 'Content-Type': 'text/javascript' },
    })
  }
  if (pathname === `/${prefix}.css`) {
    return new Response(Bun.file(path.join(PUBLIC_DIR, `${prefix}.css`)))
  }
  return new Response('Not found', { status: 404 })
}

function handleTurnLookup(url: URL): Response {
  const turnId = url.pathname.slice('/turns/'.length)
  if (turnId !== '') {
    const turn = findTurnById(turnId)
    if (turn !== undefined) {
      return jsonResponse(turn)
    }
  }
  return new Response('Not found', { status: 404 })
}

function handleAdminIdentityMappings(): Response {
  return jsonResponse(listAllIdentityMappings())
}

function routeAdminPaths(req: Request, url: URL): Response | Promise<Response> | null {
  if (url.pathname === '/admin/system') {
    if (req.method === 'GET') return handleAdminSystem()
    return new Response('Method not allowed', { status: 405 })
  }
  if (url.pathname === '/admin/llm') {
    if (req.method === 'GET') return handleAdminLlmGet()
    if (req.method === 'POST') return handleAdminLlmPost(req)
    return new Response('Method not allowed', { status: 405 })
  }
  if (url.pathname.startsWith('/admin/subjects/') && url.pathname.endsWith('/recent-requests')) {
    return handleAdminRecentRequests(url)
  }
  if (url.pathname === '/admin/plugin-config') {
    if (req.method === 'GET') return handleAdminPluginConfigGet()
    if (req.method === 'POST') return handleAdminPluginConfigPost(req)
    return new Response('Method not allowed', { status: 405 })
  }
  if (url.pathname === '/admin/identity/mappings') {
    if (req.method === 'GET') return handleAdminIdentityMappings()
    return new Response('Method not allowed', { status: 405 })
  }
  if (url.pathname === '/admin' || url.pathname === '/admin.js' || url.pathname === '/admin.css') {
    return handleClientFile('admin', url.pathname)
  }
  return null
}

function routePublicAuthPaths(req: Request, url: URL): Response | null {
  if (url.pathname === '/auth/claim' && req.method === 'GET') return handleAuthClaim(req, url)
  if (url.pathname === '/auth/logout' && req.method === 'POST') return handleAuthLogout(req)
  if (url.pathname === '/auth/whoami' && req.method === 'GET') return handleAuthWhoami(req)
  return null
}

const isDebugOnlyPath = (pathname: string): boolean => DEBUG_ONLY_PATHS.has(pathname) || pathname.startsWith('/turns/')

function routeProtectedPaths(req: Request, url: URL): Response | Promise<Response> | null {
  if (url.pathname === '/events') return handleEvents(req)
  if (url.pathname === '/logs') return handleLogs(url)
  if (url.pathname === '/logs/stats') {
    return jsonResponse(logBuffer.stats())
  }
  if (url.pathname.startsWith('/turns/')) return handleTurnLookup(url)
  if (url.pathname === '/recurring') return handleRecurring(url)
  if (url.pathname === '/deferred') return handleDeferred(url)
  if (url.pathname === '/memos') return handleMemos(url)
  if (url.pathname === '/identity') return handleIdentity(url)
  if (url.pathname === '/auth/groups') return handleAuthGroups()
  if (url.pathname.startsWith('/auth/groups/')) {
    const groupId = decodeURIComponent(url.pathname.slice('/auth/groups/'.length))
    if (req.method === 'DELETE') return jsonResponse({ removed: removeAuthorizedGroup(groupId) })
    return new Response('Method not allowed', { status: 405 })
  }
  if (url.pathname === '/mcp/status') {
    if (req.method === 'GET') return handleMcpStatus()
    return new Response('Method not allowed', { status: 405 })
  }
  if (url.pathname === '/billing/subjects') return handleBillingSubjects(url)
  if (url.pathname.startsWith('/billing/subject/')) return handleBillingSubject(url)
  if (url.pathname === '/stats/global') return handleStatsGlobal(url)
  if (url.pathname.startsWith('/stats/subject/')) return handleStatsSubject(url)
  return null
}

/**
 * Public static serving for the settings SPA shell + assets. These are reachable
 * without DEBUG_TOKEN (the shell is public; the data behind it is settings-session
 * gated). Returns null for every non-static path so callers fall through.
 */
export function routeSettingsStatic(pathname: string): Response | null {
  if (pathname === '/settings' || pathname === '/settings.js' || pathname === '/settings.css') {
    return handleClientFile('settings', pathname)
  }
  return null
}

async function routeRequest(req: Request, options: WebServerRouteOptions = routeOptions): Promise<Response> {
  const url = new URL(req.url)
  const settingsStatic = routeSettingsStatic(url.pathname)
  if (settingsStatic !== null) return settingsStatic
  // Settings trust domain: session-cookie auth only, never DEBUG_TOKEN.
  if (isSettingsPath(url.pathname)) {
    return (await routeSettingsPaths(req, url)) ?? new Response('Not found', { status: 404 })
  }

  const publicAuthResponse = routePublicAuthPaths(req, url)
  if (publicAuthResponse !== null) return publicAuthResponse

  if (!options.debugEnabled && isDebugOnlyPath(url.pathname)) return new Response('Not found', { status: 404 })

  if (!isAuthorizedRequest(req)) {
    return new Response('Unauthorized', { status: 401 })
  }

  const instanceApiResponse = await handleInstanceApiRoute(req, url)
  if (instanceApiResponse !== null) return instanceApiResponse

  const protectedResponse = routeProtectedPaths(req, url)
  if (protectedResponse !== null) return protectedResponse

  const adminResponse = routeAdminPaths(req, url)
  if (adminResponse !== null) return adminResponse

  if (url.pathname === '/debug' || url.pathname === '/debug.js' || url.pathname === '/debug.css') {
    return handleClientFile('debug', url.pathname)
  }
  if (url.pathname === '/dashboard') {
    return new Response(null, { status: 301, headers: { Location: '/debug' } })
  }
  if (url.pathname.startsWith('/dashboard.') || url.pathname.startsWith('/dashboard-')) {
    return new Response('Not found', { status: 404 })
  }

  return new Response('Not found', { status: 404 })
}

const resolveStartOptions = (options: WebServerStartOptions | string | undefined): Required<WebServerStartOptions> =>
  typeof options === 'string'
    ? { debugEnabled: true, logLevel: options }
    : { debugEnabled: options?.debugEnabled ?? true, logLevel: options?.logLevel ?? getLogLevel() }

export function startDebugServer(adminUserId: string, options?: WebServerStartOptions | string): void {
  init(adminUserId)
  const resolved = resolveStartOptions(options)
  routeOptions = { debugEnabled: resolved.debugEnabled }
  logMultistream.add({ stream: logBufferStream, level: resolved.logLevel })
  const port = getPort()
  const hostname = getHostname()
  server = Bun.serve({ port, hostname, idleTimeout: 0, fetch: (req) => routeRequest(req) })
  log.info({ port, hostname, debugEnabled: resolved.debugEnabled }, 'Web server started (session auth)')
}

export const routeRequestForTest = (req: Request, options?: Partial<WebServerRouteOptions>): Promise<Response> =>
  routeRequest(req, { ...DEFAULT_ROUTE_OPTIONS, ...options })

export function stopDebugServer(): void {
  routeOptions = DEFAULT_ROUTE_OPTIONS
  if (server !== null) {
    void server.stop()
    server = null
    const streams: unknown = Reflect.get(logMultistream, 'streams')
    if (Array.isArray(streams)) {
      const idx = streams.findIndex(
        (entry: unknown) =>
          typeof entry === 'object' && entry !== null && Reflect.get(entry, 'stream') === logBufferStream,
      )
      if (idx !== -1) streams.splice(idx, 1)
    }
    log.info('Debug server stopped')
  }
}
