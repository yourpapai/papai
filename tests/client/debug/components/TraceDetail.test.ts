// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import TraceDetail from '../../../../client/debug/components/TraceDetail.svelte'

describe('TraceDetail', () => {
  test('renders Basic Info / Token Usage as SummaryLists and tool status as StatusPill', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const trace = {
      userId: 'u1',
      timestamp: 0,
      model: 'm',
      duration: 1500,
      steps: 1,
      totalTokens: { inputTokens: 10, outputTokens: 5 },
      toolCalls: [{ toolName: 't', durationMs: 5, success: true }],
    }
    const c = mount(TraceDetail, { target, props: { trace } })
    expect(target.querySelectorAll('.ui-summary').length).toBeGreaterThanOrEqual(2)
    expect(target.querySelector('.ui-pill')).not.toBeNull()
    void unmount(c)
  })
})
