// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createRawSnippet, mount, unmount } from 'svelte'
import type { Snippet } from 'svelte'

import Caption from '../../../../client/shared/ui/Caption.svelte'

function textSnippet(text: string): Snippet {
  return createRawSnippet((): { render: () => string } => ({ render: (): string => `<span>${text}</span>` }))
}

describe('Caption.svelte', () => {
  test('renders the snippet content uppercase with letter-spacing', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Caption, {
      target,
      props: { children: textSnippet('overview') },
    })
    const el = target.querySelector<HTMLElement>('.ui-caption')!
    expect(el.textContent).toContain('overview')
    expect(el.style.textTransform).toBe('uppercase')
    expect(el.style.letterSpacing).toBe('0.1em')
    void unmount(component)
  })
})
