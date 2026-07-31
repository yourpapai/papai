// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { BehaviorEventPropsSchemas } from '../../src/analytics/event-props-behavior.js'

const validMultiGoalIntentProps = {
  taxonomy: 'intent.v1',
  primary: 'I23',
  goals: ['I01', 'I02'],
  confidence: 'ge_095',
  strategy: 'hybrid_v1',
  abstained: false,
} as const

describe('intent_classified props', () => {
  test('rejects multi_goal primary with fewer than 2 goals', (): void => {
    const result = BehaviorEventPropsSchemas.intent_classified.safeParse({
      ...validMultiGoalIntentProps,
      goals: ['I01'],
    })
    expect(result.success).toBe(false)
  })

  test('rejects multi_goal primary with more than 3 goals', (): void => {
    const result = BehaviorEventPropsSchemas.intent_classified.safeParse({
      ...validMultiGoalIntentProps,
      goals: ['I01', 'I02', 'I03', 'I04'],
    })
    expect(result.success).toBe(false)
  })

  test('rejects duplicate goals', (): void => {
    const result = BehaviorEventPropsSchemas.intent_classified.safeParse({
      ...validMultiGoalIntentProps,
      goals: ['I01', 'I01', 'I02'],
    })
    expect(result.success).toBe(false)
  })

  test('rejects out-of-order goals', (): void => {
    const result = BehaviorEventPropsSchemas.intent_classified.safeParse({
      ...validMultiGoalIntentProps,
      goals: ['I03', 'I01'],
    })
    expect(result.success).toBe(false)
  })

  test('rejects excluded labels as component goals', (): void => {
    // I21=no_action, I22=unknown, I23=multi_goal are valid IntentV1 labels
    // but must never appear as component goals in the goals array.
    for (const excludedGoal of ['I21', 'I22', 'I23']) {
      const result = BehaviorEventPropsSchemas.intent_classified.safeParse({
        ...validMultiGoalIntentProps,
        goals: ['I01', excludedGoal],
      })
      expect(result.success).toBe(false)
    }
  })

  test('accepts a valid 2-goal multi_goal array', (): void => {
    const result = BehaviorEventPropsSchemas.intent_classified.safeParse({
      ...validMultiGoalIntentProps,
      goals: ['I01', 'I02'],
    })
    expect(result.success).toBe(true)
  })

  test('accepts a valid 3-goal multi_goal array', (): void => {
    const result = BehaviorEventPropsSchemas.intent_classified.safeParse({
      ...validMultiGoalIntentProps,
      goals: ['I01', 'I02', 'I03'],
    })
    expect(result.success).toBe(true)
  })

  test('accepts a non-multi_goal primary with an empty goals array', (): void => {
    const result = BehaviorEventPropsSchemas.intent_classified.safeParse({
      ...validMultiGoalIntentProps,
      primary: 'I01',
      goals: [],
    })
    expect(result.success).toBe(true)
  })

  test('accepts a non-multi_goal primary with a single-goal array', (): void => {
    const result = BehaviorEventPropsSchemas.intent_classified.safeParse({
      ...validMultiGoalIntentProps,
      primary: 'I01',
      goals: ['I02'],
    })
    expect(result.success).toBe(true)
  })
})
