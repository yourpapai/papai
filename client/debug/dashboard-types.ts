// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type {
  Session,
  SchedulerInfo,
  PollersInfo,
  MessageCacheInfo,
  LlmTrace,
  LogEntry,
  Turn,
  Notification,
  ToolFailure,
  RecurringTask,
  DeferredPrompt,
  Memo,
  IdentityMappingEntry,
  BillingWindow,
  BillingSubject,
  BillingDetail,
} from '../shared/api-types.js'
import type { ScopeCount } from './log-bootstrap.js'
import type { LogFilter } from './log-filter-url.js'

export type {
  Session,
  SchedulerInfo,
  PollersInfo,
  MessageCacheInfo,
  LlmTrace,
  LogEntry,
  Turn,
  Notification,
  ToolFailure,
  RecurringTask,
  DeferredPrompt,
  Memo,
  IdentityMappingEntry,
  BillingWindow,
  BillingSubject,
  BillingDetail,
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
  /**
   * Whether the SSE stream has ever opened. Until the first successful `open`,
   * the dashboard is "connecting" rather than "disconnected" — there is no prior
   * connection to reconnect from and no buffered data to flag as stale, so the
   * disconnect banner and stale-stat dimming are suppressed.
   */
  hasConnectedOnce: boolean
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
  activeLogFilter: LogFilter
  logScopeCounts: ScopeCount[]
  /** Set when the initial log bootstrap fetch failed; live SSE may still deliver events. */
  logsError?: string
  /** Platform user id of the signed-in operator, used to pin their own session. */
  operatorUserId?: string
}
