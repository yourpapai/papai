// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { RunnerConfig } from '../../../afk-runner/src/config.js'
import { StageHaltError } from '../../../afk-runner/src/errors.js'
import { EventInputSchema } from '../../../afk-runner/src/events.js'
import type { EventInput } from '../../../afk-runner/src/events.js'
import { createOpenSpecDriver } from '../../../afk-runner/src/openspec-driver.js'
import type { ExecFn, OpenSpecDriver } from '../../../afk-runner/src/openspec-driver.js'
import { runAtomicity } from '../../../afk-runner/src/work/atomicity.js'
import type { StageDeps } from '../../../afk-runner/src/work/decompose.js'
import { agentWritePath } from '../../../review-loop/src/agent-runner.js'
import type { SpawnFn } from '../../../review-loop/src/agent-runner.js'

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-halt-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('StageHaltError taxonomy — kind exhausted | precondition (C6 D1)', () => {
  it('carries an explicit exhausted kind with message and resume hint unchanged', () => {
    const halt = new StageHaltError('draft specs failed after 2 attempts: invalid', 'resume the run', 'exhausted')
    expect(halt.name).toBe('StageHaltError')
    expect(halt.kind).toBe('exhausted')
    expect(halt.message).toBe('draft specs failed after 2 attempts: invalid')
    expect(halt.resumeHint).toBe('resume the run')
  })

  it('carries a precondition kind for structural gaps retry cannot help', () => {
    const halt = new StageHaltError(
      'atomicity cannot run: tasks.md missing',
      'resume after decomposition',
      'precondition',
    )
    expect(halt.kind).toBe('precondition')
    expect(halt.message).toBe('atomicity cannot run: tasks.md missing')
  })

  it('defaults to exhausted — the pre-C6 throw shapes are all validation exhaustion', () => {
    expect(new StageHaltError('m', 'h').kind).toBe('exhausted')
  })
})

interface HaltFixture {
  readonly deps: StageDeps
  readonly spawned: { count: number }
}

function makeFixture(dir: string, validationsOk: readonly boolean[]): HaltFixture {
  const spawned = { count: 0 }
  let validationIndex = 0
  const exec: ExecFn = (args): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
    const [_bin, subcommand] = args
    if (subcommand === 'validate') {
      const ok = validationsOk[Math.min(validationIndex, validationsOk.length - 1)] ?? true
      validationIndex += 1
      return Promise.resolve({
        stdout: ok ? 'is valid' : 'schema invalid',
        stderr: '',
        exitCode: 0,
      })
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
    fs.writeFileSync(target, JSON.stringify({ split: 0, merged: 0 }))
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
  return { deps, spawned }
}

describe('work-module throw sites classify their halts', () => {
  it('atomicity validation exhaustion declares kind exhausted', async () => {
    const dir = makeDir()
    const tasksFile = path.join(dir, 'openspec', 'changes', 'c', 'tasks.md')
    fs.mkdirSync(path.dirname(tasksFile), { recursive: true })
    fs.writeFileSync(tasksFile, '## 1. Kernel\n')
    const fixture = makeFixture(dir, [false, false])
    const failure = await runAtomicity(fixture.deps, {
      changeName: 'c',
      depth: 'M',
    }).then(
      () => null,
      (error: unknown) => error,
    )
    expect(failure).toBeInstanceOf(StageHaltError)
    assert(failure instanceof StageHaltError)
    expect(failure.kind).toBe('exhausted')
    expect(failure.message).toBe('atomicity failed after 2 attempts: openspec validate --strict failed: schema invalid')
  })

  it('a missing tasks.md declares kind precondition', async () => {
    const dir = makeDir()
    const fixture = makeFixture(dir, [true])
    const failure = await runAtomicity(fixture.deps, {
      changeName: 'c',
      depth: 'M',
    }).then(
      () => null,
      (error: unknown) => error,
    )
    expect(failure).toBeInstanceOf(StageHaltError)
    assert(failure instanceof StageHaltError)
    expect(failure.kind).toBe('precondition')
    expect(fixture.spawned.count).toBe(0)
  })
})
