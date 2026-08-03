// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { PseudonymSchema } from '../../../src/analytics/controlled-types.js'
import type { Pseudonym } from '../../../src/analytics/controlled-types.js'
import type { RephraseCoverageLossReason, RephrasePairDetection } from '../../../src/analytics/intent/rephrase.js'
import { createRephraseStore } from '../../../src/analytics/rephrase/handoff.js'
import type { RephraseCaptureInput } from '../../../src/analytics/rephrase/state.js'

const inputTypeCheck: RephraseCaptureInput | null = null
void inputTypeCheck

const T0 = 1_700_000_000_000
const px = (suffix: string): Pseudonym => PseudonymSchema.parse(`v1.${suffix}`)
const TEXT = 'please create a task to review the lighthouse budget report'

type Harness = Readonly<{
  store: ReturnType<typeof createRephraseStore>
  pairs: RephrasePairDetection[]
  losses: RephraseCoverageLossReason[]
  setNow: (value: number) => void
}>

const createHarness = (): Harness => {
  let now = T0
  const pairs: RephrasePairDetection[] = []
  const losses: RephraseCoverageLossReason[] = []
  const store = createRephraseStore({
    nowMs: () => now,
    onPairDetected: (pair) => {
      pairs.push(pair)
    },
    onCoverageLoss: (reason) => {
      losses.push(reason)
    },
  })
  return {
    store,
    pairs,
    losses,
    setNow: (value: number) => {
      now = value
    },
  }
}

const capture = (store: ReturnType<typeof createRephraseStore>, turn: string, capturedAtMs: number): void => {
  store.captureText({ actorKey: px('actor'), conversationKey: px('conv'), turnKey: px(turn), capturedAtMs, text: TEXT })
}

describe('rephrase store', () => {
  test('capture and terminal produce one pair with controlled buckets only', () => {
    const { store, pairs } = createHarness()
    capture(store, 'turn-1', T0)
    store.completeTurn({ turnKey: px('turn-1'), completedAtMs: T0 + 1_000, outcome: 'failure' })
    capture(store, 'turn-2', T0 + 30_000)
    expect(pairs).toHaveLength(1)
    expect(pairs[0]).toEqual({
      detector: 'lexical_v1',
      similarity: 'ge_095',
      priorOutcome: 'failure',
      gap: 'le_2m',
      actorKey: px('actor'),
      conversationKey: px('conv'),
      priorTurnKey: px('turn-1'),
      laterTurnKey: px('turn-2'),
    })
  })

  test('inspect exposes pseudonyms and counts only', () => {
    const canary = 'CANARY-store-raw-text-41b8d2-lantern'
    const { store } = createHarness()
    store.captureText({
      actorKey: px('actor'),
      conversationKey: px('conv'),
      turnKey: px('turn-1'),
      capturedAtMs: T0,
      text: canary,
    })
    const snapshot = store.inspect()
    expect(snapshot.conversations[0]?.sets[0]?.shingleCount).toBeGreaterThan(0)
    expect(JSON.stringify(snapshot)).not.toContain('lantern')
  })

  test('withdraw removes the actor state without coverage loss', () => {
    const { store, losses } = createHarness()
    capture(store, 'turn-1', T0)
    store.withdraw({ actorKey: px('actor') })
    expect(store.inspect().conversations).toHaveLength(0)
    expect(losses).toHaveLength(0)
  })

  test('dispose counts remaining sets as shutdown coverage loss exactly once', () => {
    const { store, losses } = createHarness()
    capture(store, 'turn-1', T0)
    store.dispose()
    expect(losses).toEqual(['shutdown'])
    expect(store.inspect().conversations).toHaveLength(0)
  })
})
