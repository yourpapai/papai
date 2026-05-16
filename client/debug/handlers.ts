// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/// <reference lib="dom" />
import {
  type Wizard,
  type LlmTrace,
  type LogEntry,
  type StateInitEvent,
  type StateStatsEvent,
  type CacheEvent,
  type UserIdEvent,
  type SchedulerTickEvent,
  type PollerEvent,
  type MessageCacheEvent,
  type Turn,
  type Notification,
  type ToolFailure,
  safeParseSession,
  safeParseWizard,
  safeParseLlmTrace,
  safeParseTurn,
  safeParseNotification,
  safeParseToolFailure,
  parseStateInitEvent,
  parseStateStatsEvent,
  parseLlmTrace,
  parseCacheEvent,
  parseUserIdEvent,
  parseWizard,
  parseSchedulerTickEvent,
  parsePollerEvent,
  parseMessageCacheEvent,
  parseLogEntry,
} from '../../src/debug/schemas.js'
import type { DashboardWizard } from './dashboard-types.js'
import { state, LOG_CAP, renderAll } from './state.js'

let logRenderPending = false
let sessionsRenderPending = false
let tracesRenderPending = false

export function scheduleLogRender(): void {
  if (!logRenderPending) {
    logRenderPending = true
    requestAnimationFrame(() => {
      logRenderPending = false
      window.dashboard.renderLogs()
    })
  }
}

export function scheduleSessionsRender(): void {
  if (!sessionsRenderPending) {
    sessionsRenderPending = true
    requestAnimationFrame(() => {
      sessionsRenderPending = false
      window.dashboard.renderSessions(state.sessions, state.wizards)
    })
  }
}

export function scheduleTracesRender(): void {
  if (!tracesRenderPending) {
    tracesRenderPending = true
    requestAnimationFrame(() => {
      tracesRenderPending = false
      window.dashboard.renderTraces(state.llmTraces)
    })
  }
}

export function handleStateInit(d: StateInitEvent): void {
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

  renderAll()
}

export function handleStateStats(d: StateStatsEvent): void {
  Object.assign(state.stats, d)
  window.dashboard.renderStats(state.stats)
}

export function handleLlmFull(d: LlmTrace): void {
  state.llmTraces.unshift(d)
  if (state.llmTraces.length > LOG_CAP) state.llmTraces.pop()
  scheduleTracesRender()
}

export function handleCacheEvent(d: CacheEvent): void {
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
      workspaceId: null,
    })
  } else {
    if (d.field === 'history') existing.historyLength = (existing.historyLength ?? 0) + 1
    existing.lastAccessed = Date.now()
  }
  scheduleSessionsRender()
}

export function handleCacheExpire(d: UserIdEvent): void {
  state.sessions.delete(d.userId)
  state.wizards.delete(d.userId)
  scheduleSessionsRender()
}

function wizardToDashboardWizard(wizard: Wizard): DashboardWizard {
  return {
    userId: wizard.userId,
    currentStep: wizard.currentStep,
    totalSteps: wizard.totalSteps,
  }
}

export function handleWizardCreated(d: Wizard): void {
  state.wizards.set(d.userId, wizardToDashboardWizard(d))
  scheduleSessionsRender()
}

export function handleWizardUpdated(d: Partial<Wizard> & { userId: string }): void {
  const existing = state.wizards.get(d.userId)
  if (existing === undefined) {
    const newWizard: DashboardWizard = {
      userId: d.userId,
      currentStep: d.currentStep ?? '---',
      totalSteps: d.totalSteps ?? '---',
    }
    state.wizards.set(d.userId, newWizard)
  } else {
    if (d.currentStep !== undefined) existing.currentStep = d.currentStep
    if (d.totalSteps !== undefined) existing.totalSteps = d.totalSteps
  }
  scheduleSessionsRender()
}

export function handleWizardDeleted(d: UserIdEvent): void {
  state.wizards.delete(d.userId)
  scheduleSessionsRender()
}

export function handleSchedulerTick(d: SchedulerTickEvent): void {
  Object.assign(state.scheduler, d)
  window.dashboard.renderInfra(state.scheduler, state.pollers, state.messageCache)
}

export function handlePollerEvent(d: PollerEvent): void {
  Object.assign(state.pollers, d)
  window.dashboard.renderInfra(state.scheduler, state.pollers, state.messageCache)
}

export function handleMsgcacheSweep(d: MessageCacheEvent): void {
  Object.assign(state.messageCache, d)
  window.dashboard.renderInfra(state.scheduler, state.pollers, state.messageCache)
}

export function handleLogEntry(d: LogEntry): void {
  state.logs.push(d)
  if (state.logs.length > LOG_CAP) state.logs.shift()

  if (d.scope !== undefined && !state.logScopes.has(d.scope)) {
    state.logScopes.add(d.scope)
    window.dashboard.updateScopeFilter(state.logScopes)
  }

  scheduleLogRender()
}

import { buildExtendedHandlers } from './handlers-event-map.js'

type EventHandler = (d: Record<string, unknown>) => void

const baseHandlers: Record<string, EventHandler> = {
  'state:init': (d): void => {
    handleStateInit(parseStateInitEvent(d))
  },
  'state:stats': (d): void => {
    handleStateStats(parseStateStatsEvent(d))
  },
  'llm:full': (d): void => {
    handleLlmFull(parseLlmTrace(d))
  },
  'cache:load': (d): void => {
    handleCacheEvent(parseCacheEvent(d))
  },
  'cache:sync': (d): void => {
    handleCacheEvent(parseCacheEvent(d))
  },
  'cache:expire': (d): void => {
    handleCacheExpire(parseUserIdEvent(d))
  },
  'wizard:created': (d): void => {
    handleWizardCreated(parseWizard(d))
  },
  'wizard:updated': (d): void => {
    handleWizardUpdated(parseWizard(d))
  },
  'wizard:deleted': (d): void => {
    handleWizardDeleted(parseUserIdEvent(d))
  },
  'scheduler:tick': (d): void => {
    handleSchedulerTick(parseSchedulerTickEvent(d))
  },
  'poller:scheduled': (d): void => {
    handlePollerEvent(parsePollerEvent(d))
  },
  'poller:alerts': (d): void => {
    handlePollerEvent(parsePollerEvent(d))
  },
  'msgcache:sweep': (d): void => {
    handleMsgcacheSweep(parseMessageCacheEvent(d))
  },
  'log:entry': (d): void => {
    handleLogEntry(parseLogEntry(d))
  },
}

export const handlers: Record<string, EventHandler> = buildExtendedHandlers(baseHandlers)
