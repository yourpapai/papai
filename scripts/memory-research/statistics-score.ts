// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { CandidateId, ValidationResult } from './statistics.js'

export type GateState = 'pass' | 'fail' | 'not_evaluable'
export type EvidenceState = 'valid' | 'invalid' | 'missing'
export const REPRODUCIBILITY_ARTIFACT_KINDS = [
  'manifests',
  'implementationHashes',
  'sourceHashes',
  'rawRows',
  'failureRows',
  'aggregates',
  'requiredOutputs',
] as const
export type ReproducibilityArtifactKind = (typeof REPRODUCIBILITY_ARTIFACT_KINDS)[number]
export type ReproducibilityArtifactInventory = Readonly<Partial<Record<ReproducibilityArtifactKind, EvidenceState>>>

export type UniversalGateStates = Readonly<{
  scopeSafety: GateState
  erasureSafety: GateState
  selfHosting: GateState
  reproducibility: GateState
}>

export type ScoreResources = Readonly<{
  retrievalP95Ms: number
  ingestThroughputPerSecond: number
  storedBytes: number
  incrementalRssBytes: number
}>

export type ScoreQuality = Readonly<{
  recallAtK: number
  ndcgAtK: number
  reciprocalRank: number
  precisionAtK: number
  relationalTemporalComposite: number
  missingEmbeddingRecallAtK: number
  duplicateOutOfOrderRecallAtK: number
}>

export type RebuildProbe = Readonly<{
  status: 'success' | 'failure' | 'timeout' | 'missing'
  orderedHitIdsEqual: boolean
}>

export type CandidateScoreInput = Readonly<{
  candidateId: CandidateId
  split: string
  scale: number
  gates: UniversalGateStates
  quality: ScoreQuality
  resources: ScoreResources
  rebuildProbes: readonly RebuildProbe[]
}>

export type EfficiencyBaseline = Readonly<{
  candidateId: 'as-shipped'
  split: string
  scale: number
  resources: ScoreResources
}>

export type WeightedScoreResult =
  | Readonly<{ status: 'scored'; total: number; components: Readonly<Record<string, number>> }>
  | Readonly<{ status: 'ineligible'; reasons: readonly string[] }>
  | Readonly<{ status: 'invalid'; errors: readonly string[] }>

export type SafetyProbe = Readonly<{
  status: 'success' | 'failure' | 'timeout' | 'missing'
  violationCount: number
}>

export type SelfHostingEvidence = Readonly<{
  registration: EvidenceState
  execution: 'success' | 'failure' | 'missing'
  requiresNetwork: boolean
  requiresApiKey: boolean
  requiresHostedModel: boolean
  requiresProprietaryService: boolean
  requiresManagedDatabase: boolean
}>

const valid = <Value>(value: Value): ValidationResult<Value> => ({ valid: true, value })
const invalid = <Value = never>(...errors: readonly string[]): ValidationResult<Value> => ({ valid: false, errors })
const finiteUnit = (value: number): boolean => Number.isFinite(value) && value >= 0 && value <= 1
const finitePositive = (value: number): boolean => Number.isFinite(value) && value > 0
const clampUnit = (value: number): number => Math.min(1, Math.max(0, value))

const scoreResourceErrors = (label: string, value: ScoreResources): readonly string[] =>
  Object.entries(value)
    .filter(([, metric]) => !finitePositive(metric))
    .map(([key]) => `${label} ${key} must be finite and strictly positive`)

const scoreQualityErrors = (quality: ScoreQuality): readonly string[] =>
  Object.entries(quality)
    .filter(([, value]) => !finiteUnit(value))
    .map(([key]) => `${key} must be finite and between zero and one`)

const allGatesPass = (gates: UniversalGateStates): boolean => Object.values(gates).every((state) => state === 'pass')

const rebuildAgreement = (probes: readonly RebuildProbe[]): ValidationResult<number> =>
  probes.length === 0
    ? invalid('weighted score requires at least one scheduled rebuild probe')
    : valid(
        probes.filter(({ status, orderedHitIdsEqual }) => status === 'success' && orderedHitIdsEqual).length /
          probes.length,
      )

const weightedComponents = (
  input: CandidateScoreInput,
  baseline: EfficiencyBaseline,
  rebuild: number,
): Readonly<Record<string, number>> => ({
  recallAtK: 20 * input.quality.recallAtK,
  ndcgAtK: 15 * input.quality.ndcgAtK,
  reciprocalRank: 10 * input.quality.reciprocalRank,
  precisionAtK: 10 * input.quality.precisionAtK,
  relationalTemporalComposite: 20 * input.quality.relationalTemporalComposite,
  missingEmbeddingRecallAtK: 5 * input.quality.missingEmbeddingRecallAtK,
  duplicateOutOfOrderRecallAtK: 5 * input.quality.duplicateOutOfOrderRecallAtK,
  rebuildAgreement: 5 * rebuild,
  retrievalP95Efficiency: 4 * clampUnit(baseline.resources.retrievalP95Ms / input.resources.retrievalP95Ms),
  ingestThroughputEfficiency:
    2 * clampUnit(input.resources.ingestThroughputPerSecond / baseline.resources.ingestThroughputPerSecond),
  storedBytesEfficiency: 2 * clampUnit(baseline.resources.storedBytes / input.resources.storedBytes),
  incrementalRssEfficiency: 2 * clampUnit(baseline.resources.incrementalRssBytes / input.resources.incrementalRssBytes),
})

export const computeWeightedScore = (input: CandidateScoreInput, baseline: EfficiencyBaseline): WeightedScoreResult => {
  const rebuild = rebuildAgreement(input.rebuildProbes)
  const rebuildErrors = rebuild.valid ? [] : rebuild.errors
  const errors = [
    ...(input.split === 'sealed-test' ? [] : ['weighted score requires the sealed-test split']),
    ...(input.scale === 10_000 ? [] : ['weighted score requires the 10000-record primary scale']),
    ...(baseline.split === input.split ? [] : ['as-shipped baseline split must match candidate']),
    ...(baseline.scale === input.scale ? [] : ['as-shipped baseline scale must match candidate']),
    ...scoreQualityErrors(input.quality),
    ...scoreResourceErrors('candidate', input.resources),
    ...scoreResourceErrors('as-shipped baseline', baseline.resources),
    ...rebuildErrors,
  ]
  if (errors.length > 0 || !rebuild.valid) return { status: 'invalid', errors }
  if (!allGatesPass(input.gates)) {
    return {
      status: 'ineligible',
      reasons: Object.entries(input.gates)
        .filter(([, state]) => state !== 'pass')
        .map(([gate, state]) => `${gate}:${state}`),
    }
  }
  const components = weightedComponents(input, baseline, rebuild.value)
  return {
    status: 'scored',
    total: Object.values(components).reduce((sum, component) => sum + component, 0),
    components,
  }
}

export const evaluateSafetyGate = (probes: readonly SafetyProbe[]): GateState => {
  if (probes.some(({ violationCount }) => Number.isFinite(violationCount) && violationCount > 0)) return 'fail'
  if (
    probes.length === 0 ||
    probes.some(
      ({ status, violationCount }) => status !== 'success' || !Number.isInteger(violationCount) || violationCount < 0,
    )
  ) {
    return 'not_evaluable'
  }
  return 'pass'
}

export const evaluateSelfHostingGate = (evidence: SelfHostingEvidence): GateState => {
  const externalRequirement = [
    evidence.requiresNetwork,
    evidence.requiresApiKey,
    evidence.requiresHostedModel,
    evidence.requiresProprietaryService,
    evidence.requiresManagedDatabase,
  ].some(Boolean)
  if (externalRequirement || evidence.registration === 'invalid') return 'fail'
  return evidence.registration === 'valid' && evidence.execution === 'success' ? 'pass' : 'not_evaluable'
}

export const evaluateReproducibilityGate = (inventory: ReproducibilityArtifactInventory): GateState => {
  if (Object.values(inventory).includes('invalid')) return 'fail'
  return REPRODUCIBILITY_ARTIFACT_KINDS.every((kind) => inventory[kind] === 'valid') ? 'pass' : 'not_evaluable'
}
