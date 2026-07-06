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

test('ArrowRight moves to the next option', () => {
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
  const allow = target.querySelector<HTMLButtonElement>('[data-testid="perm-allow"]')!
  allow.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  expect(got).toBe('ask')
  void unmount(c)
})

test('ArrowRight wraps from the last option to the first', () => {
  let got = ''
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const c = mount(SegmentedControl, {
    target,
    props: {
      options,
      value: 'deny',
      ariaLabel: 'Permission',
      onChange: (v: string) => {
        got = v
      },
      testidPrefix: 'perm',
    },
  })
  flushSync()
  const deny = target.querySelector<HTMLButtonElement>('[data-testid="perm-deny"]')!
  deny.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  expect(got).toBe('allow')
  void unmount(c)
})

test('ArrowLeft wraps from the first option to the last', () => {
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
  const allow = target.querySelector<HTMLButtonElement>('[data-testid="perm-allow"]')!
  allow.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
  expect(got).toBe('deny')
  void unmount(c)
})

test('a non-arrow key does not call onChange', () => {
  let calls = 0
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const c = mount(SegmentedControl, {
    target,
    props: {
      options,
      value: 'allow',
      ariaLabel: 'Permission',
      onChange: () => {
        calls++
      },
      testidPrefix: 'perm',
    },
  })
  flushSync()
  const allow = target.querySelector<HTMLButtonElement>('[data-testid="perm-allow"]')!
  allow.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  expect(calls).toBe(0)
  void unmount(c)
})

test('disabled options render the native disabled attribute', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const c = mount(SegmentedControl, {
    target,
    props: { options, value: 'ask', ariaLabel: 'Permission', onChange: () => {}, testidPrefix: 'perm', disabled: true },
  })
  flushSync()
  expect(target.querySelector<HTMLButtonElement>('[data-testid="perm-allow"]')!.disabled).toBe(true)
  void unmount(c)
})

test('clicking a disabled option does not call onChange', () => {
  let calls = 0
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const c = mount(SegmentedControl, {
    target,
    props: {
      options,
      value: 'allow',
      ariaLabel: 'Permission',
      onChange: () => {
        calls++
      },
      testidPrefix: 'perm',
      disabled: true,
    },
  })
  flushSync()
  target.querySelector<HTMLButtonElement>('[data-testid="perm-deny"]')!.click()
  expect(calls).toBe(0)
  void unmount(c)
})

test('ArrowRight on a disabled control does not call onChange', () => {
  let calls = 0
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const c = mount(SegmentedControl, {
    target,
    props: {
      options,
      value: 'allow',
      ariaLabel: 'Permission',
      onChange: () => {
        calls++
      },
      testidPrefix: 'perm',
      disabled: true,
    },
  })
  flushSync()
  const allow = target.querySelector<HTMLButtonElement>('[data-testid="perm-allow"]')!
  allow.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  expect(calls).toBe(0)
  void unmount(c)
})

test('sets aria-describedby on the radiogroup when ariaDescribedBy is provided', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const c = mount(SegmentedControl, {
    target,
    props: {
      options,
      value: 'ask',
      ariaLabel: 'Permission',
      onChange: () => {},
      testidPrefix: 'perm',
      ariaDescribedBy: 'hint-1',
    },
  })
  flushSync()
  expect(target.querySelector('[role="radiogroup"]')!.getAttribute('aria-describedby')).toBe('hint-1')
  void unmount(c)
})

test('omits aria-describedby when ariaDescribedBy is not provided', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const c = mount(SegmentedControl, {
    target,
    props: { options, value: 'ask', ariaLabel: 'Permission', onChange: () => {}, testidPrefix: 'perm' },
  })
  flushSync()
  expect(target.querySelector('[role="radiogroup"]')!.getAttribute('aria-describedby')).toBeNull()
  void unmount(c)
})
