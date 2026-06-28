// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getSessionSnapshots } from '../cache-snapshots.js'
import { getPollerSnapshot } from '../deferred-prompts/poller.js'
import { getMessageCacheSnapshot } from '../message-cache/cache.js'
import { getSchedulerSnapshot } from '../scheduler.js'
import { subscribe, unsubscribe, type DebugEvent } from './event-bus.js'
import { recentLlm, pushTrace, handleLlmTraceEvent, type LlmTrace } from './llm-trace-collector.js'
import { recentTurns, recentNotifications, recentToolFailures, handleTurnAssembly } from './turn-assembly.js'
import type { Turn } from './turn-assembly.js'

export { recentTurns, recentNotifications, recentToolFailures } from './turn-assembly.js'
export { inFlightTurns, resetTurnBuffers, findTurnById } from './turn-assembly.js'
export { recentLlm, pendingTraces } from './llm-trace-collector.js'
export type { LlmTrace } from './llm-trace-collector.js'

let adminUserId: string | null = null
let adminVisibility: AdminVisibility = { adminUserId: '', groupIds: new Set() }

const clients = new Set<ReadableStreamDefaultController>()
const encoder = new TextEncoder()

const HEARTBEAT_MS = 15000
const PING_FRAME = encoder.encode(': ping\n\n')
let heartbeatTimer: ReturnType<typeof setInterval> | null = null

function pingClients(): void {
  for (const client of clients) {
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
  for (const client of [...clients]) removeClient(client)
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

export function addClient(controller: ReadableStreamDefaultController): void {
  clients.add(controller)

  const initData: Record<string, unknown> = {
    sessions: adminUserId === null ? [] : getSessionSnapshots(adminUserId),
    scheduler: getSchedulerSnapshot(),
    pollers: getPollerSnapshot(),
    messageCache: getMessageCacheSnapshot(),
    stats,
    recentLlm,
    recentTurns,
    recentNotifications,
    recentToolFailures,
  }

  sendTo(controller, {
    type: 'state:init',
    timestamp: Date.now(),
    data: initData,
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

function broadcastTrace(trace: LlmTrace, timestamp: number): void {
  broadcast({ type: 'llm:full', timestamp, data: { ...trace }, scope: { kind: 'global' } })
}

function onEvent(event: DebugEvent): void {
  if (!isVisibleToAdmin(event.scope, adminVisibility)) return
  handleLlmTraceEvent(event, { pushTrace, broadcastTrace }, stats, scheduleStatsBroadcast)
  if (event.type === 'message:received') {
    stats.totalMessages++
    scheduleStatsBroadcast()
  }
  handleTurnAssembly(event, broadcast)
  broadcast(event)
}

function broadcast(event: DebugEvent): void {
  const payload = formatSse(event)
  for (const client of clients) {
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
