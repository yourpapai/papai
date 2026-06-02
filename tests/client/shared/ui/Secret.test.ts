// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import Secret from '../../../../client/shared/ui/Secret.svelte'

describe('Secret.svelte', () => {
  test('renders the masked value and a reveal button when onReveal is provided', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(Secret, {
      target,
      props: { value: '••••d2a0', hint: '(hidden)', onReveal: () => {} },
    })
    expect(target.querySelector('.ui-secret__value')?.textContent).toContain('••••d2a0')
    expect(target.querySelector('.ui-secret__hint')?.textContent).toContain('(hidden)')
    expect(target.querySelector('.ui-btn')?.textContent).toContain('reveal')
    void unmount(c)
  })

  test('renders masked value but no reveal button when onReveal is not provided', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(Secret, { target, props: { value: '••••d2a0', hint: '(hidden)' } })
    expect(target.querySelector('.ui-secret__value')?.textContent).toContain('••••d2a0')
    expect(target.querySelector('.ui-btn')).toBeNull()
    void unmount(c)
  })
  test('fires onReveal when the reveal button is clicked', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    let called = false
    const c = mount(Secret, {
      target,
      props: {
        value: '••••',
        onReveal: () => {
          called = true
        },
      },
    })
    target.querySelector<HTMLButtonElement>('.ui-btn')!.click()
    expect(called).toBe(true)
    void unmount(c)
  })
})
