// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createRawSnippet, mount, unmount } from 'svelte'
import type { Snippet } from 'svelte'

import Toolbar from '../../../../client/shared/ui/Toolbar.svelte'

function snip(text: string): Snippet {
  return createRawSnippet((): { render: () => string } => ({ render: (): string => `<span>${text}</span>` }))
}

describe('Toolbar.svelte', () => {
  test('wraps children in a toolbar container', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(Toolbar, { target, props: { children: snip('ACTIONS') } })
    expect(target.querySelector('.ui-toolbar')?.textContent).toContain('ACTIONS')
    void unmount(c)
  })
})
