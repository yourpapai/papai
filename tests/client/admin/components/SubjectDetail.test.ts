// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import SubjectDetail from '../../../../client/admin/components/SubjectDetail.svelte'
import type { BillingDetail, BillingSubject } from '../../../../client/shared/api-types.js'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const emptyTotals = { inputTokens: 0, outputTokens: 0, calls: 0 }

const subject: BillingSubject = {
  storageContextId: 'ctx-test',
  contextType: 'dm',
  displayName: 'Test User',
  totals: { main: emptyTotals, small: emptyTotals, embedding: emptyTotals },
  toolCalls: 0,
  lastActiveAt: 1_700_000_000_000,
}

const detail: BillingDetail = {
  subject,
  requests: [],
  truncated: false,
  tokenUsageByDay: [],
}

const recentRow = {
  ts: 1_700_000_000_000,
  modelLabel: 'gpt-4',
  role: 'main',
  inputTokens: 100,
  outputTokens: 50,
  finishStatus: 'error',
}

const emptyStats = {
  storageContextId: 'ctx-test',
  chatUserId: 'ctx-test',
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
}

const responseFor = (responses: ReadonlyMap<string, Response>, url: string): Promise<Response> => {
  for (const [prefix, response] of responses) {
    const matched = url.startsWith(prefix)
    if (matched) return Promise.resolve(response)
  }
  return Promise.resolve(new Response('not mocked', { status: 500 }))
}

afterEach(() => {
  restoreFetch()
})

const render = (): { target: HTMLElement; component: ReturnType<typeof mount> } => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')
  if (target === null) throw new Error('root missing')
  const component = mount(SubjectDetail, { target, props: { detail } })
  return { target, component }
}

describe('SubjectDetail (kit-adoption)', () => {
  test('renders recent-request finishStatus as StatusPill (.ui-pill)', async () => {
    const responses = new Map<string, Response>([
      ['/admin/subjects/', Response.json({ subjectId: 'ctx-test', limit: 25, requests: [recentRow] })],
      ['/stats/subject/', Response.json(emptyStats)],
    ])
    setMockFetch((url) => responseFor(responses, url))

    const { target, component } = render()
    await drain()

    const recentTable = target.querySelector('.admin-subject__requests')
    expect(recentTable).not.toBeNull()
    expect(recentTable?.querySelector('.ui-pill')).not.toBeNull()

    void unmount(component)
  })
})
