// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { z } from 'zod'

import type { GlobalStatsSchema, SubjectStatsSchema } from '../../admin/fetcher-schemas.js'
import type {
  AdminLlmSnapshot,
  BillingDetail,
  BillingRoleTotals,
  BillingSubject,
  IdentityMappingEntry,
} from '../../shared/api-types.js'

type GlobalStats = z.infer<typeof GlobalStatsSchema>
type SubjectStats = z.infer<typeof SubjectStatsSchema>

const FIXED_TS = Date.UTC(2026, 4, 20, 12, 0, 0)

function roleTotals(inputTokens: number, outputTokens: number, calls: number): BillingRoleTotals {
  return { inputTokens, outputTokens, calls }
}

export function makeBillingSubject(overrides: Partial<BillingSubject> = {}): BillingSubject {
  return {
    storageContextId: 'tg:1001',
    contextType: 'dm',
    displayName: 'demo-user',
    totals: {
      main: roleTotals(1200, 800, 14),
      small: roleTotals(300, 120, 3),
      embedding: roleTotals(500, 0, 5),
    },
    toolCalls: 9,
    lastActiveAt: FIXED_TS,
    ...overrides,
  }
}

export function makeBillingDetail(overrides: Partial<BillingDetail> = {}): BillingDetail {
  return {
    subject: overrides.subject ?? makeBillingSubject(),
    requests: overrides.requests ?? [],
    truncated: overrides.truncated ?? false,
  }
}

function percentiles(): GlobalStats['distributions']['memosPerSubject'] {
  return { count: 12, min: 0, p50: 2, p90: 6, p99: 14, max: 20, mean: 3.4 }
}

function toolMix(): GlobalStats['toolMix'] {
  return {
    topTools: [
      { toolName: 'create_task', count: 982, successRate: 0.97 },
      { toolName: 'search_tasks', count: 741, successRate: 0.96 },
      { toolName: 'list_tasks', count: 603, successRate: 0.98 },
      { toolName: 'update_task', count: 441, successRate: 0.94 },
      { toolName: 'get_task', count: 318, successRate: 0.99 },
      { toolName: 'save_memo', count: 214, successRate: 0.95 },
      { toolName: 'web_fetch', count: 148, successRate: 0.88 },
      { toolName: 'get_current_time', count: 94, successRate: 1.0 },
    ],
    errorTypeCounts: { validation: 18, provider_4xx: 9, timeout: 4 },
    totalCalls: 4390,
    totalSuccessRate: 0.953,
    toolCallGrowth30d: [
      { date: '2026-05-02', count: 112 },
      { date: '2026-05-04', count: 98 },
      { date: '2026-05-06', count: 143 },
      { date: '2026-05-08', count: 165 },
      { date: '2026-05-10', count: 121 },
      { date: '2026-05-12', count: 187 },
      { date: '2026-05-14', count: 203 },
      { date: '2026-05-16', count: 178 },
      { date: '2026-05-18', count: 156 },
      { date: '2026-05-20', count: 194 },
      { date: '2026-05-24', count: 211 },
      { date: '2026-05-28', count: 229 },
    ],
  }
}

export function makeGlobalStats(overrides: Partial<GlobalStats> = {}): GlobalStats {
  return {
    generatedAt: FIXED_TS,
    window: '30d',
    subjects: {
      dmTotal: 12,
      groupTotal: 4,
      growthLast30d: [{ date: '2026-05-20', dmAdded: 1, groupAdded: 0 }],
    },
    active: { activeIn1d: 3, activeIn7d: 8, activeIn30d: 12 },
    distributions: {
      memosPerSubject: percentiles(),
      recurringTasksPerSubject: percentiles(),
      messageMetadataPerSubject: percentiles(),
      attachmentBytesPerSubject: percentiles(),
    },
    storage: { sqliteBytes: 524_288, s3AttachmentBytes: 2_097_152 },
    identityMix: { byProvider: { telegram: 10, kaneo: 2 }, kaneoWorkspaces: 2 },
    surfaceMix: {
      subjectsWithRecurring: 4,
      subjectsWithDeferred: 2,
      subjectsWithMemos: 9,
      subjectsWithInstructions: 3,
    },
    webFetches: { topHosts: [{ hostHash: 'h-abc123', count: 7 }] },
    toolMix: toolMix(),
    llmUsage: {
      totalCalls: 42,
      mainCalls: 30,
      smallCalls: 8,
      embeddingCalls: 4,
      inputTokensTotal: 18_400,
      outputTokensTotal: 9_200,
    },
    ...overrides,
  }
}

export function makeAdminLlmSnapshot(overrides: Partial<AdminLlmSnapshot> = {}): AdminLlmSnapshot {
  const base = { updatedAt: FIXED_TS, updatedBy: 'admin' }
  return {
    llm_apikey: { ...base, value: '***', required: true },
    llm_baseurl: { ...base, value: 'https://api.example.com', required: true },
    main_model: { ...base, value: 'gpt-4o-mini', required: true },
    small_model: { ...base, value: 'gpt-4o-mini', required: false },
    embedding_model: { ...base, value: 'text-embedding-3-small', required: false },
    ...overrides,
  }
}

function subjectMemos(): SubjectStats['memos'] {
  return {
    total: 9,
    byStatus: { active: 7, archived: 2 },
    tagCardinality: { distinct: 5, meanPerMemo: 1.6 },
    contentBytesTotal: 4_096,
    embeddingBytesTotal: 12_288,
    withEmbedding: 7,
    oldestCreatedAt: FIXED_TS,
    newestCreatedAt: FIXED_TS,
  }
}

function subjectAttachments(): SubjectStats['attachments'] {
  return {
    total: 6,
    byStatus: { stored: 5, pending: 1 },
    bySourceProvider: { telegram: 6 },
    storedBytesTotal: 1_048_576,
    active: 5,
    byExtension: { pdf: 3, png: 2, txt: 1 },
  }
}

function subjectToolCalls(): SubjectStats['toolCalls'] {
  return {
    total: 30,
    success: 28,
    failure: 2,
    topTools: [
      { toolName: 'create_task', count: 12 },
      { toolName: 'search_tasks', count: 9 },
    ],
    errorTypeCounts: { validation: 2 },
  }
}

export function makeSubjectStats(overrides: Partial<SubjectStats> = {}): SubjectStats {
  return {
    storageContextId: 'tg:1001',
    chatUserId: 'tg:1001',
    contextType: 'dm',
    displayName: 'demo-user',
    memos: subjectMemos(),
    scheduledPrompts: { total: 3, byStatus: { pending: 2, sent: 1 }, distinctDeliveryTargets: 2 },
    alertPrompts: { total: 1, byStatus: { active: 1 } },
    recurringTasks: {
      total: 4,
      enabled: 3,
      disabled: 1,
      distinctProjects: 2,
      nextRunWithin7d: 2,
      distinctRrulePatterns: 3,
    },
    userInstructions: { total: 2, textBytesTotal: 512 },
    attachments: subjectAttachments(),
    messageMetadata: {
      total: 120,
      authoredBySubject: 64,
      oldestTimestamp: FIXED_TS,
      newestTimestamp: FIXED_TS,
      textBytesTotal: 32_768,
    },
    conversationHistory: { turnCount: 18, summaryPresent: true },
    userIdentityMappings: { kaneo: 1 },
    stagedFiles: { total: 1, byStatus: { staged: 1 }, bytesTotal: 2_048 },
    userBlock: {
      addedAt: '2026-05-01T00:00:00.000Z',
      addedByPresent: true,
      kaneoWorkspacePresent: true,
    },
    groupBlock: null,
    webFetches: { totalRequests: 11 },
    llmUsage: { rowCount: 42, inputTokensTotal: 18_400, outputTokensTotal: 9_200 },
    toolCalls: subjectToolCalls(),
    ...overrides,
  }
}

export function makeIdentityMappingsSample(): IdentityMappingEntry[] {
  return [
    {
      contextId: 'tg:1001',
      providerName: 'task-provider-kaneo',
      providerUserId: 'ku-101',
      providerUserLogin: 'alice',
      displayName: 'Alice',
      matchedAt: '2026-05-01T00:00:00.000Z',
      matchMethod: 'manual_nl',
      confidence: 1,
    },
    {
      contextId: 'tg:1002',
      providerName: 'task-provider-kaneo',
      providerUserId: 'ku-102',
      providerUserLogin: 'bob',
      displayName: 'Bob',
      matchedAt: '2026-05-10T00:00:00.000Z',
      matchMethod: 'auto',
      confidence: 0.85,
    },
  ]
}
