// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import App from '../../../../client/debug/App.svelte'

describe('App.svelte', () => {
  test('renders header, panels, and log explorer', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.getElementById('root')!
    const component = mount(App, { target })

    const html = target.innerHTML
    expect(html).toContain('papai debug')
    expect(html).toContain('panel-grid')
    expect(html).toContain('log-explorer')
    expect(html).toContain('Turns')
    expect(html).toContain('Notifications')
    expect(html).toContain('Sessions')
    expect(html).toContain('LLM Trace')
    expect(html).toContain('Billing')

    void unmount(component)
  })

  test('shows placeholder messages when all collections are empty', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.getElementById('root')!
    const component = mount(App, { target })

    const html = target.innerHTML
    expect(html).toContain('No turns')
    expect(html).toContain('No notifications')
    expect(html).toContain('No failures')
    expect(html).toContain('No reminders')

    void unmount(component)
  })

  test('does not throw on mount', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.getElementById('root')!
    expect(() => {
      const c = mount(App, { target })
      void unmount(c)
    }).not.toThrow()
  })
})
