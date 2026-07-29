// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expectedLifecycleSteps, frozenScenario } from './frozen-run-contract.js'
import { aggregateQueryMetrics } from './metrics.js'
import { aggregateWorkerResources } from './report-resources.js'
import { expectedGateStates } from './report-validation-gates.js'
import type { CandidateResearchResult, RawQueryEvaluation } from './report.js'
import type { CandidateWorkerResult, ScenarioSelection } from './report.js'
import type { ScenarioJobResult } from './runner-contracts.js'
import type { CandidateId, RunManifest, SliceLabel } from './types.js'

const allQueries = (jobs: readonly ScenarioJobResult[]): readonly RawQueryEvaluation[] =>
  jobs.flatMap(({ scenario }) => scenario.queries)

const sliceAggregates = (evaluations: readonly RawQueryEvaluation[]): CandidateResearchResult['sliceAggregates'] => {
  const slices = [...new Set(evaluations.flatMap(({ query }) => query.slices))].sort((left, right) =>
    left.localeCompare(right),
  )
  return slices.map((slice: SliceLabel) => ({
    slice,
    aggregate: aggregateQueryMetrics(
      evaluations.filter(({ query }) => query.slices.includes(slice)).map(({ metrics }) => metrics),
    ),
  }))
}

const rebuildAgreement = (jobs: readonly ScenarioJobResult[]): CandidateResearchResult['rebuildAgreement'] => {
  const probes = jobs.flatMap(({ rebuildProbes }) => rebuildProbes)
  const agreementCount = probes.filter(
    ({ status, beforeHitIds, afterHitIds }) =>
      status === 'success' && JSON.stringify(beforeHitIds) === JSON.stringify(afterHitIds),
  ).length
  return {
    probeCount: probes.length,
    agreementCount,
    exact: agreementCount === probes.length,
    probes,
  }
}

const normalizedLifecycle = (jobs: readonly ScenarioJobResult[]): CandidateResearchResult['lifecycle'] =>
  jobs.flatMap(({ lifecycle }) => lifecycle).map((entry, ordinal) => ({ ...entry, ordinal }))

const lifecycleKey = ({ kind, referenceId }: Readonly<{ kind: string; referenceId: string }>): string =>
  `${kind}\u0000${referenceId}`

const completeLifecycle = (job: ScenarioJobResult, scale: RunManifest['scale']): boolean => {
  const scenario = frozenScenario(job.scenario.scenarioId)
  return (
    scenario !== undefined &&
    JSON.stringify(job.lifecycle.map(lifecycleKey)) ===
      JSON.stringify(expectedLifecycleSteps(scenario, scale).map(lifecycleKey))
  )
}

const workerStatus = (job: ScenarioJobResult): CandidateWorkerResult['status'] => {
  const statuses = job.scenario.queries.map(({ rawResult }) => rawResult.status)
  const failures = job.failures.filter(({ stage }) => stage !== 'resource')
  return statuses.includes('timeout') || failures.some(({ kind }) => kind === 'timeout')
    ? 'timeout'
    : statuses.includes('failure') || failures.length > 0
      ? 'failure'
      : 'completed'
}

const workerResult = (job: ScenarioJobResult, scale: RunManifest['scale']): CandidateWorkerResult => {
  const measured = completeLifecycle(job, scale) && !job.failures.some(({ stage }) => stage === 'resource')
  return {
    workerPid: job.workerPid,
    scenarioId: job.scenario.scenarioId,
    status: workerStatus(job),
    resourceStatus: measured ? 'measured' : 'missing',
    resources: measured ? job.resources : null,
  }
}

const gatesWithEvidence = (
  states: Readonly<
    Record<keyof CandidateResearchResult['gates'], CandidateResearchResult['gates']['erasure']['state']>
  >,
): CandidateResearchResult['gates'] => ({
  scopeIsolation: { state: states.scopeIsolation, evidence: 'All designated frozen scope probes were evaluated.' },
  erasure: { state: states.erasure, evidence: 'All designated frozen erasure probes were evaluated.' },
  selfHosting: { state: states.selfHosting, evidence: 'Offline registration and worker execution were evaluated.' },
  reproducibility: {
    state: states.reproducibility,
    evidence: 'Manifest, hashes, raw rows, failures, aggregates, lifecycle, and resources were evaluated.',
  },
})

const candidateRegistration = (
  candidateId: CandidateId,
  manifest: RunManifest,
  implementationSha256: string,
): CandidateResearchResult['registration'] => ({
  id: candidateId,
  version: manifest.candidate.version,
  config: manifest.candidate.config,
  implementationSha256,
  implementationSourcePaths: null,
  selfHosting: {
    executionMode: 'offline',
    requiresNetwork: false,
    requiresApiKey: false,
    requiresHostedModel: false,
    requiresProprietaryService: false,
    requiresManagedDatabase: false,
  },
})

export const aggregateCandidateJobs = (
  candidateId: CandidateId,
  selection: ScenarioSelection,
  manifest: RunManifest,
  jobs: readonly ScenarioJobResult[],
  implementationSha256: string,
  completeSourceInventory: boolean,
): CandidateResearchResult => {
  const evaluations = allQueries(jobs)
  const workers = jobs.map((job) => workerResult(job, manifest.scale))
  const resourcesComplete = workers.every(({ resourceStatus }) => resourceStatus === 'measured')
  const candidate = {
    registration: candidateRegistration(candidateId, manifest, implementationSha256),
    manifest,
    scenarios: jobs.map(({ scenario }) => scenario),
    aggregate: aggregateQueryMetrics(evaluations.map(({ metrics }) => metrics)),
    sliceAggregates: sliceAggregates(evaluations),
    resources: aggregateWorkerResources(workers),
    resourcesComplete,
    workers,
    failures: jobs.flatMap(({ failures }) => failures),
    lifecycle: normalizedLifecycle(jobs),
    rebuildAgreement: rebuildAgreement(jobs),
    gates: {
      scopeIsolation: { state: 'not_evaluable', evidence: 'Pending validation.' },
      erasure: { state: 'not_evaluable', evidence: 'Pending validation.' },
      selfHosting: { state: 'not_evaluable', evidence: 'Pending validation.' },
      reproducibility: { state: 'not_evaluable', evidence: 'Pending validation.' },
    },
  } as const satisfies CandidateResearchResult
  const executionComplete = jobs.every((job) => completeLifecycle(job, manifest.scale))
  const states = expectedGateStates(selection, candidate, {
    artifactsComplete: completeSourceInventory && resourcesComplete && executionComplete,
    executionComplete,
  })
  return { ...candidate, gates: gatesWithEvidence(states) }
}
