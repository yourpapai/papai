// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type {
  ForgetRequest,
  ForgetResult,
  IngestResult,
  MemoryCandidateAdapter,
  MemoryEvent,
  RawQueryResult,
  ResourceMetrics,
} from '../types.js'
import { createCorrectedHybridCandidate } from './corrected-hybrid.js'
import { elapsedDurationMs } from './shared.js'
import { graphTombstoneBlocks, tombstonesFor } from './temporal-graph-domain.js'
import type { GraphTombstone } from './temporal-graph-domain.js'
import { collectGraphDiscoveries, fuseGraphHits } from './temporal-graph-retrieval.js'
import { createTemporalGraphStore } from './temporal-graph-store.js'
import type { TemporalGraphStore } from './temporal-graph-store.js'

type RuntimeState = Readonly<{
  child: MemoryCandidateAdapter
  store: TemporalGraphStore
  tombstones: readonly GraphTombstone[]
  ingestedEventCount: number
  ingestDurationMs: number
  retrievalCount: number
  rssBaselineBytes: number
}>
type StateCell = { value: RuntimeState }

export type TemporalGraphCandidateDependencies = Readonly<{
  createSeedCandidate: () => MemoryCandidateAdapter
  createStore: () => TemporalGraphStore
  readRssBytes: () => number
}>

const defaultDependencies = {
  createSeedCandidate: createCorrectedHybridCandidate,
  createStore: createTemporalGraphStore,
  readRssBytes: () => process.memoryUsage.rss(),
} as const satisfies TemporalGraphCandidateDependencies

const initialRuntimeState = (dependencies: TemporalGraphCandidateDependencies): RuntimeState => ({
  child: dependencies.createSeedCandidate(),
  store: dependencies.createStore(),
  tombstones: [],
  ingestedEventCount: 0,
  ingestDurationMs: 0,
  retrievalCount: 0,
  rssBaselineBytes: dependencies.readRssBytes(),
})

const createReset =
  (state: StateCell, dependencies: TemporalGraphCandidateDependencies): MemoryCandidateAdapter['reset'] =>
  async () => {
    await state.value.child.reset()
    state.value.store.close()
    state.value = initialRuntimeState(dependencies)
  }

const acceptedEvents = (
  events: readonly MemoryEvent[],
  tombstones: readonly GraphTombstone[],
): readonly MemoryEvent[] =>
  events.filter((event) => !tombstones.some((tombstone) => graphTombstoneBlocks(event, tombstone)))

const createIngest =
  (state: StateCell): MemoryCandidateAdapter['ingest'] =>
  async (events: readonly MemoryEvent[]): Promise<IngestResult> => {
    const startedAt = performance.now()
    const accepted = acceptedEvents(events, state.value.tombstones)
    state.value.store.upsertEvents(accepted)
    await state.value.child.ingest(events)
    const durationMs = elapsedDurationMs(startedAt, performance.now())
    state.value = {
      ...state.value,
      ingestedEventCount: state.value.ingestedEventCount + events.length,
      ingestDurationMs: state.value.ingestDurationMs + durationMs,
    }
    return { ingestedEventCount: events.length, durationMs }
  }

const createRetrieve =
  (state: StateCell): MemoryCandidateAdapter['retrieve'] =>
  async (query): Promise<RawQueryResult> => {
    const startedAt = performance.now()
    state.value = { ...state.value, retrievalCount: state.value.retrievalCount + 1 }
    const seedResult = await state.value.child.retrieve(query)
    const latencyMs = elapsedDurationMs(startedAt, performance.now())
    if (seedResult.status !== 'success') return { ...seedResult, latencyMs }
    const discoveries = collectGraphDiscoveries(state.value.store, query, seedResult.hits)
    return {
      status: 'success',
      queryId: query.queryId,
      hits: fuseGraphHits(query, seedResult.hits, discoveries),
      latencyMs: elapsedDurationMs(startedAt, performance.now()),
    }
  }

const createForget =
  (state: StateCell): MemoryCandidateAdapter['forget'] =>
  async (request: ForgetRequest): Promise<ForgetResult> => {
    const newTombstones = tombstonesFor(request)
    const erasedEvidenceIds = state.value.store.forget(request, newTombstones)
    await state.value.child.forget(request)
    state.value = { ...state.value, tombstones: [...state.value.tombstones, ...newTombstones] }
    return { erasedEvidenceIds, completedAt: request.completedAt }
  }

const createRebuild =
  (
    reset: MemoryCandidateAdapter['reset'],
    ingest: MemoryCandidateAdapter['ingest'],
    forget: MemoryCandidateAdapter['forget'],
  ): MemoryCandidateAdapter['rebuild'] =>
  async (events: readonly MemoryEvent[], forgetRequests: readonly ForgetRequest[]): Promise<void> => {
    await reset()
    await ingest(events)
    await forgetRequests.reduce<Promise<void>>(
      (chain, request) => chain.then(() => forget(request)).then(() => undefined),
      Promise.resolve(),
    )
  }

const throughput = (eventCount: number, durationMs: number): number =>
  eventCount === 0 || durationMs === 0 ? 0 : Math.min(Number.MAX_VALUE, (eventCount * 1_000) / durationMs)

const createResourceMetrics =
  (state: StateCell, dependencies: TemporalGraphCandidateDependencies): MemoryCandidateAdapter['resourceMetrics'] =>
  async (): Promise<ResourceMetrics> => {
    const rssBeforeSerialization = dependencies.readRssBytes()
    const childMetrics = await state.value.child.resourceMetrics()
    const sqliteBytes = state.value.store.hasPersistentState() ? state.value.store.serializedBytes() : 0
    const { ingestedEventCount, ingestDurationMs, retrievalCount, rssBaselineBytes } = state.value
    return {
      ingestedEventCount,
      ingestDurationMs,
      ingestThroughputPerSecond: throughput(ingestedEventCount, ingestDurationMs),
      retrievalCount,
      modelCallCount: 0,
      extractorCallCount: 0,
      storedBytes: childMetrics.storedBytes + sqliteBytes,
      incrementalRssBytes: Math.max(0, rssBeforeSerialization - rssBaselineBytes),
    }
  }

export const createTemporalGraphCandidate = (
  overrides: Partial<TemporalGraphCandidateDependencies> = {},
): MemoryCandidateAdapter => {
  const dependencies = { ...defaultDependencies, ...overrides }
  const state: StateCell = { value: initialRuntimeState(dependencies) }
  const reset = createReset(state, dependencies)
  const ingest = createIngest(state)
  const forget = createForget(state)
  return {
    candidateId: 'temporal-graph',
    version: 'temporal-graph-v1',
    reset,
    ingest,
    retrieve: createRetrieve(state),
    assembleContext: (query, hits) => state.value.child.assembleContext(query, hits),
    forget,
    rebuild: createRebuild(reset, ingest, forget),
    resourceMetrics: createResourceMetrics(state, dependencies),
  }
}
