// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { AnalyticsAggregateV1Schema } from '../../src/analytics/aggregate-contract.js'
import type { AnalyticsAggregateV1 } from '../../src/analytics/aggregate-contract.js'
import {
  createContributorTracker,
  createDailyAggregator,
  histogramBucketIndex,
  incrementsForEvent,
  utcDayOfMs,
} from '../../src/analytics/aggregate.js'
import type { AggregateIncrement } from '../../src/analytics/aggregate.js'
import type { AnalyticsEventV1 } from '../../src/analytics/contracts.js'
import type { AggregateCounterV1, AggregateHistogramV1 } from '../../src/analytics/controlled-types.js'
import { KeyVersionSchema, VersionStringSchema } from '../../src/analytics/controlled-types.js'
import { normalize } from '../../src/analytics/normalizer.js'
import type { NormalizationResult, NormalizerEnv } from '../../src/analytics/normalizer.js'
import type { AnalyticsSourceContext } from '../../src/analytics/source-facts.js'
import { toScopedContextId } from '../../src/chat/scoped-context.js'

const DAY1_NOON = Date.UTC(2023, 10, 14, 12, 0, 0, 0)
const DAY1 = '2023-11-14'

const env: NormalizerEnv = {
  hmacKey: Buffer.alloc(32, 7),
  keyVersion: KeyVersionSchema.parse('v1'),
  installId: 'install-uuid-1',
  appVersion: VersionStringSchema.parse('6.10.0'),
  policyVersion: 3,
  ingestedAtMs: DAY1_NOON + 500,
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

const secondActorSource: AnalyticsSourceContext = {
  ...memberSource,
  chatUserId: 'user-99',
  nativeContextId: 'user-99',
  storageContextId: toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'user-99' }),
  configContextId: toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'user-99' }),
}

const unwrap = (result: NormalizationResult): AnalyticsEventV1 => {
  if (result.status !== 'ok') throw new Error(`expected ok, got rejection: ${result.reason}`)
  return result.event
}

const fact = (
  type: string,
  extra: Record<string, unknown>,
  occurredAtMs: number,
  source: AnalyticsSourceContext,
): unknown => ({
  version: 1,
  type,
  sourceEventId: `se-${type}-${occurredAtMs}-${source.chatUserId ?? 'anon'}`,
  occurredAtMs,
  source,
  ...extra,
})

const dayFact = (
  type: string,
  extra: Record<string, unknown>,
  source: AnalyticsSourceContext = memberSource,
): unknown => fact(type, extra, DAY1_NOON, source)

const eventOf = (input: unknown): AnalyticsEventV1 => unwrap(normalize(input, env))
const incrementsOf = (input: unknown): readonly AggregateIncrement[] => incrementsForEvent(eventOf(input))

const counter = (metric: AggregateCounterV1, delta = 1): AggregateIncrement => ({ kind: 'counter', metric, delta })
const histogram = (metric: AggregateHistogramV1, valueMs: number): AggregateIncrement => ({
  kind: 'histogram',
  metric,
  valueMs,
})

const finalizedFor = (
  events: readonly AnalyticsEventV1[],
  utcDay: string,
  restartGap = false,
): readonly AnalyticsAggregateV1[] => {
  const aggregator = createDailyAggregator({ tracker: createContributorTracker() })
  events.forEach((event) => {
    aggregator.apply(event)
  })
  return aggregator.finalize(utcDay, { restartGap })
}

const measureFor = (records: readonly AnalyticsAggregateV1[], metric: string): AnalyticsAggregateV1 => {
  const found = records.find((record) => record.measure.metric === metric)
  if (found === undefined) throw new Error(`no aggregate record for metric ${metric}`)
  return found
}

const histogramMeasureOf = (
  records: readonly AnalyticsAggregateV1[],
  metric: string,
): Extract<AnalyticsAggregateV1['measure'], { kind: 'histogram' }> => {
  const record = measureFor(records, metric)
  if (record.measure.kind !== 'histogram') throw new Error(`expected histogram measure for ${metric}`)
  return record.measure
}

describe('aggregate increments mapping', () => {
  test('maps chat_message_accepted to the message_accepted counter', () => {
    const increments = incrementsOf(
      dayFact('chat_message_accepted', {
        inputCount: 1,
        inputLengthChars: 200,
        attachmentCount: 0,
        isCommand: false,
        command: 'none',
      }),
    )
    expect(increments).toEqual([counter('message_accepted')])
  })

  test('maps auth outcomes to granted and denied counters', () => {
    expect(incrementsOf(dayFact('auth_checked', { outcome: 'granted', reason: 'member' }))).toEqual([
      counter('auth_granted'),
    ])
    expect(incrementsOf(dayFact('auth_checked', { outcome: 'denied', reason: 'guest_mode' }))).toEqual([
      counter('auth_denied'),
    ])
  })

  test('maps turn_started to a counter and the queue delay histogram', () => {
    const increments = incrementsOf(
      dayFact('turn_started', { incomingMessageCount: 1, attachmentCount: 0, queueWaitMs: 120 }),
    )
    expect(increments).toEqual([counter('turn_started'), histogram('queue_delay_ms', 120)])
  })

  test('maps turn outcomes to completed or failed counters plus duration histogram', () => {
    const ok = incrementsOf(
      dayFact('turn_completed', {
        outcome: 'ok',
        durationMs: 1500,
        stepCount: 2,
        toolCallCount: 1,
        replyCount: 1,
        finishReason: 'stop',
        clarification: false,
        liveStatusUsed: false,
      }),
    )
    expect(ok).toEqual([counter('turn_completed'), histogram('turn_duration_ms', 1500)])

    const failed = incrementsOf(
      dayFact('turn_completed', {
        outcome: 'llm_error',
        durationMs: 700,
        stepCount: 1,
        toolCallCount: 0,
        replyCount: 0,
        finishReason: 'error',
        clarification: false,
        liveStatusUsed: false,
      }),
    )
    expect(failed).toEqual([counter('turn_failed'), histogram('turn_duration_ms', 700)])
  })

  test('maps reply_sent to the first-reply latency histogram', () => {
    const increments = incrementsOf(
      dayFact('reply_sent', { latencyMs: 300, partCount: 1, totalLengthChars: 100, delivery: 'success' }),
    )
    expect(increments).toEqual([histogram('time_to_first_reply_ms', 300)])
  })

  test('maps llm lifecycle to counters and the ttft histogram only when present', () => {
    const started = incrementsOf(
      dayFact('llm_started', {
        rawAttemptId: 'att-1',
        modelId: 'gpt-x',
        providerBinding: 'central',
        modelRole: 'main',
        phase: 'generation',
        messageCount: 5,
        availableToolCount: 10,
      }),
    )
    expect(started).toEqual([counter('llm_started')])

    const completed = incrementsOf(
      dayFact('llm_completed', {
        rawAttemptId: 'att-1',
        modelId: 'gpt-x',
        providerBinding: 'central',
        modelRole: 'main',
        durationMs: 900,
        timeToFirstTokenMs: 120,
        inputTokens: null,
        outputTokens: null,
        stepCount: 1,
        finishReason: 'stop',
      }),
    )
    expect(completed).toEqual([counter('llm_completed'), histogram('time_to_first_token_ms', 120)])

    const completedNoTtft = incrementsOf(
      dayFact('llm_completed', {
        rawAttemptId: 'att-2',
        modelId: 'gpt-x',
        providerBinding: 'central',
        modelRole: 'main',
        durationMs: 900,
        timeToFirstTokenMs: null,
        inputTokens: null,
        outputTokens: null,
        stepCount: 1,
        finishReason: 'stop',
      }),
    )
    expect(completedNoTtft).toEqual([counter('llm_completed')])

    const failed = incrementsOf(
      dayFact('llm_failed', {
        rawAttemptId: 'att-3',
        modelId: 'gpt-x',
        providerBinding: 'central',
        modelRole: 'main',
        phase: 'request',
        errorClass: 'timeout',
        retryable: null,
        durationMs: 100,
      }),
    )
    expect(failed).toEqual([counter('llm_failed')])
  })

  test('maps tool outcomes to semantic success or failure counters plus duration histogram', () => {
    const base = {
      toolSlug: 'core_task_create',
      toolOrigin: 'core',
      toolDomain: 'task',
      risk: 'write',
      modelRole: 'main',
      argsBytes: 300,
    }
    expect(incrementsOf(dayFact('tool_started', base))).toEqual([counter('tool_started')])

    const success = incrementsOf(
      dayFact('tool_completed', {
        ...base,
        durationMs: 450,
        executionOutcome: 'semantic_success',
        resultBytes: 120,
        errorClass: null,
        statusClass: '2xx',
        retryable: null,
        recoveredSameTurn: false,
      }),
    )
    expect(success).toEqual([counter('tool_semantic_success'), histogram('tool_duration_ms', 450)])

    const failure = incrementsOf(
      dayFact('tool_completed', {
        ...base,
        durationMs: 60,
        executionOutcome: 'thrown_failure',
        resultBytes: 0,
        errorClass: 'timeout',
        statusClass: 'timeout',
        retryable: true,
        recoveredSameTurn: false,
      }),
    )
    expect(failure).toEqual([counter('tool_failed'), histogram('tool_duration_ms', 60)])
  })

  test('maps confirmation_resolved to the confirmation latency histogram', () => {
    const increments = incrementsOf(
      dayFact('confirmation_resolved', {
        toolSlug: 'core_task_create',
        toolOrigin: 'core',
        decision: 'granted',
        decisionLatencyMs: 800,
      }),
    )
    expect(increments).toEqual([histogram('confirmation_latency_ms', 800)])
  })

  test('maps first_visible_feedback to the feedback histogram only when latency is present', () => {
    const withLatency = incrementsOf(
      dayFact('first_visible_feedback', {
        kind: 'typing',
        outcome: 'success',
        capabilitySupported: true,
        settingEnabled: true,
        latencyMs: 250,
      }),
    )
    expect(withLatency).toEqual([histogram('first_feedback_ms', 250)])

    const withoutLatency = incrementsOf(
      dayFact('first_visible_feedback', {
        kind: 'none',
        outcome: 'missing',
        capabilitySupported: false,
        settingEnabled: false,
        latencyMs: null,
      }),
    )
    expect(withoutLatency).toEqual([])
  })

  test('maps provider, rate limit, MCP, and unconfigured counters', () => {
    const providerFailed = incrementsOf(
      dayFact('provider_request_completed', {
        provider: 'kaneo',
        operation: 'read',
        durationMs: 200,
        outcome: 'failure',
        statusClass: '5xx',
        retryable: true,
      }),
    )
    expect(providerFailed).toEqual([counter('provider_failed')])

    const providerOk = incrementsOf(
      dayFact('provider_request_completed', {
        provider: 'kaneo',
        operation: 'read',
        durationMs: 200,
        outcome: 'success',
        statusClass: '2xx',
        retryable: null,
      }),
    )
    expect(providerOk).toEqual([])

    expect(incrementsOf(dayFact('rate_limit_blocked', { limit: 'web_fetch' }))).toEqual([counter('rate_limit_blocked')])
    expect(
      incrementsOf(dayFact('mcp_availability', { origin: 'user_endpoint', serverRawId: 'srv-1', outcome: 'timeout' })),
    ).toEqual([counter('mcp_unavailable')])
    expect(
      incrementsOf(
        dayFact('mcp_availability', { origin: 'user_endpoint', serverRawId: 'srv-1', outcome: 'available' }),
      ),
    ).toEqual([])
    expect(incrementsOf(dayFact('unconfigured_reply', { missing: 'central_llm', surface: 'chat' }))).toEqual([
      counter('unconfigured_reply'),
    ])
  })

  test('maps guest_turn_aggregate to a guest_turn counter with the turns delta', () => {
    const increments = incrementsOf(
      dayFact('guest_turn_aggregate', {
        utcDay: DAY1,
        turns: 5,
        successfulTurns: 4,
        failedTurns: 1,
        contextCount: 3,
      }),
    )
    expect(increments).toEqual([counter('guest_turn', 5)])
  })

  test('edit_classified increments the per-window counter', () => {
    expect(incrementsOf(dayFact('edit_classified', { window: 'w1' }))).toEqual([counter('edit_classified_w1')])
    expect(incrementsOf(dayFact('edit_classified', { window: 'w3' }))).toEqual([counter('edit_classified_w3')])
  })

  test('edit_regen increments the per-phase counter', () => {
    expect(incrementsOf(dayFact('edit_regen', { phase: 'regen_completed', durationMs: 100 }))).toEqual([
      counter('edit_regen_completed'),
    ])
    expect(incrementsOf(dayFact('edit_regen', { phase: 'history_only' }))).toEqual([counter('edit_history_only')])
  })

  test('edit events with out-of-schema props are rejected before aggregation', () => {
    expect(() => eventOf(dayFact('edit_regen', { phase: 'nope' }))).toThrow()
  })

  test('emits no increments for events outside the closed aggregate set', () => {
    expect(incrementsOf(dayFact('turn_steered', { ordinal: 1, steerLengthChars: 50, ackSent: true }))).toEqual([])
    expect(incrementsOf(dayFact('settings_opened', { entry: 'config_link', result: 'success' }))).toEqual([])
  })
})

describe('histogramBucketIndex', () => {
  test('places every fixed boundary and its predecessor in the expected bucket', () => {
    const cases: readonly (readonly [number, number])[] = [
      [0, 0],
      [1, 0],
      [99, 0],
      [100, 1],
      [249, 1],
      [250, 2],
      [499, 2],
      [500, 3],
      [999, 3],
      [1000, 4],
      [2499, 4],
      [2500, 5],
      [4999, 5],
      [5000, 6],
      [9999, 6],
      [10000, 7],
      [29999, 7],
      [30000, 8],
      [59999, 8],
      [60000, 9],
      [299999, 9],
      [300000, 10],
      [10_000_000, 10],
    ]
    cases.forEach(([value, expected]) => {
      expect(histogramBucketIndex(value)).toBe(expected)
    })
  })
})

describe('utcDayOfMs', () => {
  test('splits events at midnight UTC', () => {
    const beforeMidnight = Date.UTC(2023, 10, 14, 23, 59, 59, 999)
    expect(utcDayOfMs(beforeMidnight)).toBe('2023-11-14')
    expect(utcDayOfMs(beforeMidnight + 1)).toBe('2023-11-15')
  })
})

describe('contributor tracker', () => {
  test('counts distinct contributors, dedupes repeats, and clears per day', () => {
    const tracker = createContributorTracker()
    tracker.record(DAY1, 'scope-a', 'actor-1')
    tracker.record(DAY1, 'scope-a', 'actor-1')
    tracker.record(DAY1, 'scope-a', 'actor-2')
    tracker.record('2023-11-15', 'scope-a', 'actor-1')
    expect(tracker.count(DAY1, 'scope-a')).toBe(2)
    tracker.clear(DAY1)
    expect(tracker.count(DAY1, 'scope-a')).toBe(0)
    expect(tracker.count('2023-11-15', 'scope-a')).toBe(1)
  })

  test('uses a process-ephemeral key: stable within a tracker, distinct across trackers', () => {
    const first = createContributorTracker()
    const second = createContributorTracker()
    expect(first.fingerprint('actor-1')).toBe(first.fingerprint('actor-1'))
    expect(first.fingerprint('actor-1')).not.toBe(second.fingerprint('actor-1'))
    expect(first.fingerprint('actor-1')).not.toContain('actor-1')
  })
})

describe('daily aggregator', () => {
  test('accumulates counters and histograms per UTC day and finalizes schema-valid records', () => {
    const events = [
      eventOf(dayFact('auth_checked', { outcome: 'granted', reason: 'member' })),
      eventOf(dayFact('auth_checked', { outcome: 'granted', reason: 'member' }, secondActorSource)),
      eventOf(dayFact('turn_started', { incomingMessageCount: 1, attachmentCount: 0, queueWaitMs: 120 })),
      eventOf(dayFact('turn_started', { incomingMessageCount: 1, attachmentCount: 0, queueWaitMs: 980 })),
    ]
    const records = finalizedFor(events, DAY1)
    records.forEach((record) => {
      expect(AnalyticsAggregateV1Schema.safeParse(record).success).toBe(true)
      expect(record.bucket).toEqual({ utc_day: DAY1, definition_version: 1, finalized: true })
      expect(record.dimensions).toEqual({
        platform: 'telegram',
        context_type: 'dm',
        actor_role: 'member',
        task_provider: 'none',
        app_version: VersionStringSchema.parse('6.10.0'),
      })
      expect(record.quality.restart_gap_detected).toBe(false)
      expect(record.quality.reconciliation).toBe('complete_epoch')
    })

    const granted = measureFor(records, 'auth_granted')
    expect(granted.measure).toMatchObject({ kind: 'counter', value: 2 })
    expect(granted.disclosure).toEqual({
      scope: 'local_only',
      contributor_basis: 'eligible_actor',
      contributor_count: 2,
      threshold: null,
    })

    const queueDelay = histogramMeasureOf(records, 'queue_delay_ms')
    expect(queueDelay).toMatchObject({ sum: 1100, sample_count: 2 })
    expect(queueDelay.counts[1]).toBe(1)
    expect(queueDelay.counts[3]).toBe(1)
    expect(queueDelay.fixed_buckets).toHaveLength(11)
  })

  test('attributes events across midnight UTC to different days', () => {
    const aggregator = createDailyAggregator({ tracker: createContributorTracker() })
    const beforeMidnight = Date.UTC(2023, 10, 14, 23, 59, 59, 999)
    aggregator.apply(
      eventOf(fact('auth_checked', { outcome: 'granted', reason: 'member' }, beforeMidnight, memberSource)),
    )
    aggregator.apply(
      eventOf(fact('auth_checked', { outcome: 'granted', reason: 'member' }, beforeMidnight + 1, memberSource)),
    )
    const day1 = aggregator.finalize(DAY1, { restartGap: false })
    const day2 = aggregator.finalize('2023-11-15', { restartGap: false })
    expect(measureFor(day1, 'auth_granted').measure).toMatchObject({ value: 1 })
    expect(measureFor(day2, 'auth_granted').measure).toMatchObject({ value: 1 })
  })

  test('marks events for an already-finalized day as late and counts them', () => {
    const aggregator = createDailyAggregator({ tracker: createContributorTracker() })
    aggregator.apply(eventOf(dayFact('auth_checked', { outcome: 'granted', reason: 'member' })))
    aggregator.finalize(DAY1, { restartGap: false })
    const late = aggregator.apply(eventOf(dayFact('auth_checked', { outcome: 'granted', reason: 'member' })))
    expect(late).toBe('late')
    expect(aggregator.lateEventCount(DAY1)).toBe(1)
    expect(aggregator.lateEventCount('2023-11-15')).toBe(0)
  })

  test('a restart gap nulls the contributor count and marks the cell unreconciled', () => {
    const events = [
      eventOf(dayFact('auth_checked', { outcome: 'granted', reason: 'member' })),
      eventOf(dayFact('auth_checked', { outcome: 'granted', reason: 'member' }, secondActorSource)),
    ]
    const records = finalizedFor(events, DAY1, true)
    const granted = measureFor(records, 'auth_granted')
    expect(granted.disclosure.contributor_count).toBeNull()
    expect(granted.quality.restart_gap_detected).toBe(true)
    expect(granted.quality.reconciliation).toBe('unreconciled_restart_gap')
  })

  test('guest turns use the context contributor basis', () => {
    const records = finalizedFor(
      [
        eventOf(
          dayFact('guest_turn_aggregate', {
            utcDay: DAY1,
            turns: 5,
            successfulTurns: 4,
            failedTurns: 1,
            contextCount: 3,
          }),
        ),
      ],
      DAY1,
    )
    const guest = measureFor(records, 'guest_turn')
    expect(guest.measure).toMatchObject({ kind: 'counter', value: 5 })
    expect(guest.disclosure.contributor_basis).toBe('context')
  })

  test('finalized aggregates carry no event identity, timestamp, keys, intent, or C2 payload', () => {
    const events = [
      eventOf(dayFact('auth_checked', { outcome: 'granted', reason: 'member' })),
      eventOf(dayFact('turn_started', { incomingMessageCount: 1, attachmentCount: 0, queueWaitMs: 120 })),
    ]
    const serialized = JSON.stringify(finalizedFor(events, DAY1))
    const forbidden = [
      '"id"',
      'occurred_at_ms',
      'ingested_at_ms',
      'actor_key',
      'context_key',
      'thread_key',
      'turn_key',
      'session_key',
      'platform_instance_key',
      'task_instance_key',
      'model_key',
      'tool_key',
      'deployment_key',
      'conversation_key',
      'intent',
      'user-42',
      'pi-1',
      'turn-raw-1',
      'install-uuid-1',
    ]
    forbidden.forEach((needle) => {
      expect(serialized).not.toContain(needle)
    })
  })
})
