// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import Dot from '../../../../client/shared/ui/Dot.svelte'

function render(props: Record<string, unknown>): { target: HTMLElement; component: ReturnType<typeof mount> } {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  const component = mount(Dot, { target, props })
  return { target, component }
}

describe('Dot.svelte', () => {
  test('renders a 6x6 span by default with accent color', () => {
    const { target, component } = render({})
    const dot = target.querySelector<HTMLElement>('.ui-dot')
    expect(dot).not.toBeNull()
    expect(dot!.style.width).toBe('6px')
    expect(dot!.style.height).toBe('6px')
    expect(dot!.style.background).toContain('var(--accent)')
    void unmount(component)
  })

  test('uses the provided color and size', () => {
    const { target, component } = render({ color: 'var(--danger)', size: 10 })
    const dot = target.querySelector<HTMLElement>('.ui-dot')
    expect(dot).not.toBeNull()
    expect(dot!.style.width).toBe('10px')
    expect(dot!.style.background).toContain('var(--danger)')
    void unmount(component)
  })

  test('omits glow when glow=false', () => {
    const { target, component } = render({ glow: false })
    const dot = target.querySelector<HTMLElement>('.ui-dot')
    expect(dot).not.toBeNull()
    expect(dot!.style.boxShadow).toBe('none')
    void unmount(component)
  })
})
