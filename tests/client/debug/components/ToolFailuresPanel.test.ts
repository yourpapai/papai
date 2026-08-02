// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import ToolFailuresPanel from '../../../../client/debug/components/ToolFailuresPanel.svelte'
import type { DashboardState, ToolFailure } from '../../../../client/debug/dashboard-types.js'

function freshState(failures: ToolFailure[] = []): DashboardState {
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
    toolFailures: failures,
    activeConfigEditors: new Set(),
    scopeFilter: 'all',
    selectedDetail: null,
    activeLogFilter: { include: [], exclude: [], level: 0 },
    logScopeCounts: [],
  }
}

function makeFailure(overrides: Partial<ToolFailure> = {}): ToolFailure {
  return {
    timestamp: 1700000000000,
    scope: { kind: 'user', userId: 'u1' },
    data: { toolName: 'create_task', error: 'project not found', errorType: 'validation' },
    ...overrides,
  }
}

function render(state: DashboardState): { target: HTMLElement; component: ReturnType<typeof mount> } {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.getElementById('root')!
  const component = mount(ToolFailuresPanel, { target, props: { dashboard: state, onShowFailure: () => {} } })
  return { target, component }
}

describe('ToolFailuresPanel', () => {
  test('renders within a Panel and shows EmptyState when there are no failures', () => {
    const { target, component } = render(freshState())
    expect(target.querySelector('.ui-panel')).not.toBeNull()
    expect(target.querySelector('.ui-empty')).not.toBeNull()
    void unmount(component)
  })

  test('highlights exactly one row when a failure is selected', () => {
    const a = makeFailure()
    const b = makeFailure({ data: { toolName: 'create_task', error: 'other error', errorType: 'validation' } })
    const state = freshState([a, b])
    state.selectedDetail = { kind: 'failure', payload: a }
    const { target, component } = render(state)
    expect(target.querySelectorAll('.failure-row.selected').length).toBe(1)
    void unmount(component)
  })

  test('failures differing in toolName do not cross-highlight', () => {
    const a = makeFailure()
    const b = makeFailure({ data: { toolName: 'update_task', error: 'project not found', errorType: 'validation' } })
    const state = freshState([a, b])
    state.selectedDetail = { kind: 'failure', payload: a }
    const { target, component } = render(state)
    expect(target.querySelectorAll('.failure-row.selected').length).toBe(1)
    void unmount(component)
  })

  test('empty state explains itself', () => {
    const { target, component } = render(freshState())
    expect(target.textContent).toContain('No failures')
    expect(target.textContent).toContain('buffered window')
    void unmount(component)
  })
})
