// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createRawSnippet, mount, unmount } from 'svelte'
import type { Snippet } from 'svelte'

import Pill from '../../../../client/shared/ui/Pill.svelte'

function textSnippet(text: string): Snippet {
  return createRawSnippet((): { render: () => string } => ({ render: (): string => `<span>${text}</span>` }))
}

type Tone = 'accent' | 'warn' | 'danger' | 'info' | 'neutral' | 'mute'

describe('Pill.svelte', () => {
  test('renders the label text', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Pill, {
      target,
      props: { children: textSnippet('connected'), tone: 'accent', dot: true },
    })
    expect(target.textContent).toContain('connected')
    void unmount(component)
  })

  test.each<Tone>(['accent', 'warn', 'danger', 'info', 'neutral', 'mute'])(
    'applies the ui-pill--%s tone class',
    (tone) => {
      document.body.innerHTML = '<div id="root"></div>'
      const target = document.body.querySelector<HTMLElement>('#root')!
      const component = mount(Pill, { target, props: { children: textSnippet('x'), tone } })
      expect(target.querySelector(`.ui-pill--${tone}`)).not.toBeNull()
      void unmount(component)
    },
  )

  test('renders a Dot when dot=true', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Pill, {
      target,
      props: { children: textSnippet('ok'), tone: 'accent', dot: true },
    })
    expect(target.querySelector('.ui-dot')).not.toBeNull()
    void unmount(component)
  })
})
