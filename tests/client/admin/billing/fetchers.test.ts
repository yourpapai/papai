// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { fetchBillingDetail, fetchBillingSubjects, fetchStatsSubject } from '../../../../client/admin/fetchers.js'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const captured: Array<{ url: string; init: RequestInit }> = []

beforeEach(() => {
  captured.length = 0
})

afterEach(() => {
  restoreFetch()
})

const installFetch = (status: number, payload: unknown): void => {
  setMockFetch((url, init) => {
    captured.push({ url, init })
    return Promise.resolve(
      new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
}

const emptyTotals = { inputTokens: 0, outputTokens: 0, calls: 0 }
const fullSubject = (overrides: Record<string, unknown>): Record<string, unknown> => ({
  storageContextId: 'A',
  contextType: 'dm',
  displayName: null,
  totals: { main: emptyTotals, small: emptyTotals, embedding: emptyTotals },
  toolCalls: 0,
  lastActiveAt: 0,
  ...overrides,
})

const fullStatsSubject = (): Record<string, unknown> => ({
  storageContextId: 'group-9:thread-1',
  chatUserId: null,
  contextType: 'group',
  displayName: 'group',
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
  groupBlock: { memberCount: 1, distinctAddedBy: 1, observationCount: 0 },
  webFetches: { totalRequests: 0 },
  llmUsage: { rowCount: 0, inputTokensTotal: 0, outputTokensTotal: 0 },
  toolCalls: { total: 0, success: 0, failure: 0, topTools: [], errorTypeCounts: {} },
})

describe('admin billing fetchers', () => {
  test('GETs /billing/subjects with the requested window', async () => {
    installFetch(200, { window: '7d', subjects: [fullSubject({})] })

    const result = await fetchBillingSubjects('7d')

    expect(captured[0]).toEqual({ url: '/billing/subjects?window=7d', init: {} })
    expect(result.window).toBe('7d')
    expect(result.subjects).toHaveLength(1)
  })

  test('GETs /billing/subject/<encoded id> with the window', async () => {
    installFetch(200, {
      window: 'all',
      subject: fullSubject({ storageContextId: 'group-9:thread-1', contextType: 'group' }),
      requests: [],
      truncated: false,
    })

    const result = await fetchBillingDetail('group-9:thread-1', 'all')

    expect(captured[0]).toEqual({
      url: `/billing/subject/${encodeURIComponent('group-9:thread-1')}?window=all`,
      init: {},
    })
    expect(result.subject.storageContextId).toBe('group-9:thread-1')
  })

  test('GETs /stats/subject/<encoded id>', async () => {
    installFetch(200, fullStatsSubject())

    const result = await fetchStatsSubject('group-9:thread-1')

    expect(captured[0]).toEqual({ url: `/stats/subject/${encodeURIComponent('group-9:thread-1')}`, init: {} })
    expect(result.storageContextId).toBe('group-9:thread-1')
  })

  test('throws on non-2xx responses with the error message', async () => {
    installFetch(404, { error: 'subject not found' })

    await expect(fetchBillingDetail('missing', '30d')).rejects.toThrow('subject not found')
  })
})
