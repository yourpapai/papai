// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import DebugDetailRail from '../../../../client/debug/components/DebugDetailRail.svelte'
import type { SelectedDetail, Turn } from '../../../../client/debug/dashboard-types.js'

function mockTurn(id = 'turn_2a4f8c'): Turn {
  return {
    turnId: id,
    scope: { kind: 'user', userId: 'u_1' },
    status: 'ok',
    startedAt: Date.now(),
    incomingMessageCount: 1,
    toolCalls: [],
  } satisfies Turn
}

describe('DebugDetailRail.svelte', () => {
  let target: HTMLElement

  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>'
    target = document.body.querySelector<HTMLElement>('#root')!
  })

  test('renders an empty state when selectedDetail is null', () => {
    const component = mount(DebugDetailRail, {
      target,
      props: { selected: null as SelectedDetail, onClear: () => {} },
    })
    expect(target.querySelector('.debug-detail-rail__empty')).not.toBeNull()
    expect(target.querySelector('.debug-detail-rail__header')).toBeNull()
    void unmount(component)
  })

  test('renders the turn header when kind=turn', () => {
    const selected: SelectedDetail = { kind: 'turn', payload: mockTurn('turn_8800a1') }
    const component = mount(DebugDetailRail, { target, props: { selected, onClear: () => {} } })
    const header = target.querySelector('.debug-detail-rail__header')
    expect(header).not.toBeNull()
    expect(header!.textContent).toContain('turn_8800a1')
    void unmount(component)
  })

  test('clicking the ✕ button calls onClear', () => {
    const selected: SelectedDetail = { kind: 'turn', payload: mockTurn() }
    let cleared = false
    const component = mount(DebugDetailRail, {
      target,
      props: {
        selected,
        onClear: () => {
          cleared = true
        },
      },
    })
    const closeBtn = target.querySelector<HTMLButtonElement>('.debug-detail-rail__close')!
    closeBtn.click()
    expect(cleared).toBe(true)
    void unmount(component)
  })
})
