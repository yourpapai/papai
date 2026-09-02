// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { RunnerConfig } from '../../../afk-runner/src/config.js'
import { StageHaltError } from '../../../afk-runner/src/errors.js'
import { EventInputSchema } from '../../../afk-runner/src/events.js'
import type { EventInput } from '../../../afk-runner/src/events.js'
import { createOpenSpecDriver } from '../../../afk-runner/src/openspec-driver.js'
import type { ExecFn, OpenSpecDriver } from '../../../afk-runner/src/openspec-driver.js'
import {
  buildDecomposerPrompt,
  countTaskSections,
  runDecompose,
  runsAtomicity,
} from '../../../afk-runner/src/work/decompose.js'
import type { StageDeps } from '../../../afk-runner/src/work/decompose.js'
import { agentWritePath } from '../../../review-loop/src/agent-runner.js'
import type { SpawnFn } from '../../../review-loop/src/agent-runner.js'

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-decompose-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('decompose helpers (sdd-runner/src/decompose.ts copy)', () => {
  it('runsAtomicity gates on the depth profile', () => {
    expect(runsAtomicity('S')).toBe(false)
    expect(runsAtomicity('M')).toBe(true)
    expect(runsAtomicity('L')).toBe(true)
  })

  it('countTaskSections counts the ## headings', () => {
    expect(countTaskSections('## 1. Kernel\n\nwork\n\n## 2. Fixtures\n')).toBe(2)
    expect(countTaskSections('no sections')).toBe(0)
  })

  it('buildDecomposerPrompt names the tasks file and the report, and appends the last error', () => {
    const base = buildDecomposerPrompt('/repo/openspec/changes/c/tasks.md', 'write tasks', '/repo', null)
    expect(base).toContain('You are the decomposer.')
    expect(base).toContain('Write tasks.md to: /repo/openspec/changes/c/tasks.md')
    expect(base).toContain('decompose-tasks.json')
    expect(base).not.toContain('Previous attempt failed')
    const retried = buildDecomposerPrompt(
      '/repo/openspec/changes/c/tasks.md',
      'write tasks',
      '/repo',
      'validate blew up',
    )
    expect(retried).toContain('Previous attempt failed:')
    expect(retried).toContain('validate blew up')
  })
})

interface DecomposeFixture {
  readonly deps: StageDeps
  readonly prompts: string[]
  readonly spawned: { count: number }
  readonly validations: { count: number }
}

function makeFixture(dir: string, validationResults: readonly boolean[]): DecomposeFixture {
  const prompts: string[] = []
  const spawned = { count: 0 }
  const validations = { count: 0 }
  const exec: ExecFn = (args): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
    const [_bin, subcommand, ...rest] = args
    if (subcommand === 'instructions') {
      return Promise.resolve({
        stdout: JSON.stringify({
          instruction: 'write the tasks',
          resolvedOutputPath: path.join(dir, 'openspec', 'changes', 'c', 'tasks.md'),
        }),
        stderr: '',
        exitCode: 0,
      })
    }
    if (subcommand === 'validate') {
      const ok = validationResults[Math.min(validations.count, validationResults.length - 1)] ?? true
      validations.count += 1
      return Promise.resolve({ stdout: ok ? 'is valid' : 'schema invalid', stderr: '', exitCode: 0 })
    }
    void rest
    return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })
  }
  const driver: OpenSpecDriver = createOpenSpecDriver({ exec, cwd: dir })
  const config: RunnerConfig = {
    repoRoot: dir,
    workDir: path.join(dir, '.sdd-runner'),
    model: 'test-model',
    budget: 5,
  }
  const spawn: SpawnFn = (_command, _args, options) => {
    spawned.count += 1
    prompts.push(String(_args.at(-1)))
    const target = agentWritePath(options.cwd, 'decompose-tasks.json')
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, JSON.stringify({ tasks_file: 'openspec/changes/c/tasks.md' }))
    const tasksFile = path.join(options.cwd, 'openspec', 'changes', 'c', 'tasks.md')
    fs.mkdirSync(path.dirname(tasksFile), { recursive: true })
    fs.writeFileSync(tasksFile, '## 1. Kernel\n')
    return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
  }
  const emitted: EventInput[] = []
  const deps: StageDeps = {
    driver,
    agent: {
      spawn,
      config,
      execGit: () => Promise.resolve({ stdout: '', stderr: '' }),
      emit: (event) => {
        emitted.push(EventInputSchema.parse(event))
      },
    },
    runDir: dir,
    sidecarDir: path.join(dir, 'sidecars'),
    cwd: dir,
  }
  return { deps, prompts, spawned, validations }
}

describe('runDecompose (2-attempt validateStrict retry, halt after two)', () => {
  it('spawns the decomposer once when strict validation passes', async () => {
    const dir = makeDir()
    const fixture = makeFixture(dir, [true])
    await runDecompose(fixture.deps, { changeName: 'c' })
    expect(fixture.spawned.count).toBe(1)
    expect(fixture.validations.count).toBe(1)
    expect(fixture.prompts[0]).toContain('write the tasks')
  })

  it('retries once with the validation error in the prompt, then passes', async () => {
    const dir = makeDir()
    const fixture = makeFixture(dir, [false, true])
    await runDecompose(fixture.deps, { changeName: 'c' })
    expect(fixture.spawned.count).toBe(2)
    expect(fixture.validations.count).toBe(2)
    expect(fixture.prompts[1]).toContain('openspec validate --strict failed')
    expect(fixture.prompts[1]).toContain('schema invalid')
  })

  it('halts with the legacy stage-halt error after two failed attempts', async () => {
    const dir = makeDir()
    const fixture = makeFixture(dir, [false, false])
    const halted = runDecompose(fixture.deps, { changeName: 'c' })
    expect(halted).rejects.toBeInstanceOf(StageHaltError)
    await expect(halted).rejects.toThrow('decompose failed after 2 attempts')
    expect(fixture.spawned.count).toBe(2)
  })
})
