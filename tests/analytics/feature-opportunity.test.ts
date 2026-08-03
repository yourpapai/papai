// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  FEATURE_OPPORTUNITY_REFERENCE_DOMAIN,
  FEATURE_PRODUCERS,
  FEATURE_V1,
  featureOpportunitySnapshot,
  featureOpportunitySourceReference,
} from '../../src/analytics/feature-opportunity.js'

describe('featureOpportunitySourceReference', () => {
  test('is deterministic for the same actor basis, feature, and day', () => {
    const a = featureOpportunitySourceReference({ actorBasis: 'pi-1|u-1', feature: 'coding', utcDay: '2026-07-25' })
    const b = featureOpportunitySourceReference({ actorBasis: 'pi-1|u-1', feature: 'coding', utcDay: '2026-07-25' })
    expect(a).toBe(b)
    expect(a).not.toContain('u-1')
  })

  test('differs across features and days', () => {
    const base = { actorBasis: 'pi-1|u-1', utcDay: '2026-07-25' }
    expect(featureOpportunitySourceReference({ ...base, feature: 'coding' })).not.toBe(
      featureOpportunitySourceReference({ ...base, feature: 'mcp' }),
    )
    expect(featureOpportunitySourceReference({ ...base, feature: 'coding' })).not.toBe(
      featureOpportunitySourceReference({ actorBasis: base.actorBasis, feature: 'coding', utcDay: '2026-07-26' }),
    )
  })
})

describe('featureOpportunitySnapshot', () => {
  test('covers every registered feature exactly once', () => {
    const snapshot = featureOpportunitySnapshot({
      mode: 'normal',
      contextType: 'dm',
      hasProvider: true,
      hasChatUser: true,
      codingPluginActive: true,
      mcpToolCount: 2,
    })
    expect(snapshot.map((entry) => entry.feature).sort()).toEqual([...FEATURE_V1].sort())
  })
})

describe('FEATURE_PRODUCERS', () => {
  test('registers one named producer per kind for every feature', () => {
    for (const feature of FEATURE_V1) {
      const producers = FEATURE_PRODUCERS[feature]
      expect(producers.opportunity.length).toBeGreaterThan(0)
      expect(producers.success.length).toBeGreaterThan(0)
      expect(producers.failure.length).toBeGreaterThan(0)
      expect(producers.blocked.length).toBeGreaterThan(0)
    }
  })
})

describe('reference domain', () => {
  test('uses the frozen v1 domain', () => {
    expect(FEATURE_OPPORTUNITY_REFERENCE_DOMAIN).toBe('feature-opportunity:v1')
  })
})
