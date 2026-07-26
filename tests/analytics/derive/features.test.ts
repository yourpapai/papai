// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { FeatureOpportunityFact, FeatureUseFact } from '../../../src/analytics/derive/features.js'
import { eligibleActorDayDenominator, materializeFeatureDays } from '../../../src/analytics/derive/features.js'

const DAY_ONE_MS = Date.UTC(2026, 6, 26, 10, 0, 0)
const DAY_TWO_MS = Date.UTC(2026, 6, 27, 10, 0, 0)
const DAY_ONE = '2026-07-26'
const DAY_TWO = '2026-07-27'

const opportunity = (
  eventId: string,
  occurredAtMs: number,
  available = true,
  reason = 'available',
  actorKey = 'v1.p-actor',
  feature = 'coding',
): FeatureOpportunityFact => ({ eventId, actorKey, feature, available, reason, occurredAtMs })

const use = (
  eventId: string,
  occurredAtMs: number,
  outcome: 'success' | 'failure' | 'blocked',
  actorKey = 'v1.p-actor',
  feature = 'coding',
): FeatureUseFact => ({ eventId, actorKey, feature, outcome, occurredAtMs })

describe('feature materialization', () => {
  test('one opportunity per (actor, feature, UTC day) keeps the first eligible snapshot', () => {
    const result = materializeFeatureDays({
      opportunities: [
        opportunity('v1.p-opp-late', DAY_ONE_MS + 5_000, false, 'configuration_missing'),
        opportunity('v1.p-opp-early', DAY_ONE_MS, true),
      ],
      uses: [],
    })
    expect(result.opportunities).toHaveLength(1)
    expect(result.opportunities[0]?.opportunityEventId).toBe('v1.p-opp-early')
    expect(result.opportunities[0]?.available).toBe(true)
    expect(result.opportunities[0]?.utcDay).toBe(DAY_ONE)
    expect(result.opportunities[0]?.definitionVersion).toBe(1)
  })

  test('changed capability is snapshotted again the next day', () => {
    const result = materializeFeatureDays({
      opportunities: [
        opportunity('v1.p-opp-1', DAY_ONE_MS, true),
        opportunity('v1.p-opp-2', DAY_TWO_MS, false, 'provider_missing'),
      ],
      uses: [],
    })
    expect(result.opportunities).toHaveLength(2)
    expect(result.opportunities.map((row) => [row.utcDay, row.available, row.reason])).toEqual([
      [DAY_ONE, true, 'available'],
      [DAY_TWO, false, 'provider_missing'],
    ])
  })

  test('use without an opportunity is recorded but never joined or adopted', () => {
    const result = materializeFeatureDays({
      opportunities: [],
      uses: [use('v1.p-use-1', DAY_ONE_MS, 'success')],
    })
    expect(result.uses).toHaveLength(1)
    expect(result.uses[0]?.successCount).toBe(1)
    expect(result.uses[0]?.joinedAvailable).toBe(false)
    expect(result.uses[0]?.adopted).toBe(false)
  })

  test('use joins only to a same-day available=true opportunity', () => {
    const result = materializeFeatureDays({
      opportunities: [opportunity('v1.p-opp-1', DAY_ONE_MS, false, 'role_denied')],
      uses: [use('v1.p-use-1', DAY_ONE_MS, 'success')],
    })
    expect(result.uses[0]?.joinedAvailable).toBe(false)
    expect(result.uses[0]?.adopted).toBe(false)
    const crossDay = materializeFeatureDays({
      opportunities: [opportunity('v1.p-opp-1', DAY_TWO_MS, true)],
      uses: [use('v1.p-use-1', DAY_ONE_MS, 'success')],
    })
    expect(crossDay.uses[0]?.joinedAvailable).toBe(false)
  })

  test('blocked use counts as blocked and is not adoption', () => {
    const result = materializeFeatureDays({
      opportunities: [opportunity('v1.p-opp-1', DAY_ONE_MS, true)],
      uses: [use('v1.p-use-1', DAY_ONE_MS, 'blocked')],
    })
    expect(result.uses[0]?.blockedCount).toBe(1)
    expect(result.uses[0]?.successCount).toBe(0)
    expect(result.uses[0]?.joinedAvailable).toBe(true)
    expect(result.uses[0]?.adopted).toBe(false)
  })

  test('successful adoption requires a same-day available opportunity plus a success', () => {
    const result = materializeFeatureDays({
      opportunities: [opportunity('v1.p-opp-1', DAY_ONE_MS, true)],
      uses: [use('v1.p-use-1', DAY_ONE_MS, 'failure'), use('v1.p-use-2', DAY_ONE_MS + 1_000, 'success')],
    })
    expect(result.uses[0]?.failureCount).toBe(1)
    expect(result.uses[0]?.successCount).toBe(1)
    expect(result.uses[0]?.adopted).toBe(true)
    expect(result.uses[0]?.firstUseEventId).toBe('v1.p-use-1')
  })

  test('eligible actor-day denominators count only available opportunity days, never all actors', () => {
    const result = materializeFeatureDays({
      opportunities: [
        opportunity('v1.p-opp-1', DAY_ONE_MS, true, 'available', 'v1.p-actor-a'),
        opportunity('v1.p-opp-2', DAY_ONE_MS, false, 'role_denied', 'v1.p-actor-b'),
        opportunity('v1.p-opp-3', DAY_TWO_MS, true, 'available', 'v1.p-actor-b'),
      ],
      uses: [],
    })
    expect(eligibleActorDayDenominator(result.opportunities, 'coding', DAY_ONE)).toBe(1)
    expect(eligibleActorDayDenominator(result.opportunities, 'coding', DAY_TWO)).toBe(1)
    expect(eligibleActorDayDenominator(result.opportunities, 'mcp', DAY_ONE)).toBe(0)
  })
})
