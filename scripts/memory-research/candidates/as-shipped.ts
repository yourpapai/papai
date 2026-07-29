// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { cosineSimilarity, deterministicEmbedding } from '../deterministic-embedding.js'
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
import {
  assembleBoundedContext,
  compareRecency,
  memoryHit,
  offlineResourceMetrics,
  elapsedDurationMs,
  sameScope,
} from './shared.js'
import type { StoredMemoryEvent } from './shared.js'

const SEMANTIC_THRESHOLD = 0.65
const FALLBACK_SCAN_LIMIT = 500
const CONTEXT_RECORD_LIMIT = 3

type ScoredEvent = Readonly<{
  event: MemoryEvent
  score: number
}>

const asciiTokens = (text: string): ReadonlySet<string> => new Set(text.toLowerCase().match(/[a-z0-9]+/gu) ?? [])

const lexicalScore = (queryTokens: ReadonlySet<string>, content: string): number => {
  const contentTokens = asciiTokens(content)
  const overlap = [...queryTokens].filter((token) => contentTokens.has(token)).length
  return queryTokens.size === 0 ? 0 : overlap / queryTokens.size
}

const compareScoredEvents = (left: ScoredEvent, right: ScoredEvent): number =>
  right.score - left.score || compareRecency(left.event, right.event)

const activeScopeEvents = (rows: readonly StoredMemoryEvent[], query: OperationalMemoryQuery): readonly MemoryEvent[] =>
  rows
    .filter(({ archived, event }) => !archived && sameScope(event.scope, query.authorizedScope))
    .map(({ event }) => event)

const activeScopeRows = (
  rows: readonly StoredMemoryEvent[],
  query: OperationalMemoryQuery,
): readonly StoredMemoryEvent[] =>
  rows.filter(({ archived, event }) => !archived && sameScope(event.scope, query.authorizedScope))

const semanticHits = (rows: readonly StoredMemoryEvent[], query: OperationalMemoryQuery): readonly ScoredEvent[] => {
  const queryEmbedding = deterministicEmbedding(query.text)
  return rows
    .filter(({ event }) => event.embedding.available)
    .flatMap(({ event, vector }) =>
      vector === null ? [] : [{ event, score: cosineSimilarity(queryEmbedding, vector) }],
    )
    .filter(({ score }) => score >= SEMANTIC_THRESHOLD)
    .sort(compareScoredEvents)
}

const fallbackHits = (events: readonly MemoryEvent[], query: OperationalMemoryQuery): readonly ScoredEvent[] => {
  const queryTokens = asciiTokens(query.text)
  return [...events]
    .sort(compareRecency)
    .slice(0, FALLBACK_SCAN_LIMIT)
    .map((event) => ({ event, score: lexicalScore(queryTokens, event.content) }))
    .filter(({ score }) => score > 0)
    .sort(compareScoredEvents)
}

const retrievedHits = (rows: readonly StoredMemoryEvent[], query: OperationalMemoryQuery): readonly MemoryHit[] => {
  const semantic = semanticHits(rows, query)
  const ranked =
    semantic.length > 0
      ? semantic
      : fallbackHits(
          rows.map(({ event }) => event),
          query,
        )
  return ranked
    .slice(0, query.k)
    .map(({ event, score }, index) =>
      memoryHit(event, index + 1, semantic.length > 0 ? { dense: score } : { lexical: score }),
    )
}

const affectedByForget = (event: MemoryEvent, request: ForgetRequest): boolean => {
  if (!sameScope(event.scope, request.scope)) return false
  if (request.kind === 'scope') return true
  if (request.kind === 'evidence') return request.evidenceIds.includes(event.evidenceId)
  return event.entities.some(({ entityId }) => entityId === request.subjectId)
}

const upsertEvents = (
  rows: readonly StoredMemoryEvent[],
  events: readonly MemoryEvent[],
): readonly StoredMemoryEvent[] =>
  Array.from(
    events
      .reduce(
        (indexedRows, event) =>
          indexedRows.set(event.eventId, {
            event,
            archived: false,
            vector: event.embedding.available ? deterministicEmbedding(event.content) : null,
          }),
        new Map(rows.map((row) => [row.event.eventId, row] as const)),
      )
      .values(),
  )

type RuntimeState = Readonly<{
  rssBaselineBytes: number
  rows: readonly StoredMemoryEvent[]
  ingestedEventCount: number
  ingestDurationMs: number
  retrievalCount: number
}>

type StateCell = { value: RuntimeState }

const initialRuntimeState = (): RuntimeState => ({
  rssBaselineBytes: process.memoryUsage.rss(),
  rows: [],
  ingestedEventCount: 0,
  ingestDurationMs: 0,
  retrievalCount: 0,
})

const createReset =
  (state: StateCell): MemoryCandidateAdapter['reset'] =>
  (): Promise<void> => {
    state.value = initialRuntimeState()
    return Promise.resolve()
  }

const createIngest =
  (state: StateCell): MemoryCandidateAdapter['ingest'] =>
  (events: readonly MemoryEvent[]): Promise<IngestResult> => {
    const startedAt = performance.now()
    const rows = upsertEvents(state.value.rows, events)
    const durationMs = elapsedDurationMs(startedAt, performance.now())
    state.value = {
      ...state.value,
      rows,
      ingestedEventCount: state.value.ingestedEventCount + events.length,
      ingestDurationMs: state.value.ingestDurationMs + durationMs,
    }
    return Promise.resolve({ ingestedEventCount: events.length, durationMs })
  }

const createRetrieve =
  (state: StateCell): MemoryCandidateAdapter['retrieve'] =>
  (query: OperationalMemoryQuery): Promise<RawQueryResult> => {
    const startedAt = performance.now()
    state.value = { ...state.value, retrievalCount: state.value.retrievalCount + 1 }
    return Promise.resolve({
      status: 'success',
      queryId: query.queryId,
      hits: retrievedHits(activeScopeRows(state.value.rows, query), query),
      latencyMs: elapsedDurationMs(startedAt, performance.now()),
    })
  }

const createAssembleContext =
  (state: StateCell): MemoryCandidateAdapter['assembleContext'] =>
  (query): ReturnType<MemoryCandidateAdapter['assembleContext']> => {
    const recentRecords = [...activeScopeEvents(state.value.rows, query)]
      .sort(compareRecency)
      .slice(0, CONTEXT_RECORD_LIMIT)
    return Promise.resolve(assembleBoundedContext(recentRecords, query.contextTokenBudget))
  }

const createForget =
  (state: StateCell): MemoryCandidateAdapter['forget'] =>
  (request: ForgetRequest): Promise<ForgetResult> => {
    const erasedEvidenceIds = [
      ...new Set(
        state.value.rows
          .filter(({ archived, event }) => !archived && affectedByForget(event, request))
          .map(({ event }) => event.evidenceId),
      ),
    ].sort()
    const rows = state.value.rows.map((row) =>
      row.archived || !affectedByForget(row.event, request) ? row : { ...row, archived: true },
    )
    state.value = { ...state.value, rows }
    return Promise.resolve({ erasedEvidenceIds, completedAt: request.completedAt })
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
    await Promise.all(forgetRequests.map(forget))
  }

const createResourceMetrics =
  (state: StateCell): MemoryCandidateAdapter['resourceMetrics'] =>
  (): Promise<ResourceMetrics> => {
    const { rows, ingestedEventCount, ingestDurationMs, retrievalCount, rssBaselineBytes } = state.value
    return Promise.resolve(
      offlineResourceMetrics(rows, { ingestedEventCount, ingestDurationMs, retrievalCount }, [], rssBaselineBytes),
    )
  }

export const createAsShippedCandidate = (): MemoryCandidateAdapter => {
  const state: StateCell = { value: initialRuntimeState() }
  const reset = createReset(state)
  const ingest = createIngest(state)
  const forget = createForget(state)
  return {
    candidateId: 'as-shipped',
    version: 'as-shipped-v1',
    reset,
    ingest,
    retrieve: createRetrieve(state),
    assembleContext: createAssembleContext(state),
    forget,
    rebuild: createRebuild(reset, ingest, forget),
    resourceMetrics: createResourceMetrics(state),
  }
}
