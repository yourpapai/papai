// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { aggregateQueryMetrics, latencyPercentiles, scoreQueryResult } from '../../scripts/memory-research/metrics.js'
import { MemoryHitSchema, MemoryQuerySchema } from '../../scripts/memory-research/types.js'
import type { MemoryHit, MemoryScope, RawQueryResult } from '../../scripts/memory-research/types.js'

const personalScope = { kind: 'personal', id: 'personal-synthetic-metrics' } as const
const groupScope = { kind: 'group', id: 'group-synthetic-metrics' } as const

const query = MemoryQuerySchema.parse({
  queryId: 'query-metrics-001',
  authorizedScope: personalScope,
  actorRole: 'owner',
  language: 'en',
  queryTime: '2026-01-01T00:00:00.000Z',
  k: 3,
  contextTokenBudget: 128,
  expectedEvidenceIds: ['evidence-a', 'evidence-b'],
  forbiddenEvidenceIds: [],
  erasedEvidenceIds: ['evidence-erased'],
  slices: ['direct-fact'],
  text: 'Synthetic query',
})

const hit = (
  evidenceId: string,
  rank: number,
  scope: MemoryScope = personalScope,
  derivedFromEvidenceIds: readonly string[] = [],
): MemoryHit =>
  MemoryHitSchema.parse({
    evidenceId,
    sourceEventId: `event-${evidenceId}`,
    scope,
    score: { lexical: 1, dense: 1, graph: 0, recency: 0, total: 1 },
    rank,
    content: `Synthetic ${evidenceId}`,
    validity: { validFrom: '2025-01-01T00:00:00.000Z', validTo: null },
    provenance: {
      kind: derivedFromEvidenceIds.length === 0 ? 'canonical' : 'derived',
      derivedFromEvidenceIds,
    },
  })

const success = (hits: readonly MemoryHit[], latencyMs = 10): RawQueryResult => ({
  status: 'success',
  queryId: query.queryId,
  hits,
  latencyMs,
})

describe('retrieval metrics', () => {
  test('deduplicates evidence, respects k, and computes binary relevance metrics', () => {
    const result = scoreQueryResult(
      query,
      success([hit('evidence-a', 1), hit('evidence-a', 2), hit('irrelevant', 3), hit('evidence-b', 4)]),
    )

    expect(result.precisionAtK).toBeCloseTo(2 / 3)
    expect(result.recallAtK).toBe(1)
    expect(result.reciprocalRank).toBe(1)
    expect(result.ndcgAtK).toBeGreaterThan(0.9)
  })

  test('counts safety violations over every raw hit before quality normalization', () => {
    const result = scoreQueryResult(
      query,
      success([
        hit('irrelevant', 1),
        hit('evidence-leak', 2, groupScope),
        hit('evidence-leak', 3, groupScope),
        hit('evidence-erased', 4),
      ]),
    )

    expect(result.leakageCount).toBe(2)
    expect(result.erasedHitCount).toBe(1)
  })

  test('keeps legacy metric counts separate from designated evidence-closure gates', () => {
    const safetyQuery = MemoryQuerySchema.parse({
      ...query,
      forbiddenEvidenceIds: ['evidence-foreign'],
    })
    const result = scoreQueryResult(
      safetyQuery,
      success([
        hit('evidence-foreign', 1, personalScope),
        hit('evidence-derived', 2, personalScope, ['evidence-foreign', 'evidence-erased']),
      ]),
    )

    expect(result.leakageCount).toBe(0)
    expect(result.erasedHitCount).toBe(0)
  })

  test('defines correct-abstention and all zero-denominator behavior', () => {
    const abstentionQuery = MemoryQuerySchema.parse({
      ...query,
      queryId: 'query-metrics-abstention',
      expectedEvidenceIds: [],
    })

    expect(scoreQueryResult(abstentionQuery, success([]))).toMatchObject({
      precisionAtK: 1,
      recallAtK: 1,
      reciprocalRank: 0,
      ndcgAtK: 1,
    })
    expect(scoreQueryResult(abstentionQuery, success([hit('irrelevant', 1)]))).toMatchObject({
      precisionAtK: 0,
      recallAtK: 0,
      reciprocalRank: 0,
      ndcgAtK: 0,
    })
    const invalidLatency = scoreQueryResult(query, success([], -10))
    expect(
      [
        invalidLatency.precisionAtK,
        invalidLatency.recallAtK,
        invalidLatency.reciprocalRank,
        invalidLatency.ndcgAtK,
        invalidLatency.leakageCount,
        invalidLatency.erasedHitCount,
        invalidLatency.latencyMs,
      ].every(Number.isFinite),
    ).toBeTrue()
  })

  test('retains failures and timeouts in aggregate denominators', () => {
    const scored = [
      scoreQueryResult(query, success([hit('evidence-a', 1), hit('evidence-b', 2)])),
      scoreQueryResult(query, {
        status: 'failure',
        queryId: query.queryId,
        latencyMs: 20,
        error: 'synthetic failure',
      }),
      scoreQueryResult(query, {
        status: 'timeout',
        queryId: query.queryId,
        latencyMs: 30,
        timeoutMs: 25,
      }),
    ]
    const aggregate = aggregateQueryMetrics(scored)

    expect(aggregate.queryCount).toBe(3)
    expect(aggregate.successCount).toBe(1)
    expect(aggregate.failureCount).toBe(1)
    expect(aggregate.timeoutCount).toBe(1)
    expect(aggregate.recallAtK).toBeCloseTo(1 / 3)
  })

  test('computes finite nearest-rank latency percentiles for edge cases', () => {
    expect(latencyPercentiles([])).toEqual({ p50Ms: 0, p95Ms: 0, p99Ms: 0 })
    expect(latencyPercentiles([Number.NaN, -5, 1, 2, 100])).toEqual({
      p50Ms: 1,
      p95Ms: 100,
      p99Ms: 100,
    })
  })
})
