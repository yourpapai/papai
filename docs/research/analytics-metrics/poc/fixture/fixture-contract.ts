// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export const FIXTURE_DAY_COUNT = 50
export const FIXTURE_ACTOR_COUNT = 200
export const FIXTURE_BASE_TIME_MS = Date.UTC(2026, 4, 1)
export const FIXTURE_SEED = 'papai-analytics-fixture-v1'

export const PLATFORMS = ['telegram', 'mattermost', 'discord', 'kontur-talk'] as const
export const CONTEXT_TYPES = ['dm', 'group', 'none'] as const
export const ACTOR_ROLES = ['admin', 'member', 'guest', 'system'] as const
export const TASK_PROVIDERS = ['kaneo', 'youtrack', 'none', 'other'] as const
export const INVOCATION_MODES = ['normal', 'command', 'settings', 'proactive', 'scheduler'] as const

export const INTENT_V1_LABELS = [
  'task.create',
  'task.find_list',
  'task.read_detail',
  'task.update_fields',
  'task.change_state',
  'task.collaborate',
  'task.delete',
  'project_schema.manage',
  'recurring.manage',
  'deferred.manage',
  'memory_memo.write',
  'memory_memo.find',
  'attachment.manage',
  'web.retrieve',
  'identity_participant.manage',
  'coding.start_review',
  'coding.monitor_control',
  'coding.continue_publish',
  'configuration_permissions',
  'help_context',
  'no_action',
  'unknown',
  'multi_goal',
] as const

export const EVENT_PROP_ALLOWLIST = {
  chat_message_accepted: ['input_count', 'length_bucket', 'attachment_count', 'is_command', 'command'],
  auth_checked: ['outcome', 'reason'],
  turn_started: ['incoming_message_count', 'attachment_count', 'queue_wait_ms'],
  turn_completed: [
    'outcome',
    'duration_ms',
    'step_count',
    'tool_call_count',
    'reply_count',
    'finish_reason',
    'clarification',
    'live_status_used',
  ],
  reply_sent: ['latency_ms', 'part_count', 'length_bucket', 'delivery'],
  llm_started: ['attempt_key', 'model_key', 'model_role', 'phase', 'message_count', 'available_tool_count'],
  llm_completed: [
    'attempt_key',
    'model_key',
    'model_role',
    'duration_ms',
    'time_to_first_token_ms',
    'input_tokens',
    'output_tokens',
    'step_count',
    'finish_reason',
  ],
  llm_failed: ['attempt_key', 'model_key', 'model_role', 'phase', 'error_class', 'retryable', 'duration_ms'],
  tool_started: ['tool_slug', 'tool_key', 'origin', 'domain', 'risk', 'model_role', 'args_bytes'],
  tool_completed: [
    'tool_slug',
    'tool_key',
    'origin',
    'domain',
    'risk',
    'model_role',
    'args_bytes',
    'duration_ms',
    'execution_outcome',
    'result_bytes',
    'error_class',
    'status_class',
    'retryable',
    'recovered_same_turn',
  ],
  confirmation_requested: ['tool_slug', 'tool_key', 'risk', 'timeout_ms'],
  confirmation_resolved: ['tool_slug', 'tool_key', 'decision', 'decision_latency_ms'],
  turn_steered: ['ordinal', 'length_bucket', 'ack_sent'],
  turn_stop_requested: ['stage'],
  clarification_requested: ['reason'],
  rephrase_detected: ['detector', 'similarity', 'prior_outcome', 'gap'],
  clarification_abandoned: ['observation_hours'],
  disclosure_fallback: ['reason', 'step_bucket'],
  config_link_issued: ['result'],
  settings_opened: ['entry', 'result'],
  task_instance_assigned: ['change', 'from_provider', 'to_provider'],
  intent_classified: ['taxonomy', 'primary', 'goals', 'confidence', 'strategy', 'abstained'],
  feature_opportunity: ['feature', 'available', 'reason', 'sampling'],
  feature_used: ['feature', 'operation', 'outcome', 'coding_project_key', 'coding_session_key'],
  first_visible_feedback: ['kind', 'outcome', 'capability_supported', 'setting_enabled', 'latency_ms'],
  live_status_opportunity: ['eligible', 'reason'],
  live_status_lifecycle: ['stage', 'outcome', 'latency_from_turn_start_ms', 'ordinal'],
  provider_request_completed: ['provider', 'operation', 'duration_ms', 'outcome', 'status_class', 'retryable'],
  rate_limit_blocked: ['limit'],
  unconfigured_reply: ['missing', 'surface'],
  mcp_availability: ['origin', 'server_key', 'outcome'],
  guest_turn_aggregate: ['utc_day', 'turns', 'successful_turns', 'failed_turns', 'contexts'],
} as const

export type AnalyticsEventName = keyof typeof EVENT_PROP_ALLOWLIST
export type Platform = (typeof PLATFORMS)[number]
export type ContextType = (typeof CONTEXT_TYPES)[number]
export type ActorRole = (typeof ACTOR_ROLES)[number]
export type TaskProvider = (typeof TASK_PROVIDERS)[number]
export type InvocationMode = (typeof INVOCATION_MODES)[number]
export type IntentV1 = (typeof INTENT_V1_LABELS)[number]
export type JsonScalar = string | number | boolean | null
export type EventProps = Readonly<Record<string, JsonScalar | readonly string[]>>

export interface AnalyticsEvent {
  readonly eventId: string
  readonly schemaName: 'papai.analytics.event'
  readonly schemaVersion: 1
  readonly eventVersion: 1
  readonly occurredAtMs: number
  readonly ingestedAtMs: number
  readonly eventName: AnalyticsEventName
  readonly eventSource: 'live' | 'backfill'
  readonly attributionQuality: 'native' | 'backfill_snapshot' | 'unknown'
  readonly appVersion: string
  readonly deploymentKey: string
  readonly keyVersion: number
  readonly platform: Platform
  readonly platformInstanceKey: string
  readonly actorKey: string | null
  readonly contextKey: string | null
  readonly threadKey: string | null
  readonly taskInstanceKey: string | null
  readonly contextType: ContextType
  readonly actorRole: ActorRole
  readonly taskProvider: TaskProvider
  readonly invocationMode: InvocationMode
  readonly turnKey: string | null
  readonly sessionKey: string | null
  readonly governancePurpose: 'product_analytics'
  readonly collectionTier: 'aggregate' | 'pseudonymous'
  readonly policyVersion: 1
  readonly eligibility: 'allowed' | 'operator_basis' | 'not_applicable'
  readonly privacyMaxClass: 'C0' | 'C1' | 'C2'
  readonly expiresAtMs: number
  readonly props: EventProps
}
