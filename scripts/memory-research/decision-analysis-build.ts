// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { registeredCandidateIds } from './candidate-registry.js'
import {
  analyzeGraph,
  finiteDecision,
  promotionEvidence,
  registeredComparisons,
} from './decision-analysis-comparisons.js'
import type { DecisionAnalysisInput } from './decision-analysis-input.js'
import { validateDecisionInputs } from './decision-analysis-input.js'
import { analyzeCandidate, scoreResources } from './decision-analysis-observations.js'
import { DECISION_ANALYSIS_SCHEMA_VERSION, type DecisionAnalysis } from './decision-analysis-schema.js'
import { validateDecisionAnalysis } from './decision-analysis-validation.js'
import { FROZEN_SCENARIO_MANIFEST } from './manifest.js'
import type { CandidateResearchResult } from './report.js'
import { FROZEN_100K_SEED } from './statistics-storage.js'
import { BOOTSTRAP_RESAMPLES, BOOTSTRAP_SEED, type EfficiencyBaseline } from './statistics.js'
import type { CandidateId } from './types.js'

export const DECISION_LIMITATIONS = [
  'Deterministic synthetic embeddings are not learned production embeddings.',
  'The frozen synthetic corpus is not production conversation traffic.',
  'Component retrieval scores do not establish final answer quality.',
  'No live LLM reader or judge was executed.',
  'LongMemEval, LoCoMo, MemoryAgentBench, and MemBench official protocols were not run.',
  'Explicit graph fixtures do not validate real graph extraction quality.',
  'Group namespaces are not speaker-conditioned belief tracking.',
  'Single-process scale tests do not exercise poisoning, concurrent durability, deferred actions, or million-token reader utilization.',
  'Operational crash recovery, migration, backup/restore, and sustained-load tests were not run.',
  'Standalone decision-sidecar validation checks internal closure but does not recompute bootstrap intervals from hashed component artifacts.',
  'The as-shipped artifact is an active-record retrieval/injection proxy, not the deployed papai subsystem.',
  'Capture, extraction, provisional promotion, and production SQLite behavior were not executed by the proxy.',
  'Context assembly relevance was not scored; only retrieval hits were scored.',
  'Proxy safety and resource observations do not establish deployed-system incidents or production SQLite performance.',
] as const

const requireCandidate = (
  candidates: readonly CandidateResearchResult[],
  candidateId: CandidateId,
): CandidateResearchResult => {
  const candidate = candidates.find(({ registration }) => registration.id === candidateId)
  if (candidate === undefined) throw new Error(`Missing candidate: ${candidateId}`)
  return candidate
}

const baselineFor = (primary: DecisionAnalysisInput['primaryReport']): EfficiencyBaseline => ({
  candidateId: 'as-shipped',
  split: 'sealed-test',
  scale: 10_000,
  resources: scoreResources(requireCandidate(primary.candidates, 'as-shipped')),
})

const ratio = (value: number): number | 'infinity' => (Number.isFinite(value) ? value : 'infinity')

const serializableGraphGate = (gate: ReturnType<typeof analyzeGraph>['graphGate']): DecisionAnalysis['graphGate'] =>
  gate === null
    ? null
    : {
        ...gate,
        ratios: {
          retrievalP95: ratio(gate.ratios.retrievalP95),
          ingestCostPerAttempt: ratio(gate.ratios.ingestCostPerAttempt),
          callCostPerAttempt: ratio(gate.ratios.callCostPerAttempt),
          storedBytes: ratio(gate.ratios.storedBytes),
        },
      }

const publicDatasetStatuses = (report: DecisionAnalysisInput['primaryReport']): DecisionAnalysis['publicDatasets'] =>
  report.publicDatasets.map(({ datasetId, importStatus, protocolStatus, reason }) => ({
    datasetId,
    importStatus,
    protocolStatus,
    reason,
  }))

export const buildDecisionAnalysis = (input: DecisionAnalysisInput): DecisionAnalysis => {
  const validated = validateDecisionInputs(input)
  const baseline = baselineFor(validated.primary)
  const storageByCandidate = new Map(
    validated.storage.candidates.map(({ candidateId, decision }) => [candidateId, decision] as const),
  )
  const candidates = registeredCandidateIds.map((candidateId) => {
    const storageDecision = storageByCandidate.get(candidateId)
    if (storageDecision === undefined) throw new Error(`Missing storage decision: ${candidateId}`)
    return analyzeCandidate(validated.primary, validated.sensitivity, candidateId, baseline, storageDecision)
  })
  const baseComparisons = registeredComparisons(validated.primary)
  const promotions = promotionEvidence(candidates, baseComparisons)
  const graph = analyzeGraph(validated.primary, candidates)
  const numericGraphGate = graph.graphGate
  const representationDecision = finiteDecision(candidates, promotions, numericGraphGate)
  const selectedStorage =
    representationDecision.candidateId === null
      ? null
      : {
          candidateId: representationDecision.candidateId,
          result: storageByCandidate.get(representationDecision.candidateId)!,
        }
  const primaryManifest = validated.primary.candidates[0]!.manifest
  return validateDecisionAnalysis({
    schemaVersion: DECISION_ANALYSIS_SCHEMA_VERSION,
    artifacts: validated.artifacts,
    freeze: {
      scenarioManifestVersion: FROZEN_SCENARIO_MANIFEST.scenarioManifestVersion,
      scenarioManifestSha256: FROZEN_SCENARIO_MANIFEST.scenarioManifestSha256,
      selectionSha256: validated.primary.selection.selectionSha256,
      seed: FROZEN_100K_SEED,
      primaryScale: primaryManifest.scale,
      sensitivityScale: validated.sensitivity.candidates[0]!.manifest.scale,
      bootstrapSeed: BOOTSTRAP_SEED,
      bootstrapResamples: BOOTSTRAP_RESAMPLES,
    },
    implementationSha256: validated.primary.implementationSha256,
    candidates,
    pairedComparisons: graph.graphComparison === null ? baseComparisons : [...baseComparisons, graph.graphComparison],
    promotions,
    strongestEligibleNonGraph: graph.strongestEligibleNonGraph,
    graphGate: serializableGraphGate(numericGraphGate),
    representationDecision,
    selectedStorageDecision: selectedStorage,
    publicDatasets: publicDatasetStatuses(validated.primary),
    limitations: DECISION_LIMITATIONS,
  })
}
