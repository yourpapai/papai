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

function render(state: DashboardState): { target: HTMLElement; component: ReturnType<typeof mount> } {
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

  test('renders status class on turn row', () => {
    const { target, component } = render(freshState([makeTurn({ status: 'error' })]))
    expect(target.innerHTML).toContain('status-error')
    void unmount(component)
  })

  test('filters by dm context', () => {
    const state = freshState([
      makeTurn({ turnId: 'in-dm', scope: { kind: 'user', userId: 'u1' } }),
      makeTurn({ turnId: 'in-group', scope: { kind: 'group', groupId: 'g1' } }),
    ])
    state.activeContext = 'dm'
    const { target, component } = render(state)
    expect(target.innerHTML).not.toContain('No turns')
    // Only one row should render
    const rows = target.querySelectorAll('.turn-row')
    expect(rows.length).toBe(1)
    void unmount(component)
  })

  test('renders log-link button per turn', () => {
    const { target, component } = render(freshState([makeTurn()]))
    expect(target.querySelector('.turn-log-link')).not.toBeNull()
    void unmount(component)
  })
})
