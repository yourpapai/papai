// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

import { listAuthorizedGroups } from '../authorized-groups.js'
import { listScheduledPrompts } from '../deferred-prompts/scheduled.js'
import { getIdentityMapping } from '../identity/mapping.js'
import { getLogLevel, logger, logMultistream } from '../logger.js'
import { listMemos } from '../memos.js'
import { listRecurringTasks } from '../recurring.js'
import { handleAdminRecentRequests, handleAdminSystem } from './admin-system.js'
import { handleAdminLlmGet, handleAdminLlmPost, handleBillingSubject, handleBillingSubjects } from './billing-routes.js'
import { handleInstanceApiRoute } from './instance-routes.js'
import { logBuffer, logBufferStream } from './log-buffer.js'
import { handleAdminPluginConfigGet, handleAdminPluginConfigPost } from './plugin-config-routes.js'
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

function getDebugToken(): string | null {
  const token = process.env['DEBUG_TOKEN']
  if (token !== undefined) return token
  return null
}

function isAuthorizedRequest(req: Request): boolean {
  const token = getDebugToken()
  // No token required if not set
  if (token === null) return true

  const authorization = req.headers.get('Authorization')
  if (authorization === null) return false
  const headerToken = authorization.replace('Bearer ', '')
  return headerToken === token
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

let server: ReturnType<typeof Bun.serve> | null = null

function handleClientFile(prefix: 'debug' | 'admin', pathname: string): Response {
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

function handleRecurring(url: URL): Response {
  const userId = url.searchParams.get('userId')
  if (userId === null || userId === '') {
    return new Response('Missing userId parameter', { status: 400 })
  }
  const tasks = listRecurringTasks(userId)
  return jsonResponse(tasks)
}

function handleDeferred(url: URL): Response {
  const userId = url.searchParams.get('userId')
  if (userId === null || userId === '') {
    return new Response('Missing userId parameter', { status: 400 })
  }
  const prompts = listScheduledPrompts(userId)
  return jsonResponse(prompts)
}

function handleMemos(url: URL): Response {
  const userId = url.searchParams.get('userId')
  if (userId === null || userId === '') {
    return new Response('Missing userId parameter', { status: 400 })
  }
  const state = resolveParamDefault(url.searchParams.get('state'), 'active')
  const memos = listMemos(userId, 100, state)
  return jsonResponse(memos)
}

function handleIdentity(url: URL): Response {
  const userId = url.searchParams.get('userId')
  if (userId === null || userId === '') {
    return new Response('Missing userId parameter', { status: 400 })
  }
  const providerName = resolveParamDefault(url.searchParams.get('provider'), 'task-provider')
  const mapping = getIdentityMapping(userId, providerName)
  if (mapping === null) {
    return new Response('Not found', { status: 404 })
  }
  return jsonResponse(mapping)
}

function resolveParamDefault(value: string | null, fallback: string): string {
  if (value !== null) return value
  return fallback
}

function handleAuthGroups(): Response {
  const groups = listAuthorizedGroups()
  return jsonResponse(groups)
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
  if (url.pathname === '/admin' || url.pathname === '/admin.js' || url.pathname === '/admin.css') {
    return handleClientFile('admin', url.pathname)
  }
  return null
}

async function routeRequest(req: Request): Promise<Response> {
  if (!isAuthorizedRequest(req)) {
    return new Response('Unauthorized', { status: 401 })
  }

  const url = new URL(req.url)

  const instanceApiResponse = await handleInstanceApiRoute(req, url)
  if (instanceApiResponse !== null) return instanceApiResponse

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
  if (url.pathname === '/billing/subjects') return handleBillingSubjects(url)
  if (url.pathname.startsWith('/billing/subject/')) return handleBillingSubject(url)
  if (url.pathname === '/stats/global') return handleStatsGlobal(url)
  if (url.pathname.startsWith('/stats/subject/')) return handleStatsSubject(url)

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

export function startDebugServer(adminUserId: string, ...args: [] | [string]): void {
  init(adminUserId)
  const logLevel = args.length === 0 ? getLogLevel() : args[0]
  logMultistream.add({ stream: logBufferStream, level: logLevel })

  const port = getPort()
  const hostname = getHostname()
  const token = getDebugToken()

  server = Bun.serve({
    port,
    hostname,
    idleTimeout: 0,
    fetch: routeRequest,
  })

  log.info({ port, hostname, authEnabled: token !== null }, 'Debug server started')
}

export function stopDebugServer(): void {
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
