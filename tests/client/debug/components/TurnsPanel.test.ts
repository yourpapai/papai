// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import TurnsPanel from '../../../../client/debug/components/TurnsPanel.svelte'
import type { DashboardState, Turn } from '../../../../client/debug/dashboard-types.js'

function freshState(turns: Turn[] = []): DashboardState {
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
    turns,
    notifications: [],
    toolFailures: [],
    activeConfigEditors: new Set(),
    scopeFilter: 'all',
    selectedDetail: null,
    activeLogFilter: {},
  }
}

function makeTurn(overrides: Partial<Turn> = {}): Turn {
  return {
    turnId: 't1',
    scope: { kind: 'user', userId: 'u1' },
    startedAt: 1700000000000,
    endedAt: 1700000005000,
    status: 'ok',
    incomingMessageCount: 1,
    toolCalls: [],
    ...overrides,
  }
}

function render(state: DashboardState): {
  target: HTMLElement
  component: ReturnType<typeof mount>
} {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.getElementById('root')!
  const component = mount(TurnsPanel, {
    target,
    props: { dashboard: state, onShowTurn: () => {}, onShowLogsForTurn: () => {} },
  })
  return { target, component }
}

describe('TurnsPanel', () => {
  test('shows placeholder when no turns', () => {
    const { target, component } = render(freshState())
    expect(target.textContent).toContain('No turns')
    void unmount(component)
  })

  test('shows an EmptyState when there are no turns', () => {
    const { target, component } = render(freshState())
    expect(target.querySelector('.ui-empty')).not.toBeNull()
    void unmount(component)
  })

  test('renders a 6-column table header', () => {
    const { target, component } = render(freshState([makeTurn()]))
    const headers = target.querySelectorAll('th')
    expect(headers.length).toBe(6)
    const labels = Array.from(headers).map((h) => h.textContent?.trim().toLowerCase())
    expect(labels).toContain('time')
    expect(labels).toContain('status')
    expect(labels).toContain('scope')
    expect(labels).toContain('duration')
    expect(labels).toContain('msgs')
    expect(labels).toContain('tools')
    void unmount(component)
  })

  test('renders status pill for each turn row', () => {
    const { target, component } = render(freshState([makeTurn({ status: 'error' })]))
    // Status pill should have danger tone class
    expect(target.innerHTML).toContain('ui-pill--danger')
    // Should contain the status text
    expect(target.textContent).toContain('error')
    void unmount(component)
  })

  test('filters by dm context', () => {
    const state = freshState([
      makeTurn({ turnId: 'in-dm', scope: { kind: 'user', userId: 'u1' } }),
      makeTurn({ turnId: 'in-group', scope: { kind: 'group', groupId: 'g1' } }),
    ])
    state.scopeFilter = 'dm'
    const { target, component } = render(state)
    expect(target.textContent).not.toContain('No turns')
    // Only one data row should render (tbody tr with clickable class)
    const rows = target.querySelectorAll('.ui-datatable__tr')
    expect(rows.length).toBe(1)
    void unmount(component)
  })

  test('renders tool pill chips with +N overflow', () => {
    const turn = makeTurn({
      toolCalls: [
        { name: 'tool_a', durationMs: 10, ok: true },
        { name: 'tool_b', durationMs: 10, ok: true },
        { name: 'tool_c', durationMs: 10, ok: true },
        { name: 'tool_d', durationMs: 10, ok: true },
      ],
    })
    const { target, component } = render(freshState([turn]))
    expect(target.textContent).toContain('tool_a')
    expect(target.textContent).toContain('tool_b')
    expect(target.textContent).toContain('tool_c')
    // 4th tool should not render as pill — instead "+1" overflow
    expect(target.textContent).toContain('+1')
    void unmount(component)
  })

  test('shows header summary pills for running/error/cancelled turns', () => {
    const state = freshState([
      makeTurn({ turnId: 't1', status: 'running' }),
      makeTurn({ turnId: 't2', status: 'error' }),
      makeTurn({ turnId: 't3', status: 'cancelled' }),
    ])
    const { target, component } = render(state)
    expect(target.textContent).toContain('running 1')
    expect(target.textContent).toContain('error 1')
    expect(target.textContent).toContain('cancelled 1')
    void unmount(component)
  })

  test('calls onShowTurn when a table row is clicked', () => {
    const seen: Turn[] = []
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.getElementById('root')!
    const component = mount(TurnsPanel, {
      target,
      props: {
        dashboard: freshState([makeTurn()]),
        onShowTurn: (t: Turn) => seen.push(t),
        onShowLogsForTurn: () => {},
      },
    })
    const row = target.querySelector<HTMLElement>('.ui-datatable__tr--clickable')
    row?.click()
    expect(seen.length).toBe(1)
    expect(seen[0]?.turnId).toBe('t1')
    void unmount(component)
  })
})
