// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { TurnFrictionFacts } from '../../../src/analytics/derive/friction.js'
import {
  computeTurnFriction,
  frictionDisplayScore,
  hasFailureChain,
  LONG_TURN_MS,
} from '../../../src/analytics/derive/friction.js'

const facts = (overrides: Partial<TurnFrictionFacts>): TurnFrictionFacts => ({
  turnKey: 'v1.p-turn',
  actorKey: 'v1.p-actor',
  conversationKey: 'v1.p-conv',
  occurredAtMs: 1_700_000_000_000,
  anchorEventId: 'anchor-1',
  durationMs: 1_000,
  hasRephrase: false,
  hasClarificationAbandoned: false,
  hasPermissionIssue: false,
  hasStop: false,
  hasDisclosureFallback: false,
  executedOutcomes: [],
  ...overrides,
})

describe('friction v1 components', () => {
  test('each of the seven components sets exactly its own bit', () => {
    const cases = [
      [facts({ hasRephrase: true }), 'rephrase'],
      [facts({ hasClarificationAbandoned: true }), 'clarificationAbandoned'],
      [facts({ hasPermissionIssue: true }), 'permissionIssue'],
      [facts({ hasStop: true }), 'stop'],
      [facts({ durationMs: LONG_TURN_MS + 1 }), 'longTurn'],
      [facts({ hasDisclosureFallback: true }), 'disclosureFallback'],
      [facts({ executedOutcomes: ['structured_failure', 'thrown_failure'] }), 'failureChain'],
    ] as const
    for (const [input, component] of cases) {
      const result = computeTurnFriction(input)
      expect(result.componentCount).toBe(1)
      const setComponents = Object.entries(result.components)
        .filter(([, value]) => value)
        .map(([name]) => name)
      expect(setComponents).toEqual([component])
    }
  })

  test('a clean turn has count 0 and score 0', () => {
    const result = computeTurnFriction(facts({}))
    expect(result.componentCount).toBe(0)
    expect(result.displayScore).toBe(0)
  })

  test('all seven components give count 7 and score 100', () => {
    const result = computeTurnFriction(
      facts({
        hasRephrase: true,
        hasClarificationAbandoned: true,
        hasPermissionIssue: true,
        hasStop: true,
        durationMs: 60_000,
        hasDisclosureFallback: true,
        executedOutcomes: ['thrown_failure', 'structured_failure'],
      }),
    )
    expect(result.componentCount).toBe(7)
    expect(result.displayScore).toBe(100)
  })

  test('the count is the plain sum of bits and the score is round(100 * count / 7)', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(frictionDisplayScore)).toEqual([0, 14, 29, 43, 57, 71, 86, 100])
  })

  test('a turn longer than 30s is long; exactly 30s is not', () => {
    expect(LONG_TURN_MS).toBe(30_000)
    expect(computeTurnFriction(facts({ durationMs: 30_000 })).components.longTurn).toBe(false)
    expect(computeTurnFriction(facts({ durationMs: 30_001 })).components.longTurn).toBe(true)
    expect(computeTurnFriction(facts({ durationMs: null })).components.longTurn).toBe(false)
  })

  test('two consecutive failures with no intervening success form a chain', () => {
    expect(hasFailureChain(['structured_failure', 'thrown_failure'])).toBe(true)
    expect(hasFailureChain(['semantic_success', 'structured_failure', 'thrown_failure'])).toBe(true)
  })

  test('an intervening success clears the chain', () => {
    expect(hasFailureChain(['structured_failure', 'semantic_success', 'thrown_failure'])).toBe(false)
    expect(hasFailureChain(['semantic_success'])).toBe(false)
    expect(hasFailureChain([])).toBe(false)
    expect(hasFailureChain(['structured_failure'])).toBe(false)
  })

  test('friction rows are versioned and carry the anchor event', () => {
    const result = computeTurnFriction(facts({ hasStop: true }))
    expect(result.frictionVersion).toBe(1)
    expect(result.anchorEventId).toBe('anchor-1')
  })
})
