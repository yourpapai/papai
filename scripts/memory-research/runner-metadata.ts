// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { cpus, totalmem } from 'node:os'

import { candidateVersions } from './candidate-registry.js'
import { combineScenarioFaultSchedule } from './frozen-run-contract.js'
import { FROZEN_SCENARIO_MANIFEST, RunManifestSchema } from './manifest.js'
import type { RunManifest } from './manifest.js'
import type { ScenarioSelection } from './report.js'
import type { CandidateId, MemoryScenario } from './types.js'

export type RepositoryMetadata = Readonly<{
  revision: string
  dirty: boolean
}>

export type RuntimeMetadata = Readonly<{
  repository: RepositoryMetadata
  runtime: RunManifest['runtime']
  hardware: RunManifest['hardware']
}>

const commandText = (workspaceRoot: string, args: readonly string[]): string => {
  const result = Bun.spawnSync({
    cmd: ['git', '-C', workspaceRoot, ...args],
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (result.exitCode !== 0) {
    const error = new TextDecoder().decode(result.stderr).trim()
    throw new Error(`Unable to read repository metadata: ${error}`)
  }
  return new TextDecoder().decode(result.stdout).trim()
}

export const readRuntimeMetadata = (workspaceRoot: string): RuntimeMetadata => {
  const cpuList = cpus()
  return {
    repository: {
      revision: commandText(workspaceRoot, ['rev-parse', 'HEAD']),
      dirty: commandText(workspaceRoot, ['status', '--porcelain']).length > 0,
    },
    runtime: {
      bunVersion: Bun.version,
      os: process.platform,
      arch: process.arch,
    },
    hardware: {
      cpuModel: cpuList[0]?.model ?? 'unknown-cpu',
      cpuCount: Math.max(1, cpuList.length),
      totalMemoryBytes: totalmem(),
    },
  }
}

export const createCandidateRunManifest = (
  candidateId: CandidateId,
  selection: ScenarioSelection,
  scenarios: readonly MemoryScenario[],
  scale: RunManifest['scale'],
  seed: number,
  timestamps: Readonly<{ startedAt: string; completedAt: string }>,
  metadata: RuntimeMetadata,
  executionConfig: Readonly<{ queryTimeoutMs: number; workerDeadlineMs: number }>,
): RunManifest =>
  RunManifestSchema.parse({
    runId: `memory-${candidateId}-${selection.split}-${scale}-${seed}`,
    scenarioManifestVersion: FROZEN_SCENARIO_MANIFEST.scenarioManifestVersion,
    scenarioManifestSha256: FROZEN_SCENARIO_MANIFEST.scenarioManifestSha256,
    deterministicEmbeddingVersion: 'papai-deterministic-bilingual-v1',
    deterministicEmbeddingDimension: 64,
    candidate: {
      id: candidateId,
      version: candidateVersions[candidateId],
      config: executionConfig,
    },
    split: selection.split,
    scale,
    seed,
    repository: metadata.repository,
    runtime: metadata.runtime,
    hardware: metadata.hardware,
    ...timestamps,
    faultConfiguration: combineScenarioFaultSchedule(scenarios),
  })
