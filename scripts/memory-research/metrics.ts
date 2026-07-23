// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { AggregateReportSchema, QueryMetricsSchema } from './types.js'
import type { AggregateReport, MemoryHit, MemoryQuery, QueryMetrics, RawQueryResult } from './types.js'

const clampFiniteNonnegative = (value: number): number => (Number.isFinite(value) ? Math.max(0, value) : 0)

const normalizedDepth = (value: number): number => (Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0)

const compareHits = (left: MemoryHit, right: MemoryHit): number =>
  left.rank - right.rank || left.evidenceId.localeCompare(right.evidenceId)

const deduplicateHits = (hits: readonly MemoryHit[], k: number): readonly MemoryHit[] => {
  const ordered = [...hits].sort(compareHits)
  return ordered
    .filter((hit, index) => ordered.findIndex((candidate) => candidate.evidenceId === hit.evidenceId) === index)
    .slice(0, normalizedDepth(k))
}

const uniqueIds = (ids: readonly string[]): ReadonlySet<string> => new Set(ids)

const sameScope = (left: MemoryHit['scope'], right: MemoryQuery['authorizedScope']): boolean =>
  left.kind === right.kind && left.id === right.id

const discountedGain = (hits: readonly MemoryHit[], expected: ReadonlySet<string>): number =>
  hits.reduce((sum, hit, index) => sum + (expected.has(hit.evidenceId) ? 1 / Math.log2(index + 2) : 0), 0)

const idealDiscountedGain = (relevantCount: number, k: number): number =>
  Array.from({ length: Math.min(relevantCount, normalizedDepth(k)) }, (_, index) => 1 / Math.log2(index + 2)).reduce(
    (sum, value) => sum + value,
    0,
  )

const zeroMetrics = (query: MemoryQuery, result: RawQueryResult): QueryMetrics =>
  QueryMetricsSchema.parse({
    queryId: query.queryId,
    status: result.status,
    precisionAtK: 0,
    recallAtK: 0,
    reciprocalRank: 0,
    ndcgAtK: 0,
    leakageCount: 0,
    erasedHitCount: 0,
    latencyMs: clampFiniteNonnegative(result.latencyMs),
  })

export const scoreQueryResult = (query: MemoryQuery, result: RawQueryResult): QueryMetrics => {
  if (result.status !== 'success') return zeroMetrics(query, result)

  const rawHits = result.hits
  const hits = deduplicateHits(rawHits, query.k)
  const expected = uniqueIds(query.expectedEvidenceIds)
  const erased = uniqueIds(query.erasedEvidenceIds)
  const relevantCount = hits.filter((hit) => expected.has(hit.evidenceId)).length
  const correctAbstention = expected.size === 0 && hits.length === 0
  const firstRelevantIndex = hits.findIndex((hit) => expected.has(hit.evidenceId))
  const ideal = idealDiscountedGain(expected.size, query.k)

  return QueryMetricsSchema.parse({
    queryId: query.queryId,
    status: result.status,
    precisionAtK: hits.length === 0 ? (correctAbstention ? 1 : 0) : relevantCount / hits.length,
    recallAtK: expected.size === 0 ? (correctAbstention ? 1 : 0) : relevantCount / expected.size,
    reciprocalRank: firstRelevantIndex === -1 ? 0 : 1 / (firstRelevantIndex + 1),
    ndcgAtK: ideal === 0 ? (correctAbstention ? 1 : 0) : discountedGain(hits, expected) / ideal,
    leakageCount: rawHits.filter((hit) => !sameScope(hit.scope, query.authorizedScope)).length,
    erasedHitCount: rawHits.filter((hit) => erased.has(hit.evidenceId)).length,
    latencyMs: clampFiniteNonnegative(result.latencyMs),
  })
}

const nearestRank = (values: readonly number[], percentile: number): number => {
  if (values.length === 0) return 0
  const rank = Math.ceil(Math.min(1, Math.max(0, percentile)) * values.length)
  return values[Math.max(0, rank - 1)] ?? 0
}

export const latencyPercentiles = (
  samples: readonly number[],
): Readonly<{ p50Ms: number; p95Ms: number; p99Ms: number }> => {
  const ordered = samples
    .filter(Number.isFinite)
    .map(clampFiniteNonnegative)
    .sort((left, right) => left - right)
  return Object.freeze({
    p50Ms: nearestRank(ordered, 0.5),
    p95Ms: nearestRank(ordered, 0.95),
    p99Ms: nearestRank(ordered, 0.99),
  })
}

const mean = (values: readonly QueryMetrics[], select: (value: QueryMetrics) => number): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + select(value), 0) / values.length

export const aggregateQueryMetrics = (metrics: readonly QueryMetrics[]): AggregateReport =>
  AggregateReportSchema.parse({
    queryCount: metrics.length,
    successCount: metrics.filter(({ status }) => status === 'success').length,
    failureCount: metrics.filter(({ status }) => status === 'failure').length,
    timeoutCount: metrics.filter(({ status }) => status === 'timeout').length,
    precisionAtK: mean(metrics, ({ precisionAtK }) => precisionAtK),
    recallAtK: mean(metrics, ({ recallAtK }) => recallAtK),
    reciprocalRank: mean(metrics, ({ reciprocalRank }) => reciprocalRank),
    ndcgAtK: mean(metrics, ({ ndcgAtK }) => ndcgAtK),
    leakageCount: metrics.reduce((sum, value) => sum + value.leakageCount, 0),
    erasedHitCount: metrics.reduce((sum, value) => sum + value.erasedHitCount, 0),
    latency: latencyPercentiles(metrics.map(({ latencyMs }) => latencyMs)),
  })
