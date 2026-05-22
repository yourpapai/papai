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

  test('renders active 30d from nested active block', () => {
    adminGlobals.data = {
      subjects: { dmTotal: 18, groupTotal: 14, growthLast30d: [] },
      active: { activeIn1d: 4, activeIn7d: 12, activeIn30d: 24 },
      storage: { sqliteBytes: 0, s3AttachmentBytes: 0 },
      toolMix: { topTools: [], errorTypeCounts: {} },
    }
    const component = mount(OverviewSection, { target, props: {} })
    expect(target.textContent).toContain('24')
    void unmount(component)
  })
})
