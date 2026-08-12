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

  // The whole point of the change: a live region announces only if it existed before its
  // text did. Asserting on the mounted-with-no-error case is what pins that.
  test('the error region is in the DOM before any error exists', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(Field, { target, props: { label: 'url', children: textSnippet('x') } })
    const err = target.querySelector<HTMLElement>('.ui-field__error')
    expect(err).not.toBeNull()
    expect(err!.getAttribute('role')).toBe('alert')
    expect(err!.getAttribute('aria-live')).toBe('assertive')
    expect(err!.textContent).toBe('')
    void unmount(c)
  })

  test('the same error element carries the message once an error arrives', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(Field, { target, props: { label: 'url', error: 'Required', children: textSnippet('x') } })
    const err = target.querySelector<HTMLElement>('.ui-field__error')!
    expect(err.textContent).toBe('Required')
    expect(err.id).not.toBe('')
    void unmount(c)
  })

  test('the hint is replaced by the error rather than shown alongside it', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(Field, {
      target,
      props: { label: 'url', hint: 'https only', error: 'Required', children: textSnippet('x') },
    })
    expect(target.querySelector('.ui-field__hint')).toBeNull()
    expect(target.querySelector('.ui-field__error')!.textContent).toBe('Required')
    void unmount(c)
  })

  // subgrid with `grid-row: span 3` needs exactly three children. The message box is what
  // keeps that true now that the region and the hint can both live in the last row.
  test('the field still has exactly three grid children', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(Field, { target, props: { label: 'url', hint: 'h', children: textSnippet('x') } })
    const field = target.querySelector<HTMLElement>('.ui-field')!
    expect(field.children.length).toBe(3)
    expect(field.children[2]!.classList.contains('ui-field__msg')).toBe(true)
    void unmount(c)
  })
})
