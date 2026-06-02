// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import LiveContextCard from '../../../../client/debug/components/LiveContextCard.svelte'

describe('LiveContextCard', () => {
  test('renders within a Panel and shows EmptyState when no active sessions', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(LiveContextCard, {
      target,
      props: { dashboard: { activeConfigEditors: new Set(), wizards: new Map() } },
    })
    expect(target.querySelector('.ui-panel')).not.toBeNull()
    expect(target.querySelector('.ui-empty')).not.toBeNull()
    void unmount(c)
  })
})
