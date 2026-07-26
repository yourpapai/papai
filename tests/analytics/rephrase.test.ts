// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { PseudonymSchema } from '../../src/analytics/controlled-types.js'
import type { Pseudonym } from '../../src/analytics/controlled-types.js'
import type { RephrasePairDetection } from '../../src/analytics/intent/rephrase.js'
import { createRephraseHandoff } from '../../src/analytics/rephrase/handoff.js'

const T0 = 1_700_000_000_000
const px = (suffix: string): Pseudonym => PseudonymSchema.parse(`v1.${suffix}`)
const ACTOR = px('actor-gap')
const CONV = px('conv-gap')
const TEXT = 'please create a task to review the lighthouse budget report'

const pairAfterGap = (gapMs: number): RephrasePairDetection[] => {
  const pairs: RephrasePairDetection[] = []
  const { handoff } = createRephraseHandoff({
    nowMs: () => T0,
    onPairDetected: (pair) => {
      pairs.push(pair)
    },
  })
  handoff.captureText({ actorKey: ACTOR, conversationKey: CONV, turnKey: px('prior'), capturedAtMs: T0, text: TEXT })
  handoff.completeTurn({ turnKey: px('prior'), completedAtMs: T0 + 500, outcome: 'failure' })
  handoff.captureText({
    actorKey: ACTOR,
    conversationKey: CONV,
    turnKey: px('later'),
    capturedAtMs: T0 + gapMs,
    text: TEXT,
  })
  return pairs
}

describe('rephrase fixtures: unresolved prior turn gap boundaries', () => {
  test('119 seconds compares and buckets as le_2m', () => {
    const pairs = pairAfterGap(119_000)
    expect(pairs).toHaveLength(1)
    expect(pairs[0]?.gap).toBe('le_2m')
  })

  test('120 seconds compares and buckets as 2m_10m', () => {
    const pairs = pairAfterGap(120_000)
    expect(pairs).toHaveLength(1)
    expect(pairs[0]?.gap).toBe('2m_10m')
  })

  test('599 seconds compares and buckets as 2m_10m', () => {
    const pairs = pairAfterGap(599_000)
    expect(pairs).toHaveLength(1)
    expect(pairs[0]?.gap).toBe('2m_10m')
  })

  test('600 seconds still compares at the closed window edge', () => {
    const pairs = pairAfterGap(600_000)
    expect(pairs).toHaveLength(1)
    expect(pairs[0]?.gap).toBe('2m_10m')
  })

  test('just beyond 600 seconds never compares', () => {
    const pairs = pairAfterGap(600_001)
    expect(pairs).toHaveLength(0)
  })
})
