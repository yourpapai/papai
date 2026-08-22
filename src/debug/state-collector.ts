// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getSessionSnapshots } from '../cache-snapshots.js'
import { getPollerSnapshot } from '../deferred-prompts/poller.js'
import { getMessageCacheSnapshot } from '../message-cache/cache.js'
import { getSchedulerSnapshot } from '../scheduler.js'
import { subscribe, unsubscribe, type DebugEvent } from './event-bus.js'
import {
  recentLlm,
  pushTrace,
  handleLlmTraceEvent,
  resetLlmBuffers,
  shapeLlmTrace,
  type LlmTrace,
} from './llm-trace-collector.js'
import { shapeLogEntry } from './log-buffer.js'
import type { LogEntry } from './log-buffer.js'
import { entryMatchesFilter, type LogFilter } from './log-filter-model.js'
import {
  recentTurns,
  recentNotifications,
  recentToolFailures,
  handleTurnAssembly,
  resetTurnBuffers,
} from './turn-assembly.js'
import { clientVisibility, isVisibleToAdmin, isOwnLogEntry } from './visibility.js'

export { resetTurnBuffers, findTurnById } from './turn-assembly.js'
export { recentLlm, pendingTraces } from './llm-trace-collector.js'
export { isVisibleToAdmin, isOwnLogEntry, ownTurnIdsForAdmin, type AdminVisibility } from './visibility.js'

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
let collectorStarted = false

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
 * While the persistent collector is armed, the client-driven subscription
 * (first `addClient` subscribes, last `removeClient` unsubscribes) stays up,
 * so the last client leaving never stops capture.
 */
export function startEventCollector(): void {
  collectorStarted = true
  subscribe(onEvent)
}

/** @public -- test seam: unsubscribe the capture handler. */
export function stopEventCollectorForTest(): void {
  collectorStarted = false
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

/**
 * `state:init` ships only the most recent N traces: the trace buffer holds up
 * to 65535 entries with embedded `generatedText`/`stepsDetail`, and the
 * dashboard's own trace working set is 1024 (`client/debug` `CAPS.TRACE`), so a
 * longer tail would only inflate the single-frame `JSON.stringify` on connect.
 */
export const STATE_INIT_LLM_TAIL = 1024

function buildInitData(adminUserId: string | undefined): Record<string, unknown> {
  const vis = clientVisibility(adminUserId)
  return {
    sessions: adminUserId === undefined ? [] : getSessionSnapshots(adminUserId),
    scheduler: getSchedulerSnapshot(),
    pollers: getPollerSnapshot(),
    messageCache: getMessageCacheSnapshot(),
    stats,
    recentLlm: recentLlm.slice(-STATE_INIT_LLM_TAIL).map((trace) => shapeLlmTrace(trace, adminUserId)),
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
    if (!collectorStarted) unsubscribe(onEvent)
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

function deliver(controller: ReadableStreamDefaultController, payload: Uint8Array | null): void {
  if (payload === null) return
  try {
    controller.enqueue(payload)
  } catch {
    removeClient(controller)
  }
}

function frameForClient(event: DebugEvent, registration: ClientRegistration): Uint8Array | null {
  if (event.type === 'log:entry') {
    if (!isLogEntry(event.data)) return null
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
