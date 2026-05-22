// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import DebugTopBar from '../../../../client/debug/components/DebugTopBar.svelte'
import type { DashboardState } from '../../../../client/debug/dashboard-types.js'

function makeState(overrides: Partial<DashboardState> = {}): DashboardState {
  return {
    connected: true,
    stats: { startedAt: Date.now(), totalMessages: 0, totalLlmCalls: 0, totalToolCalls: 0 },
    sessions: new Map(),
    wizards: new Map(),
    scheduler: { running: true, tickCount: 1 },
    pollers: { scheduledRunning: true, alertsRunning: true },
    messageCache: { size: 0, pendingWrites: 0 },
    llmTraces: [],
    logs: [],
    logScopes: new Set(),
    turns: [],
    notifications: [],
    toolFailures: [],
    activeConfigEditors: new Set(),
    scopeFilter: 'all',
    selectedDetail: null,
    activeLogFilter: {},
    ...overrides,
  }
}

describe('DebugTopBar.svelte', () => {
  let target: HTMLElement

  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>'
    target = document.body.querySelector<HTMLElement>('#root')!
  })

  test('renders brand "papai ::debug" and a connected pill', () => {
    const dashboard = makeState({ connected: true })
    const component = mount(DebugTopBar, { target, props: { dashboard } })
    expect(target.textContent).toContain('papai')
    expect(target.textContent).toContain('::debug')
    expect(target.textContent).toContain('connected')
    void unmount(component)
  })

  test('renders a disconnected pill with danger tone when disconnected', () => {
    const dashboard = makeState({ connected: false })
    const component = mount(DebugTopBar, { target, props: { dashboard } })
    expect(target.textContent).toContain('disconnected')
    expect(target.querySelector('.ui-pill--danger')).not.toBeNull()
    void unmount(component)
  })

  test('renders msgs / llm / tools counters', () => {
    const dashboard = makeState({
      stats: { startedAt: Date.now(), totalMessages: 42, totalLlmCalls: 7, totalToolCalls: 13 },
    })
    const component = mount(DebugTopBar, { target, props: { dashboard } })
    expect(target.textContent).toContain('42')
    expect(target.textContent).toContain('7')
    expect(target.textContent).toContain('13')
    void unmount(component)
  })

  test('Seg in the secondary row reflects scopeFilter and writes back on click', () => {
    const dashboard = makeState({ scopeFilter: 'all' })
    const component = mount(DebugTopBar, { target, props: { dashboard } })
    const active = target.querySelector('.ui-seg__btn--active')
    expect(active?.textContent).toBe('all')
    const dmBtn = Array.from(target.querySelectorAll<HTMLButtonElement>('.ui-seg__btn')).find(
      (b) => b.textContent === 'dm',
    )!
    dmBtn.click()
    expect(dashboard.scopeFilter).toBe('dm')
    void unmount(component)
  })
})
