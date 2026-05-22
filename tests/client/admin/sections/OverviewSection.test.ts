// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import { adminGlobals } from '../../../../client/admin/global-stats.svelte.js'
import OverviewSection from '../../../../client/admin/sections/OverviewSection.svelte'

describe('OverviewSection.svelte', () => {
  let target: HTMLElement

  beforeEach(() => {
    adminGlobals.data = null
    document.body.innerHTML = '<div id="root"></div>'
    target = document.body.querySelector<HTMLElement>('#root')!
  })

  test('renders an empty state when adminGlobals.data is null', () => {
    const component = mount(OverviewSection, { target, props: {} })
    expect(target.textContent).toContain('—')
    void unmount(component)
  })

  test('renders KPI values when data is present', () => {
    adminGlobals.data = { subjects: 32, llmCalls: 412, toolCalls: 98, tokens: 184_000 }
    const component = mount(OverviewSection, { target, props: {} })
    expect(target.textContent).toContain('32')
    expect(target.textContent).toContain('412')
    expect(target.textContent).toContain('98')
    void unmount(component)
  })
})
