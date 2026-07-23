// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import {
  CandidateIdSchema,
  DETERMINISTIC_EMBEDDING_DIMENSION,
  DETERMINISTIC_EMBEDDING_VERSION,
  EmbeddingVersionChangeSchema,
  EventIdSchema,
  EvidenceIdSchema,
  ForgetRequestSchema,
  MemoryHitSchema,
  QueryIdSchema,
  ScenarioSplitSchema,
  ScaleProfileSchema,
  Sha256Schema,
  StableIdSchema,
  TimestampSchema,
} from './types-core.js'
import type { CandidateId, ForgetRequest, MemoryEvent, MemoryHit, OperationalMemoryQuery } from './types-core.js'

export const FaultScheduleSchema = z
  .object({
    missingEmbeddingEvidenceIds: z.array(EvidenceIdSchema).readonly(),
    embeddingVersionChanges: z.array(EmbeddingVersionChangeSchema).readonly(),
    duplicateEvidenceIds: z.array(EvidenceIdSchema).readonly(),
    ingestOrder: z.array(EventIdSchema).readonly(),
    forgetRequests: z.array(ForgetRequestSchema).readonly(),
    nonRecaptureEvidenceIds: z.array(EvidenceIdSchema).readonly(),
    crossScopeProbeQueryIds: z.array(QueryIdSchema).readonly(),
    restartBeforeQueryIds: z.array(QueryIdSchema).readonly(),
    rebuildBeforeQueryIds: z.array(QueryIdSchema).readonly(),
  })
  .strict()
  .readonly()

export const ResourceMetricsSchema = z
  .object({
    ingestedEventCount: z.number().int().nonnegative(),
    ingestDurationMs: z.number().nonnegative(),
    ingestThroughputPerSecond: z.number().nonnegative(),
    retrievalCount: z.number().int().nonnegative(),
    modelCallCount: z.number().int().nonnegative(),
    extractorCallCount: z.number().int().nonnegative(),
    storedBytes: z.number().int().nonnegative(),
    incrementalRssBytes: z.number().int(),
  })
  .strict()
  .readonly()

type RankedEvidence = Readonly<{ evidenceId: string; rank: number }>

const rawHitContractErrors = (hits: readonly RankedEvidence[]): readonly string[] => [
  ...(new Set(hits.map(({ evidenceId }) => evidenceId)).size === hits.length
    ? []
    : ['duplicate evidence IDs are not allowed']),
  ...hits.flatMap((hit, index) =>
    hit.rank === index + 1
      ? []
      : [`raw hit rank must equal its one-based output position (position ${index + 1}, rank ${hit.rank})`],
  ),
]

const successfulQueryResultSchema = z
  .object({
    status: z.literal('success'),
    queryId: QueryIdSchema,
    hits: z.array(MemoryHitSchema).max(1_000).readonly(),
    latencyMs: z.number().nonnegative(),
  })
  .strict()
  .superRefine(({ hits }, context) => {
    rawHitContractErrors(hits).forEach((message) => {
      context.addIssue({ code: 'custom', message, path: ['hits'] })
    })
  })

const failedQueryResultSchema = z
  .object({
    status: z.literal('failure'),
    queryId: QueryIdSchema,
    latencyMs: z.number().nonnegative(),
    error: z.string().min(1),
  })
  .strict()

const timedOutQueryResultSchema = z
  .object({
    status: z.literal('timeout'),
    queryId: QueryIdSchema,
    latencyMs: z.number().nonnegative(),
    timeoutMs: z.number().positive(),
  })
  .strict()

export const RawQueryResultSchema = z
  .discriminatedUnion('status', [successfulQueryResultSchema, failedQueryResultSchema, timedOutQueryResultSchema])
  .readonly()

export const rawQueryResultContractErrors = (
  query: Pick<OperationalMemoryQuery, 'k'>,
  result: RawQueryResult,
): readonly string[] => {
  if (result.status !== 'success') return []
  return [
    ...rawHitContractErrors(result.hits),
    ...(result.hits.length <= query.k ? [] : [`raw hit count ${result.hits.length} exceeds query k ${query.k}`]),
  ]
}

export const QueryMetricsSchema = z
  .object({
    queryId: QueryIdSchema,
    status: z.enum(['success', 'failure', 'timeout']),
    precisionAtK: z.number().min(0).max(1),
    recallAtK: z.number().min(0).max(1),
    reciprocalRank: z.number().min(0).max(1),
    ndcgAtK: z.number().min(0).max(1),
    leakageCount: z.number().int().nonnegative(),
    erasedHitCount: z.number().int().nonnegative(),
    latencyMs: z.number().nonnegative(),
  })
  .strict()
  .readonly()

export const AggregateReportSchema = z
  .object({
    queryCount: z.number().int().nonnegative(),
    successCount: z.number().int().nonnegative(),
    failureCount: z.number().int().nonnegative(),
    timeoutCount: z.number().int().nonnegative(),
    precisionAtK: z.number().min(0).max(1),
    recallAtK: z.number().min(0).max(1),
    reciprocalRank: z.number().min(0).max(1),
    ndcgAtK: z.number().min(0).max(1),
    leakageCount: z.number().int().nonnegative(),
    erasedHitCount: z.number().int().nonnegative(),
    latency: z
      .object({
        p50Ms: z.number().nonnegative(),
        p95Ms: z.number().nonnegative(),
        p99Ms: z.number().nonnegative(),
      })
      .strict()
      .readonly(),
  })
  .strict()
  .readonly()

export const RunManifestBaseSchema = z
  .object({
    runId: StableIdSchema,
    scenarioManifestVersion: z.string().min(1),
    scenarioManifestSha256: Sha256Schema,
    deterministicEmbeddingVersion: z.literal(DETERMINISTIC_EMBEDDING_VERSION),
    deterministicEmbeddingDimension: z.literal(DETERMINISTIC_EMBEDDING_DIMENSION),
    candidate: z
      .object({
        id: CandidateIdSchema,
        version: z.string().min(1),
        config: z.record(z.string(), z.json()),
      })
      .strict()
      .readonly(),
    split: ScenarioSplitSchema,
    scale: ScaleProfileSchema,
    seed: z.number().int().nonnegative(),
    repository: z
      .object({
        revision: z.string().regex(/^[a-f0-9]{40}$/u),
        dirty: z.boolean(),
      })
      .strict()
      .readonly(),
    runtime: z
      .object({
        bunVersion: z.string().min(1),
        os: z.string().min(1),
        arch: z.string().min(1),
      })
      .strict()
      .readonly(),
    hardware: z
      .object({
        cpuModel: z.string().min(1),
        cpuCount: z.number().int().positive(),
        totalMemoryBytes: z.number().int().positive(),
      })
      .strict()
      .readonly(),
    startedAt: TimestampSchema,
    completedAt: TimestampSchema,
    faultConfiguration: FaultScheduleSchema,
  })
  .strict()
  .refine(({ startedAt, completedAt }) => Date.parse(completedAt) >= Date.parse(startedAt), {
    message: 'completedAt must be at or after startedAt',
  })
  .readonly()

export type ResourceMetrics = z.infer<typeof ResourceMetricsSchema>
export type RawQueryResult = z.infer<typeof RawQueryResultSchema>
export type QueryMetrics = z.infer<typeof QueryMetricsSchema>
export type AggregateReport = z.infer<typeof AggregateReportSchema>
export type RunManifest = z.infer<typeof RunManifestBaseSchema>

export type IngestResult = Readonly<{
  ingestedEventCount: number
  durationMs: number
}>

export type ForgetResult = Readonly<{
  erasedEvidenceIds: readonly string[]
  completedAt: string
}>

export type AssembledContext = Readonly<{
  text: string
  tokenCount: number
  evidenceIds: readonly string[]
}>

export interface MemoryCandidateAdapter {
  readonly candidateId: CandidateId
  readonly version: string
  reset(): Promise<void>
  ingest(events: readonly MemoryEvent[]): Promise<IngestResult>
  retrieve(query: OperationalMemoryQuery): Promise<RawQueryResult>
  assembleContext(query: OperationalMemoryQuery, hits: readonly MemoryHit[]): Promise<AssembledContext>
  forget(request: ForgetRequest): Promise<ForgetResult>
  rebuild(events: readonly MemoryEvent[], forgetRequests: readonly ForgetRequest[]): Promise<void>
  resourceMetrics(): Promise<ResourceMetrics>
}
