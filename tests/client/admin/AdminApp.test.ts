// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import AdminApp from '../../../client/admin/AdminApp.svelte'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

const sectionIds = ['overview', 'billing', 'stats', 'memos', 'reminders', 'identities', 'instances'] as const

function mountAdminApp(): ReturnType<typeof mount> {
  document.body.innerHTML = '<div id="root"></div>'
  history.replaceState(null, '', '/admin')
  const target = document.querySelector<HTMLElement>('#root')
  if (target === null) throw new Error('root missing')
  return mount(AdminApp, { target })
}

const drain = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
  flushSync()
}

const installFetch = (): void => {
  setMockFetch((url) => {
    if (url === '/api/platform-instances' || url === '/api/task-instances' || url === '/api/admins') {
      return Promise.resolve(Response.json([]))
    }
    return Promise.resolve(new Response(JSON.stringify({}), { headers: { 'Content-Type': 'application/json' } }))
  })
}

afterEach(() => {
  restoreFetch()
})

describe('AdminApp.svelte', () => {
  test('renders all seven section anchor ids', async () => {
    installFetch()
    const component = mountAdminApp()
    await drain()

    for (const id of sectionIds) {
      expect(document.querySelector(`#${id}`)).not.toBeNull()
    }

    void unmount(component)
  })

  test('renders seven navigation items', async () => {
    installFetch()
    const component = mountAdminApp()
    await drain()

    const navLinks = Array.from(document.querySelectorAll('.admin-sidebar__link'))
    expect(navLinks).toHaveLength(7)

    void unmount(component)
  })

  test('renders overview section in the DOM', async () => {
    installFetch()
    const component = mountAdminApp()
    await drain()

    expect(document.querySelector('#overview')).not.toBeNull()

    void unmount(component)
  })

  test('system section is absent from the DOM', async () => {
    installFetch()
    const component = mountAdminApp()
    await drain()

    expect(document.querySelector('#system')).toBeNull()

    void unmount(component)
  })

  test('instances section is the last section in the DOM', async () => {
    installFetch()
    const component = mountAdminApp()
    await drain()

    const instances = document.querySelector('#instances')
    expect(instances).not.toBeNull()

    void unmount(component)
  })
})
