// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import path from 'node:path'

import { loadReviewLoopConfig, ReviewLoopConfigSchema } from '../../review-loop/src/config.js'
import { cleanupTempDirs, makeTempDir } from './test-helpers.js'

afterEach(cleanupTempDirs)

describe('ReviewLoopConfigSchema', () => {
  test('parses a valid config with defaults', () => {
    const parsed = ReviewLoopConfigSchema.parse({
      workDir: '.review-loop',
      reviewer: { model: 'm1' },
      fixer: { model: 'm2' },
      matcher: { model: 'm3' },
    })

    expect(parsed.maxRounds).toBe(10)
    expect(parsed.maxNoProgressRounds).toBe(2)
    expect(parsed.agentTimeoutMs).toBe(600_000)
    expect(parsed.buildTimeoutMs).toBe(600_000)
    expect(parsed.checkCommand).toBe('bun check:full')
    expect(parsed.reviewer.extraArgs).toEqual([])
  })

  test('accepts custom timeout values including zero to disable', () => {
    const parsed = ReviewLoopConfigSchema.parse({
      workDir: '.review-loop',
      agentTimeoutMs: 0,
      buildTimeoutMs: 120_000,
      reviewer: { model: 'm1' },
      fixer: { model: 'm2' },
      matcher: { model: 'm3' },
    })

    expect(parsed.agentTimeoutMs).toBe(0)
    expect(parsed.buildTimeoutMs).toBe(120_000)
  })

  test('accepts an optional repoRoot field', () => {
    const parsed = ReviewLoopConfigSchema.parse({
      repoRoot: '/some/repo',
      workDir: '.review-loop',
      reviewer: { model: 'm1' },
      fixer: { model: 'm2' },
      matcher: { model: 'm3' },
    })

    expect(parsed.repoRoot).toBe('/some/repo')
  })
})

function writeConfig(dir: string, config: Record<string, unknown>): string {
  const configPath = path.join(dir, 'config.json')
  writeFileSync(configPath, JSON.stringify(config))
  return configPath
}

function baseConfig(): Record<string, unknown> {
  return {
    workDir: '.review-loop',
    reviewer: { model: 'm1', extraArgs: [] },
    fixer: { model: 'm2', extraArgs: [] },
    matcher: { model: 'm3', extraArgs: [] },
  }
}

describe('loadReviewLoopConfig repoRoot resolution', () => {
  test('honors repoRoot written in the config file', async () => {
    const dir = makeTempDir('config-reporoot-')
    const repoRoot = makeTempDir('config-reporoot-repo-')
    const configPath = writeConfig(dir, { ...baseConfig(), repoRoot })

    const config = await loadReviewLoopConfig({ configPath })

    expect(config.repoRoot).toBe(path.resolve(repoRoot))
  })

  test('CLI repoRoot override takes precedence over config repoRoot', async () => {
    const dir = makeTempDir('config-cli-override-')
    const configRepoRoot = makeTempDir('config-cli-override-cfg-')
    const cliRepoRoot = makeTempDir('config-cli-override-cli-')
    const configPath = writeConfig(dir, { ...baseConfig(), repoRoot: configRepoRoot })

    const config = await loadReviewLoopConfig({ configPath, repoRoot: cliRepoRoot })

    expect(config.repoRoot).toBe(path.resolve(cliRepoRoot))
  })
})
