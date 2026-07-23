// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { AssembledContext, MemoryEvent, MemoryHit, OperationalMemoryQuery } from '../types.js'
import type { DerivedMemory, DerivativeKind, HierarchyState } from './hierarchical-projection.js'
import { eventHierarchyTokens, meaningfulHierarchyTokens } from './hierarchical-projection.js'
import { countTokens, sameScope } from './shared.js'

type LeafAssembly = Readonly<{
  lines: readonly string[]
  events: readonly MemoryEvent[]
  provenanceEvidenceIds: readonly MemoryEvent['evidenceId'][]
  tokenCount: number
}>
type LiveDerivative = Readonly<{
  derivative: DerivedMemory
  liveMembers: readonly MemoryEvent[]
  queryOverlap: number
  liveTokenCount: number
}>

const overlapCount = (left: ReadonlySet<string>, right: readonly string[]): number =>
  right.reduce((sum, token) => sum + (left.has(token) ? 1 : 0), 0)

const assembleSuppliedLeaves = (
  query: OperationalMemoryQuery,
  hits: readonly MemoryHit[],
  eligibleByEvent: ReadonlyMap<string, MemoryEvent>,
): LeafAssembly =>
  hits.reduce<LeafAssembly>(
    (current, hit) => {
      const event = eligibleByEvent.get(hit.sourceEventId)
      if (
        event === undefined ||
        event.evidenceId !== hit.evidenceId ||
        current.events.some(({ eventId }) => eventId === event.eventId)
      ) {
        return current
      }
      const eventTokens = countTokens(event.content)
      if (current.tokenCount + eventTokens > query.contextTokenBudget) return current
      const provenanceEvidenceIds = hit.provenance.kind === 'derived' ? hit.provenance.derivedFromEvidenceIds : []
      return {
        lines: [...current.lines, event.content],
        events: [...current.events, event],
        provenanceEvidenceIds: [...new Set([...current.provenanceEvidenceIds, ...provenanceEvidenceIds])],
        tokenCount: current.tokenCount + eventTokens,
      }
    },
    { lines: [], events: [], provenanceEvidenceIds: [], tokenCount: 0 },
  )

const supportingEvents = (
  query: OperationalMemoryQuery,
  supplied: LeafAssembly,
  eligibleEvents: readonly MemoryEvent[],
): readonly MemoryEvent[] => {
  const provenance = new Set(supplied.provenanceEvidenceIds)
  const included = new Set(supplied.events.map(({ eventId }) => eventId))
  const queryTokens = new Set(meaningfulHierarchyTokens(query.text))
  return eligibleEvents
    .filter((event) => provenance.has(event.evidenceId) && !included.has(event.eventId))
    .map((event) => ({ event, overlap: overlapCount(queryTokens, eventHierarchyTokens(event)) }))
    .filter(({ overlap }) => overlap > 0)
    .sort(
      (left, right) =>
        right.overlap - left.overlap ||
        left.event.evidenceId.localeCompare(right.event.evidenceId) ||
        left.event.eventId.localeCompare(right.event.eventId),
    )
    .slice(0, query.k)
    .map(({ event }) => event)
}

const appendSupportingLeaves = (
  query: OperationalMemoryQuery,
  supplied: LeafAssembly,
  supporters: readonly MemoryEvent[],
): LeafAssembly =>
  supporters.reduce<LeafAssembly>((current, event) => {
    const line = `${event.content} [evidence:${event.evidenceId}]`
    const eventTokens = countTokens(line)
    return current.tokenCount + eventTokens > query.contextTokenBudget
      ? current
      : {
          ...current,
          lines: [...current.lines, line],
          events: [...current.events, event],
          tokenCount: current.tokenCount + eventTokens,
        }
  }, supplied)

const liveDerivative = (
  derivative: DerivedMemory,
  eligibleByEvidence: ReadonlyMap<string, MemoryEvent>,
  queryTokens: ReadonlySet<string>,
): LiveDerivative => {
  const liveMembers = derivative.evidenceIds.flatMap((evidenceId) => {
    const member = eligibleByEvidence.get(evidenceId)
    return member === undefined ? [] : [member]
  })
  const liveTokens = [...new Set(liveMembers.flatMap(eventHierarchyTokens))]
  return {
    derivative,
    liveMembers,
    queryOverlap: overlapCount(queryTokens, liveTokens),
    liveTokenCount: liveTokens.length,
  }
}

const hierarchyContextLines = (
  query: OperationalMemoryQuery,
  includedEvents: readonly MemoryEvent[],
  eligibleEvents: readonly MemoryEvent[],
  hierarchy: HierarchyState,
): readonly string[] => {
  const includedByEvidence = new Map(includedEvents.map((event) => [event.evidenceId, event]))
  const eligibleByEvidence = new Map(eligibleEvents.map((event) => [event.evidenceId, event]))
  const candidateIds = new Set(
    includedEvents.flatMap(({ evidenceId }) => [...(hierarchy.dependencies.get(evidenceId) ?? [])]),
  )
  const queryTokens = new Set(meaningfulHierarchyTokens(query.text))
  const candidates = [...candidateIds]
    .flatMap((id) => {
      const derivative = hierarchy.derivatives.get(id)
      return derivative === undefined || derivative.kind === 'fact'
        ? []
        : [liveDerivative(derivative, eligibleByEvidence, queryTokens)]
    })
    .filter(
      ({ derivative, liveMembers, queryOverlap }) =>
        liveMembers.length > 1 && sameScope(derivative.scope, query.authorizedScope) && queryOverlap > 0,
    )
    .sort(
      (left, right) =>
        (left.derivative.kind === 'session' ? 0 : 1) - (right.derivative.kind === 'session' ? 0 : 1) ||
        right.queryOverlap - left.queryOverlap ||
        right.liveTokenCount - left.liveTokenCount ||
        left.derivative.derivedId.localeCompare(right.derivative.derivedId),
    )
  const selectedKinds = new Set<DerivativeKind>()
  return candidates.flatMap(({ derivative, liveMembers }) => {
    if (selectedKinds.has(derivative.kind)) return []
    const members = liveMembers.filter(({ evidenceId }) => includedByEvidence.has(evidenceId))
    if (members.length === 0) return []
    selectedKinds.add(derivative.kind)
    const heading = derivative.kind === 'session' ? 'Session summary' : 'Topic summary'
    const citations = members.map(({ evidenceId }) => `[evidence:${evidenceId}]`).join(' ')
    return [`${heading} (${derivative.label}): ${members.map(({ content }) => content).join(' ')} ${citations}`]
  })
}

const addBoundedHierarchyLines = (
  lines: readonly string[],
  initialTokenCount: number,
  budget: number,
): Readonly<{ lines: readonly string[]; tokenCount: number }> =>
  lines.reduce(
    (current, line) => {
      const lineTokens = countTokens(line)
      return current.tokenCount + lineTokens > budget
        ? current
        : { lines: [...current.lines, line], tokenCount: current.tokenCount + lineTokens }
    },
    { lines: [] as readonly string[], tokenCount: initialTokenCount },
  )

export const assembleHierarchyContext = (
  query: OperationalMemoryQuery,
  hits: readonly MemoryHit[],
  eligibleEvents: readonly MemoryEvent[],
  hierarchy: HierarchyState,
): AssembledContext => {
  if (query.actorRole === 'guest') return { text: '', evidenceIds: [], tokenCount: 0 }
  const eligibleByEvent = new Map(eligibleEvents.map((event) => [event.eventId, event]))
  const supplied = assembleSuppliedLeaves(query, hits, eligibleByEvent)
  const leaves = appendSupportingLeaves(query, supplied, supportingEvents(query, supplied, eligibleEvents))
  const hierarchyLines = hierarchyContextLines(query, leaves.events, eligibleEvents, hierarchy)
  const summaries = addBoundedHierarchyLines(hierarchyLines, leaves.tokenCount, query.contextTokenBudget)
  return {
    text: [...leaves.lines, ...summaries.lines].join('\n'),
    evidenceIds: leaves.events.map(({ evidenceId }) => evidenceId),
    tokenCount: summaries.tokenCount,
  }
}
