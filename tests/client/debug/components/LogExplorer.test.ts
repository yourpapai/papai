// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import LogExplorer from '../../../../client/debug/components/LogExplorer.svelte'
import type { DashboardState } from '../../../../client/debug/dashboard-types.js'
import type { LogFilter } from '../../../../client/debug/log-filter-url.js'

function makeDashboard(overrides: Partial<LogFilter> = {}): DashboardState {
  return {
    connected: false,
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
})
