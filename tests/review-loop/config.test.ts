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

  test('accepts optional per-agent timeoutMs overrides, undefined by default', () => {
    const parsed = ReviewLoopConfigSchema.parse({
      workDir: '.review-loop',
      reviewer: { model: 'm1', timeoutMs: 1_800_000 },
      fixer: { model: 'm2' },
      matcher: { model: 'm3' },
    })

    expect(parsed.reviewer.timeoutMs).toBe(1_800_000)
    expect(parsed.fixer.timeoutMs).toBeUndefined()
    expect(parsed.matcher.timeoutMs).toBeUndefined()
  })

  test('poolSize defaults to 3 when absent', () => {
    const parsed = ReviewLoopConfigSchema.parse({
      workDir: '.review-loop',
      reviewer: { model: 'm' },
      fixer: { model: 'm' },
      matcher: { model: 'm' },
    })
    expect(parsed.poolSize).toBe(3)
  })

  test('poolSize respects provided value', () => {
    const parsed = ReviewLoopConfigSchema.parse({
      workDir: '.review-loop',
      poolSize: 5,
      reviewer: { model: 'm' },
      fixer: { model: 'm' },
      matcher: { model: 'm' },
    })
    expect(parsed.poolSize).toBe(5)
  })

  test('accepts an optional pricing table', () => {
    const parsed = ReviewLoopConfigSchema.parse({
      workDir: '.review-loop',
      reviewer: { model: 'm1' },
      fixer: { model: 'm2' },
      matcher: { model: 'm3' },
      pricing: { 'm-*': { input: 3, output: 15 } },
    })
    expect(parsed.pricing).toEqual({ 'm-*': { input: 3, output: 15 } })
  })

  test('pricing is undefined when omitted', () => {
    const parsed = ReviewLoopConfigSchema.parse({
      workDir: '.review-loop',
      reviewer: { model: 'm1' },
      fixer: { model: 'm2' },
      matcher: { model: 'm3' },
    })
    expect(parsed.pricing).toBeUndefined()
  })

  test('accepts an optional commit author, absent by default', () => {
    const withAuthor = ReviewLoopConfigSchema.parse({
      workDir: '.review-loop',
      reviewer: { model: 'm1' },
      fixer: { model: 'm2' },
      matcher: { model: 'm3' },
      commitAuthor: { name: 'opencode-agent[bot]', email: 'agent@users.noreply.github.com' },
    })
    const without = ReviewLoopConfigSchema.parse({
      workDir: '.review-loop',
      reviewer: { model: 'm1' },
      fixer: { model: 'm2' },
      matcher: { model: 'm3' },
    })

    expect(withAuthor.commitAuthor).toEqual({ name: 'opencode-agent[bot]', email: 'agent@users.noreply.github.com' })
    expect(without.commitAuthor).toBeUndefined()
  })

  test('rejects a commit author missing half of itself', () => {
    expect(() =>
      ReviewLoopConfigSchema.parse({
        workDir: '.review-loop',
        reviewer: { model: 'm1' },
        fixer: { model: 'm2' },
        matcher: { model: 'm3' },
        commitAuthor: { name: 'opencode-agent[bot]' },
      }),
    ).toThrow()
  })

  test('runTimeoutMs defaults to 0, which is no budget at all', () => {
    const parsed = ReviewLoopConfigSchema.parse({
      workDir: '.review-loop',
      reviewer: { model: 'm1' },
      fixer: { model: 'm2' },
      matcher: { model: 'm3' },
    })
    expect(parsed.runTimeoutMs).toBe(0)
  })

  test('accepts a run budget the loop stops itself at', () => {
    const parsed = ReviewLoopConfigSchema.parse({
      workDir: '.review-loop',
      reviewer: { model: 'm1' },
      fixer: { model: 'm2' },
      matcher: { model: 'm3' },
      runTimeoutMs: 5_400_000,
    })
    expect(parsed.runTimeoutMs).toBe(5_400_000)
  })

  test('rejects a malformed pricing entry', () => {
    expect(() =>
      ReviewLoopConfigSchema.parse({
        workDir: '.review-loop',
        reviewer: { model: 'm1' },
        fixer: { model: 'm2' },
        matcher: { model: 'm3' },
        pricing: { 'm-*': { input: 'x' } },
      }),
    ).toThrow()
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
