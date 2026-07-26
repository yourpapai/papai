// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { TerminalOutcome, TurnGoalFacts } from '../../../src/analytics/derive/outcomes.js'
import {
  buildGoalAttempts,
  isClarificationAbandonmentMature,
  OBSERVATION_WINDOW_MS,
  RECOVERY_WINDOW_MS,
} from '../../../src/analytics/derive/outcomes.js'

const KEY_INPUT = { key: Buffer.alloc(32, 9), keyVersion: 'v1' } as const

const HOUR = 3_600_000
const DAY = OBSERVATION_WINDOW_MS

const turn = (
  overrides: Partial<TurnGoalFacts> & Pick<TurnGoalFacts, 'turnKey' | 'turnStartMs' | 'turnEndMs'>,
): TurnGoalFacts => ({
  actorKey: 'v1.p-actor',
  conversationKey: 'v1.p-conv',
  anchorEventId: `anchor-${overrides.turnKey}`,
  goals: ['I01'],
  executedOutcomes: [],
  clarification: false,
  ...overrides,
})

const outcomesOf = (
  turns: readonly TurnGoalFacts[],
  nowMs: number,
  censorStartMs: number | null = null,
): ReadonlyMap<string, TerminalOutcome> =>
  new Map(
    buildGoalAttempts(turns, { nowMs, censorStartMs }, KEY_INPUT).map((attempt) => [attempt.goal, attempt.outcome]),
  )

describe('outcome v1 terminal categories', () => {
  test('success in the initiating turn with no earlier failure is immediate_success', () => {
    const result = buildGoalAttempts(
      [turn({ turnKey: 'v1.p-t1', turnStartMs: 0, turnEndMs: 1_000, executedOutcomes: ['semantic_success'] })],
      { nowMs: DAY * 2, censorStartMs: null },
      KEY_INPUT,
    )
    expect(result).toHaveLength(1)
    expect(result[0]?.outcome).toBe('immediate_success')
    expect(result[0]?.resolvedAtMs).toBe(1_000)
    expect(result[0]?.matureAtMs).toBe(1_000 + DAY)
    expect(result[0]?.outcomeVersion).toBe(1)
  })

  test('failure then success in the same turn is recovered_same_turn, never first-time success', () => {
    const result = buildGoalAttempts(
      [
        turn({
          turnKey: 'v1.p-t1',
          turnStartMs: 0,
          turnEndMs: 1_000,
          executedOutcomes: ['structured_failure', 'semantic_success'],
        }),
      ],
      { nowMs: DAY * 2, censorStartMs: null },
      KEY_INPUT,
    )
    expect(result[0]?.outcome).toBe('recovered_same_turn')
    expect(result[0]?.outcome).not.toBe('immediate_success')
  })

  test('success before a later failure stays immediate_success', () => {
    const result = buildGoalAttempts(
      [
        turn({
          turnKey: 'v1.p-t1',
          turnStartMs: 0,
          turnEndMs: 1_000,
          executedOutcomes: ['semantic_success', 'thrown_failure'],
        }),
      ],
      { nowMs: DAY * 2, censorStartMs: null },
      KEY_INPUT,
    )
    expect(result[0]?.outcome).toBe('immediate_success')
  })

  test('same-goal success in a later turn within 30 minutes is recovered_next_turn', () => {
    expect(RECOVERY_WINDOW_MS).toBe(1_800_000)
    const result = buildGoalAttempts(
      [
        turn({ turnKey: 'v1.p-t1', turnStartMs: 0, turnEndMs: 1_000, executedOutcomes: ['thrown_failure'] }),
        turn({
          turnKey: 'v1.p-t2',
          turnStartMs: 1_000 + 20 * 60_000,
          turnEndMs: 1_000 + 20 * 60_000 + 500,
          executedOutcomes: ['semantic_success'],
        }),
      ],
      { nowMs: DAY * 2, censorStartMs: null },
      KEY_INPUT,
    )
    const first = result.find((attempt) => attempt.turnKey === 'v1.p-t1')
    const second = result.find((attempt) => attempt.turnKey === 'v1.p-t2')
    expect(first?.outcome).toBe('recovered_next_turn')
    expect(first?.resolvedAtMs).toBe(1_000 + 20 * 60_000 + 500)
    expect(second?.outcome).toBe('immediate_success')
  })

  test('same-goal follow-up within 24 hours without timely success is unresolved_engaged', () => {
    const result = buildGoalAttempts(
      [
        turn({ turnKey: 'v1.p-t1', turnStartMs: 0, turnEndMs: 1_000 }),
        turn({ turnKey: 'v1.p-t2', turnStartMs: 2 * HOUR, turnEndMs: 2 * HOUR + 500 }),
      ],
      { nowMs: DAY * 2, censorStartMs: null },
      KEY_INPUT,
    )
    const first = result.find((attempt) => attempt.turnKey === 'v1.p-t1')
    expect(first?.outcome).toBe('unresolved_engaged')
    expect(first?.resolvedAtMs).toBe(2 * HOUR)
  })

  test('mature unresolved attempt with failure is abandoned_after_failure', () => {
    const result = outcomesOf(
      [turn({ turnKey: 'v1.p-t1', turnStartMs: 0, turnEndMs: 1_000, executedOutcomes: ['structured_failure'] })],
      DAY * 2,
    )
    expect(result.get('I01')).toBe('abandoned_after_failure')
  })

  test('mature unresolved attempt with clarification is abandoned_after_clarification', () => {
    const result = outcomesOf(
      [turn({ turnKey: 'v1.p-t1', turnStartMs: 0, turnEndMs: 1_000, clarification: true })],
      DAY * 2,
    )
    expect(result.get('I01')).toBe('abandoned_after_clarification')
  })

  test('mature unresolved attempt with no failure and no clarification is abandoned_after_no_action', () => {
    const result = outcomesOf([turn({ turnKey: 'v1.p-t1', turnStartMs: 0, turnEndMs: 1_000 })], DAY * 2)
    expect(result.get('I01')).toBe('abandoned_after_no_action')
  })

  test('an attempt younger than 24 hours is censored, never abandoned', () => {
    const result = outcomesOf(
      [turn({ turnKey: 'v1.p-t1', turnStartMs: 0, turnEndMs: 1_000, executedOutcomes: ['thrown_failure'] })],
      1_000 + DAY - 1,
    )
    expect(result.get('I01')).toBe('censored')
  })

  test('eligibility ending before maturity right-censors instead of abandoning', () => {
    const result = buildGoalAttempts(
      [turn({ turnKey: 'v1.p-t1', turnStartMs: 0, turnEndMs: 1_000, executedOutcomes: ['thrown_failure'] })],
      { nowMs: DAY * 2, censorStartMs: 12 * HOUR },
      KEY_INPUT,
    )
    expect(result[0]?.outcome).toBe('censored')
    expect(result[0]?.resolvedAtMs).toBeNull()
  })

  test('a structured tool failure is not success', () => {
    const result = outcomesOf(
      [turn({ turnKey: 'v1.p-t1', turnStartMs: 0, turnEndMs: 1_000, executedOutcomes: ['structured_failure'] })],
      DAY * 2,
    )
    expect(result.get('I01')).not.toBe('immediate_success')
    expect(result.get('I01')).toBe('abandoned_after_failure')
  })

  test('reply-only is not success', () => {
    const result = outcomesOf([turn({ turnKey: 'v1.p-t1', turnStartMs: 0, turnEndMs: 1_000 })], DAY * 2)
    expect(result.get('I01')).not.toBe('immediate_success')
    expect(result.get('I01')).toBe('abandoned_after_no_action')
  })

  test('a permission denial is not an executed failure', () => {
    const result = outcomesOf([turn({ turnKey: 'v1.p-t1', turnStartMs: 0, turnEndMs: 1_000 })], DAY * 2)
    expect(result.get('I01')).not.toBe('abandoned_after_failure')
  })

  test('a multi-goal turn creates up to three attempts but remains one turn', () => {
    const result = buildGoalAttempts(
      [turn({ turnKey: 'v1.p-t1', turnStartMs: 0, turnEndMs: 1_000, goals: ['I01', 'I02', 'I03'] })],
      { nowMs: DAY * 2, censorStartMs: null },
      KEY_INPUT,
    )
    expect(result).toHaveLength(3)
    expect(new Set(result.map((attempt) => attempt.turnKey)).size).toBe(1)
    expect(result.map((attempt) => attempt.goal)).toEqual(['I01', 'I02', 'I03'])
    expect(new Set(result.map((attempt) => attempt.attemptKey)).size).toBe(3)
  })

  test('turns without component goals create no attempts', () => {
    const result = buildGoalAttempts(
      [turn({ turnKey: 'v1.p-t1', turnStartMs: 0, turnEndMs: 1_000, goals: [] })],
      { nowMs: DAY * 2, censorStartMs: null },
      KEY_INPUT,
    )
    expect(result).toHaveLength(0)
  })

  test('attempt keys are deterministic', () => {
    const first = buildGoalAttempts(
      [turn({ turnKey: 'v1.p-t1', turnStartMs: 0, turnEndMs: 1_000 })],
      { nowMs: DAY * 2, censorStartMs: null },
      KEY_INPUT,
    )
    const second = buildGoalAttempts(
      [turn({ turnKey: 'v1.p-t1', turnStartMs: 0, turnEndMs: 1_000 })],
      { nowMs: DAY * 2, censorStartMs: null },
      KEY_INPUT,
    )
    expect(first[0]?.attemptKey).toBe(second[0]?.attemptKey)
  })
})

describe('clarification abandonment maturity', () => {
  const source = turn({ turnKey: 'v1.p-t1', turnStartMs: 0, turnEndMs: 1_000, clarification: true })

  test('a structured clarification is mature only after 24 hours with no same-goal follow-up', () => {
    expect(isClarificationAbandonmentMature(source, [], { nowMs: 1_000 + DAY, censorStartMs: null })).toBe(true)
    expect(isClarificationAbandonmentMature(source, [], { nowMs: 1_000 + DAY - 1, censorStartMs: null })).toBe(false)
  })

  test('a same-goal follow-up within 24 hours keeps the clarification engaged', () => {
    const followUp = turn({ turnKey: 'v1.p-t2', turnStartMs: 2 * HOUR, turnEndMs: 2 * HOUR + 500 })
    expect(isClarificationAbandonmentMature(source, [followUp], { nowMs: DAY * 2, censorStartMs: null })).toBe(false)
  })

  test('a different-goal follow-up does not engage the clarification', () => {
    const followUp = turn({ turnKey: 'v1.p-t2', turnStartMs: 2 * HOUR, turnEndMs: 2 * HOUR + 500, goals: ['I05'] })
    expect(isClarificationAbandonmentMature(source, [followUp], { nowMs: DAY * 2, censorStartMs: null })).toBe(true)
  })

  test('withdrawal before maturity keeps the observation censored', () => {
    expect(isClarificationAbandonmentMature(source, [], { nowMs: DAY * 2, censorStartMs: 12 * HOUR })).toBe(false)
  })

  test('a turn without clarification never materializes abandonment', () => {
    const noClarification = turn({ turnKey: 'v1.p-t3', turnStartMs: 0, turnEndMs: 1_000 })
    expect(isClarificationAbandonmentMature(noClarification, [], { nowMs: DAY * 2, censorStartMs: null })).toBe(false)
  })
})
