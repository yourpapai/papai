// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import AdminSidebarPanel from '../../../../client/admin/components/AdminSidebarPanel.svelte'

describe('AdminSidebarPanel.svelte', () => {
  let target: HTMLElement

  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>'
    target = document.body.querySelector<HTMLElement>('#root')!
  })

  test('renders an anchor link for each section', () => {
    const component = mount(AdminSidebarPanel, { target, props: { activeId: 'overview' } })
    for (const id of ['overview', 'billing', 'stats', 'memos', 'reminders', 'identities', 'groups', 'system']) {
      const link = target.querySelector<HTMLAnchorElement>(`a[href="#${id}"]`)
      expect(link).not.toBeNull()
    }
    void unmount(component)
  })

  test('marks the active link', () => {
    const component = mount(AdminSidebarPanel, { target, props: { activeId: 'billing' } })
    const active = target.querySelector('.admin-sidebar__link--active')
    expect(active?.getAttribute('href')).toBe('#billing')
    void unmount(component)
  })
})
