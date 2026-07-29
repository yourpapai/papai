// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { CandidateId, NonGraphCandidateId, PairedInterval, ValidationResult } from './statistics.js'

export type DeltaInterval = Pick<PairedInterval, 'pointDelta' | 'lower95' | 'upper95'>
export type PracticalSuperiorityInput = Readonly<{
  weightedScoreDelta: number
  overallNdcgDelta: DeltaInterval
}>
export type HierarchySuperiorityInput = PracticalSuperiorityInput & Readonly<{ longHorizonDelta: DeltaInterval }>

export type GraphCostResources = Readonly<{
  retrievalP95Ms: number
  ingestDurationMs: number
  attemptedRecordCount: number
  modelCallCount: number
  extractorCallCount: number
  storedBytes: number
}>

export type GraphGateInput = Readonly<{
  comparatorId: NonGraphCandidateId
  graphEligible: boolean
  comparatorEligible: boolean
  graphWeightedScore: number
  comparatorWeightedScore: number
  relationalTemporalDelta: DeltaInterval
  graphResources: GraphCostResources
  comparatorResources: GraphCostResources
  projectionRebuildable: boolean
}>

export type GraphGateEvaluation = Readonly<{
  pass: boolean
  comparatorId: NonGraphCandidateId
  ratios: Readonly<{
    retrievalP95: number
    ingestCostPerAttempt: number
    callCostPerAttempt: number
    storedBytes: number
  }>
  failedCriteria: readonly string[]
}>

export type DecisionCandidate = Readonly<{
  candidateId: CandidateId
  eligible: boolean
  weightedScore: number | null
}>

export type PromotionEvidence = Readonly<{
  challenger: Exclude<NonGraphCandidateId, 'as-shipped'>
  comparator: NonGraphCandidateId
  weightedScoreDelta: number
  overallNdcgDelta: DeltaInterval
  longHorizonDelta?: DeltaInterval
}>

export type RepresentationDecisionInput = Readonly<{
  candidates: readonly DecisionCandidate[]
  promotions: readonly PromotionEvidence[]
  graphGate: GraphGateEvaluation | null
}>

export type RepresentationOutcome =
  | 'retain-shipped-behavior'
  | 'repair-hybrid'
  | 'adopt-hierarchy'
  | 'add-derived-temporal-graph'
  | 'block-adoption'

const valid = <Value>(value: Value): ValidationResult<Value> => ({ valid: true, value })
const invalid = <Value = never>(...errors: readonly string[]): ValidationResult<Value> => ({ valid: false, errors })
const finitePositive = (value: number): boolean => Number.isFinite(value) && value > 0
const validDelta = (delta: DeltaInterval): boolean =>
  [delta.pointDelta, delta.lower95, delta.upper95].every(Number.isFinite) && delta.lower95 <= delta.upper95

export const evaluatePracticalSuperiority = (input: PracticalSuperiorityInput): boolean =>
  Number.isFinite(input.weightedScoreDelta) &&
  validDelta(input.overallNdcgDelta) &&
  input.weightedScoreDelta >= 2 &&
  input.overallNdcgDelta.lower95 > 0

export const evaluateHierarchySuperiority = (
  input: HierarchySuperiorityInput,
): Readonly<{ pass: boolean; path: 'general' | 'special' | 'none' }> => {
  if (evaluatePracticalSuperiority(input)) return { pass: true, path: 'general' }
  const special =
    Number.isFinite(input.weightedScoreDelta) &&
    validDelta(input.longHorizonDelta) &&
    input.weightedScoreDelta >= -2 &&
    input.longHorizonDelta.pointDelta >= 0.05 &&
    input.longHorizonDelta.lower95 > 0
  return special ? { pass: true, path: 'special' } : { pass: false, path: 'none' }
}

export const callCostRatio = (candidate: number, comparator: number): number => {
  if (candidate === 0 && comparator === 0) return 1
  if (comparator === 0) return Number.POSITIVE_INFINITY
  return candidate / comparator
}

const graphResourceErrors = (label: string, resources: GraphCostResources): readonly string[] => [
  ...(['retrievalP95Ms', 'ingestDurationMs', 'storedBytes'] as const)
    .filter((key) => !finitePositive(resources[key]))
    .map((key) => `${label} ${key} must be finite and strictly positive`),
  ...(Number.isInteger(resources.attemptedRecordCount) && resources.attemptedRecordCount > 0
    ? []
    : [`${label} attemptedRecordCount must be a positive integer`]),
  ...(['modelCallCount', 'extractorCallCount'] as const)
    .filter((key) => !Number.isInteger(resources[key]) || resources[key] < 0)
    .map((key) => `${label} ${key} must be a nonnegative integer`),
]

const graphRatios = (graph: GraphCostResources, comparator: GraphCostResources): GraphGateEvaluation['ratios'] => {
  const graphCallsPerAttempt = (graph.modelCallCount + graph.extractorCallCount) / graph.attemptedRecordCount
  const comparatorCallsPerAttempt =
    (comparator.modelCallCount + comparator.extractorCallCount) / comparator.attemptedRecordCount
  return {
    retrievalP95: graph.retrievalP95Ms / comparator.retrievalP95Ms,
    ingestCostPerAttempt:
      graph.ingestDurationMs /
      graph.attemptedRecordCount /
      (comparator.ingestDurationMs / comparator.attemptedRecordCount),
    callCostPerAttempt: callCostRatio(graphCallsPerAttempt, comparatorCallsPerAttempt),
    storedBytes: graph.storedBytes / comparator.storedBytes,
  }
}

export const evaluateGraphGate = (input: GraphGateInput): ValidationResult<GraphGateEvaluation> => {
  const errors = [
    ...graphResourceErrors('graph', input.graphResources),
    ...graphResourceErrors('comparator', input.comparatorResources),
    ...([input.graphWeightedScore, input.comparatorWeightedScore].every(Number.isFinite)
      ? []
      : ['graph weighted scores must be finite']),
    ...(validDelta(input.relationalTemporalDelta) ? [] : ['relational/temporal delta must be finite']),
  ]
  if (errors.length > 0) return invalid(...errors)
  const ratios = graphRatios(input.graphResources, input.comparatorResources)
  const criteria = [
    ['eligibility', input.graphEligible && input.comparatorEligible],
    ['relational-temporal-delta', input.relationalTemporalDelta.pointDelta >= 0.05],
    ['relational-temporal-interval', input.relationalTemporalDelta.lower95 > 0],
    ['weighted-score-loss', input.graphWeightedScore - input.comparatorWeightedScore >= -2],
    ['retrieval-p95', ratios.retrievalP95 <= 2],
    ['ingest-cost', ratios.ingestCostPerAttempt <= 1.5],
    ['call-cost', ratios.callCostPerAttempt <= 1.5],
    ['stored-bytes', ratios.storedBytes <= 3],
    ['rebuildable-projection', input.projectionRebuildable],
  ] as const
  const failedCriteria = criteria.filter(([, passed]) => !passed).map(([name]) => name)
  return valid({
    pass: failedCriteria.length === 0,
    comparatorId: input.comparatorId,
    ratios,
    failedCriteria,
  })
}

const complexity = {
  'as-shipped': 0,
  'corrected-hybrid': 1,
  hierarchical: 2,
} as const satisfies Readonly<Record<NonGraphCandidateId, number>>

type EligibleNonGraphCandidate = DecisionCandidate &
  Readonly<{ candidateId: NonGraphCandidateId; weightedScore: number }>

const eligibleNonGraph = (candidates: readonly DecisionCandidate[]): readonly EligibleNonGraphCandidate[] =>
  candidates.filter(
    (candidate): candidate is EligibleNonGraphCandidate =>
      candidate.candidateId !== 'temporal-graph' &&
      candidate.eligible &&
      candidate.weightedScore !== null &&
      Number.isFinite(candidate.weightedScore),
  )

export const selectStrongestEligibleNonGraph = (
  candidates: readonly DecisionCandidate[],
): ValidationResult<NonGraphCandidateId> => {
  const invalidEligible = candidates.filter(
    ({ candidateId, eligible, weightedScore }) =>
      candidateId !== 'temporal-graph' && eligible && (weightedScore === null || !Number.isFinite(weightedScore)),
  )
  if (invalidEligible.length > 0) return invalid('eligible non-graph candidates require finite weighted scores')
  const eligible = eligibleNonGraph(candidates)
  if (eligible.length === 0) return invalid('no scored eligible non-graph candidate')
  const ordered = [...eligible].sort(
    (left, right) =>
      right.weightedScore - left.weightedScore || complexity[left.candidateId] - complexity[right.candidateId],
  )
  const strongest = ordered[0]
  return strongest === undefined ? invalid('no strongest non-graph candidate') : valid(strongest.candidateId)
}

const promotionPasses = (promotion: PromotionEvidence, weightedScoreDelta: number): boolean => {
  const general = evaluatePracticalSuperiority({
    weightedScoreDelta,
    overallNdcgDelta: promotion.overallNdcgDelta,
  })
  if (general) return true
  if (
    promotion.challenger !== 'hierarchical' ||
    promotion.comparator !== 'corrected-hybrid' ||
    promotion.longHorizonDelta === undefined
  ) {
    return false
  }
  return evaluateHierarchySuperiority({
    weightedScoreDelta,
    overallNdcgDelta: promotion.overallNdcgDelta,
    longHorizonDelta: promotion.longHorizonDelta,
  }).pass
}

const finiteCandidateScore = (
  candidates: readonly DecisionCandidate[],
  candidateId: NonGraphCandidateId,
): number | null => {
  const score = candidates.find((candidate) => candidate.candidateId === candidateId)?.weightedScore
  return score !== null && score !== undefined && Number.isFinite(score) ? score : null
}

const promotionScoreErrors = (
  candidates: readonly DecisionCandidate[],
  promotions: readonly PromotionEvidence[],
): readonly string[] =>
  promotions.flatMap((promotion) => {
    const challengerScore = finiteCandidateScore(candidates, promotion.challenger)
    const comparatorScore = finiteCandidateScore(candidates, promotion.comparator)
    if (challengerScore === null || comparatorScore === null) {
      return [`promotion ${promotion.challenger} vs ${promotion.comparator} requires finite candidate scores`]
    }
    return promotion.weightedScoreDelta === challengerScore - comparatorScore
      ? []
      : [
          `promotion ${promotion.challenger} vs ${promotion.comparator} weighted-score delta does not match candidate scores`,
        ]
  })

const chooseNonGraph = (
  candidates: readonly DecisionCandidate[],
  promotions: readonly PromotionEvidence[],
): NonGraphCandidateId | null => {
  const ordered = [...eligibleNonGraph(candidates)].sort(
    (left, right) => complexity[left.candidateId] - complexity[right.candidateId],
  )
  return ordered.reduce<NonGraphCandidateId | null>((incumbent, challenger) => {
    if (incumbent === null) return challenger.candidateId
    const promotion = promotions.find(
      (entry) => entry.challenger === challenger.candidateId && entry.comparator === incumbent,
    )
    const incumbentScore = finiteCandidateScore(candidates, incumbent)
    const delta = incumbentScore === null ? Number.NaN : challenger.weightedScore - incumbentScore
    return promotion !== undefined && promotionPasses(promotion, delta) ? challenger.candidateId : incumbent
  }, null)
}

const outcomeFor = (candidateId: NonGraphCandidateId): RepresentationOutcome => {
  if (candidateId === 'as-shipped') return 'retain-shipped-behavior'
  if (candidateId === 'corrected-hybrid') return 'repair-hybrid'
  return 'adopt-hierarchy'
}

export const decideRepresentation = (
  input: RepresentationDecisionInput,
): ValidationResult<Readonly<{ outcome: RepresentationOutcome; candidateId: CandidateId | null }>> => {
  const ids = input.candidates.map(({ candidateId }) => candidateId)
  if (new Set(ids).size !== ids.length) return invalid('decision candidates must be unique')
  const invalidEligible = input.candidates.filter(
    ({ eligible, weightedScore }) => eligible && (weightedScore === null || !Number.isFinite(weightedScore)),
  )
  if (invalidEligible.length > 0) return invalid('eligible candidates require finite weighted scores')
  const promotionErrors = promotionScoreErrors(input.candidates, input.promotions)
  if (promotionErrors.length > 0) return invalid(...promotionErrors)
  const selectedNonGraph = chooseNonGraph(input.candidates, input.promotions)
  if (selectedNonGraph === null) return valid({ outcome: 'block-adoption', candidateId: null })
  const graphEligible = input.candidates.some(
    ({ candidateId, eligible }) => candidateId === 'temporal-graph' && eligible,
  )
  if (graphEligible && input.graphGate !== null && input.graphGate.pass) {
    const strongest = selectStrongestEligibleNonGraph(input.candidates)
    if (!strongest.valid) return strongest
    if (strongest.value !== input.graphGate.comparatorId) {
      return invalid('graph gate comparator is not the strongest eligible non-graph candidate')
    }
    return valid({ outcome: 'add-derived-temporal-graph', candidateId: 'temporal-graph' })
  }
  return valid({ outcome: outcomeFor(selectedNonGraph), candidateId: selectedNonGraph })
}
