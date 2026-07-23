// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { memoryScenarios } from '../../scripts/memory-research/corpus.js'
import {
  discoverResearchSourcePaths,
  FROZEN_RESEARCH_SOURCE_PATHS_SHA256,
  implementationDigest,
  sourcePathInventoryDigest,
  validateResearchReport,
} from '../../scripts/memory-research/report.js'
import type { RuntimeMetadata } from '../../scripts/memory-research/runner-metadata.js'
import { executeScenarioJob, runResearchExperiment } from '../../scripts/memory-research/runner.js'

const revision = 'eab9ed2b4e2dac0279d338436b59c3a89d87bc8a'

const metadata = (repositoryRevision = revision): RuntimeMetadata => ({
  repository: { revision: repositoryRevision, dirty: true },
  runtime: { bunVersion: Bun.version, os: process.platform, arch: process.arch },
  hardware: { cpuModel: 'fixture-cpu', cpuCount: 1, totalMemoryBytes: 1_000_000 },
})

const scenario = memoryScenarios.find(({ labels, split }) => split === 'development' && labels.includes('direct-fact'))!

const experimentOptions = (workspaceRoot: string) =>
  ({
    split: 'development',
    candidateIds: ['corrected-hybrid'],
    scale: 1000,
    seed: 20_260_723,
    workspaceRoot,
    queryTimeoutMs: 1000,
    workerDeadlineMs: 10_000,
    scenarioIds: [scenario.scenarioId],
  }) as const

describe('research source inventory', () => {
  test('covers the lockfile and refuses to certify an arbitrary source subset', async () => {
    const discovered = await discoverResearchSourcePaths(process.cwd())
    expect(discovered).toContain('bun.lock')
    expect(sourcePathInventoryDigest(discovered)).toBe(FROZEN_RESEARCH_SOURCE_PATHS_SHA256)

    const report = await runResearchExperiment(experimentOptions(process.cwd()), {
      sourcePaths: ['scripts/memory-research/types.ts'],
      runtimeMetadata: metadata(),
      executeJob: executeScenarioJob,
    })
    const sourceFiles = report.sourceFiles.filter(({ path }) => path === 'scripts/memory-research/types.ts')
    const implementationSha256 = implementationDigest(sourceFiles)
    const forged = {
      ...report,
      sourceFiles,
      implementationSha256,
      candidates: report.candidates.map((candidate) => ({
        ...candidate,
        registration: {
          ...candidate.registration,
          implementationSha256,
        },
      })),
    }

    expect(report.sourceFiles.some(({ path }) => path === 'bun.lock')).toBeTrue()
    expect(report.sourceInventory.scope).toBe('complete')
    expect(() => validateResearchReport(forged)).toThrow('source inventory')
  })

  test('rejects source changes made while candidate jobs are executing', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'papai-memory-source-drift-'))
    const sourcePath = join(workspaceRoot, 'source.ts')
    await Bun.write(sourcePath, 'export const frozen = true\n')

    await expect(
      runResearchExperiment(experimentOptions(workspaceRoot), {
        sourcePaths: ['source.ts'],
        runtimeMetadata: metadata(),
        executeJob: async (input) => {
          const result = await executeScenarioJob(input)
          await Bun.write(sourcePath, 'export const frozen = false\n')
          return result
        },
      }),
    ).rejects.toThrow('changed during')
  })

  test('rejects repository revision changes made while candidate jobs are executing', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'papai-memory-revision-drift-'))
    await Bun.write(join(workspaceRoot, 'source.ts'), 'export const frozen = true\n')
    const metadataReads = [metadata(revision), metadata('0'.repeat(40))]
    let readCount = 0

    await expect(
      runResearchExperiment(experimentOptions(workspaceRoot), {
        sourcePaths: ['source.ts'],
        readRuntimeMetadata: () => metadataReads[readCount++]!,
        executeJob: executeScenarioJob,
      }),
    ).rejects.toThrow('Repository revision changed')
  })
})
