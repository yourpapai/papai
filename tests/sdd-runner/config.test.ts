// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { deriveChangeName, discoverBranch, loadRunnerConfig, modelFor } from '../../sdd-runner/src/config.js'

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-config-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

function writeConfig(dir: string, config: unknown): string {
  const configPath = path.join(dir, 'config.json')
  fs.writeFileSync(configPath, JSON.stringify(config))
  return configPath
}

describe('loadRunnerConfig', () => {
  it('loads a full config and resolves workDir against the repo root', async () => {
    const dir = makeDir()
    const configPath = writeConfig(dir, {
      repoRoot: dir,
      workDir: '.sdd-runner',
      model: 'anthropic/claude-opus-4-1',
      models: { estimator: 'openai/gpt-5' },
      timeouts: { wallClockMs: 900_000, inactivityMs: 300_000 },
      budgetUsd: 25,
    })
    const config = await loadRunnerConfig(configPath)
    expect(config.repoRoot).toBe(dir)
    expect(config.workDir).toBe(path.join(dir, '.sdd-runner'))
    expect(config.model).toBe('anthropic/claude-opus-4-1')
    expect(config.models).toEqual({ estimator: 'openai/gpt-5' })
    expect(config.timeouts).toEqual({ wallClockMs: 900_000, inactivityMs: 300_000 })
    expect(config.budgetUsd).toBe(25)
  })

  it('applies watchdog-precedent timeout defaults when omitted', async () => {
    const dir = makeDir()
    const configPath = writeConfig(dir, { repoRoot: dir, model: 'test-model' })
    const config = await loadRunnerConfig(configPath)
    expect(config.timeouts.wallClockMs).toBe(1_800_000)
    expect(config.timeouts.inactivityMs).toBe(600_000)
    expect(config.workDir).toBe(path.join(dir, '.sdd-runner'))
    expect(config.budgetUsd).toBeUndefined()
  })

  it('rejects an invalid config naming the path', async () => {
    const dir = makeDir()
    const configPath = writeConfig(dir, { repoRoot: dir, model: 'test-model', timeouts: { wallClockMs: -5 } })
    await expect(loadRunnerConfig(configPath)).rejects.toThrow(/config\.json/u)
  })

  it('rejects a missing config file naming the path', async () => {
    const dir = makeDir()
    await expect(loadRunnerConfig(path.join(dir, 'absent.json'))).rejects.toThrow(/absent\.json/u)
  })
})

describe('modelFor', () => {
  it('returns the per-role override when present, else the default model', async () => {
    const dir = makeDir()
    const configPath = writeConfig(dir, { repoRoot: dir, model: 'default-model', models: { skeptic: 'skeptic-model' } })
    const config = await loadRunnerConfig(configPath)
    expect(modelFor(config, 'skeptic')).toBe('skeptic-model')
    expect(modelFor(config, 'reviewer')).toBe('default-model')
    expect(modelFor(config, 'resolver')).toBe('default-model')
  })
})

describe('deriveChangeName', () => {
  it('prefers the first markdown heading, kebab-cased', () => {
    expect(deriveChangeName('task.md', '# Add Dark Mode Toggle\n\nBody text')).toBe('add-dark-mode-toggle')
  })

  it('falls back to the task-file basename when no heading exists', () => {
    expect(deriveChangeName('fix-login-redirect.md', 'no heading here')).toBe('fix-login-redirect')
  })

  it('collapses punctuation and whitespace, strips the extension', () => {
    expect(deriveChangeName('My Task: refine (draft).md', 'plain body')).toBe('my-task-refine-draft')
  })

  it('rejects input that yields no usable name', () => {
    expect(() => deriveChangeName('.md', '!!!')).toThrow(/change name/u)
  })
})

describe('discoverBranch', () => {
  it('returns the current branch name from git', async () => {
    const exec = (): Promise<{ stdout: string; stderr: string }> =>
      Promise.resolve({ stdout: 'auto-sdd-pipeline\n', stderr: '' })
    await expect(discoverBranch(exec, '/repo')).resolves.toBe('auto-sdd-pipeline')
  })

  it('fails on detached HEAD with a named reason', async () => {
    const exec = (): Promise<{ stdout: string; stderr: string }> => Promise.resolve({ stdout: '\n', stderr: '' })
    await expect(discoverBranch(exec, '/repo')).rejects.toThrow(/detached|branch/u)
  })
})
