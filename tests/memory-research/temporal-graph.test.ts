// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createCorrectedHybridCandidate } from '../../scripts/memory-research/candidates/corrected-hybrid.js'
import {
  collectGraphDiscoveries,
  MAX_GRAPH_ROOTS_PER_QUERY,
} from '../../scripts/memory-research/candidates/temporal-graph-retrieval.js'
import { createTemporalGraphStore } from '../../scripts/memory-research/candidates/temporal-graph-store.js'
import type { TemporalGraphStore } from '../../scripts/memory-research/candidates/temporal-graph-store.js'
import { createTemporalGraphCandidate } from '../../scripts/memory-research/candidates/temporal-graph.js'
import { memoryScenarios } from '../../scripts/memory-research/corpus.js'
import { MemoryEventSchema, MemoryQuerySchema } from '../../scripts/memory-research/types.js'
import type {
  ForgetRequest,
  MemoryCandidateAdapter,
  MemoryEvent,
  MemoryHit,
  MemoryQuery,
  MemoryScope,
} from '../../scripts/memory-research/types.js'

const personalScope = { kind: 'personal', id: 'personal-graph' } as const satisfies MemoryScope
const foreignScope = { kind: 'group', id: 'group-graph' } as const satisfies MemoryScope
const at = (hour: number): string => `2026-07-23T${hour.toString().padStart(2, '0')}:00:00.000Z`

type EventOptions = Readonly<{
  eventFrom?: string
  eventTo?: string | null
  relationFrom?: string
  relationTo?: string | null
}>

const graphEvent = (
  suffix: string,
  scope: MemoryScope,
  source: string,
  target: string,
  content: string,
  options: EventOptions = {},
): MemoryEvent => {
  const eventFrom = options.eventFrom ?? at(10)
  const relationFrom = options.relationFrom ?? eventFrom
  return MemoryEventSchema.parse({
    eventId: `event-${suffix}`,
    evidenceId: `evidence-${suffix}`,
    scope,
    language: 'en',
    eventTime: eventFrom,
    ingestTime: eventFrom,
    content,
    type: 'relationship',
    threadId: scope.kind === 'group' ? `thread-${suffix}` : null,
    entities: [
      { entityId: source, type: 'synthetic-node', name: source, aliases: [] },
      { entityId: target, type: 'synthetic-node', name: target, aliases: [] },
    ],
    relations: [
      {
        relationId: `relation-${suffix}`,
        sourceEntityId: source,
        targetEntityId: target,
        type: 'connects',
        validity: { validFrom: relationFrom, validTo: options.relationTo ?? null },
      },
    ],
    validity: { validFrom: eventFrom, validTo: options.eventTo ?? null },
    embedding: { available: false, version: null },
  })
}

const graphQuery = (
  suffix: string,
  scope: MemoryScope = personalScope,
  options: Readonly<{
    actorRole?: 'owner' | 'member' | 'guest'
    language?: 'en' | 'ru'
    queryTime?: string
    text?: string
  }> = {},
): MemoryQuery =>
  MemoryQuerySchema.parse({
    queryId: `query-${suffix}`,
    authorizedScope: scope,
    actorRole: options.actorRole ?? (scope.kind === 'group' ? 'member' : 'owner'),
    language: options.language ?? 'en',
    queryTime: options.queryTime ?? at(23),
    k: 8,
    contextTokenBudget: 512,
    expectedEvidenceIds: [],
    forbiddenEvidenceIds: [],
    erasedEvidenceIds: [],
    slices: ['graph-multi-hop'],
    text: options.text ?? 'What is connected to anchor ZETA?',
  })

const successfulHits = async (candidate: MemoryCandidateAdapter, query: MemoryQuery): Promise<readonly MemoryHit[]> => {
  const result = await candidate.retrieve(query)
  expect(result.status).toBe('success')
  return result.status === 'success' ? result.hits : []
}

const chain = (scope: MemoryScope = personalScope): readonly MemoryEvent[] => [
  graphEvent('chain-seed', scope, 'entity-chain-a', 'entity-chain-b', 'Anchor ZETA belongs to the first link.'),
  graphEvent('chain-leaf', scope, 'entity-chain-b', 'entity-chain-c', 'BETA opens the OMEGA terminal.'),
]

const canonicalHit = (event: MemoryEvent): MemoryHit => ({
  evidenceId: event.evidenceId,
  sourceEventId: event.eventId,
  scope: event.scope,
  score: { lexical: 1, dense: 0, graph: 0, recency: 0, total: 1 },
  rank: 1,
  content: event.content,
  validity: event.validity,
  provenance: { kind: 'canonical', derivedFromEvidenceIds: [] },
})

const manyRootEvent = (rootCount: number): MemoryEvent => {
  const base = graphEvent(
    'many-roots',
    personalScope,
    'entity-many-root-000',
    'entity-many-leaf-000',
    'Anchor ZETA has many graph roots.',
  )
  return MemoryEventSchema.parse({
    ...base,
    entities: Array.from({ length: rootCount }).flatMap((_, index) => {
      const suffix = index.toString().padStart(3, '0')
      return [
        { entityId: `entity-many-root-${suffix}`, type: 'synthetic-node', name: `root-${suffix}`, aliases: [] },
        { entityId: `entity-many-leaf-${suffix}`, type: 'synthetic-node', name: `leaf-${suffix}`, aliases: [] },
      ]
    }),
    relations: Array.from({ length: rootCount }, (_, index) => {
      const suffix = index.toString().padStart(3, '0')
      return {
        relationId: `relation-many-${suffix}`,
        sourceEntityId: `entity-many-root-${suffix}`,
        targetEntityId: `entity-many-leaf-${suffix}`,
        type: 'connects',
        validity: { validFrom: at(10), validTo: null },
      }
    }),
  })
}

const assertV3GraphRecovery = async (language: 'en' | 'ru'): Promise<void> => {
  const scenario = memoryScenarios.find(
    ({ split, labels, language: scenarioLanguage }) =>
      split === 'development' && scenarioLanguage === language && labels.includes('graph-multi-hop'),
  )!
  const seed = scenario.events[0]!
  const leaf = scenario.events[1]!
  const flat = createCorrectedHybridCandidate()
  const graph = createTemporalGraphCandidate()
  await flat.ingest(scenario.events)
  await graph.ingest(scenario.events)

  const flatHits = await successfulHits(flat, scenario.queries[0]!)
  const graphHits = await successfulHits(graph, scenario.queries[0]!)
  expect(flatHits[0]).toMatchObject({ evidenceId: seed.evidenceId })
  expect(flatHits.map(({ evidenceId }) => evidenceId)).not.toContain(leaf.evidenceId)
  const maybeLeafHit = graphHits.find(({ evidenceId }) => evidenceId === leaf.evidenceId)
  expect(maybeLeafHit).toBeDefined()
  const leafHit = maybeLeafHit!
  expect(leafHit).toMatchObject({
    provenance: { kind: 'derived', derivedFromEvidenceIds: [seed.evidenceId, leaf.evidenceId] },
  })
  expect(leafHit.score.graph > 0).toBeTrue()
}

const assertExpiryBoundary = async (expiry: 'relation' | 'event'): Promise<void> => {
  const candidate = createTemporalGraphCandidate()
  const leaf = graphEvent('expiry-leaf', personalScope, 'entity-chain-b', 'entity-chain-c', 'OMEGA terminal active.', {
    eventTo: expiry === 'event' ? at(12) : null,
    relationTo: expiry === 'relation' ? at(12) : null,
  })
  await candidate.ingest([chain()[0]!, leaf])

  const before = await successfulHits(
    candidate,
    graphQuery(`expiry-before-${expiry}`, personalScope, { queryTime: at(11) }),
  )
  const atBoundary = await successfulHits(
    candidate,
    graphQuery(`expiry-at-${expiry}`, personalScope, { queryTime: at(12) }),
  )
  expect(before.map(({ evidenceId }) => evidenceId)).toContain(leaf.evidenceId)
  expect(atBoundary.map(({ evidenceId }) => evidenceId)).not.toContain(leaf.evidenceId)
}

const assertForgetCascade = async (makeRequest: (records: readonly MemoryEvent[]) => ForgetRequest): Promise<void> => {
  const candidate = createTemporalGraphCandidate()
  const records = chain()
  const request = makeRequest(records)
  await candidate.ingest(records)
  await candidate.forget(request)
  await candidate.ingest(records)

  const hits = await successfulHits(candidate, graphQuery(`forgot-${request.kind}`))
  expect(hits.map(({ evidenceId }) => evidenceId)).not.toContain(records[1]!.evidenceId)
  expect((await candidate.resourceMetrics()).storedBytes).toBeGreaterThan(0)
}

describe('temporal graph memory candidate', () => {
  test('recovers the v3 English answer leaf only through a two-edge graph path', async () => {
    await assertV3GraphRecovery('en')
  })

  test('recovers the v3 Russian answer leaf only through a two-edge graph path', async () => {
    await assertV3GraphRecovery('ru')
  })

  test('scores the first graph discovery with one-based reciprocal rank fusion', async () => {
    const candidate = createTemporalGraphCandidate()
    const records = chain()
    await candidate.ingest(records)

    const hits = await successfulHits(candidate, graphQuery('one-based-graph-rank'))
    const leaf = hits.find(({ evidenceId }) => evidenceId === records[1]!.evidenceId)

    expect(leaf?.score.graph).toBe(1 / 61)
  })

  test('bounds seed roots before issuing adjacency lookups', () => {
    const rootEvent = manyRootEvent(MAX_GRAPH_ROOTS_PER_QUERY + 44)
    const store = createTemporalGraphStore()
    store.upsertEvents([rootEvent])
    let adjacentCallCount = 0
    const measuredStore: TemporalGraphStore = {
      ...store,
      adjacent: () => {
        adjacentCallCount += 1
        return []
      },
    }

    try {
      expect(collectGraphDiscoveries(measuredStore, graphQuery('bounded-roots'), [canonicalHit(rootEvent)])).toEqual([])
      expect(adjacentCallCount).toBe(MAX_GRAPH_ROOTS_PER_QUERY)
    } finally {
      store.close()
    }
  })

  test('stops before evidence that needs a third graph edge', async () => {
    const candidate = createTemporalGraphCandidate()
    const records = [
      ...chain(),
      graphEvent('chain-depth-three', personalScope, 'entity-chain-c', 'entity-chain-d', 'SIGMA owns final DELTA.'),
    ]
    await candidate.ingest(records)

    const ids = (await successfulHits(candidate, graphQuery('depth-three'))).map(({ evidenceId }) => evidenceId)
    expect(ids).toContain(records[1]!.evidenceId)
    expect(ids).not.toContain(records[2]!.evidenceId)
  })

  test('treats relation validTo as an exclusive graph boundary', async () => {
    await assertExpiryBoundary('relation')
  })

  test('treats source-event validTo as an exclusive graph boundary', async () => {
    await assertExpiryBoundary('event')
  })

  test('never bridges identical entity ids across exact scopes', async () => {
    const candidate = createTemporalGraphCandidate()
    const local = chain()
    const foreignLeaf = graphEvent(
      'foreign-leaf',
      foreignScope,
      'entity-chain-b',
      'entity-foreign-secret',
      'Foreign SECRET terminal.',
    )
    await candidate.ingest([...local, foreignLeaf])

    const ids = (await successfulHits(candidate, graphQuery('scope-isolation'))).map(({ evidenceId }) => evidenceId)
    expect(ids).toContain(local[1]!.evidenceId)
    expect(ids).not.toContain(foreignLeaf.evidenceId)
  })

  test('removes an obsolete edge projection when its canonical event is upserted', async () => {
    const candidate = createTemporalGraphCandidate()
    const [seed, oldLeaf] = chain()
    const replacement = MemoryEventSchema.parse({
      ...oldLeaf,
      content: 'Detached replacement branch.',
      entities: [
        { entityId: 'entity-detached-a', type: 'synthetic-node', name: 'detached-a', aliases: [] },
        { entityId: 'entity-detached-b', type: 'synthetic-node', name: 'detached-b', aliases: [] },
      ],
      relations: [
        {
          ...oldLeaf!.relations[0],
          sourceEntityId: 'entity-detached-a',
          targetEntityId: 'entity-detached-b',
        },
      ],
    })
    await candidate.ingest([seed!, oldLeaf!])
    expect(
      (await successfulHits(candidate, graphQuery('upsert-before'))).map(({ evidenceId }) => evidenceId),
    ).toContain(oldLeaf!.evidenceId)

    await candidate.ingest([replacement])

    expect(
      (await successfulHits(candidate, graphQuery('upsert-after'))).map(({ evidenceId }) => evidenceId),
    ).not.toContain(replacement.evidenceId)
  })

  test('cascades evidence erasure and blocks recapture without an orphan edge', async () => {
    await assertForgetCascade((records) => ({
      kind: 'evidence',
      scope: personalScope,
      evidenceIds: [records[1]!.evidenceId],
      completedAt: at(20),
    }))
  })

  test('cascades subject erasure and blocks recapture without an orphan edge', async () => {
    await assertForgetCascade(() => ({
      kind: 'subject',
      scope: personalScope,
      subjectId: 'entity-chain-b',
      completedAt: at(20),
    }))
  })

  test('cascades scope erasure and blocks recapture without an orphan edge', async () => {
    await assertForgetCascade(() => ({ kind: 'scope', scope: personalScope, completedAt: at(20) }))
  })

  test('rebuilds identical ordered graph hits, scores, and path provenance', async () => {
    const incremental = createTemporalGraphCandidate()
    const rebuilt = createTemporalGraphCandidate()
    const records = chain()
    await incremental.ingest(records)
    await rebuilt.rebuild(records, [])

    const incrementalHits = await successfulHits(incremental, graphQuery('rebuild-incremental'))
    const rebuiltHits = await successfulHits(rebuilt, graphQuery('rebuild-rebuilt'))
    expect(rebuiltHits).toEqual(incrementalHits)
  })

  test('blocks guest traversal and supplied-hit context', async () => {
    const candidate = createTemporalGraphCandidate()
    const records = chain(foreignScope)
    await candidate.ingest(records)
    const ownerQuery = graphQuery('owner', foreignScope)
    const ownerHits = await successfulHits(candidate, ownerQuery)
    const guestQuery = graphQuery('guest', foreignScope, { actorRole: 'guest' })

    expect(await successfulHits(candidate, guestQuery)).toEqual([])
    expect(await candidate.assembleContext(guestQuery, ownerHits)).toEqual({ text: '', evidenceIds: [], tokenCount: 0 })
  })

  test('reports finite graph resources and zero persistent bytes after reset', async () => {
    const candidate = createTemporalGraphCandidate()
    await candidate.ingest(chain())
    await candidate.retrieve(graphQuery('resources'))
    const populated = await candidate.resourceMetrics()
    expect(populated.storedBytes).toBeGreaterThan(0)
    expect(Object.values(populated).every(Number.isFinite)).toBeTrue()

    await candidate.reset()
    expect(await candidate.resourceMetrics()).toMatchObject({
      ingestedEventCount: 0,
      retrievalCount: 0,
      storedBytes: 0,
    })
  })
})
