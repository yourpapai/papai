// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { DashboardState, DashboardWizard, SelectedDetail } from '../../debug/dashboard-types.js'
import type { LlmTrace, LogEntry, Notification, Session, ToolFailure, Turn } from '../../shared/api-types.js'

const FIXED_TS = Date.UTC(2026, 4, 20, 12, 0, 0)

export function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    userId: 'tg:1001',
    lastAccessed: FIXED_TS,
    historyLength: 12,
    factsCount: 3,
    summary: 'User is planning a sprint and asked for task triage.',
    configKeys: ['timezone', 'kaneo_apikey'],
    ...overrides,
  }
}

export function makeWizard(overrides: Partial<DashboardWizard> = {}): DashboardWizard {
  return { userId: 'tg:1001', currentStep: 2, totalSteps: 4, ...overrides }
}

export function makeLlmTrace(overrides: Partial<LlmTrace> = {}): LlmTrace {
  return {
    timestamp: FIXED_TS,
    userId: 'tg:1001',
    model: 'gpt-4o-mini',
    duration: 1234,
    steps: 2,
    totalTokens: { inputTokens: 820, outputTokens: 240 },
    finishReason: 'stop',
    messageCount: 6,
    ...overrides,
  }
}

export function makeLogEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return { time: FIXED_TS, level: 30, msg: 'message processed', scope: 'bot', ...overrides }
}

export function makeTurn(overrides: Partial<Turn> = {}): Turn {
  return {
    turnId: 't-1',
    scope: { kind: 'user', userId: 'tg:1001' },
    startedAt: FIXED_TS,
    endedAt: FIXED_TS + 1234,
    status: 'ok',
    incomingMessageCount: 1,
    toolCalls: [
      { name: 'create_task', durationMs: 120, ok: true },
      { name: 'search_tasks', durationMs: 64, ok: true },
    ],
    reply: { durationMs: 1234 },
    ...overrides,
  }
}

export function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    timestamp: FIXED_TS,
    type: 'proactive_suggestion',
    scope: { kind: 'user', userId: 'tg:1001' },
    data: { text: 'Consider closing the stale tasks in your sprint.' },
    ...overrides,
  }
}

export function makeToolFailure(overrides: Partial<ToolFailure> = {}): ToolFailure {
  return {
    timestamp: FIXED_TS,
    scope: { kind: 'user', userId: 'tg:1001' },
    data: { toolName: 'create_task', error: 'project not found', errorType: 'validation' },
    ...overrides,
  }
}

export const SELECTED_TURN: SelectedDetail = { kind: 'turn', payload: makeTurn() }

export function makeDashboardState(overrides: Partial<DashboardState> = {}): DashboardState {
  return {
    connected: true,
    stats: { startedAt: FIXED_TS, totalMessages: 42, totalLlmCalls: 30, totalToolCalls: 18 },
    sessions: new Map([
      ['tg:1001', makeSession()],
      ['tg:2', makeSession({ userId: 'tg:2', summary: null })],
    ]),
    wizards: new Map([['tg:3', makeWizard({ userId: 'tg:3' })]]),
    scheduler: { running: true, tickCount: 12 },
    pollers: { scheduledRunning: true, alertsRunning: true },
    messageCache: { size: 3, pendingWrites: 0 },
    llmTraces: [makeLlmTrace(), makeLlmTrace({ model: 'gpt-4o-mini', duration: 540, steps: 1 })],
    logs: [makeLogEntry(), makeLogEntry({ level: 40, msg: 'degraded provider response' })],
    logScopes: new Set(['bot', 'llm', 'scheduler']),
    turns: [makeTurn(), makeTurn({ turnId: 't-2', status: 'error', error: 'tool failed', reply: undefined })],
    notifications: [makeNotification()],
    toolFailures: [makeToolFailure()],
    activeConfigEditors: new Set(),
    scopeFilter: 'all',
    selectedDetail: null,
    activeLogFilter: {},
    ...overrides,
  }
}
