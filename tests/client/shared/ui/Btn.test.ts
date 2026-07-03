// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createRawSnippet, mount, unmount } from 'svelte'
import type { Snippet } from 'svelte'

import Btn from '../../../../client/shared/ui/Btn.svelte'

function textSnippet(text: string): Snippet {
  return createRawSnippet((): { render: () => string } => ({
    render: (): string => `<span>${text}</span>`,
  }))
}

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

describe('Btn.svelte', () => {
  test.each<Variant>(['primary', 'secondary', 'outline', 'ghost', 'danger'])(
    'applies ui-btn--%s variant class',
    (variant) => {
      document.body.innerHTML = '<div id="root"></div>'
      const target = document.body.querySelector<HTMLElement>('#root')!
      const component = mount(Btn, { target, props: { children: textSnippet('x'), variant } })
      expect(target.querySelector(`.ui-btn--${variant}`)).not.toBeNull()
      void unmount(component)
    },
  )

  test.each<Size>(['sm', 'md', 'lg'])('applies ui-btn--%s size class', (size) => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Btn, { target, props: { children: textSnippet('x'), size } })
    expect(target.querySelector(`.ui-btn--${size}`)).not.toBeNull()
    void unmount(component)
  })

  test('invokes onClick when clicked', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    let clicked = false
    const component = mount(Btn, {
      target,
      props: {
        children: textSnippet('go'),
        onClick: () => {
          clicked = true
        },
      },
    })
    const btn = target.querySelector<HTMLButtonElement>('.ui-btn')!
    btn.click()
    expect(clicked).toBe(true)
    void unmount(component)
  })

  test('forwards testid to the button element', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(Btn, { target, props: { children: textSnippet('go'), testid: 'do-thing' } })
    expect(target.querySelector('[data-testid="do-thing"]')?.tagName).toBe('BUTTON')
    void unmount(c)
  })

  test('Btn.svelte source contains :hover rules for every variant', async () => {
    const url = new URL('../../../../client/shared/ui/Btn.svelte', import.meta.url)
    const source = await Bun.file(url).text()
    for (const variant of ['primary', 'secondary', 'outline', 'ghost', 'danger'] as const) {
      expect(source).toContain(`.ui-btn--${variant}:hover`)
    }
  })

  test('renders icon Snippet before children when provided', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const iconSnippet = createRawSnippet(() => ({
      render: (): string => '<span data-testid="icon">+</span>',
    }))
    const component = mount(Btn, {
      target,
      props: { children: textSnippet('Save'), icon: iconSnippet },
    })
    const btn = target.querySelector<HTMLButtonElement>('.ui-btn')!
    const icon = btn.querySelector('[data-testid="icon"]')
    expect(icon).not.toBeNull()
    expect(btn.innerHTML.indexOf('data-testid="icon"')).toBeLessThan(btn.innerHTML.indexOf('Save'))
    void unmount(component)
  })

  test('applies ui-btn--busy class and aria-busy when busy', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Btn, { target, props: { children: textSnippet('x'), busy: true } })
    const btn = target.querySelector<HTMLButtonElement>('.ui-btn')!
    expect(btn.classList.contains('ui-btn--busy')).toBe(true)
    expect(btn.getAttribute('aria-busy')).toBe('true')
    void unmount(component)
  })

  test('does not invoke onClick while busy', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    let clicked = 0
    const component = mount(Btn, {
      target,
      props: {
        children: textSnippet('go'),
        busy: true,
        onClick: () => {
          clicked += 1
        },
      },
    })
    target.querySelector<HTMLButtonElement>('.ui-btn')!.click()
    expect(clicked).toBe(0)
    void unmount(component)
  })

  test('Btn.svelte source contains a :focus-visible ring', async () => {
    const url = new URL('../../../../client/shared/ui/Btn.svelte', import.meta.url)
    const source = await Bun.file(url).text()
    expect(source).toContain('.ui-btn:focus-visible')
  })
})
