// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createRawSnippet, mount, unmount } from 'svelte'
import type { Snippet } from 'svelte'

import TopBar from '../../../../client/shared/ui/TopBar.svelte'

function textSnippet(text: string): Snippet {
  return createRawSnippet((): { render: () => string } => ({
    render: (): string => `<span>${text}</span>`,
  }))
}

describe('TopBar.svelte', () => {
  test('renders the brand with page suffix and the status row', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(TopBar, {
      target,
      props: { page: 'debug', statusRow: textSnippet('[connected]') },
    })
    const brand = target.querySelector('.ui-topbar__brand')!
    expect(brand.textContent).toContain('papai')
    expect(brand.textContent).toContain('::debug')
    expect(target.querySelector('.ui-topbar__status')!.textContent).toContain('[connected]')
    void unmount(component)
  })

  test('renders the secondary row when provided', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(TopBar, {
      target,
      props: {
        page: 'admin',
        statusRow: textSnippet('s'),
        secondaryRow: textSnippet('window 30d'),
      },
    })
    expect(target.querySelector('.ui-topbar__secondary')!.textContent).toContain('window 30d')
    void unmount(component)
  })

  test('omits the secondary row when not provided', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(TopBar, {
      target,
      props: { page: 'admin', statusRow: textSnippet('s') },
    })
    expect(target.querySelector('.ui-topbar__secondary')).toBeNull()
    void unmount(component)
  })

  test('omits the status row when not provided', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(TopBar, {
      target,
      props: { page: 'admin' },
    })
    expect(target.querySelector('.ui-topbar__status')).toBeNull()
    expect(target.querySelector('.ui-topbar__brand')!.textContent).toContain('::admin')
    void unmount(component)
  })
})
