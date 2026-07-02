// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { DashboardState } from '../../../client/debug/dashboard-types.js'
import { buildHandlerMap, eventsUrl } from '../../../client/debug/sse.js'

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
    activeLogFilter: { include: [], exclude: [], level: 0 },
    logScopeCounts: [],
  }
}

describe('eventsUrl', () => {
  test('appends filter query when present', () => {
    expect(eventsUrl('include=chat&level=30')).toBe('/events?include=chat&level=30')
  })
  test('bare /events when query empty', () => {
    expect(eventsUrl('')).toBe('/events')
  })
})

describe('buildHandlerMap', () => {
  test('exposes handlers for known event types', () => {
    const handlers = buildHandlerMap(freshState())
    expect(typeof handlers['state:init']).toBe('function')
    expect(typeof handlers['log:entry']).toBe('function')
    expect(typeof handlers['turn:start']).toBe('function')
    expect(typeof handlers['config_editor:opened']).toBe('function')
    expect(typeof handlers['config_editor:closed']).toBe('function')
    expect(typeof handlers['config_editor:step']).toBe('function')
  })

  test('does not register admin-only event handlers in the debug bundle', () => {
    const handlers = buildHandlerMap(freshState())
    expect(handlers['recurring:created']).toBeUndefined()
    expect(handlers['deferred:created']).toBeUndefined()
    expect(handlers['memo:created']).toBeUndefined()
    expect(handlers['identity:set']).toBeUndefined()
    expect(handlers['auth:group_authorized']).toBeUndefined()
  })

  test('log:entry handler mutates state', () => {
    const s = freshState()
    const handlers = buildHandlerMap(s)
    handlers['log:entry']?.({ time: 1, level: 30, msg: 'hi', scope: 'x' })
    expect(s.logs).toHaveLength(1)
  })

  test('config_editor:opened handler delegates to context handler', () => {
    const s = freshState()
    const handlers = buildHandlerMap(s)
    handlers['config_editor:opened']?.({ userId: 'u1' })
    expect(s.activeConfigEditors.has('u1')).toBe(true)
  })

  test('malformed event data is silently ignored', () => {
    const s = freshState()
    const handlers = buildHandlerMap(s)
    expect(() => handlers['state:init']?.({})).not.toThrow()
    expect(() => handlers['log:entry']?.({ time: 'not-a-number' })).not.toThrow()
  })
})
