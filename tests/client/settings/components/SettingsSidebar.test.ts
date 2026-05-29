// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import SettingsSidebar from '../../../../client/settings/components/SettingsSidebar.svelte'

const render = (props: Record<string, unknown>): { component: ReturnType<typeof mount>; target: HTMLElement } => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  return { component: mount(SettingsSidebar, { target, props }), target }
}

describe('SettingsSidebar', () => {
  test('renders one link per item with hash hrefs', () => {
    const { component, target } = render({
      items: [
        { id: 'profile', label: 'Profile' },
        { id: 'tools', label: 'Tools' },
      ],
      activeId: 'profile',
    })
    flushSync()
    const links = Array.from(target.querySelectorAll('a'))
    expect(links).toHaveLength(2)
    expect(links[0]!.getAttribute('href')).toBe('#profile')
    void unmount(component)
  })

  test('marks the active item', () => {
    const { component, target } = render({
      items: [{ id: 'profile', label: 'Profile' }],
      activeId: 'profile',
    })
    flushSync()
    expect(target.querySelector('.settings-sidebar__link--active')).not.toBeNull()
    void unmount(component)
  })
})
