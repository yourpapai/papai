// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import AdminTopBar from '../../../../client/admin/components/AdminTopBar.svelte'
import { adminGlobals } from '../../../../client/admin/global-stats.svelte.js'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

describe('AdminTopBar.svelte', () => {
  let target: HTMLElement

  beforeEach(() => {
    adminGlobals.window = '30d'
    adminGlobals.data = null
    adminGlobals.fetchedAt = null
    adminGlobals.loading = false
    document.body.innerHTML = '<div id="root"></div>'
    target = document.body.querySelector<HTMLElement>('#root')!
    setMockFetch(() =>
      Promise.resolve(new Response(JSON.stringify({}), { headers: { 'Content-Type': 'application/json' } })),
    )
  })

  afterEach(() => {
    adminGlobals.window = '30d'
    restoreFetch()
  })

  test('renders brand "papai ::admin"', () => {
    const component = mount(AdminTopBar, { target, props: {} })
    expect(target.textContent).toContain('papai')
    expect(target.textContent).toContain('admin')
    void unmount(component)
  })

  test('Seg reflects adminGlobals.window and writes back on click', () => {
    const component = mount(AdminTopBar, { target, props: {} })
    const active = target.querySelector('.ui-seg__btn--active')
    expect(active?.textContent).toBe('30d')
    const sevenBtn = Array.from(target.querySelectorAll<HTMLButtonElement>('.ui-seg__btn')).find(
      (b) => b.textContent === '7d',
    )!
    sevenBtn.click()
    expect(adminGlobals.window).toBe('7d')
    void unmount(component)
  })

  test('renders a /debug back link', () => {
    const component = mount(AdminTopBar, { target, props: {} })
    const link = target.querySelector<HTMLAnchorElement>('a[href="/debug"]')
    expect(link).not.toBeNull()
    void unmount(component)
  })
})
