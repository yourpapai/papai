// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import type { DashboardState } from '../../../../client/debug/dashboard-types.js'
import StatsPanel from '../../../../client/debug/stats/StatsPanel.svelte'
import type { GlobalStats } from '../../../../src/stats/types.js'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const emptyPercentiles = { count: 0, min: 0, p50: 0, p90: 0, p99: 0, max: 0, mean: 0 }

const globalPayload = (overrides: Partial<GlobalStats> = {}): GlobalStats => ({
  generatedAt: 0,
  window: '30d',
  subjects: { dmTotal: 42, groupTotal: 7, growthLast30d: [{ date: '2026-05-01', dmAdded: 1, groupAdded: 0 }] },
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
  toolMix: { topTools: [{ toolName: 'create_task', count: 8, successRate: 1 }], errorTypeCounts: {} },
  ...overrides,
})

const freshState = (): DashboardState =>
  ({
    connected: false,
    stats: { startedAt: 0, totalMessages: 0, totalLlmCalls: 0, totalToolCalls: 0 },
    sessions: new Map(),
    wizards: new Map(),
    scheduler: {},
    pollers: {},
    messageCache: {},
    llmTraces: [],
    logs: [],
    logScopes: new Set(),
    turns: [],
    notifications: [],
    toolFailures: [],
    recurringTasks: [],
    deferredPrompts: [],
    memos: [],
    identityMappings: new Map(),
    activeConfigEditors: new Set(),
    authorizedGroups: [],
    activeContext: 'all',
    activeLogFilter: {},
    billingWindow: '30d',
    billingSubjects: [],
    billingDetail: null,
    adminLlm: null,
    statsWindow: '30d',
    globalStats: null,
    subjectStats: null,
  }) as DashboardState

const installFetch = (handlers: { payload?: GlobalStats; status?: number; error?: string } = {}): string[] => {
  const calls: string[] = []
  setMockFetch((url) => {
    calls.push(url)
    if (handlers.error !== undefined) {
      return Promise.resolve(
        new Response(JSON.stringify({ error: handlers.error }), {
          status: handlers.status ?? 400,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }
    return Promise.resolve(
      new Response(JSON.stringify(handlers.payload ?? globalPayload()), {
        status: handlers.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
  return calls
}

const render = (state: DashboardState): { target: HTMLElement; component: ReturnType<typeof mount> } => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.getElementById('root')
  if (target === null) throw new Error('root missing')
  const component = mount(StatsPanel, { target, props: { dashboard: state } })
  return { target, component }
}

afterEach(() => {
  restoreFetch()
})

describe('StatsPanel', () => {
  test('renders title and window selector', () => {
    installFetch()
    const { target, component } = render(freshState())
    expect(target.textContent).toContain('Stats')
    const select = target.querySelector<HTMLSelectElement>('[data-testid="stats-window-select"]')
    expect(select).not.toBeNull()
    void unmount(component)
  })

  test('fetches /stats/global on mount and renders DM total + active counts', async () => {
    const calls = installFetch()
    const { target, component } = render(freshState())
    for (let i = 0; i < 10; i++) await Promise.resolve()
    flushSync()
    expect(calls.some((url) => url.startsWith('/stats/global'))).toBe(true)
    expect(target.textContent).toMatch(/42/u)
    expect(target.textContent).toMatch(/Group total/u)
    void unmount(component)
  })

  test('refetches when the window selector changes', async () => {
    const calls = installFetch()
    const state = freshState()
    const { target, component } = render(state)
    for (let i = 0; i < 10; i++) await Promise.resolve()
    flushSync()
    const select = target.querySelector<HTMLSelectElement>('[data-testid="stats-window-select"]')
    expect(select).not.toBeNull()
    const selectEl = select!
    selectEl.value = '7d'
    selectEl.dispatchEvent(new Event('change', { bubbles: true }))
    for (let i = 0; i < 10; i++) await Promise.resolve()
    flushSync()
    expect(calls.some((url) => url.includes('window=7d'))).toBe(true)
    void unmount(component)
  })

  test('renders an error message on non-2xx', async () => {
    installFetch({ status: 500, error: 'boom' })
    const { target, component } = render(freshState())
    for (let i = 0; i < 10; i++) await Promise.resolve()
    flushSync()
    expect(target.textContent).toMatch(/boom/u)
    void unmount(component)
  })
})
