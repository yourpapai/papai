// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { candidateVersions } from './candidate-registry.js'
import { memoryScenarios } from './corpus.js'
import { FROZEN_SCENARIO_MANIFEST, verifyScenarioManifest } from './manifest.js'
import { runSequentially } from './runner-sequential.js'
import { FROZEN_100K_SCENARIO_IDS, FROZEN_100K_SEED } from './statistics-storage.js'
import { StorageJobResultSchema } from './storage-contracts.js'
import type { StorageJobInput, StorageJobResult } from './storage-contracts.js'
import { runIsolatedFrozen100kStorageJob } from './storage-isolation.js'
import type { CandidateId, MemoryScenario } from './types.js'

export type CandidateStorageExperiment = Readonly<{
  candidateId: CandidateId
  jobs: readonly StorageJobResult[]
}>

export type FrozenStorageExperimentOptions = Readonly<{
  candidateIds: readonly CandidateId[]
  workspaceRoot: string
  seed: typeof FROZEN_100K_SEED
  queryTimeoutMs: number
  workerDeadlineMs: number
}>

export type FrozenStorageExperimentDependencies = Readonly<{
  executeJob?: (input: StorageJobInput) => Promise<StorageJobResult>
}>

const frozenScenarios = (): readonly MemoryScenario[] =>
  FROZEN_100K_SCENARIO_IDS.map((scenarioId) => {
    const scenario = memoryScenarios.find((candidate) => candidate.scenarioId === scenarioId)
    if (scenario === undefined) throw new Error(`Missing frozen 100k scenario: ${scenarioId}`)
    return scenario
  })

const validateFrozenCorpus = (): void => {
  const verification = verifyScenarioManifest(FROZEN_SCENARIO_MANIFEST, memoryScenarios)
  if (!verification.valid) {
    throw new Error(`Frozen corpus verification failed: ${verification.errors.join('; ')}`)
  }
}

const validateJobResult = (input: StorageJobInput, value: StorageJobResult): StorageJobResult => {
  const result = StorageJobResultSchema.parse(value)
  if (
    result.candidateId !== input.candidateId ||
    result.candidateVersion !== candidateVersions[input.candidateId] ||
    result.run.scenarioId !== input.scenario.scenarioId ||
    result.scenarioManifestVersion !== FROZEN_SCENARIO_MANIFEST.scenarioManifestVersion ||
    result.scenarioManifestSha256 !== FROZEN_SCENARIO_MANIFEST.scenarioManifestSha256 ||
    !result.run.freshWorker ||
    result.workerPid === process.pid ||
    result.run.incrementalRssBytes !== result.resources.incrementalRssBytes ||
    (result.run.status === 'success') !== (result.failure === null)
  ) {
    throw new Error('Frozen storage worker returned inconsistent identity or evidence')
  }
  return result
}

export const runFrozen100kStorageExperiment = (
  options: FrozenStorageExperimentOptions,
  dependencies: FrozenStorageExperimentDependencies = {},
): Promise<readonly CandidateStorageExperiment[]> => {
  validateFrozenCorpus()
  if (options.seed !== FROZEN_100K_SEED) {
    throw new Error(`Frozen storage seed must be ${String(FROZEN_100K_SEED)}`)
  }
  if (options.candidateIds.length === 0 || new Set(options.candidateIds).size !== options.candidateIds.length) {
    throw new Error('Frozen storage candidates must be nonempty and unique')
  }
  const scenarios = frozenScenarios()
  const executeJob =
    dependencies.executeJob ??
    ((input: StorageJobInput): Promise<StorageJobResult> =>
      runIsolatedFrozen100kStorageJob(input, {
        workspaceRoot: options.workspaceRoot,
        deadlineMs: options.workerDeadlineMs,
      }))
  return runSequentially(
    options.candidateIds,
    async (candidateId): Promise<CandidateStorageExperiment> => ({
      candidateId,
      jobs: await runSequentially(scenarios, async (scenario): Promise<StorageJobResult> => {
        const input = {
          candidateId,
          scenario,
          scenarioManifestVersion: FROZEN_SCENARIO_MANIFEST.scenarioManifestVersion,
          scenarioManifestSha256: FROZEN_SCENARIO_MANIFEST.scenarioManifestSha256,
          seed: options.seed,
          queryTimeoutMs: options.queryTimeoutMs,
        } as const
        return validateJobResult(input, await executeJob(input))
      }),
    }),
  )
}
