// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type StatsWindow = '1d' | '7d' | '30d' | 'all'

export type StatsContextType = 'dm' | 'group' | 'unknown'

export interface Percentiles {
  count: number
  min: number
  p50: number
  p90: number
  p99: number
  max: number
  mean: number
}

export interface GlobalStatsOptions {
  window?: StatsWindow
  noCache?: boolean
}

export interface MemoStats {
  total: number
  byStatus: Record<string, number>
  tagCardinality: { distinct: number; meanPerMemo: number }
  contentBytesTotal: number
  embeddingBytesTotal: number
  withEmbedding: number
  oldestCreatedAt: number | null
  newestCreatedAt: number | null
}

export interface ScheduledPromptStats {
  total: number
  byStatus: Record<string, number>
  distinctDeliveryTargets: number
}

export interface AlertPromptStats {
  total: number
  byStatus: Record<string, number>
}

export interface RecurringTaskStats {
  total: number
  enabled: number
  disabled: number
  distinctProjects: number
  nextRunWithin7d: number
  distinctRrulePatterns: number
}

export interface InstructionStats {
  total: number
  textBytesTotal: number
}

export interface AttachmentStats {
  total: number
  byStatus: Record<string, number>
  bySourceProvider: Record<string, number>
  storedBytesTotal: number
  active: number
  byExtension: Record<string, number>
}

export interface MessageMetadataStats {
  total: number
  authoredBySubject: number
  oldestTimestamp: number | null
  newestTimestamp: number | null
  textBytesTotal: number
}

export interface ConversationStats {
  turnCount: number
  summaryPresent: boolean
}

export interface StagedFileStats {
  total: number
  byStatus: Record<string, number>
  bytesTotal: number
}

export interface UserBlockStats {
  addedAt: string | null
  addedByPresent: boolean
  kaneoWorkspacePresent: boolean
}

export interface GroupBlockStats {
  memberCount: number
  distinctAddedBy: number
  observationCount: number
}

export interface WebFetchSubjectStats {
  totalRequests: number
}

export interface LlmUsageSubjectStats {
  rowCount: number
  inputTokensTotal: number
  outputTokensTotal: number
}

export interface ToolCallSubjectStats {
  total: number
  success: number
  failure: number
  topTools: Array<{ toolName: string; count: number }>
  errorTypeCounts: Record<string, number>
}

export interface SubjectStats {
  storageContextId: string
  chatUserId: string | null
  contextType: StatsContextType
  displayName: string | null
  memos: MemoStats
  scheduledPrompts: ScheduledPromptStats
  alertPrompts: AlertPromptStats
  recurringTasks: RecurringTaskStats
  userInstructions: InstructionStats
  attachments: AttachmentStats
  messageMetadata: MessageMetadataStats
  conversationHistory: ConversationStats
  userIdentityMappings: Record<string, number>
  stagedFiles: StagedFileStats
  userBlock: UserBlockStats | null
  groupBlock: GroupBlockStats | null
  webFetches: WebFetchSubjectStats
  llmUsage: LlmUsageSubjectStats
  toolCalls: ToolCallSubjectStats
}

export interface SubjectGrowthPoint {
  date: string
  dmAdded: number
  groupAdded: number
}

export interface ActiveSubjectCounts {
  activeIn1d: number
  activeIn7d: number
  activeIn30d: number
}

export interface GlobalDistributions {
  memosPerSubject: Percentiles
  recurringTasksPerSubject: Percentiles
  messageMetadataPerSubject: Percentiles
  attachmentBytesPerSubject: Percentiles
}

export interface StorageFootprint {
  sqliteBytes: number
  s3AttachmentBytes: number
}

export interface IdentityMixStats {
  byProvider: Record<string, number>
  kaneoWorkspaces: number
}

export interface SurfaceMixStats {
  subjectsWithRecurring: number
  subjectsWithDeferred: number
  subjectsWithMemos: number
  subjectsWithInstructions: number
}

export interface WebFetchHostsGlobal {
  topHosts: Array<{ hostHash: string; count: number }>
}

export interface ToolMixGlobal {
  topTools: Array<{ toolName: string; count: number; successRate: number }>
  errorTypeCounts: Record<string, number>
}

export interface LlmUsageGlobal {
  totalCalls: number
  mainCalls: number
  smallCalls: number
  embeddingCalls: number
  inputTokensTotal: number
  outputTokensTotal: number
}

export interface GlobalSubjects {
  dmTotal: number
  groupTotal: number
  growthLast30d: SubjectGrowthPoint[]
}

export interface GlobalStats {
  generatedAt: number
  window: StatsWindow
  subjects: GlobalSubjects
  active: ActiveSubjectCounts
  distributions: GlobalDistributions
  storage: StorageFootprint
  identityMix: IdentityMixStats
  surfaceMix: SurfaceMixStats
  webFetches: WebFetchHostsGlobal
  toolMix: ToolMixGlobal
  llmUsage: LlmUsageGlobal
}
