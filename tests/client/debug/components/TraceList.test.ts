// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import TraceList from '../../../../client/debug/components/TraceList.svelte'
import type { DashboardState, LlmTrace } from '../../../../client/debug/dashboard-types.js'

function freshState(traces: LlmTrace[] = []): DashboardState {
  return {
    connected: false,
    stats: { startedAt: 0, totalMessages: 0, totalLlmCalls: 0, totalToolCalls: 0 },
    sessions: new Map(),
    wizards: new Map(),
    scheduler: {},
    pollers: {},
    messageCache: {},
    llmTraces: traces,
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

function makeTrace(overrides: Partial<LlmTrace> = {}): LlmTrace {
  return {
    timestamp: 1700000000000,
    userId: 'u1',
    model: 'gpt-4o-mini',
    duration: 1234,
    steps: 2,
    totalTokens: { inputTokens: 820, outputTokens: 240 },
    finishReason: 'stop',
    messageCount: 6,
    ...overrides,
  }
}

function render(state: DashboardState): { target: HTMLElement; component: ReturnType<typeof mount> } {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.getElementById('root')!
  const component = mount(TraceList, { target, props: { dashboard: state, onSelect: () => {} } })
  return { target, component }
}

describe('TraceList', () => {
  test('renders the trace list within a Panel and EmptyState when empty', () => {
    const { target, component } = render(freshState())
    expect(target.querySelector('.ui-panel')).not.toBeNull()
    expect(target.querySelector('.ui-empty')).not.toBeNull()
    void unmount(component)
  })

  test('highlights exactly one row when a trace is selected', () => {
    const a = makeTrace({ userId: 'u-a' })
    const b = makeTrace({ userId: 'u-b' })
    const state = freshState([a, b])
    state.selectedDetail = { kind: 'trace', payload: a }
    const { target, component } = render(state)
    expect(target.querySelectorAll('.trace-row.selected').length).toBe(1)
    void unmount(component)
  })

  test('traces sharing timestamp/userId/model both highlight (narrowed signature)', () => {
    // EXPECTED narrowed-signature semantics: the highlight key is
    // timestamp+userId+model, so two traces that differ only in `steps` are
    // treated as the same logical entry and both rows highlight.
    const a = makeTrace({ steps: 2 })
    const b = makeTrace({ steps: 9 })
    const state = freshState([a, b])
    state.selectedDetail = { kind: 'trace', payload: a }
    const { target, component } = render(state)
    expect(target.querySelectorAll('.trace-row.selected').length).toBe(2)
    void unmount(component)
  })

  test('traces differing in model do not cross-highlight', () => {
    const a = makeTrace({ model: 'gpt-4o-mini' })
    const b = makeTrace({ model: 'gpt-4o' })
    const state = freshState([a, b])
    state.selectedDetail = { kind: 'trace', payload: a }
    const { target, component } = render(state)
    expect(target.querySelectorAll('.trace-row.selected').length).toBe(1)
    void unmount(component)
  })
})
