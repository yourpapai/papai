// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createAsShippedCandidate } from '../../scripts/memory-research/candidates/as-shipped.js'
import { createCorrectedHybridCandidate } from '../../scripts/memory-research/candidates/corrected-hybrid.js'
import { createHierarchicalCandidate } from '../../scripts/memory-research/candidates/hierarchical.js'
import { createTemporalGraphCandidate } from '../../scripts/memory-research/candidates/temporal-graph.js'
import { MemoryEventSchema, MemoryQuerySchema } from '../../scripts/memory-research/types.js'
import type {
  MemoryCandidateAdapter,
  MemoryEvent,
  MemoryQuery,
  MemoryScope,
  RawQueryResult,
} from '../../scripts/memory-research/types.js'

const primaryScope = { kind: 'personal', id: 'personal-contract' } as const satisfies MemoryScope
const foreignScope = { kind: 'group', id: 'group-contract' } as const satisfies MemoryScope
const timestamp = (minute: number): string => `2026-07-23T12:${minute.toString().padStart(2, '0')}:00.000Z`

const event = (
  suffix: string,
  scope: MemoryScope = primaryScope,
  content = 'contract token',
  minute = 1,
): MemoryEvent =>
  MemoryEventSchema.parse({
    eventId: `event-${suffix}`,
    evidenceId: `evidence-${suffix}`,
    scope,
    language: 'en',
    eventTime: timestamp(minute),
    ingestTime: timestamp(minute),
    content,
    type: 'fact',
    threadId: null,
    entities: [],
    relations: [],
    validity: { validFrom: timestamp(minute), validTo: null },
    embedding: { available: false, version: null },
  })

const query = (suffix: string, scope: MemoryScope = primaryScope, budget = 512): MemoryQuery =>
  MemoryQuerySchema.parse({
    queryId: `query-${suffix}`,
    authorizedScope: scope,
    actorRole: 'owner',
    language: 'en',
    queryTime: timestamp(59),
    k: 8,
    contextTokenBudget: budget,
    expectedEvidenceIds: [],
    forbiddenEvidenceIds: [],
    erasedEvidenceIds: [],
    slices: ['direct-fact'],
    text: 'contract token',
  })

const candidateFactories = [
  { name: 'as-shipped', create: createAsShippedCandidate },
  { name: 'corrected-hybrid', create: createCorrectedHybridCandidate },
  { name: 'hierarchical', create: createHierarchicalCandidate },
  { name: 'temporal-graph', create: createTemporalGraphCandidate },
] as const satisfies readonly Readonly<{ name: string; create: () => MemoryCandidateAdapter }>[]

const successfulResult = (result: RawQueryResult): Extract<RawQueryResult, { status: 'success' }> => {
  if (result.status !== 'success') throw new Error(`expected success, received ${result.status}`)
  return result
}

const allFiniteNumbers = (values: readonly unknown[]): boolean =>
  values.every((value) => typeof value === 'number' && Number.isFinite(value))

candidateFactories.forEach(({ name, create }) => {
  describe(`${name} adapter contract`, () => {
    test('reset clears observable state and counters', async () => {
      const candidate = create()
      await candidate.ingest([event('reset')])
      await candidate.retrieve(query('reset'))
      await candidate.reset()

      expect(await candidate.retrieve(query('reset-after'))).toMatchObject({ status: 'success', hits: [] })
      expect(await candidate.resourceMetrics()).toMatchObject({
        ingestedEventCount: 0,
        retrievalCount: 1,
        storedBytes: 0,
      })
    })

    test('returns equal-score hits in deterministic evidence-id order', async () => {
      const candidate = create()
      await candidate.ingest([event('tie-b'), event('tie-a')])

      const first = successfulResult(await candidate.retrieve(query('tie')))
      const second = successfulResult(await candidate.retrieve(query('tie')))

      expect(first.hits).toEqual(second.hits)
      expect(first.hits.map(({ evidenceId }) => String(evidenceId))).toEqual(['evidence-tie-a', 'evidence-tie-b'])
    })

    test('never returns a hit from another exact scope', async () => {
      const candidate = create()
      const local = event('local')
      const foreign = event('foreign', foreignScope)
      await candidate.ingest([local, foreign])

      const result = successfulResult(await candidate.retrieve(query('scope')))

      expect(result).toMatchObject({ status: 'success', hits: [{ evidenceId: local.evidenceId }] })
      expect(result.hits.map(({ evidenceId }) => evidenceId)).not.toContain(foreign.evidenceId)
    })

    test('keeps assembled context within its token budget and reports assembled evidence only', async () => {
      const candidate = create()
      const records = [event('budget-old', primaryScope, 'one', 1), event('budget-new', primaryScope, 'two', 2)]
      await candidate.ingest(records)

      const suppliedHit = {
        evidenceId: records[1]!.evidenceId,
        sourceEventId: records[1]!.eventId,
        scope: records[1]!.scope,
        score: { lexical: 1, dense: 0, graph: 0, recency: 0, total: 1 },
        rank: 1,
        content: records[1]!.content,
        validity: records[1]!.validity,
        provenance: { kind: 'canonical' as const, derivedFromEvidenceIds: [] },
      }
      const context = await candidate.assembleContext(query('budget', primaryScope, 1), [suppliedHit])

      expect(context.tokenCount).toBeLessThanOrEqual(1)
      expect(context.evidenceIds).toEqual([records[1]!.evidenceId])
      expect(context.text).toBe('two')
    })

    test('forgets only matching evidence in the requested scope', async () => {
      const candidate = create()
      const local = event('same-evidence')
      const foreign = event('same-evidence', foreignScope)
      await candidate.ingest([local, foreign])
      await candidate.forget({
        kind: 'evidence',
        scope: primaryScope,
        evidenceIds: [local.evidenceId],
        completedAt: timestamp(10),
      })

      expect(await candidate.retrieve(query('forgot-local'))).toMatchObject({ status: 'success', hits: [] })
      expect(await candidate.retrieve(query('forgot-foreign', foreignScope))).toMatchObject({
        status: 'success',
        hits: [{ evidenceId: foreign.evidenceId }],
      })
    })

    test('rebuild reproduces observable state after scoped forget', async () => {
      const records = [event('rebuild-kept'), event('rebuild-removed', primaryScope, 'remove token')]
      const request = {
        kind: 'evidence' as const,
        scope: primaryScope,
        evidenceIds: [records[1]!.evidenceId],
        completedAt: timestamp(10),
      }
      const rebuilt = create()
      const incrementallyBuilt = create()
      await rebuilt.rebuild(records, [request])
      await incrementallyBuilt.ingest(records)
      await incrementallyBuilt.forget(request)

      const rebuiltResult = successfulResult(await rebuilt.retrieve(query('rebuild')))
      const incrementalResult = successfulResult(await incrementallyBuilt.retrieve(query('rebuild')))

      expect(rebuiltResult.status).toBe(incrementalResult.status)
      expect(rebuiltResult.hits).toEqual(incrementalResult.hits)
    })

    test('upserts canonical event ids, even when an update arrives out of order', async () => {
      const candidate = create()
      const current = event('upsert', primaryScope, 'Current UPDATE-44 value.', 10)
      const outOfOrderUpdate = MemoryEventSchema.parse({
        ...current,
        eventTime: timestamp(1),
        ingestTime: timestamp(1),
        content: 'Replacement UPDATE-44 value.',
      })
      const comparison = create()
      await candidate.ingest([current])
      await candidate.ingest([outOfOrderUpdate])
      await comparison.ingest([outOfOrderUpdate])
      const lookup = MemoryQuerySchema.parse({ ...query('upsert'), text: 'Replacement UPDATE-44' })

      const result = await candidate.retrieve(lookup)
      const retrieved = await candidate.retrieve(lookup)
      const context = await candidate.assembleContext(lookup, successfulResult(retrieved).hits)

      expect(result).toMatchObject({
        status: 'success',
        hits: [{ evidenceId: outOfOrderUpdate.evidenceId, content: outOfOrderUpdate.content }],
      })
      expect(context).toMatchObject({ evidenceIds: [outOfOrderUpdate.evidenceId], text: outOfOrderUpdate.content })
      expect((await candidate.resourceMetrics()).ingestedEventCount).toBe(2)
      expect((await candidate.resourceMetrics()).storedBytes).toBe((await comparison.resourceMetrics()).storedBytes)
    })

    test('deduplicates a large canonical-event batch into unique observable storage rows', async () => {
      const candidate = create()
      const comparison = create()
      const originals = Array.from({ length: 1_000 }, (_, index) =>
        event(`large-${index}`, primaryScope, `Original batch row ${index}.`, index % 60),
      )
      const replacements = originals.map((original, index) =>
        MemoryEventSchema.parse({ ...original, content: `Replacement batch row ${index}.` }),
      )

      await candidate.ingest([...originals, ...replacements])
      await comparison.ingest(replacements)

      const metrics = await candidate.resourceMetrics()
      const expectedMetrics = await comparison.resourceMetrics()

      expect(metrics.ingestedEventCount).toBe(2_000)
      expect(metrics.storedBytes).toBe(expectedMetrics.storedBytes)
      const suppliedHit = {
        evidenceId: replacements[0]!.evidenceId,
        sourceEventId: replacements[0]!.eventId,
        scope: replacements[0]!.scope,
        score: { lexical: 1, dense: 0, graph: 0, recency: 0, total: 1 },
        rank: 1,
        content: replacements[0]!.content,
        validity: replacements[0]!.validity,
        provenance: { kind: 'canonical' as const, derivedFromEvidenceIds: [] },
      }
      expect((await candidate.assembleContext(query('large-batch'), [suppliedHit])).text).toContain(
        'Replacement batch row',
      )
    })

    test('reports positive finite offline timing metrics for nonempty operations', async () => {
      const candidate = create()
      const metricBatch = Array.from({ length: 1_000 }, (_, index) => event(`metrics-${index}`))
      const ingestResult = await candidate.ingest(metricBatch)
      const result = await candidate.retrieve(query('metrics'))

      const metrics = await candidate.resourceMetrics()

      expect(ingestResult.durationMs).toBeGreaterThan(0)
      expect(metrics.ingestedEventCount).toBe(metricBatch.length)
      expect(metrics.retrievalCount).toBe(1)
      expect(metrics.ingestDurationMs).toBeGreaterThan(0)
      expect(metrics.ingestThroughputPerSecond).toBeGreaterThan(0)
      expect(metrics.modelCallCount).toBe(0)
      expect(metrics.extractorCallCount).toBe(0)
      expect(metrics.incrementalRssBytes).toBeGreaterThanOrEqual(0)
      expect(allFiniteNumbers(Object.values(metrics))).toBeTrue()
      expect(result.latencyMs).toBeGreaterThanOrEqual(0)
    })
  })
})
