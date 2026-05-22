// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import Select from '../../../../client/shared/ui/Select.svelte'

describe('Select.svelte', () => {
  test('renders one <option> per option entry', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Select, {
      target,
      props: {
        value: '30d',
        options: [
          { value: '24h', label: '24h' },
          { value: '7d', label: '7d' },
          { value: '30d', label: '30d' },
          { value: 'all', label: 'all' },
        ],
      },
    })
    const opts = target.querySelectorAll('option')
    expect(opts.length).toBe(4)
    expect(target.querySelector<HTMLSelectElement>('select')!.value).toBe('30d')
    void unmount(component)
  })

  test('calls onChange with the new value', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    let last = ''
    const component = mount(Select, {
      target,
      props: {
        value: '30d',
        options: [
          { value: '7d', label: '7d' },
          { value: '30d', label: '30d' },
        ],
        onChange: (v: string) => {
          last = v
        },
      },
    })
    const sel = target.querySelector<HTMLSelectElement>('select')!
    sel.value = '7d'
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    expect(last).toBe('7d')
    void unmount(component)
  })
})
