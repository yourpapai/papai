// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import type { GlobalStats, StatsWindow, SubjectStats } from '../../src/stats/types.js'
import type {
  AdminLlmSnapshot,
  AdminSystemSummary,
  BillingDetail,
  BillingSubject,
  BillingWindow,
} from '../shared/api-types.js'
import { readBody, requireOk } from '../shared/fetcher-helpers.js'

const BillingRoleTotalsSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  calls: z.number(),
})

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

const BillingSubjectSchema = z.object({
  storageContextId: z.string(),
  contextType: z.enum(['dm', 'group']),
  displayName: z.string().nullable(),
  totals: z.object({
    main: BillingRoleTotalsSchema,
    small: BillingRoleTotalsSchema,
    embedding: BillingRoleTotalsSchema,
  }),
  toolCalls: z.number(),
  lastActiveAt: z.number(),
})

const BillingRequestRowSchema = z.object({
  eventId: z.string(),
  occurredAt: z.number(),
  turnId: z.string().nullable(),
  chatUserId: z.string(),
  model: z.string(),
  modelRole: z.enum(['main', 'small', 'embedding']),
  inputTokens: z.number().nullable(),
  outputTokens: z.number().nullable(),
  stepCount: z.number(),
  toolCallCount: z.number(),
  messageCount: z.number(),
  durationMs: z.number(),
  finishReason: z.string().nullable(),
  error: z.string().nullable(),
})

const BillingWindowSchema = z.enum(['24h', '7d', '30d', 'all'])

const BillingSubjectsResponseSchema = z.object({
  window: BillingWindowSchema,
  subjects: z.array(BillingSubjectSchema),
})

const BillingDetailResponseSchema = z.object({
  window: BillingWindowSchema,
  subject: BillingSubjectSchema,
  requests: z.array(BillingRequestRowSchema),
  truncated: z.boolean(),
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

const AdminLlmKeyStateSchema = z.object({
  value: z.string().nullable(),
  updatedAt: z.number().nullable(),
  updatedBy: z.string().nullable(),
})

const AdminLlmSnapshotSchema = z.object({
  llm_apikey: AdminLlmKeyStateSchema,
  llm_baseurl: AdminLlmKeyStateSchema,
  main_model: AdminLlmKeyStateSchema,
  small_model: AdminLlmKeyStateSchema,
  embedding_model: AdminLlmKeyStateSchema,
})

const AdminChatProviderSchema = z.enum(['telegram', 'mattermost', 'discord', 'unknown'])
const AdminTaskProviderSchema = z.enum(['kaneo', 'youtrack', 'unknown'])

const AdminSystemSummarySchema = z.object({
  chatProvider: AdminChatProviderSchema,
  taskProvider: AdminTaskProviderSchema,
  debugServer: z.boolean(),
  adminUserSet: z.boolean(),
})

const AdminLlmKeySchema = z.enum(['llm_apikey', 'llm_baseurl', 'main_model', 'small_model', 'embedding_model'])

const SubmitAdminLlmResponseSchema = z.object({
  ok: z.literal(true),
  key: AdminLlmKeySchema,
  updatedAt: z.number(),
})

export type SubmitAdminLlmInput = {
  readonly key: z.infer<typeof AdminLlmKeySchema>
  readonly value: string
}

export type SubmitAdminLlmResult = z.infer<typeof SubmitAdminLlmResponseSchema>

export type FetchBillingSubjectsResult = {
  readonly window: BillingWindow
  readonly subjects: BillingSubject[]
}

export type FetchBillingDetailResult = BillingDetail & { readonly window: BillingWindow }

export const fetchStatsGlobal = async (window: StatsWindow | undefined): Promise<GlobalStats> => {
  const path = window === undefined ? '/stats/global' : `/stats/global?window=${encodeURIComponent(window)}`
  const res = await fetch(path)
  const body = await readBody(res)
  requireOk(res, body)
  return GlobalStatsSchema.parse(body) as GlobalStats
}

export const fetchBillingSubjects = async (window: BillingWindow): Promise<FetchBillingSubjectsResult> => {
  const res = await fetch(`/billing/subjects?window=${encodeURIComponent(window)}`)
  const body = await readBody(res)
  requireOk(res, body)
  return BillingSubjectsResponseSchema.parse(body)
}

export const fetchBillingDetail = async (
  storageContextId: string,
  window: BillingWindow,
): Promise<FetchBillingDetailResult> => {
  const path = `/billing/subject/${encodeURIComponent(storageContextId)}?window=${encodeURIComponent(window)}`
  const res = await fetch(path)
  const body = await readBody(res)
  requireOk(res, body)
  return BillingDetailResponseSchema.parse(body)
}

export const fetchStatsSubject = async (storageContextId: string): Promise<SubjectStats> => {
  const res = await fetch(`/stats/subject/${encodeURIComponent(storageContextId)}`)
  const body = await readBody(res)
  requireOk(res, body)
  return SubjectStatsSchema.parse(body) as SubjectStats
}

export const fetchAdminLlm = async (): Promise<AdminLlmSnapshot> => {
  const res = await fetch('/admin/llm')
  const body = await readBody(res)
  requireOk(res, body)
  return AdminLlmSnapshotSchema.parse(body)
}

export const submitAdminLlm = async (input: SubmitAdminLlmInput): Promise<SubmitAdminLlmResult> => {
  const res = await fetch('/admin/llm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const body = await readBody(res)
  requireOk(res, body)
  return SubmitAdminLlmResponseSchema.parse(body)
}

export const fetchAdminSystem = async (): Promise<AdminSystemSummary> => {
  const res = await fetch('/admin/system')
  const body = await readBody(res)
  requireOk(res, body)
  return AdminSystemSummarySchema.parse(body)
}
