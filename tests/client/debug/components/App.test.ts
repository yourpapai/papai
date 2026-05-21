// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import { dashboard } from '../../../../client/debug/debug.svelte.js'
import DebugApp from '../../../../client/debug/DebugApp.svelte'

describe('DebugApp.svelte', () => {
  test('renders debug-only panels and log explorer through DebugApp', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.getElementById('root')!
    const component = mount(DebugApp, { target, props: { dashboard } })

    const html = target.innerHTML
    expect(html).toContain('papai debug')
    expect(html).toContain('panel-grid')
    expect(html).toContain('log-explorer')
    expect(html).toContain('Turns')
    expect(html).toContain('Notifications')
    expect(html).toContain('Tool Failures')
    expect(html).toContain('Live Context')
    expect(html).toContain('Sessions')
    expect(html).toContain('LLM Trace')
    expect(html).not.toContain('Billing')
    expect(html).not.toContain('Stats')
    expect(html).not.toContain('Memos')
    expect(html).not.toContain('Reminders')

    void unmount(component)
  })

  test('shows placeholder messages when all collections are empty', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.getElementById('root')!
    const component = mount(DebugApp, { target, props: { dashboard } })

    const html = target.innerHTML
    expect(html).toContain('No turns')
    expect(html).toContain('No notifications')
    expect(html).toContain('No failures')
    expect(html).toContain('No active sessions')

    void unmount(component)
  })

  test('does not throw on mount', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.getElementById('root')!
    expect(() => {
      const c = mount(DebugApp, { target, props: { dashboard } })
      void unmount(c)
    }).not.toThrow()
  })
})
