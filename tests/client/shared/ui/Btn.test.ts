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

  test('Btn.svelte source contains :hover rules for every variant', async () => {
    const url = new URL('../../../../client/shared/ui/Btn.svelte', import.meta.url)
    const source = await Bun.file(url).text()
    for (const variant of ['primary', 'secondary', 'outline', 'ghost', 'danger'] as const) {
      expect(source).toContain(`.ui-btn--${variant}:hover`)
    }
  })
})
