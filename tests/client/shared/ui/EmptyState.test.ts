// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createRawSnippet, mount, unmount } from 'svelte'
import type { Snippet } from 'svelte'

import EmptyState from '../../../../client/shared/ui/EmptyState.svelte'

function snip(text: string): Snippet {
  return createRawSnippet((): { render: () => string } => ({ render: (): string => `<span>${text}</span>` }))
}

describe('EmptyState.svelte', () => {
  test('renders title and hint', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(EmptyState, {
      target,
      props: { title: 'No recurring reminders', hint: 'Enter a user ID and click Load.' },
    })
    expect(target.querySelector('.ui-empty__title')?.textContent).toContain('No recurring reminders')
    expect(target.querySelector('.ui-empty__hint')?.textContent).toContain('Enter a user ID')
    void unmount(c)
  })
  test('renders the action slot when provided', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(EmptyState, { target, props: { title: 'Empty', action: snip('LOAD') } })
    expect(target.querySelector('.ui-empty__action')?.textContent).toContain('LOAD')
    void unmount(c)
  })
  test('hint uses the AA-passing --fg2 token', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../../../../client/shared/ui/EmptyState.svelte', import.meta.url)),
      'utf8',
    )
    const hintRule = src.slice(src.indexOf('.ui-empty__hint'))
    expect(hintRule).toContain('color: var(--fg2)')
  })
})
