// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { GlobalStats, GlobalStatsOptions, Percentiles, StatsWindow, SubjectStats } from '../../src/stats/types.js'

describe('stats types', () => {
  test('Percentiles is a structural shape with seven numeric fields', () => {
    const sample: Percentiles = {
      count: 0,
      min: 0,
      p50: 0,
      p90: 0,
      p99: 0,
      max: 0,
      mean: 0,
    }

    expect(Object.keys(sample)).toHaveLength(7)
  })

  test('GlobalStatsOptions accepts an optional window and noCache', () => {
    const a: GlobalStatsOptions = {}
    const b: GlobalStatsOptions = { window: '30d', noCache: true }

    expect(a).toBeDefined()
    expect(b.window).toBe('30d')
  })

  test('StatsWindow union covers the documented windows', () => {
    const windows: StatsWindow[] = ['1d', '7d', '30d', 'all']

    expect(windows).toHaveLength(4)
  })

  test('SubjectStats can be constructed with all required shape fields', () => {
    const empty: SubjectStats = {
      storageContextId: 's',
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
    }

    expect(empty.storageContextId).toBe('s')
  })

  test('GlobalStats has the documented top-level keys', () => {
    const sample: GlobalStats = {
      generatedAt: 0,
      window: 'all',
      subjects: { dmTotal: 0, groupTotal: 0, growthLast30d: [] },
      active: { activeIn1d: 0, activeIn7d: 0, activeIn30d: 0 },
      distributions: {
        memosPerSubject: { count: 0, min: 0, p50: 0, p90: 0, p99: 0, max: 0, mean: 0 },
        recurringTasksPerSubject: { count: 0, min: 0, p50: 0, p90: 0, p99: 0, max: 0, mean: 0 },
        messageMetadataPerSubject: { count: 0, min: 0, p50: 0, p90: 0, p99: 0, max: 0, mean: 0 },
        attachmentBytesPerSubject: { count: 0, min: 0, p50: 0, p90: 0, p99: 0, max: 0, mean: 0 },
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
      llmUsage: {
        totalCalls: 0,
        mainCalls: 0,
        smallCalls: 0,
        embeddingCalls: 0,
        inputTokensTotal: 0,
        outputTokensTotal: 0,
      },
    }

    const expectedKeys = [
      'generatedAt',
      'window',
      'subjects',
      'active',
      'distributions',
      'storage',
      'identityMix',
      'surfaceMix',
      'webFetches',
      'toolMix',
      'llmUsage',
    ]
    expect(Object.keys(sample).sort()).toEqual(expectedKeys.sort())
  })
})
