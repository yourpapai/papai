// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createRawSnippet, mount, unmount } from 'svelte'
import type { Snippet } from 'svelte'

import Field from '../../../../client/shared/ui/Field.svelte'

function textSnippet(text: string): Snippet {
  return createRawSnippet((): { render: () => string } => ({ render: (): string => `<span>${text}</span>` }))
}

describe('Field.svelte', () => {
  test('renders label, child control and hint', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(Field, { target, props: { label: 'kaneo url', hint: 'https only', children: textSnippet('CTRL') } })
    expect(target.querySelector('.ui-field__label')?.textContent).toContain('kaneo url')
    expect(target.querySelector('.ui-field__hint')?.textContent).toContain('https only')
    expect(target.textContent).toContain('CTRL')
    void unmount(c)
  })
  test('renders a required marker when required=true', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(Field, { target, props: { label: 'id', required: true, children: textSnippet('x') } })
    expect(target.querySelector('.ui-field__req')).not.toBeNull()
    void unmount(c)
  })
})
