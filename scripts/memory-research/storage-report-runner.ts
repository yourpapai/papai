// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { candidateVersions, registeredCandidateIds } from './candidate-registry.js'
import { FROZEN_SCENARIO_MANIFEST } from './manifest.js'
import { hashResearchSourceFiles, resolveResearchSourcePaths } from './report.js'
import { readRuntimeMetadata } from './runner-metadata.js'
import type { RuntimeMetadata } from './runner-metadata.js'
import {
  evaluateStorageDecision,
  FROZEN_100K_MEASURED_RETRIEVALS,
  FROZEN_100K_SEED,
  FROZEN_100K_STORED_RECORDS,
  FROZEN_100K_WARMUPS,
} from './statistics-storage.js'
import { runFrozen100kStorageExperiment } from './storage-experiment.js'
import type { CandidateStorageExperiment } from './storage-experiment.js'
import { STORAGE_REPORT_SCHEMA_VERSION } from './storage-report-schema.js'
import type { FrozenStorageReport } from './storage-report-schema.js'
import { validateFrozenStorageReport } from './storage-report-validation.js'

export type FrozenStorageReportOptions = Readonly<{
  workspaceRoot: string
  seed: typeof FROZEN_100K_SEED
  queryTimeoutMs: number
  workerDeadlineMs: number
}>

export type FrozenStorageReportDependencies = Readonly<{
  executeExperiment?: () => Promise<readonly CandidateStorageExperiment[]>
  runtimeMetadata?: RuntimeMetadata
  sourcePaths?: readonly string[]
  now?: () => Date
}>

const readExecutionIdentity = async (
  options: FrozenStorageReportOptions,
  dependencies: FrozenStorageReportDependencies,
  sourcePaths: readonly string[],
): Promise<
  Readonly<{
    sourceIdentity: Awaited<ReturnType<typeof hashResearchSourceFiles>>
    metadata: RuntimeMetadata
  }>
> => {
  return {
    sourceIdentity: await hashResearchSourceFiles(options.workspaceRoot, sourcePaths),
    metadata: dependencies.runtimeMetadata ?? readRuntimeMetadata(options.workspaceRoot),
  }
}

const assertStableExecutionIdentity = (
  before: Awaited<ReturnType<typeof readExecutionIdentity>>,
  after: Awaited<ReturnType<typeof readExecutionIdentity>>,
): void => {
  const sourcesUnchanged =
    before.sourceIdentity.implementationSha256 === after.sourceIdentity.implementationSha256 &&
    JSON.stringify(before.sourceIdentity.files) === JSON.stringify(after.sourceIdentity.files)
  if (!sourcesUnchanged) throw new Error('Research sources changed during the frozen storage experiment')
  if (before.metadata.repository.revision !== after.metadata.repository.revision) {
    throw new Error('Repository revision changed during the frozen storage experiment')
  }
}

export const runFrozenStorageReport = async (
  options: FrozenStorageReportOptions,
  dependencies: FrozenStorageReportDependencies = {},
): Promise<FrozenStorageReport> => {
  const now = dependencies.now ?? ((): Date => new Date())
  const startedAt = now().toISOString()
  const sourcePaths = await resolveResearchSourcePaths(options.workspaceRoot, dependencies.sourcePaths)
  const identity = await readExecutionIdentity(options, dependencies, sourcePaths)
  const experiments =
    dependencies.executeExperiment === undefined
      ? await runFrozen100kStorageExperiment({
          candidateIds: registeredCandidateIds,
          workspaceRoot: options.workspaceRoot,
          seed: options.seed,
          queryTimeoutMs: options.queryTimeoutMs,
          workerDeadlineMs: options.workerDeadlineMs,
        })
      : await dependencies.executeExperiment()
  const completedIdentity = await readExecutionIdentity(options, dependencies, sourcePaths)
  assertStableExecutionIdentity(identity, completedIdentity)
  const completedAt = now().toISOString()
  return validateFrozenStorageReport({
    schemaVersion: STORAGE_REPORT_SCHEMA_VERSION,
    scenarioManifestVersion: FROZEN_SCENARIO_MANIFEST.scenarioManifestVersion,
    scenarioManifestSha256: FROZEN_SCENARIO_MANIFEST.scenarioManifestSha256,
    seed: options.seed,
    scale: FROZEN_100K_STORED_RECORDS,
    warmupCount: FROZEN_100K_WARMUPS,
    measuredRetrievalCount: FROZEN_100K_MEASURED_RETRIEVALS,
    queryTimeoutMs: options.queryTimeoutMs,
    workerDeadlineMs: options.workerDeadlineMs,
    startedAt,
    completedAt,
    metadata: identity.metadata,
    sourceInventory: identity.sourceIdentity.inventory,
    sourceFiles: identity.sourceIdentity.files,
    implementationSha256: identity.sourceIdentity.implementationSha256,
    candidates: experiments.map(({ candidateId, jobs }) => ({
      candidateId,
      candidateVersion: candidateVersions[candidateId],
      implementationSha256: identity.sourceIdentity.implementationSha256,
      jobs,
      decision: evaluateStorageDecision(jobs.map(({ run }) => run)),
    })),
  })
}
