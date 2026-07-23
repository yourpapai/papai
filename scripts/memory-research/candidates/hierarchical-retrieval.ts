// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { MAX_MEMORY_HIT_PROVENANCE_EVIDENCE_IDS } from '../types.js'
import type { MemoryEvent, MemoryHit, OperationalMemoryQuery } from '../types.js'
import type { DerivedMemory, DerivativeKind, HierarchyState } from './hierarchical-projection.js'
import { eventHierarchyTokens, meaningfulHierarchyTokens } from './hierarchical-projection.js'
import { memoryHit, sameScope } from './shared.js'

const DERIVED_MEMBER_LIMIT_MULTIPLIER = 4
const MIN_DERIVED_MEMBER_LIMIT = 32

type DerivedContribution = Readonly<{
  event: MemoryEvent
  lexical: number
  total: number
  provenanceEvidenceIds: readonly MemoryEvent['evidenceId'][]
  sourceKind: DerivativeKind
  sourceId: string
}>
type RankedMember = Readonly<{ event: MemoryEvent; overlap: number }>

const overlapCount = (left: ReadonlySet<string>, right: readonly string[]): number =>
  right.reduce((sum, token) => sum + (left.has(token) ? 1 : 0), 0)
const hierarchyWeight = (kind: DerivativeKind): number => (kind === 'topic' ? 1.25 : kind === 'session' ? 1 : 0.5)
const compareRankedMember = (left: RankedMember, right: RankedMember): number =>
  right.overlap - left.overlap ||
  right.event.ingestTime.localeCompare(left.event.ingestTime) ||
  left.event.evidenceId.localeCompare(right.event.evidenceId) ||
  left.event.eventId.localeCompare(right.event.eventId)
const betterContribution = (left: DerivedContribution, right: DerivedContribution): boolean =>
  left.total > right.total ||
  (left.total === right.total &&
    (hierarchyWeight(left.sourceKind) > hierarchyWeight(right.sourceKind) ||
      (hierarchyWeight(left.sourceKind) === hierarchyWeight(right.sourceKind) &&
        left.sourceId.localeCompare(right.sourceId) < 0)))

const boundedProvenance = (
  evidenceIds: readonly MemoryEvent['evidenceId'][],
  memberEvidenceId: MemoryEvent['evidenceId'],
): readonly MemoryEvent['evidenceId'][] => {
  const bounded = [...evidenceIds].sort().slice(0, MAX_MEMORY_HIT_PROVENANCE_EVIDENCE_IDS)
  return bounded.includes(memberEvidenceId)
    ? bounded
    : [...bounded.slice(0, MAX_MEMORY_HIT_PROVENANCE_EVIDENCE_IDS - 1), memberEvidenceId].sort()
}

const contributionsForDerivative = (
  derivative: DerivedMemory,
  query: OperationalMemoryQuery,
  queryTokens: ReadonlySet<string>,
  eligibleByEvidence: ReadonlyMap<string, MemoryEvent>,
): readonly DerivedContribution[] => {
  if (!sameScope(derivative.scope, query.authorizedScope)) return []
  const liveMembers = derivative.evidenceIds.flatMap((evidenceId) => {
    const member = eligibleByEvidence.get(evidenceId)
    return member === undefined
      ? []
      : [{ event: member, overlap: overlapCount(queryTokens, eventHierarchyTokens(member)) }]
  })
  const liveTokens = [...new Set(liveMembers.flatMap(({ event }) => eventHierarchyTokens(event)))]
  const nodeOverlap = overlapCount(queryTokens, liveTokens)
  const requiredOverlap = derivative.kind === 'fact' ? 1 : Math.min(2, queryTokens.size)
  if (nodeOverlap < requiredOverlap) return []
  const memberLimit = Math.max(MIN_DERIVED_MEMBER_LIMIT, query.k * DERIVED_MEMBER_LIMIT_MULTIPLIER)
  const evidenceIds = liveMembers.map(({ event }) => event.evidenceId)
  return [...liveMembers]
    .sort(compareRankedMember)
    .slice(0, memberLimit)
    .map(({ event, overlap }) => ({
      event,
      lexical: Math.max(nodeOverlap, overlap) / queryTokens.size,
      total: (nodeOverlap / queryTokens.size) * hierarchyWeight(derivative.kind) + overlap / queryTokens.size / 4,
      provenanceEvidenceIds: boundedProvenance(evidenceIds, event.evidenceId),
      sourceKind: derivative.kind,
      sourceId: derivative.derivedId,
    }))
}

export const collectHierarchyContributions = (
  query: OperationalMemoryQuery,
  hierarchy: HierarchyState,
  eligibleByEvidence: ReadonlyMap<string, MemoryEvent>,
): ReadonlyMap<string, DerivedContribution> => {
  const queryTokens = new Set(meaningfulHierarchyTokens(query.text))
  if (queryTokens.size === 0) return new Map()
  const matchedNodeIds = new Set([...queryTokens].flatMap((token) => [...(hierarchy.inverted.get(token) ?? [])]))
  const contributions = new Map<string, DerivedContribution>()
  matchedNodeIds.forEach((derivedId) => {
    const derivative = hierarchy.derivatives.get(derivedId)
    if (derivative === undefined) return
    contributionsForDerivative(derivative, query, queryTokens, eligibleByEvidence).forEach((contribution) => {
      const current = contributions.get(contribution.event.eventId)
      if (current === undefined || betterContribution(contribution, current)) {
        contributions.set(contribution.event.eventId, contribution)
      }
    })
  })
  return contributions
}

export const combineHierarchyHits = (
  query: OperationalMemoryQuery,
  baseHits: readonly MemoryHit[],
  contributions: ReadonlyMap<string, DerivedContribution>,
): readonly MemoryHit[] => {
  const baseByEvent = new Map<string, MemoryHit>(baseHits.map((hit) => [hit.sourceEventId, hit]))
  const eventIds = new Set([...baseByEvent.keys(), ...contributions.keys()])
  return [...eventIds]
    .flatMap((eventId) => {
      const base = baseByEvent.get(eventId)
      const contribution = contributions.get(eventId)
      if (base === undefined && contribution === undefined) return []
      const canonical = base ?? memoryHit(contribution!.event, 1)
      return [
        {
          ...canonical,
          score: {
            ...canonical.score,
            lexical: Math.max(canonical.score.lexical, contribution?.lexical ?? 0),
            total: canonical.score.total + (contribution?.total ?? 0),
          },
          provenance:
            contribution === undefined
              ? canonical.provenance
              : {
                  kind: 'derived' as const,
                  derivedFromEvidenceIds: contribution.provenanceEvidenceIds,
                },
        },
      ]
    })
    .sort(
      (left, right) =>
        right.score.total - left.score.total ||
        left.evidenceId.localeCompare(right.evidenceId) ||
        left.sourceEventId.localeCompare(right.sourceEventId),
    )
    .slice(0, query.k)
    .map((hit, index) => ({ ...hit, rank: index + 1 }))
}
