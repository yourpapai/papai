// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import StatsPanel from '../../../client/admin/components/StatsPanel.svelte'
import type { GlobalStats } from '../../../src/stats/types.js'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

const emptyPercentiles = { count: 0, min: 0, p50: 0, p90: 0, p99: 0, max: 0, mean: 0 }

type StatsPanelState = {
  statsWindow: '30d' | '7d' | '1d' | 'all'
  globalStats: GlobalStats | null
}

type FetchHandlers = {
  payload: GlobalStats | null
  status: number | null
  error: string | null
}

const globalPayload = (overrides: Partial<GlobalStats> | null): GlobalStats => {
  const payload: GlobalStats = {
    generatedAt: 0,
    window: '30d',
    subjects: {
      dmTotal: 42,
      groupTotal: 7,
      growthLast30d: [{ date: '2026-05-01', dmAdded: 1, groupAdded: 0 }],
    },
    active: { activeIn1d: 3, activeIn7d: 9, activeIn30d: 21 },
    distributions: {
      memosPerSubject: { ...emptyPercentiles, count: 10, p50: 5, p90: 12, max: 30, mean: 6 },
      recurringTasksPerSubject: emptyPercentiles,
      messageMetadataPerSubject: emptyPercentiles,
      attachmentBytesPerSubject: emptyPercentiles,
    },
    storage: { sqliteBytes: 1024, s3AttachmentBytes: 2048 },
    identityMix: { byProvider: { 'task-provider': 5 }, kaneoWorkspaces: 2 },
    surfaceMix: {
      subjectsWithRecurring: 3,
      subjectsWithDeferred: 1,
      subjectsWithMemos: 4,
      subjectsWithInstructions: 2,
    },
    webFetches: { topHosts: [{ hostHash: 'abc', count: 5 }] },
    toolMix: {
      topTools: [{ toolName: 'create_task', count: 8, successRate: 1 }],
      errorTypeCounts: {},
      totalCalls: 8,
      totalSuccessRate: 1,
      toolCallGrowth30d: [{ date: '2026-05-01', count: 5 }],
    },
    llmUsage: {
      totalCalls: 0,
      mainCalls: 0,
      smallCalls: 0,
      embeddingCalls: 0,
      inputTokensTotal: 0,
      outputTokensTotal: 0,
    },
  }
  if (overrides === null) return payload
  return { ...payload, ...overrides }
}

const freshState = (): StatsPanelState => ({
  statsWindow: '30d' as const,
  globalStats: null as GlobalStats | null,
})

const installFetch = (handlers: FetchHandlers): string[] => {
  const calls: string[] = []
  setMockFetch((url) => {
    calls.push(url)
    if (handlers.error !== null) {
      let status = 400
      if (handlers.status !== null) status = handlers.status
      return Promise.resolve(
        new Response(JSON.stringify({ error: handlers.error }), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }
    let payload = globalPayload(null)
    if (handlers.payload !== null) payload = handlers.payload
    let status = 200
    if (handlers.status !== null) status = handlers.status
    return Promise.resolve(
      new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
  return calls
}

const render = (state: StatsPanelState): { target: HTMLElement; component: ReturnType<typeof mount> } => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')
  if (target === null) throw new Error('root missing')
  const component = mount(StatsPanel, { target, props: { dashboard: state } })
  return { target, component }
}

afterEach(() => {
  restoreFetch()
})

describe('admin StatsPanel', () => {
  test('renders title and window Seg buttons', () => {
    installFetch({ payload: null, status: null, error: null })
    const { target, component } = render(freshState())
    expect(target.textContent).toContain('Stats')
    const segBtns = target.querySelectorAll('.ui-seg__btn')
    expect(segBtns.length).toBeGreaterThan(0)
    const labels = Array.from(segBtns).map((b) => b.textContent?.trim())
    expect(labels).toContain('30d')
    expect(labels).toContain('7d')
    expect(labels).toContain('1d')
    void unmount(component)
  })

  test('fetches /stats/global on mount and renders active counts', async () => {
    const calls = installFetch({ payload: null, status: null, error: null })
    const { target, component } = render(freshState())
    for (let i = 0; i < 10; i++) await Promise.resolve()
    flushSync()
    expect(calls.some((url) => url.startsWith('/stats/global'))).toBe(true)
    // active 1d = 3, 7d = 9, 30d = 21 from globalPayload; total subjects = 42+7 = 49
    expect(target.textContent).toMatch(/3/u)
    expect(target.textContent).toMatch(/9/u)
    expect(target.textContent).toMatch(/21/u)
    void unmount(component)
  })

  test('refetches when the window Seg button changes', async () => {
    const calls = installFetch({ payload: null, status: null, error: null })
    const state = freshState()
    const { target, component } = render(state)
    for (let i = 0; i < 10; i++) await Promise.resolve()
    flushSync()
    // Find and click the 7d button
    const segBtns = Array.from(target.querySelectorAll<HTMLButtonElement>('.ui-seg__btn'))
    const btn7d = segBtns.find((b) => b.textContent?.trim() === '7d')
    expect(btn7d).not.toBeUndefined()
    btn7d!.click()
    for (let i = 0; i < 10; i++) await Promise.resolve()
    flushSync()
    expect(calls.some((url) => url.includes('window=7d'))).toBe(true)
    void unmount(component)
  })

  test('renders an error message on non-2xx', async () => {
    installFetch({ payload: null, status: 500, error: 'boom' })
    const { target, component } = render(freshState())
    for (let i = 0; i < 10; i++) await Promise.resolve()
    flushSync()
    expect(target.textContent).toMatch(/boom/u)
    void unmount(component)
  })

  test('renders all four distribution row labels', async () => {
    installFetch({ payload: null, status: null, error: null })
    const { target, component } = render(freshState())
    for (let i = 0; i < 10; i++) await Promise.resolve()
    flushSync()
    expect(target.textContent).toContain('memos / subject')
    expect(target.textContent).toContain('recurring / subject')
    expect(target.textContent).toContain('messages / subject')
    expect(target.textContent).toContain('attach bytes / subject')
    void unmount(component)
  })

  test('renders tool calls panel with total calls and top tool', async () => {
    installFetch({ payload: null, status: null, error: null })
    const { target, component } = render(freshState())
    for (let i = 0; i < 10; i++) await Promise.resolve()
    flushSync()
    expect(target.textContent).toContain('tool calls')
    expect(target.textContent).toContain('create_task')
    void unmount(component)
  })

  test('formats storage bytes via the shared fmtBytes (base-1024, no decimals >=10)', async () => {
    const payload = globalPayload({ storage: { sqliteBytes: 277806, s3AttachmentBytes: 0 } })
    installFetch({ payload, status: null, error: null })
    const { target, component } = render(freshState())
    for (let i = 0; i < 10; i++) await Promise.resolve()
    flushSync()
    expect(target.textContent).toContain('271 KB')
    expect(target.textContent).not.toContain('271.3 KB')
    void unmount(component)
  })

  test('flags active-subject count exceeding total via Stat warn state (A5)', async () => {
    const payload = globalPayload({
      active: { activeIn1d: 1, activeIn7d: 2, activeIn30d: 13 },
      subjects: {
        dmTotal: 3,
        groupTotal: 1,
        growthLast30d: [{ date: '2026-05-01', dmAdded: 1, groupAdded: 0 }],
      },
    })
    installFetch({ payload, status: null, error: null })
    const { target, component } = render(freshState())
    for (let i = 0; i < 10; i++) await Promise.resolve()
    flushSync()
    expect(target.querySelector('.ui-stat__value--over')).not.toBeNull()
    expect(target.textContent).toContain('exceeds total')
    void unmount(component)
  })
})
