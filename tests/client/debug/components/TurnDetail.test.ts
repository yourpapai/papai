// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import TurnDetail from '../../../../client/debug/components/TurnDetail.svelte'
import type { Turn } from '../../../../client/debug/dashboard-types.js'

function makeTurn(overrides: Partial<Turn> = {}): Turn {
  return {
    turnId: 't-1',
    scope: { kind: 'user', userId: 'tg:1001' },
    startedAt: 0,
    endedAt: 1234,
    status: 'ok',
    incomingMessageCount: 1,
    toolCalls: [{ name: 'create_task', durationMs: 120, ok: true }],
    reply: { durationMs: 1234 },
    ...overrides,
  }
}

describe('TurnDetail.svelte', () => {
  test('renders formatted fields and hides the raw tree by default', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(TurnDetail, { target, props: { turn: makeTurn() } })
    expect(target.textContent).toContain('t-1')
    expect(target.textContent).toContain('dm:tg:1001')
    expect(target.textContent).toContain('1.2s')
    expect(target.textContent).toContain('create_task')
    expect(target.querySelector('.tree-container')).toBeNull()
    void unmount(c)
  })

  test('show raw toggle reveals the tree', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(TurnDetail, { target, props: { turn: makeTurn() } })
    const btn = [...target.querySelectorAll('button')].find((b) => b.textContent?.includes('show raw'))!
    btn.click()
    flushSync()
    expect(target.querySelector('.tree-container')).not.toBeNull()
    void unmount(c)
  })
})
