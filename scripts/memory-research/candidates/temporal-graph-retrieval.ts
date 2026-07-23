// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { EvidenceIdSchema } from '../types.js'
import type { MemoryEvent, MemoryHit, OperationalMemoryQuery } from '../types.js'
import type { GraphEdgeStep, TemporalGraphStore } from './temporal-graph-store.js'

const MAX_FAN_OUT = 64
const MAX_PATHS_PER_LEVEL = 256
const RANK_FUSION_OFFSET = 60
export const MAX_GRAPH_ROOTS_PER_QUERY = 256

type PathState = Readonly<{
  entityId: string
  seedRank: number
  evidenceIds: MemoryHit['evidenceId'][]
  relationPath: readonly string[]
  visitedEntityIds: readonly string[]
  depth: number
  lastEdge: GraphEdgeStep | null
}>

export type GraphDiscovery = Readonly<{
  event: MemoryEvent
  evidenceIds: MemoryHit['evidenceId'][]
  seedRank: number
  depth: number
  pathKey: string
}>

const pathKey = (path: PathState): string =>
  `${path.seedRank}:${path.depth}:${path.relationPath.join('>')}:${path.entityId}`

const comparePath = (left: PathState, right: PathState): number => pathKey(left).localeCompare(pathKey(right))

const appendEvidence = (
  current: MemoryHit['evidenceId'][],
  evidenceId: MemoryHit['evidenceId'],
): MemoryHit['evidenceId'][] => (current.includes(evidenceId) ? current : [...current, evidenceId])

const traverseEdge = (path: PathState, edge: GraphEdgeStep): PathState | null => {
  if (path.visitedEntityIds.includes(edge.nextEntityId)) return null
  const evidenceId = EvidenceIdSchema.parse(edge.evidenceId)
  return {
    entityId: edge.nextEntityId,
    seedRank: path.seedRank,
    evidenceIds: appendEvidence(path.evidenceIds, evidenceId),
    relationPath: [...path.relationPath, `${edge.direction}:${edge.relationId}:${edge.nextEntityId}`],
    visitedEntityIds: [...path.visitedEntityIds, edge.nextEntityId],
    depth: path.depth + 1,
    lastEdge: edge,
  }
}

const expandLevel = (
  store: TemporalGraphStore,
  query: OperationalMemoryQuery,
  frontier: readonly PathState[],
): readonly PathState[] => {
  const queryTimeMs = Date.parse(query.queryTime)
  return frontier
    .flatMap((path) =>
      store
        .adjacent(query.authorizedScope, queryTimeMs, path.entityId, MAX_FAN_OUT)
        .map((edge) => traverseEdge(path, edge)),
    )
    .filter((path): path is PathState => path !== null)
    .sort(comparePath)
    .slice(0, MAX_PATHS_PER_LEVEL)
}

const initialPaths = (
  store: TemporalGraphStore,
  query: OperationalMemoryQuery,
  seedHits: readonly MemoryHit[],
): readonly PathState[] => {
  const queryTimeMs = Date.parse(query.queryTime)
  const boundedRoots = seedHits.reduce<readonly PathState[]>((paths, hit, index) => {
    const remaining = MAX_GRAPH_ROOTS_PER_QUERY - paths.length
    if (remaining <= 0) return paths
    const roots = store
      .sourceEntities(query.authorizedScope, queryTimeMs, hit.sourceEventId, remaining)
      .slice(0, remaining)
      .map((entityId) => ({
        entityId,
        seedRank: index + 1,
        evidenceIds: [hit.evidenceId],
        relationPath: [],
        visitedEntityIds: [entityId],
        depth: 0,
        lastEdge: null,
      }))
    return [...paths, ...roots]
  }, [])
  return [...boundedRoots].sort(comparePath)
}

const discoveryFor = (
  store: TemporalGraphStore,
  query: OperationalMemoryQuery,
  seedEvidenceIds: ReadonlySet<string>,
  path: PathState,
): GraphDiscovery | null => {
  const edge = path.lastEdge
  if (edge === null || seedEvidenceIds.has(edge.evidenceId)) return null
  const event = store.eventAt(query.authorizedScope, Date.parse(query.queryTime), edge.sourceEventId)
  return event === null
    ? null
    : {
        event,
        evidenceIds: path.evidenceIds,
        seedRank: path.seedRank,
        depth: path.depth,
        pathKey: pathKey(path),
      }
}

const compareDiscovery = (left: GraphDiscovery, right: GraphDiscovery): number =>
  left.depth - right.depth ||
  left.seedRank - right.seedRank ||
  left.pathKey.localeCompare(right.pathKey) ||
  left.event.evidenceId.localeCompare(right.event.evidenceId) ||
  left.event.eventId.localeCompare(right.event.eventId)

const distinctDiscoveries = (discoveries: readonly GraphDiscovery[]): readonly GraphDiscovery[] => {
  const seen = new Set<string>()
  return [...discoveries].sort(compareDiscovery).filter(({ event }) => {
    const key = `${event.scope.kind}:${event.scope.id}:${event.eventId}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export const collectGraphDiscoveries = (
  store: TemporalGraphStore,
  query: OperationalMemoryQuery,
  seedHits: readonly MemoryHit[],
): readonly GraphDiscovery[] => {
  if (query.actorRole === 'guest' || seedHits.length === 0) return []
  const seeds = new Set<string>(seedHits.map(({ evidenceId }) => evidenceId))
  const first = expandLevel(store, query, initialPaths(store, query, seedHits))
  const second = expandLevel(store, query, first)
  return distinctDiscoveries(
    [...first, ...second].flatMap((path) => {
      const discovery = discoveryFor(store, query, seeds, path)
      return discovery === null ? [] : [discovery]
    }),
  )
}

const graphHit = (discovery: GraphDiscovery, graphRank: number): MemoryHit => {
  const graph = 1 / (RANK_FUSION_OFFSET + graphRank)
  return {
    evidenceId: discovery.event.evidenceId,
    sourceEventId: discovery.event.eventId,
    scope: discovery.event.scope,
    score: { lexical: 0, dense: 0, graph, recency: 0, total: graph },
    rank: graphRank,
    content: discovery.event.content,
    validity: discovery.event.validity,
    provenance: { kind: 'derived', derivedFromEvidenceIds: discovery.evidenceIds },
  }
}

const compareHit = (left: MemoryHit, right: MemoryHit): number =>
  right.score.total - left.score.total ||
  left.evidenceId.localeCompare(right.evidenceId) ||
  left.sourceEventId.localeCompare(right.sourceEventId)

export const fuseGraphHits = (
  query: OperationalMemoryQuery,
  seedHits: readonly MemoryHit[],
  discoveries: readonly GraphDiscovery[],
): readonly MemoryHit[] =>
  [...seedHits, ...discoveries.map((discovery, index) => graphHit(discovery, index + 1))]
    .sort(compareHit)
    .slice(0, query.k)
    .map((hit, index) => ({ ...hit, rank: index + 1 }))
