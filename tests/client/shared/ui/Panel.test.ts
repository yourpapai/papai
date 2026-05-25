// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createRawSnippet, mount, unmount } from 'svelte'
import type { Snippet } from 'svelte'

import Panel from '../../../../client/shared/ui/Panel.svelte'

function textSnippet(text: string): Snippet {
  return createRawSnippet((): { render: () => string } => ({
    render: (): string => `<span>${text}</span>`,
  }))
}

describe('Panel.svelte', () => {
  test('renders title and body content', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Panel, {
      target,
      props: { title: 'sessions', body: textSnippet('row1') },
    })
    expect(target.querySelector('.ui-panel__title')!.textContent).toBe('sessions')
    expect(target.querySelector('.ui-panel__body')!.textContent).toContain('row1')
    void unmount(component)
  })

  test('renders the count when provided', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Panel, {
      target,
      props: { title: 'sessions', count: 12, body: textSnippet('rows') },
    })
    expect(target.querySelector('.ui-panel__count')!.textContent).toBe('12')
    void unmount(component)
  })

  test('renders the action snippet', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Panel, {
      target,
      props: {
        title: 'sessions',
        body: textSnippet('rows'),
        action: textSnippet('⟳'),
      },
    })
    expect(target.querySelector('.ui-panel__action')!.textContent).toContain('⟳')
    void unmount(component)
  })

  test('omits the header when title is undefined', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Panel, { target, props: { body: textSnippet('only body') } })
    expect(target.querySelector('.ui-panel__header')).toBeNull()
    expect(target.querySelector('.ui-panel__body')!.textContent).toContain('only body')
    void unmount(component)
  })
})
