// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

describe('admin.css', () => {
  test('defines masked-value class', async () => {
    const url = new URL('../../../client/admin/admin.css', import.meta.url)
    const css = await Bun.file(url).text()
    expect(css).toContain('.masked-value')
  })

  test('defines masked-hint class', async () => {
    const url = new URL('../../../client/admin/admin.css', import.meta.url)
    const css = await Bun.file(url).text()
    expect(css).toContain('.masked-hint')
  })

  test('the rail is styled in AdminSidebarPanel only, not in the global sheet', async () => {
    const url = new URL('../../../client/admin/admin.css', import.meta.url)
    const css = await Bun.file(url).text()
    expect(css).not.toContain('.admin-sidebar')
  })

  test('the rail declares its own hover and active states in one place', async () => {
    const url = new URL('../../../client/admin/components/AdminSidebarPanel.svelte', import.meta.url)
    const svelte = await Bun.file(url).text()
    expect(svelte).toContain('.admin-sidebar__link:hover')
    expect(svelte).toContain('.admin-sidebar__link--active')
  })

  test('the rail spends the shared spacing scale rather than one-off px', async () => {
    const url = new URL('../../../client/admin/components/AdminSidebarPanel.svelte', import.meta.url)
    const svelte = await Bun.file(url).text()
    const rail = svelte.match(/\.admin-sidebar \{[^}]*\}/u)
    expect(rail).not.toBeNull()
    const [rule] = rail!
    expect(rule).toContain('gap: var(--s2)')
    expect(rule).toContain('padding: var(--s3)')
  })

  test('the grid fills the remaining height so its columns can scroll independently', async () => {
    const url = new URL('../../../client/admin/admin.css', import.meta.url)
    const css = await Bun.file(url).text()
    const m = css.match(/\.admin-grid \{[^}]*\}/u)
    expect(m).not.toBeNull()
    const [grid] = m!
    expect(grid).toContain('flex: 1 1 auto')
    expect(grid).toContain('min-height: 0')
  })

  test('the main column owns its own scroll', async () => {
    const url = new URL('../../../client/admin/admin.css', import.meta.url)
    const css = await Bun.file(url).text()
    const m = css.match(/\.admin-grid__main \{[^}]*\}/u)
    expect(m).not.toBeNull()
    const [main] = m!
    expect(main).toContain('overflow-y: auto')
  })

  test('the rail fills its track instead of being a sticky 100vh box', async () => {
    const url = new URL('../../../client/admin/components/AdminSidebarPanel.svelte', import.meta.url)
    const svelte = await Bun.file(url).text()
    const m = svelte.match(/\.admin-sidebar \{[^}]*\}/u)
    expect(m).not.toBeNull()
    const [rail] = m!
    expect(rail).toContain('height: 100%')
    expect(rail).toContain('overflow-y: auto')
    expect(rail).not.toContain('100vh')
    expect(rail).not.toContain('position: sticky')
  })

  test('the admin shell body does not double as a page scroller', async () => {
    const url = new URL('../../../client/admin/AdminApp.svelte', import.meta.url)
    const svelte = await Bun.file(url).text()
    expect(svelte).toContain('bodyScroll={false}')
  })

  test('the single-column cutover happens at 900px, above the squeeze band', async () => {
    const url = new URL('../../../client/admin/admin.css', import.meta.url)
    const css = await Bun.file(url).text()
    expect(css).toContain('@media (max-width: 900px)')
    expect(css).not.toContain('@media (max-width: 720px)')
  })

  test('the rail hides below the cutover and the jump menu appears', async () => {
    const railUrl = new URL('../../../client/admin/components/AdminSidebarPanel.svelte', import.meta.url)
    const rail = await Bun.file(railUrl).text()
    expect(rail).toMatch(/@media \(max-width: 900px\) \{\s*\.admin-sidebar \{\s*display: none;/u)

    const jumpUrl = new URL('../../../client/admin/components/AdminJumpMenu.svelte', import.meta.url)
    const jump = await Bun.file(jumpUrl).text()
    expect(jump).toMatch(/@media \(max-width: 900px\) \{\s*\.admin-jump \{\s*display: flex;/u)
  })

  test('the jump menu names itself without the settings-only type utility', async () => {
    const jumpUrl = new URL('../../../client/admin/components/AdminJumpMenu.svelte', import.meta.url)
    const jump = await Bun.file(jumpUrl).text()
    expect(jump).toContain('id="admin-jump-label"')
    expect(jump).toContain('ariaLabelledby="admin-jump-label"')
    expect(jump).not.toContain('t-label')
  })

  test('the focus ring uses the shared tokens rather than a copied literal', async () => {
    const url = new URL('../../../client/admin/admin.css', import.meta.url)
    const css = await Bun.file(url).text()
    const m = css.match(/[^}]*:focus-visible \{[^}]*\}/u)
    expect(m).not.toBeNull()
    const [rule] = m!
    expect(rule).toContain('outline: var(--focus-ring)')
    expect(rule).toContain('outline-offset: var(--focus-ring-offset)')
    expect(css).not.toContain('rgba(82, 224, 138, 0.4)')
  })

  test('the nav is named and the current section is announced, not only coloured', async () => {
    const url = new URL('../../../client/admin/components/AdminSidebarPanel.svelte', import.meta.url)
    const svelte = await Bun.file(url).text()
    expect(svelte).toContain('aria-label="Admin sections"')
    expect(svelte).toContain("aria-current={activeId === item.id ? 'true' : undefined}")
  })
})
