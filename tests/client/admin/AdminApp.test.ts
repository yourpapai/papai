// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import AdminApp from '../../../client/admin/AdminApp.svelte'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

const sectionIds = ['overview', 'billing', 'stats', 'memos', 'reminders', 'identities', 'groups', 'system'] as const

function mountAdminApp(): ReturnType<typeof mount> {
  document.body.innerHTML = '<div id="root"></div>'
  history.replaceState(null, '', '/admin')
  const target = document.querySelector<HTMLElement>('#root')
  if (target === null) throw new Error('root missing')
  return mount(AdminApp, { target })
}

afterEach(() => {
  restoreFetch()
})

describe('AdminApp.svelte', () => {
  test('renders all eight section anchor ids', () => {
    setMockFetch(() =>
      Promise.resolve(new Response(JSON.stringify({}), { headers: { 'Content-Type': 'application/json' } })),
    )
    const component = mountAdminApp()

    for (const id of sectionIds) {
      expect(document.getElementById(id)).not.toBeNull()
    }

    void unmount(component)
  })

  test('renders eight navigation items', () => {
    setMockFetch(() =>
      Promise.resolve(new Response(JSON.stringify({}), { headers: { 'Content-Type': 'application/json' } })),
    )
    const component = mountAdminApp()

    const navLinks = Array.from(document.querySelectorAll('.admin-sidebar__link'))
    expect(navLinks).toHaveLength(8)

    void unmount(component)
  })

  test('renders overview section in the DOM', () => {
    setMockFetch(() =>
      Promise.resolve(new Response(JSON.stringify({}), { headers: { 'Content-Type': 'application/json' } })),
    )
    const component = mountAdminApp()

    expect(document.getElementById('overview')).not.toBeNull()

    void unmount(component)
  })

  test('renders system section in the DOM', () => {
    setMockFetch(() =>
      Promise.resolve(new Response(JSON.stringify({}), { headers: { 'Content-Type': 'application/json' } })),
    )
    const component = mountAdminApp()

    expect(document.getElementById('system')).not.toBeNull()

    void unmount(component)
  })
})
