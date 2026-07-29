// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { candidateVersions, registeredCandidateIds } from '../../scripts/memory-research/candidate-registry.js'
import { FROZEN_SCENARIO_MANIFEST } from '../../scripts/memory-research/manifest.js'
import type { RuntimeMetadata } from '../../scripts/memory-research/runner-metadata.js'
import {
  FROZEN_100K_MEASURED_RETRIEVALS,
  FROZEN_100K_SCENARIO_IDS,
  FROZEN_100K_SEED,
  FROZEN_100K_STORED_RECORDS,
  FROZEN_100K_WARMUPS,
} from '../../scripts/memory-research/statistics-storage.js'
import {
  parseStorageResearchArgs,
  releaseFrozenStorageOutputReservation,
  reserveFrozenStorageOutput,
  writeFrozenStorageOutput,
} from '../../scripts/memory-research/storage-cli.js'
import type { CandidateStorageExperiment } from '../../scripts/memory-research/storage-experiment.js'
import { runStorageResearchCli } from '../../scripts/memory-research/storage-index.js'
import { runFrozenStorageReport } from '../../scripts/memory-research/storage-report-runner.js'
import { stableStorageReportJson, validateFrozenStorageReport } from '../../scripts/memory-research/storage-report.js'

const runtimeMetadata: RuntimeMetadata = {
  repository: { revision: 'eab9ed2b4e2dac0279d338436b59c3a89d87bc8a', dirty: true },
  runtime: { bunVersion: Bun.version, os: process.platform, arch: process.arch },
  hardware: { cpuModel: 'test-cpu', cpuCount: 1, totalMemoryBytes: 1_000_000 },
}

const experiments = (): readonly CandidateStorageExperiment[] =>
  registeredCandidateIds.map((candidateId, candidateIndex) => ({
    candidateId,
    jobs: FROZEN_100K_SCENARIO_IDS.map((scenarioId, scenarioIndex) => ({
      candidateId,
      candidateVersion: candidateVersions[candidateId],
      workerPid: process.pid + 1 + candidateIndex * FROZEN_100K_SCENARIO_IDS.length + scenarioIndex,
      scenarioManifestVersion: FROZEN_SCENARIO_MANIFEST.scenarioManifestVersion,
      scenarioManifestSha256: FROZEN_SCENARIO_MANIFEST.scenarioManifestSha256,
      run: {
        scenarioId,
        status: 'success',
        freshWorker: true,
        fixturesMaterializedBeforeReset: true,
        primaryScopeStoredRecordCount: FROZEN_100K_STORED_RECORDS,
        recordsOutsidePrimaryScope: 0,
        warmupCount: FROZEN_100K_WARMUPS,
        measuredLatenciesMs: Array.from({ length: FROZEN_100K_MEASURED_RETRIEVALS }, () => 10),
        incrementalRssBytes: 2_000_000,
        absoluteProcessPeakRssBytes: 3_000_000,
        rssCapture: 'current-pre-serialization',
      },
      resources: {
        ingestedEventCount: FROZEN_100K_STORED_RECORDS,
        ingestDurationMs: 100,
        ingestThroughputPerSecond: 1_000_000,
        retrievalCount: FROZEN_100K_WARMUPS + FROZEN_100K_MEASURED_RETRIEVALS,
        modelCallCount: 0,
        extractorCallCount: 0,
        storedBytes: 1_000_000,
        incrementalRssBytes: 2_000_000,
      },
      failure: null,
    })),
  }))

const clock = (): (() => Date) => {
  const values = [new Date('2026-07-23T00:00:00.000Z'), new Date('2026-07-23T00:01:00.000Z')]
  let index = 0
  return (): Date => values[index++] ?? values[values.length - 1]!
}

describe('frozen storage report', () => {
  test('binds source identity, environment, four candidates, and recomputed storage decisions', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'papai-storage-report-'))
    await Bun.write(join(workspaceRoot, 'source.ts'), 'export const frozen = true\n')
    const report = await runFrozenStorageReport(
      {
        workspaceRoot,
        seed: FROZEN_100K_SEED,
        queryTimeoutMs: 5000,
        workerDeadlineMs: 180_000,
      },
      {
        executeExperiment: () => Promise.resolve(experiments()),
        runtimeMetadata,
        sourcePaths: ['source.ts'],
        now: clock(),
      },
    )

    expect(report.candidates).toHaveLength(4)
    expect(report.candidates.every(({ decision }) => decision.status === 'decided')).toBeTrue()
    expect(validateFrozenStorageReport(JSON.parse(stableStorageReportJson(report)))).toEqual(report)
    const output = join(workspaceRoot, 'storage.json')
    expect(await writeFrozenStorageOutput(report, output)).toBe(output)
    await expect(writeFrozenStorageOutput(report, output)).rejects.toThrow('Refusing to overwrite')
  })

  test('rejects forged decisions, source identity, and candidate ordering', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'papai-storage-report-'))
    await Bun.write(join(workspaceRoot, 'source.ts'), 'export const frozen = true\n')
    const report = await runFrozenStorageReport(
      {
        workspaceRoot,
        seed: FROZEN_100K_SEED,
        queryTimeoutMs: 5000,
        workerDeadlineMs: 180_000,
      },
      {
        executeExperiment: () => Promise.resolve(experiments()),
        runtimeMetadata,
        sourcePaths: ['source.ts'],
        now: clock(),
      },
    )
    const first = report.candidates[0]!

    expect(() =>
      validateFrozenStorageReport({
        ...report,
        candidates: [{ ...first, decision: { status: 'blocked', errors: ['forged'] } }, ...report.candidates.slice(1)],
      }),
    ).toThrow('decision mismatch')
    expect(() => validateFrozenStorageReport({ ...report, implementationSha256: '0'.repeat(64) })).toThrow(
      'implementation SHA-256',
    )
    expect(() => validateFrozenStorageReport({ ...report, candidates: [...report.candidates].reverse() })).toThrow(
      'canonical order',
    )
    const firstJob = first.jobs[0]!
    expect(() =>
      validateFrozenStorageReport({
        ...report,
        candidates: [
          {
            ...first,
            jobs: [
              {
                ...firstJob,
                resources: { ...firstJob.resources, retrievalCount: 0 },
              },
              ...first.jobs.slice(1),
            ],
          },
          ...report.candidates.slice(1),
        ],
      }),
    ).toThrow('retrieval evidence mismatch')
    const secondCandidate = report.candidates[1]!
    const secondJob = secondCandidate.jobs[0]!
    expect(() =>
      validateFrozenStorageReport({
        ...report,
        candidates: [
          first,
          {
            ...secondCandidate,
            jobs: [{ ...secondJob, workerPid: firstJob.workerPid }, ...secondCandidate.jobs.slice(1)],
          },
          ...report.candidates.slice(2),
        ],
      }),
    ).toThrow('unique worker identities')
  })

  test('rejects source changes during the frozen experiment', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'papai-storage-report-'))
    const sourcePath = join(workspaceRoot, 'source.ts')
    await Bun.write(sourcePath, 'export const frozen = true\n')

    await expect(
      runFrozenStorageReport(
        {
          workspaceRoot,
          seed: FROZEN_100K_SEED,
          queryTimeoutMs: 5000,
          workerDeadlineMs: 180_000,
        },
        {
          executeExperiment: async () => {
            await Bun.write(sourcePath, 'export const frozen = false\n')
            return experiments()
          },
          runtimeMetadata,
          sourcePaths: ['source.ts'],
          now: clock(),
        },
      ),
    ).rejects.toThrow('changed during')
  })

  test('reserves frozen output before executing and publishes without overwrite', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'papai-storage-report-'))
    const output = join(workspaceRoot, 'storage.json')
    const reservation = await reserveFrozenStorageOutput(output)
    await expect(reserveFrozenStorageOutput(output)).rejects.toThrow('already reserved')
    await releaseFrozenStorageOutputReservation(reservation)

    await Bun.write(output, '{}\n')
    let executions = 0
    await expect(
      runStorageResearchCli(['--output', output], {
        runReport: () => {
          executions += 1
          return Promise.reject(new Error('must not execute'))
        },
        writeStdout: () => undefined,
      }),
    ).rejects.toThrow('Refusing to overwrite')
    expect(executions).toBe(0)
  })

  test('parses only the complete frozen candidate set, seed, and bounded deadlines', () => {
    expect(
      parseStorageResearchArgs([
        '--candidate',
        'all',
        '--seed',
        String(FROZEN_100K_SEED),
        '--query-timeout-ms',
        '5000',
        '--worker-deadline-ms',
        '180000',
        '--output',
        'storage.json',
      ]),
    ).toEqual({
      seed: FROZEN_100K_SEED,
      queryTimeoutMs: 5000,
      workerDeadlineMs: 180_000,
      output: 'storage.json',
    })
    expect(() => parseStorageResearchArgs(['--candidate', 'as-shipped'])).toThrow('--candidate all')
    expect(() => parseStorageResearchArgs(['--seed', '1'])).toThrow('Frozen storage seed')
    expect(() => parseStorageResearchArgs(['--query-timeout-ms', '5000', '--worker-deadline-ms', '4999'])).toThrow(
      'cover',
    )
  })
})
