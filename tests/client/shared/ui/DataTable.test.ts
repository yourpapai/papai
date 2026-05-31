// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import DataTable from '../../../../client/shared/ui/DataTable.svelte'

interface Row {
  id: string
  name: string
  count: number
}

const columns = [
  { key: 'id' as const, label: 'ID' },
  { key: 'name' as const, label: 'Name' },
  { key: 'count' as const, label: 'Count', align: 'right' as const },
]

describe('DataTable.svelte', () => {
  test('renders one tr per row plus header row', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const rows: Row[] = [
      { id: 'a', name: 'alpha', count: 1 },
      { id: 'b', name: 'beta', count: 2 },
    ]
    const component = mount(DataTable, { target, props: { columns, rows } })
    expect(target.querySelectorAll('thead tr').length).toBe(1)
    expect(target.querySelectorAll('tbody tr').length).toBe(2)
    void unmount(component)
  })

  test('renders column labels in th', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(DataTable, { target, props: { columns, rows: [] } })
    const ths = target.querySelectorAll('thead th')
    expect(ths[0]?.textContent?.trim()).toBe('ID')
    expect(ths[1]?.textContent?.trim()).toBe('Name')
    expect(ths[2]?.textContent?.trim()).toBe('Count')
    void unmount(component)
  })

  test('renders cell values', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const rows: Row[] = [{ id: 'x1', name: 'xenon', count: 42 }]
    const component = mount(DataTable, { target, props: { columns, rows } })
    expect(target.textContent).toContain('xenon')
    expect(target.textContent).toContain('42')
    void unmount(component)
  })

  test('fires onRowClick when row clicked', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const clicks: Row[] = []
    const rows: Row[] = [{ id: 'r1', name: 'one', count: 1 }]
    const component = mount(DataTable, {
      target,
      props: { columns, rows, onRowClick: (row: Row) => clicks.push(row) },
    })
    const tr = target.querySelector<HTMLTableRowElement>('tbody tr')
    tr?.click()
    expect(clicks).toEqual([{ id: 'r1', name: 'one', count: 1 }])
    void unmount(component)
  })
})
