// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import SystemKvRow from '../../../../client/settings/components/SystemKvRow.svelte'

afterEach(() => {
  document.body.innerHTML = ''
})

test('shows masked value for a secret key and no input until Edit', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const c = mount(SystemKvRow, {
    target,
    props: { keyName: 'llm_apikey', value: '****d2a0', sensitive: true, onSave: () => {} },
  })
  flushSync()
  expect(target.textContent).toContain('••••d2a0')
  expect(target.querySelector('[data-testid="system-input-llm_apikey"]')).toBeNull()
  void unmount(c)
})

test('Edit reveals an input and Save emits the draft', () => {
  let saved = ''
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const c = mount(SystemKvRow, {
    target,
    props: {
      keyName: 'main_model',
      value: 'gpt',
      sensitive: false,
      onSave: (v: string) => {
        saved = v
      },
    },
  })
  flushSync()
  target.querySelector<HTMLButtonElement>('[data-testid="system-edit-main_model"]')!.click()
  flushSync()
  const input = target.querySelector<HTMLInputElement>('[data-testid="system-input-main_model"]')!
  input.value = 'claude'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
  target.querySelector<HTMLButtonElement>('[data-testid="system-save-main_model"]')!.click()
  expect(saved).toBe('claude')
  void unmount(c)
})
