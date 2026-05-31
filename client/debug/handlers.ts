// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type {
  Wizard,
  LlmTrace,
  LogEntry,
  StateInitEvent,
  StateStatsEvent,
  CacheEvent,
  UserIdEvent,
  SchedulerTickEvent,
  PollerEvent,
  MessageCacheEvent,
  Turn,
  Notification,
  ToolFailure,
} from '../../src/debug/schemas.js'
import {
  safeParseSession,
  safeParseWizard,
  safeParseLlmTrace,
  safeParseTurn,
  safeParseNotification,
  safeParseToolFailure,
} from '../../src/debug/schemas.js'
import type { DashboardState, DashboardWizard } from './dashboard-types.js'
import { CAPS, isValidTurnStatus, parseScope, pickString } from './handlers-helpers.js'

export const LOG_CAP = CAPS.LOG

function wizardToDashboardWizard(w: Wizard): DashboardWizard {
  return { userId: w.userId, currentStep: w.currentStep, totalSteps: w.totalSteps }
}

export function handleStateInit(state: DashboardState, d: StateInitEvent): void {
  state.sessions.clear()
  if (Array.isArray(d.sessions)) {
    for (const s of d.sessions) {
      const session = safeParseSession(s)
      if (session !== null) state.sessions.set(session.userId, session)
    }
  }
  state.wizards.clear()
  if (Array.isArray(d.wizards)) {
    for (const w of d.wizards) {
      const wizard = safeParseWizard(w)
      if (wizard !== null) state.wizards.set(wizard.userId, wizardToDashboardWizard(wizard))
    }
  }
  state.scheduler = d.scheduler ?? {}
  state.pollers = d.pollers ?? {}
  state.messageCache = d.messageCache ?? {}
  Object.assign(state.stats, d.stats ?? {})
  state.llmTraces = Array.isArray(d.recentLlm)
    ? d.recentLlm
        .map(safeParseLlmTrace)
        .filter((t): t is LlmTrace => t !== null)
        .reverse()
    : []
  if (Array.isArray(d.recentTurns)) {
    state.turns = d.recentTurns.map(safeParseTurn).filter((t): t is Turn => t !== null)
  }
  if (Array.isArray(d.recentNotifications)) {
    state.notifications = d.recentNotifications.map(safeParseNotification).filter((n): n is Notification => n !== null)
  }
  if (Array.isArray(d.recentToolFailures)) {
    state.toolFailures = d.recentToolFailures.map(safeParseToolFailure).filter((f): f is ToolFailure => f !== null)
  }
}

export function handleStateStats(state: DashboardState, d: StateStatsEvent): void {
  Object.assign(state.stats, d)
}

export function handleLlmFull(state: DashboardState, d: LlmTrace): void {
  state.llmTraces.unshift(d)
  if (state.llmTraces.length > CAPS.TRACE) state.llmTraces.pop()
}

export function handleCacheEvent(state: DashboardState, d: CacheEvent): void {
  const userId = d.userId
  const existing = state.sessions.get(userId)
  if (existing === undefined) {
    state.sessions.set(userId, {
      userId,
      lastAccessed: Date.now(),
      historyLength: 0,
      factsCount: 0,
      summary: null,
      configKeys: [],
    })
    return
  }
  if (d.field === 'history') existing.historyLength = (existing.historyLength ?? 0) + 1
  existing.lastAccessed = Date.now()
}

export function handleCacheExpire(state: DashboardState, d: UserIdEvent): void {
  state.sessions.delete(d.userId)
  state.wizards.delete(d.userId)
}

export function handleWizardCreated(state: DashboardState, d: Wizard): void {
  state.wizards.set(d.userId, wizardToDashboardWizard(d))
}

export function handleWizardUpdated(state: DashboardState, d: Partial<Wizard> & { userId: string }): void {
  const existing = state.wizards.get(d.userId)
  if (existing === undefined) {
    state.wizards.set(d.userId, {
      userId: d.userId,
      currentStep: d.currentStep ?? '---',
      totalSteps: d.totalSteps ?? '---',
    })
    return
  }
  if (d.currentStep !== undefined) existing.currentStep = d.currentStep
  if (d.totalSteps !== undefined) existing.totalSteps = d.totalSteps
}

export function handleWizardDeleted(state: DashboardState, d: UserIdEvent): void {
  state.wizards.delete(d.userId)
}

export function handleSchedulerTick(state: DashboardState, d: SchedulerTickEvent): void {
  Object.assign(state.scheduler, d)
}

export function handlePollerEvent(state: DashboardState, d: PollerEvent): void {
  Object.assign(state.pollers, d)
}

export function handleMsgcacheSweep(state: DashboardState, d: MessageCacheEvent): void {
  Object.assign(state.messageCache, d)
}

export function handleLogEntry(state: DashboardState, d: LogEntry): void {
  state.logs.push(d)
  if (state.logs.length > CAPS.LOG) state.logs.shift()
  if (d.scope !== undefined) state.logScopes.add(d.scope)
}

export function handleTurnStart(state: DashboardState, d: Record<string, unknown>): void {
  const turnId = pickString(d, 'turnId')
  if (turnId === '') return
  const incomingMessageCount = typeof d['incomingMessageCount'] === 'number' ? d['incomingMessageCount'] : 1
  state.turns.unshift({
    turnId,
    scope: parseScope(d['scope']),
    startedAt: Date.now(),
    status: 'running',
    incomingMessageCount,
    toolCalls: [],
  })
  if (state.turns.length > CAPS.TURN) state.turns.pop()
}

export function handleTurnEnd(state: DashboardState, d: Record<string, unknown>): void {
  const turnId = pickString(d, 'turnId')
  if (turnId === '') return
  const turn = state.turns.find((t) => t.turnId === turnId)
  if (turn === undefined) return
  turn.endedAt = Date.now()
  const status = pickString(d, 'status') || 'ok'
  turn.status = isValidTurnStatus(status) ? status : 'ok'
  const error = pickString(d, 'error')
  if (error !== '') turn.error = error
}

export function handleTurnSummary(state: DashboardState, d: Record<string, unknown>): void {
  if (pickString(d, 'turnId') === '') return
  const parsed = safeParseTurn(d)
  if (parsed === null) return
  const idx = state.turns.findIndex((t) => t.turnId === parsed.turnId)
  if (idx === -1) {
    state.turns.unshift(parsed)
    if (state.turns.length > CAPS.TURN) state.turns.pop()
  } else {
    state.turns[idx] = parsed
  }
}

export function handleNotificationEvent(state: DashboardState, type: string, d: Record<string, unknown>): void {
  state.notifications.unshift({
    timestamp: Date.now(),
    type,
    scope: parseScope(d['scope']),
    data: d,
  })
  if (state.notifications.length > CAPS.NOTIFICATION) state.notifications.pop()
}

export function handleToolFailureClassified(state: DashboardState, d: Record<string, unknown>): void {
  state.toolFailures.unshift({ timestamp: Date.now(), scope: parseScope(d['scope']), data: d })
  if (state.toolFailures.length > CAPS.TOOL_FAILURE) state.toolFailures.pop()
}
