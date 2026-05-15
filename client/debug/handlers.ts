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

const NOTIFICATION_CAP = 2048
const TOOL_FAILURE_CAP = 1024
const RECURRING_CAP = 512
const DEFERRED_CAP = 512
const MEMO_CAP = 1024

let logRenderPending = false
let sessionsRenderPending = false
let tracesRenderPending = false
let turnsRenderPending = false
let notificationsRenderPending = false
let toolFailuresRenderPending = false
let remindersRenderPending = false
let memosRenderPending = false

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

export function scheduleTurnsRender(): void {
  if (!turnsRenderPending) {
    turnsRenderPending = true
    requestAnimationFrame(() => {
      turnsRenderPending = false
      window.dashboard.renderTurns()
    })
  }
}

export function scheduleNotificationsRender(): void {
  if (!notificationsRenderPending) {
    notificationsRenderPending = true
    requestAnimationFrame(() => {
      notificationsRenderPending = false
      window.dashboard.renderNotifications()
    })
  }
}

export function scheduleToolFailuresRender(): void {
  if (!toolFailuresRenderPending) {
    toolFailuresRenderPending = true
    requestAnimationFrame(() => {
      toolFailuresRenderPending = false
      window.dashboard.renderToolFailures()
    })
  }
}

export function scheduleRemindersRender(): void {
  if (!remindersRenderPending) {
    remindersRenderPending = true
    requestAnimationFrame(() => {
      remindersRenderPending = false
      window.dashboard.renderReminders()
    })
  }
}

export function scheduleMemosRender(): void {
  if (!memosRenderPending) {
    memosRenderPending = true
    requestAnimationFrame(() => {
      memosRenderPending = false
      window.dashboard.renderMemos()
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
    state.turns = d.recentTurns as Turn[]
  }
  if (Array.isArray(d.recentNotifications)) {
    state.notifications = d.recentNotifications as Notification[]
  }
  if (Array.isArray(d.recentToolFailures)) {
    state.toolFailures = d.recentToolFailures as ToolFailure[]
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

export function handleTurnStart(d: Record<string, unknown>): void {
  const turnId = typeof d['turnId'] === 'string' ? d['turnId'] : ''
  if (turnId === '') return
  const scope = (d['scope'] as Turn['scope']) ?? { kind: 'global' }
  const incomingMessageCount = typeof d['incomingMessageCount'] === 'number' ? d['incomingMessageCount'] : 1

  const turn: Turn = {
    turnId,
    scope,
    startedAt: Date.now(),
    status: 'running',
    incomingMessageCount,
    toolCalls: [],
  }
  state.turns.unshift(turn)
  if (state.turns.length > 512) state.turns.pop()
  scheduleTurnsRender()
}

export function handleTurnEnd(d: Record<string, unknown>): void {
  const turnId = typeof d['turnId'] === 'string' ? d['turnId'] : ''
  if (turnId === '') return
  const status = typeof d['status'] === 'string' ? d['status'] : 'ok'
  const error = typeof d['error'] === 'string' ? d['error'] : undefined

  const turn = state.turns.find((t) => t.turnId === turnId)
  if (turn !== undefined) {
    turn.endedAt = Date.now()
    turn.status = status as Turn['status']
    if (error !== undefined) turn.error = error
  }
  scheduleTurnsRender()
}

export function handleTurnSummary(d: Record<string, unknown>): void {
  const turnId = typeof d['turnId'] === 'string' ? d['turnId'] : ''
  if (turnId === '') return

  const existing = state.turns.findIndex((t) => t.turnId === turnId)
  if (existing !== -1) {
    state.turns[existing] = d as unknown as Turn
  } else {
    state.turns.unshift(d as unknown as Turn)
    if (state.turns.length > 512) state.turns.pop()
  }
  scheduleTurnsRender()
}

export function handleNotificationEvent(type: string, d: Record<string, unknown>): void {
  const scope = (d['scope'] as Notification['scope']) ?? { kind: 'global' }
  const notification: Notification = {
    timestamp: Date.now(),
    type,
    scope,
    data: d,
  }
  state.notifications.unshift(notification)
  if (state.notifications.length > NOTIFICATION_CAP) state.notifications.pop()
  scheduleNotificationsRender()
}

export function handleToolFailureClassified(d: Record<string, unknown>): void {
  const scope = (d['scope'] as ToolFailure['scope']) ?? { kind: 'global' }
  const failure: ToolFailure = {
    timestamp: Date.now(),
    scope,
    data: d,
  }
  state.toolFailures.unshift(failure)
  if (state.toolFailures.length > TOOL_FAILURE_CAP) state.toolFailures.pop()
  scheduleToolFailuresRender()
}

export function handleRecurringEvent(type: string, d: Record<string, unknown>): void {
  const taskId = typeof d['taskId'] === 'string' ? d['taskId'] : ''
  if (taskId === '') return

  if (type === 'recurring:created') {
    const task = {
      id: taskId,
      userId: typeof d['userId'] === 'string' ? d['userId'] : '',
      title: typeof d['title'] === 'string' ? d['title'] : 'Untitled',
      rrule: typeof d['rrule'] === 'string' ? d['rrule'] : null,
      nextRun: typeof d['nextRun'] === 'string' ? d['nextRun'] : null,
      enabled: true,
      lastRun: null,
    }
    state.recurringTasks.unshift(task)
    if (state.recurringTasks.length > RECURRING_CAP) state.recurringTasks.pop()
  } else if (type === 'recurring:updated') {
    const existing = state.recurringTasks.find((t) => t.id === taskId)
    if (existing !== undefined) {
      if (typeof d['title'] === 'string') existing.title = d['title']
      if (typeof d['rrule'] === 'string') existing.rrule = d['rrule']
      if (typeof d['nextRun'] === 'string') existing.nextRun = d['nextRun']
    }
  } else if (type === 'recurring:paused') {
    const existing = state.recurringTasks.find((t) => t.id === taskId)
    if (existing !== undefined) existing.enabled = false
  } else if (type === 'recurring:resumed') {
    const existing = state.recurringTasks.find((t) => t.id === taskId)
    if (existing !== undefined) existing.enabled = true
  } else if (type === 'recurring:deleted') {
    state.recurringTasks = state.recurringTasks.filter((t) => t.id !== taskId)
  }
  scheduleRemindersRender()
}

export function handleDeferredEvent(type: string, d: Record<string, unknown>): void {
  const promptId = typeof d['promptId'] === 'string' ? d['promptId'] : ''
  if (promptId === '') return

  if (type === 'deferred:created') {
    const prompt = {
      id: promptId,
      createdByUserId: typeof d['userId'] === 'string' ? d['userId'] : '',
      prompt: typeof d['prompt'] === 'string' ? d['prompt'] : '',
      fireAt: typeof d['fireAt'] === 'string' ? d['fireAt'] : new Date().toISOString(),
      rrule: typeof d['rrule'] === 'string' ? d['rrule'] : null,
      status: 'active',
    }
    state.deferredPrompts.unshift(prompt)
    if (state.deferredPrompts.length > DEFERRED_CAP) state.deferredPrompts.pop()
  } else if (type === 'deferred:updated') {
    const existing = state.deferredPrompts.find((p) => p.id === promptId)
    if (existing !== undefined) {
      if (typeof d['prompt'] === 'string') existing.prompt = d['prompt']
      if (typeof d['fireAt'] === 'string') existing.fireAt = d['fireAt']
    }
  } else if (type === 'deferred:cancelled') {
    state.deferredPrompts = state.deferredPrompts.filter((p) => p.id !== promptId)
  } else if (type === 'deferred:fired') {
    const existing = state.deferredPrompts.find((p) => p.id === promptId)
    if (existing !== undefined) existing.status = 'completed'
  }
  scheduleRemindersRender()
}

export function handleMemoEvent(type: string, d: Record<string, unknown>): void {
  const memoId = typeof d['memoId'] === 'string' ? d['memoId'] : ''
  if (memoId === '') return

  if (type === 'memo:created') {
    const memo = {
      id: memoId,
      userId: typeof d['userId'] === 'string' ? d['userId'] : '',
      content: typeof d['content'] === 'string' ? d['content'] : '',
      summary: null,
      tags: Array.isArray(d['tags']) ? d['tags'].filter((t): t is string => typeof t === 'string') : [],
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    state.memos.unshift(memo)
    if (state.memos.length > MEMO_CAP) state.memos.pop()
  } else if (type === 'memo:archived') {
    const memoIds = Array.isArray(d['memoIds']) ? d['memoIds'].filter((id): id is string => typeof id === 'string') : []
    for (const id of memoIds) {
      const existing = state.memos.find((m) => m.id === id)
      if (existing !== undefined) existing.status = 'archived'
    }
  }
  scheduleMemosRender()
}

type EventHandler = (d: unknown) => void

export const handlers: Record<string, EventHandler> = {
  'state:init': (d: unknown): void => {
    handleStateInit(parseStateInitEvent(d))
  },
  'state:stats': (d: unknown): void => {
    handleStateStats(parseStateStatsEvent(d))
  },
  'llm:full': (d: unknown): void => {
    handleLlmFull(parseLlmTrace(d))
  },
  'cache:load': (d: unknown): void => {
    handleCacheEvent(parseCacheEvent(d))
  },
  'cache:sync': (d: unknown): void => {
    handleCacheEvent(parseCacheEvent(d))
  },
  'cache:expire': (d: unknown): void => {
    handleCacheExpire(parseUserIdEvent(d))
  },
  'wizard:created': (d: unknown): void => {
    handleWizardCreated(parseWizard(d))
  },
  'wizard:updated': (d: unknown): void => {
    handleWizardUpdated(parseWizard(d) as Partial<Wizard> & { userId: string })
  },
  'wizard:deleted': (d: unknown): void => {
    handleWizardDeleted(parseUserIdEvent(d))
  },
  'scheduler:tick': (d: unknown): void => {
    handleSchedulerTick(parseSchedulerTickEvent(d))
  },
  'poller:scheduled': (d: unknown): void => {
    handlePollerEvent(parsePollerEvent(d))
  },
  'poller:alerts': (d: unknown): void => {
    handlePollerEvent(parsePollerEvent(d))
  },
  'msgcache:sweep': (d: unknown): void => {
    handleMsgcacheSweep(parseMessageCacheEvent(d))
  },
  'log:entry': (d: unknown): void => {
    handleLogEntry(parseLogEntry(d))
  },
  'turn:start': (d: unknown): void => {
    handleTurnStart(d as Record<string, unknown>)
  },
  'turn:end': (d: unknown): void => {
    handleTurnEnd(d as Record<string, unknown>)
  },
  'turn:summary': (d: unknown): void => {
    handleTurnSummary(d as Record<string, unknown>)
  },
  'reply:sent': (d: unknown): void => {
    handleNotificationEvent('reply:sent', d as Record<string, unknown>)
  },
  'typing:start': (d: unknown): void => {
    handleNotificationEvent('typing:start', d as Record<string, unknown>)
  },
  'typing:stop': (d: unknown): void => {
    handleNotificationEvent('typing:stop', d as Record<string, unknown>)
  },
  'notify:scheduler_fired': (d: unknown): void => {
    handleNotificationEvent('notify:scheduler_fired', d as Record<string, unknown>)
  },
  'notify:deferred_alert': (d: unknown): void => {
    handleNotificationEvent('notify:deferred_alert', d as Record<string, unknown>)
  },
  'tool:failure_classified': (d: unknown): void => {
    handleToolFailureClassified(d as Record<string, unknown>)
  },
  'recurring:created': (d: unknown): void => {
    handleRecurringEvent('recurring:created', d as Record<string, unknown>)
  },
  'recurring:updated': (d: unknown): void => {
    handleRecurringEvent('recurring:updated', d as Record<string, unknown>)
  },
  'recurring:paused': (d: unknown): void => {
    handleRecurringEvent('recurring:paused', d as Record<string, unknown>)
  },
  'recurring:resumed': (d: unknown): void => {
    handleRecurringEvent('recurring:resumed', d as Record<string, unknown>)
  },
  'recurring:deleted': (d: unknown): void => {
    handleRecurringEvent('recurring:deleted', d as Record<string, unknown>)
  },
  'recurring:fired': (d: unknown): void => {
    handleRecurringEvent('recurring:fired', d as Record<string, unknown>)
  },
  'deferred:created': (d: unknown): void => {
    handleDeferredEvent('deferred:created', d as Record<string, unknown>)
  },
  'deferred:updated': (d: unknown): void => {
    handleDeferredEvent('deferred:updated', d as Record<string, unknown>)
  },
  'deferred:cancelled': (d: unknown): void => {
    handleDeferredEvent('deferred:cancelled', d as Record<string, unknown>)
  },
  'deferred:fired': (d: unknown): void => {
    handleDeferredEvent('deferred:fired', d as Record<string, unknown>)
  },
  'deferred:alerted': (d: unknown): void => {
    handleDeferredEvent('deferred:alerted', d as Record<string, unknown>)
  },
  'memo:created': (d: unknown): void => {
    handleMemoEvent('memo:created', d as Record<string, unknown>)
  },
  'memo:archived': (d: unknown): void => {
    handleMemoEvent('memo:archived', d as Record<string, unknown>)
  },
}
