// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import Meter from '../../../../client/shared/ui/Meter.svelte'

function fillEl(target: HTMLElement): HTMLElement {
  return target.querySelector<HTMLElement>('.ui-meter__fill')!
}

describe('Meter.svelte', () => {
  test('fills proportionally when value < total', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(Meter, { target, props: { label: 'recurring', value: 2, total: 4 } })
    expect(fillEl(target).style.width).toBe('50%')
    void unmount(c)
  })
  test('clamps to 100% and turns warn when value > total', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(Meter, { target, props: { label: 'deferred', value: 6, total: 4 } })
    expect(fillEl(target).style.width).toBe('100%')
    expect(target.querySelector('.ui-meter__fill--warn')).not.toBeNull()
    void unmount(c)
  })
  test('renders 0% for a zero total without overflowing', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(Meter, { target, props: { label: 'x', value: 3, total: 0 } })
    expect(fillEl(target).style.width).toBe('0%')
    void unmount(c)
  })
})
