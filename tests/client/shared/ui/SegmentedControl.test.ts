// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import SegmentedControl from '../../../../client/shared/ui/SegmentedControl.svelte'

const options = [
  { value: 'allow', label: 'Allow' },
  { value: 'ask', label: 'Ask' },
  { value: 'deny', label: 'Deny' },
]

afterEach(() => {
  document.body.innerHTML = ''
})

test('marks the selected option with aria-checked', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const c = mount(SegmentedControl, {
    target,
    props: { options, value: 'ask', ariaLabel: 'Permission', onChange: () => {}, testidPrefix: 'perm' },
  })
  flushSync()
  expect(target.querySelector('[role="radiogroup"]')).not.toBeNull()
  expect(target.querySelector('[data-testid="perm-ask"]')!.getAttribute('aria-checked')).toBe('true')
  expect(target.querySelector('[data-testid="perm-allow"]')!.getAttribute('aria-checked')).toBe('false')
  void unmount(c)
})

test('clicking an option calls onChange with its value', () => {
  let got = ''
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const c = mount(SegmentedControl, {
    target,
    props: {
      options,
      value: 'allow',
      ariaLabel: 'Permission',
      onChange: (v: string) => {
        got = v
      },
      testidPrefix: 'perm',
    },
  })
  flushSync()
  target.querySelector<HTMLButtonElement>('[data-testid="perm-deny"]')!.click()
  expect(got).toBe('deny')
  void unmount(c)
})
