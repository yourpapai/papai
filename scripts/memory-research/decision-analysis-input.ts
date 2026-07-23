// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { registeredCandidateIds } from './candidate-registry.js'
import { memoryScenarios } from './corpus.js'
import type { CandidateDecisionAnalysis, DecisionAnalysis, DecisionArtifact } from './decision-analysis-schema.js'
import { frozenSplitScenarioIds } from './frozen-run-contract.js'
import { FROZEN_SCENARIO_MANIFEST } from './manifest.js'
import type { ResearchReport } from './report.js'
import { validateResearchReport } from './report.js'
import {
  FROZEN_100K_SCENARIO_IDS,
  STORAGE_LATENCY_THRESHOLD_MS,
  STORAGE_RSS_THRESHOLD_BYTES,
} from './statistics-storage.js'
import { computeWeightedScore } from './statistics.js'
import type { EfficiencyBaseline } from './statistics.js'
import type { FrozenStorageReport } from './storage-report.js'
import { validateFrozenStorageReport } from './storage-report.js'

export type DecisionAnalysisInput = Readonly<{
  primaryReport: ResearchReport
  sensitivityReport: ResearchReport
  storageReport: FrozenStorageReport
  artifacts: Readonly<{
    primary: DecisionArtifact
    sensitivity: DecisionArtifact
    storage: DecisionArtifact
  }>
}>

export type ValidatedDecisionInputs = Readonly<{
  primary: ResearchReport
  sensitivity: ResearchReport
  storage: FrozenStorageReport
  artifacts: DecisionAnalysisInput['artifacts']
}>

const sameJson = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right)

const reportIdentityErrors = (
  primary: ResearchReport,
  sensitivity: ResearchReport,
  storage: FrozenStorageReport,
): readonly string[] => {
  const primaryManifest = primary.candidates[0]?.manifest
  const sensitivityManifest = sensitivity.candidates[0]?.manifest
  return [
    ...(primary.selection.split === 'sealed-test' && sensitivity.selection.split === 'sealed-test'
      ? []
      : ['decision inputs must use the sealed-test split']),
    ...(primaryManifest?.scale === 10_000 ? [] : ['primary report must use scale 10000']),
    ...(sensitivityManifest?.scale === 1_000 ? [] : ['sensitivity report must use scale 1000']),
    ...(primaryManifest?.seed === 20_260_723 && sensitivityManifest?.seed === 20_260_723 && storage.seed === 20_260_723
      ? []
      : ['decision input seed mismatch']),
    ...(primary.selection.selectionSha256 === sensitivity.selection.selectionSha256
      ? []
      : ['component selection SHA-256 mismatch']),
    ...(sameJson(primary.selection.scenarioIds, sensitivity.selection.scenarioIds)
      ? []
      : ['component scenario selections differ']),
    ...(primaryManifest?.scenarioManifestVersion === sensitivityManifest?.scenarioManifestVersion &&
    primaryManifest?.scenarioManifestVersion === storage.scenarioManifestVersion
      ? []
      : ['scenario manifest version mismatch']),
    ...(primaryManifest?.scenarioManifestSha256 === sensitivityManifest?.scenarioManifestSha256 &&
    primaryManifest?.scenarioManifestSha256 === storage.scenarioManifestSha256
      ? []
      : ['scenario manifest SHA-256 mismatch']),
    ...(primary.implementationSha256 === sensitivity.implementationSha256 &&
    primary.implementationSha256 === storage.implementationSha256
      ? []
      : ['implementation SHA-256 mismatch across decision inputs']),
    ...(primary.sourceInventory.scope === 'complete' &&
    sensitivity.sourceInventory.scope === 'complete' &&
    storage.sourceInventory.scope === 'complete'
      ? []
      : ['decision inputs require complete research source inventories']),
  ]
}

const closureErrors = (primary: ResearchReport, sensitivity: ResearchReport): readonly string[] => {
  const expected = frozenSplitScenarioIds('sealed-test')
  const candidateIds = (report: ResearchReport): readonly string[] =>
    report.candidates.map(({ registration }) => registration.id)
  return [
    ...(primary.selection.scenarioIds.length === 180 &&
    sameJson(primary.selection.scenarioIds, expected) &&
    sameJson(sensitivity.selection.scenarioIds, expected)
      ? []
      : ['decision inputs require the complete frozen 180-scenario selection']),
    ...(sameJson(candidateIds(primary), registeredCandidateIds) &&
    sameJson(candidateIds(sensitivity), registeredCandidateIds)
      ? []
      : ['decision inputs require every registered candidate in canonical order']),
  ]
}

export const validateDecisionInputs = (input: DecisionAnalysisInput): ValidatedDecisionInputs => {
  const primary = validateResearchReport(input.primaryReport)
  const sensitivity = validateResearchReport(input.sensitivityReport)
  const storage = validateFrozenStorageReport(input.storageReport)
  const errors = [...reportIdentityErrors(primary, sensitivity, storage), ...closureErrors(primary, sensitivity)]
  if (errors.length > 0) throw new Error(`Invalid decision-analysis inputs: ${errors.join('; ')}`)
  return { primary, sensitivity, storage, artifacts: input.artifacts }
}

const canonicalizeKeys = (value: unknown): unknown => {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(canonicalizeKeys)
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalizeKeys(child)]),
  )
}

const sameCanonicalValue = (left: unknown, right: unknown): boolean =>
  JSON.stringify(canonicalizeKeys(left)) === JSON.stringify(canonicalizeKeys(right))

const frozenRebuildProbeCount = memoryScenarios
  .filter(({ split }) => split === 'sealed-test')
  .reduce((count, scenario) => count + scenario.faults.rebuildBeforeQueryIds.length, 0)

const scoreQuality = (candidate: CandidateDecisionAnalysis): Parameters<typeof computeWeightedScore>[0]['quality'] => ({
  recallAtK: candidate.primary.recallAtK,
  ndcgAtK: candidate.primary.ndcgAtK,
  reciprocalRank: candidate.primary.reciprocalRank,
  precisionAtK: candidate.primary.precisionAtK,
  relationalTemporalComposite: candidate.primary.relationalTemporalComposite,
  missingEmbeddingRecallAtK: candidate.primary.missingEmbeddingRecallAtK,
  duplicateOutOfOrderRecallAtK: candidate.primary.duplicateOutOfOrderRecallAtK,
})

const baselineFor = (analysis: DecisionAnalysis): EfficiencyBaseline | null => {
  const shipped = analysis.candidates.find(({ candidateId }) => candidateId === 'as-shipped')
  return shipped === undefined
    ? null
    : {
        candidateId: 'as-shipped',
        split: 'sealed-test',
        scale: 10_000,
        resources: shipped.resources,
      }
}

const rebuildErrors = (candidate: CandidateDecisionAnalysis): readonly string[] => {
  const { agreementCount, agreementRate, probeCount } = candidate.rebuild
  const expectedRate = probeCount === 0 ? 0 : agreementCount / probeCount
  return [
    ...(probeCount === frozenRebuildProbeCount ? [] : [`${candidate.candidateId}: rebuild probe count mismatch`]),
    ...(agreementCount <= probeCount ? [] : [`${candidate.candidateId}: rebuild agreement count exceeds probes`]),
    ...(agreementRate === expectedRate ? [] : [`${candidate.candidateId}: rebuild summary mismatch`]),
  ]
}

const expectedWeightedScore = (
  candidate: CandidateDecisionAnalysis,
  baseline: EfficiencyBaseline,
): ReturnType<typeof computeWeightedScore> =>
  computeWeightedScore(
    {
      candidateId: candidate.candidateId,
      split: 'sealed-test',
      scale: 10_000,
      gates: candidate.gates,
      quality: scoreQuality(candidate),
      resources: candidate.resources,
      rebuildProbes: Array.from({ length: candidate.rebuild.probeCount }, (_, index) => ({
        status: 'success',
        orderedHitIdsEqual: index < candidate.rebuild.agreementCount,
      })),
    },
    baseline,
  )

const candidateScoreErrors = (
  candidate: CandidateDecisionAnalysis,
  baseline: EfficiencyBaseline | null,
): readonly string[] => {
  if (baseline === null) return ['weighted score requires the as-shipped baseline']
  return sameCanonicalValue(candidate.weightedScore, expectedWeightedScore(candidate, baseline))
    ? []
    : [`${candidate.candidateId}: weighted score does not match the registered formula`]
}

const graphCostErrors = (candidate: CandidateDecisionAnalysis): readonly string[] => {
  const expectedThroughput =
    candidate.graphCost.ingestDurationMs === 0
      ? 0
      : (candidate.graphCost.attemptedRecordCount * 1_000) / candidate.graphCost.ingestDurationMs
  return [
    ...(candidate.graphCost.retrievalP95Ms === candidate.resources.retrievalP95Ms
      ? []
      : [`${candidate.candidateId}: graph cost retrieval evidence mismatch`]),
    ...(candidate.graphCost.storedBytes === candidate.resources.storedBytes
      ? []
      : [`${candidate.candidateId}: graph cost storage evidence mismatch`]),
    ...(expectedThroughput === candidate.resources.ingestThroughputPerSecond
      ? []
      : [`${candidate.candidateId}: graph cost ingest evidence mismatch`]),
  ]
}

const storageDecisionErrors = (candidate: CandidateDecisionAnalysis): readonly string[] => {
  const decision = candidate.storageDecision
  if (decision.status !== 'decided') return []
  const expected =
    decision.pooledP95Ms <= STORAGE_LATENCY_THRESHOLD_MS &&
    decision.maxIncrementalRssBytes <= STORAGE_RSS_THRESHOLD_BYTES
      ? 'keep-sqlite'
      : 'open-migration-evaluation'
  const actualCells = Object.keys(decision.perCellP95Ms).sort((left, right) => left.localeCompare(right))
  const expectedCells = [...FROZEN_100K_SCENARIO_IDS].sort((left, right) => left.localeCompare(right))
  return [
    ...(decision.decision === expected
      ? []
      : [`${candidate.candidateId}: storage decision does not match frozen thresholds`]),
    ...(sameCanonicalValue(actualCells, expectedCells)
      ? []
      : [`${candidate.candidateId}: storage decision cell closure mismatch`]),
  ]
}

export const decisionCandidateErrors = (analysis: DecisionAnalysis): readonly string[] => {
  const baseline = baselineFor(analysis)
  return analysis.candidates.flatMap((candidate) => [
    ...rebuildErrors(candidate),
    ...graphCostErrors(candidate),
    ...candidateScoreErrors(candidate, baseline),
    ...storageDecisionErrors(candidate),
  ])
}

export const decisionInputClosureErrors = (analysis: DecisionAnalysis): readonly string[] => {
  const expectedDatasets = ['locomo', 'longmemeval', 'membench', 'memoryagentbench']
  const actualDatasets = analysis.publicDatasets.map(({ datasetId }) => datasetId)
  return [
    ...(analysis.freeze.scenarioManifestSha256 === FROZEN_SCENARIO_MANIFEST.scenarioManifestSha256
      ? []
      : ['frozen corpus SHA-256 mismatch']),
    ...(sameCanonicalValue(actualDatasets, expectedDatasets)
      ? []
      : ['public dataset inventory must be canonical and unique']),
  ]
}
