// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { candidateVersions } from './candidate-registry.js'
import { memoryScenarios } from './corpus.js'
import type { ImportedPublicDataset } from './importer-types.js'
import { FROZEN_SCENARIO_MANIFEST, verifyScenarioManifest } from './manifest.js'
import type { RunManifest } from './manifest.js'
import {
  createScenarioSelection,
  hashResearchSourceFiles,
  resolveResearchSourcePaths,
  validateResearchReport,
} from './report.js'
import type { ResearchReport } from './report.js'
import { aggregateCandidateJobs } from './runner-aggregate.js'
import { ScenarioJobResultSchema } from './runner-contracts.js'
import type { ScenarioJobInput, ScenarioJobResult } from './runner-contracts.js'
import { runIsolatedScenarioJob } from './runner-isolation.js'
import { createCandidateRunManifest, readRuntimeMetadata } from './runner-metadata.js'
import type { RuntimeMetadata } from './runner-metadata.js'
import { runSequentially } from './runner-sequential.js'
import { selectScenarioSplit } from './runner-workload.js'
import type { CandidateId, MemoryScenario } from './types.js'

export type ResearchExperimentOptions = Readonly<{
  split: MemoryScenario['split']
  candidateIds: readonly CandidateId[]
  scale: RunManifest['scale']
  seed: number
  workspaceRoot: string
  queryTimeoutMs: number
  workerDeadlineMs: number
  scenarioIds?: readonly string[]
  publicDatasets?: readonly ImportedPublicDataset[]
  publicDatasetLocalPaths?: Readonly<Partial<Record<ImportedPublicDataset['datasetId'], string>>>
}>

export type ResearchExperimentDependencies = Readonly<{
  executeJob?: (input: ScenarioJobInput) => Promise<ScenarioJobResult>
  readRuntimeMetadata?: (workspaceRoot: string) => RuntimeMetadata
  runtimeMetadata?: RuntimeMetadata
  sourcePaths?: readonly string[]
  now?: () => Date
}>

type ResearchExecutionIdentity = Readonly<{
  sourceIdentity: Awaited<ReturnType<typeof hashResearchSourceFiles>>
  metadata: RuntimeMetadata
}>

const readExecutionIdentity = async (
  options: ResearchExperimentOptions,
  dependencies: ResearchExperimentDependencies,
  sourcePaths: readonly string[],
): Promise<ResearchExecutionIdentity> => ({
  sourceIdentity: await hashResearchSourceFiles(options.workspaceRoot, sourcePaths),
  metadata:
    dependencies.runtimeMetadata ?? (dependencies.readRuntimeMetadata ?? readRuntimeMetadata)(options.workspaceRoot),
})

const assertStableExecutionIdentity = (before: ResearchExecutionIdentity, after: ResearchExecutionIdentity): void => {
  const sourcesUnchanged =
    before.sourceIdentity.implementationSha256 === after.sourceIdentity.implementationSha256 &&
    JSON.stringify(before.sourceIdentity.files) === JSON.stringify(after.sourceIdentity.files)
  if (!sourcesUnchanged) throw new Error('Research sources changed during the component experiment')
  if (before.metadata.repository.revision !== after.metadata.repository.revision) {
    throw new Error('Repository revision changed during the component experiment')
  }
}

const requiredLocalPath = (
  datasetId: ImportedPublicDataset['datasetId'],
  localPaths: Readonly<Partial<Record<ImportedPublicDataset['datasetId'], string>>>,
): string => {
  const localPath = localPaths[datasetId]
  if (localPath === undefined) throw new Error(`Validated public dataset ${datasetId} requires its local path`)
  return localPath
}

const publicDatasetStatuses = (
  imported: readonly ImportedPublicDataset[],
  localPaths: Readonly<Partial<Record<ImportedPublicDataset['datasetId'], string>>>,
): ResearchReport['publicDatasets'] => {
  const byId = new Map(imported.map((dataset) => [dataset.datasetId, dataset] as const))
  if (byId.size !== imported.length) throw new Error('Public dataset imports must be unique by dataset ID')
  return (['longmemeval', 'locomo', 'memoryagentbench', 'membench'] as const).map((datasetId) => {
    const dataset = byId.get(datasetId)
    return dataset === undefined
      ? {
          datasetId,
          profile: null,
          sourceSha256: null,
          localPath: null,
          importStatus: 'not_supplied' as const,
          protocolStatus: 'not_run' as const,
          reason: 'Dataset was not supplied locally; no official reader/judge protocol ran.',
        }
      : {
          datasetId,
          profile: dataset.profile,
          sourceSha256: dataset.sourceSha256,
          localPath: requiredLocalPath(datasetId, localPaths),
          importStatus: 'validated' as const,
          protocolStatus: 'not_run' as const,
          reason: 'Local bytes validated; official reader/judge protocol was not executed.',
        }
  })
}

const selectedScenarioIds = (
  scenarios: readonly MemoryScenario[],
  requestedIds: readonly string[] | undefined,
): readonly MemoryScenario[] => {
  if (requestedIds === undefined) return scenarios
  const requested = new Set(requestedIds)
  if (requested.size !== requestedIds.length) throw new Error('Requested scenario IDs must be unique')
  const selected = scenarios.filter(({ scenarioId }) => requested.has(scenarioId))
  if (selected.length !== requested.size) throw new Error('Requested scenario ID is outside the selected split')
  return selected
}

const validateFrozenCorpus = (): void => {
  const verification = verifyScenarioManifest(FROZEN_SCENARIO_MANIFEST, memoryScenarios)
  if (!verification.valid) {
    throw new Error(`Frozen corpus verification failed: ${verification.errors.join('; ')}`)
  }
}

const validateJobIdentity = (input: ScenarioJobInput, result: ScenarioJobResult): ScenarioJobResult => {
  const parsed = ScenarioJobResultSchema.parse(result)
  if (parsed.candidateId !== input.candidateId || parsed.scenario.scenarioId !== input.scenario.scenarioId) {
    throw new Error('Isolated worker returned a mismatched candidate or scenario identity')
  }
  if (parsed.candidateVersion !== candidateVersions[input.candidateId]) {
    throw new Error('Isolated worker returned a mismatched candidate version')
  }
  return parsed
}

const runCandidateJobs = (
  candidateId: CandidateId,
  scenarios: readonly MemoryScenario[],
  options: ResearchExperimentOptions,
  executeJob: (input: ScenarioJobInput) => Promise<ScenarioJobResult>,
): Promise<readonly ScenarioJobResult[]> =>
  runSequentially(scenarios, async (scenario): Promise<ScenarioJobResult> => {
    const input = {
      candidateId,
      scenario,
      scale: options.scale,
      seed: options.seed,
      queryTimeoutMs: options.queryTimeoutMs,
    } as const
    return validateJobIdentity(input, await executeJob(input))
  })

type CandidateExecutionContext = Readonly<{
  options: ResearchExperimentOptions
  scenarios: readonly MemoryScenario[]
  selection: ReturnType<typeof createScenarioSelection>
  identity: ResearchExecutionIdentity
  now: () => Date
  executeJob: (input: ScenarioJobInput) => Promise<ScenarioJobResult>
}>

const runCandidateExperiment = async (
  candidateId: CandidateId,
  context: CandidateExecutionContext,
): Promise<ResearchReport['candidates'][number]> => {
  const { executeJob, identity, now, options, scenarios, selection } = context
  const startedAt = now().toISOString()
  const jobs = await runCandidateJobs(candidateId, scenarios, options, executeJob)
  const completedAt = now().toISOString()
  const manifest = createCandidateRunManifest(
    candidateId,
    selection,
    scenarios,
    options.scale,
    options.seed,
    { startedAt, completedAt },
    identity.metadata,
    {
      queryTimeoutMs: options.queryTimeoutMs,
      workerDeadlineMs: options.workerDeadlineMs,
    },
  )
  return aggregateCandidateJobs(
    candidateId,
    selection,
    manifest,
    jobs,
    identity.sourceIdentity.implementationSha256,
    identity.sourceIdentity.inventory.scope === 'complete',
  )
}

export const runResearchExperiment = async (
  options: ResearchExperimentOptions,
  dependencies: ResearchExperimentDependencies = {},
): Promise<ResearchReport> => {
  validateFrozenCorpus()
  const splitScenarios = selectScenarioSplit(memoryScenarios, options.split)
  const scenarios = selectedScenarioIds(splitScenarios, options.scenarioIds)
  const selection = createScenarioSelection('papai-synthetic-v3', options.split, scenarios)
  const sourcePaths = await resolveResearchSourcePaths(options.workspaceRoot, dependencies.sourcePaths)
  const identity = await readExecutionIdentity(options, dependencies, sourcePaths)
  const now = dependencies.now ?? ((): Date => new Date())
  const executeJob =
    dependencies.executeJob ??
    ((input: ScenarioJobInput): Promise<ScenarioJobResult> =>
      runIsolatedScenarioJob(input, {
        workspaceRoot: options.workspaceRoot,
        deadlineMs: options.workerDeadlineMs,
      }))
  const context = { options, scenarios, selection, identity, now, executeJob }
  const candidates = await runSequentially(options.candidateIds, (candidateId) =>
    runCandidateExperiment(candidateId, context),
  )
  const completedIdentity = await readExecutionIdentity(options, dependencies, sourcePaths)
  assertStableExecutionIdentity(identity, completedIdentity)
  return validateResearchReport({
    schemaVersion: 'memory-research-report-v1',
    selection,
    sourceInventory: identity.sourceIdentity.inventory,
    sourceFiles: identity.sourceIdentity.files,
    implementationSha256: identity.sourceIdentity.implementationSha256,
    candidates,
    publicDatasets: publicDatasetStatuses(options.publicDatasets ?? [], options.publicDatasetLocalPaths ?? {}),
  })
}
