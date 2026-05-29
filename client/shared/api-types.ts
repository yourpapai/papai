// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ChatProviderTraits } from '../../src/chat/types.js'
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
import type { GlobalStats, StatsWindow, SubjectStats } from '../../src/stats/types.js'

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
  contextId: string
  providerName: string
  providerUserId: string | null
  providerUserLogin: string | null
  displayName: string | null
  matchedAt: string
  matchMethod: 'auto' | 'manual_nl' | 'unmatched' | null
  confidence: number | null
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

export type AdminChatProvider = 'telegram' | 'mattermost' | 'discord' | 'unknown'
export type AdminTaskProvider = 'kaneo' | 'youtrack' | 'unknown'

export type AdminSystemSummary = {
  chatProvider: AdminChatProvider
  taskProvider: AdminTaskProvider
  debugServer: boolean
  adminUserSet: boolean
}

export type InstanceConfigView = Record<string, string>

export type InstanceStatusView = 'pending' | 'active' | 'stopped'

export type PlatformInstanceView = {
  readonly id: string
  readonly type: 'telegram' | 'mattermost' | 'discord'
  readonly config: InstanceConfigView
  readonly status: InstanceStatusView
  readonly createdAt: string
}

export type TaskInstanceView = Readonly<{
  id: string
  type: string
  config: InstanceConfigView
  status: InstanceStatusView
  createdAt: string
  unresolvedReason: string | null
}> &
  Partial<Readonly<{ referencingContextIds: readonly string[]; referencingContextCount: number }>>

export type ProviderConfigRequirementView = {
  readonly key: string
  readonly label: string
  readonly required: boolean
  readonly sensitive: boolean
  readonly storageKey?: string
}

export type PlatformProviderTypeView = Readonly<{
  type: PlatformInstanceView['type']
  displayName: string
  instanceConfigSchema: readonly ProviderConfigRequirementView[]
  contextConfigSchema: readonly ProviderConfigRequirementView[]
  capabilities: readonly string[]
  traits: ChatProviderTraits
  source: 'builtin'
}>

export type TaskProviderTypeView = Readonly<{
  type: string
  displayName: string
  instanceConfigSchema: readonly ProviderConfigRequirementView[]
  contextConfigSchema: readonly ProviderConfigRequirementView[]
  capabilities: readonly string[]
  traits: readonly string[]
  source: 'builtin' | { readonly plugin: string }
}>

export type AdminInstanceView = Readonly<
  { userId: string; platformInstanceId: string } & Partial<{ createdAt: string }>
>

export type ApplyInstancesResult = { readonly applied: number }

export type AdminPluginConfigKeyState = {
  key: string
  label: string
  value: string | null
  sensitive: boolean
  required: boolean
}

export type AdminPluginConfigEntry = {
  pluginId: string
  keys: AdminPluginConfigKeyState[]
}

export type AdminPluginConfigSnapshot = {
  plugins: AdminPluginConfigEntry[]
}

export type SubmitAdminPluginConfigResponse = {
  ok: true
  pluginId: string
  key: string
  updatedAt: number
}
