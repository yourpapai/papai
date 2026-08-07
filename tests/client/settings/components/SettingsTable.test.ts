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

  test('shows a no-matches state instead of the empty snippet when a search filters everything out', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const c = mount(SettingsTable, { target, props: { columns, rows, rowKey: 'id', searchKeys: ['id', 'name'] } })
    flushSync()
    const search = target.querySelector<HTMLInputElement>('[data-testid="settings-table-search"]')!
    search.value = 'zzzz'
    search.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    expect(target.textContent).toContain('No matches')
    expect(target.textContent).toContain('zzzz')
    expect(target.querySelector('tbody')).toBeNull()
    void unmount(c)
  })

  test('clear search restores every row', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const c = mount(SettingsTable, { target, props: { columns, rows, rowKey: 'id', searchKeys: ['id', 'name'] } })
    flushSync()
    const search = target.querySelector<HTMLInputElement>('[data-testid="settings-table-search"]')!
    search.value = 'zzzz'
    search.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="settings-table-clear-search"]')!.click()
    flushSync()
    expect(target.querySelectorAll('tbody tr').length).toBe(25)
    void unmount(c)
  })

  test('an empty row set still renders the consumer empty snippet, not the no-matches state', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const c = mount(SettingsTable, { target, props: { columns, rows: [], rowKey: 'id', searchKeys: ['id', 'name'] } })
    flushSync()
    expect(target.textContent).not.toContain('No matches')
    void unmount(c)
  })

  test('passes sortable columns and defaultSort through to the table', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const sortableColumns = [
      { key: 'id' as const, label: 'ID' },
      { key: 'name' as const, label: 'Name', sortable: true },
    ]
    const three: Row[] = [
      { id: '1', name: 'charlie' },
      { id: '2', name: 'alice' },
      { id: '3', name: 'bob' },
    ]
    const c = mount(SettingsTable, {
      target,
      props: {
        columns: sortableColumns,
        rows: three,
        rowKey: 'id',
        searchKeys: ['id', 'name'],
        defaultSort: { key: 'name' as const, dir: 'asc' as const },
      },
    })
    flushSync()
    const firstRow = target.querySelectorAll('tbody tr')[0]!
    expect(firstRow.textContent).toContain('alice')
    void unmount(c)
  })
})
