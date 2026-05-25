// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import KV from '../../../../client/shared/ui/KV.svelte'

describe('KV.svelte', () => {
  test('renders key on the left and value on the right', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(KV, { target, props: { k: 'subjects', v: '32' } })
    const k = target.querySelector('.ui-kv__k')
    const v = target.querySelector('.ui-kv__v')
    expect(k!.textContent).toBe('subjects')
    expect(v!.textContent).toBe('32')
    void unmount(component)
  })

  test('applies custom value color via vColor', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(KV, {
      target,
      props: { k: 'active', v: '4', vColor: 'var(--accent)' },
    })
    const v = target.querySelector<HTMLElement>('.ui-kv__v')!
    expect(v.style.color).toContain('var(--accent)')
    void unmount(component)
  })

  test('renders sub-label when sub prop is provided', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(KV, {
      target,
      props: { k: 'subjects', v: 32, sub: '18 dm · 14 group' },
    })
    expect(target.textContent).toContain('18 dm · 14 group')
    expect(target.querySelector('.ui-kv__sub')).not.toBeNull()
    void unmount(component)
  })

  test('does not render sub-label container when sub is omitted', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(KV, { target, props: { k: 'subjects', v: 32 } })
    expect(target.querySelector('.ui-kv__sub')).toBeNull()
    void unmount(component)
  })
})
