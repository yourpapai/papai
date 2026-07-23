// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { frozenScenario } from './frozen-run-contract.js'
import type { CandidateResearchResult, RawQueryEvaluation, ScenarioSelection } from './report-schema.js'
import { isCompleteFrozenSplit } from './report-validation-frozen.js'

type GateState = CandidateResearchResult['gates']['scopeIsolation']['state']

const evaluations = (candidate: CandidateResearchResult): readonly RawQueryEvaluation[] =>
  candidate.scenarios.flatMap(({ queries }) => queries)

const safetyState = (
  selection: ScenarioSelection,
  candidate: CandidateResearchResult,
  designatedQueryIds: ReadonlySet<string>,
  violation: (evaluation: RawQueryEvaluation) => boolean,
): GateState => {
  const rows = evaluations(candidate)
  if (rows.some(violation)) return 'fail'
  if (!isCompleteFrozenSplit(selection) || designatedQueryIds.size === 0) return 'not_evaluable'
  const byQuery = new Map<string, RawQueryEvaluation>(rows.map((evaluation) => [evaluation.query.queryId, evaluation]))
  return [...designatedQueryIds].every((queryId) => byQuery.get(queryId)?.rawResult.status === 'success')
    ? 'pass'
    : 'not_evaluable'
}

const scopeProbeIds = (selection: ScenarioSelection): ReadonlySet<string> =>
  new Set(
    selection.scenarioIds.flatMap((scenarioId) => {
      const scenario = frozenScenario(scenarioId)
      return scenario?.faults.crossScopeProbeQueryIds ?? []
    }),
  )

const erasureProbeIds = (selection: ScenarioSelection): ReadonlySet<string> =>
  new Set(
    selection.scenarioIds.flatMap((scenarioId) => {
      const scenario = frozenScenario(scenarioId)
      return (
        scenario?.queries
          .filter(({ slices }) => slices.includes('erasure-non-recapture'))
          .map(({ queryId }) => queryId) ?? []
      )
    }),
  )

const referencesAnyEvidence = (evaluation: RawQueryEvaluation, evidenceIds: readonly string[]): boolean => {
  if (evaluation.rawResult.status !== 'success') return false
  const expected = new Set(evidenceIds)
  return evaluation.rawResult.hits.some(
    (hit) =>
      expected.has(hit.evidenceId) ||
      hit.provenance.derivedFromEvidenceIds.some((evidenceId) => expected.has(evidenceId)),
  )
}

const scopeIsolationState = (selection: ScenarioSelection, candidate: CandidateResearchResult): GateState => {
  const designated = scopeProbeIds(selection)
  return safetyState(
    selection,
    candidate,
    designated,
    (evaluation) =>
      evaluation.metrics.leakageCount > 0 ||
      (designated.has(evaluation.query.queryId) &&
        referencesAnyEvidence(evaluation, evaluation.query.forbiddenEvidenceIds)),
  )
}

const erasureState = (selection: ScenarioSelection, candidate: CandidateResearchResult): GateState => {
  const designated = erasureProbeIds(selection)
  return safetyState(
    selection,
    candidate,
    designated,
    (evaluation) =>
      evaluation.metrics.erasedHitCount > 0 ||
      (designated.has(evaluation.query.queryId) &&
        referencesAnyEvidence(evaluation, evaluation.query.erasedEvidenceIds)),
  )
}

const selfHostingState = (candidate: CandidateResearchResult, executionComplete: boolean): GateState => {
  const registration = candidate.registration.selfHosting
  const external =
    registration.executionMode === 'external' ||
    registration.requiresNetwork ||
    registration.requiresApiKey ||
    registration.requiresHostedModel ||
    registration.requiresProprietaryService ||
    registration.requiresManagedDatabase
  if (external) return 'fail'
  return executionComplete && candidate.workers.every(({ status }) => status === 'completed') ? 'pass' : 'not_evaluable'
}

export type GateEvidence = Readonly<{
  artifactsComplete: boolean
  executionComplete: boolean
}>

const gateNames = ['scopeIsolation', 'erasure', 'selfHosting', 'reproducibility'] as const

export const expectedGateStates = (
  selection: ScenarioSelection,
  candidate: CandidateResearchResult,
  evidence: GateEvidence,
): Readonly<Record<keyof CandidateResearchResult['gates'], GateState>> => ({
  scopeIsolation: scopeIsolationState(selection, candidate),
  erasure: erasureState(selection, candidate),
  selfHosting: selfHostingState(candidate, evidence.executionComplete),
  reproducibility: evidence.artifactsComplete ? 'pass' : 'not_evaluable',
})

export const gateErrors = (
  selection: ScenarioSelection,
  candidate: CandidateResearchResult,
  evidence: GateEvidence,
): readonly string[] => {
  const expected = expectedGateStates(selection, candidate, evidence)
  return gateNames.flatMap((gate) =>
    candidate.gates[gate].state === expected[gate] ? [] : [`${candidate.registration.id}: ${gate} gate mismatch`],
  )
}
