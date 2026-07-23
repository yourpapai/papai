// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { registeredCandidateIds } from './candidate-registry.js'
import { decisionCandidateErrors, decisionInputClosureErrors } from './decision-analysis-input.js'
import { DecisionAnalysisSchema } from './decision-analysis-schema.js'
import type {
  CandidateDecisionAnalysis,
  DecisionAnalysis,
  PairedDecisionComparison,
} from './decision-analysis-schema.js'
import { decideRepresentation, evaluateGraphGate, selectStrongestEligibleNonGraph } from './statistics.js'
import type { DecisionCandidate, GraphGateEvaluation, NonGraphCandidateId, PromotionEvidence } from './statistics.js'

const canonicalizeKeys = (value: unknown): unknown => {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(canonicalizeKeys)
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalizeKeys(child)]),
  )
}

const sameJson = (left: unknown, right: unknown): boolean =>
  JSON.stringify(canonicalizeKeys(left)) === JSON.stringify(canonicalizeKeys(right))

const candidateByOutcome = {
  'retain-shipped-behavior': 'as-shipped',
  'repair-hybrid': 'corrected-hybrid',
  'adopt-hierarchy': 'hierarchical',
  'add-derived-temporal-graph': 'temporal-graph',
  'block-adoption': null,
} as const satisfies Readonly<
  Record<
    DecisionAnalysis['representationDecision']['outcome'],
    DecisionAnalysis['representationDecision']['candidateId']
  >
>

const expectedCandidateForOutcome = (
  outcome: DecisionAnalysis['representationDecision']['outcome'],
): DecisionAnalysis['representationDecision']['candidateId'] => candidateByOutcome[outcome]

const uniqueKeys = (values: readonly string[], label: string): readonly string[] =>
  new Set(values).size === values.length ? [] : [`${label} must be unique`]

const decisionCandidates = (analysis: DecisionAnalysis): readonly DecisionCandidate[] =>
  analysis.candidates.map(({ candidateId, weightedScore }) => ({
    candidateId,
    eligible: weightedScore.status === 'scored',
    weightedScore: weightedScore.status === 'scored' ? weightedScore.total : null,
  }))

const comparisonKey = (
  comparison: Pick<PairedDecisionComparison, 'candidateId' | 'comparatorId' | 'statistic'>,
): string => `${comparison.candidateId}/${comparison.comparatorId}/${comparison.statistic}`

const baseComparisonKeys = [
  'corrected-hybrid/as-shipped/overall-ndcg',
  'hierarchical/as-shipped/overall-ndcg',
  'hierarchical/corrected-hybrid/overall-ndcg',
  'hierarchical/corrected-hybrid/long-horizon-ndcg',
] as const

const scoredCandidate = (
  analysis: DecisionAnalysis,
  candidateId: DecisionAnalysis['candidates'][number]['candidateId'],
): CandidateDecisionAnalysis | null => {
  const candidate = analysis.candidates.find((entry) => entry.candidateId === candidateId)
  return candidate?.weightedScore.status === 'scored' ? candidate : null
}

const strongestNonGraph = (analysis: DecisionAnalysis): NonGraphCandidateId | null => {
  const result = selectStrongestEligibleNonGraph(decisionCandidates(analysis))
  return result.valid ? result.value : null
}

const expectedComparisonKeys = (
  analysis: DecisionAnalysis,
  strongest: NonGraphCandidateId | null,
): readonly string[] => {
  const graphComparable =
    strongest !== null &&
    scoredCandidate(analysis, 'temporal-graph') !== null &&
    scoredCandidate(analysis, strongest) !== null
  return graphComparable
    ? [...baseComparisonKeys, `temporal-graph/${strongest}/relational-temporal-ndcg`]
    : baseComparisonKeys
}

const pointValue = (analysis: DecisionAnalysis, comparison: PairedDecisionComparison): number | null => {
  const candidate = analysis.candidates.find(({ candidateId }) => candidateId === comparison.candidateId)
  const comparator = analysis.candidates.find(({ candidateId }) => candidateId === comparison.comparatorId)
  if (candidate === undefined || comparator === undefined) return null
  if (comparison.statistic === 'overall-ndcg') return candidate.primary.ndcgAtK - comparator.primary.ndcgAtK
  if (comparison.statistic === 'long-horizon-ndcg') {
    return candidate.primary.longHorizonComposite - comparator.primary.longHorizonComposite
  }
  return candidate.primary.relationalTemporalComposite - comparator.primary.relationalTemporalComposite
}

const comparisonSemanticErrors = (
  analysis: DecisionAnalysis,
  strongest: NonGraphCandidateId | null,
): readonly string[] => {
  const actualKeys = analysis.pairedComparisons.map(comparisonKey)
  const expectedKeys = expectedComparisonKeys(analysis, strongest)
  return [
    ...(sameJson(actualKeys, expectedKeys) ? [] : ['paired comparison set mismatch']),
    ...analysis.pairedComparisons.flatMap((comparison) =>
      comparison.interval.pointDelta === pointValue(analysis, comparison)
        ? []
        : [`${comparisonKey(comparison)}: paired comparison point delta mismatch`],
    ),
  ]
}

const comparisonInterval = (
  analysis: DecisionAnalysis,
  candidateId: PairedDecisionComparison['candidateId'],
  comparatorId: PairedDecisionComparison['comparatorId'],
  statistic: PairedDecisionComparison['statistic'],
): PairedDecisionComparison['interval'] | null =>
  analysis.pairedComparisons.find(
    (comparison) =>
      comparison.candidateId === candidateId &&
      comparison.comparatorId === comparatorId &&
      comparison.statistic === statistic,
  )?.interval ?? null

const expectedPromotion = (
  analysis: DecisionAnalysis,
  challengerId: 'corrected-hybrid' | 'hierarchical',
  comparatorId: NonGraphCandidateId,
): PromotionEvidence | null => {
  const challenger = scoredCandidate(analysis, challengerId)
  const comparator = scoredCandidate(analysis, comparatorId)
  const overallNdcgDelta = comparisonInterval(analysis, challengerId, comparatorId, 'overall-ndcg')
  if (challenger === null || comparator === null || overallNdcgDelta === null) return null
  const longHorizonDelta =
    challengerId === 'hierarchical' && comparatorId === 'corrected-hybrid'
      ? comparisonInterval(analysis, challengerId, comparatorId, 'long-horizon-ndcg')
      : undefined
  if (longHorizonDelta === null) return null
  return {
    challenger: challengerId,
    comparator: comparatorId,
    weightedScoreDelta:
      challenger.weightedScore.status === 'scored' && comparator.weightedScore.status === 'scored'
        ? challenger.weightedScore.total - comparator.weightedScore.total
        : Number.NaN,
    overallNdcgDelta,
    ...(longHorizonDelta === undefined ? {} : { longHorizonDelta }),
  }
}

const expectedPromotions = (analysis: DecisionAnalysis): readonly PromotionEvidence[] =>
  [
    expectedPromotion(analysis, 'corrected-hybrid', 'as-shipped'),
    expectedPromotion(analysis, 'hierarchical', 'as-shipped'),
    expectedPromotion(analysis, 'hierarchical', 'corrected-hybrid'),
  ].flatMap((promotion) => (promotion === null ? [] : [promotion]))

const promotionErrors = (analysis: DecisionAnalysis, expected: readonly PromotionEvidence[]): readonly string[] =>
  sameJson(analysis.promotions, expected)
    ? []
    : [
        ...(analysis.promotions.length === expected.length ? [] : ['promotion closure mismatch']),
        ...(analysis.promotions.length === expected.length ? ['promotion evidence mismatch'] : []),
      ]

const serializableRatio = (value: number): number | 'infinity' => (Number.isFinite(value) ? value : 'infinity')

const serializableGraphGate = (gate: GraphGateEvaluation | null): DecisionAnalysis['graphGate'] =>
  gate === null
    ? null
    : {
        ...gate,
        ratios: {
          retrievalP95: serializableRatio(gate.ratios.retrievalP95),
          ingestCostPerAttempt: serializableRatio(gate.ratios.ingestCostPerAttempt),
          callCostPerAttempt: serializableRatio(gate.ratios.callCostPerAttempt),
          storedBytes: serializableRatio(gate.ratios.storedBytes),
        },
      }

type GraphExpectation = Readonly<{
  gate: GraphGateEvaluation | null
  errors: readonly string[]
}>

const graphExpectation = (analysis: DecisionAnalysis, strongest: NonGraphCandidateId | null): GraphExpectation => {
  if (strongest === null) return { gate: null, errors: [] }
  const graph = scoredCandidate(analysis, 'temporal-graph')
  const comparator = scoredCandidate(analysis, strongest)
  const delta = comparisonInterval(analysis, 'temporal-graph', strongest, 'relational-temporal-ndcg')
  if (graph === null || comparator === null) return { gate: null, errors: [] }
  if (delta === null) return { gate: null, errors: ['graph gate requires its registered paired comparison'] }
  const result = evaluateGraphGate({
    comparatorId: strongest,
    graphEligible: true,
    comparatorEligible: true,
    graphWeightedScore: graph.weightedScore.status === 'scored' ? graph.weightedScore.total : Number.NaN,
    comparatorWeightedScore: comparator.weightedScore.status === 'scored' ? comparator.weightedScore.total : Number.NaN,
    relationalTemporalDelta: delta,
    graphResources: graph.graphCost,
    comparatorResources: comparator.graphCost,
    projectionRebuildable: graph.rebuild.probeCount > 0 && graph.rebuild.agreementCount === graph.rebuild.probeCount,
  })
  return result.valid ? { gate: result.value, errors: [] } : { gate: null, errors: result.errors }
}

const graphErrors = (
  analysis: DecisionAnalysis,
  strongest: NonGraphCandidateId | null,
  expectation: GraphExpectation,
): readonly string[] => [
  ...(analysis.strongestEligibleNonGraph === strongest ? [] : ['strongest eligible non-graph mismatch']),
  ...expectation.errors,
  ...(sameJson(analysis.graphGate, serializableGraphGate(expectation.gate)) ? [] : ['graph gate mismatch']),
]

const finalDecisionErrors = (
  analysis: DecisionAnalysis,
  promotions: readonly PromotionEvidence[],
  graphGate: GraphGateEvaluation | null,
): readonly string[] => {
  const result = decideRepresentation({
    candidates: decisionCandidates(analysis),
    promotions,
    graphGate,
  })
  if (!result.valid) return result.errors.map((error) => `representation decision invalid: ${error}`)
  const selectedCandidate =
    result.value.candidateId === null
      ? null
      : analysis.candidates.find(({ candidateId }) => candidateId === result.value.candidateId)
  const selectedStorage =
    selectedCandidate === null || selectedCandidate === undefined
      ? null
      : { candidateId: selectedCandidate.candidateId, result: selectedCandidate.storageDecision }
  return [
    ...(sameJson(analysis.representationDecision, result.value) ? [] : ['representation decision mismatch']),
    ...(sameJson(analysis.selectedStorageDecision, selectedStorage) ? [] : ['selected storage decision mismatch']),
  ]
}

export const validateDecisionAnalysis = (input: unknown): DecisionAnalysis => {
  const analysis = DecisionAnalysisSchema.parse(input)
  const comparisonKeys = analysis.pairedComparisons.map(
    ({ candidateId, comparatorId, statistic }) => `${candidateId}/${comparatorId}/${statistic}`,
  )
  const promotionKeys = analysis.promotions.map(({ challenger, comparator }) => `${challenger}/${comparator}`)
  const artifactPaths = Object.values(analysis.artifacts).map(({ path }) => path)
  const strongest = strongestNonGraph(analysis)
  const comparisons = comparisonSemanticErrors(analysis, strongest)
  const promotions = expectedPromotions(analysis)
  const graph = graphExpectation(analysis, strongest)
  const errors = [
    ...(sameJson(
      analysis.candidates.map(({ candidateId }) => candidateId),
      registeredCandidateIds,
    )
      ? []
      : ['decision candidates must use canonical registered order']),
    ...uniqueKeys(comparisonKeys, 'paired comparisons'),
    ...uniqueKeys(promotionKeys, 'promotion comparisons'),
    ...uniqueKeys(artifactPaths, 'input artifact paths'),
    ...decisionInputClosureErrors(analysis),
    ...decisionCandidateErrors(analysis),
    ...comparisons,
    ...promotionErrors(analysis, promotions),
    ...graphErrors(analysis, strongest, graph),
    ...finalDecisionErrors(analysis, promotions, graph.gate),
    ...(analysis.representationDecision.candidateId ===
    expectedCandidateForOutcome(analysis.representationDecision.outcome)
      ? []
      : ['representation outcome and candidate are inconsistent']),
  ]
  if (errors.length > 0) throw new Error(`Invalid decision analysis: ${errors.join('; ')}`)
  return analysis
}

export const stableDecisionAnalysisJson = (input: unknown): string =>
  `${JSON.stringify(canonicalizeKeys(validateDecisionAnalysis(input)), null, 2)}\n`
