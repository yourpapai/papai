// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import Spark from '../../../../client/shared/ui/Spark.svelte'

describe('Spark.svelte', () => {
  test('renders an svg with a polyline path for the data series', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Spark, {
      target,
      props: { data: [1, 2, 3, 4, 5], width: 100, height: 20 },
    })
    const svg = target.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg!.getAttribute('width')).toBe('100')
    expect(svg!.getAttribute('height')).toBe('20')
    const linePath = target.querySelector('path[data-role="line"]')
    expect(linePath).not.toBeNull()
    expect(linePath!.getAttribute('d')).toContain('M ')
    void unmount(component)
  })

  test('omits the fill path when fill=false', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Spark, {
      target,
      props: { data: [1, 2, 3], fill: false },
    })
    expect(target.querySelector('path[data-role="area"]')).toBeNull()
    expect(target.querySelector('path[data-role="line"]')).not.toBeNull()
    void unmount(component)
  })

  test('omitting width renders a fluid svg at the requested height', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Spark, { target, props: { data: [1, 4, 2], height: 28 } })
    const svg = target.querySelector('svg')!
    expect(svg.getAttribute('width')).toBeNull()
    expect(svg.getAttribute('preserveAspectRatio')).toBe('none')
    expect(svg.getAttribute('style')).toContain('height: 28px')
    void unmount(component)
  })

  test('the fluid path spans the intrinsic viewBox width, not the old fixed default', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Spark, { target, props: { data: [1, 2, 3, 4, 5], height: 28 } })
    const svg = target.querySelector('svg')!
    expect(svg.getAttribute('viewBox')).toBe('0 0 100 28')
    expect(target.querySelector('path[data-role="line"]')!.getAttribute('d')).toContain('100,')
    void unmount(component)
  })
})
