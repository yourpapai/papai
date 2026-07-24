// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  AnalyticsAggregateV1Schema,
  AnalyticsEventV1Schema,
  firstVisibleFeedbackFixture,
  intentClassifiedFixture,
  llmCompletedFixture,
  toolCompletedFixture,
} from '../../src/analytics/contracts.js'

describe('AnalyticsEventV1 contract', () => {
  const validEnvelope = {
    schema: { name: 'papai.analytics.event', version: 1 },
    event: {
      id: 'v1.p-event-id',
      name: 'chat_message_accepted',
      version: 1,
      occurred_at_ms: 1700000000000,
      ingested_at_ms: 1700000000001,
      source: 'live',
      attribution_quality: 'native',
    },
    app: { version: '6.10.0', deployment_key: 'v1.p-deploy' },
    identity: {
      key_version: 'v1',
      platform: 'telegram',
      platform_instance_key: 'v1.p-platform',
      actor_key: 'v1.p-actor',
      context_key: 'v1.p-context',
      thread_key: null,
      task_instance_key: null,
    },
    context: {
      context_type: 'dm',
      actor_role: 'admin',
      task_provider: 'none',
      invocation_mode: 'normal',
    },
    correlation: {
      conversation_key: 'v1.p-conversation',
      turn_key: 'v1.p-turn',
      session_key: null,
    },
    governance: {
      purpose: 'product_analytics',
      collection_tier: 'aggregate',
      policy_version: 1,
      eligibility: 'allowed',
    },
    privacy: { max_class: 'C0' },
    props: {
      input_count: '0',
      length_bucket: '1_32',
      attachment_count: '0',
      is_command: false,
      command: 'none',
    },
  }

  test('accepts a valid chat_message_accepted envelope', (): void => {
    const result = AnalyticsEventV1Schema.safeParse(validEnvelope)
    expect(result.success).toBe(true)
  })

  test('rejects an extra envelope key', (): void => {
    const result = AnalyticsEventV1Schema.safeParse({ ...validEnvelope, extra_field: 'x' })
    expect(result.success).toBe(false)
  })

  test('rejects a negative duration', (): void => {
    const result = AnalyticsEventV1Schema.safeParse({
      ...validEnvelope,
      event: { ...validEnvelope.event, name: 'turn_completed' },
      props: {
        duration_ms: -1,
        outcome: 'ok',
        step_count: 1,
        tool_call_count: 0,
        reply_count: '0',
        clarification: false,
        live_status_used: false,
        finish_reason: 'stop',
      },
    })
    expect(result.success).toBe(false)
  })

  test('rejects NaN duration', (): void => {
    const result = AnalyticsEventV1Schema.safeParse({
      ...validEnvelope,
      event: { ...validEnvelope.event, name: 'turn_completed' },
      props: {
        duration_ms: NaN,
        outcome: 'ok',
        step_count: 1,
        tool_call_count: 0,
        reply_count: '0',
        clarification: false,
        live_status_used: false,
        finish_reason: 'stop',
      },
    })
    expect(result.success).toBe(false)
  })

  test('rejects an unknown enum value', (): void => {
    const result = AnalyticsEventV1Schema.safeParse({
      ...validEnvelope,
      props: {
        input_count: '0',
        length_bucket: '1_32',
        attachment_count: '0',
        is_command: false,
        command: 'nonexistent',
      },
    })
    expect(result.success).toBe(false)
  })

  test('rejects oversized goals', (): void => {
    const result = AnalyticsEventV1Schema.safeParse({
      ...validEnvelope,
      event: { ...validEnvelope.event, name: 'intent_classified' },
      props: {
        taxonomy: 'intent.v1',
        primary: 'I01',
        goals: ['I01', 'I02', 'I03', 'I04'],
        confidence: 'ge_095',
        strategy: 'hybrid_v1',
        abstained: false,
      },
    })
    expect(result.success).toBe(false)
  })

  test('compile-time fixtures exist, typecheck, and parse', (): void => {
    const fixtures = [
      { value: llmCompletedFixture, name: 'llm_completed' },
      { value: toolCompletedFixture, name: 'tool_completed' },
      { value: intentClassifiedFixture, name: 'intent_classified' },
      { value: firstVisibleFeedbackFixture, name: 'first_visible_feedback' },
    ]
    for (const { value, name } of fixtures) {
      expect(value.event.name === name).toBe(true)
      const result = AnalyticsEventV1Schema.safeParse(value)
      expect(result.success).toBe(true)
    }
  })

  test('rejects an invalid UTC day', (): void => {
    const result = AnalyticsEventV1Schema.safeParse({
      ...validEnvelope,
      event: { ...validEnvelope.event, name: 'guest_turn_aggregate' },
      props: { utc_day: '2024-13-01', turns: 1, successful_turns: 1, failed_turns: 0, contexts: '0' },
    })
    expect(result.success).toBe(false)
  })

  test('rejects an unsupported schema version', (): void => {
    const result = AnalyticsEventV1Schema.safeParse({
      ...validEnvelope,
      schema: { name: 'papai.analytics.event', version: 2 },
    })
    expect(result.success).toBe(false)
  })

  test('rejects an unsupported event version', (): void => {
    const result = AnalyticsEventV1Schema.safeParse({
      ...validEnvelope,
      event: { ...validEnvelope.event, version: 2 },
    })
    expect(result.success).toBe(false)
  })

  test('rejects an extra key inside props', (): void => {
    const result = AnalyticsEventV1Schema.safeParse({
      ...validEnvelope,
      props: { ...validEnvelope.props, extra_field: 'x' },
    })
    expect(result.success).toBe(false)
  })

  test('accepts a valid aggregate', (): void => {
    const aggregate = {
      schema: { name: 'papai.analytics.aggregate', version: 1 },
      bucket: { utc_day: '2024-01-01', definition_version: 1, finalized: false },
      dimensions: {
        platform: 'all',
        context_type: 'all',
        actor_role: 'all',
        task_provider: 'all',
        app_version: 'all',
      },
      measure: { kind: 'counter', metric: 'message_accepted', value: 1 },
      quality: {
        source: 'live',
        partial_day: false,
        restart_gap_detected: false,
        reconciliation: 'complete_epoch',
        late_event_count: 0,
      },
      disclosure: {
        scope: 'local_only',
        contributor_basis: 'not_required',
        contributor_count: null,
        threshold: null,
      },
    }
    expect(AnalyticsAggregateV1Schema.safeParse(aggregate).success).toBe(true)
  })
})
