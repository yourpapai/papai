// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  AgentRoleSchema,
  autonomyOf,
  deriveChangeName,
  discoverBranch,
  loadRunnerConfig,
  modelFor,
  PLAN_REPLAN_PASSES,
  RunnerConfigSchema,
  slugify,
} from '../../afk-runner/src/config.js'

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
      budget: 25,
      deadline: 30,
    })
    const config = await loadRunnerConfig(configPath)
    expect(config.repoRoot).toBe(dir)
    expect(config.workDir).toBe(path.join(dir, '.sdd-runner'))
    expect(config.model).toBe('anthropic/claude-opus-4-1')
    expect(config.budget).toBe(25)
    expect(config.deadline).toBe(30)
  })

  it('defaults workDir and budget when omitted', async () => {
    const dir = makeDir()
    const configPath = writeConfig(dir, { repoRoot: dir, model: 'test-model' })
    const config = await loadRunnerConfig(configPath)
    expect(config.workDir).toBe(path.join(dir, '.sdd-runner'))
    expect(config.budget).toBe(5)
    expect(config.deadline).toBeUndefined()
  })

  it('rejects an invalid config naming the path', async () => {
    const dir = makeDir()
    const configPath = writeConfig(dir, { repoRoot: dir, model: 'test-model', budget: -5 })
    await expect(loadRunnerConfig(configPath)).rejects.toThrow(/config\.json/u)
  })

  it('rejects a missing config file naming the path', async () => {
    const dir = makeDir()
    await expect(loadRunnerConfig(path.join(dir, 'absent.json'))).rejects.toThrow(/absent\.json/u)
  })
})

describe('autonomy derivation', () => {
  it('derives single-mode assist autonomy with budget as the one ceiling', async () => {
    const dir = makeDir()
    const configPath = writeConfig(dir, { repoRoot: dir, model: 'test-model', budget: 7 })
    const config = await loadRunnerConfig(configPath)
    expect(autonomyOf(config)).toEqual({ level: 'assist', costCeilingUsd: 7, metered: true })
  })

  it('deadline keys arm the wait; an explicit override wins', async () => {
    const dir = makeDir()
    const configPath = writeConfig(dir, { repoRoot: dir, model: 'test-model', deadline: 10 })
    const config = await loadRunnerConfig(configPath)
    expect(autonomyOf(config).deadlineMinutes).toBe(10)
    expect(autonomyOf(config, 25).deadlineMinutes).toBe(25)
  })
})

describe('unmetered budget semantics', () => {
  it('parses budget: null as unmetered — no ceiling, metered derived false', async () => {
    const dir = makeDir()
    const configPath = writeConfig(dir, { repoRoot: dir, model: 'test-model', budget: null })
    const config = await loadRunnerConfig(configPath)
    expect(config.budget).toBeNull()
    expect(autonomyOf(config)).toEqual({ level: 'assist', costCeilingUsd: null, metered: false })
  })

  it('an absent budget stays the default 5 and derives metered', async () => {
    const dir = makeDir()
    const configPath = writeConfig(dir, { repoRoot: dir, model: 'test-model' })
    const config = await loadRunnerConfig(configPath)
    expect(config.budget).toBe(5)
    expect(autonomyOf(config).metered).toBe(true)
  })

  it('an explicit metered flag overrides derivation in both directions', async () => {
    const dir = makeDir()
    const unmetered = await loadRunnerConfig(
      writeConfig(dir, { repoRoot: dir, model: 'test-model', budget: 7, metered: false }),
    )
    expect(unmetered.budget).toBe(7)
    expect(autonomyOf(unmetered)).toEqual({ level: 'assist', costCeilingUsd: 7, metered: false })
    const declaredMetered = await loadRunnerConfig(
      writeConfig(dir, { repoRoot: dir, model: 'test-model', budget: null, metered: true }),
    )
    expect(autonomyOf(declaredMetered)).toEqual({ level: 'assist', costCeilingUsd: null, metered: true })
  })
})

describe('modelFor', () => {
  it('the single model serves every role', async () => {
    const dir = makeDir()
    const configPath = writeConfig(dir, { repoRoot: dir, model: 'default-model' })
    const config = await loadRunnerConfig(configPath)
    expect(modelFor(config, 'skeptic')).toBe('default-model')
    expect(modelFor(config, 'reviewer')).toBe('default-model')
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

describe('slugify', () => {
  it('is the identical transform deriveChangeName applies to its slug', () => {
    const headingSlug = (title: string): string => deriveChangeName('task.md', `# ${title}`)
    expect(slugify('Add Dark Mode Toggle')).toBe(headingSlug('Add Dark Mode Toggle'))
    expect(slugify('My Task: refine (draft)')).toBe(headingSlug('My Task: refine (draft)'))
    expect(slugify('--dashes and PUNCTUATION!!')).toBe(headingSlug('--dashes and PUNCTUATION!!'))
    expect(slugify('b'.repeat(63) + '!!')).toBe(headingSlug('b'.repeat(63) + '!!'))
  })

  it('kebab-cases, trims separator runs, and caps length at 64', () => {
    expect(slugify('Add Dark Mode Toggle')).toBe('add-dark-mode-toggle')
    expect(slugify('--lead and trail--')).toBe('lead-and-trail')
    expect(slugify('a'.repeat(80))).toHaveLength(64)
  })
})

describe('AgentRoleSchema', () => {
  it("parses 'planner' alongside the existing roles", () => {
    expect(AgentRoleSchema.parse('planner')).toBe('planner')
    const existingRoles = [
      'drafter',
      'reviewer',
      'skeptic',
      'resolver',
      'estimator',
      'decomposer',
      'atomicity',
    ] as const
    for (const role of existingRoles) {
      expect(AgentRoleSchema.parse(role)).toBe(role)
    }
  })

  it('rejects an unknown role', () => {
    expect(AgentRoleSchema.safeParse('vibes').success).toBe(false)
  })
})

describe('PLAN_REPLAN_PASSES', () => {
  it('is exported with value 1 as a compiled constant', () => {
    expect(PLAN_REPLAN_PASSES).toBe(1)
  })
})

describe('RunnerConfigSchema (strict five keys)', () => {
  it('still rejects every key beyond the five', () => {
    const fiveKeys = { repoRoot: '/repo', workDir: '.sdd-runner', model: 'm', budget: 5, deadline: 30 }
    expect(RunnerConfigSchema.safeParse(fiveKeys).success).toBe(true)
    expect(RunnerConfigSchema.safeParse({ ...fiveKeys, maxChildren: 8 }).success).toBe(false)
    expect(RunnerConfigSchema.safeParse({ ...fiveKeys, planReplanPasses: 1 }).success).toBe(false)
    expect(RunnerConfigSchema.safeParse({ ...fiveKeys, planner: 'm' }).success).toBe(false)
  })

  it('accepts the optional metered key and a null budget; rejects a non-boolean metered', () => {
    const base = { repoRoot: '/repo', model: 'm' }
    expect(RunnerConfigSchema.safeParse({ ...base, budget: null }).success).toBe(true)
    expect(RunnerConfigSchema.safeParse({ ...base, budget: 5, metered: false }).success).toBe(true)
    expect(RunnerConfigSchema.safeParse({ ...base, budget: 5, metered: 'no' }).success).toBe(false)
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
