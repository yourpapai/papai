// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { AggregateCounterV1, AggregateHistogramV1, EventNameV1 } from './controlled-types.js'

export type PrivacyClassV1 = 'C0' | 'C1' | 'C2'
export type SourceFamilyV1 =
  | 'chat'
  | 'auth'
  | 'turn'
  | 'reply'
  | 'llm'
  | 'agent_tool'
  | 'confirmation'
  | 'steering'
  | 'stop'
  | 'clarification'
  | 'rephrase'
  | 'edit'
  | 'disclosure'
  | 'settings'
  | 'task'
  | 'intent'
  | 'feature'
  | 'live_status'
  | 'provider'
  | 'rate_limit'
  | 'unconfigured'
  | 'mcp'
  | 'guest'

export type RqV1 = 'RQ1' | 'RQ2' | 'RQ3' | 'RQ4' | 'RQ5' | 'RQ6' | 'RQ7' | 'RQ8'

export type AnalyticsEventMetricMappingV1 = Readonly<{
  counters: readonly AggregateCounterV1[]
  histograms: readonly AggregateHistogramV1[]
}>

export type AnalyticsEventMetadataV1 = Readonly<{
  privacyClass: PrivacyClassV1
  sourceFamily: SourceFamilyV1
  metricMapping: AnalyticsEventMetricMappingV1
  rqCoverage: readonly RqV1[]
}>

type EventMetadataRecord = Record<EventNameV1, AnalyticsEventMetadataV1>

const events = {
  chat_message_accepted: {
    privacyClass: 'C0',
    sourceFamily: 'chat',
    metricMapping: { counters: ['message_accepted'] as const, histograms: [] as const },
    rqCoverage: ['RQ2'] as const,
  },
  auth_checked: {
    privacyClass: 'C0',
    sourceFamily: 'auth',
    metricMapping: {
      counters: ['auth_granted', 'auth_denied'] as const,
      histograms: [] as const,
    },
    rqCoverage: [] as const,
  },
  turn_started: {
    privacyClass: 'C0',
    sourceFamily: 'turn',
    metricMapping: { counters: ['turn_started'] as const, histograms: ['queue_delay_ms'] as const },
    rqCoverage: ['RQ1', 'RQ8'] as const,
  },
  turn_completed: {
    privacyClass: 'C0',
    sourceFamily: 'turn',
    metricMapping: {
      counters: ['turn_completed', 'turn_failed'] as const,
      histograms: ['turn_duration_ms'] as const,
    },
    rqCoverage: ['RQ1', 'RQ4', 'RQ8'] as const,
  },
  reply_sent: {
    privacyClass: 'C0',
    sourceFamily: 'reply',
    metricMapping: { counters: [] as const, histograms: ['time_to_first_reply_ms'] as const },
    rqCoverage: ['RQ3', 'RQ8'] as const,
  },
  llm_started: {
    privacyClass: 'C1',
    sourceFamily: 'llm',
    metricMapping: { counters: ['llm_started'] as const, histograms: [] as const },
    rqCoverage: ['RQ5', 'RQ8'] as const,
  },
  llm_completed: {
    privacyClass: 'C1',
    sourceFamily: 'llm',
    metricMapping: {
      counters: ['llm_completed'] as const,
      histograms: ['time_to_first_token_ms'] as const,
    },
    rqCoverage: ['RQ5', 'RQ8'] as const,
  },
  llm_failed: {
    privacyClass: 'C1',
    sourceFamily: 'llm',
    metricMapping: { counters: ['llm_failed'] as const, histograms: [] as const },
    rqCoverage: ['RQ5', 'RQ8'] as const,
  },
  tool_started: {
    privacyClass: 'C1',
    sourceFamily: 'agent_tool',
    metricMapping: { counters: ['tool_started'] as const, histograms: [] as const },
    rqCoverage: ['RQ3', 'RQ4', 'RQ5', 'RQ8'] as const,
  },
  tool_completed: {
    privacyClass: 'C1',
    sourceFamily: 'agent_tool',
    metricMapping: {
      counters: ['tool_semantic_success', 'tool_failed'] as const,
      histograms: ['tool_duration_ms'] as const,
    },
    rqCoverage: ['RQ3', 'RQ4', 'RQ5', 'RQ8'] as const,
  },
  confirmation_requested: {
    privacyClass: 'C1',
    sourceFamily: 'confirmation',
    metricMapping: { counters: [] as const, histograms: [] as const },
    rqCoverage: ['RQ4'] as const,
  },
  confirmation_resolved: {
    privacyClass: 'C1',
    sourceFamily: 'confirmation',
    metricMapping: { counters: [] as const, histograms: ['confirmation_latency_ms'] as const },
    rqCoverage: ['RQ4'] as const,
  },
  turn_steered: {
    privacyClass: 'C0',
    sourceFamily: 'steering',
    metricMapping: { counters: [] as const, histograms: [] as const },
    rqCoverage: ['RQ4'] as const,
  },
  turn_stop_requested: {
    privacyClass: 'C0',
    sourceFamily: 'stop',
    metricMapping: { counters: [] as const, histograms: [] as const },
    rqCoverage: ['RQ4'] as const,
  },
  clarification_requested: {
    privacyClass: 'C0',
    sourceFamily: 'clarification',
    metricMapping: { counters: [] as const, histograms: [] as const },
    rqCoverage: ['RQ4'] as const,
  },
  rephrase_detected: {
    privacyClass: 'C2',
    sourceFamily: 'rephrase',
    metricMapping: { counters: [] as const, histograms: [] as const },
    rqCoverage: ['RQ4'] as const,
  },
  edit_classified: {
    privacyClass: 'C0',
    sourceFamily: 'edit',
    metricMapping: {
      counters: ['edit_classified_w1', 'edit_classified_w2', 'edit_classified_w3'] as const,
      histograms: [] as const,
    },
    rqCoverage: ['RQ4'] as const,
  },
  edit_regen: {
    privacyClass: 'C0',
    sourceFamily: 'edit',
    metricMapping: {
      counters: [
        'edit_prompt_shown',
        'edit_prompt_adjust',
        'edit_prompt_note',
        'edit_regen_started',
        'edit_regen_completed',
        'edit_regen_failed',
        'edit_history_only',
      ] as const,
      histograms: [] as const,
    },
    rqCoverage: ['RQ4'] as const,
  },
  clarification_abandoned: {
    privacyClass: 'C2',
    sourceFamily: 'clarification',
    metricMapping: { counters: [] as const, histograms: [] as const },
    rqCoverage: ['RQ4'] as const,
  },
  disclosure_fallback: {
    privacyClass: 'C0',
    sourceFamily: 'disclosure',
    metricMapping: { counters: [] as const, histograms: [] as const },
    rqCoverage: ['RQ4'] as const,
  },
  config_link_issued: {
    privacyClass: 'C0',
    sourceFamily: 'settings',
    metricMapping: { counters: [] as const, histograms: [] as const },
    rqCoverage: ['RQ2'] as const,
  },
  settings_opened: {
    privacyClass: 'C0',
    sourceFamily: 'settings',
    metricMapping: { counters: [] as const, histograms: [] as const },
    rqCoverage: ['RQ2'] as const,
  },
  task_instance_assigned: {
    privacyClass: 'C0',
    sourceFamily: 'task',
    metricMapping: { counters: [] as const, histograms: [] as const },
    rqCoverage: ['RQ2'] as const,
  },
  intent_classified: {
    privacyClass: 'C2',
    sourceFamily: 'intent',
    metricMapping: { counters: [] as const, histograms: [] as const },
    rqCoverage: ['RQ1', 'RQ3'] as const,
  },
  feature_opportunity: {
    privacyClass: 'C0',
    sourceFamily: 'feature',
    metricMapping: { counters: [] as const, histograms: [] as const },
    rqCoverage: ['RQ7'] as const,
  },
  feature_used: {
    privacyClass: 'C1',
    sourceFamily: 'feature',
    metricMapping: { counters: [] as const, histograms: [] as const },
    rqCoverage: ['RQ7'] as const,
  },
  first_visible_feedback: {
    privacyClass: 'C0',
    sourceFamily: 'live_status',
    metricMapping: { counters: [] as const, histograms: ['first_feedback_ms'] as const },
    rqCoverage: ['RQ8'] as const,
  },
  live_status_opportunity: {
    privacyClass: 'C0',
    sourceFamily: 'live_status',
    metricMapping: { counters: [] as const, histograms: [] as const },
    rqCoverage: ['RQ8'] as const,
  },
  live_status_lifecycle: {
    privacyClass: 'C0',
    sourceFamily: 'live_status',
    metricMapping: { counters: [] as const, histograms: [] as const },
    rqCoverage: ['RQ8'] as const,
  },
  provider_request_completed: {
    privacyClass: 'C0',
    sourceFamily: 'provider',
    metricMapping: {
      counters: ['provider_failed', 'mcp_unavailable'] as const,
      histograms: [] as const,
    },
    rqCoverage: ['RQ5'] as const,
  },
  rate_limit_blocked: {
    privacyClass: 'C0',
    sourceFamily: 'rate_limit',
    metricMapping: { counters: ['rate_limit_blocked'] as const, histograms: [] as const },
    rqCoverage: ['RQ5'] as const,
  },
  unconfigured_reply: {
    privacyClass: 'C0',
    sourceFamily: 'unconfigured',
    metricMapping: { counters: ['unconfigured_reply'] as const, histograms: [] as const },
    rqCoverage: ['RQ5'] as const,
  },
  mcp_availability: {
    privacyClass: 'C1',
    sourceFamily: 'mcp',
    metricMapping: { counters: ['mcp_unavailable'] as const, histograms: [] as const },
    rqCoverage: ['RQ5'] as const,
  },
  guest_turn_aggregate: {
    privacyClass: 'C0',
    sourceFamily: 'guest',
    metricMapping: { counters: ['guest_turn'] as const, histograms: [] as const },
    rqCoverage: ['RQ6'] as const,
  },
} as const satisfies EventMetadataRecord

export const ANALYTICS_EVENTS_METADATA_V1: EventMetadataRecord = events
