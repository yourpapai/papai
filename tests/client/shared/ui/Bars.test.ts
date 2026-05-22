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
})
