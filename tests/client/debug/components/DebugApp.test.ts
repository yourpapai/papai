// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import type { DashboardState } from '../../../../client/debug/dashboard-types.js'
import DebugApp from '../../../../client/debug/DebugApp.svelte'

function freshState(): DashboardState {
  return {
    connected: false,
    stats: { startedAt: Date.now(), totalMessages: 0, totalLlmCalls: 0, totalToolCalls: 0 },
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
    activeLogFilter: {},
  }
}

describe('DebugApp.svelte', () => {
  test('asserts presence of live engineering panels and absence of admin/management panels', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.getElementById('root')!
    const dashboard = freshState()

    const component = mount(DebugApp, {
      target,
      props: { dashboard },
    })

    const html = target.innerHTML

    // Presence checks (live engineering panels)
    expect(html).toContain('papai')
    expect(html).toContain('::debug')
    expect(html).toContain('debug-grid')
    expect(html).toContain('log-explorer')
    expect(html).toContain('turns')
    expect(html).toContain('notifications')
    expect(html).toContain('tool failures')
    expect(html).toContain('live context')

    // Absence checks (admin/management panels)
    expect(html).not.toContain('Billing')
    expect(html).not.toContain('Memos')
    expect(html).not.toContain('Reminders')
    expect(html).not.toContain('Stats')

    void unmount(component)
  })
})
