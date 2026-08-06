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
})
