// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { observationSet } from './decision-analysis-observations.js'
import type {
  CandidateDecisionAnalysis,
  DecisionAnalysis,
  PairedDecisionComparison,
} from './decision-analysis-schema.js'
import type { CandidateResearchResult, ResearchReport } from './report.js'
import {
  BOOTSTRAP_RESAMPLES,
  BOOTSTRAP_SEED,
  decideRepresentation,
  evaluateGraphGate,
  pairedBootstrapDelta,
  selectStrongestEligibleNonGraph,
  type CandidateObservationSet,
  type DecisionCandidate,
  type GraphGateEvaluation,
  type NonGraphCandidateId,
  type PromotionEvidence,
  type StatisticSpec,
} from './statistics.js'
import type { CandidateId } from './types.js'

type ScoredCandidate = CandidateDecisionAnalysis &
  Readonly<{
    weightedScore: Extract<CandidateDecisionAnalysis['weightedScore'], { status: 'scored' }>
  }>

const requireCandidate = (report: ResearchReport, candidateId: CandidateId): CandidateResearchResult => {
  const candidate = report.candidates.find(({ registration }) => registration.id === candidateId)
  if (candidate === undefined) throw new Error(`Missing comparison candidate: ${candidateId}`)
  return candidate
}

const paired = (
  candidate: CandidateObservationSet,
  comparator: CandidateObservationSet,
  spec: StatisticSpec,
): PairedDecisionComparison['interval'] => {
  const result = pairedBootstrapDelta(candidate, comparator, spec)
  if (!result.valid) throw new Error(`Invalid paired comparison: ${result.errors.join('; ')}`)
  return { ...result.value, seed: BOOTSTRAP_SEED, resamples: BOOTSTRAP_RESAMPLES }
}

const comparison = (
  report: ResearchReport,
  candidateId: CandidateId,
  comparatorId: CandidateId,
  statistic: PairedDecisionComparison['statistic'],
  spec: StatisticSpec,
): PairedDecisionComparison => ({
  candidateId,
  comparatorId,
  statistic,
  interval: paired(
    observationSet(report, requireCandidate(report, candidateId)),
    observationSet(report, requireCandidate(report, comparatorId)),
    spec,
  ),
})

export const registeredComparisons = (report: ResearchReport): readonly PairedDecisionComparison[] => [
  comparison(report, 'corrected-hybrid', 'as-shipped', 'overall-ndcg', {
    kind: 'overall',
    metric: 'ndcgAtK',
  }),
  comparison(report, 'hierarchical', 'as-shipped', 'overall-ndcg', {
    kind: 'overall',
    metric: 'ndcgAtK',
  }),
  comparison(report, 'hierarchical', 'corrected-hybrid', 'overall-ndcg', {
    kind: 'overall',
    metric: 'ndcgAtK',
  }),
  comparison(report, 'hierarchical', 'corrected-hybrid', 'long-horizon-ndcg', {
    kind: 'composite',
    metric: 'ndcgAtK',
    slices: ['long-range', 'knowledge-update', 'abstention'],
  }),
]

const isScored = (candidate: CandidateDecisionAnalysis): candidate is ScoredCandidate =>
  candidate.weightedScore.status === 'scored'

const findComparison = (
  comparisons: readonly PairedDecisionComparison[],
  candidateId: CandidateId,
  comparatorId: CandidateId,
  statistic: PairedDecisionComparison['statistic'],
): PairedDecisionComparison['interval'] => {
  const found = comparisons.find(
    (entry) =>
      entry.candidateId === candidateId && entry.comparatorId === comparatorId && entry.statistic === statistic,
  )
  if (found === undefined) throw new Error(`Missing registered comparison: ${candidateId}/${comparatorId}/${statistic}`)
  return found.interval
}

const promotion = (
  candidates: readonly CandidateDecisionAnalysis[],
  comparisons: readonly PairedDecisionComparison[],
  challenger: 'corrected-hybrid' | 'hierarchical',
  comparator: NonGraphCandidateId,
): PromotionEvidence | null => {
  const challengerResult = candidates.find(({ candidateId }) => candidateId === challenger)
  const comparatorResult = candidates.find(({ candidateId }) => candidateId === comparator)
  if (challengerResult === undefined || comparatorResult === undefined) return null
  if (!isScored(challengerResult) || !isScored(comparatorResult)) return null
  const overallNdcgDelta = findComparison(comparisons, challenger, comparator, 'overall-ndcg')
  const longHorizonDelta =
    challenger === 'hierarchical' && comparator === 'corrected-hybrid'
      ? findComparison(comparisons, challenger, comparator, 'long-horizon-ndcg')
      : undefined
  return {
    challenger,
    comparator,
    weightedScoreDelta: challengerResult.weightedScore.total - comparatorResult.weightedScore.total,
    overallNdcgDelta,
    ...(longHorizonDelta === undefined ? {} : { longHorizonDelta }),
  }
}

export const promotionEvidence = (
  candidates: readonly CandidateDecisionAnalysis[],
  comparisons: readonly PairedDecisionComparison[],
): readonly PromotionEvidence[] =>
  [
    promotion(candidates, comparisons, 'corrected-hybrid', 'as-shipped'),
    promotion(candidates, comparisons, 'hierarchical', 'as-shipped'),
    promotion(candidates, comparisons, 'hierarchical', 'corrected-hybrid'),
  ].flatMap((entry) => (entry === null ? [] : [entry]))

export const decisionCandidates = (candidates: readonly CandidateDecisionAnalysis[]): readonly DecisionCandidate[] =>
  candidates.map(({ candidateId, weightedScore }) => ({
    candidateId,
    eligible: weightedScore.status === 'scored',
    weightedScore: weightedScore.status === 'scored' ? weightedScore.total : null,
  }))

export type GraphAnalysis = Readonly<{
  strongestEligibleNonGraph: NonGraphCandidateId | null
  graphGate: GraphGateEvaluation | null
  graphComparison: PairedDecisionComparison | null
}>

export const analyzeGraph = (
  report: ResearchReport,
  candidates: readonly CandidateDecisionAnalysis[],
): GraphAnalysis => {
  const decisionRows = decisionCandidates(candidates)
  const strongest = selectStrongestEligibleNonGraph(decisionRows)
  if (!strongest.valid) {
    return { strongestEligibleNonGraph: null, graphGate: null, graphComparison: null }
  }
  const graph = candidates.find(({ candidateId }) => candidateId === 'temporal-graph')
  const comparator = candidates.find(({ candidateId }) => candidateId === strongest.value)
  if (graph === undefined || comparator === undefined || !isScored(graph) || !isScored(comparator)) {
    return { strongestEligibleNonGraph: strongest.value, graphGate: null, graphComparison: null }
  }
  const graphComparison = comparison(report, 'temporal-graph', strongest.value, 'relational-temporal-ndcg', {
    kind: 'composite',
    metric: 'ndcgAtK',
    slices: ['graph-multi-hop', 'temporal-conflict'],
  })
  const evaluation = evaluateGraphGate({
    comparatorId: strongest.value,
    graphEligible: true,
    comparatorEligible: true,
    graphWeightedScore: graph.weightedScore.total,
    comparatorWeightedScore: comparator.weightedScore.total,
    relationalTemporalDelta: graphComparison.interval,
    graphResources: graph.graphCost,
    comparatorResources: comparator.graphCost,
    projectionRebuildable: graph.rebuild.probeCount > 0 && graph.rebuild.agreementCount === graph.rebuild.probeCount,
  })
  if (!evaluation.valid) throw new Error(`Invalid graph gate: ${evaluation.errors.join('; ')}`)
  return {
    strongestEligibleNonGraph: strongest.value,
    graphGate: evaluation.value,
    graphComparison,
  }
}

export const finiteDecision = (
  candidates: readonly CandidateDecisionAnalysis[],
  promotions: readonly PromotionEvidence[],
  graphGate: GraphGateEvaluation | null,
): DecisionAnalysis['representationDecision'] => {
  const result = decideRepresentation({
    candidates: decisionCandidates(candidates),
    promotions,
    graphGate,
  })
  if (!result.valid) throw new Error(`Invalid representation decision: ${result.errors.join('; ')}`)
  return result.value
}
