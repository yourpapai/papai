// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import Bars from '../../../../client/shared/ui/Bars.svelte'

describe('Bars.svelte', () => {
  test('renders one rect per data point', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Bars, {
      target,
      props: { data: [3, 5, 7, 9], width: 200, height: 40 },
    })
    expect(target.querySelector('svg')).not.toBeNull()
    expect(target.querySelectorAll('rect').length).toBe(4)
    void unmount(component)
  })

  test('renders empty svg for undefined data', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Bars, { target, props: { data: undefined, width: 200, height: 40 } })
    expect(target.querySelector('svg')).not.toBeNull()
    expect(target.querySelectorAll('rect').length).toBe(0)
    void unmount(component)
  })

  test('renders one rect for single-value data', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Bars, { target, props: { data: [5], width: 200, height: 40 } })
    expect(target.querySelectorAll('rect').length).toBe(1)
    void unmount(component)
  })

  test('renders flat baseline for all-zero data', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Bars, { target, props: { data: [0, 0, 0, 0], width: 200, height: 40 } })
    expect(target.querySelectorAll('rect').length).toBe(4)
    void unmount(component)
  })

  test('svg uses viewBox when width is omitted', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Bars, { target, props: { data: [1, 2, 3] } })
    const svg = target.querySelector('svg')
    expect(svg?.getAttribute('viewBox')).not.toBeNull()
    void unmount(component)
  })
})
