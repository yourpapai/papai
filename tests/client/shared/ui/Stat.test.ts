// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import Stat from '../../../../client/shared/ui/Stat.svelte'

describe('Stat.svelte', () => {
  test('renders label, value and "of total"', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(Stat, { target, props: { label: '7d', value: 9, of: 36 } })
    expect(target.querySelector('.ui-stat__value')?.textContent).toContain('9')
    expect(target.querySelector('.ui-stat__of')?.textContent).toContain('of 36')
    void unmount(c)
  })
  test('flags over-total values with warn styling and note', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(Stat, { target, props: { label: '30d', value: 13, of: 4 } })
    expect(target.querySelector('.ui-stat__value--over')).not.toBeNull()
    expect(target.querySelector('.ui-stat__of')?.textContent).toContain('exceeds total')
    void unmount(c)
  })
})
