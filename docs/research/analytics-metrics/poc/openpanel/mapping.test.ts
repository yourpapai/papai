// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { mapCanonicalRow, type CanonicalEventRow } from './mapping.js'
import type { MappedCanonicalEvent, MappingResult } from './mapping.js'

const SYNTHETIC_KEY = 'syn_0123456789abcdef0123456789abcdef'
const EVENT_ID = 'a'.repeat(64)

function canonicalRow(overrides: Partial<CanonicalEventRow> = {}): CanonicalEventRow {
  return {
    actor_key: SYNTHETIC_KEY,
    actor_role: 'member',
    app_version: '6.10.0',
    attribution_quality: 'native',
    collection_tier: 'pseudonymous',
    context_key: SYNTHETIC_KEY,
    context_type: 'dm',
    deployment_key: SYNTHETIC_KEY,
    eligibility: 'allowed',
    event_id: EVENT_ID,
    event_name: 'turn_completed',
    event_source: 'live',
    event_version: 1,
    expires_at_ms: Date.UTC(2026, 6, 30),
    governance_purpose: 'product_analytics',
    ingested_at_ms: Date.UTC(2026, 4, 1, 10, 1),
    invocation_mode: 'normal',
    key_version: 1,
    occurred_at_ms: Date.UTC(2026, 4, 1, 10),
    platform: 'telegram',
    platform_instance_key: SYNTHETIC_KEY,
    policy_version: 1,
    privacy_max_class: 'C2',
    props_json: JSON.stringify({
      clarification: false,
      duration_ms: 1_200,
      finish_reason: 'stop',
      live_status_used: true,
      outcome: 'ok',
      reply_count: '1',
      step_count: 2,
      tool_call_count: 1,
    }),
    schema_name: 'papai.analytics.event',
    schema_version: 1,
    session_key: SYNTHETIC_KEY,
    task_instance_key: SYNTHETIC_KEY,
    task_provider: 'kaneo',
    thread_key: SYNTHETIC_KEY,
    turn_key: SYNTHETIC_KEY,
    ...overrides,
  }
}

function requireMapped(result: MappingResult): MappedCanonicalEvent {
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.violations.join(', '))
  return result.value
}

function requireRejected(result: MappingResult): readonly string[] {
  expect(result.ok).toBe(false)
  if (result.ok) throw new Error('Expected mapping rejection')
  return result.violations
}

test('maps a canonical pseudonymous row to a strict OpenPanel track request', () => {
  const mapped = requireMapped(mapCanonicalRow(canonicalRow()))

  expect(mapped.request.type).toBe('track')
  expect(mapped.request.payload.name).toBe('turn_completed')
  expect(mapped.request.payload.profileId).toBe(SYNTHETIC_KEY)
  expect(mapped.request.payload.properties['__timestamp']).toBe('2026-05-01T10:00:00.000Z')
  expect(mapped.request.payload.properties['event_id']).toBe(EVENT_ID)
  expect(mapped.request.payload.properties['duration_ms']).toBe(1_200)
  expect(mapped.request.payload.properties).not.toHaveProperty('actor_key')
  expect(mapped.request.payload.properties).not.toHaveProperty('context_key')
  expect(mapped.request.payload.properties).not.toHaveProperty('deployment_key')
})

test('omits profile identity from aggregate guest rows', () => {
  const mapped = requireMapped(
    mapCanonicalRow(
      canonicalRow({
        actor_key: null,
        actor_role: 'guest',
        collection_tier: 'aggregate',
        context_key: null,
        context_type: 'none',
        eligibility: 'not_applicable',
        event_name: 'guest_turn_aggregate',
        privacy_max_class: 'C0',
        props_json: JSON.stringify({
          contexts: '6_10',
          failed_turns: 1,
          successful_turns: 9,
          turns: 10,
          utc_day: '2026-05-01',
        }),
        session_key: null,
        task_instance_key: null,
        task_provider: 'none',
        thread_key: null,
        turn_key: null,
      }),
    ),
  )

  expect(mapped.request.payload).not.toHaveProperty('profileId')
  expect(JSON.stringify(mapped.request)).not.toContain(SYNTHETIC_KEY)
})

test('rejects continuity from any aggregate row, including system facts', () => {
  const violations = requireRejected(
    mapCanonicalRow(
      canonicalRow({
        actor_key: null,
        actor_role: 'system',
        collection_tier: 'aggregate',
        context_key: SYNTHETIC_KEY,
        context_type: 'none',
        eligibility: 'not_applicable',
        event_name: 'mcp_availability',
        privacy_max_class: 'C0',
        props_json: JSON.stringify({
          origin: 'plugin_endpoint',
          outcome: 'available',
          server_key: SYNTHETIC_KEY,
        }),
        session_key: null,
        task_instance_key: null,
        task_provider: 'none',
        thread_key: null,
        turn_key: null,
      }),
    ),
  )

  expect(violations).toContain('aggregate row carries longitudinal continuity')
})

test('rejects an unknown or content-bearing property instead of forwarding it', () => {
  const violations = requireRejected(
    mapCanonicalRow(
      canonicalRow({
        props_json: JSON.stringify({
          clarification: false,
          content: 'invented message text',
          duration_ms: 1_200,
          finish_reason: 'stop',
          live_status_used: true,
          outcome: 'success',
          reply_count: 1,
          step_count: 2,
          tool_call_count: 1,
        }),
      }),
    ),
  )

  expect(violations).toContain('forbidden property key content')
})

test.each([
  {
    eventName: 'intent_classified',
    invalidProperty: 'primary',
    props: {
      abstained: false,
      confidence: 'ge_095',
      goals: [],
      primary: 'private_task_name',
      strategy: 'hybrid_v1',
      taxonomy: 'intent.v1',
    },
  },
  {
    eventName: 'llm_failed',
    invalidProperty: 'error_class',
    props: {
      attempt_key: SYNTHETIC_KEY,
      duration_ms: 500,
      error_class: 'unbounded_secret_code',
      model_key: SYNTHETIC_KEY,
      model_role: 'main',
      phase: 'request',
      retryable: false,
    },
  },
  {
    eventName: 'tool_started',
    invalidProperty: 'tool_slug',
    props: {
      args_bytes: '257_1024',
      domain: 'task',
      model_role: 'main',
      origin: 'core',
      risk: 'read',
      tool_key: SYNTHETIC_KEY,
      tool_slug: 'private_tool_name',
    },
  },
])('rejects a safe-looking but uncontrolled $invalidProperty value', ({ eventName, invalidProperty, props }) => {
  const violations = requireRejected(
    mapCanonicalRow(
      canonicalRow({
        event_name: eventName,
        props_json: JSON.stringify(props),
      }),
    ),
  )

  expect(violations).toContain(`property ${invalidProperty} is outside the controlled domain for ${eventName}`)
})

test.each([
  ['attempt_key', 'plain_attempt_identifier'],
  ['model_key', 'plain_model_identifier'],
] as const)('requires a synthetic pseudonym for llm_started %s', (property, value) => {
  const violations = requireRejected(
    mapCanonicalRow(
      canonicalRow({
        event_name: 'llm_started',
        props_json: JSON.stringify({
          attempt_key: SYNTHETIC_KEY,
          available_tool_count: '11_20',
          message_count: '1',
          model_key: SYNTHETIC_KEY,
          model_role: 'main',
          phase: 'generation',
          [property]: value,
        }),
      }),
    ),
  )

  expect(violations).toContain(`property ${property} is outside the controlled domain for llm_started`)
})

test('rejects an implausible controlled numeric value', () => {
  const violations = requireRejected(
    mapCanonicalRow(
      canonicalRow({
        props_json: JSON.stringify({
          clarification: false,
          duration_ms: 86_400_001,
          finish_reason: 'stop',
          live_status_used: true,
          outcome: 'ok',
          reply_count: '1',
          step_count: 2,
          tool_call_count: 1,
        }),
      }),
    ),
  )

  expect(violations).toContain('property duration_ms is outside the controlled domain for turn_completed')
})
