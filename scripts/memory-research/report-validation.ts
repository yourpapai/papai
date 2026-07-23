// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { aggregateQueryMetrics, scoreQueryResult } from './metrics.js'
import { implementationDigest, sourceInventoryErrors } from './report-identity.js'
import { ResearchReportSchema } from './report-schema.js'
import type { CandidateResearchResult, RawQueryEvaluation, ResearchReport } from './report-schema.js'
import { candidateImplementationErrors, queryFailureErrors, validateWorkers } from './report-validation-artifacts.js'
import { frozenCandidateErrors, frozenSelectionErrors, validateLifecycle } from './report-validation-frozen.js'
import { gateErrors } from './report-validation-gates.js'
import { rawQueryResultContractErrors } from './types.js'
import type { AggregateReport, RawQueryResult, SliceLabel } from './types.js'

const sameJson = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right)

const failureKey = (failure: CandidateResearchResult['failures'][number]): string =>
  [failure.scenarioId ?? '', failure.queryId ?? '', failure.stage, failure.kind, failure.message].join('\u0000')

const normalizeCandidate = (candidate: CandidateResearchResult): CandidateResearchResult => ({
  ...candidate,
  scenarios: [...candidate.scenarios].sort((left, right) => left.scenarioId.localeCompare(right.scenarioId)),
  sliceAggregates: [...candidate.sliceAggregates].sort((left, right) => left.slice.localeCompare(right.slice)),
  workers: [...candidate.workers].sort((left, right) => left.scenarioId.localeCompare(right.scenarioId)),
  failures: [...candidate.failures].sort((left, right) => failureKey(left).localeCompare(failureKey(right))),
})

const normalizeReport = (report: ResearchReport): ResearchReport => ({
  ...report,
  sourceFiles: [...report.sourceFiles].sort((left, right) => left.path.localeCompare(right.path)),
  candidates: [...report.candidates]
    .sort((left, right) => left.registration.id.localeCompare(right.registration.id))
    .map(normalizeCandidate),
  publicDatasets: [...report.publicDatasets].sort((left, right) => left.datasetId.localeCompare(right.datasetId)),
})

const queryEvaluations = (candidate: CandidateResearchResult): readonly RawQueryEvaluation[] =>
  candidate.scenarios.flatMap(({ queries }) => queries)

const queryKeys = (candidate: CandidateResearchResult): readonly string[] =>
  candidate.scenarios.flatMap(({ scenarioId, queries }) => queries.map(({ query }) => `${scenarioId}/${query.queryId}`))

const sourceIdentityErrors = (report: ResearchReport): readonly string[] => [
  ...sourceInventoryErrors(report.sourceInventory, report.sourceFiles),
  ...(implementationDigest(report.sourceFiles) === report.implementationSha256
    ? []
    : ['implementation SHA-256 mismatch']),
]

const publicDatasetErrors = (report: ResearchReport): readonly string[] => {
  const expected = ['locomo', 'longmemeval', 'membench', 'memoryagentbench']
  const actual = report.publicDatasets.map(({ datasetId }) => datasetId)
  return sameJson(actual, expected)
    ? []
    : ['public dataset inventory must contain each registered dataset exactly once']
}

const diagnosticCounts = (
  evaluation: RawQueryEvaluation,
): Readonly<{ forbiddenHitCount: number; erasedHitCount: number }> => {
  if (evaluation.rawResult.status !== 'success') return { forbiddenHitCount: 0, erasedHitCount: 0 }
  const forbidden = new Set(evaluation.query.forbiddenEvidenceIds)
  const erased = new Set(evaluation.query.erasedEvidenceIds)
  return {
    forbiddenHitCount: evaluation.rawResult.hits.filter(({ evidenceId }) => forbidden.has(evidenceId)).length,
    erasedHitCount: evaluation.rawResult.hits.filter(({ evidenceId }) => erased.has(evidenceId)).length,
  }
}

const queryErrors = (candidate: CandidateResearchResult): readonly string[] =>
  queryEvaluations(candidate).flatMap((evaluation) => {
    const prefix = `${candidate.registration.id}/${evaluation.query.queryId}`
    const expectedMetrics = scoreQueryResult(evaluation.query, evaluation.rawResult)
    return [
      ...(evaluation.rawResult.queryId === evaluation.query.queryId
        ? []
        : [`${prefix}: raw result query identity mismatch`]),
      ...rawQueryResultContractErrors(evaluation.query, evaluation.rawResult).map((message) => `${prefix}: ${message}`),
      ...(evaluation.metrics.queryId === evaluation.query.queryId ? [] : [`${prefix}: metric query identity mismatch`]),
      ...(sameJson(evaluation.metrics, expectedMetrics) ? [] : [`${prefix}: query metrics mismatch`]),
      ...(sameJson(evaluation.diagnostics, diagnosticCounts(evaluation))
        ? []
        : [`${prefix}: query diagnostics mismatch`]),
    ]
  })

const aggregateForSlice = (evaluations: readonly RawQueryEvaluation[], slice: SliceLabel): AggregateReport =>
  aggregateQueryMetrics(evaluations.filter(({ query }) => query.slices.includes(slice)).map(({ metrics }) => metrics))

const aggregateErrors = (candidate: CandidateResearchResult): readonly string[] => {
  const evaluations = queryEvaluations(candidate)
  const expectedAggregate = aggregateQueryMetrics(evaluations.map(({ metrics }) => metrics))
  const slices = [...new Set(evaluations.flatMap(({ query }) => query.slices))].sort((left, right) =>
    left.localeCompare(right),
  )
  const expectedSlices = slices.map((slice) => ({ slice, aggregate: aggregateForSlice(evaluations, slice) }))
  return [
    ...(sameJson(candidate.aggregate, expectedAggregate) ? [] : [`${candidate.registration.id}: aggregate mismatch`]),
    ...(sameJson(candidate.sliceAggregates, expectedSlices)
      ? []
      : [`${candidate.registration.id}: slice aggregate mismatch`]),
  ]
}

const registrationErrors = (candidate: CandidateResearchResult): readonly string[] => {
  const { manifest, registration } = candidate
  return [
    ...(manifest.candidate.id === registration.id ? [] : [`${registration.id}: manifest candidate mismatch`]),
    ...(manifest.candidate.version === registration.version ? [] : [`${registration.id}: manifest version mismatch`]),
    ...(sameJson(manifest.candidate.config, registration.config)
      ? []
      : [`${registration.id}: manifest config mismatch`]),
  ]
}

const rebuildErrors = (candidate: CandidateResearchResult): readonly string[] => {
  const { rebuildAgreement } = candidate
  const expectedQueryIds = candidate.manifest.faultConfiguration.rebuildBeforeQueryIds
  const agreementCount = rebuildAgreement.probes.filter(
    ({ status, beforeHitIds, afterHitIds }) => status === 'success' && sameJson(beforeHitIds, afterHitIds),
  ).length
  const exact = rebuildAgreement.probes.length === agreementCount
  return [
    ...(sameJson(
      rebuildAgreement.probes.map(({ queryId }) => queryId),
      expectedQueryIds,
    )
      ? []
      : [`${candidate.registration.id}: rebuild probe identity mismatch`]),
    ...(rebuildAgreement.probeCount === rebuildAgreement.probes.length
      ? []
      : [`${candidate.registration.id}: rebuild probe count mismatch`]),
    ...(rebuildAgreement.agreementCount === agreementCount
      ? []
      : [`${candidate.registration.id}: rebuild agreement count mismatch`]),
    ...(rebuildAgreement.exact === exact ? [] : [`${candidate.registration.id}: rebuild exactness mismatch`]),
  ]
}

const comparisonIdentity = (candidate: CandidateResearchResult): unknown => ({
  scenarioManifestVersion: candidate.manifest.scenarioManifestVersion,
  scenarioManifestSha256: candidate.manifest.scenarioManifestSha256,
  deterministicEmbeddingVersion: candidate.manifest.deterministicEmbeddingVersion,
  deterministicEmbeddingDimension: candidate.manifest.deterministicEmbeddingDimension,
  split: candidate.manifest.split,
  scale: candidate.manifest.scale,
  seed: candidate.manifest.seed,
  faultConfiguration: candidate.manifest.faultConfiguration,
  queryTimeoutMs: candidate.manifest.candidate.config['queryTimeoutMs'],
  workerDeadlineMs: candidate.manifest.candidate.config['workerDeadlineMs'],
})

const comparisonErrors = (report: ResearchReport): readonly string[] => {
  const reference = report.candidates[0]
  if (reference === undefined) return ['report has no candidate']
  const identity = comparisonIdentity(reference)
  const keys = queryKeys(reference)
  const queries = queryEvaluations(reference).map(({ query }) => query)
  return report.candidates.slice(1).flatMap((candidate) => [
    ...(sameJson(comparisonIdentity(candidate), identity)
      ? []
      : [`${candidate.registration.id}: comparison identity mismatch`]),
    ...(sameJson(queryKeys(candidate), keys) ? [] : [`${candidate.registration.id}: query order mismatch`]),
    ...(sameJson(
      queryEvaluations(candidate).map(({ query }) => query),
      queries,
    )
      ? []
      : [`${candidate.registration.id}: frozen query definition mismatch`]),
  ])
}

const candidateErrors = (report: ResearchReport): readonly string[] =>
  report.candidates.flatMap((candidate) => {
    const lifecycle = validateLifecycle(report, candidate)
    const workers = validateWorkers(report, candidate, lifecycle)
    const failures = queryFailureErrors(candidate)
    const implementation = candidateImplementationErrors(report, candidate)
    const rebuild = rebuildErrors(candidate)
    const artifactsComplete =
      report.sourceInventory.scope === 'complete' &&
      lifecycle.complete &&
      workers.complete &&
      failures.length === 0 &&
      implementation.length === 0 &&
      rebuild.length === 0
    return [
      ...registrationErrors(candidate),
      ...frozenCandidateErrors(report, candidate),
      ...queryErrors(candidate),
      ...aggregateErrors(candidate),
      ...failures,
      ...lifecycle.errors,
      ...workers.errors,
      ...implementation,
      ...rebuild,
      ...gateErrors(report.selection, candidate, {
        artifactsComplete,
        executionComplete: lifecycle.complete,
      }),
    ]
  })

export const validateResearchReport = (input: unknown): ResearchReport => {
  const report = normalizeReport(ResearchReportSchema.parse(input))
  const candidateIds = report.candidates.map(({ registration }) => registration.id)
  const errors = [
    ...sourceIdentityErrors(report),
    ...frozenSelectionErrors(report),
    ...publicDatasetErrors(report),
    ...(new Set(candidateIds).size === candidateIds.length ? [] : ['candidate registrations must be unique']),
    ...candidateErrors(report),
    ...comparisonErrors(report),
  ]
  if (errors.length > 0) throw new Error(`Invalid memory research report: ${errors.join('; ')}`)
  return report
}

export const rawHits = (result: RawQueryResult): readonly string[] =>
  result.status === 'success' ? result.hits.map(({ evidenceId }) => evidenceId) : []
