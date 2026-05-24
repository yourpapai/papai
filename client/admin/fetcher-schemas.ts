// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

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

export const GlobalStatsSchema = z.object({
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
  llmUsage: z.object({
    totalCalls: z.number(),
    mainCalls: z.number(),
    smallCalls: z.number(),
    embeddingCalls: z.number(),
    inputTokensTotal: z.number(),
    outputTokensTotal: z.number(),
  }),
})

export const BillingSubjectSchema = z.object({
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

export const BillingWindowSchema = z.enum(['24h', '7d', '30d', 'all'])

export const BillingSubjectsResponseSchema = z.object({
  window: BillingWindowSchema,
  subjects: z.array(BillingSubjectSchema),
})

export const BillingDetailResponseSchema = z.object({
  window: BillingWindowSchema,
  subject: BillingSubjectSchema,
  requests: z.array(BillingRequestRowSchema),
  truncated: z.boolean(),
})

const StatsContextTypeSchema = z.enum(['dm', 'group', 'unknown'])

export const SubjectStatsSchema = z.object({
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

export const AdminLlmSnapshotSchema = z.object({
  llm_apikey: AdminLlmKeyStateSchema,
  llm_baseurl: AdminLlmKeyStateSchema,
  main_model: AdminLlmKeyStateSchema,
  small_model: AdminLlmKeyStateSchema,
  embedding_model: AdminLlmKeyStateSchema,
})
const AdminChatProviderSchema = z.enum(['telegram', 'mattermost', 'discord', 'unknown'])
const AdminTaskProviderSchema = z.enum(['kaneo', 'youtrack', 'unknown'])
export const AdminSystemSummarySchema = z.object({
  chatProvider: AdminChatProviderSchema,
  taskProvider: AdminTaskProviderSchema,
  debugServer: z.boolean(),
  adminUserSet: z.boolean(),
})
export * from './instance-fetcher-schemas.js'
const AdminLlmKeySchema = z.enum(['llm_apikey', 'llm_baseurl', 'main_model', 'small_model', 'embedding_model'])
export const SubmitAdminLlmResponseSchema = z.object({
  ok: z.literal(true),
  key: AdminLlmKeySchema,
  updatedAt: z.number(),
})

export const RecurringTaskSchema = z.object({
  id: z.string(),
  userId: z.string(),
  title: z.string(),
  rrule: z.string().nullable(),
  nextRun: z.string().nullable(),
  enabled: z.boolean(),
  lastRun: z.string().nullable(),
})

export const DeferredPromptSchema = z.object({
  id: z.string(),
  createdByUserId: z.string(),
  prompt: z.string(),
  fireAt: z.string(),
  rrule: z.string().nullable(),
  status: z.string(),
})

export const MemoSchema = z.object({
  id: z.string(),
  userId: z.string(),
  content: z.string(),
  summary: z.string().nullable(),
  tags: z.array(z.string()),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const IdentityMappingEntrySchema = z.object({
  contextId: z.string(),
  providerName: z.string(),
  providerUserId: z.string().nullable(),
  providerUserLogin: z.string().nullable(),
  displayName: z.string().nullable(),
  matchedAt: z.string(),
  matchMethod: z.enum(['auto', 'manual_nl', 'unmatched']).nullable(),
  confidence: z.number().nullable(),
})

export const AuthorizedGroupEntrySchema = z.object({
  group_id: z.string(),
  added_by: z.string(),
  added_at: z.string(),
})

export type SubmitAdminLlmKey = z.infer<typeof AdminLlmKeySchema>

export const RecentRequestRowSchema = z.object({
  ts: z.number(),
  modelLabel: z.string(),
  role: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  finishStatus: z.string(),
})

export const RecentRequestsResponseSchema = z.object({
  subjectId: z.string(),
  limit: z.number(),
  requests: z.array(RecentRequestRowSchema),
})

export type RecentRequestRow = z.infer<typeof RecentRequestRowSchema>
