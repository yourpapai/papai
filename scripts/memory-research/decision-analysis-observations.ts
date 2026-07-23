// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { CandidateDecisionAnalysis } from './decision-analysis-schema.js'
import type { CandidateResearchResult, ResearchReport } from './report.js'
import {
  aggregateStatistic,
  computeWeightedScore,
  type CandidateObservationSet,
  type EfficiencyBaseline,
  type ScoreQuality,
  type ScoreResources,
  type StatisticSpec,
} from './statistics.js'
import type { CandidateId } from './types.js'

const statisticValue = (candidate: CandidateObservationSet, spec: StatisticSpec): number => {
  const result = aggregateStatistic(candidate.rows, spec)
  if (!result.valid) throw new Error(`Unable to aggregate ${candidate.candidateId}: ${result.errors.join('; ')}`)
  return result.value
}

export const observationSet = (
  report: ResearchReport,
  candidate: CandidateResearchResult,
): CandidateObservationSet => ({
  candidateId: candidate.registration.id,
  identity: {
    scenarioManifestVersion: candidate.manifest.scenarioManifestVersion,
    scenarioManifestSha256: candidate.manifest.scenarioManifestSha256,
    selectionSha256: report.selection.selectionSha256,
    split: candidate.manifest.split,
    scale: candidate.manifest.scale,
    seed: candidate.manifest.seed,
  },
  rows: candidate.scenarios.flatMap(({ scenarioId, queries }) =>
    queries.map(({ query, metrics, rawResult }) => ({
      scenarioId,
      queryId: query.queryId,
      status: rawResult.status,
      slices: query.slices,
      precisionAtK: metrics.precisionAtK,
      recallAtK: metrics.recallAtK,
      reciprocalRank: metrics.reciprocalRank,
      ndcgAtK: metrics.ndcgAtK,
    })),
  ),
})

export const qualitySnapshot = (candidate: CandidateObservationSet): CandidateDecisionAnalysis['primary'] => ({
  precisionAtK: statisticValue(candidate, { kind: 'overall', metric: 'precisionAtK' }),
  recallAtK: statisticValue(candidate, { kind: 'overall', metric: 'recallAtK' }),
  reciprocalRank: statisticValue(candidate, { kind: 'overall', metric: 'reciprocalRank' }),
  ndcgAtK: statisticValue(candidate, { kind: 'overall', metric: 'ndcgAtK' }),
  relationalTemporalComposite: statisticValue(candidate, {
    kind: 'composite',
    metric: 'ndcgAtK',
    slices: ['graph-multi-hop', 'temporal-conflict'],
  }),
  longHorizonComposite: statisticValue(candidate, {
    kind: 'composite',
    metric: 'ndcgAtK',
    slices: ['long-range', 'knowledge-update', 'abstention'],
  }),
  missingEmbeddingRecallAtK: statisticValue(candidate, {
    kind: 'slice',
    metric: 'recallAtK',
    slice: 'missing-embedding',
  }),
  duplicateOutOfOrderRecallAtK: statisticValue(candidate, {
    kind: 'slice',
    metric: 'recallAtK',
    slice: 'duplicate-out-of-order',
  }),
})

export const gateStates = (candidate: CandidateResearchResult): CandidateDecisionAnalysis['gates'] => ({
  scopeSafety: candidate.gates.scopeIsolation.state,
  erasureSafety: candidate.gates.erasure.state,
  selfHosting: candidate.gates.selfHosting.state,
  reproducibility: candidate.gates.reproducibility.state,
})

export const scoreResources = (candidate: CandidateResearchResult): ScoreResources => ({
  retrievalP95Ms: candidate.aggregate.latency.p95Ms,
  ingestThroughputPerSecond: candidate.resources.ingestThroughputPerSecond,
  storedBytes: candidate.resources.storedBytes,
  incrementalRssBytes: candidate.resources.incrementalRssBytes,
})

const graphCostResources = (candidate: CandidateResearchResult): CandidateDecisionAnalysis['graphCost'] => ({
  retrievalP95Ms: candidate.aggregate.latency.p95Ms,
  ingestDurationMs: candidate.resources.ingestDurationMs,
  attemptedRecordCount: candidate.resources.ingestedEventCount,
  modelCallCount: candidate.resources.modelCallCount,
  extractorCallCount: candidate.resources.extractorCallCount,
  storedBytes: candidate.resources.storedBytes,
})

const scoreQuality = (quality: CandidateDecisionAnalysis['primary']): ScoreQuality => ({
  recallAtK: quality.recallAtK,
  ndcgAtK: quality.ndcgAtK,
  reciprocalRank: quality.reciprocalRank,
  precisionAtK: quality.precisionAtK,
  relationalTemporalComposite: quality.relationalTemporalComposite,
  missingEmbeddingRecallAtK: quality.missingEmbeddingRecallAtK,
  duplicateOutOfOrderRecallAtK: quality.duplicateOutOfOrderRecallAtK,
})

const rebuildProbes = (
  candidate: CandidateResearchResult,
): Parameters<typeof computeWeightedScore>[0]['rebuildProbes'] =>
  candidate.rebuildAgreement.probes.map(({ status, beforeHitIds, afterHitIds }) => ({
    status,
    orderedHitIdsEqual: JSON.stringify(beforeHitIds) === JSON.stringify(afterHitIds),
  }))

export const analyzeCandidate = (
  primaryReport: ResearchReport,
  sensitivityReport: ResearchReport,
  candidateId: CandidateId,
  baseline: EfficiencyBaseline,
  storageDecision: CandidateDecisionAnalysis['storageDecision'],
): CandidateDecisionAnalysis => {
  const primaryCandidate = primaryReport.candidates.find(({ registration }) => registration.id === candidateId)
  const sensitivityCandidate = sensitivityReport.candidates.find(({ registration }) => registration.id === candidateId)
  if (primaryCandidate === undefined || sensitivityCandidate === undefined) {
    throw new Error(`Decision candidate is missing: ${candidateId}`)
  }
  const primary = qualitySnapshot(observationSet(primaryReport, primaryCandidate))
  const sensitivity = qualitySnapshot(observationSet(sensitivityReport, sensitivityCandidate))
  const resources = scoreResources(primaryCandidate)
  const gates = gateStates(primaryCandidate)
  const weightedScore = computeWeightedScore(
    {
      candidateId,
      split: primaryCandidate.manifest.split,
      scale: primaryCandidate.manifest.scale,
      gates,
      quality: scoreQuality(primary),
      resources,
      rebuildProbes: rebuildProbes(primaryCandidate),
    },
    baseline,
  )
  const probeCount = primaryCandidate.rebuildAgreement.probeCount
  return {
    candidateId,
    primary,
    sensitivity,
    gates,
    resources,
    graphCost: graphCostResources(primaryCandidate),
    rebuild: {
      probeCount,
      agreementCount: primaryCandidate.rebuildAgreement.agreementCount,
      agreementRate: probeCount === 0 ? 0 : primaryCandidate.rebuildAgreement.agreementCount / probeCount,
    },
    weightedScore,
    storageDecision,
  }
}
