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
import { logBuffer, logBufferStream } from './log-buffer.js'
import { addClient, init, removeClient, findTurnById } from './state-collector.js'

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
  return process.env['DEBUG_HOSTNAME'] ?? DEFAULT_HOSTNAME
}

function getDebugToken(): string | null {
  return process.env['DEBUG_TOKEN'] ?? null
}

function isAuthorizedRequest(req: Request): boolean {
  const token = getDebugToken()
  // No token required if not set
  if (token === null) return true

  const headerToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  return headerToken === token
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

function handleLogs(url: URL): Response {
  const results = logBuffer.search({
    level: parseIntParam(url.searchParams.get('level')),
    scope: url.searchParams.get('scope') ?? undefined,
    turnId: url.searchParams.get('turnId') ?? undefined,
    q: url.searchParams.get('q') ?? undefined,
    limit: parseIntParam(url.searchParams.get('limit')),
  })

  return new Response(JSON.stringify(results), {
    headers: { 'Content-Type': 'application/json' },
  })
}

let server: ReturnType<typeof Bun.serve> | null = null

function handleDashboardFile(pathname: string): Response {
  if (pathname === '/dashboard') {
    return new Response(Bun.file(path.join(PUBLIC_DIR, 'dashboard.html')))
  }

  if (pathname === '/dashboard.js') {
    return new Response(Bun.file(path.join(PUBLIC_DIR, 'dashboard.js')), {
      headers: { 'Content-Type': 'text/javascript' },
    })
  }

  if (pathname === '/dashboard.css') {
    return new Response(Bun.file(path.join(PUBLIC_DIR, 'dashboard.css')))
  }

  return new Response('Not found', { status: 404 })
}

function handleTurnLookup(url: URL): Response {
  const turnId = url.pathname.slice('/turns/'.length)
  if (turnId !== '') {
    const turn = findTurnById(turnId)
    if (turn !== undefined) {
      return new Response(JSON.stringify(turn), {
        headers: { 'Content-Type': 'application/json' },
      })
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
  return new Response(JSON.stringify(tasks), {
    headers: { 'Content-Type': 'application/json' },
  })
}

function handleDeferred(url: URL): Response {
  const userId = url.searchParams.get('userId')
  if (userId === null || userId === '') {
    return new Response('Missing userId parameter', { status: 400 })
  }
  const prompts = listScheduledPrompts(userId)
  return new Response(JSON.stringify(prompts), {
    headers: { 'Content-Type': 'application/json' },
  })
}

function handleMemos(url: URL): Response {
  const userId = url.searchParams.get('userId')
  if (userId === null || userId === '') {
    return new Response('Missing userId parameter', { status: 400 })
  }
  const state = url.searchParams.get('state') ?? 'active'
  const memos = listMemos(userId, 100, state)
  return new Response(JSON.stringify(memos), {
    headers: { 'Content-Type': 'application/json' },
  })
}

function handleIdentity(url: URL): Response {
  const userId = url.searchParams.get('userId')
  if (userId === null || userId === '') {
    return new Response('Missing userId parameter', { status: 400 })
  }
  const providerName = url.searchParams.get('provider') ?? 'task-provider'
  const mapping = getIdentityMapping(userId, providerName)
  if (mapping === null) {
    return new Response('Not found', { status: 404 })
  }
  return new Response(JSON.stringify(mapping), {
    headers: { 'Content-Type': 'application/json' },
  })
}

function handleAuthGroups(): Response {
  const groups = listAuthorizedGroups()
  return new Response(JSON.stringify(groups), {
    headers: { 'Content-Type': 'application/json' },
  })
}

function routeRequest(req: Request): Response {
  if (!isAuthorizedRequest(req)) {
    return new Response('Unauthorized', { status: 401 })
  }

  const url = new URL(req.url)

  if (url.pathname === '/events') return handleEvents(req)
  if (url.pathname === '/logs') return handleLogs(url)
  if (url.pathname === '/logs/stats') {
    return new Response(JSON.stringify(logBuffer.stats()), {
      headers: { 'Content-Type': 'application/json' },
    })
  }
  if (url.pathname.startsWith('/turns/')) return handleTurnLookup(url)
  if (url.pathname === '/recurring') return handleRecurring(url)
  if (url.pathname === '/deferred') return handleDeferred(url)
  if (url.pathname === '/memos') return handleMemos(url)
  if (url.pathname === '/identity') return handleIdentity(url)
  if (url.pathname === '/auth/groups') return handleAuthGroups()
  if (
    url.pathname === '/dashboard' ||
    url.pathname.startsWith('/dashboard.') ||
    url.pathname.startsWith('/dashboard-')
  ) {
    return handleDashboardFile(url.pathname)
  }

  return new Response('Not found', { status: 404 })
}

export function startDebugServer(adminUserId: string, logLevel = getLogLevel()): void {
  init(adminUserId)
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
