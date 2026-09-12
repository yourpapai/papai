// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import {
  parseCacheEvent,
  parseLlmTrace,
  parseLogEntry,
  parsePollerEvent,
  parseSchedulerTickEvent,
  parseStateInitEvent,
  parseStateStatsEvent,
  parseUserIdEvent,
  parseWizard,
  safeParseLlmTrace,
  safeParseNotification,
  safeParseSession,
  safeParseToolFailure,
  safeParseTurn,
  safeParseWizard,
} from '../../../src/debug/schemas.js'
import { scenario } from '../harness/scenario.js'

scenario('SCN-http-debug-schemas: debug payload parsers accept valid events and reject malformed payloads', () => {
  expect(
    safeParseSession({
      userId: 'alice',
      lastAccessed: 1,
      historyLength: 1,
      factsCount: 1,
      summary: 'Working on a task',
      configKeys: ['theme'],
      facts: [{ identifier: 'task-1', title: 'Task', url: 'https://example.test/tasks/1', lastSeen: 'now' }],
      config: { theme: 'dark' },
      hasTools: true,
      instructionsCount: 1,
      instructions: [{ id: 'brief', text: 'Be concise', createdAt: 'now' }],
      history: [{ role: 'user', content: 'Hello' }],
    }),
  ).toMatchObject({ userId: 'alice', factsCount: 1 })
  expect(parseWizard({ userId: 'alice', currentStep: 1, totalSteps: 3 })).toMatchObject({ userId: 'alice' })
  expect(
    parseLlmTrace({
      timestamp: 1,
      userId: 'alice',
      model: 'test-model',
      duration: 25,
      steps: 1,
      totalTokens: { inputTokens: 10, outputTokens: 5 },
    }),
  ).toMatchObject({ model: 'test-model', totalTokens: { outputTokens: 5 } })
  expect(parseLogEntry({ time: 1, level: 30, msg: 'completed', requestId: 'req-1' })).toMatchObject({
    msg: 'completed',
  })

  const scope = { kind: 'user', userId: 'alice' }
  expect(
    safeParseTurn({
      turnId: 'turn-1',
      scope,
      startedAt: 1,
      status: 'ok',
      incomingMessageCount: 1,
      toolCalls: [{ name: 'tasks.create', durationMs: 10, ok: true }],
      reply: { durationMs: 5 },
    }),
  ).toMatchObject({ turnId: 'turn-1', status: 'ok' })
  expect(
    safeParseNotification({ timestamp: 1, type: 'reply:sent', scope, data: { messageId: 'msg-1' } }),
  ).toMatchObject({
    type: 'reply:sent',
  })
  expect(safeParseToolFailure({ timestamp: 1, scope, data: { toolName: 'tasks.create' } })).toMatchObject({
    data: { toolName: 'tasks.create' },
  })

  expect(parseStateInitEvent({ sessions: [], wizards: [], recentLlm: [], recentTurns: [] })).toMatchObject({
    sessions: [],
  })
  expect(parseStateStatsEvent({ startedAt: 1, totalMessages: 2, totalLlmCalls: 3, totalToolCalls: 4 })).toMatchObject({
    totalToolCalls: 4,
  })
  expect(parseCacheEvent({ userId: 'alice', field: 'history' })).toMatchObject({ field: 'history' })
  expect(parseUserIdEvent({ userId: 'alice' })).toMatchObject({ userId: 'alice' })
  expect(parseSchedulerTickEvent({ running: true, tickCount: 2 })).toMatchObject({ tickCount: 2 })
  expect(parsePollerEvent({ scheduledRunning: true, alertsRunning: false })).toMatchObject({ alertsRunning: false })

  expect(safeParseSession({ userId: 42 })).toBeNull()
  expect(safeParseWizard({ userId: 42 })).toBeNull()
  expect(safeParseLlmTrace({ model: 'test-model' })).toBeNull()
  expect(safeParseTurn({ turnId: 42 })).toBeNull()
  expect(safeParseNotification({ timestamp: 'now' })).toBeNull()
  expect(safeParseToolFailure({ data: {} })).toBeNull()
  expect(() => parseWizard({ userId: 42 })).toThrow()
  expect(() => parseLlmTrace({ model: 'test-model' })).toThrow()
  expect(() => parseLogEntry({ level: 'info' })).toThrow()
})
