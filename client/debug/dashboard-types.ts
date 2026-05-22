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
  GlobalStats,
  StatsWindow,
  SubjectStats,
  RecurringTask,
  DeferredPrompt,
  Memo,
  IdentityMappingEntry,
  AuthorizedGroupEntry,
  BillingWindow,
  BillingRoleTotals,
  BillingSubject,
  BillingRequestRow,
  BillingDetail,
  AdminLlmKeyState,
  AdminLlmSnapshot,
} from '../shared/api-types.js'

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
  GlobalStats,
  StatsWindow,
  SubjectStats,
  RecurringTask,
  DeferredPrompt,
  Memo,
  IdentityMappingEntry,
  AuthorizedGroupEntry,
  BillingWindow,
  BillingRoleTotals,
  BillingSubject,
  BillingRequestRow,
  BillingDetail,
  AdminLlmKeyState,
  AdminLlmSnapshot,
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

export type ScopeFilter = 'all' | 'dm' | 'group'

export type SelectedDetail =
  | { kind: 'turn'; payload: Turn }
  | { kind: 'trace'; payload: LlmTrace }
  | { kind: 'session'; payload: { userId: string; session: Session } }
  | { kind: 'log'; payload: { entry: LogEntry; index: number } }
  | { kind: 'failure'; payload: ToolFailure }
  | null

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
  activeConfigEditors: Set<string>
  scopeFilter: ScopeFilter
  selectedDetail: SelectedDetail
  activeLogFilter: { turnId?: string }
}
