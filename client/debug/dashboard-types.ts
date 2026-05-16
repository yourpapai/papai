// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/// <reference lib="dom" />

// Import all types from schemas to ensure TypeScript interfaces are inferred from Zod schemas
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

// Re-export all types
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

/**
 * Recurring task type for dashboard display
 */
export type RecurringTask = {
  id: string
  userId: string
  title: string
  rrule: string | null
  nextRun: string | null
  enabled: boolean
  lastRun: string | null
}

/**
 * Deferred prompt type for dashboard display
 */
export type DeferredPrompt = {
  id: string
  createdByUserId: string
  prompt: string
  fireAt: string
  rrule: string | null
  status: string
}

/**
 * Memo type for dashboard display
 */
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

/**
 * Identity mapping type for dashboard display
 */
export type IdentityMappingEntry = {
  userId: string
  provider: string
  providerUserId: string | null
  providerUserLogin: string | null
  displayName: string | null
}

/**
 * Authorized group type for dashboard display
 */
export type AuthorizedGroupEntry = {
  group_id: string
  added_by: string
  added_at: string
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

/**
 * Dashboard state object exposed on window for render functions
 */
export interface DashboardState {
  connected: boolean
  stats: {
    startedAt: number
    totalMessages: number
    totalLlmCalls: number
    totalToolCalls: number
  }
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
}

/**
 * Dashboard API functions exposed on window
 */
export interface DashboardAPI {
  renderConnection(connected: boolean): void
  renderStats(stats: DashboardState['stats']): void
  renderInfra(scheduler: SchedulerInfo, pollers: PollersInfo, messageCache: MessageCacheInfo): void
  renderSessions(sessions: Map<string, Session>, wizards: Map<string, DashboardWizard>): void
  renderTraces(traces: LlmTrace[]): void
  renderLogs(): void
  renderTurns(): void
  renderNotifications(): void
  renderToolFailures(): void
  renderReminders(): void
  renderMemos(): void
  renderContext(): void
  updateScopeFilter(scopes: Set<string>): void
  clearLogs(): void
  __state: DashboardState
}

declare global {
  interface Window {
    dashboard: DashboardAPI
  }
}
