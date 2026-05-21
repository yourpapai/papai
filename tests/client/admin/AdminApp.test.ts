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
  const target = document.querySelector<HTMLElement>('#root')
  if (target === null) throw new Error('root missing')
  return mount(AdminApp, { target })
}

const textOf = (selector: string): string => {
  const element = document.querySelector(selector)
  if (element === null) throw new Error(`${selector} missing`)
  const text = element.textContent
  if (text === null) throw new Error(`${selector} has no text`)
  return text
}

const trimmedText = (item: Element): string => {
  const text = item.textContent
  if (text === null) throw new Error('element has no text')
  return text.trim()
}

describe('AdminApp.svelte', () => {
  test('renders seven navigation items', () => {
    const component = mountAdminApp()

    const navItems = Array.from(document.querySelectorAll('[data-testid="admin-nav-item"]')).map((item) =>
      trimmedText(item),
    )

    expect(navItems).toEqual([...sections])

    void unmount(component)
  })

  test('selects System by default', () => {
    const component = mountAdminApp()

    expect(textOf('[aria-current="page"]').trim()).toBe('System')
    expect(textOf('[data-testid="admin-section-title"]')).toContain('System')

    void unmount(component)
  })

  test('renders Stats when the hash targets stats', () => {
    const component = mountAdminApp()

    location.hash = '#stats'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    flushSync()

    expect(textOf('[aria-current="page"]').trim()).toBe('Stats')
    expect(textOf('[data-testid="admin-section-title"]')).toContain('Stats')

    void unmount(component)
  })
})
