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
  updateScopeFilter(scopes: Set<string>): void
  clearLogs(): void
  __state: DashboardState
}

declare global {
  interface Window {
    dashboard: DashboardAPI
  }
}
