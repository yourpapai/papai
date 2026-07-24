// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { AnalyticsEventV1Schema } from '../../src/analytics/contracts.js'
import type { AnalyticsEventV1 } from '../../src/analytics/contracts.js'
import { KeyVersionSchema, KnownToolSlugSchema, VersionStringSchema } from '../../src/analytics/controlled-types.js'
import { createPseudonym } from '../../src/analytics/identity/pseudonym.js'
import { buildIdentityKeys } from '../../src/analytics/identity/scope.js'
import type { IdentityKeys } from '../../src/analytics/identity/scope.js'
import { normalize } from '../../src/analytics/normalizer.js'
import type { NormalizationResult, NormalizerEnv } from '../../src/analytics/normalizer.js'
import type { AnalyticsSourceContext } from '../../src/analytics/source-facts.js'
import { toScopedContextId } from '../../src/chat/scoped-context.js'

const hmacKey = Buffer.alloc(32, 7)
const keyVersion = KeyVersionSchema.parse('v1')

const env: NormalizerEnv = {
  hmacKey,
  keyVersion,
  installId: 'install-uuid-1',
  appVersion: VersionStringSchema.parse('6.10.0'),
  policyVersion: 3,
  ingestedAtMs: 1_700_000_000_500,
}

const memberSource: AnalyticsSourceContext = {
  platform: 'telegram',
  platformInstanceId: 'pi-1',
  chatUserId: 'user-42',
  nativeContextId: 'user-42',
  storageContextId: toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'user-42' }),
  configContextId: toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'user-42' }),
  contextType: 'dm',
  actorRole: 'member',
  taskInstanceId: null,
  taskProvider: 'none',
  invocationMode: 'normal',
  rawTurnId: 'turn-raw-1',
}

const identityFor = (source: AnalyticsSourceContext): IdentityKeys =>
  buildIdentityKeys({
    key: hmacKey,
    keyVersion,
    platform: source.platform,
    platformInstanceId: source.platformInstanceId,
    storageContextId: source.storageContextId,
    chatUserId: source.chatUserId ?? '',
    actorRole: source.actorRole,
    rawTurnId: source.rawTurnId ?? '',
    taskInstanceId: source.taskInstanceId,
    sessionStartMs: null,
    firstEventId: null,
  })

const expectOkEvent = (result: NormalizationResult): AnalyticsEventV1 => {
  if (result.status !== 'ok') throw new Error(`expected ok, got rejection: ${result.reason}`)
  return result.event
}

const expectNoRawIdLeak = (result: NormalizationResult, canaries: Record<string, string>): void => {
  if (result.status !== 'ok') throw new Error(`expected ok, got rejection: ${result.reason}`)
  const serialized = JSON.stringify(result.event)
  for (const canary of Object.values(canaries)) {
    expect(serialized).not.toContain(canary)
  }
  expect(serialized).toContain('"v1.')
}

describe('normalizer', () => {
  test('accepts one chat_message_accepted fact and emits only catalog fields', () => {
    const result = normalize(
      {
        version: 1,
        type: 'chat_message_accepted',
        sourceEventId: 'se-001',
        occurredAtMs: 1_700_000_000_000,
        source: memberSource,
        inputCount: 1,
        inputLengthChars: 200,
        attachmentCount: 0,
        isCommand: false,
        command: 'none',
      },
      env,
    )
    const event = expectOkEvent(result)

    const identity = identityFor(memberSource)
    const expected = {
      schema: { name: 'papai.analytics.event', version: 1 },
      event: {
        id: createPseudonym({
          key: hmacKey,
          keyVersion,
          domain: 'event-source-ref:v1',
          components: ['se-001', 'chat_message_accepted'],
        }),
        name: 'chat_message_accepted',
        version: 1,
        occurred_at_ms: 1_700_000_000_000,
        ingested_at_ms: 1_700_000_000_500,
        source: 'live',
        attribution_quality: 'native',
      },
      app: {
        version: VersionStringSchema.parse('6.10.0'),
        deployment_key: createPseudonym({
          key: hmacKey,
          keyVersion,
          domain: 'deployment:v1',
          components: ['install-uuid-1'],
        }),
      },
      identity: {
        key_version: KeyVersionSchema.parse('v1'),
        platform: 'telegram',
        platform_instance_key: createPseudonym({
          key: hmacKey,
          keyVersion,
          domain: 'platform-instance:v1',
          components: ['pi-1'],
        }),
        actor_key: identity.actor_key,
        context_key: identity.context_key,
        thread_key: identity.thread_key,
        task_instance_key: null,
      },
      context: {
        context_type: 'dm',
        actor_role: 'member',
        task_provider: 'none',
        invocation_mode: 'normal',
      },
      correlation: {
        conversation_key: identity.conversation_key,
        turn_key: identity.turn_key,
        session_key: null,
      },
      governance: {
        purpose: 'product_analytics',
        collection_tier: 'pseudonymous',
        policy_version: 3,
        eligibility: 'allowed',
      },
      privacy: { max_class: 'C0' },
      props: {
        input_count: '1',
        length_bucket: '129_512',
        attachment_count: '0',
        is_command: false,
        command: 'none',
      },
    } satisfies AnalyticsEventV1
    expect(event).toEqual(expected)
    expect(AnalyticsEventV1Schema.parse(event)).toEqual(event)
    expect(JSON.parse(JSON.stringify(event))).toEqual(JSON.parse(JSON.stringify(expected)))
  })

  test('message lifecycle family: auth_checked emits strict props', () => {
    const result = normalize(
      {
        version: 1,
        type: 'auth_checked',
        sourceEventId: 'se-auth-1',
        occurredAtMs: 1_700_000_000_100,
        source: memberSource,
        outcome: 'granted',
        reason: 'member',
      },
      env,
    )
    const event = expectOkEvent(result)
    expect(event.event.name).toBe('auth_checked')
    expect(event.props).toEqual({ outcome: 'granted', reason: 'member' })
    expect(event.privacy).toEqual({ max_class: 'C0' })
  })

  test('message lifecycle family: turn_started buckets counts and keeps queue wait', () => {
    const result = normalize(
      {
        version: 1,
        type: 'turn_started',
        sourceEventId: 'se-ts-1',
        occurredAtMs: 1_700_000_000_200,
        source: memberSource,
        incomingMessageCount: 2,
        attachmentCount: 1,
        queueWaitMs: 1500,
      },
      env,
    )
    const event = expectOkEvent(result)
    expect(event.props).toEqual({ incoming_message_count: '2', attachment_count: '1', queue_wait_ms: 1500 })
  })

  test('message lifecycle family: turn_completed emits controlled terminal props', () => {
    const result = normalize(
      {
        version: 1,
        type: 'turn_completed',
        sourceEventId: 'se-tc-1',
        occurredAtMs: 1_700_000_000_300,
        source: memberSource,
        outcome: 'ok',
        durationMs: 5400,
        stepCount: 3,
        toolCallCount: 2,
        replyCount: 1,
        finishReason: 'stop',
        clarification: false,
        liveStatusUsed: true,
      },
      env,
    )
    const event = expectOkEvent(result)
    expect(event.props).toEqual({
      outcome: 'ok',
      duration_ms: 5400,
      step_count: 3,
      tool_call_count: 2,
      reply_count: '1',
      finish_reason: 'stop',
      clarification: false,
      live_status_used: true,
    })
  })

  test('message lifecycle family: reply_sent buckets parts and length', () => {
    const result = normalize(
      {
        version: 1,
        type: 'reply_sent',
        sourceEventId: 'se-rs-1',
        occurredAtMs: 1_700_000_000_400,
        source: memberSource,
        latencyMs: 900,
        partCount: 2,
        totalLengthChars: 40,
        delivery: 'success',
      },
      env,
    )
    const event = expectOkEvent(result)
    expect(event.props).toEqual({
      latency_ms: 900,
      part_count: '2',
      length_bucket: '33_128',
      delivery: 'success',
    })
  })

  test('execution family: llm_started derives attempt and model keys', () => {
    const result = normalize(
      {
        version: 1,
        type: 'llm_started',
        sourceEventId: 'se-ls-1',
        occurredAtMs: 1_700_000_000_500,
        source: memberSource,
        rawAttemptId: 'turn-raw-1:main:0',
        modelId: 'gpt-5-mini',
        providerBinding: 'central-main',
        modelRole: 'main',
        phase: 'generation',
        messageCount: 4,
        availableToolCount: 12,
      },
      env,
    )
    const event = expectOkEvent(result)
    expect(event.privacy).toEqual({ max_class: 'C1' })
    expect(event.props).toEqual({
      attempt_key: createPseudonym({
        key: hmacKey,
        keyVersion,
        domain: 'llm-attempt:v1',
        components: ['turn-raw-1:main:0'],
      }),
      model_key: createPseudonym({
        key: hmacKey,
        keyVersion,
        domain: 'model:v1',
        components: ['central-main', 'gpt-5-mini'],
      }),
      model_role: 'main',
      phase: 'generation',
      message_count: '3_5',
      available_tool_count: '11_20',
    })
  })

  test('execution family: llm_completed keeps token counts and nullable ttft', () => {
    const result = normalize(
      {
        version: 1,
        type: 'llm_completed',
        sourceEventId: 'se-lc-1',
        occurredAtMs: 1_700_000_000_600,
        source: memberSource,
        rawAttemptId: 'turn-raw-1:main:0',
        modelId: 'gpt-5-mini',
        providerBinding: 'central-main',
        modelRole: 'main',
        durationMs: 3200,
        timeToFirstTokenMs: 800,
        inputTokens: 1200,
        outputTokens: 340,
        stepCount: 2,
        finishReason: 'stop',
      },
      env,
    )
    const event = expectOkEvent(result)
    expect(event.props).toEqual({
      attempt_key: createPseudonym({
        key: hmacKey,
        keyVersion,
        domain: 'llm-attempt:v1',
        components: ['turn-raw-1:main:0'],
      }),
      model_key: createPseudonym({
        key: hmacKey,
        keyVersion,
        domain: 'model:v1',
        components: ['central-main', 'gpt-5-mini'],
      }),
      model_role: 'main',
      duration_ms: 3200,
      time_to_first_token_ms: 800,
      input_tokens: 1200,
      output_tokens: 340,
      step_count: 2,
      finish_reason: 'stop',
    })
  })

  test('execution family: llm_failed emits bounded error class without raw error', () => {
    const result = normalize(
      {
        version: 1,
        type: 'llm_failed',
        sourceEventId: 'se-lf-1',
        occurredAtMs: 1_700_000_000_700,
        source: memberSource,
        rawAttemptId: 'turn-raw-1:main:1',
        modelId: 'gpt-5-mini',
        providerBinding: 'central-main',
        modelRole: 'main',
        phase: 'stream',
        errorClass: 'timeout',
        retryable: true,
        durationMs: 30_000,
      },
      env,
    )
    const event = expectOkEvent(result)
    expect(event.props).toEqual({
      attempt_key: createPseudonym({
        key: hmacKey,
        keyVersion,
        domain: 'llm-attempt:v1',
        components: ['turn-raw-1:main:1'],
      }),
      model_key: createPseudonym({
        key: hmacKey,
        keyVersion,
        domain: 'model:v1',
        components: ['central-main', 'gpt-5-mini'],
      }),
      model_role: 'main',
      phase: 'stream',
      error_class: 'timeout',
      retryable: true,
      duration_ms: 30_000,
    })
  })

  test('execution family: tool_started derives tool key and buckets args bytes', () => {
    const result = normalize(
      {
        version: 1,
        type: 'tool_started',
        sourceEventId: 'se-ts-2',
        occurredAtMs: 1_700_000_000_800,
        source: memberSource,
        toolSlug: 'core_task_create',
        toolOrigin: 'core',
        toolDomain: 'task',
        risk: 'write',
        modelRole: 'main',
        argsBytes: 300,
      },
      env,
    )
    const event = expectOkEvent(result)
    expect(event.props).toEqual({
      tool_slug: KnownToolSlugSchema.parse('core_task_create'),
      tool_key: createPseudonym({
        key: hmacKey,
        keyVersion,
        domain: 'tool:v1',
        components: ['core', 'core_task_create'],
      }),
      origin: 'core',
      domain: 'task',
      risk: 'write',
      model_role: 'main',
      args_bytes: '257_1024',
    })
  })

  test('execution family: tool_completed emits semantic outcome and status class', () => {
    const result = normalize(
      {
        version: 1,
        type: 'tool_completed',
        sourceEventId: 'se-tc-2',
        occurredAtMs: 1_700_000_000_900,
        source: memberSource,
        toolSlug: 'core_task_create',
        toolOrigin: 'core',
        toolDomain: 'task',
        risk: 'write',
        modelRole: 'main',
        argsBytes: 300,
        durationMs: 450,
        executionOutcome: 'semantic_success',
        resultBytes: 120,
        errorClass: null,
        statusClass: '2xx',
        retryable: null,
        recoveredSameTurn: false,
      },
      env,
    )
    const event = expectOkEvent(result)
    expect(event.props).toEqual({
      tool_slug: KnownToolSlugSchema.parse('core_task_create'),
      tool_key: createPseudonym({
        key: hmacKey,
        keyVersion,
        domain: 'tool:v1',
        components: ['core', 'core_task_create'],
      }),
      origin: 'core',
      domain: 'task',
      risk: 'write',
      model_role: 'main',
      args_bytes: '257_1024',
      duration_ms: 450,
      execution_outcome: 'semantic_success',
      result_bytes: '1_256',
      error_class: null,
      status_class: '2xx',
      retryable: null,
      recovered_same_turn: false,
    })
  })

  test('execution family: confirmation_requested fixes the five-minute timeout literal', () => {
    const result = normalize(
      {
        version: 1,
        type: 'confirmation_requested',
        sourceEventId: 'se-cr-1',
        occurredAtMs: 1_700_000_001_000,
        source: memberSource,
        toolSlug: 'core_task_delete',
        toolOrigin: 'core',
        risk: 'destructive',
        timeoutMs: 300_000,
      },
      env,
    )
    const event = expectOkEvent(result)
    expect(event.props).toEqual({
      tool_slug: KnownToolSlugSchema.parse('core_task_delete'),
      tool_key: createPseudonym({
        key: hmacKey,
        keyVersion,
        domain: 'tool:v1',
        components: ['core', 'core_task_delete'],
      }),
      risk: 'destructive',
      timeout_ms: 300_000,
    })
  })

  test('execution family: confirmation_resolved keeps decision latency', () => {
    const result = normalize(
      {
        version: 1,
        type: 'confirmation_resolved',
        sourceEventId: 'se-cr-2',
        occurredAtMs: 1_700_000_001_100,
        source: memberSource,
        toolSlug: 'core_task_delete',
        toolOrigin: 'core',
        decision: 'granted',
        decisionLatencyMs: 12_000,
      },
      env,
    )
    const event = expectOkEvent(result)
    expect(event.props).toEqual({
      tool_slug: KnownToolSlugSchema.parse('core_task_delete'),
      tool_key: createPseudonym({
        key: hmacKey,
        keyVersion,
        domain: 'tool:v1',
        components: ['core', 'core_task_delete'],
      }),
      decision: 'granted',
      decision_latency_ms: 12_000,
    })
  })

  test('execution family: first_visible_feedback allows null latency when not applicable', () => {
    const result = normalize(
      {
        version: 1,
        type: 'first_visible_feedback',
        sourceEventId: 'se-fvf-1',
        occurredAtMs: 1_700_000_001_200,
        source: memberSource,
        kind: 'none',
        outcome: 'not_applicable',
        capabilitySupported: false,
        settingEnabled: false,
        latencyMs: null,
      },
      env,
    )
    const event = expectOkEvent(result)
    expect(event.props).toEqual({
      kind: 'none',
      outcome: 'not_applicable',
      capability_supported: false,
      setting_enabled: false,
      latency_ms: null,
    })
  })

  test('boundary family: config_link_issued keeps controlled result', () => {
    const result = normalize(
      {
        version: 1,
        type: 'config_link_issued',
        sourceEventId: 'se-cli-1',
        occurredAtMs: 1_700_000_001_300,
        source: memberSource,
        result: 'issued',
      },
      env,
    )
    const event = expectOkEvent(result)
    expect(event.props).toEqual({ result: 'issued' })
  })

  test('boundary family: settings_opened keeps entry and result', () => {
    const result = normalize(
      {
        version: 1,
        type: 'settings_opened',
        sourceEventId: 'se-so-1',
        occurredAtMs: 1_700_000_001_400,
        source: memberSource,
        entry: 'config_link',
        result: 'success',
      },
      env,
    )
    const event = expectOkEvent(result)
    expect(event.props).toEqual({ entry: 'config_link', result: 'success' })
  })

  test('boundary family: task_instance_assigned snapshots providers', () => {
    const result = normalize(
      {
        version: 1,
        type: 'task_instance_assigned',
        sourceEventId: 'se-tia-1',
        occurredAtMs: 1_700_000_001_500,
        source: memberSource,
        change: 'first_assignment',
        fromProvider: 'none',
        toProvider: 'kaneo',
      },
      env,
    )
    const event = expectOkEvent(result)
    expect(event.props).toEqual({ change: 'first_assignment', from_provider: 'none', to_provider: 'kaneo' })
  })

  test('boundary family: provider_request_completed keeps bounded status', () => {
    const result = normalize(
      {
        version: 1,
        type: 'provider_request_completed',
        sourceEventId: 'se-prc-1',
        occurredAtMs: 1_700_000_001_600,
        source: memberSource,
        provider: 'kaneo',
        operation: 'update',
        durationMs: 210,
        outcome: 'failure',
        statusClass: '5xx',
        retryable: true,
      },
      env,
    )
    const event = expectOkEvent(result)
    expect(event.props).toEqual({
      provider: 'kaneo',
      operation: 'update',
      duration_ms: 210,
      outcome: 'failure',
      status_class: '5xx',
      retryable: true,
    })
  })

  test('boundary family: rate_limit_blocked keeps closed limit', () => {
    const result = normalize(
      {
        version: 1,
        type: 'rate_limit_blocked',
        sourceEventId: 'se-rlb-1',
        occurredAtMs: 1_700_000_001_700,
        source: memberSource,
        limit: 'web_fetch',
      },
      env,
    )
    const event = expectOkEvent(result)
    expect(event.props).toEqual({ limit: 'web_fetch' })
  })

  test('boundary family: unconfigured_reply keeps missing and surface', () => {
    const result = normalize(
      {
        version: 1,
        type: 'unconfigured_reply',
        sourceEventId: 'se-ur-1',
        occurredAtMs: 1_700_000_001_800,
        source: memberSource,
        missing: 'central_llm',
        surface: 'chat',
      },
      env,
    )
    const event = expectOkEvent(result)
    expect(event.props).toEqual({ missing: 'central_llm', surface: 'chat' })
  })

  test('boundary family: mcp_availability derives server key and closed outcome', () => {
    const result = normalize(
      {
        version: 1,
        type: 'mcp_availability',
        sourceEventId: 'se-mcp-1',
        occurredAtMs: 1_700_000_001_900,
        source: memberSource,
        origin: 'user_endpoint',
        serverRawId: 'mcp-server-raw-9',
        outcome: 'connection_failed',
      },
      env,
    )
    const event = expectOkEvent(result)
    expect(event.props).toEqual({
      origin: 'user_endpoint',
      server_key: createPseudonym({
        key: hmacKey,
        keyVersion,
        domain: 'mcp-server:v1',
        components: ['mcp-server-raw-9'],
      }),
      outcome: 'connection_failed',
    })
  })

  test('derived fact family: intent_classified keeps taxonomy provenance', () => {
    const result = normalize(
      {
        version: 1,
        type: 'intent_classified',
        sourceEventId: 'se-ic-1',
        occurredAtMs: 1_700_000_002_000,
        source: memberSource,
        taxonomy: 'intent.v1',
        primary: 'I23',
        goals: ['I01', 'I02'],
        confidence: 'ge_095',
        strategy: 'hybrid_v1',
        abstained: false,
      },
      env,
    )
    const event = expectOkEvent(result)
    expect(event.privacy).toEqual({ max_class: 'C2' })
    expect(event.props).toEqual({
      taxonomy: 'intent.v1',
      primary: 'I23',
      goals: ['I01', 'I02'],
      confidence: 'ge_095',
      strategy: 'hybrid_v1',
      abstained: false,
    })
  })

  test('derived fact family: feature_opportunity snapshots availability', () => {
    const result = normalize(
      {
        version: 1,
        type: 'feature_opportunity',
        sourceEventId: 'se-fo-1',
        occurredAtMs: 1_700_000_002_100,
        source: memberSource,
        feature: 'recurring',
        available: true,
        reason: 'available',
        sampling: 'first_eligible_actor_day',
      },
      env,
    )
    const event = expectOkEvent(result)
    expect(event.props).toEqual({
      feature: 'recurring',
      available: true,
      reason: 'available',
      sampling: 'first_eligible_actor_day',
    })
  })

  test('derived fact family: feature_used derives coding keys', () => {
    const result = normalize(
      {
        version: 1,
        type: 'feature_used',
        sourceEventId: 'se-fu-1',
        occurredAtMs: 1_700_000_002_200,
        source: memberSource,
        feature: 'coding',
        operation: 'start',
        outcome: 'success',
        codingProjectRawId: 'proj-raw-1',
        codingSessionRawId: 'sess-raw-1',
      },
      env,
    )
    const event = expectOkEvent(result)
    expect(event.props).toEqual({
      feature: 'coding',
      operation: 'start',
      outcome: 'success',
      coding_project_key: createPseudonym({
        key: hmacKey,
        keyVersion,
        domain: 'coding-project:v1',
        components: ['pi-1', 'proj-raw-1'],
      }),
      coding_session_key: createPseudonym({
        key: hmacKey,
        keyVersion,
        domain: 'coding-session:v1',
        components: ['pi-1', 'sess-raw-1'],
      }),
    })
  })

  test('derived fact family: turn_steered buckets length without steer text', () => {
    const result = normalize(
      {
        version: 1,
        type: 'turn_steered',
        sourceEventId: 'se-tst-1',
        occurredAtMs: 1_700_000_002_300,
        source: memberSource,
        ordinal: 2,
        steerLengthChars: 90,
        ackSent: true,
      },
      env,
    )
    const event = expectOkEvent(result)
    expect(event.props).toEqual({ ordinal: 2, length_bucket: '33_128', ack_sent: true })
  })

  test('derived fact family: turn_stop_requested keeps stage', () => {
    const result = normalize(
      {
        version: 1,
        type: 'turn_stop_requested',
        sourceEventId: 'se-tstop-1',
        occurredAtMs: 1_700_000_002_400,
        source: memberSource,
        stage: 'forced',
      },
      env,
    )
    const event = expectOkEvent(result)
    expect(event.props).toEqual({ stage: 'forced' })
  })

  test('derived fact family: clarification_requested keeps closed reason', () => {
    const result = normalize(
      {
        version: 1,
        type: 'clarification_requested',
        sourceEventId: 'se-clr-1',
        occurredAtMs: 1_700_000_002_500,
        source: memberSource,
        reason: 'ambiguous_target',
      },
      env,
    )
    const event = expectOkEvent(result)
    expect(event.props).toEqual({ reason: 'ambiguous_target' })
  })

  test('derived fact family: rephrase_detected keeps detector buckets only', () => {
    const result = normalize(
      {
        version: 1,
        type: 'rephrase_detected',
        sourceEventId: 'se-rd-1',
        occurredAtMs: 1_700_000_002_600,
        source: memberSource,
        detector: 'lexical_v1',
        similarity: 'ge_095',
        priorOutcome: 'failure',
        gap: 'le_2m',
      },
      env,
    )
    const event = expectOkEvent(result)
    expect(event.props).toEqual({
      detector: 'lexical_v1',
      similarity: 'ge_095',
      prior_outcome: 'failure',
      gap: 'le_2m',
    })
  })

  test('derived fact family: clarification_abandoned fixes the 24-hour literal', () => {
    const result = normalize(
      {
        version: 1,
        type: 'clarification_abandoned',
        sourceEventId: 'se-ca-1',
        occurredAtMs: 1_700_000_002_700,
        source: memberSource,
        observationHours: 24,
      },
      env,
    )
    const event = expectOkEvent(result)
    expect(event.props).toEqual({ observation_hours: 24 })
  })

  test('derived fact family: disclosure_fallback buckets steps', () => {
    const result = normalize(
      {
        version: 1,
        type: 'disclosure_fallback',
        sourceEventId: 'se-df-1',
        occurredAtMs: 1_700_000_002_800,
        source: memberSource,
        reason: 'no_real_load',
        stepCount: 4,
      },
      env,
    )
    const event = expectOkEvent(result)
    expect(event.props).toEqual({ reason: 'no_real_load', step_bucket: '3_5' })
  })

  test('derived fact family: live_status_opportunity keeps eligibility reason', () => {
    const result = normalize(
      {
        version: 1,
        type: 'live_status_opportunity',
        sourceEventId: 'se-lso-1',
        occurredAtMs: 1_700_000_002_900,
        source: memberSource,
        eligible: false,
        reason: 'platform_unsupported',
      },
      env,
    )
    const event = expectOkEvent(result)
    expect(event.props).toEqual({ eligible: false, reason: 'platform_unsupported' })
  })

  test('derived fact family: live_status_lifecycle keeps stage ordinal and latency', () => {
    const result = normalize(
      {
        version: 1,
        type: 'live_status_lifecycle',
        sourceEventId: 'se-lsl-1',
        occurredAtMs: 1_700_000_003_000,
        source: memberSource,
        stage: 'update',
        outcome: 'success',
        latencyFromTurnStartMs: 4500,
        ordinal: 2,
      },
      env,
    )
    const event = expectOkEvent(result)
    expect(event.props).toEqual({
      stage: 'update',
      outcome: 'success',
      latency_from_turn_start_ms: 4500,
      ordinal: 2,
    })
  })

  test('derived fact family: guest_turn_aggregate nulls every longitudinal key', () => {
    const guestSource: AnalyticsSourceContext = {
      ...memberSource,
      chatUserId: null,
      actorRole: 'guest',
      rawTurnId: null,
    }
    const result = normalize(
      {
        version: 1,
        type: 'guest_turn_aggregate',
        sourceEventId: 'se-gta-1',
        occurredAtMs: 1_700_000_003_100,
        source: guestSource,
        utcDay: '2026-07-24',
        turns: 3,
        successfulTurns: 2,
        failedTurns: 1,
        contextCount: 7,
      },
      env,
    )
    const event = expectOkEvent(result)
    expect(event.identity.actor_key).toBeNull()
    expect(event.identity.context_key).toBeNull()
    expect(event.identity.thread_key).toBeNull()
    expect(event.correlation.turn_key).toBeNull()
    expect(event.correlation.conversation_key).toBeNull()
    expect(event.correlation.session_key).toBeNull()
    expect(event.props).toEqual({
      utc_day: '2026-07-24',
      turns: 3,
      successful_turns: 2,
      failed_turns: 1,
      contexts: '6_10',
    })
  })

  test('fail-closed: unknown event type yields a bounded rejection', () => {
    const bogus: unknown = JSON.parse(
      JSON.stringify({
        version: 1,
        type: 'turn_summary',
        sourceEventId: 'se-x',
        occurredAtMs: 1_700_000_004_000,
        source: memberSource,
      }),
    )
    const result = normalize(bogus, env)
    expect(result).toEqual({ status: 'rejected', sourceEventType: 'turn_summary', reason: 'unknown_event' })
  })

  test('fail-closed: unknown version yields a bounded rejection', () => {
    const bogus: unknown = JSON.parse(
      JSON.stringify({
        version: 2,
        type: 'auth_checked',
        sourceEventId: 'se-x',
        occurredAtMs: 1_700_000_004_000,
        source: memberSource,
        outcome: 'granted',
        reason: 'member',
      }),
    )
    const result = normalize(bogus, env)
    expect(result).toEqual({ status: 'rejected', sourceEventType: 'auth_checked', reason: 'unknown_version' })
  })

  test('fail-closed: unknown enum value yields a bounded rejection', () => {
    const result = normalize(
      {
        version: 1,
        type: 'auth_checked',
        sourceEventId: 'se-x',
        occurredAtMs: 1_700_000_004_000,
        source: memberSource,
        outcome: 'maybe',
        reason: 'member',
      },
      env,
    )
    expect(result).toEqual({ status: 'rejected', sourceEventType: 'auth_checked', reason: 'unknown_enum' })
  })

  test('fail-closed: unknown raw property yields a bounded rejection without the payload', () => {
    const bogus: unknown = JSON.parse(
      JSON.stringify({
        version: 1,
        type: 'auth_checked',
        sourceEventId: 'se-x',
        occurredAtMs: 1_700_000_004_000,
        source: memberSource,
        outcome: 'granted',
        reason: 'member',
        promptText: 'CANARY-prompt',
      }),
    )
    const result = normalize(bogus, env)
    expect(result).toEqual({ status: 'rejected', sourceEventType: 'auth_checked', reason: 'unknown_property' })
    expect(JSON.stringify(result)).not.toContain('CANARY-prompt')
  })

  test('fail-closed: negative duration yields a bounded rejection', () => {
    const result = normalize(
      {
        version: 1,
        type: 'turn_completed',
        sourceEventId: 'se-x',
        occurredAtMs: 1_700_000_004_000,
        source: memberSource,
        outcome: 'ok',
        durationMs: -1,
        stepCount: 1,
        toolCallCount: 0,
        replyCount: 1,
        finishReason: 'stop',
        clarification: false,
        liveStatusUsed: false,
      },
      env,
    )
    expect(result).toEqual({ status: 'rejected', sourceEventType: 'turn_completed', reason: 'invalid_value' })
  })

  test('C3 canaries never survive normalization', () => {
    const canaries = {
      text: 'CANARY-text-9f3e',
      username: 'CANARY-username-7b1d',
      prompt: 'CANARY-prompt-4a2c',
      args: 'CANARY-args-1e8f',
      result: 'CANARY-result-6c5a',
      error: 'CANARY-error-2d9b',
      url: 'https://CANARY-host.example/path/canary',
      hostname: 'CANARY-hostname.internal',
      filename: 'CANARY-filename.env',
      projectName: 'CANARY-project-name',
      statusName: 'CANARY-status-name',
      tagName: 'CANARY-tag-name',
      rrule: 'RRULE:FREQ=DAILY;CANARY=1',
      token: 'CANARY-token-sk-secret',
    }
    const canarySource: AnalyticsSourceContext = {
      ...memberSource,
      chatUserId: canaries.username,
      nativeContextId: canaries.text,
      storageContextId: memberSource.storageContextId,
      configContextId: memberSource.configContextId,
      taskInstanceId: canaries.projectName,
      rawTurnId: canaries.token,
    }
    const canaryEnv: NormalizerEnv = { ...env, installId: canaries.hostname }
    const results = [
      normalize(
        {
          version: 1,
          type: 'llm_completed',
          sourceEventId: canaries.prompt,
          occurredAtMs: 1_700_000_004_100,
          source: canarySource,
          rawAttemptId: canaries.args,
          modelId: canaries.url,
          providerBinding: canaries.filename,
          modelRole: 'main',
          durationMs: 10,
          timeToFirstTokenMs: null,
          inputTokens: null,
          outputTokens: null,
          stepCount: 1,
          finishReason: 'stop',
        },
        canaryEnv,
      ),
      normalize(
        {
          version: 1,
          type: 'mcp_availability',
          sourceEventId: canaries.error,
          occurredAtMs: 1_700_000_004_200,
          source: canarySource,
          origin: 'user_endpoint',
          serverRawId: canaries.rrule,
          outcome: 'timeout',
        },
        canaryEnv,
      ),
      normalize(
        {
          version: 1,
          type: 'feature_used',
          sourceEventId: canaries.statusName,
          occurredAtMs: 1_700_000_004_300,
          source: canarySource,
          feature: 'coding',
          operation: 'start',
          outcome: 'success',
          codingProjectRawId: canaries.projectName,
          codingSessionRawId: canaries.tagName,
        },
        canaryEnv,
      ),
    ]
    results.forEach((result) => expectNoRawIdLeak(result, canaries))
  })

  test('raw identifier canaries yield only purpose-keyed pseudonyms', () => {
    const rawIds = {
      actor: 'raw-actor-id-77',
      context: 'raw-context-id-88',
      storage: toScopedContextId({ platformInstanceId: 'pi-raw-99', nativeContextId: 'raw-context-id-88' }),
      config: toScopedContextId({ platformInstanceId: 'pi-raw-99', nativeContextId: 'raw-context-id-88' }),
      instance: 'pi-raw-99',
      task: 'raw-task-instance-id-11',
      turn: 'raw-turn-id-22',
      model: 'raw-model-id-33',
      attempt: 'raw-attempt-id-44',
      sourceEvent: 'raw-source-event-id-55',
    }
    const rawSource: AnalyticsSourceContext = {
      ...memberSource,
      platformInstanceId: rawIds.instance,
      chatUserId: rawIds.actor,
      nativeContextId: rawIds.context,
      storageContextId: rawIds.storage,
      configContextId: rawIds.config,
      taskInstanceId: rawIds.task,
      rawTurnId: rawIds.turn,
    }
    const result = normalize(
      {
        version: 1,
        type: 'llm_completed',
        sourceEventId: rawIds.sourceEvent,
        occurredAtMs: 1_700_000_004_400,
        source: rawSource,
        rawAttemptId: rawIds.attempt,
        modelId: rawIds.model,
        providerBinding: 'central-main',
        modelRole: 'main',
        durationMs: 10,
        timeToFirstTokenMs: null,
        inputTokens: null,
        outputTokens: null,
        stepCount: 1,
        finishReason: 'stop',
      },
      env,
    )
    const event = expectOkEvent(result)
    const serialized = JSON.stringify(event)
    for (const raw of Object.values(rawIds)) {
      expect(serialized).not.toContain(raw)
    }
    expect(event.identity.actor_key).toBe(
      createPseudonym({ key: hmacKey, keyVersion, domain: 'actor:v1', components: [rawIds.instance, rawIds.actor] }),
    )
    expect(event.identity.task_instance_key).toBe(
      createPseudonym({ key: hmacKey, keyVersion, domain: 'task-instance:v1', components: [rawIds.task] }),
    )
    expect(event.correlation.turn_key).toBe(
      createPseudonym({ key: hmacKey, keyVersion, domain: 'turn:v1', components: [rawIds.turn] }),
    )
  })
})
