// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getSessionSnapshots } from '../cache-snapshots.js'
import { getPollerSnapshot } from '../deferred-prompts/poller.js'
import { getMessageCacheSnapshot } from '../message-cache/cache.js'
import { getSchedulerSnapshot } from '../scheduler.js'
import { subscribe, unsubscribe, type DebugEvent } from './event-bus.js'
import { recentLlm, pushTrace, handleLlmTraceEvent, resetLlmBuffers, type LlmTrace } from './llm-trace-collector.js'
import type { LogEntry } from './log-buffer.js'
import { entryMatchesFilter, type LogFilter } from './log-filter-model.js'
import {
  recentTurns,
  recentNotifications,
  recentToolFailures,
  handleTurnAssembly,
  resetTurnBuffers,
} from './turn-assembly.js'
import type { Notification, ToolFailure, Turn } from './turn-assembly.js'

export { findTurnById } from './turn-assembly.js'
export { recentLlm, pendingTraces } from './llm-trace-collector.js'

let adminUserId: string | null = null
let adminVisibility: AdminVisibility = { adminUserId: '', groupIds: new Set() }

const clients = new Map<ReadableStreamDefaultController, LogFilter>()
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

/**
 * Subscribe the persistent capture handler on the debug event bus. Capture is
 * unfiltered and independent of SSE clients; visibility is enforced at
 * broadcast/read time. Idempotent: production wiring calls it exactly once.
 */
export function startEventCollector(): void {
  subscribe(onEvent)
}

/** @public -- test seam: unsubscribe the capture handler. */
export function stopEventCollectorForTest(): void {
  unsubscribe(onEvent)
}

/** @public -- test seam: stop the collector, drain clients, clear buffers, zero stats, cancel the pending stats debounce. */
export function resetCollectorForTest(): void {
  stopEventCollectorForTest()
  resetClientsForTest()
  resetTurnBuffers()
  resetLlmBuffers()
  if (statsDebounceTimer !== null) {
    clearTimeout(statsDebounceTimer)
    statsDebounceTimer = null
  }
  stats.startedAt = Date.now()
  stats.totalMessages = 0
  stats.totalLlmCalls = 0
  stats.totalToolCalls = 0
}

export const stats = {
  startedAt: Date.now(),
  totalMessages: 0,
  totalLlmCalls: 0,
  totalToolCalls: 0,
}

export function init(adminId: string): void {
  adminUserId = adminId
  adminVisibility = { adminUserId: adminId, groupIds: new Set() }
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

/**
 * Visibility check for a persisted turn's scope against the process's current admin.
 * Closes over the module-private `adminVisibility` so REST handlers can enforce the
 * same contract as the SSE path without importing mutable module state.
 */
export function isScopeVisibleToCurrentAdmin(scope: Turn['scope'] | null | undefined): boolean {
  return isVisibleToAdmin(scope, adminVisibility)
}

function visibleTurnsToCurrentAdmin(): Turn[] {
  return recentTurns.filter((turn) => isVisibleToAdmin(turn.scope, adminVisibility))
}

function visibleNotificationsToCurrentAdmin(): Notification[] {
  return recentNotifications.filter((entry) => isVisibleToAdmin(entry.scope, adminVisibility))
}

function visibleToolFailuresToCurrentAdmin(): ToolFailure[] {
  return recentToolFailures.filter((entry) => isVisibleToAdmin(entry.scope, adminVisibility))
}

/**
 * `state:init` ships only the most recent N admin-visible traces: the trace buffer
 * holds up to 65535 entries with embedded `generatedText`/`stepsDetail`, and the
 * dashboard's own trace working set is 1024 (`client/debug` `CAPS.TRACE`), so a
 * longer tail would only inflate the single-frame `JSON.stringify` on connect.
 */
export const STATE_INIT_LLM_TAIL = 1024

function visibleLlmToCurrentAdmin(): LlmTrace[] {
  return recentLlm.filter((trace) => trace.userId === adminUserId).slice(-STATE_INIT_LLM_TAIL)
}

export function addClient(controller: ReadableStreamDefaultController, filter: LogFilter = PASS_ALL): void {
  clients.set(controller, filter)

  const initData: Record<string, unknown> = {
    sessions: adminUserId === null ? [] : getSessionSnapshots(adminUserId),
    scheduler: getSchedulerSnapshot(),
    pollers: getPollerSnapshot(),
    messageCache: getMessageCacheSnapshot(),
    stats,
    recentLlm: visibleLlmToCurrentAdmin(),
    recentTurns: visibleTurnsToCurrentAdmin(),
    recentNotifications: visibleNotificationsToCurrentAdmin(),
    recentToolFailures: visibleToolFailuresToCurrentAdmin(),
  }

  sendTo(controller, {
    type: 'state:init',
    timestamp: Date.now(),
    data: initData,
    scope: { kind: 'global' },
  })

  if (clients.size === 1) {
    startHeartbeat()
  }
}

export function removeClient(controller: ReadableStreamDefaultController): void {
  clients.delete(controller)

  if (clients.size === 0) {
    stopHeartbeat()
  }
}

let statsDebounceTimer: ReturnType<typeof setTimeout> | null = null

function scheduleStatsBroadcast(): void {
  if (clients.size === 0) return
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

function broadcastTrace(trace: LlmTrace, timestamp: number): void {
  if (clients.size === 0) return
  if (adminUserId === null || trace.userId !== adminUserId) return
  broadcast({ type: 'llm:full', timestamp, data: { ...trace }, scope: { kind: 'global' } })
}

function broadcastIfVisible(event: DebugEvent): void {
  if (clients.size === 0) return
  if (!isVisibleToAdmin(event.scope, adminVisibility)) return
  broadcast(event)
}

function onEvent(event: DebugEvent): void {
  handleLlmTraceEvent(event, { pushTrace, broadcastTrace }, stats, scheduleStatsBroadcast)
  if (event.type === 'message:received') {
    stats.totalMessages++
    scheduleStatsBroadcast()
  }
  handleTurnAssembly(event, broadcastIfVisible)
  broadcastIfVisible(event)
}

function isLogEntry(data: Record<string, unknown>): data is LogEntry {
  return typeof data['level'] === 'number' && typeof data['time'] === 'string' && typeof data['msg'] === 'string'
}

function broadcast(event: DebugEvent): void {
  const payload = formatSse(event)
  for (const [client, filter] of clients) {
    if (event.type === 'log:entry' && isLogEntry(event.data) && !entryMatchesFilter(event.data, filter)) continue
    try {
      client.enqueue(payload)
    } catch {
      removeClient(client)
    }
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
