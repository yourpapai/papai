// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import type { DebugEvent } from './event-bus.js'
import { str, num, bool } from './state-collector-utils.js'

const ScopeSchema = z.object({
  kind: z.enum(['user', 'group', 'global']),
  userId: z.string().optional(),
  groupId: z.string().optional(),
  threadId: z.string().optional(),
})

export const TurnToolCallSchema = z.object({
  name: z.string(),
  durationMs: z.number(),
  ok: z.boolean(),
  failureReason: z.string().optional(),
})

export const TurnReplySchema = z.object({ durationMs: z.number() })

export const TurnSchema = z.object({
  turnId: z.string(),
  scope: ScopeSchema,
  startedAt: z.number(),
  endedAt: z.number().optional(),
  status: z.enum(['running', 'ok', 'error', 'cancelled']),
  incomingMessageCount: z.number(),
  toolCalls: z.array(TurnToolCallSchema),
  reply: TurnReplySchema.optional(),
  error: z.string().optional(),
})

export const NotificationSchema = z.object({
  timestamp: z.number(),
  type: z.string(),
  scope: ScopeSchema,
  data: z.record(z.string(), z.unknown()),
})

export const ToolFailureSchema = z.object({
  timestamp: z.number(),
  scope: ScopeSchema,
  data: z.record(z.string(), z.unknown()),
})

export type Turn = z.infer<typeof TurnSchema>
export type Notification = z.infer<typeof NotificationSchema>
export type ToolFailure = z.infer<typeof ToolFailureSchema>

const RECENT_TURNS_CAPACITY = 512
const RECENT_NOTIFICATIONS_CAPACITY = 2048
const RECENT_TOOL_FAILURES_CAPACITY = 1024

export const recentTurns: Turn[] = []
export const recentNotifications: Notification[] = []
export const recentToolFailures: ToolFailure[] = []
export const inFlightTurns = new Map<string, Turn>()

function pushTurn(turn: Turn): void {
  if (recentTurns.length >= RECENT_TURNS_CAPACITY) recentTurns.shift()
  recentTurns.push(turn)
}

function pushNotification(entry: Notification): void {
  if (recentNotifications.length >= RECENT_NOTIFICATIONS_CAPACITY) recentNotifications.shift()
  recentNotifications.push(entry)
}

function pushToolFailure(entry: ToolFailure): void {
  if (recentToolFailures.length >= RECENT_TOOL_FAILURES_CAPACITY) recentToolFailures.shift()
  recentToolFailures.push(entry)
}

export function resetTurnBuffers(): void {
  recentTurns.length = 0
  recentNotifications.length = 0
  recentToolFailures.length = 0
  inFlightTurns.clear()
}

export function findTurnById(turnId: string): Turn | undefined {
  return recentTurns.find((t) => t.turnId === turnId)
}

export function getRecentTurns(): readonly Turn[] {
  return recentTurns
}

export function getRecentNotifications(): readonly Notification[] {
  return recentNotifications
}

export function getRecentToolFailures(): readonly ToolFailure[] {
  return recentToolFailures
}

export function getInFlightTurns(): ReadonlyMap<string, Turn> {
  return inFlightTurns
}

function handleTurnStart(event: DebugEvent): void {
  const turnId = str(event.data['turnId'])
  if (turnId === '') return
  const turn: Turn = {
    turnId,
    scope: event.scope,
    startedAt: event.timestamp,
    status: 'running',
    incomingMessageCount: num(event.data['incomingMessageCount']),
    toolCalls: [],
  }
  inFlightTurns.set(turnId, turn)
}

export function handleTurnEnd(event: DebugEvent, broadcast: (event: DebugEvent) => void): void {
  const turnId = str(event.data['turnId'])
  if (turnId === '') return
  const turn = inFlightTurns.get(turnId)
  inFlightTurns.delete(turnId)
  if (turn === undefined) return

  const rawStatus = str(event.data['status'])
  const status: Turn['status'] =
    rawStatus === 'ok' || rawStatus === 'error' || rawStatus === 'cancelled' ? rawStatus : 'ok'

  turn.endedAt = event.timestamp
  turn.status = status
  const error = str(event.data['error'])
  if (error !== '') turn.error = error

  pushTurn(turn)

  broadcast({
    type: 'turn:summary',
    timestamp: event.timestamp,
    data: { ...turn },
    scope: event.scope,
  })
}

function handleToolFailureClassified(event: DebugEvent): void {
  const turnId = str(event.data['turnId'])
  const toolName = str(event.data['toolName'])
  const durationMs = num(event.data['durationMs'])
  const ok = bool(event.data['ok'])
  const failureReason = str(event.data['failureReason'])

  const turn = inFlightTurns.get(turnId)
  if (turn !== undefined) {
    turn.toolCalls.push({
      name: toolName,
      durationMs,
      ok,
      failureReason: failureReason === '' ? undefined : failureReason,
    })
  }

  pushToolFailure({ timestamp: event.timestamp, scope: event.scope, data: event.data })
}

function handleNotification(event: DebugEvent): void {
  pushNotification({ timestamp: event.timestamp, type: event.type, scope: event.scope, data: event.data })
}

export function handleTurnAssembly(event: DebugEvent, broadcast: (event: DebugEvent) => void): void {
  if (event.type === 'turn:start') handleTurnStart(event)
  else if (event.type === 'turn:end') handleTurnEnd(event, broadcast)
  else if (event.type === 'tool:failure_classified') handleToolFailureClassified(event)
  else if (
    event.type === 'reply:sent' ||
    event.type === 'typing:start' ||
    event.type === 'typing:stop' ||
    event.type.startsWith('notify:')
  ) {
    handleNotification(event)
  }
}
