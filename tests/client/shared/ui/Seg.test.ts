// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import Seg from '../../../../client/shared/ui/Seg.svelte'

describe('Seg.svelte', () => {
  test('renders one button per option and marks the active one', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Seg, {
      target,
      props: { options: ['24h', '7d', '30d', 'all'], value: '30d' },
    })
    const buttons = target.querySelectorAll('.ui-seg__btn')
    expect(buttons.length).toBe(4)
    expect(target.querySelector('.ui-seg__btn--active')!.textContent).toBe('30d')
    void unmount(component)
  })

  test('clicking a button invokes onChange with its value', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    let last = ''
    const component = mount(Seg, {
      target,
      props: {
        options: ['dm', 'group'],
        value: 'dm',
        onChange: (v: string) => {
          last = v
        },
      },
    })
    const btns = Array.from(target.querySelectorAll<HTMLButtonElement>('.ui-seg__btn'))
    btns.find((b) => b.textContent === 'group')!.click()
    expect(last).toBe('group')
    void unmount(component)
  })
})
