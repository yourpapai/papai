// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getSessionSnapshots } from '../cache-snapshots.js'
import { getPollerSnapshot } from '../deferred-prompts/poller.js'
import { getMessageCacheSnapshot } from '../message-cache/cache.js'
import { getSchedulerSnapshot } from '../scheduler.js'
import { getWizardSnapshots } from '../wizard/state.js'
import { subscribe, unsubscribe, type DebugEvent, type Scope } from './event-bus.js'
import { recentLlm, pushTrace, handleLlmTraceEvent, type LlmTrace } from './llm-trace-collector.js'
import { recentTurns, recentNotifications, recentToolFailures, handleTurnAssembly } from './turn-assembly.js'

export { recentTurns, recentNotifications, recentToolFailures } from './turn-assembly.js'
export { inFlightTurns, resetTurnBuffers, findTurnById } from './turn-assembly.js'
export { getRecentTurns, getRecentNotifications, getRecentToolFailures, getInFlightTurns } from './turn-assembly.js'
export { recentLlm, pendingTraces } from './llm-trace-collector.js'
export type { LlmTrace } from './llm-trace-collector.js'

let adminUserId: string | null = null
let adminVisibility: AdminVisibility = { adminUserId: '', groupIds: new Set() }

const clients = new Set<ReadableStreamDefaultController>()
const encoder = new TextEncoder()

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

export function isVisibleToAdmin(scope: Scope | null | undefined, vis: AdminVisibility): boolean {
  if (scope === null || scope === undefined || typeof scope.kind !== 'string') return false
  if (scope.kind === 'global') return true
  if (scope.kind === 'user') return scope.userId === vis.adminUserId
  if (scope.kind === 'group') return vis.groupIds.has(scope.groupId)
  return false
}

export function applyVisibility<T>(entries: T[], getScope: (entry: T) => Scope, vis: AdminVisibility): T[] {
  return entries.filter((entry) => isVisibleToAdmin(getScope(entry), vis))
}

export function addClient(controller: ReadableStreamDefaultController): void {
  clients.add(controller)

  const initData: Record<string, unknown> = {
    sessions: adminUserId === null ? [] : getSessionSnapshots(adminUserId),
    wizards: adminUserId === null ? [] : getWizardSnapshots(adminUserId),
    scheduler: getSchedulerSnapshot(),
    pollers: getPollerSnapshot(),
    messageCache: getMessageCacheSnapshot(),
    stats,
    recentLlm,
    recentTurns,
    recentNotifications,
    recentToolFailures,
  }

  sendTo(controller, { type: 'state:init', timestamp: Date.now(), data: initData, __scope: { kind: 'global' } })

  if (clients.size === 1) {
    subscribe(onEvent)
  }
}

export function removeClient(controller: ReadableStreamDefaultController): void {
  clients.delete(controller)

  if (clients.size === 0) {
    unsubscribe(onEvent)
  }
}

let statsDebounceTimer: ReturnType<typeof setTimeout> | null = null

function scheduleStatsBroadcast(): void {
  if (statsDebounceTimer !== null) return
  statsDebounceTimer = setTimeout(() => {
    statsDebounceTimer = null
    broadcast({ type: 'state:stats', timestamp: Date.now(), data: { ...stats }, __scope: { kind: 'global' } })
  }, 500)
}

function broadcastTrace(trace: LlmTrace, timestamp: number): void {
  broadcast({ type: 'llm:full', timestamp, data: { ...trace }, __scope: { kind: 'global' } })
}

function onEvent(event: DebugEvent): void {
  if (!isVisibleToAdmin(event.__scope, adminVisibility)) return
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
      clients.delete(client)
    }
  }
}

function sendTo(controller: ReadableStreamDefaultController, event: DebugEvent): void {
  try {
    controller.enqueue(formatSse(event))
  } catch {
    clients.delete(controller)
  }
}

function formatSse(event: DebugEvent): Uint8Array {
  return encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
}
