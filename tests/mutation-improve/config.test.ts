// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { MutationImproveConfigSchema, loadMutationImproveConfig } from '../../mutation-improve/src/config.js'
import { cleanupTempDirs, makeTempDir } from './test-helpers.js'

afterEach(cleanupTempDirs)

const minimalValid = {
  workDir: '.mutation-improve',
  agent: { model: 'opencode/claude-sonnet-4-6', extraArgs: [] },
}

describe('config', () => {
  test('MutationImproveConfigSchema applies defaults', () => {
    const parsed = MutationImproveConfigSchema.parse(minimalValid)
    expect(parsed.base).toBe('master')
    expect(parsed.upstream).toBe('origin')
    expect(parsed.count).toBe(1)
    expect(parsed.threshold).toBe(0.95)
    expect(parsed.epsilon).toBe(0.02)
    expect(parsed.checkCommand).toBe('CI=true bun check:full')
    expect(parsed.mutateFileCommand).toBe('bun test:mutate:file')
    expect(parsed.prBranchPrefix).toBe('mutation-improve')
    expect(parsed.agent.timeoutMs).toBe(1_800_000)
    expect(parsed.mutateTimeoutMs).toBe(1_800_000)
    expect(parsed.buildTimeoutMs).toBe(1_800_000)
    expect(parsed.buildFixAttempts).toBe(2)
  })

  test('MutationImproveConfigSchema honors an explicit buildFixAttempts and rejects negatives', () => {
    expect(MutationImproveConfigSchema.parse({ ...minimalValid, buildFixAttempts: 0 }).buildFixAttempts).toBe(0)
    expect(MutationImproveConfigSchema.parse({ ...minimalValid, buildFixAttempts: 5 }).buildFixAttempts).toBe(5)
    expect(() => MutationImproveConfigSchema.parse({ ...minimalValid, buildFixAttempts: -1 })).toThrow()
  })

  test('MutationImproveConfigSchema strips the legacy agentTimeoutMs key', () => {
    const parsed = MutationImproveConfigSchema.parse({ ...minimalValid, agentTimeoutMs: 5 })
    expect(parsed.mutateTimeoutMs).toBe(1_800_000)
    expect('agentTimeoutMs' in parsed).toBe(false)
  })

  test('MutationImproveConfigSchema rejects threshold out of [0,1]', () => {
    expect(() => MutationImproveConfigSchema.parse({ ...minimalValid, threshold: 1.5 })).toThrow()
    expect(() => MutationImproveConfigSchema.parse({ ...minimalValid, threshold: -0.1 })).toThrow()
  })

  test('MutationImproveConfigSchema accepts an optional pricing table', () => {
    const parsed = MutationImproveConfigSchema.parse({
      ...minimalValid,
      pricing: { 'm-*': { input: 3, output: 15 } },
    })
    expect(parsed.pricing).toEqual({ 'm-*': { input: 3, output: 15 } })
  })

  test('MutationImproveConfigSchema pricing is undefined when omitted', () => {
    const parsed = MutationImproveConfigSchema.parse({ ...minimalValid })
    expect(parsed.pricing).toBeUndefined()
  })

  test('MutationImproveConfigSchema rejects a malformed pricing entry', () => {
    expect(() =>
      MutationImproveConfigSchema.parse({
        ...minimalValid,
        pricing: { 'm-*': { input: 'x' } },
      }),
    ).toThrow()
  })

  test('loadMutationImproveConfig resolves workDir against repoRoot and creates it', async () => {
    const repoRoot = makeTempDir('cfg-')
    const configPath = path.join(repoRoot, 'config.json')
    writeFileSync(configPath, JSON.stringify({ ...minimalValid, repoRoot }))
    const config = await loadMutationImproveConfig({ configPath })
    expect(config.repoRoot).toBe(repoRoot)
    expect(config.workDir).toBe(path.resolve(repoRoot, '.mutation-improve'))
  })

  test('loadMutationImproveConfig snaps a repoRoot subdirectory to the git toplevel', async () => {
    const gitRoot = makeTempDir('cfg-git-')
    const git = (args: readonly string[], cwd: string): string =>
      execFileSync('git', [...args], { cwd, encoding: 'utf8' })
    git(['init', '--quiet'], gitRoot)
    const subdir = path.join(gitRoot, 'mutation-improve')
    mkdirSync(subdir)
    const configPath = path.join(subdir, 'config.json')
    writeFileSync(configPath, JSON.stringify({ ...minimalValid, repoRoot: '.' }))
    const cwd = process.cwd()
    process.chdir(subdir)
    try {
      const config = await loadMutationImproveConfig({ configPath })
      expect(config.repoRoot).toBe(realpathSync(gitRoot))
      expect(config.workDir).toBe(path.join(realpathSync(gitRoot), '.mutation-improve'))
    } finally {
      process.chdir(cwd)
    }
  })
})
