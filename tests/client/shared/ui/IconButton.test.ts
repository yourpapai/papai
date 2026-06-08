// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import IconButton from '../../../../client/shared/ui/IconButton.svelte'

afterEach(() => {
  document.body.innerHTML = ''
})

test('renders an accessible labelled icon button and fires onClick', () => {
  let clicked = 0
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const c = mount(IconButton, {
    target,
    props: {
      label: 'Refresh',
      glyph: '⟳',
      onClick: () => {
        clicked++
      },
      testid: 'rf',
    },
  })
  flushSync()
  const btn = target.querySelector<HTMLButtonElement>('[data-testid="rf"]')!
  expect(btn.getAttribute('aria-label')).toBe('Refresh')
  expect(btn.getAttribute('title')).toBe('Refresh')
  btn.click()
  expect(clicked).toBe(1)
  void unmount(c)
})

test('spins while busy', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const c = mount(IconButton, { target, props: { label: 'Refresh', glyph: '⟳', busy: true } })
  flushSync()
  expect(target.querySelector('.ui-iconbtn--busy')).not.toBeNull()
  void unmount(c)
})
