// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { computeShadowFunnel } from '../../src/long-term-memory/shadow-funnel.js'
import type { ShadowLogRow } from '../../src/long-term-memory/shadow-log-row.js'
import { insertShadowLogRow } from '../../src/long-term-memory/store.js'
import { setupTestDb } from '../utils/test-helpers.js'

const baseRow: ShadowLogRow = {
  scopeHash: 'hash-scope',
  contextHash: 'hash-context',
  turnRef: 'turn-1',
  readerModelId: 'model-a',
  activeRecordCount: 3,
  shadowQueryHash: 'hash-query',
  shadowQueryLenBucket: 'medium',
  shadowHitCount: 1,
  shadowTopScore: 0.5,
  shadowTopProvenance: 'current',
  shadowTopRecordHash: 'hash-record',
  modelPulled: false,
  pullCount: 0,
  pullQueryHash: null,
  pullResultCount: 0,
  shadowPullOverlap: 0,
  skippedReason: null,
}

const row = (overrides: Partial<ShadowLogRow>): ShadowLogRow => ({ ...baseRow, ...overrides })

describe('computeShadowFunnel', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('returns one entry per reader model id, never a pooled average', () => {
    // model-a: 2 memory-bearing turns, 1 shadow hit, 1 under-trigger
    insertShadowLogRow(row({ readerModelId: 'model-a', activeRecordCount: 3, shadowHitCount: 1, modelPulled: false }))
    insertShadowLogRow(row({ readerModelId: 'model-a', activeRecordCount: 2, shadowHitCount: 0, modelPulled: false }))

    // model-b: 1 memory-bearing turn, 1 shadow hit, model pulled (not under-trigger)
    insertShadowLogRow(row({ readerModelId: 'model-b', activeRecordCount: 5, shadowHitCount: 2, modelPulled: true }))

    const result = computeShadowFunnel()

    expect(result).toHaveLength(2)
    const modelA = result.find((entry) => entry.readerModelId === 'model-a')
    const modelB = result.find((entry) => entry.readerModelId === 'model-b')
    expect(modelA).toBeDefined()
    expect(modelB).toBeDefined()

    // Each model's numbers must reflect only its own rows -- proof there is no
    // cross-model pooling/averaging happening anywhere in the aggregation.
    expect(modelA?.memoryBearingTurns).toBe(2)
    expect(modelA?.underTriggerTurns).toBe(1)
    expect(modelB?.memoryBearingTurns).toBe(1)
    expect(modelB?.underTriggerTurns).toBe(0)
  })

  test('memoryBearingTurns counts only rows with >=1 active record', () => {
    insertShadowLogRow(row({ readerModelId: 'model-a', activeRecordCount: 0, shadowHitCount: 0 }))
    insertShadowLogRow(row({ readerModelId: 'model-a', activeRecordCount: 1, shadowHitCount: 0 }))
    insertShadowLogRow(row({ readerModelId: 'model-a', activeRecordCount: 4, shadowHitCount: 0 }))

    const [entry] = computeShadowFunnel()

    expect(entry?.memoryBearingTurns).toBe(2)
  })

  test('shadowHitTurns applies the shadow_hit rank-cutoff threshold (shadow_hit_count >= 1)', () => {
    insertShadowLogRow(row({ readerModelId: 'model-a', shadowHitCount: 0 }))
    insertShadowLogRow(row({ readerModelId: 'model-a', shadowHitCount: 1 }))
    insertShadowLogRow(row({ readerModelId: 'model-a', shadowHitCount: 3 }))

    const [entry] = computeShadowFunnel()

    expect(entry?.shadowHitTurns).toBe(2)
  })

  test('underTriggerTurns = shadow_hit_count >= 1 AND model_pulled = false; underTriggerRate divides by memoryBearingTurns', () => {
    // under-trigger: hit, model never pulled
    insertShadowLogRow(row({ readerModelId: 'model-a', shadowHitCount: 1, modelPulled: false }))
    // hit, but the model pulled -- not an under-trigger
    insertShadowLogRow(row({ readerModelId: 'model-a', shadowHitCount: 1, modelPulled: true }))
    // no hit at all -- not an under-trigger
    insertShadowLogRow(row({ readerModelId: 'model-a', shadowHitCount: 0, modelPulled: false }))
    // under-trigger: hit, model never pulled
    insertShadowLogRow(row({ readerModelId: 'model-a', shadowHitCount: 2, modelPulled: false }))

    const [entry] = computeShadowFunnel()

    expect(entry?.memoryBearingTurns).toBe(4)
    expect(entry?.underTriggerTurns).toBe(2)
    expect(entry?.underTriggerRate).toBeCloseTo(0.5, 10)
  })

  test('overlapWhenPulled counts model_pulled rows with shadow_pull_overlap > 0', () => {
    insertShadowLogRow(row({ readerModelId: 'model-a', modelPulled: true, shadowPullOverlap: 1 }))
    insertShadowLogRow(row({ readerModelId: 'model-a', modelPulled: true, shadowPullOverlap: 0 }))
    insertShadowLogRow(row({ readerModelId: 'model-a', modelPulled: false, shadowPullOverlap: 2 }))

    const [entry] = computeShadowFunnel()

    expect(entry?.overlapWhenPulled).toBe(1)
  })

  test('overPullTurns counts model_pulled rows with zero shadow/pull overlap', () => {
    insertShadowLogRow(row({ readerModelId: 'model-a', modelPulled: true, shadowPullOverlap: 0 }))
    insertShadowLogRow(row({ readerModelId: 'model-a', modelPulled: true, shadowPullOverlap: 1 }))
    insertShadowLogRow(row({ readerModelId: 'model-a', modelPulled: false, shadowPullOverlap: 0 }))

    const [entry] = computeShadowFunnel()

    expect(entry?.overPullTurns).toBe(1)
  })

  test('opts.readerModelId filters the aggregation to a single model', () => {
    insertShadowLogRow(row({ readerModelId: 'model-a', activeRecordCount: 3 }))
    insertShadowLogRow(row({ readerModelId: 'model-b', activeRecordCount: 3 }))

    const result = computeShadowFunnel({ readerModelId: 'model-a' })

    expect(result).toHaveLength(1)
    expect(result[0]?.readerModelId).toBe('model-a')
  })

  test('returns an empty array when there are no rows', () => {
    expect(computeShadowFunnel()).toEqual([])
  })

  test('underTriggerRate is 0 (not NaN) when a reader model has zero memory-bearing turns', () => {
    insertShadowLogRow(row({ readerModelId: 'model-a', activeRecordCount: 0, shadowHitCount: 0 }))

    const [entry] = computeShadowFunnel()

    expect(entry?.memoryBearingTurns).toBe(0)
    expect(entry?.underTriggerRate).toBe(0)
  })
})
