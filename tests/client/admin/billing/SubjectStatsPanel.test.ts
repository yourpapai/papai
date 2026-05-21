// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import SubjectStatsPanel from '../../../../client/admin/components/SubjectStatsPanel.svelte'
import type { SubjectStats } from '../../../../src/stats/types.js'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const subjectPayload = (overrides: Partial<SubjectStats>): SubjectStats => ({
  storageContextId: 'u1',
  chatUserId: 'u1',
  contextType: 'dm',
  displayName: null,
  memos: {
    total: 7,
    byStatus: { active: 7 },
    tagCardinality: { distinct: 3, meanPerMemo: 0.4 },
    contentBytesTotal: 1024,
    embeddingBytesTotal: 0,
    withEmbedding: 0,
    oldestCreatedAt: null,
    newestCreatedAt: null,
  },
  scheduledPrompts: { total: 2, byStatus: {}, distinctDeliveryTargets: 1 },
  alertPrompts: { total: 0, byStatus: {} },
  recurringTasks: {
    total: 4,
    enabled: 3,
    disabled: 1,
    distinctProjects: 1,
    nextRunWithin7d: 2,
    distinctRrulePatterns: 1,
  },
  userInstructions: { total: 1, textBytesTotal: 32 },
  attachments: {
    total: 5,
    byStatus: {},
    bySourceProvider: {},
    storedBytesTotal: 4096,
    active: 5,
    byExtension: {},
  },
  messageMetadata: {
    total: 100,
    authoredBySubject: 60,
    oldestTimestamp: null,
    newestTimestamp: null,
    textBytesTotal: 0,
  },
  conversationHistory: { turnCount: 11, summaryPresent: true },
  userIdentityMappings: {},
  stagedFiles: { total: 0, byStatus: {}, bytesTotal: 0 },
  userBlock: { addedAt: null, addedByPresent: true, kaneoWorkspacePresent: false },
  groupBlock: null,
  webFetches: { totalRequests: 9 },
  llmUsage: { rowCount: 12, inputTokensTotal: 1234, outputTokensTotal: 567 },
  toolCalls: { total: 8, success: 7, failure: 1, topTools: [], errorTypeCounts: {} },
  ...overrides,
})

const installFetch = (status: number, payload: unknown): void => {
  setMockFetch(() =>
    Promise.resolve(
      new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  )
}

const render = (storageContextId: string): { target: HTMLElement; component: ReturnType<typeof mount> } => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')
  if (target === null) throw new Error('root missing')
  const component = mount(SubjectStatsPanel, { target, props: { storageContextId } })
  return { target, component }
}

afterEach(() => {
  restoreFetch()
})

describe('admin SubjectStatsPanel', () => {
  test('renders a loading placeholder before data resolves', () => {
    installFetch(200, subjectPayload({}))
    const { target, component } = render('u1')
    expect(target.textContent).toContain('Loading')
    void unmount(component)
  })

  test('renders memo total, recurring total, attachment bytes, turn count once loaded', async () => {
    installFetch(200, subjectPayload({}))
    const { target, component } = render('u1')
    for (let i = 0; i < 10; i++) await Promise.resolve()
    flushSync()
    expect(target.textContent).toMatch(/memos/iu)
    expect(target.textContent).toMatch(/recurring/iu)
    expect(target.textContent).toMatch(/4\.0\s?KB/u)
    expect(target.textContent).toMatch(/turns/iu)
    expect(target.textContent).toContain('11')
    void unmount(component)
  })

  test('renders an error message on non-2xx', async () => {
    installFetch(404, { error: 'subject not found' })
    const { target, component } = render('missing')
    for (let i = 0; i < 10; i++) await Promise.resolve()
    flushSync()
    expect(target.textContent).toMatch(/subject not found/u)
    void unmount(component)
  })
})
