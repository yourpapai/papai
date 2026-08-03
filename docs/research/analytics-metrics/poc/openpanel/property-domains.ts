// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import {
  EVENT_PROP_ALLOWLIST,
  INTENT_V1_LABELS,
  type AnalyticsEventName,
  type EventProps,
} from '../fixture/fixture-contract.js'
import { FEATURES } from '../fixture/fixture-taxonomy.js'
import {
  booleanValue,
  byteBucket,
  confidenceBucket,
  count,
  countBucket,
  elapsedMs,
  errorClass,
  goals,
  integerBetween,
  lengthBucket,
  modelRole,
  nullable,
  oneOf,
  ordinal,
  pseudonym,
  risk,
  statusClass,
  tokenCount,
  toolKey,
  toolModelRole,
  toolSlug,
  utcDay,
  type PropertyValidator,
} from './property-domain-primitives.js'

type AllowedProperty<Name extends AnalyticsEventName> = (typeof EVENT_PROP_ALLOWLIST)[Name][number]
type EventPropertyValidators = {
  readonly [Name in AnalyticsEventName]: Readonly<Record<AllowedProperty<Name>, PropertyValidator>>
}

const PROPERTY_VALIDATORS = {
  chat_message_accepted: {
    input_count: countBucket,
    length_bucket: lengthBucket,
    attachment_count: countBucket,
    is_command: booleanValue,
    command: oneOf(['start', 'config', 'help', 'context', 'dashboard', 'clear', 'stop', 'acp', 'other', 'none']),
  },
  auth_checked: {
    outcome: oneOf(['granted', 'denied']),
    reason: oneOf([
      'admin',
      'member',
      'open_dm',
      'guest_mode',
      'blocked',
      'group_unauthorized',
      'unknown_user',
      'other',
    ]),
  },
  turn_started: {
    incoming_message_count: countBucket,
    attachment_count: countBucket,
    queue_wait_ms: elapsedMs,
  },
  turn_completed: {
    outcome: oneOf(['ok', 'llm_error', 'forced_stop', 'graceful_stop', 'configuration_block']),
    duration_ms: elapsedMs,
    step_count: count,
    tool_call_count: count,
    reply_count: countBucket,
    finish_reason: oneOf(['stop', 'length', 'tool_calls', 'content_filter', 'error', 'other', 'unknown']),
    clarification: booleanValue,
    live_status_used: booleanValue,
  },
  reply_sent: {
    latency_ms: elapsedMs,
    part_count: countBucket,
    length_bucket: lengthBucket,
    delivery: oneOf(['success', 'partial', 'failed']),
  },
  llm_started: {
    attempt_key: pseudonym,
    model_key: pseudonym,
    model_role: modelRole,
    phase: oneOf(['generation', 'embedding', 'distillation', 'verification', 'classification']),
    message_count: countBucket,
    available_tool_count: countBucket,
  },
  llm_completed: {
    attempt_key: pseudonym,
    model_key: pseudonym,
    model_role: modelRole,
    duration_ms: elapsedMs,
    time_to_first_token_ms: nullable(elapsedMs),
    input_tokens: nullable(tokenCount),
    output_tokens: nullable(tokenCount),
    step_count: count,
    finish_reason: oneOf(['stop', 'length', 'tool_calls', 'content_filter', 'other', 'unknown']),
  },
  llm_failed: {
    attempt_key: pseudonym,
    model_key: pseudonym,
    model_role: modelRole,
    phase: oneOf(['resolution', 'request', 'stream', 'embedding', 'distillation', 'verification', 'classification']),
    error_class: errorClass,
    retryable: nullable(booleanValue),
    duration_ms: elapsedMs,
  },
  tool_started: {
    tool_slug: toolSlug,
    tool_key: toolKey,
    origin: oneOf(['core', 'first_party_plugin', 'external_plugin', 'user_mcp']),
    domain: oneOf(['task', 'memo', 'schedule', 'attachment', 'web', 'identity', 'coding', 'config', 'meta', 'other']),
    risk,
    model_role: toolModelRole,
    args_bytes: byteBucket,
  },
  tool_completed: {
    tool_slug: toolSlug,
    tool_key: toolKey,
    origin: oneOf(['core', 'first_party_plugin', 'external_plugin', 'user_mcp']),
    domain: oneOf(['task', 'memo', 'schedule', 'attachment', 'web', 'identity', 'coding', 'config', 'meta', 'other']),
    risk,
    model_role: toolModelRole,
    args_bytes: byteBucket,
    duration_ms: elapsedMs,
    execution_outcome: oneOf(['semantic_success', 'structured_failure', 'thrown_failure', 'permission_denied']),
    result_bytes: byteBucket,
    error_class: nullable(errorClass),
    status_class: statusClass,
    retryable: nullable(booleanValue),
    recovered_same_turn: booleanValue,
  },
  confirmation_requested: {
    tool_slug: toolSlug,
    tool_key: toolKey,
    risk,
    timeout_ms: integerBetween(300_000, 300_000),
  },
  confirmation_resolved: {
    tool_slug: toolSlug,
    tool_key: toolKey,
    decision: oneOf(['granted', 'denied', 'ignored', 'prompt_failed']),
    decision_latency_ms: elapsedMs,
  },
  turn_steered: { ordinal, length_bucket: lengthBucket, ack_sent: booleanValue },
  turn_stop_requested: { stage: oneOf(['graceful', 'forced']) },
  clarification_requested: {
    reason: oneOf([
      'missing_required_input',
      'ambiguous_target',
      'ambiguous_action',
      'permission',
      'configuration',
      'other',
    ]),
  },
  rephrase_detected: {
    detector: oneOf(['lexical_v1', 'small_model_v1']),
    similarity: oneOf(['080_089', '090_094', 'ge_095']),
    prior_outcome: oneOf(['clarification', 'failure', 'no_action']),
    gap: oneOf(['le_2m', '2m_10m']),
  },
  clarification_abandoned: { observation_hours: integerBetween(24, 24) },
  disclosure_fallback: {
    reason: oneOf(['no_real_load', 'meta_tool_churn']),
    step_bucket: oneOf(['1_2', '3_5', '6_plus']),
  },
  config_link_issued: { result: oneOf(['issued', 'not_configured', 'rate_limited']) },
  settings_opened: {
    entry: oneOf(['config_link', 'existing_session']),
    result: oneOf(['success', 'expired', 'invalid']),
  },
  task_instance_assigned: {
    change: oneOf(['first_assignment', 'changed']),
    from_provider: oneOf(['kaneo', 'youtrack', 'none', 'other']),
    to_provider: oneOf(['kaneo', 'youtrack', 'other']),
  },
  intent_classified: {
    taxonomy: oneOf(['intent.v1']),
    primary: oneOf(INTENT_V1_LABELS),
    goals,
    confidence: confidenceBucket,
    strategy: oneOf(['tool_trace_v1', 'metadata_v1', 'small_model_v1', 'hybrid_v1']),
    abstained: booleanValue,
  },
  feature_opportunity: {
    feature: oneOf(FEATURES),
    available: booleanValue,
    reason: oneOf([
      'available',
      'capability_missing',
      'provider_missing',
      'role_denied',
      'configuration_missing',
      'platform_unsupported',
      'other',
    ]),
    sampling: oneOf(['first_eligible_actor_day']),
  },
  feature_used: {
    feature: oneOf(FEATURES),
    operation: oneOf([
      'create',
      'read',
      'search',
      'update',
      'delete',
      'start',
      'continue',
      'monitor',
      'review',
      'finish',
      'enable',
    ]),
    outcome: oneOf(['success', 'failure', 'blocked']),
    coding_project_key: nullable(pseudonym),
    coding_session_key: nullable(pseudonym),
  },
  first_visible_feedback: {
    kind: oneOf(['typing', 'live_status', 'steer_ack', 'none']),
    outcome: oneOf(['success', 'failed', 'missing', 'not_applicable']),
    capability_supported: booleanValue,
    setting_enabled: booleanValue,
    latency_ms: nullable(elapsedMs),
  },
  live_status_opportunity: {
    eligible: booleanValue,
    reason: oneOf(['eligible', 'platform_unsupported', 'disabled', 'turn_too_short', 'no_status_surface']),
  },
  live_status_lifecycle: {
    stage: oneOf(['create', 'update', 'dismiss']),
    outcome: oneOf(['success', 'failed']),
    latency_from_turn_start_ms: elapsedMs,
    ordinal,
  },
  provider_request_completed: {
    provider: oneOf(['kaneo', 'youtrack', 'magi', 'mcp', 'llm', 'other']),
    operation: oneOf(['read', 'search', 'create', 'update', 'delete', 'connect', 'stream', 'other']),
    duration_ms: elapsedMs,
    outcome: oneOf(['success', 'failure']),
    status_class: statusClass,
    retryable: nullable(booleanValue),
  },
  rate_limit_blocked: { limit: oneOf(['web_fetch', 'settings_link', 'provider', 'other']) },
  unconfigured_reply: {
    missing: oneOf([
      'central_llm',
      'task_instance',
      'settings_base_url',
      'provider_credentials',
      'coding_credentials',
      'forge_credentials',
      'other',
    ]),
    surface: oneOf(['chat', 'settings', 'coding']),
  },
  mcp_availability: {
    origin: oneOf(['user_endpoint', 'plugin_endpoint', 'coding_broker']),
    server_key: pseudonym,
    outcome: oneOf(['available', 'connection_failed', 'timeout', 'auth_failed', 'policy_blocked']),
  },
  guest_turn_aggregate: {
    utc_day: utcDay,
    turns: count,
    successful_turns: count,
    failed_turns: count,
    contexts: countBucket,
  },
} satisfies EventPropertyValidators

export function validateControlledEventProps(eventName: AnalyticsEventName, props: EventProps): readonly string[] {
  const validators: Readonly<Record<string, PropertyValidator>> = PROPERTY_VALIDATORS[eventName]
  return Object.entries(props).flatMap(([property, value]) =>
    validators[property]?.(value) === true
      ? []
      : [`property ${property} is outside the controlled domain for ${eventName}`],
  )
}
