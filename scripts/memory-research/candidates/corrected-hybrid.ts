// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { cosineSimilarity, deterministicEmbedding, deterministicTokens } from '../deterministic-embedding.js'
import { DETERMINISTIC_EMBEDDING_VERSION } from '../types.js'
import type {
  ForgetRequest,
  ForgetResult,
  IngestResult,
  MemoryCandidateAdapter,
  MemoryEvent,
  MemoryHit,
  OperationalMemoryQuery,
  MemoryScope,
  RawQueryResult,
  ResourceMetrics,
} from '../types.js'
import { assembleBoundedContext, elapsedDurationMs, memoryHit, offlineResourceMetrics, sameScope } from './shared.js'
import type { StoredMemoryEvent } from './shared.js'

const RANK_FUSION_OFFSET = 60
const LEXICAL_FUSION_WEIGHT = 2
/** Minimum cosine similarity required before dense-only evidence can be retrieved. */
export const DENSE_ELIGIBILITY_THRESHOLD = 0.65

type Stored = StoredMemoryEvent & Readonly<{ tokens: ReadonlySet<string> }>
type Tombstone =
  | Readonly<{ kind: 'evidence'; scope: MemoryScope; evidenceIds: readonly string[] }>
  | Readonly<{ kind: 'subject'; scope: MemoryScope; subjectId: string }>
  | Readonly<{ kind: 'scope'; scope: MemoryScope }>
type Scored = Readonly<{ row: Stored; score: number }>
type RuntimeState = Readonly<{
  rows: Map<string, Stored>
  inverted: Map<string, Set<string>>
  tombstones: readonly Tombstone[]
  ingestedEventCount: number
  ingestDurationMs: number
  retrievalCount: number
  rssBaselineBytes: number
}>
type StateCell = { value: RuntimeState }

const tokens = (text: string): ReadonlySet<string> => new Set(deterministicTokens(text))
const validAt = (event: MemoryEvent, queryTime: string): boolean => {
  const queryEpoch = Date.parse(queryTime)
  const fromEpoch = Date.parse(event.validity.validFrom)
  const toEpoch = event.validity.validTo === null ? null : Date.parse(event.validity.validTo)
  return fromEpoch <= queryEpoch && (toEpoch === null || queryEpoch < toEpoch)
}
const lexicalScore = (queryTokens: ReadonlySet<string>, rowTokens: ReadonlySet<string>): number =>
  queryTokens.size === 0 ? 0 : [...queryTokens].filter((token) => rowTokens.has(token)).length / queryTokens.size
const compareScore = (left: Scored, right: Scored): number =>
  right.score - left.score ||
  left.row.event.evidenceId.localeCompare(right.row.event.evidenceId) ||
  left.row.event.eventId.localeCompare(right.row.event.eventId)
const insertBounded = (current: readonly Scored[], candidate: Scored, limit: number): readonly Scored[] =>
  [...current, candidate].sort(compareScore).slice(0, limit)
const affected = (event: MemoryEvent, request: ForgetRequest): boolean =>
  sameScope(event.scope, request.scope) &&
  (request.kind === 'scope' ||
    (request.kind === 'evidence' && request.evidenceIds.includes(event.evidenceId)) ||
    (request.kind === 'subject' && event.entities.some(({ entityId }) => entityId === request.subjectId)))
const tombstoneFor = (request: ForgetRequest): Tombstone =>
  request.kind === 'scope'
    ? { kind: 'scope', scope: request.scope }
    : request.kind === 'subject'
      ? { kind: 'subject', scope: request.scope, subjectId: request.subjectId }
      : { kind: 'evidence', scope: request.scope, evidenceIds: request.evidenceIds }
const blocked = (event: MemoryEvent, tombstone: Tombstone): boolean =>
  sameScope(event.scope, tombstone.scope) &&
  (tombstone.kind === 'scope' ||
    (tombstone.kind === 'evidence' && tombstone.evidenceIds.includes(event.evidenceId)) ||
    (tombstone.kind === 'subject' && event.entities.some(({ entityId }) => entityId === tombstone.subjectId)))
const sameHit = (event: MemoryEvent, hit: MemoryHit): boolean =>
  event.eventId === hit.sourceEventId && event.evidenceId === hit.evidenceId

const initialRuntimeState = (): RuntimeState => ({
  rows: new Map(),
  inverted: new Map(),
  tombstones: [],
  ingestedEventCount: 0,
  ingestDurationMs: 0,
  retrievalCount: 0,
  rssBaselineBytes: process.memoryUsage.rss(),
})

const removeFromIndex = (inverted: Map<string, Set<string>>, row: Stored): void => {
  row.tokens.forEach((token) => {
    const ids = inverted.get(token)
    if (ids === undefined) return
    ids.delete(row.event.eventId)
    if (ids.size === 0) inverted.delete(token)
  })
}

const addToIndex = (inverted: Map<string, Set<string>>, row: Stored): void => {
  row.tokens.forEach((token) => {
    const ids = inverted.get(token)
    if (ids === undefined) inverted.set(token, new Set([row.event.eventId]))
    else ids.add(row.event.eventId)
  })
}

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
    events
      .filter((event) => !state.value.tombstones.some((tombstone) => blocked(event, tombstone)))
      .forEach((event) => {
        const prior = state.value.rows.get(event.eventId)
        if (prior !== undefined) removeFromIndex(state.value.inverted, prior)
        const row: Stored = {
          event,
          archived: false,
          vector: event.embedding.available ? deterministicEmbedding(event.content) : null,
          tokens: tokens(event.content),
        }
        state.value.rows.set(event.eventId, row)
        addToIndex(state.value.inverted, row)
      })
    const durationMs = elapsedDurationMs(startedAt, performance.now())
    state.value = {
      ...state.value,
      ingestedEventCount: state.value.ingestedEventCount + events.length,
      ingestDurationMs: state.value.ingestDurationMs + durationMs,
    }
    return Promise.resolve({ ingestedEventCount: events.length, durationMs })
  }

const eligibleRows = (state: RuntimeState, query: OperationalMemoryQuery): readonly Stored[] =>
  query.actorRole === 'guest'
    ? []
    : [...state.rows.values()].filter(
        ({ event }) => sameScope(event.scope, query.authorizedScope) && validAt(event, query.queryTime),
      )

const lexicalCandidates = (
  state: RuntimeState,
  active: readonly Stored[],
  query: OperationalMemoryQuery,
): readonly Scored[] => {
  const activeIds = new Set<string>(active.map(({ event }) => event.eventId))
  const queryTokens = tokens(query.text)
  const lexicalIds = new Set(
    [...queryTokens].flatMap((token) => [...(state.inverted.get(token) ?? [])]).filter((id) => activeIds.has(id)),
  )
  return [...lexicalIds].reduce<readonly Scored[]>((best, id) => {
    const row = state.rows.get(id)
    return row === undefined
      ? best
      : insertBounded(best, { row, score: lexicalScore(queryTokens, row.tokens) }, query.k)
  }, [])
}

const denseCandidates = (active: readonly Stored[], query: OperationalMemoryQuery): readonly Scored[] => {
  const queryVector = deterministicEmbedding(query.text)
  return active.reduce<readonly Scored[]>((best, row) => {
    const score =
      row.vector !== null &&
      row.event.embedding.available &&
      row.event.embedding.version === DETERMINISTIC_EMBEDDING_VERSION
        ? cosineSimilarity(queryVector, row.vector)
        : -1
    return score >= DENSE_ELIGIBILITY_THRESHOLD ? insertBounded(best, { row, score }, query.k) : best
  }, [])
}

const fusedHits = (
  rows: ReadonlyMap<string, Stored>,
  lexicalMatches: readonly Scored[],
  denseMatches: readonly Scored[],
  limit: number,
): readonly MemoryHit[] => {
  const lexicalRanks = new Map(lexicalMatches.map(({ row }, index) => [row.event.eventId, index + 1] as const))
  const denseRanks = new Map(denseMatches.map(({ row }, index) => [row.event.eventId, index + 1] as const))
  const lexicalScores = new Map(lexicalMatches.map(({ row, score }) => [row.event.eventId, score] as const))
  const denseScores = new Map(denseMatches.map(({ row, score }) => [row.event.eventId, score] as const))
  return [...new Set([...lexicalRanks.keys(), ...denseRanks.keys()])]
    .flatMap((id) => {
      const row = rows.get(id)
      if (row === undefined) return []
      const lexicalRank = lexicalRanks.get(id)
      const denseRank = denseRanks.get(id)
      const lexicalScoreValue = lexicalScores.get(id) ?? 0
      const denseScoreValue = denseScores.get(id) ?? 0
      const total =
        (lexicalRank === undefined ? 0 : LEXICAL_FUSION_WEIGHT / (RANK_FUSION_OFFSET + lexicalRank)) +
        (denseRank === undefined ? 0 : 1 / (RANK_FUSION_OFFSET + denseRank))
      return [{ row, lexicalScoreValue, denseScoreValue, total }]
    })
    .sort(
      (left, right) =>
        right.total - left.total ||
        left.row.event.evidenceId.localeCompare(right.row.event.evidenceId) ||
        left.row.event.eventId.localeCompare(right.row.event.eventId),
    )
    .slice(0, limit)
    .map(({ row, lexicalScoreValue, denseScoreValue, total }, index) => ({
      ...memoryHit(row.event, index + 1, { lexical: lexicalScoreValue, dense: denseScoreValue }),
      score: { lexical: lexicalScoreValue, dense: denseScoreValue, graph: 0, recency: 0, total },
    }))
}

const createRetrieve =
  (state: StateCell): MemoryCandidateAdapter['retrieve'] =>
  (query: OperationalMemoryQuery): Promise<RawQueryResult> => {
    const startedAt = performance.now()
    state.value = { ...state.value, retrievalCount: state.value.retrievalCount + 1 }
    const active = eligibleRows(state.value, query)
    const lexical = lexicalCandidates(state.value, active, query)
    const dense = denseCandidates(active, query)
    return Promise.resolve({
      status: 'success',
      queryId: query.queryId,
      hits: fusedHits(state.value.rows, lexical, dense, query.k),
      latencyMs: elapsedDurationMs(startedAt, performance.now()),
    })
  }

const createAssembleContext =
  (state: StateCell): MemoryCandidateAdapter['assembleContext'] =>
  (query, hits): ReturnType<MemoryCandidateAdapter['assembleContext']> => {
    if (query.actorRole === 'guest') return Promise.resolve({ text: '', evidenceIds: [], tokenCount: 0 })
    const active = eligibleRows(state.value, query)
    const events = hits.flatMap((hit) => active.filter(({ event }) => sameHit(event, hit)).map(({ event }) => event))
    return Promise.resolve(assembleBoundedContext(events, query.contextTokenBudget))
  }

const createForget =
  (state: StateCell): MemoryCandidateAdapter['forget'] =>
  (request: ForgetRequest): Promise<ForgetResult> => {
    const matchingRows = [...state.value.rows.values()].filter(({ event }) => affected(event, request))
    const erasedEvidenceIds = matchingRows.map(({ event }) => event.evidenceId).sort()
    matchingRows.forEach((row) => {
      removeFromIndex(state.value.inverted, row)
      state.value.rows.delete(row.event.eventId)
    })
    state.value = { ...state.value, tombstones: [...state.value.tombstones, tombstoneFor(request)] }
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
    await forgetRequests.reduce<Promise<void>>(
      (chain, request) => chain.then(() => forget(request)).then(() => undefined),
      Promise.resolve(),
    )
  }

const createResourceMetrics =
  (state: StateCell): MemoryCandidateAdapter['resourceMetrics'] =>
  (): Promise<ResourceMetrics> => {
    const { rows, inverted, tombstones, ingestedEventCount, ingestDurationMs, retrievalCount, rssBaselineBytes } =
      state.value
    return Promise.resolve(
      offlineResourceMetrics(
        [...rows.values()],
        { ingestedEventCount, ingestDurationMs, retrievalCount },
        { inverted: [...inverted.entries()].map(([token, ids]) => [token, [...ids]]), tombstones },
        rssBaselineBytes,
      ),
    )
  }

export const createCorrectedHybridCandidate = (): MemoryCandidateAdapter => {
  const state: StateCell = { value: initialRuntimeState() }
  const reset = createReset(state)
  const ingest = createIngest(state)
  const forget = createForget(state)
  return {
    candidateId: 'corrected-hybrid',
    version: 'corrected-hybrid-v1',
    reset,
    ingest,
    retrieve: createRetrieve(state),
    assembleContext: createAssembleContext(state),
    forget,
    rebuild: createRebuild(reset, ingest, forget),
    resourceMetrics: createResourceMetrics(state),
  }
}
