// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import TraceList from '../../../../client/debug/components/TraceList.svelte'

describe('TraceList', () => {
  test('renders the trace list within a Panel and EmptyState when empty', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(TraceList, { target, props: { dashboard: { llmTraces: [] }, onSelect: () => {} } })
    expect(target.querySelector('.ui-panel')).not.toBeNull()
    expect(target.querySelector('.ui-empty')).not.toBeNull()
    void unmount(c)
  })
})
