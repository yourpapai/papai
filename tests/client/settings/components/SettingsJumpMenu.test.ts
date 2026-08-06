// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import SettingsJumpMenu from '../../../../client/settings/components/SettingsJumpMenu.svelte'

interface SidebarGroup {
  kicker: string
  items: readonly { id: string; label: string }[]
  danger?: boolean
  collapsible?: boolean
  collapsed?: boolean
}

const groups: SidebarGroup[] = [
  { kicker: 'Personal', items: [{ id: 'profile', label: 'Profile' }] },
  { kicker: 'Admin', danger: true, items: [{ id: 'system', label: 'System' }] },
]

afterEach(() => {
  document.body.innerHTML = ''
})

test('renders one option per item with the active value selected', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const c = mount(SettingsJumpMenu, { target, props: { groups, activeId: 'system' } })
  flushSync()
  const select = target.querySelector('select')!
  expect(select.value).toBe('system')
  expect(target.querySelectorAll('option').length).toBe(2)
  void unmount(c)
})

test('navigating sets the location hash', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const c = mount(SettingsJumpMenu, { target, props: { groups, activeId: 'profile' } })
  flushSync()
  const select = target.querySelector('select')!
  select.value = 'system'
  select.dispatchEvent(new Event('change', { bubbles: true }))
  flushSync()
  expect(window.location.hash).toBe('#system')
  void unmount(c)
})

test('uses the shared Select primitive rather than a bare select', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const c = mount(SettingsJumpMenu, { target, props: { groups, activeId: 'profile' } })
  flushSync()
  expect(target.querySelector('.ui-select')).not.toBeNull()
  expect(target.querySelector('.ui-select--block')).not.toBeNull()
  void unmount(c)
})

test('a collapsed group contributes no options and no optgroup', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const withCollapsed: SidebarGroup[] = [
    { kicker: 'Personal', items: [{ id: 'profile', label: 'Profile' }] },
    {
      kicker: 'Advanced',
      collapsible: true,
      collapsed: true,
      items: [{ id: 'memory', label: 'Memory' }],
    },
  ]
  const c = mount(SettingsJumpMenu, { target, props: { groups: withCollapsed, activeId: 'profile' } })
  flushSync()
  expect(target.querySelectorAll('optgroup').length).toBe(1)
  expect(target.querySelector('option[value="memory"]')).toBeNull()
  void unmount(c)
})

test('an expanded collapsible group keeps its options', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const expanded: SidebarGroup[] = [
    { kicker: 'Personal', items: [{ id: 'profile', label: 'Profile' }] },
    {
      kicker: 'Advanced',
      collapsible: true,
      collapsed: false,
      items: [{ id: 'memory', label: 'Memory' }],
    },
  ]
  const c = mount(SettingsJumpMenu, { target, props: { groups: expanded, activeId: 'profile' } })
  flushSync()
  expect(target.querySelectorAll('optgroup').length).toBe(2)
  expect(target.querySelector('option[value="memory"]')).not.toBeNull()
  void unmount(c)
})
