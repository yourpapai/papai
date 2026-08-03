// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { AnalyticsAggregateV1Schema } from '../../src/analytics/contracts.js'
import { ANALYTICS_EVENT_REGISTRY_V1 } from '../../src/analytics/registry.js'

describe('ANALYTICS_EVENT_REGISTRY_V1 closure', () => {
  const sortedEventNames = Array.from<string>(ANALYTICS_EVENT_REGISTRY_V1.eventNames).sort()

  const mapKeys = (map: ReadonlyMap<string, unknown>): string[] => Array.from<string>(map.keys()).sort()

  test('has exactly 34 canonical event names', (): void => {
    expect(ANALYTICS_EVENT_REGISTRY_V1.eventNames.length).toBe(34)
  })

  test('event-name keys equal registry events keys', (): void => {
    expect(sortedEventNames).toEqual(Object.keys(ANALYTICS_EVENT_REGISTRY_V1.events).sort())
  })

  test('property-schema keys equal event-name keys', (): void => {
    expect(sortedEventNames).toEqual(Object.keys(ANALYTICS_EVENT_REGISTRY_V1.propsByEventName).sort())
  })

  test('source-map keys equal event-name keys', (): void => {
    expect(sortedEventNames).toEqual(mapKeys(ANALYTICS_EVENT_REGISTRY_V1.sourceFamilyMap))
  })

  test('metric/RQ-map keys equal event-name keys', (): void => {
    expect(sortedEventNames).toEqual(mapKeys(ANALYTICS_EVENT_REGISTRY_V1.metricMapping))
    expect(sortedEventNames).toEqual(mapKeys(ANALYTICS_EVENT_REGISTRY_V1.rqCoverageMap))
  })

  test('excluded source events are not canonical registry names', (): void => {
    const excluded = ['llm:tool_result', 'log:entry', 'message:received', 'turn:summary', 'llm:full']
    for (const name of excluded) {
      expect(ANALYTICS_EVENT_REGISTRY_V1.eventNames.some((n) => n === name)).toBe(false)
    }
  })

  test('aggregate schema rejects identity/correlation pseudonym keys', (): void => {
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
      actor_key: 'v1.p-actor',
      turn_key: 'v1.p-turn',
    }
    const result = AnalyticsAggregateV1Schema.safeParse(aggregate)
    expect(result.success).toBe(false)
  })
})
