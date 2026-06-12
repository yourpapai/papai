// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createRawSnippet, mount, unmount } from 'svelte'
import type { Snippet } from 'svelte'

import Code from '../../../../client/shared/ui/Code.svelte'

function snip(text: string): Snippet {
  return createRawSnippet((): { render: () => string } => ({ render: (): string => `<span>${text}</span>` }))
}

describe('Code.svelte', () => {
  test('renders content and truncates by default', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(Code, { target, props: { children: snip('hf:zai-org/GLM-5.1') } })
    const el = target.querySelector('.ui-code')
    expect(el?.textContent).toContain('hf:zai-org/GLM-5.1')
    expect(el?.classList.contains('ui-code--truncate')).toBe(true)
    void unmount(c)
  })
  test('does not truncate when truncate=false', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(Code, { target, props: { children: snip('x'), truncate: false } })
    expect(target.querySelector('.ui-code')?.classList.contains('ui-code--truncate')).toBe(false)
    void unmount(c)
  })
})
