// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import SummaryList from '../../../../client/shared/ui/SummaryList.svelte'

describe('SummaryList.svelte', () => {
  test('renders one row per item with key and value', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(SummaryList, {
      target,
      props: {
        items: [
          { k: 'chat provider', v: 'telegram' },
          { k: 'debug server', v: 'enabled', pill: true },
        ],
      },
    })
    expect(target.querySelectorAll('.ui-summary__row').length).toBe(2)
    expect(target.textContent).toContain('chat provider')
    expect(target.textContent).toContain('telegram')
    void unmount(c)
  })
  test('renders a StatusPill for pill items', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(SummaryList, { target, props: { items: [{ k: 'debug server', v: 'enabled', pill: true }] } })
    expect(target.querySelector('.ui-pill')).not.toBeNull()
    void unmount(c)
  })
})
