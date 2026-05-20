// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { fetchStatsGlobal, fetchStatsSubject } from '../../../../client/debug/stats/fetchers.js'
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

const emptyPercentiles = { count: 0, min: 0, p50: 0, p90: 0, p99: 0, max: 0, mean: 0 }

const fullGlobalPayload = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  generatedAt: 1000,
  window: '30d',
  subjects: { dmTotal: 0, groupTotal: 0, growthLast30d: [] },
  active: { activeIn1d: 0, activeIn7d: 0, activeIn30d: 0 },
  distributions: {
    memosPerSubject: emptyPercentiles,
    recurringTasksPerSubject: emptyPercentiles,
    messageMetadataPerSubject: emptyPercentiles,
    attachmentBytesPerSubject: emptyPercentiles,
  },
  storage: { sqliteBytes: 0, s3AttachmentBytes: 0 },
  identityMix: { byProvider: {}, kaneoWorkspaces: 0 },
  surfaceMix: {
    subjectsWithRecurring: 0,
    subjectsWithDeferred: 0,
    subjectsWithMemos: 0,
    subjectsWithInstructions: 0,
  },
  webFetches: { topHosts: [] },
  toolMix: { topTools: [], errorTypeCounts: {} },
  ...overrides,
})

const fullSubjectPayload = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  storageContextId: 'u1',
  chatUserId: 'u1',
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
  userBlock: { addedAt: null, addedByPresent: false, kaneoWorkspacePresent: false },
  groupBlock: null,
  webFetches: { totalRequests: 0 },
  llmUsage: { rowCount: 0, inputTokensTotal: 0, outputTokensTotal: 0 },
  toolCalls: { total: 0, success: 0, failure: 0, topTools: [], errorTypeCounts: {} },
  ...overrides,
})

describe('fetchStatsGlobal', () => {
  test('GETs /stats/global with the requested window', async () => {
    installFetch(200, fullGlobalPayload({ window: '7d' }))
    const result = await fetchStatsGlobal('7d')
    expect(captured[0]?.url).toBe('/stats/global?window=7d')
    expect(result.window).toBe('7d')
  })

  test('defaults to no query param when window is omitted', async () => {
    installFetch(200, fullGlobalPayload())
    const result = await fetchStatsGlobal()
    expect(captured[0]?.url).toBe('/stats/global')
    expect(result.window).toBe('30d')
  })

  test('throws on non-2xx with the server error message', async () => {
    installFetch(400, { error: 'unknown window' })
    await expect(fetchStatsGlobal('7d')).rejects.toThrow('unknown window')
  })
})

describe('fetchStatsSubject', () => {
  test('GETs /stats/subject/<encoded id>', async () => {
    installFetch(
      200,
      fullSubjectPayload({
        storageContextId: 'group-9:thread-1',
        contextType: 'group',
        chatUserId: null,
        userBlock: null,
        groupBlock: { memberCount: 1, distinctAddedBy: 1, observationCount: 0 },
      }),
    )
    const result = await fetchStatsSubject('group-9:thread-1')
    expect(captured[0]?.url).toBe(`/stats/subject/${encodeURIComponent('group-9:thread-1')}`)
    expect(result.storageContextId).toBe('group-9:thread-1')
  })

  test('throws on 404 with the server error message', async () => {
    installFetch(404, { error: 'subject not found' })
    await expect(fetchStatsSubject('missing')).rejects.toThrow('subject not found')
  })
})
