// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { DashboardState } from '../../../client/debug/dashboard-types.js'
import * as handlerExtras from '../../../client/debug/handlers-extras.js'
import {
  handleCacheEvent,
  handleCacheExpire,
  handleLlmFull,
  handleLogEntry,
  handleMsgcacheSweep,
  handleNotificationEvent,
  handlePollerEvent,
  handleSchedulerTick,
  handleStateInit,
  handleStateStats,
  handleToolFailureClassified,
  handleTurnEnd,
  handleTurnStart,
  handleWizardCreated,
  handleWizardDeleted,
  handleWizardUpdated,
} from '../../../client/debug/handlers.js'

function freshState(): DashboardState {
  return {
    connected: false,
    stats: { startedAt: 0, totalMessages: 0, totalLlmCalls: 0, totalToolCalls: 0 },
    sessions: new Map(),
    wizards: new Map(),
    scheduler: {},
    pollers: {},
    messageCache: {},
    llmTraces: [],
    logs: [],
    logScopes: new Set(),
    turns: [],
    notifications: [],
    toolFailures: [],
    activeConfigEditors: new Set(),
    scopeFilter: 'all',
    selectedDetail: null,
    activeLogFilter: {},
  }
}

const { handleConfigEditorEvent } = handlerExtras

describe('handleStateInit', () => {
  test('populates sessions, scheduler, and stats from event', () => {
    const s = freshState()
    handleStateInit(s, {
      sessions: [
        {
          userId: 'u1',
          lastAccessed: 1,
          historyLength: 0,
          factsCount: 0,
          summary: null,
          configKeys: [],
          workspaceId: null,
        },
      ],
      scheduler: { running: true, tickCount: 1 },
      stats: { totalMessages: 5, totalLlmCalls: 2, totalToolCalls: 3, startedAt: 100 },
    })
    expect(s.sessions.size).toBe(1)
    expect(s.scheduler.running).toBe(true)
    expect(s.stats.totalMessages).toBe(5)
  })
})

describe('handleStateStats', () => {
  test('merges stats fields', () => {
    const s = freshState()
    handleStateStats(s, { totalMessages: 10, totalLlmCalls: 5, totalToolCalls: 7 })
    expect(s.stats.totalMessages).toBe(10)
    expect(s.stats.totalLlmCalls).toBe(5)
  })
})

describe('handleLlmFull', () => {
  test('prepends to llmTraces and caps length', () => {
    const s = freshState()
    const trace = {
      timestamp: 1,
      userId: 'u',
      model: 'm',
      duration: 100,
      steps: 1,
      totalTokens: { inputTokens: 1, outputTokens: 1 },
    }
    handleLlmFull(s, trace)
    expect(s.llmTraces).toHaveLength(1)
  })
})

describe('handleCacheEvent', () => {
  test('creates session if missing', () => {
    const s = freshState()
    handleCacheEvent(s, { userId: 'u1', field: 'history' })
    expect(s.sessions.has('u1')).toBe(true)
  })

  test('updates history length on existing session', () => {
    const s = freshState()
    s.sessions.set('u1', {
      userId: 'u1',
      lastAccessed: 1,
      historyLength: 2,
      factsCount: 0,
      summary: null,
      configKeys: [],
      workspaceId: null,
    })
    handleCacheEvent(s, { userId: 'u1', field: 'history' })
    expect(s.sessions.get('u1')!.historyLength).toBe(3)
  })
})

describe('handleCacheExpire', () => {
  test('removes session and wizard', () => {
    const s = freshState()
    s.sessions.set('u1', {
      userId: 'u1',
      lastAccessed: 1,
      historyLength: 0,
      factsCount: 0,
      summary: null,
      configKeys: [],
      workspaceId: null,
    })
    s.wizards.set('u1', { userId: 'u1', currentStep: 1, totalSteps: 3 })
    handleCacheExpire(s, { userId: 'u1' })
    expect(s.sessions.has('u1')).toBe(false)
    expect(s.wizards.has('u1')).toBe(false)
  })
})

describe('wizard handlers', () => {
  test('handleWizardCreated stores wizard', () => {
    const s = freshState()
    handleWizardCreated(s, { userId: 'u1', currentStep: 1, totalSteps: 5 })
    expect(s.wizards.get('u1')?.currentStep).toBe(1)
  })

  test('handleWizardUpdated patches fields', () => {
    const s = freshState()
    s.wizards.set('u1', { userId: 'u1', currentStep: 1, totalSteps: 5 })
    handleWizardUpdated(s, { userId: 'u1', currentStep: 2 })
    expect(s.wizards.get('u1')?.currentStep).toBe(2)
  })

  test('handleWizardUpdated creates wizard with --- defaults', () => {
    const s = freshState()
    handleWizardUpdated(s, { userId: 'u1' })
    expect(s.wizards.get('u1')?.currentStep).toBe('---')
  })

  test('handleWizardDeleted removes wizard', () => {
    const s = freshState()
    s.wizards.set('u1', { userId: 'u1', currentStep: 1, totalSteps: 5 })
    handleWizardDeleted(s, { userId: 'u1' })
    expect(s.wizards.has('u1')).toBe(false)
  })
})

describe('infra handlers', () => {
  test('handleSchedulerTick merges scheduler info', () => {
    const s = freshState()
    handleSchedulerTick(s, { running: true, tickCount: 4 })
    expect(s.scheduler.tickCount).toBe(4)
  })

  test('handlePollerEvent merges poller info', () => {
    const s = freshState()
    handlePollerEvent(s, { scheduledRunning: true })
    expect(s.pollers.scheduledRunning).toBe(true)
  })

  test('handleMsgcacheSweep merges message cache info', () => {
    const s = freshState()
    handleMsgcacheSweep(s, { size: 12, pendingWrites: 3 })
    expect(s.messageCache.size).toBe(12)
  })
})

describe('handleLogEntry', () => {
  test('appends log and tracks scope', () => {
    const s = freshState()
    handleLogEntry(s, { time: 1, level: 30, msg: 'hello', scope: 'a' })
    expect(s.logs).toHaveLength(1)
    expect(s.logScopes.has('a')).toBe(true)
  })

  test('caps logs at LOG_CAP', () => {
    const s = freshState()
    for (let i = 0; i < 70000; i++) {
      handleLogEntry(s, { time: i, level: 30, msg: 'x' })
    }
    expect(s.logs.length).toBeLessThanOrEqual(65535)
  })
})

describe('handleTurnStart and handleTurnEnd', () => {
  test('start creates a running turn', () => {
    const s = freshState()
    handleTurnStart(s, {
      turnId: 't1',
      scope: { kind: 'user', userId: 'u1' },
      incomingMessageCount: 1,
    })
    expect(s.turns[0]?.turnId).toBe('t1')
    expect(s.turns[0]?.status).toBe('running')
  })

  test('end updates status', () => {
    const s = freshState()
    handleTurnStart(s, { turnId: 't1', scope: { kind: 'user', userId: 'u1' } })
    handleTurnEnd(s, { turnId: 't1', status: 'ok' })
    expect(s.turns[0]?.status).toBe('ok')
  })

  test('end with unknown status defaults to ok', () => {
    const s = freshState()
    handleTurnStart(s, { turnId: 't1', scope: { kind: 'global' } })
    handleTurnEnd(s, { turnId: 't1', status: 'weird' })
    expect(s.turns[0]?.status).toBe('ok')
  })
})

describe('handleNotificationEvent and handleToolFailureClassified', () => {
  test('notification is pushed with scope and type', () => {
    const s = freshState()
    handleNotificationEvent(s, 'reply:sent', {
      scope: { kind: 'group', groupId: 'g1' },
      text: 'hi',
    })
    expect(s.notifications).toHaveLength(1)
    expect(s.notifications[0]?.type).toBe('reply:sent')
  })

  test('tool failure is pushed with data', () => {
    const s = freshState()
    handleToolFailureClassified(s, {
      scope: { kind: 'user', userId: 'u1' },
      toolName: 'foo',
      error: 'oops',
    })
    expect(s.toolFailures).toHaveLength(1)
    expect(s.toolFailures[0]?.data['toolName']).toBe('foo')
  })
})

describe('context handlers', () => {
  test('config editor open/close updates the set', () => {
    const s = freshState()
    handleConfigEditorEvent(s, 'config_editor:opened', { userId: 'u1' })
    expect(s.activeConfigEditors.has('u1')).toBe(true)
    handleConfigEditorEvent(s, 'config_editor:closed', { userId: 'u1' })
    expect(s.activeConfigEditors.has('u1')).toBe(false)
  })

  test('debug handlers-extra exports only config editor handling', () => {
    expect(Object.keys(handlerExtras).sort()).toEqual(['handleConfigEditorEvent'])
  })
})
