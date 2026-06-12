// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import SettingsSidebar from '../../../../client/settings/components/SettingsSidebar.svelte'

interface SidebarGroup {
  kicker: string
  items: readonly { id: string; label: string }[]
  danger?: boolean
}

const groups: SidebarGroup[] = [
  {
    kicker: 'Personal',
    items: [
      { id: 'profile', label: 'Profile' },
      { id: 'tools', label: 'Tools' },
    ],
  },
  { kicker: 'Admin', danger: true, items: [{ id: 'system', label: 'System' }] },
]

afterEach(() => {
  document.body.innerHTML = ''
})

describe('SettingsSidebar', () => {
  test('renders group kickers and links', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const c = mount(SettingsSidebar, { target, props: { groups, activeId: 'profile' } })
    flushSync()
    expect(target.textContent).toContain('Personal')
    expect(target.textContent).toContain('Admin')
    expect(target.querySelector('a[href="#system"]')).not.toBeNull()
    void unmount(c)
  })
  test('marks the active link with aria-current', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const c = mount(SettingsSidebar, { target, props: { groups, activeId: 'tools' } })
    flushSync()
    const active = target.querySelector('a[href="#tools"]')!
    expect(active.getAttribute('aria-current')).toBe('page')
    expect(target.querySelector('a[href="#profile"]')!.getAttribute('aria-current')).toBeNull()
    void unmount(c)
  })
  test('flags the admin group as a danger zone', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const c = mount(SettingsSidebar, { target, props: { groups, activeId: 'profile' } })
    flushSync()
    expect(target.querySelector('.settings-sidebar__group--danger')).not.toBeNull()
    void unmount(c)
  })
})
