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
  MemoryHit,
  OperationalMemoryQuery,
  RawQueryResult,
  ResourceMetrics,
} from '../types.js'
import { createCorrectedHybridCandidate } from './corrected-hybrid.js'
import { assembleHierarchyContext } from './hierarchical-context.js'
import type { HierarchyState, HierarchyTombstone } from './hierarchical-projection.js'
import {
  buildHierarchyState,
  emptyHierarchyState,
  hierarchyEventAffectedBy,
  hierarchyEventValidAt,
  hierarchyStateBytes,
  hierarchyTombstoneBlocks,
  hierarchyTombstoneFor,
} from './hierarchical-projection.js'
import { collectHierarchyContributions, combineHierarchyHits } from './hierarchical-retrieval.js'
import { elapsedDurationMs, sameScope } from './shared.js'

type RuntimeState = Readonly<{
  canonical: ReadonlyMap<string, MemoryEvent>
  hierarchy: HierarchyState
  tombstones: readonly HierarchyTombstone[]
  ingestedEventCount: number
  ingestDurationMs: number
  retrievalCount: number
  rssBaselineBytes: number
}>
type StateCell = { value: RuntimeState }
export type HierarchicalCandidateDependencies = Readonly<{
  createLeafCandidate: () => MemoryCandidateAdapter
  readRssBytes: () => number
  measureHierarchyStateBytes: (hierarchy: HierarchyState) => number
}>

const defaultDependencies = {
  createLeafCandidate: createCorrectedHybridCandidate,
  readRssBytes: () => process.memoryUsage.rss(),
  measureHierarchyStateBytes: hierarchyStateBytes,
} as const satisfies HierarchicalCandidateDependencies

const initialRuntimeState = (): RuntimeState => ({
  canonical: new Map(),
  hierarchy: emptyHierarchyState(),
  tombstones: [],
  ingestedEventCount: 0,
  ingestDurationMs: 0,
  retrievalCount: 0,
  rssBaselineBytes: process.memoryUsage.rss(),
})

const eligibleEvents = (state: RuntimeState, query: OperationalMemoryQuery): readonly MemoryEvent[] =>
  query.actorRole === 'guest'
    ? []
    : [...state.canonical.values()].filter(
        (event) => sameScope(event.scope, query.authorizedScope) && hierarchyEventValidAt(event, query.queryTime),
      )

const createReset =
  (leafCandidate: MemoryCandidateAdapter, state: StateCell): MemoryCandidateAdapter['reset'] =>
  async () => {
    await leafCandidate.reset()
    state.value = initialRuntimeState()
  }

const createIngest =
  (leafCandidate: MemoryCandidateAdapter, state: StateCell): MemoryCandidateAdapter['ingest'] =>
  async (events: readonly MemoryEvent[]): Promise<IngestResult> => {
    const startedAt = performance.now()
    const accepted = events.filter(
      (event) => !state.value.tombstones.some((tombstone) => hierarchyTombstoneBlocks(event, tombstone)),
    )
    const canonical = new Map([...state.value.canonical, ...accepted.map((event) => [event.eventId, event] as const)])
    await leafCandidate.ingest(events)
    const durationMs = elapsedDurationMs(startedAt, performance.now())
    state.value = {
      ...state.value,
      canonical,
      hierarchy: buildHierarchyState(canonical),
      ingestedEventCount: state.value.ingestedEventCount + events.length,
      ingestDurationMs: state.value.ingestDurationMs + durationMs,
    }
    return { ingestedEventCount: events.length, durationMs }
  }

const createRetrieve =
  (leafCandidate: MemoryCandidateAdapter, state: StateCell): MemoryCandidateAdapter['retrieve'] =>
  async (query: OperationalMemoryQuery): Promise<RawQueryResult> => {
    const startedAt = performance.now()
    state.value = { ...state.value, retrievalCount: state.value.retrievalCount + 1 }
    const baseResult = await leafCandidate.retrieve(query)
    const latencyMs = elapsedDurationMs(startedAt, performance.now())
    if (baseResult.status !== 'success') return { ...baseResult, latencyMs }
    const eligible = eligibleEvents(state.value, query)
    const eligibleByEvidence = new Map(eligible.map((event) => [event.evidenceId, event]))
    const contributions = collectHierarchyContributions(query, state.value.hierarchy, eligibleByEvidence)
    return {
      status: 'success',
      queryId: query.queryId,
      hits: combineHierarchyHits(query, baseResult.hits, contributions),
      latencyMs,
    }
  }

const createAssembleContext =
  (state: StateCell): MemoryCandidateAdapter['assembleContext'] =>
  (query: OperationalMemoryQuery, hits: readonly MemoryHit[]) =>
    Promise.resolve(assembleHierarchyContext(query, hits, eligibleEvents(state.value, query), state.value.hierarchy))

const createForget =
  (leafCandidate: MemoryCandidateAdapter, state: StateCell): MemoryCandidateAdapter['forget'] =>
  async (request: ForgetRequest): Promise<ForgetResult> => {
    const result = await leafCandidate.forget(request)
    const canonical = new Map(
      [...state.value.canonical].filter(([, event]) => !hierarchyEventAffectedBy(event, request)),
    )
    state.value = {
      ...state.value,
      canonical,
      hierarchy: buildHierarchyState(canonical),
      tombstones: [...state.value.tombstones, hierarchyTombstoneFor(request)],
    }
    return result
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

const createResourceMetrics =
  (
    leafCandidate: MemoryCandidateAdapter,
    state: StateCell,
    dependencies: HierarchicalCandidateDependencies,
  ): MemoryCandidateAdapter['resourceMetrics'] =>
  async (): Promise<ResourceMetrics> => {
    const currentRssBytes = dependencies.readRssBytes()
    const leafMetrics = await leafCandidate.resourceMetrics()
    const { ingestedEventCount, ingestDurationMs, retrievalCount, hierarchy, rssBaselineBytes } = state.value
    return {
      ingestedEventCount,
      ingestDurationMs,
      ingestThroughputPerSecond:
        ingestedEventCount === 0 || ingestDurationMs === 0
          ? 0
          : Math.min(Number.MAX_VALUE, (ingestedEventCount * 1_000) / ingestDurationMs),
      retrievalCount,
      modelCallCount: 0,
      extractorCallCount: 0,
      storedBytes: leafMetrics.storedBytes + dependencies.measureHierarchyStateBytes(hierarchy),
      incrementalRssBytes: Math.max(0, currentRssBytes - rssBaselineBytes),
    }
  }

export const createHierarchicalCandidate = (
  overrides: Partial<HierarchicalCandidateDependencies> = {},
): MemoryCandidateAdapter => {
  const dependencies = { ...defaultDependencies, ...overrides }
  const leafCandidate = dependencies.createLeafCandidate()
  const state: StateCell = { value: initialRuntimeState() }
  const reset = createReset(leafCandidate, state)
  const ingest = createIngest(leafCandidate, state)
  const retrieve = createRetrieve(leafCandidate, state)
  const assembleContext = createAssembleContext(state)
  const forget = createForget(leafCandidate, state)
  return {
    candidateId: 'hierarchical',
    version: 'hierarchical-v1',
    reset,
    ingest,
    retrieve,
    assembleContext,
    forget,
    rebuild: createRebuild(reset, ingest, forget),
    resourceMetrics: createResourceMetrics(leafCandidate, state, dependencies),
  }
}
