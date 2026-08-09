// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import LiveRegion from '../../../../client/shared/ui/LiveRegion.svelte'
import { liveRegionHarnessState } from './live-region-harness.svelte.js'

afterEach(() => {
  document.body.innerHTML = ''
})

const render = (props: Record<string, unknown>): { target: HTMLElement; component: ReturnType<typeof mount> } => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  const component = mount(LiveRegion, { target, props })
  flushSync()
  return { target, component }
}

test('a status region is present and polite even with no message', () => {
  const { target, component } = render({ message: null, tone: 'status', testid: 'x-success' })
  const el = target.querySelector('[data-testid="x-success"]')
  expect(el).not.toBeNull()
  expect(el!.getAttribute('role')).toBe('status')
  expect(el!.getAttribute('aria-live')).toBe('polite')
  expect(el!.textContent).toBe('')
  void unmount(component)
})

test('a status region carries the success class and its message', () => {
  const { target, component } = render({ message: 'Preference saved.', tone: 'status', testid: 'x-success' })
  const el = target.querySelector('[data-testid="x-success"]')!
  expect(el.classList.contains('status-success')).toBe(true)
  expect(el.textContent).toBe('Preference saved.')
  void unmount(component)
})

test('an alert region is assertive and carries the error class', () => {
  const { target, component } = render({ message: 'It failed.', tone: 'alert', testid: 'x-error' })
  const el = target.querySelector('[data-testid="x-error"]')!
  expect(el.getAttribute('role')).toBe('alert')
  expect(el.getAttribute('aria-live')).toBe('assertive')
  expect(el.classList.contains('status-error')).toBe(true)
  expect(el.textContent).toBe('It failed.')
  void unmount(component)
})

test('an empty region stays in the document rather than unmounting', () => {
  const { target, component } = render({ message: '', tone: 'alert', testid: 'x-error' })
  expect(target.querySelectorAll('[data-testid="x-error"]').length).toBe(1)
  void unmount(component)
})

test('the same DOM element survives a tone change instead of being recreated', () => {
  liveRegionHarnessState.message = 'Preference saved.'
  liveRegionHarnessState.tone = 'status'
  liveRegionHarnessState.testid = 'x-live'
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  const component = mount(LiveRegion, { target, props: liveRegionHarnessState })
  flushSync()
  const before = target.querySelector('[data-testid="x-live"]')
  expect(before).not.toBeNull()

  liveRegionHarnessState.tone = 'alert'
  liveRegionHarnessState.message = 'It failed.'
  flushSync()

  const after = target.querySelector('[data-testid="x-live"]')
  expect(after).toBe(before)
  expect(after!.getAttribute('role')).toBe('alert')
  expect(after!.getAttribute('aria-live')).toBe('assertive')
  expect(after!.classList.contains('status-error')).toBe(true)
  expect(after!.textContent).toBe('It failed.')

  void unmount(component)
})
