// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  parseMemoryResearchArgs,
  publishResearchOutputs,
  releaseResearchOutputReservation,
  reserveResearchOutputs,
  writeResearchOutputs,
} from '../../scripts/memory-research/cli.js'
import { memoryScenarios } from '../../scripts/memory-research/corpus.js'
import { runMemoryResearchCli } from '../../scripts/memory-research/index.js'
import type { ResearchReport } from '../../scripts/memory-research/report.js'
import { executeScenarioJob, runResearchExperiment } from '../../scripts/memory-research/runner.js'

const runtimeMetadata = {
  repository: {
    revision: 'eab9ed2b4e2dac0279d338436b59c3a89d87bc8a',
    dirty: true,
  },
  runtime: { bunVersion: Bun.version, os: process.platform, arch: process.arch },
  hardware: {
    cpuModel: 'test-cpu',
    cpuCount: 8,
    totalMemoryBytes: 16_000_000_000,
  },
} as const

const oneScenarioReport = (split: 'development' | 'sealed-test'): Promise<ResearchReport> => {
  const scenario = memoryScenarios.find((candidate) => candidate.split === split)!
  let clockTick = 0
  return runResearchExperiment(
    {
      split,
      candidateIds: ['corrected-hybrid'],
      scale: 1000,
      seed: 20260723,
      workspaceRoot: process.cwd(),
      queryTimeoutMs: 1000,
      workerDeadlineMs: 10_000,
      scenarioIds: [scenario.scenarioId],
    },
    {
      runtimeMetadata,
      sourcePaths: ['scripts/memory-research/types.ts'],
      now: (): Date => {
        const value = new Date(Date.UTC(2026, 6, 23, 10, clockTick))
        clockTick += 1
        return value
      },
      executeJob: executeScenarioJob,
    },
  )
}

describe('memory research CLI arguments', () => {
  test('provides sealed defaults and normalizes explicit development options', () => {
    expect(parseMemoryResearchArgs([])).toMatchObject({
      split: 'sealed-test',
      candidateIds: ['as-shipped', 'corrected-hybrid', 'hierarchical', 'temporal-graph'],
      scale: 1000,
      seed: 20260723,
      output: 'docs/research/agent-memory/raw/v3-20260723/sealed-1000/component.json',
      overwrite: false,
    })
    expect(
      parseMemoryResearchArgs([
        '--split',
        'dev',
        '--candidate',
        'hierarchical,corrected-hybrid',
        '--scale',
        '10000',
        '--seed',
        '7',
        '--output',
        '/tmp/memory.json',
        '--overwrite',
      ]),
    ).toMatchObject({
      split: 'development',
      candidateIds: ['hierarchical', 'corrected-hybrid'],
      scale: 10_000,
      seed: 7,
      output: '/tmp/memory.json',
      overwrite: true,
    })
    expect(parseMemoryResearchArgs(['--scale', '10000']).output).toBe(
      'docs/research/agent-memory/raw/v3-20260723/sealed-10000/component.json',
    )
    expect(parseMemoryResearchArgs(['--split', 'dev']).output).toBe(
      'docs/research/agent-memory/raw/v3-20260723/dev-1000/component.json',
    )
  })

  test('rejects unknown, duplicate, missing, and invalid arguments', () => {
    expect(() => parseMemoryResearchArgs(['--unknown'])).toThrow('Unknown argument')
    expect(() => parseMemoryResearchArgs(['--scale', '1000', '--scale', '10000'])).toThrow('Duplicate argument')
    expect(() => parseMemoryResearchArgs(['--output'])).toThrow('requires a value')
    expect(() => parseMemoryResearchArgs(['--candidate', 'unknown'])).toThrow('candidate')
    expect(() => parseMemoryResearchArgs(['--scale', '999'])).toThrow('scale')
    expect(() => parseMemoryResearchArgs(['--scale', '100000'])).toThrow('research:memory:storage')
    expect(() => parseMemoryResearchArgs(['--output', 'docs/research/agent-memory/04-results.json'])).toThrow(
      'publisher',
    )
    expect(() => parseMemoryResearchArgs(['--output', 'docs/research/agent-memory/04-results.md'])).toThrow('publisher')
    expect(() => parseMemoryResearchArgs(['--seed', '7'])).toThrow('--output')
    expect(() => parseMemoryResearchArgs(['--candidate', 'hierarchical'])).toThrow('--output')
  })
})

describe('atomic research output policy', () => {
  test('requires explicit development overwrite and never overwrites sealed output', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'papai-memory-cli-'))
    const developmentPath = join(temporaryRoot, 'development.json')
    const sealedPath = join(temporaryRoot, 'sealed.json')
    const development = await oneScenarioReport('development')
    const sealed = await oneScenarioReport('sealed-test')

    await writeResearchOutputs(development, developmentPath, false)
    expect(await Bun.file(developmentPath).exists()).toBeTrue()
    expect(await Bun.file(join(temporaryRoot, 'development.md')).exists()).toBeTrue()
    await expect(writeResearchOutputs(development, developmentPath, false)).rejects.toThrow('overwrite')
    await writeResearchOutputs(development, developmentPath, true)

    await writeResearchOutputs(sealed, sealedPath, false)
    await expect(writeResearchOutputs(sealed, sealedPath, true)).rejects.toThrow('sealed')
  }, 15_000)

  test('reserves sealed output before executing the experiment', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'papai-memory-cli-'))
    const sealedPath = join(temporaryRoot, 'sealed.json')
    await Bun.write(sealedPath, '{}\n')
    let executions = 0

    await expect(
      runMemoryResearchCli(['--output', sealedPath], {
        runExperiment: () => {
          executions += 1
          return Promise.reject(new Error('must not execute'))
        },
        writeStdout: () => undefined,
      }),
    ).rejects.toThrow('Refusing to overwrite')
    expect(executions).toBe(0)
  })

  test('reserves both paths and does not overwrite a development output created after preflight', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'papai-memory-cli-'))
    const sharedJsonPath = join(temporaryRoot, 'shared.json')
    const reservation = await reserveResearchOutputs(sharedJsonPath, 'development', false)
    try {
      await expect(reserveResearchOutputs(join(temporaryRoot, 'shared.md'), 'development', false)).rejects.toThrow(
        'reserved',
      )

      const report = await oneScenarioReport('development')
      await Bun.write(sharedJsonPath, 'external writer\n')
      await expect(publishResearchOutputs(report, reservation)).rejects.toThrow()
      expect(await Bun.file(sharedJsonPath).text()).toBe('external writer\n')
    } finally {
      await releaseResearchOutputReservation(reservation)
    }
  })
})
