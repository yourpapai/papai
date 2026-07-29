// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { implementationDigest } from './report-identity.js'
import { aggregateWorkerResources } from './report-resources.js'
import type {
  CandidateResearchResult,
  CandidateWorkerResult,
  ResearchReport,
  ResearchSourceFile,
} from './report-schema.js'
import type { LifecycleValidation } from './report-validation-frozen.js'

const sameJson = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right)

const candidateSourceFiles = (
  report: ResearchReport,
  candidate: CandidateResearchResult,
): readonly ResearchSourceFile[] | null => {
  const paths = candidate.registration.implementationSourcePaths
  if (paths === null) return report.sourceFiles
  const byPath = new Map(report.sourceFiles.map((source) => [source.path, source] as const))
  const resolved = paths.flatMap((path) => {
    const source = byPath.get(path)
    return source === undefined ? [] : [source]
  })
  return resolved.length === paths.length ? resolved : null
}

export const candidateImplementationErrors = (
  report: ResearchReport,
  candidate: CandidateResearchResult,
): readonly string[] => {
  const sources = candidateSourceFiles(report, candidate)
  const paths = candidate.registration.implementationSourcePaths
  const orderedPaths = paths === null ? null : [...paths].sort((left, right) => left.localeCompare(right))
  const pathsValid = paths === null || (new Set(paths).size === paths.length && sameJson(paths, orderedPaths))
  const expected = sources === null ? null : implementationDigest(sources)
  return [
    ...(pathsValid ? [] : [`${candidate.registration.id}: candidate implementation source paths are not canonical`]),
    ...(sources === null ? [`${candidate.registration.id}: candidate implementation source path is undeclared`] : []),
    ...(expected === candidate.registration.implementationSha256
      ? []
      : [`${candidate.registration.id}: candidate implementation SHA-256 mismatch`]),
  ]
}

const expectedWorkerStatus = (
  candidate: CandidateResearchResult,
  scenarioId: string,
): CandidateWorkerResult['status'] => {
  const scenario = candidate.scenarios.find((entry) => entry.scenarioId === scenarioId)
  const rawStatuses = scenario?.queries.map(({ rawResult }) => rawResult.status) ?? []
  const failures = candidate.failures.filter(
    (failure) => failure.scenarioId === scenarioId && failure.stage !== 'resource',
  )
  return rawStatuses.includes('timeout') || failures.some(({ kind }) => kind === 'timeout')
    ? 'timeout'
    : rawStatuses.includes('failure') || failures.length > 0
      ? 'failure'
      : 'completed'
}

const expectedResourceStatus = (
  candidate: CandidateResearchResult,
  lifecycle: LifecycleValidation,
  scenarioId: string,
): CandidateWorkerResult['resourceStatus'] =>
  lifecycle.completeScenarioIds.has(scenarioId) &&
  !candidate.failures.some((failure) => failure.scenarioId === scenarioId && failure.stage === 'resource')
    ? 'measured'
    : 'missing'

export type WorkerValidation = Readonly<{
  complete: boolean
  errors: readonly string[]
}>

export const validateWorkers = (
  report: ResearchReport,
  candidate: CandidateResearchResult,
  lifecycle: LifecycleValidation,
): WorkerValidation => {
  const workerScenarioIds = candidate.workers.map(({ scenarioId }) => scenarioId)
  const identityErrors = sameJson(workerScenarioIds, report.selection.scenarioIds)
    ? []
    : [`${candidate.registration.id}: worker scenario identity mismatch`]
  const workerErrors = candidate.workers.flatMap((worker) => [
    ...(worker.status === expectedWorkerStatus(candidate, worker.scenarioId)
      ? []
      : [`${candidate.registration.id}/${worker.scenarioId}: worker status mismatch`]),
    ...(worker.resourceStatus === expectedResourceStatus(candidate, lifecycle, worker.scenarioId)
      ? []
      : [`${candidate.registration.id}/${worker.scenarioId}: worker resource status mismatch`]),
  ])
  const expectedResources = aggregateWorkerResources(candidate.workers)
  const expectedComplete = candidate.workers.every(({ resourceStatus }) => resourceStatus === 'measured')
  const aggregateErrors = [
    ...(sameJson(candidate.resources, expectedResources)
      ? []
      : [`${candidate.registration.id}: aggregate worker resources mismatch`]),
    ...(candidate.resourcesComplete === expectedComplete
      ? []
      : [`${candidate.registration.id}: resource completeness mismatch`]),
  ]
  return {
    complete: identityErrors.length === 0 && workerErrors.length === 0 && expectedComplete,
    errors: [...identityErrors, ...workerErrors, ...aggregateErrors],
  }
}

const matchingFailureKind = (
  status: 'failure' | 'timeout',
  kind: CandidateResearchResult['failures'][number]['kind'],
): boolean => (status === 'timeout' ? kind === 'timeout' : kind === 'exception' || kind === 'validation')

export const queryFailureErrors = (candidate: CandidateResearchResult): readonly string[] =>
  candidate.scenarios.flatMap(({ scenarioId, queries }) =>
    queries
      .filter(({ rawResult }) => rawResult.status !== 'success')
      .flatMap(({ query, rawResult }) => {
        if (rawResult.status === 'success') return []
        const matching = candidate.failures.some(
          (failure) =>
            failure.scenarioId === scenarioId &&
            failure.queryId === query.queryId &&
            matchingFailureKind(rawResult.status, failure.kind),
        )
        return matching ? [] : [`${candidate.registration.id}/${query.queryId}: missing truthful failure`]
      }),
  )
