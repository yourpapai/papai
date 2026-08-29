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
import { buildAtomicityPrompt, runAtomicity } from '../../../afk-runner/src/work/atomicity.js'
import type { StageDeps } from '../../../afk-runner/src/work/decompose.js'
import { agentWritePath } from '../../../review-loop/src/agent-runner.js'
import type { SpawnFn } from '../../../review-loop/src/agent-runner.js'

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-atomicity-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('buildAtomicityPrompt (sdd-runner/src/decompose.ts copy)', () => {
  it('names the in-place rewrite, the report shape, and appends the last error', () => {
    const base = buildAtomicityPrompt('/repo/openspec/changes/c/tasks.md', '/repo', null)
    expect(base).toContain('You are the atomicity checker.')
    expect(base).toContain('Rewrite tasks.md in place at: /repo/openspec/changes/c/tasks.md')
    expect(base).toContain('{"split": <count>, "merged": <count>}')
    expect(base).not.toContain('Previous attempt failed')
    const retried = buildAtomicityPrompt('/repo/openspec/changes/c/tasks.md', '/repo', 'validate blew up')
    expect(retried).toContain('Previous attempt failed:')
  })
})

interface AtomicityFixture {
  readonly deps: StageDeps
  readonly spawned: { count: number }
  readonly validations: { count: number }
}

function makeFixture(dir: string, validationResults: readonly boolean[]): AtomicityFixture {
  const spawned = { count: 0 }
  const validations = { count: 0 }
  const exec: ExecFn = (args): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
    const [_bin, subcommand] = args
    if (subcommand === 'validate') {
      const ok = validationResults[Math.min(validations.count, validationResults.length - 1)] ?? true
      validations.count += 1
      return Promise.resolve({ stdout: ok ? 'is valid' : 'schema invalid', stderr: '', exitCode: 0 })
    }
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
    const target = agentWritePath(options.cwd, 'atomicity.json')
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, JSON.stringify({ split: 1, merged: 2 }))
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
  return { deps, spawned, validations }
}

function writeTasksFile(dir: string): string {
  const tasksFile = path.join(dir, 'openspec', 'changes', 'c', 'tasks.md')
  fs.mkdirSync(path.dirname(tasksFile), { recursive: true })
  fs.writeFileSync(tasksFile, '## 1. Kernel\n')
  return tasksFile
}

describe('runAtomicity (split/merge report, S never runs it)', () => {
  it('depth S skips the stage entirely — never declares it', async () => {
    const dir = makeDir()
    const fixture = makeFixture(dir, [true])
    const result = await runAtomicity(fixture.deps, { changeName: 'c', depth: 'S' })
    expect(result).toEqual({ skipped: true })
    expect(fixture.spawned.count).toBe(0)
  })

  it('depth M rewrites tasks.md and reports split/merge counts', async () => {
    const dir = makeDir()
    writeTasksFile(dir)
    const fixture = makeFixture(dir, [true])
    const result = await runAtomicity(fixture.deps, { changeName: 'c', depth: 'M' })
    expect(result).toEqual({ skipped: false, split: 1, merged: 2 })
    expect(fixture.spawned.count).toBe(1)
  })

  it('halts with the legacy stage-halt error after two failed validations', async () => {
    const dir = makeDir()
    writeTasksFile(dir)
    const fixture = makeFixture(dir, [false, false])
    const halted = runAtomicity(fixture.deps, { changeName: 'c', depth: 'M' })
    expect(halted).rejects.toBeInstanceOf(StageHaltError)
    await expect(halted).rejects.toThrow('atomicity failed after 2 attempts')
    expect(fixture.spawned.count).toBe(2)
  })

  it('halts when tasks.md is missing', async () => {
    const dir = makeDir()
    const fixture = makeFixture(dir, [true])
    const halted = runAtomicity(fixture.deps, { changeName: 'c', depth: 'M' })
    await expect(halted).rejects.toThrow('atomicity cannot run: tasks.md missing')
    expect(fixture.spawned.count).toBe(0)
  })
})
