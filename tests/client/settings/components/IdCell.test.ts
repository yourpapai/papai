// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import IdCell from '../../../../client/settings/components/IdCell.svelte'

afterEach(() => {
  document.body.innerHTML = ''
})

test('renders truncated text with the full value in title and a copy button', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const full = 'placeholder-4d1e563d-0190-aaaa-bbbb-cccccccccccc'
  const c = mount(IdCell, { target, props: { value: full } })
  flushSync()
  const span = target.querySelector('.id-cell__value')!
  expect(span.getAttribute('title')).toBe(full)
  expect(span.textContent).toContain('…')
  expect(target.querySelector('.ui-copy')).not.toBeNull()
  void unmount(c)
})
