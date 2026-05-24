// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { z } from 'zod'

import type { GlobalStatsSchema } from '../../admin/fetcher-schemas.js'
import type { AdminLlmSnapshot, BillingDetail, BillingRoleTotals, BillingSubject } from '../../shared/api-types.js'

type GlobalStats = z.infer<typeof GlobalStatsSchema>

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
    toolMix: {
      topTools: [{ toolName: 'create_task', count: 30, successRate: 0.96 }],
      errorTypeCounts: { validation: 2 },
    },
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
    llm_apikey: { ...base, value: '***' },
    llm_baseurl: { ...base, value: 'https://api.example.com' },
    main_model: { ...base, value: 'gpt-4o-mini' },
    small_model: { ...base, value: 'gpt-4o-mini' },
    embedding_model: { ...base, value: 'text-embedding-3-small' },
    ...overrides,
  }
}
