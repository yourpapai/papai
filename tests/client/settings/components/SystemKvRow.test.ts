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
    props: { keyName: 'llm_apikey', value: '****d2a0', sensitive: true, onSave: () => Promise.resolve(true) },
  })
  flushSync()
  expect(target.textContent).toContain('••••d2a0')
  expect(target.querySelector('[data-testid="system-input-llm_apikey"]')).toBeNull()
  void unmount(c)
})

test('Edit reveals an input and Save emits the draft', async () => {
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
        return Promise.resolve(true)
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
  for (let i = 0; i < 5; i++) await Promise.resolve()
  flushSync()
  expect(saved).toBe('claude')
  void unmount(c)
})

test('Cancel returns to view mode without calling onSave', () => {
  let calls = 0
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const c = mount(SystemKvRow, {
    target,
    props: {
      keyName: 'main_model',
      value: 'gpt',
      sensitive: false,
      onSave: () => {
        calls++
        return Promise.resolve(true)
      },
    },
  })
  flushSync()
  target.querySelector<HTMLButtonElement>('[data-testid="system-edit-main_model"]')!.click()
  flushSync()
  target.querySelector<HTMLButtonElement>('[data-testid="system-cancel-main_model"]')!.click()
  flushSync()
  expect(target.querySelector('[data-testid="system-input-main_model"]')).toBeNull()
  expect(calls).toBe(0)
  void unmount(c)
})

test('Save with an empty draft is a no-op', async () => {
  let calls = 0
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  // sensitive row so Edit opens a blank draft
  const c = mount(SystemKvRow, {
    target,
    props: {
      keyName: 'llm_apikey',
      value: '****d2a0',
      sensitive: true,
      onSave: () => {
        calls++
        return Promise.resolve(true)
      },
    },
  })
  flushSync()
  target.querySelector<HTMLButtonElement>('[data-testid="system-edit-llm_apikey"]')!.click()
  flushSync()
  target.querySelector<HTMLButtonElement>('[data-testid="system-save-llm_apikey"]')!.click()
  for (let i = 0; i < 5; i++) await Promise.resolve()
  flushSync()
  expect(calls).toBe(0)
  void unmount(c)
})

test('keeps the row in edit mode when the save fails', async () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const c = mount(SystemKvRow, {
    target,
    props: { keyName: 'main_model', value: 'gpt', sensitive: false, onSave: () => Promise.resolve(false) },
  })
  flushSync()
  target.querySelector<HTMLButtonElement>('[data-testid="system-edit-main_model"]')!.click()
  flushSync()
  const input = target.querySelector<HTMLInputElement>('[data-testid="system-input-main_model"]')!
  input.value = 'claude'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
  target.querySelector<HTMLButtonElement>('[data-testid="system-save-main_model"]')!.click()
  for (let i = 0; i < 5; i++) await Promise.resolve()
  flushSync()
  // failed save → still editing, input still present
  expect(target.querySelector('[data-testid="system-input-main_model"]')).not.toBeNull()
  void unmount(c)
})

test('saving a secret key requires confirmation', async () => {
  let saved = ''
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const c = mount(SystemKvRow, {
    target,
    props: {
      keyName: 'llm_apikey',
      value: '****d2a0',
      sensitive: true,
      onSave: (v: string) => {
        saved = v
        return Promise.resolve(true)
      },
    },
  })
  flushSync()
  target.querySelector<HTMLButtonElement>('[data-testid="system-edit-llm_apikey"]')!.click()
  flushSync()
  const input = target.querySelector<HTMLInputElement>('[data-testid="system-input-llm_apikey"]')!
  input.value = 'new-secret'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
  target.querySelector<HTMLButtonElement>('[data-testid="system-save-llm_apikey"]')!.click()
  flushSync()
  // not saved yet — dialog open
  expect(saved).toBe('')
  target.querySelector<HTMLButtonElement>('.modal .ui-btn--danger')!.click()
  for (let i = 0; i < 5; i++) await Promise.resolve()
  flushSync()
  expect(saved).toBe('new-secret')
  void unmount(c)
})
