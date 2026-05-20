// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type {
  Fact,
  Instruction,
  Session,
  Wizard,
  SchedulerInfo,
  PollersInfo,
  MessageCacheInfo,
  TokenInfo,
  ToolCall,
  LlmTrace,
  LogEntry,
  StateInitEvent,
  StateStatsEvent,
  CacheEvent,
  UserIdEvent,
  SchedulerTickEvent,
  PollerEvent,
  MessageCacheEvent,
  Turn,
  Notification,
  ToolFailure,
} from '../../src/debug/schemas.js'

export type {
  Fact,
  Instruction,
  Session,
  Wizard,
  SchedulerInfo,
  PollersInfo,
  MessageCacheInfo,
  TokenInfo,
  ToolCall,
  LlmTrace,
  LogEntry,
  StateInitEvent,
  StateStatsEvent,
  CacheEvent,
  UserIdEvent,
  SchedulerTickEvent,
  PollerEvent,
  MessageCacheEvent,
  Turn,
  Notification,
  ToolFailure,
}

export type RecurringTask = {
  id: string
  userId: string
  title: string
  rrule: string | null
  nextRun: string | null
  enabled: boolean
  lastRun: string | null
}

export type DeferredPrompt = {
  id: string
  createdByUserId: string
  prompt: string
  fireAt: string
  rrule: string | null
  status: string
}

export type Memo = {
  id: string
  userId: string
  content: string
  summary: string | null
  tags: readonly string[]
  status: string
  createdAt: string
  updatedAt: string
}

export type IdentityMappingEntry = {
  userId: string
  provider: string
  providerUserId: string | null
  providerUserLogin: string | null
  displayName: string | null
}

export type AuthorizedGroupEntry = {
  group_id: string
  added_by: string
  added_at: string
}

export type BillingWindow = '24h' | '7d' | '30d' | 'all'

export type BillingRoleTotals = {
  inputTokens: number
  outputTokens: number
  calls: number
}

export type BillingSubject = {
  storageContextId: string
  contextType: 'dm' | 'group'
  displayName: string | null
  totals: {
    main: BillingRoleTotals
    small: BillingRoleTotals
    embedding: BillingRoleTotals
  }
  toolCalls: number
  lastActiveAt: number
}

export type BillingRequestRow = {
  eventId: string
  occurredAt: number
  turnId: string | null
  chatUserId: string
  model: string
  modelRole: 'main' | 'small' | 'embedding'
  inputTokens: number | null
  outputTokens: number | null
  stepCount: number
  toolCallCount: number
  messageCount: number
  durationMs: number
  finishReason: string | null
  error: string | null
}

export type BillingDetail = {
  subject: BillingSubject
  requests: readonly BillingRequestRow[]
  truncated: boolean
}

export type AdminLlmKeyState = {
  value: string | null
  updatedAt: number | null
  updatedBy: string | null
}

export type AdminLlmSnapshot = {
  llm_apikey: AdminLlmKeyState
  llm_baseurl: AdminLlmKeyState
  main_model: AdminLlmKeyState
  small_model: AdminLlmKeyState
  embedding_model: AdminLlmKeyState
}

/**
 * Dashboard-specific wizard type that supports "unset" values for partial updates.
 * Uses '---' to indicate fields that haven't been received from the server yet.
 */
export type DashboardWizard = {
  userId: string
  currentStep: number | '---'
  totalSteps: number | '---'
}

export interface DashboardStats {
  startedAt: number
  totalMessages: number
  totalLlmCalls: number
  totalToolCalls: number
}

export interface DashboardState {
  connected: boolean
  stats: DashboardStats
  sessions: Map<string, Session>
  wizards: Map<string, DashboardWizard>
  scheduler: SchedulerInfo
  pollers: PollersInfo
  messageCache: MessageCacheInfo
  llmTraces: LlmTrace[]
  logs: LogEntry[]
  logScopes: Set<string>
  turns: Turn[]
  notifications: Notification[]
  toolFailures: ToolFailure[]
  recurringTasks: RecurringTask[]
  deferredPrompts: DeferredPrompt[]
  memos: Memo[]
  identityMappings: Map<string, IdentityMappingEntry>
  activeConfigEditors: Set<string>
  authorizedGroups: AuthorizedGroupEntry[]
  activeContext: string
  activeLogFilter: { turnId?: string }
  billingWindow: BillingWindow
  billingSubjects: BillingSubject[]
  billingDetail: BillingDetail | null
  adminLlm: AdminLlmSnapshot | null
}
