// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import SubjectStatsPanel from '../../../client/admin/components/SubjectStatsPanel.svelte'
import type { SubjectStats } from '../../../src/stats/types.js'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

const makeSubjectStats = (overrides: Partial<SubjectStats> = {}): SubjectStats => ({
  storageContextId: 'ctx-1',
  chatUserId: null,
  contextType: 'dm',
  displayName: null,
  memos: {
    total: 0,
    byStatus: {},
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
  ...overrides,
})

const installFetch = (stats: SubjectStats): void => {
  setMockFetch(() =>
    Promise.resolve(
      new Response(JSON.stringify(stats), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  )
}

afterEach(() => {
  restoreFetch()
})

describe('SubjectStatsPanel', () => {
  test('renders attachment bytes via shared fmtBytes (base-1024, no decimals >=10)', async () => {
    // 512_000 bytes = 500 KB in base-1024
    const stats = makeSubjectStats({
      attachments: {
        total: 3,
        byStatus: {},
        bySourceProvider: {},
        storedBytesTotal: 512_000,
        active: 3,
        byExtension: {},
      },
    })
    installFetch(stats)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(SubjectStatsPanel, { target, props: { storageContextId: 'ctx-1' } })
    for (let i = 0; i < 10; i++) await Promise.resolve()
    flushSync()
    expect(target.textContent).toContain('500 KB')
    expect(target.textContent).not.toContain('512.0 KB')
    void unmount(component)
  })

  test('renders memos total and turns from subject stats', async () => {
    const stats = makeSubjectStats({
      memos: {
        total: 7,
        byStatus: {},
        tagCardinality: { distinct: 0, meanPerMemo: 0 },
        contentBytesTotal: 0,
        embeddingBytesTotal: 0,
        withEmbedding: 0,
        oldestCreatedAt: null,
        newestCreatedAt: null,
      },
      conversationHistory: { turnCount: 42, summaryPresent: false },
    })
    installFetch(stats)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(SubjectStatsPanel, { target, props: { storageContextId: 'ctx-1' } })
    for (let i = 0; i < 10; i++) await Promise.resolve()
    flushSync()
    expect(target.textContent).toContain('7')
    expect(target.textContent).toContain('42')
    void unmount(component)
  })
})
