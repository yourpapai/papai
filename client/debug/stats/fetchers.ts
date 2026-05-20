// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import type { GlobalStats, StatsWindow, SubjectStats } from '../../../src/stats/types.js'

const PercentilesSchema = z.object({
  count: z.number(),
  min: z.number(),
  p50: z.number(),
  p90: z.number(),
  p99: z.number(),
  max: z.number(),
  mean: z.number(),
})

const StatsWindowSchema = z.enum(['1d', '7d', '30d', 'all'])

const GlobalStatsSchema = z.object({
  generatedAt: z.number(),
  window: StatsWindowSchema,
  subjects: z.object({
    dmTotal: z.number(),
    groupTotal: z.number(),
    growthLast30d: z.array(z.object({ date: z.string(), dmAdded: z.number(), groupAdded: z.number() })),
  }),
  active: z.object({ activeIn1d: z.number(), activeIn7d: z.number(), activeIn30d: z.number() }),
  distributions: z.object({
    memosPerSubject: PercentilesSchema,
    recurringTasksPerSubject: PercentilesSchema,
    messageMetadataPerSubject: PercentilesSchema,
    attachmentBytesPerSubject: PercentilesSchema,
  }),
  storage: z.object({ sqliteBytes: z.number(), s3AttachmentBytes: z.number() }),
  identityMix: z.object({ byProvider: z.record(z.string(), z.number()), kaneoWorkspaces: z.number() }),
  surfaceMix: z.object({
    subjectsWithRecurring: z.number(),
    subjectsWithDeferred: z.number(),
    subjectsWithMemos: z.number(),
    subjectsWithInstructions: z.number(),
  }),
  webFetches: z.object({
    topHosts: z.array(z.object({ hostHash: z.string(), count: z.number() })),
  }),
  toolMix: z.object({
    topTools: z.array(z.object({ toolName: z.string(), count: z.number(), successRate: z.number() })),
    errorTypeCounts: z.record(z.string(), z.number()),
  }),
})

const StatsContextTypeSchema = z.enum(['dm', 'group', 'unknown'])

const SubjectStatsSchema = z.object({
  storageContextId: z.string(),
  chatUserId: z.string().nullable(),
  contextType: StatsContextTypeSchema,
  displayName: z.string().nullable(),
  memos: z.object({
    total: z.number(),
    byStatus: z.record(z.string(), z.number()),
    tagCardinality: z.object({ distinct: z.number(), meanPerMemo: z.number() }),
    contentBytesTotal: z.number(),
    embeddingBytesTotal: z.number(),
    withEmbedding: z.number(),
    oldestCreatedAt: z.number().nullable(),
    newestCreatedAt: z.number().nullable(),
  }),
  scheduledPrompts: z.object({
    total: z.number(),
    byStatus: z.record(z.string(), z.number()),
    distinctDeliveryTargets: z.number(),
  }),
  alertPrompts: z.object({ total: z.number(), byStatus: z.record(z.string(), z.number()) }),
  recurringTasks: z.object({
    total: z.number(),
    enabled: z.number(),
    disabled: z.number(),
    distinctProjects: z.number(),
    nextRunWithin7d: z.number(),
    distinctRrulePatterns: z.number(),
  }),
  userInstructions: z.object({ total: z.number(), textBytesTotal: z.number() }),
  attachments: z.object({
    total: z.number(),
    byStatus: z.record(z.string(), z.number()),
    bySourceProvider: z.record(z.string(), z.number()),
    storedBytesTotal: z.number(),
    active: z.number(),
    byExtension: z.record(z.string(), z.number()),
  }),
  messageMetadata: z.object({
    total: z.number(),
    authoredBySubject: z.number(),
    oldestTimestamp: z.number().nullable(),
    newestTimestamp: z.number().nullable(),
    textBytesTotal: z.number(),
  }),
  conversationHistory: z.object({ turnCount: z.number(), summaryPresent: z.boolean() }),
  userIdentityMappings: z.record(z.string(), z.number()),
  stagedFiles: z.object({
    total: z.number(),
    byStatus: z.record(z.string(), z.number()),
    bytesTotal: z.number(),
  }),
  userBlock: z
    .object({
      addedAt: z.string().nullable(),
      addedByPresent: z.boolean(),
      kaneoWorkspacePresent: z.boolean(),
    })
    .nullable(),
  groupBlock: z
    .object({ memberCount: z.number(), distinctAddedBy: z.number(), observationCount: z.number() })
    .nullable(),
  webFetches: z.object({ totalRequests: z.number() }),
  llmUsage: z.object({
    rowCount: z.number(),
    inputTokensTotal: z.number(),
    outputTokensTotal: z.number(),
  }),
  toolCalls: z.object({
    total: z.number(),
    success: z.number(),
    failure: z.number(),
    topTools: z.array(z.object({ toolName: z.string(), count: z.number() })),
    errorTypeCounts: z.record(z.string(), z.number()),
  }),
})

const ErrorBodySchema = z.object({ error: z.string() })

const errorMessageFrom = (body: unknown, fallback: string): string => {
  const parsed = ErrorBodySchema.safeParse(body)
  return parsed.success ? parsed.data.error : fallback
}

const readBody = async (res: Response): Promise<unknown> => {
  try {
    return await res.json()
  } catch {
    return null
  }
}

const requireOk = (res: Response, body: unknown): void => {
  if (res.ok) return
  throw new Error(errorMessageFrom(body, `request failed with status ${res.status}`))
}

export const fetchStatsGlobal = async (window?: StatsWindow): Promise<GlobalStats> => {
  const path = window === undefined ? '/stats/global' : `/stats/global?window=${encodeURIComponent(window)}`
  const res = await fetch(path)
  const body = await readBody(res)
  requireOk(res, body)
  return GlobalStatsSchema.parse(body) as GlobalStats
}

export const fetchStatsSubject = async (storageContextId: string): Promise<SubjectStats> => {
  const res = await fetch(`/stats/subject/${encodeURIComponent(storageContextId)}`)
  const body = await readBody(res)
  requireOk(res, body)
  return SubjectStatsSchema.parse(body) as SubjectStats
}
