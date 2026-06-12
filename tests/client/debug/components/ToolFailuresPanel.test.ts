// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import ToolFailuresPanel from '../../../../client/debug/components/ToolFailuresPanel.svelte'

describe('ToolFailuresPanel', () => {
  test('renders within a Panel and shows EmptyState when there are no failures', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(ToolFailuresPanel, {
      target,
      props: { dashboard: { toolFailures: [], scopeFilter: 'all' }, onShowFailure: () => {} },
    })
    expect(target.querySelector('.ui-panel')).not.toBeNull()
    expect(target.querySelector('.ui-empty')).not.toBeNull()
    void unmount(c)
  })
})
