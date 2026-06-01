// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import BillingSection from '../../../../client/admin/sections/BillingSection.svelte'
import type { BillingSubject } from '../../../../client/shared/api-types.js'
import type { SubjectStats } from '../../../../src/stats/types.js'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const emptyTotals = { inputTokens: 0, outputTokens: 0, calls: 0 }

const subject = (id: string): BillingSubject => ({
  storageContextId: id,
  contextType: 'dm',
  displayName: null,
  totals: { main: emptyTotals, small: emptyTotals, embedding: emptyTotals },
  toolCalls: 0,
  lastActiveAt: 0,
})

const statsSubject = (id: string): SubjectStats => ({
  storageContextId: id,
  chatUserId: id,
  contextType: 'dm',
  displayName: null,
  memos: {
    total: 7,
    byStatus: { active: 7 },
    tagCardinality: { distinct: 0, meanPerMemo: 0 },
    contentBytesTotal: 0,
    embeddingBytesTotal: 0,
    withEmbedding: 0,
    oldestCreatedAt: null,
    newestCreatedAt: null,
  },
  scheduledPrompts: { total: 0, byStatus: {}, distinctDeliveryTargets: 0 },
  alertPrompts: { total: 0, byStatus: {} },
  recurringTasks: {
    total: 0,
    enabled: 0,
    disabled: 0,
    distinctProjects: 0,
    nextRunWithin7d: 0,
    distinctRrulePatterns: 0,
  },
  userInstructions: { total: 0, textBytesTotal: 0 },
  attachments: {
    total: 0,
    byStatus: {},
    bySourceProvider: {},
    storedBytesTotal: 0,
    active: 0,
    byExtension: {},
  },
  messageMetadata: {
    total: 0,
    authoredBySubject: 0,
    oldestTimestamp: null,
    newestTimestamp: null,
    textBytesTotal: 0,
  },
  conversationHistory: { turnCount: 0, summaryPresent: false },
  userIdentityMappings: {},
  stagedFiles: { total: 0, byStatus: {}, bytesTotal: 0 },
  userBlock: null,
  groupBlock: null,
  webFetches: { totalRequests: 0 },
  llmUsage: { rowCount: 0, inputTokensTotal: 0, outputTokensTotal: 0 },
  toolCalls: { total: 0, success: 0, failure: 0, topTools: [], errorTypeCounts: {} },
})

const installFetch = (subjects: readonly BillingSubject[]): string[] => {
  const calls: string[] = []
  setMockFetch((url) => {
    calls.push(url)
    if (url.startsWith('/billing/subjects')) {
      return Promise.resolve(Response.json({ window: '30d', subjects }))
    }
    if (url.startsWith('/billing/subject/')) {
      return Promise.resolve(Response.json({ window: '30d', subject: subjects[0], requests: [], truncated: false }))
    }
    if (url.startsWith('/stats/subject/')) {
      const firstSubject = subjects[0]
      if (firstSubject === undefined) return Promise.resolve(Response.json(statsSubject('missing')))
      return Promise.resolve(Response.json(statsSubject(firstSubject.storageContextId)))
    }
    return Promise.resolve(new Response('not mocked', { status: 500 }))
  })
  return calls
}

const render = (): { target: HTMLElement; component: ReturnType<typeof mount> } => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')
  if (target === null) throw new Error('root missing')
  const component = mount(BillingSection, { target })
  return { target, component }
}

afterEach(() => {
  restoreFetch()
})

describe('BillingSection', () => {
  test('renders title and refresh control', () => {
    installFetch([])
    const { target, component } = render()
    expect(target.textContent).toContain('Billing')
    expect(target.querySelector('[data-testid="billing-refresh"]')).not.toBeNull()
    void unmount(component)
  })

  test('loads billing subjects without fetching admin credentials', async () => {
    const calls = installFetch([subject('ctx-A')])
    const { target, component } = render()
    for (let i = 0; i < 10; i++) await Promise.resolve()
    flushSync()
    expect(target.textContent).toContain('ctx-A')
    expect(calls.some((url) => url.startsWith('/billing/subjects'))).toBe(true)
    expect(calls.some((url) => url === '/admin/llm')).toBe(false)
    void unmount(component)
  })

  test('shows inline detail with per-subject stats when a subject is selected', async () => {
    const calls = installFetch([subject('ctx-A')])
    const { target, component } = render()
    for (let i = 0; i < 10; i++) await Promise.resolve()
    flushSync()

    const row = target.querySelector<HTMLElement>('.ui-datatable__tr')
    expect(row).not.toBeNull()
    row!.click()
    for (let i = 0; i < 10; i++) await Promise.resolve()
    flushSync()

    expect(target.querySelector('.billing-inline-detail')).not.toBeNull()
    expect(target.textContent).toContain('Requests for ctx-A')
    expect(target.textContent).toContain('Anonymous stats')
    expect(calls.some((url) => url.startsWith('/billing/subject/ctx-A'))).toBe(true)
    expect(calls.some((url) => url.startsWith('/stats/subject/ctx-A'))).toBe(true)
    void unmount(component)
  })

  test('shows the visible error when a refresh fetch fails', async () => {
    const calls: string[] = []
    const responses = [
      Response.json({ window: '30d', subjects: [subject('ctx-A')] }),
      Response.json({ error: 'fetch failed' }, { status: 500 }),
    ]
    setMockFetch((url) => {
      calls.push(url)
      const response = responses[calls.length - 1]
      expect(response).toBeDefined()
      return Promise.resolve(response!)
    })

    const { target, component } = render()
    for (let i = 0; i < 10; i++) await Promise.resolve()
    flushSync()

    const refreshBtn = target.querySelector<HTMLButtonElement>('[data-testid="billing-refresh"]')
    expect(refreshBtn).not.toBeNull()
    refreshBtn!.click()
    for (let i = 0; i < 10; i++) await Promise.resolve()
    flushSync()

    expect(calls.filter((url) => url.startsWith('/billing/subjects')).length).toBe(2)
    expect(target.textContent).toContain('fetch failed')
    void unmount(component)
  })
})
