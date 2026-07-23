// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { candidateVersions, registeredCandidateIds } from './candidate-registry.js'
import { canonicalSerialize, FROZEN_SCENARIO_MANIFEST } from './manifest.js'
import { implementationDigest, sourceInventoryErrors } from './report.js'
import {
  evaluateStorageDecision,
  FROZEN_100K_MEASURED_RETRIEVALS,
  FROZEN_100K_SCENARIO_IDS,
  FROZEN_100K_STORED_RECORDS,
  FROZEN_100K_WARMUPS,
} from './statistics-storage.js'
import { FrozenStorageReportSchema } from './storage-report-schema.js'
import type { CandidateStorageReport, FrozenStorageReport } from './storage-report-schema.js'

const sameJson = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right)

const jobErrors = (candidate: CandidateStorageReport): readonly string[] => {
  const scenarioIds = candidate.jobs.map(({ run }) => run.scenarioId)
  return candidate.jobs
    .flatMap((job) => [
      ...(job.candidateId === candidate.candidateId ? [] : [`${candidate.candidateId}: job candidate mismatch`]),
      ...(job.candidateVersion === candidate.candidateVersion
        ? []
        : [`${candidate.candidateId}: job candidate version mismatch`]),
      ...(job.scenarioManifestVersion === FROZEN_SCENARIO_MANIFEST.scenarioManifestVersion &&
      job.scenarioManifestSha256 === FROZEN_SCENARIO_MANIFEST.scenarioManifestSha256
        ? []
        : [`${candidate.candidateId}: job corpus identity mismatch`]),
      ...(job.run.freshWorker ? [] : [`${candidate.candidateId}/${job.run.scenarioId}: worker was not fresh`]),
      ...(job.run.incrementalRssBytes === job.resources.incrementalRssBytes
        ? []
        : [`${candidate.candidateId}/${job.run.scenarioId}: RSS evidence mismatch`]),
      ...((job.run.status === 'success') === (job.failure === null)
        ? []
        : [`${candidate.candidateId}/${job.run.scenarioId}: status/failure mismatch`]),
      ...(job.run.status !== 'success' || job.resources.ingestedEventCount === FROZEN_100K_STORED_RECORDS
        ? []
        : [`${candidate.candidateId}/${job.run.scenarioId}: ingested record evidence mismatch`]),
      ...(job.run.status !== 'success' ||
      job.resources.retrievalCount === FROZEN_100K_WARMUPS + FROZEN_100K_MEASURED_RETRIEVALS
        ? []
        : [`${candidate.candidateId}/${job.run.scenarioId}: retrieval evidence mismatch`]),
      ...(job.run.status !== 'success' || job.run.absoluteProcessPeakRssBytes > 0
        ? []
        : [`${candidate.candidateId}/${job.run.scenarioId}: absolute peak RSS diagnostic is missing`]),
    ])
    .concat(
      sameJson(scenarioIds, FROZEN_100K_SCENARIO_IDS)
        ? []
        : [`${candidate.candidateId}: frozen storage scenario order mismatch`],
    )
}

const candidateErrors = (candidate: CandidateStorageReport): readonly string[] => {
  const expectedDecision = evaluateStorageDecision(candidate.jobs.map(({ run }) => run))
  return [
    ...(candidate.candidateVersion === candidateVersions[candidate.candidateId]
      ? []
      : [`${candidate.candidateId}: candidate version mismatch`]),
    ...jobErrors(candidate),
    ...(canonicalSerialize(candidate.decision) === canonicalSerialize(expectedDecision)
      ? []
      : [`${candidate.candidateId}: storage decision mismatch`]),
  ]
}

export const validateFrozenStorageReport = (input: unknown): FrozenStorageReport => {
  const report = FrozenStorageReportSchema.parse(input)
  const workerPids = report.candidates.flatMap(({ jobs }) => jobs.map(({ workerPid }) => workerPid))
  const errors = [
    ...(report.scenarioManifestSha256 === FROZEN_SCENARIO_MANIFEST.scenarioManifestSha256
      ? []
      : ['storage report corpus digest mismatch']),
    ...(report.workerDeadlineMs >= report.queryTimeoutMs
      ? []
      : ['storage worker deadline must cover the query timeout']),
    ...(Date.parse(report.completedAt) >= Date.parse(report.startedAt)
      ? []
      : ['storage report timestamps are reversed']),
    ...(implementationDigest(report.sourceFiles) === report.implementationSha256
      ? []
      : ['storage report implementation SHA-256 mismatch']),
    ...sourceInventoryErrors(report.sourceInventory, report.sourceFiles).map((error) => `storage report ${error}`),
    ...(sameJson(
      report.candidates.map(({ candidateId }) => candidateId),
      registeredCandidateIds,
    )
      ? []
      : ['storage report must contain every registered candidate in canonical order']),
    ...(new Set(workerPids).size === workerPids.length ? [] : ['storage jobs must use unique worker identities']),
    ...report.candidates.flatMap(candidateErrors),
    ...report.candidates.flatMap((candidate) =>
      candidate.implementationSha256 === report.implementationSha256
        ? []
        : [`${candidate.candidateId}: candidate implementation SHA-256 mismatch`],
    ),
  ]
  if (errors.length > 0) throw new Error(`Invalid frozen storage report: ${errors.join('; ')}`)
  return report
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

export const stableStorageReportJson = (input: unknown): string =>
  `${JSON.stringify(canonicalizeKeys(validateFrozenStorageReport(input)), null, 2)}\n`
