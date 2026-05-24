// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  makeDashboardState,
  makeLlmTrace,
  makeLogEntry,
  makeNotification,
  makeSession,
  makeToolFailure,
  makeTurn,
} from '../../../../client/stories/fixtures/debug.js'

describe('debug fixtures', () => {
  test('makeSession produces a session with overrides applied', () => {
    const session = makeSession({ userId: 'tg:9' })
    expect(session.userId).toBe('tg:9')
    expect(session.historyLength).toBeGreaterThanOrEqual(0)
  })

  test('makeLlmTrace carries token usage', () => {
    const trace = makeLlmTrace()
    expect(trace.totalTokens.inputTokens).toBeGreaterThanOrEqual(0)
    expect(trace.model).toBeDefined()
  })

  test('makeLogEntry has time, level, and msg', () => {
    const entry = makeLogEntry()
    expect(entry.level).toBeGreaterThanOrEqual(0)
    expect(typeof entry.msg).toBe('string')
  })

  test('makeTurn has a scope and tool calls', () => {
    const turn = makeTurn({ status: 'error' })
    expect(turn.status).toBe('error')
    expect(turn.scope.kind).toBeDefined()
    expect(Array.isArray(turn.toolCalls)).toBe(true)
  })

  test('makeNotification and makeToolFailure carry scope + data', () => {
    expect(makeNotification().scope.kind).toBeDefined()
    expect(makeToolFailure().data).toBeDefined()
  })

  test('makeDashboardState composes maps, sets, and arrays', () => {
    const state = makeDashboardState()
    expect(state.connected).toBe(true)
    expect(state.sessions.size).toBeGreaterThan(0)
    expect(state.logScopes.size).toBeGreaterThan(0)
    expect(state.turns.length).toBeGreaterThan(0)
    expect(state.llmTraces.length).toBeGreaterThan(0)
  })

  test('makeDashboardState applies overrides', () => {
    const state = makeDashboardState({ connected: false, turns: [] })
    expect(state.connected).toBe(false)
    expect(state.turns).toEqual([])
  })
})
