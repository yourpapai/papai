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

  test('forwards testid to the select element and emits onChange', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    let picked = ''
    const c = mount(Select, {
      target,
      props: {
        value: 'a',
        options: [
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ],
        onChange: (v: string) => {
          picked = v
        },
        testid: 'type-input',
      },
    })
    const sel = target.querySelector<HTMLSelectElement>('[data-testid="type-input"]')!
    expect(sel.tagName).toBe('SELECT')
    sel.value = 'b'
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    expect(picked).toBe('b')
    void unmount(c)
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

  test('applies the disabled attribute and disabled class when disabled', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Select, {
      target,
      props: {
        value: 'a',
        options: [
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ],
        disabled: true,
        testid: 'sel',
      },
    })
    const sel = target.querySelector<HTMLSelectElement>('[data-testid="sel"]')!
    expect(sel.disabled).toBe(true)
    expect(target.querySelector('.ui-select--disabled')).not.toBeNull()
    void unmount(component)
  })
})
