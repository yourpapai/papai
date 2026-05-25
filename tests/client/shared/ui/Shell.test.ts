// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createRawSnippet, mount, unmount } from 'svelte'
import type { Snippet } from 'svelte'

import Shell from '../../../../client/shared/ui/Shell.svelte'

function textSnippet(text: string): Snippet {
  return createRawSnippet((): { render: () => string } => ({
    render: (): string => `<span>${text}</span>`,
  }))
}

describe('Shell.svelte', () => {
  test('renders the topBar slot above the children slot', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Shell, {
      target,
      props: {
        topBar: textSnippet('TOP'),
        children: textSnippet('BODY'),
      },
    })
    const shell = target.querySelector('.ui-shell')!
    const topBar = shell.querySelector('.ui-shell__topbar')!
    const body = shell.querySelector('.ui-shell__body')!
    expect(topBar.textContent).toContain('TOP')
    expect(body.textContent).toContain('BODY')
    // topBar precedes body in DOM order
    expect(topBar.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    void unmount(component)
  })
})
