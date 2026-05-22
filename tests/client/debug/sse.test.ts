// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { DashboardState } from '../../../client/debug/dashboard-types.js'
import { buildHandlerMap } from '../../../client/debug/sse.js'

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
    recurringTasks: [],
    deferredPrompts: [],
    memos: [],
    identityMappings: new Map(),
    activeConfigEditors: new Set(),
    authorizedGroups: [],
    activeContext: 'all',
    activeLogFilter: {},
    billingWindow: '30d',
    billingSubjects: [],
    billingDetail: null,
    adminLlm: null,
    statsWindow: '30d',
    globalStats: null,
    subjectStats: null,
  }
}

describe('buildHandlerMap', () => {
  test('exposes handlers for known event types', () => {
    const handlers = buildHandlerMap(freshState())
    expect(typeof handlers['state:init']).toBe('function')
    expect(typeof handlers['log:entry']).toBe('function')
    expect(typeof handlers['turn:start']).toBe('function')
    expect(typeof handlers['identity:set']).toBe('function')
    expect(typeof handlers['auth:group_authorized']).toBe('function')
    expect(typeof handlers['memo:created']).toBe('function')
  })

  test('log:entry handler mutates state', () => {
    const s = freshState()
    const handlers = buildHandlerMap(s)
    handlers['log:entry']?.({ time: 1, level: 30, msg: 'hi', scope: 'x' })
    expect(s.logs).toHaveLength(1)
  })

  test('identity:set handler delegates to context handler', () => {
    const s = freshState()
    const handlers = buildHandlerMap(s)
    handlers['identity:set']?.({ userId: 'u1', provider: 'p' })
    expect(s.identityMappings.has('u1')).toBe(true)
  })

  test('malformed event data is silently ignored', () => {
    const s = freshState()
    const handlers = buildHandlerMap(s)
    expect(() => handlers['state:init']?.({})).not.toThrow()
    expect(() => handlers['log:entry']?.({ time: 'not-a-number' })).not.toThrow()
  })
})
