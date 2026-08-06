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
    adminGlobals.error = null
    document.body.innerHTML = '<div id="root"></div>'
    target = document.body.querySelector<HTMLElement>('#root')!
    setMockFetch(() =>
      Promise.resolve(new Response(JSON.stringify({}), { headers: { 'Content-Type': 'application/json' } })),
    )
  })

  afterEach(() => {
    adminGlobals.window = '30d'
    adminGlobals.error = null
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

  test('renders 1d in the window seg', () => {
    const component = mount(AdminTopBar, { target, props: {} })
    const labels = Array.from(target.querySelectorAll<HTMLButtonElement>('.ui-seg__btn')).map((b) => b.textContent)
    expect(labels).toContain('1d')
    expect(labels).not.toContain('24h')
    void unmount(component)
  })

  test('the status pill reports fetch health rather than a hardcoded claim', async () => {
    const url = new URL('../../../../client/admin/components/AdminTopBar.svelte', import.meta.url)
    const svelte = await Bun.file(url).text()
    expect(svelte).not.toContain('configured')
    expect(svelte).toContain("{ tone: 'neutral' as const, text: 'loading' }")
    expect(svelte).toContain("{ tone: 'warn' as const, text: 'stale' }")
    expect(svelte).toContain("{ tone: 'accent' as const, text: 'live' }")
  })

  test('status pill reads "loading" while a refresh is in flight', () => {
    adminGlobals.loading = true
    const component = mount(AdminTopBar, { target, props: {} })
    expect(target.textContent).toContain('loading')
    void unmount(component)
  })

  test('status pill reads "loading" (not "stale") when a refresh is retried after a failure', () => {
    adminGlobals.loading = true
    adminGlobals.error = 'request failed with status 500'
    const component = mount(AdminTopBar, { target, props: {} })
    expect(target.textContent).toContain('loading')
    expect(target.textContent).not.toContain('stale')
    void unmount(component)
  })

  test('status pill reads "stale" after a failed refresh', () => {
    adminGlobals.error = 'request failed with status 500'
    const component = mount(AdminTopBar, { target, props: {} })
    expect(target.textContent).toContain('stale')
    void unmount(component)
  })

  test('status pill reads "live" once data is fresh', () => {
    adminGlobals.loading = false
    adminGlobals.error = null
    const component = mount(AdminTopBar, { target, props: {} })
    expect(target.textContent).toContain('live')
    void unmount(component)
  })
})
