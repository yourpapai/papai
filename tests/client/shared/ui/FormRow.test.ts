// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createRawSnippet, mount, unmount } from 'svelte'
import type { Snippet } from 'svelte'

import FormRow from '../../../../client/shared/ui/FormRow.svelte'

function snip(text: string): Snippet {
  return createRawSnippet((): { render: () => string } => ({ render: (): string => `<span>${text}</span>` }))
}

describe('FormRow.svelte', () => {
  test('renders children', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(FormRow, { target, props: { children: snip('FIELDS') } })
    expect(target.textContent).toContain('FIELDS')
    expect(target.querySelector('.ui-form-row__action')).toBeNull()
    void unmount(c)
  })
  test('renders the action slot when provided', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(FormRow, { target, props: { children: snip('F'), action: snip('SUBMIT') } })
    expect(target.querySelector('.ui-form-row__action')?.textContent).toContain('SUBMIT')
    void unmount(c)
  })
})
