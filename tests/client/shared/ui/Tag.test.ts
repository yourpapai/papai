// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createRawSnippet, mount, unmount } from 'svelte'
import type { Snippet } from 'svelte'

import Tag from '../../../../client/shared/ui/Tag.svelte'

function snip(text: string): Snippet {
  return createRawSnippet((): { render: () => string } => ({ render: (): string => `<span>${text}</span>` }))
}

type TagTone = 'neutral' | 'required' | 'optional' | 'info'

describe('Tag.svelte', () => {
  test('renders content', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(Tag, { target, props: { children: snip('required') } })
    expect(target.textContent).toContain('required')
    void unmount(c)
  })
  test.each<TagTone>(['neutral', 'required', 'optional', 'info'])('applies the ui-tag--%s tone class', (tone) => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(Tag, { target, props: { children: snip('x'), tone } })
    expect(target.querySelector(`.ui-tag--${tone}`)).not.toBeNull()
    void unmount(c)
  })
})
