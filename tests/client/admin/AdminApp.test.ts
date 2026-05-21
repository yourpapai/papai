// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import AdminApp from '../../../client/admin/AdminApp.svelte'

const sections = ['System', 'Billing', 'Stats', 'Memos', 'Reminders', 'Identities', 'Groups'] as const

function mountAdminApp(): ReturnType<typeof mount> {
  document.body.innerHTML = '<div id="root"></div>'
  history.replaceState(null, '', '/admin')
  return mount(AdminApp, { target: document.getElementById('root')! })
}

describe('AdminApp.svelte', () => {
  test('renders seven navigation items', () => {
    const component = mountAdminApp()

    const navItems = Array.from(document.querySelectorAll('[data-testid="admin-nav-item"]')).map((item) =>
      item.textContent?.trim(),
    )

    expect(navItems).toEqual([...sections])

    void unmount(component)
  })

  test('selects System by default', () => {
    const component = mountAdminApp()

    expect(document.querySelector('[aria-current="page"]')?.textContent?.trim()).toBe('System')
    expect(document.querySelector('[data-testid="admin-section-title"]')?.textContent).toContain('System')

    void unmount(component)
  })

  test('switches section when the hash changes', () => {
    const component = mountAdminApp()

    location.hash = '#stats'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    flushSync()

    expect(document.querySelector('[aria-current="page"]')?.textContent?.trim()).toBe('Stats')
    expect(document.querySelector('[data-testid="admin-section-title"]')?.textContent).toContain('Stats')

    void unmount(component)
  })
})
