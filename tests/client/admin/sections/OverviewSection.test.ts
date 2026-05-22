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

  test('renders em-dash placeholders when adminGlobals.data is null', () => {
    const component = mount(OverviewSection, { target, props: {} })
    expect(target.textContent).toContain('—')
    void unmount(component)
  })

  test('renders subjects total + dm/group sub-label', () => {
    adminGlobals.data = {
      subjects: { dmTotal: 18, groupTotal: 14, growthLast30d: [] },
      active: { activeIn1d: 4, activeIn7d: 12, activeIn30d: 24 },
      storage: { sqliteBytes: 12_345_678, s3AttachmentBytes: 9_876_543 },
      toolMix: { topTools: [], errorTypeCounts: {} },
    }
    const component = mount(OverviewSection, { target, props: {} })
    expect(target.textContent).toContain('32')
    expect(target.textContent).toContain('18 dm · 14 group')
    void unmount(component)
  })

  test('renders active 30d total + 1d/7d sub-label', () => {
    adminGlobals.data = {
      subjects: { dmTotal: 0, groupTotal: 0, growthLast30d: [] },
      active: { activeIn1d: 4, activeIn7d: 12, activeIn30d: 24 },
      storage: { sqliteBytes: 0, s3AttachmentBytes: 0 },
      toolMix: { topTools: [], errorTypeCounts: {} },
    }
    const component = mount(OverviewSection, { target, props: {} })
    expect(target.textContent).toContain('24')
    expect(target.textContent).toContain('4 1d · 12 7d')
    void unmount(component)
  })

  test('renders tool calls total + ok/fail sub-label from toolMix', () => {
    adminGlobals.data = {
      subjects: { dmTotal: 0, groupTotal: 0, growthLast30d: [] },
      active: { activeIn1d: 0, activeIn7d: 0, activeIn30d: 0 },
      storage: { sqliteBytes: 0, s3AttachmentBytes: 0 },
      toolMix: {
        topTools: [
          { toolName: 'create_task', count: 1000, successRate: 0.97 },
          { toolName: 'search_tasks', count: 500, successRate: 0.9 },
        ],
        errorTypeCounts: {},
      },
    }
    const component = mount(OverviewSection, { target, props: {} })
    expect(target.textContent).toContain('1500')
    expect(target.textContent).toContain('1420 ok · 80 fail')
    void unmount(component)
  })

  test('renders storage total + sqlite/s3 sub-label', () => {
    adminGlobals.data = {
      subjects: { dmTotal: 0, groupTotal: 0, growthLast30d: [] },
      active: { activeIn1d: 0, activeIn7d: 0, activeIn30d: 0 },
      storage: { sqliteBytes: 12_000_000, s3AttachmentBytes: 8_000_000 },
      toolMix: { topTools: [], errorTypeCounts: {} },
    }
    const component = mount(OverviewSection, { target, props: {} })
    expect(target.textContent).toContain('20.0 MB')
    expect(target.textContent).toContain('12.0 MB sqlite · 8.0 MB s3')
    void unmount(component)
  })

  test('renders llm calls total + main/small sub-label', () => {
    adminGlobals.data = {
      subjects: { dmTotal: 0, groupTotal: 0, growthLast30d: [] },
      active: { activeIn1d: 0, activeIn7d: 0, activeIn30d: 0 },
      storage: { sqliteBytes: 0, s3AttachmentBytes: 0 },
      toolMix: { topTools: [], errorTypeCounts: {} },
      llmUsage: {
        totalCalls: 1089,
        mainCalls: 892,
        smallCalls: 197,
        embeddingCalls: 0,
        inputTokensTotal: 100,
        outputTokensTotal: 200,
      },
    }
    const component = mount(OverviewSection, { target, props: {} })
    expect(target.textContent).toContain('1089')
    expect(target.textContent).toContain('892 main · 197 small')
    void unmount(component)
  })

  test('llm calls KPI degrades to em-dash when llmUsage absent', () => {
    adminGlobals.data = {
      subjects: { dmTotal: 1, groupTotal: 0, growthLast30d: [] },
      active: { activeIn1d: 0, activeIn7d: 0, activeIn30d: 0 },
      storage: { sqliteBytes: 0, s3AttachmentBytes: 0 },
      toolMix: { topTools: [], errorTypeCounts: {} },
    }
    const component = mount(OverviewSection, { target, props: {} })
    const llmKpi = target.querySelector('.admin-overview__kpis')!
    expect(llmKpi.textContent).toContain('llm calls')
    expect(llmKpi.textContent).toContain('—')
    void unmount(component)
  })

  test('Spark receives growth points summed across dm+group', () => {
    adminGlobals.data = {
      subjects: {
        dmTotal: 0,
        groupTotal: 0,
        growthLast30d: [
          { date: '2026-04-22', dmAdded: 1, groupAdded: 0 },
          { date: '2026-04-23', dmAdded: 0, groupAdded: 2 },
          { date: '2026-04-24', dmAdded: 3, groupAdded: 1 },
        ],
      },
      active: { activeIn1d: 0, activeIn7d: 0, activeIn30d: 0 },
      storage: { sqliteBytes: 0, s3AttachmentBytes: 0 },
      toolMix: { topTools: [], errorTypeCounts: {} },
    }
    const component = mount(OverviewSection, { target, props: {} })
    expect(target.querySelector('.admin-overview__spark')).not.toBeNull()
    expect(target.querySelector('.admin-overview__spark > *')).not.toBeNull()
    void unmount(component)
  })
})
