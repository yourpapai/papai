// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import LogExplorer from '../../../../client/debug/components/LogExplorer.svelte'
import type { DashboardState } from '../../../../client/debug/dashboard-types.js'
import type { LogFilter } from '../../../../client/debug/log-filter-url.js'
import type { LogEntry } from '../../../../client/shared/api-types.js'

function makeDashboard(overrides: Partial<LogFilter> = {}): DashboardState {
  return {
    connected: false,
    hasConnectedOnce: false,
    stats: { startedAt: 0, totalMessages: 0, totalLlmCalls: 0, totalToolCalls: 0 },
    sessions: new Map(),
    wizards: new Map(),
    scheduler: {},
    pollers: {},
    messageCache: {},
    llmTraces: [],
    logScopes: new Set(),
    turns: [],
    notifications: [],
    toolFailures: [],
    activeConfigEditors: new Set(),
    scopeFilter: 'all',
    selectedDetail: null,
    activeLogFilter: { include: [], exclude: [], level: 0, ...overrides },
    logScopeCounts: [],
    logs: [],
  }
}

describe('LogExplorer.svelte', () => {
  test('renders within a Panel with kit Select/Input/Btn controls', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const dashboard = makeDashboard()
    const c = mount(LogExplorer, { target, props: { dashboard, onSelectLog: () => {} } })
    expect(target.querySelector('.ui-panel')).not.toBeNull()
    expect(target.querySelectorAll('.ui-select').length).toBe(1)
    expect(target.querySelector('.ui-input')).not.toBeNull()
    expect(target.querySelector('#log-explorer .ui-btn')).not.toBeNull()
    void unmount(c)
  })

  test('shows the logs-error note when logsError is set', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const dashboard = { ...makeDashboard(), logsError: 'initial log load failed' }
    const c = mount(LogExplorer, { target, props: { dashboard, onSelectLog: () => {} } })
    expect(target.textContent).toContain('initial log load failed')
    void unmount(c)
  })

  test('highlights the selected row by content identity, not a stale positional index', () => {
    // Reproduces the load-older desync: after `unshift` shifts every index, the
    // stored `selectedDetail.payload.index` no longer matches the clicked row's
    // current position. Here the payload entry is the second row but its index
    // points at the first row's position.
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const entryA: LogEntry = { time: 1, level: 30, msg: 'message processed', scope: 'bot' }
    const entryB: LogEntry = { time: 2, level: 40, msg: 'degraded provider response', scope: 'bot' }
    const dashboard: DashboardState = {
      ...makeDashboard(),
      logs: [entryA, entryB],
      selectedDetail: { kind: 'log', payload: { entry: entryB, index: 0 } },
    }
    const c = mount(LogExplorer, { target, props: { dashboard, onSelectLog: () => {} } })
    const rows = target.querySelectorAll<HTMLElement>('.log-entry')
    expect(rows.length).toBe(2)
    expect(rows[0]!.classList.contains('selected')).toBe(false)
    expect(rows[1]!.classList.contains('selected')).toBe(true)
    void unmount(c)
  })
})
