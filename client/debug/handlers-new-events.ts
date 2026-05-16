// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.
/// <reference lib="dom" />
import { type Turn, type Notification, type ToolFailure, safeParseTurn } from '../../src/debug/schemas.js'
import { state } from './state.js'

const NOTIFICATION_CAP = 2048
const TOOL_FAILURE_CAP = 1024
const RECURRING_CAP = 512
const DEFERRED_CAP = 512
const MEMO_CAP = 1024

const VALID_TURN_STATUSES: ReadonlySet<string> = new Set(['running', 'ok', 'error', 'cancelled'])

function isValidTurnStatus(s: string): s is Turn['status'] {
  return VALID_TURN_STATUSES.has(s)
}

function parseScope(value: unknown): Turn['scope'] {
  if (typeof value === 'object' && value !== null && 'kind' in value) {
    const obj = value as Record<string, unknown>
    const kind = obj['kind']
    if (kind === 'user' || kind === 'group' || kind === 'global') {
      const scope: Turn['scope'] = { kind }
      if (typeof obj['userId'] === 'string') scope.userId = obj['userId']
      if (typeof obj['groupId'] === 'string') scope.groupId = obj['groupId']
      if (typeof obj['threadId'] === 'string') scope.threadId = obj['threadId']
      return scope
    }
  }
  return { kind: 'global' }
}

let turnsRenderPending = false
let notificationsRenderPending = false
let toolFailuresRenderPending = false
let remindersRenderPending = false
let memosRenderPending = false

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

export function handleTurnStart(d: Record<string, unknown>): void {
  const turnId = typeof d['turnId'] === 'string' ? d['turnId'] : ''
  if (turnId === '') return
  const scope = parseScope(d['scope'])
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
    turn.status = isValidTurnStatus(status) ? status : 'ok'
    if (error !== undefined) turn.error = error
  }
  scheduleTurnsRender()
}

export function handleTurnSummary(d: Record<string, unknown>): void {
  const turnId = typeof d['turnId'] === 'string' ? d['turnId'] : ''
  if (turnId === '') return

  const parsed = safeParseTurn(d)
  if (parsed === null) return

  const existing = state.turns.findIndex((t) => t.turnId === turnId)
  if (existing === -1) {
    state.turns.unshift(parsed)
    if (state.turns.length > 512) state.turns.pop()
  } else {
    state.turns[existing] = parsed
  }
  scheduleTurnsRender()
}

export function handleNotificationEvent(type: string, d: Record<string, unknown>): void {
  const scope = parseScope(d['scope'])
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
  const scope = parseScope(d['scope'])
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
