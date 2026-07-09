// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import Combobox from '../../../../client/shared/ui/Combobox.svelte'

describe('Combobox.svelte', () => {
  test('renders an input wired to a datalist with one option per entry', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Combobox, {
      target,
      props: {
        value: 'gpt-4o',
        options: [{ value: 'gpt-4o' }, { value: 'gpt-4o-mini' }],
        testid: 'model',
      },
    })
    const input = target.querySelector<HTMLInputElement>('[data-testid="model"]')!
    expect(input.tagName).toBe('INPUT')
    const listId = input.getAttribute('list')!
    expect(listId.length).toBeGreaterThan(0)
    const datalist = target.querySelector<HTMLDataListElement>(`#${listId}`)!
    expect(datalist.querySelectorAll('option').length).toBe(2)
    void unmount(component)
  })

  test('emits onInput with the typed value', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    let typed = ''
    const component = mount(Combobox, {
      target,
      props: {
        value: '',
        options: [],
        onInput: (v: string) => {
          typed = v
        },
        testid: 'model',
      },
    })
    const input = target.querySelector<HTMLInputElement>('[data-testid="model"]')!
    input.value = 'claude-sonnet-4'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(typed).toBe('claude-sonnet-4')
    void unmount(component)
  })

  test('applies the disabled attribute when disabled', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Combobox, {
      target,
      props: { value: '', options: [], disabled: true, testid: 'model' },
    })
    const input = target.querySelector<HTMLInputElement>('[data-testid="model"]')!
    expect(input.disabled).toBe(true)
    void unmount(component)
  })
})
