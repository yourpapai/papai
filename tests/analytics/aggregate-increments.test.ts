// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { AggregateIncrement } from '../../src/analytics/aggregate-increments.js'
import { incrementsForEvent } from '../../src/analytics/aggregate-increments.js'
import { AnalyticsEventV1Schema } from '../../src/analytics/contracts.js'

const counterIncrement = (metric: AggregateIncrement): readonly AggregateIncrement[] => [metric]

describe('aggregate-increments module surface', () => {
  test('incrementsForEvent is the pure increment mapping exported from the extracted module', () => {
    const event = AnalyticsEventV1Schema.parse({
      schema: { name: 'papai.analytics.event', version: 1 },
      event: {
        id: 'v1.p-event-id',
        name: 'auth_checked',
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
      context: { context_type: 'dm', actor_role: 'admin', task_provider: 'none', invocation_mode: 'normal' },
      correlation: { conversation_key: 'v1.p-conversation', turn_key: 'v1.p-turn', session_key: null },
      governance: {
        purpose: 'product_analytics',
        collection_tier: 'aggregate',
        policy_version: 1,
        eligibility: 'allowed',
      },
      privacy: { max_class: 'C0' },
      props: { outcome: 'granted', reason: 'member' },
    })
    expect(incrementsForEvent(event)).toEqual(counterIncrement({ kind: 'counter', metric: 'auth_granted', delta: 1 }))
  })
})
