// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getSessionSnapshots } from '../cache-snapshots.js'
import { getPollerSnapshot } from '../deferred-prompts/poller.js'
import { getMessageCacheSnapshot } from '../message-cache/cache.js'
import { getSchedulerSnapshot } from '../scheduler.js'
import { subscribe, unsubscribe, type DebugEvent } from './event-bus.js'
import { recentLlm, pushTrace, handleLlmTraceEvent, shapeLlmTrace, type LlmTrace } from './llm-trace-collector.js'
import { shapeLogEntry } from './log-buffer.js'
import type { LogEntry } from './log-buffer.js'
import { entryMatchesFilter, type LogFilter } from './log-filter-model.js'
import {
  recentTurns,
  recentNotifications,
  recentToolFailures,
  inFlightTurns,
  findTurnById,
  handleTurnAssembly,
} from './turn-assembly.js'

export { resetTurnBuffers, findTurnById } from './turn-assembly.js'
export { recentLlm, pendingTraces } from './llm-trace-collector.js'

type ClientRegistration = {
  filter: LogFilter
  adminUserId: string | undefined
}

const clients = new Map<ReadableStreamDefaultController, ClientRegistration>()
const PASS_ALL: LogFilter = { include: [], exclude: [], level: 0 }
const encoder = new TextEncoder()

const HEARTBEAT_MS = 15000
const PING_FRAME = encoder.encode(': ping\n\n')
let heartbeatTimer: ReturnType<typeof setInterval> | null = null

function pingClients(): void {
  for (const client of clients.keys()) {
    try {
      client.enqueue(PING_FRAME)
    } catch {
      removeClient(client)
    }
  }
}

function startHeartbeat(): void {
  if (heartbeatTimer !== null) return
  heartbeatTimer = setInterval(pingClients, HEARTBEAT_MS)
}

function stopHeartbeat(): void {
  if (heartbeatTimer === null) return
  clearInterval(heartbeatTimer)
  heartbeatTimer = null
}

/** @public -- test seam for the heartbeat ping path */
export function pingClientsForTest(): void {
  pingClients()
}

/** @public -- test seam: drain all SSE clients to restore a clean baseline. */
export function resetClientsForTest(): void {
  for (const client of [...clients.keys()]) removeClient(client)
}

export const stats = {
  startedAt: Date.now(),
  totalMessages: 0,
  totalLlmCalls: 0,
  totalToolCalls: 0,
}

export type AdminVisibility = {
  adminUserId: string
  groupIds: ReadonlySet<string>
}

export function isVisibleToAdmin(
  scope: { kind?: string; userId?: string; groupId?: string } | null | undefined,
  vis: AdminVisibility,
): boolean {
  if (scope === null || scope === undefined || typeof scope.kind !== 'string') return false
  if (scope.kind === 'global') return true
  if (scope.kind === 'user') return scope.userId === vis.adminUserId
  if (scope.kind === 'group') return scope.groupId !== undefined && vis.groupIds.has(scope.groupId)
  return false
}

function clientVisibility(adminUserId: string | undefined): AdminVisibility {
  return { adminUserId: adminUserId ?? '', groupIds: new Set() }
}

/**
 * Turn ids whose scope is visible to the session admin, resolved in a single
 * pass over the turn buffers — the per-request attribution index for bulk log
 * egress (O(turns) once, not O(entries x turns)).
 * @public -- shared by the REST /logs route so bulk egress avoids per-entry scans.
 */
export function ownTurnIdsForAdmin(adminUserId: string | undefined): Set<string> {
  const own = new Set<string>()
  if (adminUserId === undefined) return own
  const vis = clientVisibility(adminUserId)
  for (const turn of inFlightTurns.values()) {
    if (isVisibleToAdmin(turn.scope, vis)) own.add(turn.turnId)
  }
  for (const turn of recentTurns) {
    if (isVisibleToAdmin(turn.scope, vis)) own.add(turn.turnId)
  }
  return own
}

/**
 * Attribution check for log egress: an entry is the client admin's own when it
 * carries an explicit matching `chatUserId`, or when its `turnId` resolves to a
 * turn whose scope is visible to that admin. Everything else — foreign or
 * unattributable — must be shaped.
 * @public -- shared by the REST /logs route so SSE and REST egress agree.
 * `ownTurnIds`, when provided, is the pre-resolved per-request attribution set
 * (see `ownTurnIdsForAdmin`); without it the single-entry path falls back to a
 * `findTurnById` lookup.
 */
export function isOwnLogEntry(
  entry: LogEntry,
  adminUserId: string | undefined,
  ownTurnIds?: ReadonlySet<string>,
): boolean {
  if (adminUserId === undefined) return false
  const explicit = entry['chatUserId']
  if (typeof explicit === 'string') return explicit === adminUserId
  const turnId = entry['turnId']
  if (typeof turnId === 'string' && turnId !== '') {
    if (ownTurnIds !== undefined) return ownTurnIds.has(turnId)
    const turn = findTurnById(turnId)
    if (turn !== undefined && isVisibleToAdmin(turn.scope, clientVisibility(adminUserId))) return true
  }
  return false
}

function buildInitData(adminUserId: string | undefined): Record<string, unknown> {
  const vis = clientVisibility(adminUserId)
  return {
    sessions: adminUserId === undefined ? [] : getSessionSnapshots(adminUserId),
    scheduler: getSchedulerSnapshot(),
    pollers: getPollerSnapshot(),
    messageCache: getMessageCacheSnapshot(),
    stats,
    recentLlm: recentLlm.map((trace) => shapeLlmTrace(trace, adminUserId)),
    recentTurns: recentTurns.filter((turn) => isVisibleToAdmin(turn.scope, vis)),
    recentNotifications: recentNotifications.filter((n) => isVisibleToAdmin(n.scope, vis)),
    recentToolFailures: recentToolFailures.filter((f) => isVisibleToAdmin(f.scope, vis)),
  }
}

export function addClient(
  controller: ReadableStreamDefaultController,
  filter: LogFilter = PASS_ALL,
  adminUserId?: string,
): void {
  clients.set(controller, { filter, adminUserId })

  sendTo(controller, {
    type: 'state:init',
    timestamp: Date.now(),
    data: buildInitData(adminUserId),
    scope: { kind: 'global' },
  })

  if (clients.size === 1) {
    subscribe(onEvent)
    startHeartbeat()
  }
}

export function removeClient(controller: ReadableStreamDefaultController): void {
  clients.delete(controller)

  if (clients.size === 0) {
    unsubscribe(onEvent)
    stopHeartbeat()
  }
}

let statsDebounceTimer: ReturnType<typeof setTimeout> | null = null

function scheduleStatsBroadcast(): void {
  if (statsDebounceTimer !== null) return
  statsDebounceTimer = setTimeout(() => {
    statsDebounceTimer = null
    broadcast({
      type: 'state:stats',
      timestamp: Date.now(),
      data: { ...stats },
      scope: { kind: 'global' },
    })
  }, 500)
}

function deliver(controller: ReadableStreamDefaultController, payload: Uint8Array | null): void {
  if (payload === null) return
  try {
    controller.enqueue(payload)
  } catch {
    removeClient(controller)
  }
}

function frameForClient(event: DebugEvent, registration: ClientRegistration): Uint8Array | null {
  if (event.type === 'log:entry' && isLogEntry(event.data)) {
    const shaped = isOwnLogEntry(event.data, registration.adminUserId) ? event.data : shapeLogEntry(event.data)
    if (!entryMatchesFilter(shaped, registration.filter)) return null
    return formatSse({ ...event, data: shaped })
  }
  return formatSse(event)
}

function broadcastTrace(trace: LlmTrace, timestamp: number): void {
  for (const [client, registration] of clients) {
    const shaped = shapeLlmTrace(trace, registration.adminUserId)
    deliver(client, formatSse({ type: 'llm:full', timestamp, data: { ...shaped }, scope: { kind: 'global' } }))
  }
}

function onEvent(event: DebugEvent): void {
  handleLlmTraceEvent(event, { pushTrace, broadcastTrace }, stats, scheduleStatsBroadcast)
  if (event.type === 'message:received') {
    stats.totalMessages++
    scheduleStatsBroadcast()
  }
  handleTurnAssembly(event, broadcast)
  broadcast(event)
}

function isLogEntry(data: Record<string, unknown>): data is LogEntry {
  return typeof data['level'] === 'number' && typeof data['time'] === 'string' && typeof data['msg'] === 'string'
}

function broadcast(event: DebugEvent): void {
  for (const [client, registration] of clients) {
    if (event.type !== 'log:entry' && !isVisibleToAdmin(event.scope, clientVisibility(registration.adminUserId))) {
      continue
    }
    deliver(client, frameForClient(event, registration))
  }
}

function sendTo(controller: ReadableStreamDefaultController, event: DebugEvent): void {
  try {
    controller.enqueue(formatSse(event))
  } catch {
    removeClient(controller)
  }
}

function formatSse(event: DebugEvent): Uint8Array {
  return encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
}
