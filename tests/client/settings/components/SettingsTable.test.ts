// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import SettingsTable from '../../../../client/settings/components/SettingsTable.svelte'

interface Row extends Record<string, unknown> {
  id: string
  name: string
}
const columns = [
  { key: 'id' as const, label: 'ID' },
  { key: 'name' as const, label: 'Name' },
]
const rows: Row[] = Array.from({ length: 30 }, (_, i) => ({ id: String(i), name: `n${i}` }))

afterEach(() => {
  document.body.innerHTML = ''
})

describe('SettingsTable', () => {
  test('paginates at the default page size of 25', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const c = mount(SettingsTable, { target, props: { columns, rows, rowKey: 'id', searchKeys: ['id', 'name'] } })
    flushSync()
    expect(target.querySelectorAll('tbody tr').length).toBe(25)
    expect(target.querySelector('[data-testid="settings-table-next"]')).not.toBeNull()
    void unmount(c)
  })

  test('search filters visible rows live', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const c = mount(SettingsTable, { target, props: { columns, rows, rowKey: 'id', searchKeys: ['id', 'name'] } })
    flushSync()
    const search = target.querySelector<HTMLInputElement>('[data-testid="settings-table-search"]')!
    search.value = 'n29'
    search.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    expect(target.querySelectorAll('tbody tr').length).toBe(1)
    expect(target.textContent).toContain('n29')
    void unmount(c)
  })
})
