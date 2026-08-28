// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { agentWritePath } from '../../review-loop/src/agent-runner.js'
import type { SpawnFn } from '../../review-loop/src/agent-runner.js'
import type { RunnerConfig } from '../../sdd-runner/src/config.js'
import {
  buildDecomposerPrompt,
  countTaskSections,
  DecomposeReportSchema,
  runAtomicity,
  runDecompose,
  runsAtomicity,
} from '../../sdd-runner/src/decompose.js'
import type { AtomicityDeps, DecomposeDeps } from '../../sdd-runner/src/decompose.js'
import { createOpenSpecDriver } from '../../sdd-runner/src/openspec-driver.js'
import type { ExecFn } from '../../sdd-runner/src/openspec-driver.js'
import { StageHaltError } from '../../sdd-runner/src/stage-machine.js'

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-decompose-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('runsAtomicity + countTaskSections', () => {
  it('runs atomicity only at M and L', () => {
    expect(runsAtomicity('S')).toBe(false)
    expect(runsAtomicity('M')).toBe(true)
    expect(runsAtomicity('L')).toBe(true)
  })

  it('counts the top-level section headings in a tasks file', () => {
    const body = '## 1. Scaffold\n- [ ] 1.1 x\n\n## 2. Build\n- [ ] 2.1 y\n'
    expect(countTaskSections(body)).toBe(2)
  })
})

function makeConfig(dir: string): RunnerConfig {
  return {
    repoRoot: dir,
    workDir: path.join(dir, '.sdd-runner'),
    model: 'm',
    budget: 5,
  }
}

interface DecomposeFixture {
  readonly deps: DecomposeDeps
  readonly dir: string
  readonly prompts: string[]
  readonly instructionCalls: string[]
  readonly changeDir: string
}

function makeDecomposeFixture(
  dir: string,
  script: { decomposer?: string[] },
  validateResults?: boolean[],
): DecomposeFixture {
  const changeDir = path.join(dir, 'openspec', 'changes', 'add-thing')
  fs.mkdirSync(changeDir, { recursive: true })
  const prompts: string[] = []
  const instructionCalls: string[] = []
  const validations = [...(validateResults ?? [])]
  const exec: ExecFn = (args) => {
    const key = args.join(' ')
    if (key.includes('instructions')) {
      instructionCalls.push(args[2] ?? 'unknown')
      return Promise.resolve({
        stdout: JSON.stringify({
          instruction: 'Write tasks.md.',
          template: '## 1. Section\n- [ ] 1.1 Task\n',
          rules: [],
          resolvedOutputPath: `${dir}/openspec/changes/add-thing/tasks.md`,
          existingOutputPaths: [],
          dependencies: [],
        }),
        stderr: '',
        exitCode: 0,
      })
    }
    if (key.includes('validate')) {
      const first = validations.shift() ?? true
      return Promise.resolve({
        stdout: first ? 'is valid' : 'has issues: tasks malformed',
        stderr: '',
        exitCode: first ? 0 : 1,
      })
    }
    return Promise.resolve({ stdout: 'ok', stderr: '', exitCode: 0 })
  }
  const config = makeConfig(dir)
  let decomposerCalls = 0
  const spawn: SpawnFn = (_command, args, options) => {
    prompts.push(String(args[args.length - 1]))
    const queue = script.decomposer ?? []
    const content =
      queue[Math.min(decomposerCalls, queue.length - 1)] ?? '{"tasks_file":"openspec/changes/add-thing/tasks.md"}'
    decomposerCalls += 1
    fs.writeFileSync(path.join(dir, 'openspec/changes/add-thing/tasks.md'), '## 1. Section\n- [ ] 1.1 Task\n')
    const target = agentWritePath(options.cwd, 'decompose-tasks.json')
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
    return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
  }
  const execGit = (): Promise<{ stdout: string; stderr: string }> => Promise.resolve({ stdout: '', stderr: '' })
  const deps: DecomposeDeps = {
    driver: createOpenSpecDriver({ exec, cwd: dir }),
    agent: { spawn, config, execGit, emit: () => undefined },
    runDir: dir,
    sidecarDir: path.join(dir, 'sidecars'),
    cwd: dir,
  }
  return { deps, dir, prompts, instructionCalls, changeDir }
}

describe('runDecompose', () => {
  it('drives instructions for tasks, spawns the decomposer, and writes tasks.md', async () => {
    const dir = makeDir()
    const fixture = makeDecomposeFixture(dir, { decomposer: ['{"tasks_file":"openspec/changes/add-thing/tasks.md"}'] })
    await runDecompose(fixture.deps, { changeName: 'add-thing' })
    expect(fixture.instructionCalls).toEqual(['tasks'])
    expect(fixture.prompts[0]).toContain('Write tasks.md.')
    expect(fs.existsSync(path.join(fixture.changeDir, 'tasks.md'))).toBe(true)
  })

  it('retries when openspec validate fails, appending the validation output', async () => {
    const dir = makeDir()
    const fixture = makeDecomposeFixture(
      dir,
      {
        decomposer: [
          '{"tasks_file":"openspec/changes/add-thing/tasks.md"}',
          '{"tasks_file":"openspec/changes/add-thing/tasks.md"}',
        ],
      },
      [false, true],
    )
    await runDecompose(fixture.deps, { changeName: 'add-thing' })
    expect(fixture.prompts).toHaveLength(2)
    expect(fixture.prompts[1]).toContain('tasks malformed')
  })

  it('halts resumable after two failed validations', async () => {
    const dir = makeDir()
    const fixture = makeDecomposeFixture(
      dir,
      {
        decomposer: [
          '{"tasks_file":"openspec/changes/add-thing/tasks.md"}',
          '{"tasks_file":"openspec/changes/add-thing/tasks.md"}',
        ],
      },
      [false, false],
    )
    await expect(runDecompose(fixture.deps, { changeName: 'add-thing' })).rejects.toThrow(StageHaltError)
  })

  it('returns the parsed report — a needs_split verdict flows to the caller (D4)', async () => {
    const dir = makeDir()
    const fixture = makeDecomposeFixture(dir, {
      decomposer: ['{"tasks_file":"openspec/changes/add-thing/tasks.md","needs_split":true}'],
    })
    const report = await runDecompose(fixture.deps, { changeName: 'add-thing' })
    expect(report).toEqual({ tasks_file: 'openspec/changes/add-thing/tasks.md', needs_split: true })
  })

  it('returns the parsed report with needs_split absent when the sidecar omits it (D4)', async () => {
    const dir = makeDir()
    const fixture = makeDecomposeFixture(dir, {
      decomposer: ['{"tasks_file":"openspec/changes/add-thing/tasks.md"}'],
    })
    const report = await runDecompose(fixture.deps, { changeName: 'add-thing' })
    expect(report).toEqual({ tasks_file: 'openspec/changes/add-thing/tasks.md' })
    expect(report.needs_split).not.toBe(true)
  })
})

describe('DecomposeReportSchema needs_split (D4)', () => {
  it('parses sidecars without the field unchanged (backward-compat pin)', () => {
    const parsed = DecomposeReportSchema.parse({ tasks_file: 'openspec/changes/add-thing/tasks.md' })
    expect(parsed).toEqual({ tasks_file: 'openspec/changes/add-thing/tasks.md' })
    expect(parsed.needs_split).toBeUndefined()
  })

  it('parses needs_split true and false', () => {
    expect(DecomposeReportSchema.parse({ tasks_file: 't.md', needs_split: true }).needs_split).toBe(true)
    expect(DecomposeReportSchema.parse({ tasks_file: 't.md', needs_split: false }).needs_split).toBe(false)
  })
})

describe('buildDecomposerPrompt needs_split contract (D4)', () => {
  it('teaches the field and the first-slice-only tasks.md scoping', () => {
    const prompt = buildDecomposerPrompt('/repo/openspec/changes/add-thing/tasks.md', 'Write tasks.md.', '/repo', null)
    expect(prompt).toContain('needs_split')
    expect(prompt).toContain('first slice only')
    expect(prompt).toContain('child #1')
  })
})

interface AtomicityFixture {
  readonly deps: AtomicityDeps
  readonly dir: string
  readonly prompts: string[]
  readonly changeDir: string
}

function makeAtomicityFixture(dir: string, report: string, validateResults?: boolean[]): AtomicityFixture {
  const changeDir = path.join(dir, 'openspec', 'changes', 'add-thing')
  fs.mkdirSync(changeDir, { recursive: true })
  fs.writeFileSync(path.join(changeDir, 'tasks.md'), '## 1. Two-in-one\n- [ ] 1.1 migrate and backfill\n')
  const prompts: string[] = []
  const validations = [...(validateResults ?? [])]
  const exec: ExecFn = (args) => {
    const key = args.join(' ')
    if (key.includes('validate')) {
      const first = validations.shift() ?? true
      return Promise.resolve({ stdout: first ? 'is valid' : 'has issues', stderr: '', exitCode: first ? 0 : 1 })
    }
    return Promise.resolve({ stdout: 'ok', stderr: '', exitCode: 0 })
  }
  const config = makeConfig(dir)
  const spawn: SpawnFn = (_command, args, options) => {
    prompts.push(String(args[args.length - 1]))
    fs.writeFileSync(
      path.join(changeDir, 'tasks.md'),
      '## 1. Migrate\n- [ ] 1.1 migrate\n\n## 2. Backfill\n- [ ] 2.1 backfill\n',
    )
    const target = agentWritePath(options.cwd, 'atomicity.json')
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, report)
    return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
  }
  const execGit = (): Promise<{ stdout: string; stderr: string }> => Promise.resolve({ stdout: '', stderr: '' })
  const deps: AtomicityDeps = {
    driver: createOpenSpecDriver({ exec, cwd: dir }),
    agent: { spawn, config, execGit, emit: () => undefined },
    runDir: dir,
    sidecarDir: path.join(dir, 'sidecars'),
    cwd: dir,
  }
  return { deps, dir, prompts, changeDir }
}

describe('runAtomicity', () => {
  it('is skipped at S without spawning', async () => {
    const dir = makeDir()
    const fixture = makeAtomicityFixture(dir, '{"split":0,"merged":0}')
    const result = await runAtomicity(fixture.deps, { changeName: 'add-thing', depth: 'S' })
    expect(result).toEqual({ skipped: true })
    expect(fixture.prompts).toHaveLength(0)
  })

  it('splits bundled tasks at M', async () => {
    const dir = makeDir()
    const fixture = makeAtomicityFixture(dir, '{"split":1,"merged":0}')
    const result = await runAtomicity(fixture.deps, { changeName: 'add-thing', depth: 'M' })
    expect(result).toEqual({ skipped: false, split: 1, merged: 0 })
    const body = fs.readFileSync(path.join(fixture.changeDir, 'tasks.md'), 'utf8')
    expect(countTaskSections(body)).toBe(2)
  })
})
