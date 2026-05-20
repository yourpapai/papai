// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import BillingPanel from '../../../../client/debug/billing/BillingPanel.svelte'
import type { BillingSubject, DashboardState } from '../../../../client/debug/dashboard-types.js'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const emptyTotals = { inputTokens: 0, outputTokens: 0, calls: 0 }

const emptyAdminKey = { value: null, updatedAt: null, updatedBy: null }

const subject = (id: string): BillingSubject => ({
  storageContextId: id,
  contextType: 'dm',
  displayName: null,
  totals: { main: emptyTotals, small: emptyTotals, embedding: emptyTotals },
  toolCalls: 0,
  lastActiveAt: 0,
})

const freshState = (): DashboardState => ({
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
})

const installFetch = (handlers: { subjects?: BillingSubject[]; adminEmpty?: boolean }): string[] => {
  const calls: string[] = []
  setMockFetch((url) => {
    calls.push(url)
    if (url.startsWith('/billing/subjects')) {
      return Promise.resolve(
        new Response(JSON.stringify({ window: '30d', subjects: handlers.subjects ?? [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }
    if (url === '/admin/llm') {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            llm_apikey: emptyAdminKey,
            llm_baseurl: emptyAdminKey,
            main_model: emptyAdminKey,
            small_model: emptyAdminKey,
            embedding_model: emptyAdminKey,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
    }
    return Promise.resolve(new Response('not mocked', { status: 500 }))
  })
  return calls
}

const render = (state: DashboardState): { target: HTMLElement; component: ReturnType<typeof mount> } => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.getElementById('root')
  if (target === null) throw new Error('root missing')
  const component = mount(BillingPanel, { target, props: { dashboard: state, onSelectSubject: () => {} } })
  return { target, component }
}

afterEach(() => {
  restoreFetch()
})

describe('BillingPanel', () => {
  test('renders title, refresh control, and window selector', () => {
    installFetch({})
    const { target, component } = render(freshState())
    expect(target.textContent).toContain('Billing')
    const select = target.querySelector<HTMLSelectElement>('[data-testid="billing-window-select"]')
    expect(select).not.toBeNull()
    const refresh = target.querySelector('[data-testid="billing-refresh"]')
    expect(refresh).not.toBeNull()
    void unmount(component)
  })

  test('on mount, calls /billing/subjects and /admin/llm', async () => {
    const calls = installFetch({ subjects: [subject('ctx-A')] })
    const { component } = render(freshState())
    for (let i = 0; i < 10; i++) await Promise.resolve()
    flushSync()
    expect(calls.some((url) => url.startsWith('/billing/subjects'))).toBe(true)
    expect(calls.some((url) => url === '/admin/llm')).toBe(true)
    void unmount(component)
  })

  test('renders the SubjectsTable from dashboard.billingSubjects', async () => {
    installFetch({})
    const state = freshState()
    state.billingSubjects = [subject('user-A')]
    const { target, component } = render(state)
    for (let i = 0; i < 5; i++) await Promise.resolve()
    flushSync()
    expect(target.textContent).toContain('user-A')
    void unmount(component)
  })

  test('clicking refresh re-fetches subjects', async () => {
    const calls = installFetch({})
    const { target, component } = render(freshState())
    for (let i = 0; i < 5; i++) await Promise.resolve()
    flushSync()
    const initialSubjectsCalls = calls.filter((u) => u.startsWith('/billing/subjects')).length
    const refresh = target.querySelector<HTMLButtonElement>('[data-testid="billing-refresh"]')
    refresh?.click()
    for (let i = 0; i < 10; i++) await Promise.resolve()
    flushSync()
    const afterRefreshSubjectsCalls = calls.filter((u) => u.startsWith('/billing/subjects')).length
    expect(afterRefreshSubjectsCalls).toBeGreaterThan(initialSubjectsCalls)
    void unmount(component)
  })

  test('changing the window selector re-fetches with the new window', async () => {
    const calls = installFetch({})
    const { target, component } = render(freshState())
    for (let i = 0; i < 5; i++) await Promise.resolve()
    flushSync()
    const select = target.querySelector<HTMLSelectElement>('[data-testid="billing-window-select"]')
    expect(select).not.toBeNull()
    const selectEl = select!
    selectEl.value = '7d'
    selectEl.dispatchEvent(new Event('change', { bubbles: true }))
    for (let i = 0; i < 10; i++) await Promise.resolve()
    flushSync()
    expect(calls.some((url) => url.includes('window=7d'))).toBe(true)
    void unmount(component)
  })
})
