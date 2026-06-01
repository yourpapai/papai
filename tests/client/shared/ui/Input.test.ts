// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createRawSnippet, mount, unmount } from 'svelte'
import type { Snippet } from 'svelte'

import Input from '../../../../client/shared/ui/Input.svelte'

function textSnippet(text: string): Snippet {
  return createRawSnippet((): { render: () => string } => ({
    render: (): string => `<span>${text}</span>`,
  }))
}

describe('Input.svelte', () => {
  test('renders an input with the given placeholder', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Input, { target, props: { value: '', placeholder: 'search…' } })
    const input = target.querySelector<HTMLInputElement>('input')!
    expect(input.placeholder).toBe('search…')
    void unmount(component)
  })

  test('renders the prefix snippet alongside the input', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Input, {
      target,
      props: { value: '', prefix: textSnippet('⌕') },
    })
    expect(target.querySelector('.ui-input__prefix')!.textContent).toContain('⌕')
    void unmount(component)
  })

  test('supports password type and forwards testid', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(Input, { target, props: { value: '', type: 'password', testid: 'secret-field' } })
    const input = target.querySelector<HTMLInputElement>('[data-testid="secret-field"]')!
    expect(input.tagName).toBe('INPUT')
    expect(input.getAttribute('type')).toBe('password')
    void unmount(c)
  })

  test('emits onInput with the new value', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    let seen = ''
    const c = mount(Input, {
      target,
      props: {
        value: '',
        onInput: (v: string) => {
          seen = v
        },
      },
    })
    const input = target.querySelector<HTMLInputElement>('input')!
    input.value = 'hello'
    input.dispatchEvent(new Event('input'))
    expect(seen).toBe('hello')
    void unmount(c)
  })

  test('calls onInput when the input value changes', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    let last = ''
    const component = mount(Input, {
      target,
      props: {
        value: '',
        onInput: (v: string) => {
          last = v
        },
      },
    })
    const input = target.querySelector<HTMLInputElement>('input')!
    input.value = 'hi'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(last).toBe('hi')
    void unmount(component)
  })
})
