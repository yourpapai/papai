// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import FailureDetail from '../../../../client/debug/components/FailureDetail.svelte'
import type { ToolFailure } from '../../../../client/debug/dashboard-types.js'

function makeFailure(overrides: Partial<ToolFailure> = {}): ToolFailure {
  return {
    timestamp: 0,
    scope: { kind: 'user', userId: 'tg:1001' },
    data: { toolName: 'create_task', error: 'project not found', errorType: 'validation', retriable: false },
    ...overrides,
  }
}

describe('FailureDetail.svelte', () => {
  test('renders formatted fields and hides the raw tree by default', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(FailureDetail, { target, props: { failure: makeFailure() } })
    expect(target.textContent).toContain('create_task')
    expect(target.textContent).toContain('project not found')
    expect(target.textContent).toContain('dm:tg:1001')
    expect(target.textContent).toContain('non-retriable')
    expect(target.querySelector('.tree-container')).toBeNull()
    void unmount(c)
  })
})
