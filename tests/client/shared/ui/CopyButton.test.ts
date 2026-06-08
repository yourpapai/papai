// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import CopyButton from '../../../../client/shared/ui/CopyButton.svelte'

let copied: string | null = null
const originalClipboard = navigator.clipboard

afterEach(() => {
  copied = null
  Object.defineProperty(navigator, 'clipboard', { value: originalClipboard, configurable: true })
  document.body.innerHTML = ''
})

test('copies the value to the clipboard on click', () => {
  Object.defineProperty(navigator, 'clipboard', {
    value: {
      writeText: (v: string) => {
        copied = v
        return Promise.resolve()
      },
    },
    configurable: true,
  })
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const c = mount(CopyButton, { target, props: { value: 'full-secret-id', label: 'Copy ID' } })
  flushSync()
  target.querySelector<HTMLButtonElement>('button')!.click()
  expect(copied).toBe('full-secret-id')
  void unmount(c)
})
