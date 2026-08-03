// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { PseudonymSchema } from '../../../src/analytics/controlled-types.js'
import type { Pseudonym } from '../../../src/analytics/controlled-types.js'
import type {
  RephraseCoverageLossReason,
  RephrasePairDetection,
  RephraseTurnOutcome,
} from '../../../src/analytics/intent/rephrase.js'
import { REPHARSE_SET_TTL_MS } from '../../../src/analytics/intent/rephrase.js'
import { createRephraseHandoff } from '../../../src/analytics/rephrase/handoff.js'
import type { RephraseHandoff } from '../../../src/analytics/rephrase/handoff.js'
import type { RephraseSetInspection } from '../../../src/analytics/rephrase/state.js'

const T0 = 1_700_000_000_000
const px = (suffix: string): Pseudonym => PseudonymSchema.parse(`v1.${suffix}`)

const ACTOR = px('actor-one')
const OTHER_ACTOR = px('actor-two')
const CONV_A = px('conv-a')
const CONV_B = px('conv-b')

const TEXT = 'please create a task to review the lighthouse budget report'
const OTHER_TEXT = 'fetch the public example page and archive it somewhere safe'

type Harness = Readonly<{
  handoff: RephraseHandoff
  inspect: ReturnType<typeof createRephraseHandoff>['inspect']
  dispose: () => void
  pairs: RephrasePairDetection[]
  losses: RephraseCoverageLossReason[]
  setNow: (value: number) => void
}>

const createHarness = (): Harness => {
  let now = T0
  const pairs: RephrasePairDetection[] = []
  const losses: RephraseCoverageLossReason[] = []
  const created = createRephraseHandoff({
    nowMs: () => now,
    onPairDetected: (pair) => {
      pairs.push(pair)
    },
    onCoverageLoss: (reason) => {
      losses.push(reason)
    },
  })
  return {
    handoff: created.handoff,
    inspect: created.inspect,
    dispose: created.dispose,
    pairs,
    losses,
    setNow: (value: number) => {
      now = value
    },
  }
}

const capture = (
  handoff: RephraseHandoff,
  turn: string,
  capturedAtMs: number,
  text: string = TEXT,
  actor: Pseudonym = ACTOR,
  conversation: Pseudonym = CONV_A,
): void => {
  handoff.captureText({
    actorKey: actor,
    conversationKey: conversation,
    turnKey: px(turn),
    capturedAtMs,
    text,
  })
}

const complete = (
  handoff: RephraseHandoff,
  turn: string,
  completedAtMs: number,
  outcome: RephraseTurnOutcome,
): void => {
  handoff.completeTurn({ turnKey: px(turn), completedAtMs, outcome })
}

const conversationSets = (
  inspect: Harness['inspect'],
  actor: Pseudonym,
  conversation: Pseudonym,
): readonly RephraseSetInspection[] =>
  inspect().conversations.find((entry) => entry.actorKey === actor && entry.conversationKey === conversation)?.sets ??
  []

describe('rephrase handoff lifecycle', () => {
  let harness: Harness

  beforeEach(() => {
    harness = createHarness()
  })

  test('capture discards the raw string and builds features immediately', () => {
    const canary = 'CANARY-raw-text-7f3e9d-quixotic'
    capture(harness.handoff, 'turn-1', T0, canary)
    const sets = conversationSets(harness.inspect, ACTOR, CONV_A)
    expect(sets).toHaveLength(1)
    expect(sets[0]?.shingleCount).toBeGreaterThan(0)
    expect(JSON.stringify(harness.inspect())).not.toContain('CANARY-raw-text-7f3e9d-quixotic')
    expect(JSON.stringify(harness.inspect())).not.toContain('quixotic')
  })

  test('an unresolved prior within ten minutes produces one pair at capture', () => {
    capture(harness.handoff, 'turn-1', T0)
    complete(harness.handoff, 'turn-1', T0 + 1_000, 'clarification')
    capture(harness.handoff, 'turn-2', T0 + 60_000)
    expect(harness.pairs).toHaveLength(1)
    const pair = harness.pairs[0]
    expect(pair?.detector).toBe('lexical_v1')
    expect(pair?.similarity).toBe('ge_095')
    expect(pair?.priorOutcome).toBe('clarification')
    expect(pair?.gap).toBe('le_2m')
    expect(pair?.priorTurnKey).toBe(px('turn-1'))
    expect(pair?.laterTurnKey).toBe(px('turn-2'))
    const later = conversationSets(harness.inspect, ACTOR, CONV_A).find((set) => set.turnKey === px('turn-2'))
    expect(later?.matchedPriorTurnKey).toBe(px('turn-1'))
  })

  test('prior_outcome is copied exactly from the matched prior terminal', () => {
    capture(harness.handoff, 'turn-1', T0)
    complete(harness.handoff, 'turn-1', T0 + 1_000, 'failure')
    capture(harness.handoff, 'turn-2', T0 + 30_000)
    complete(harness.handoff, 'turn-2', T0 + 40_000, 'clarification')
    capture(harness.handoff, 'turn-3', T0 + 90_000)
    expect(harness.pairs.map((pair) => pair.priorOutcome)).toEqual(['failure', 'clarification'])
  })

  test('a no_action prior yields a no_action pair outcome', () => {
    capture(harness.handoff, 'turn-1', T0)
    complete(harness.handoff, 'turn-1', T0 + 1_000, 'no_action')
    capture(harness.handoff, 'turn-2', T0 + 30_000)
    expect(harness.pairs).toHaveLength(1)
    expect(harness.pairs[0]?.priorOutcome).toBe('no_action')
  })

  test('dissimilar rephrasing never matches', () => {
    capture(harness.handoff, 'turn-1', T0, TEXT)
    complete(harness.handoff, 'turn-1', T0 + 1_000, 'failure')
    capture(harness.handoff, 'turn-2', T0 + 30_000, OTHER_TEXT)
    expect(harness.pairs).toHaveLength(0)
    const later = conversationSets(harness.inspect, ACTOR, CONV_A).find((set) => set.turnKey === px('turn-2'))
    expect(later?.matchedPriorTurnKey).toBeNull()
  })

  test('only the newest unresolved prior is compared', () => {
    capture(harness.handoff, 'turn-1', T0, OTHER_TEXT)
    complete(harness.handoff, 'turn-1', T0 + 1_000, 'failure')
    capture(harness.handoff, 'turn-2', T0 + 10_000, TEXT)
    complete(harness.handoff, 'turn-2', T0 + 11_000, 'clarification')
    capture(harness.handoff, 'turn-3', T0 + 20_000, TEXT)
    expect(harness.pairs).toHaveLength(1)
    expect(harness.pairs[0]?.priorTurnKey).toBe(px('turn-2'))
  })

  test('matched success removes the current set and only its matched prior', () => {
    capture(harness.handoff, 'turn-1', T0)
    complete(harness.handoff, 'turn-1', T0 + 1_000, 'clarification')
    capture(harness.handoff, 'turn-2', T0 + 10_000, OTHER_TEXT)
    complete(harness.handoff, 'turn-2', T0 + 11_000, 'failure')
    capture(harness.handoff, 'turn-3', T0 + 20_000)
    complete(harness.handoff, 'turn-3', T0 + 30_000, 'success')
    const sets = conversationSets(harness.inspect, ACTOR, CONV_A)
    expect(sets.map((set) => set.turnKey)).toEqual([px('turn-2')])
    expect(harness.pairs).toHaveLength(1)
  })

  test('unmatched success removes only the current set', () => {
    capture(harness.handoff, 'turn-1', T0, OTHER_TEXT)
    complete(harness.handoff, 'turn-1', T0 + 1_000, 'failure')
    capture(harness.handoff, 'turn-2', T0 + 10_000, TEXT)
    complete(harness.handoff, 'turn-2', T0 + 20_000, 'success')
    const sets = conversationSets(harness.inspect, ACTOR, CONV_A)
    expect(sets.map((set) => set.turnKey)).toEqual([px('turn-1')])
  })

  test('an unrelated abandoned goal is never resolved by a later success', () => {
    capture(harness.handoff, 'turn-1', T0, OTHER_TEXT)
    complete(harness.handoff, 'turn-1', T0 + 1_000, 'clarification')
    capture(harness.handoff, 'turn-2', T0 + 10_000, TEXT)
    complete(harness.handoff, 'turn-2', T0 + 20_000, 'success')
    const sets = conversationSets(harness.inspect, ACTOR, CONV_A)
    expect(sets.map((set) => set.turnKey)).toEqual([px('turn-1')])
    expect(sets[0]?.status).toBe('unresolved')
  })

  test('discard removes only the current set', () => {
    capture(harness.handoff, 'turn-1', T0)
    complete(harness.handoff, 'turn-1', T0 + 1_000, 'failure')
    capture(harness.handoff, 'turn-2', T0 + 10_000)
    complete(harness.handoff, 'turn-2', T0 + 20_000, 'discard')
    const sets = conversationSets(harness.inspect, ACTOR, CONV_A)
    expect(sets.map((set) => set.turnKey)).toEqual([px('turn-1')])
  })

  test('withdrawal removes every pending and unresolved set for the actor without coverage loss', () => {
    capture(harness.handoff, 'turn-1', T0, TEXT, ACTOR, CONV_A)
    complete(harness.handoff, 'turn-1', T0 + 1_000, 'failure')
    capture(harness.handoff, 'turn-2', T0 + 10_000, TEXT, ACTOR, CONV_B)
    capture(harness.handoff, 'turn-3', T0 + 20_000, TEXT, OTHER_ACTOR, CONV_A)
    harness.handoff.withdraw({ actorKey: ACTOR })
    expect(harness.inspect().conversations.filter((entry) => entry.actorKey === ACTOR)).toHaveLength(0)
    expect(conversationSets(harness.inspect, OTHER_ACTOR, CONV_A)).toHaveLength(1)
    expect(harness.losses).toHaveLength(0)
  })

  test('a fourth capture evicts the oldest set and counts coverage loss', () => {
    capture(harness.handoff, 'turn-1', T0)
    capture(harness.handoff, 'turn-2', T0 + 1_000, OTHER_TEXT)
    capture(harness.handoff, 'turn-3', T0 + 2_000, TEXT)
    capture(harness.handoff, 'turn-4', T0 + 3_000, OTHER_TEXT)
    const sets = conversationSets(harness.inspect, ACTOR, CONV_A)
    expect(sets.map((set) => set.turnKey)).toEqual([px('turn-2'), px('turn-3'), px('turn-4')])
    expect(harness.losses).toEqual(['eviction'])
  })

  test('sets expire at exactly thirty minutes and count coverage loss', () => {
    capture(harness.handoff, 'turn-1', T0)
    harness.setNow(T0 + REPHARSE_SET_TTL_MS - 1)
    capture(harness.handoff, 'turn-2', T0 + REPHARSE_SET_TTL_MS - 1, OTHER_TEXT)
    expect(conversationSets(harness.inspect, ACTOR, CONV_A)).toHaveLength(2)
    expect(harness.losses).toHaveLength(0)
    harness.setNow(T0 + REPHARSE_SET_TTL_MS)
    capture(harness.handoff, 'turn-3', T0 + REPHARSE_SET_TTL_MS, TEXT)
    const sets = conversationSets(harness.inspect, ACTOR, CONV_A)
    expect(sets.map((set) => set.turnKey)).toEqual([px('turn-2'), px('turn-3')])
    expect(harness.losses).toEqual(['expiry'])
  })

  test('a terminal before its capture is preserved as a bounded marker and consumed', () => {
    complete(harness.handoff, 'turn-1', T0, 'failure')
    expect(harness.inspect().pendingTerminals).toHaveLength(1)
    capture(harness.handoff, 'turn-1', T0 + 1_000)
    expect(harness.inspect().pendingTerminals).toHaveLength(0)
    capture(harness.handoff, 'turn-2', T0 + 30_000)
    expect(harness.pairs).toHaveLength(1)
    expect(harness.pairs[0]?.priorOutcome).toBe('failure')
  })

  test('a discard terminal before its capture resolves the set immediately', () => {
    complete(harness.handoff, 'turn-1', T0, 'discard')
    capture(harness.handoff, 'turn-1', T0 + 1_000)
    expect(conversationSets(harness.inspect, ACTOR, CONV_A)).toHaveLength(0)
    expect(harness.inspect().pendingTerminals).toHaveLength(0)
  })

  test('a late prior terminal attaches atomically to the newest qualifying later set', () => {
    capture(harness.handoff, 'turn-1', T0, TEXT)
    capture(harness.handoff, 'turn-2', T0 + 30_000, TEXT)
    complete(harness.handoff, 'turn-1', T0 + 40_000, 'clarification')
    expect(harness.pairs).toHaveLength(1)
    expect(harness.pairs[0]?.priorOutcome).toBe('clarification')
    expect(harness.pairs[0]?.priorTurnKey).toBe(px('turn-1'))
    expect(harness.pairs[0]?.laterTurnKey).toBe(px('turn-2'))
    const later = conversationSets(harness.inspect, ACTOR, CONV_A).find((set) => set.turnKey === px('turn-2'))
    expect(later?.matchedPriorTurnKey).toBe(px('turn-1'))
  })

  test('pair emission is idempotent in both callback orders', () => {
    const terminalFirst = createHarness()
    complete(terminalFirst.handoff, 'turn-1', T0, 'failure')
    capture(terminalFirst.handoff, 'turn-1', T0 + 1_000)
    capture(terminalFirst.handoff, 'turn-2', T0 + 30_000)
    expect(terminalFirst.pairs).toHaveLength(1)

    const captureFirst = createHarness()
    capture(captureFirst.handoff, 'turn-1', T0)
    capture(captureFirst.handoff, 'turn-2', T0 + 30_000)
    complete(captureFirst.handoff, 'turn-1', T0 + 40_000, 'failure')
    complete(captureFirst.handoff, 'turn-1', T0 + 41_000, 'failure')
    expect(captureFirst.pairs).toHaveLength(1)

    const first = terminalFirst.pairs[0]
    const second = captureFirst.pairs[0]
    expect(first?.similarity).toBe(second?.similarity)
    expect(first?.priorOutcome).toBe(second?.priorOutcome)
    expect(first?.gap).toBe(second?.gap)
  })

  test('one actor across two conversations stays isolated', () => {
    capture(harness.handoff, 'turn-1', T0, TEXT, ACTOR, CONV_A)
    complete(harness.handoff, 'turn-1', T0 + 1_000, 'failure')
    capture(harness.handoff, 'turn-2', T0 + 30_000, TEXT, ACTOR, CONV_B)
    expect(harness.pairs).toHaveLength(0)
    capture(harness.handoff, 'turn-3', T0 + 60_000, TEXT, ACTOR, CONV_A)
    expect(harness.pairs).toHaveLength(1)
    expect(harness.pairs[0]?.conversationKey).toBe(CONV_A)
  })

  test('dispose counts remaining state as coverage loss and persists no recovery material', () => {
    capture(harness.handoff, 'turn-1', T0)
    complete(harness.handoff, 'turn-1', T0 + 1_000, 'failure')
    harness.dispose()
    expect(harness.losses).toEqual(['shutdown'])
    expect(harness.inspect().conversations).toHaveLength(0)

    const restarted = createHarness()
    expect(restarted.inspect().conversations).toHaveLength(0)
    capture(restarted.handoff, 'turn-9', T0 + 2_000)
    expect(conversationSets(restarted.inspect, ACTOR, CONV_A)).toHaveLength(1)
  })
})
