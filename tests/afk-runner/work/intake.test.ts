// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { DepthSignals } from '../../../afk-runner/src/agent-layer.js'
import type { RunnerConfig } from '../../../afk-runner/src/config.js'
import { EventInputSchema } from '../../../afk-runner/src/events.js'
import type { EventInput } from '../../../afk-runner/src/events.js'
import { createOpenSpecDriver } from '../../../afk-runner/src/openspec-driver.js'
import type { ExecFn } from '../../../afk-runner/src/openspec-driver.js'
import { mapSignalsToProfile, prescreenProfile, resolveDepth, runIntake } from '../../../afk-runner/src/work/intake.js'
import type { IntakeDeps } from '../../../afk-runner/src/work/intake.js'
import { agentWritePath } from '../../../review-loop/src/agent-runner.js'
import type { SpawnFn } from '../../../review-loop/src/agent-runner.js'

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-intake-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

function signals(overrides: Partial<DepthSignals> = {}): DepthSignals {
  return {
    cross_module: false,
    db_migration: false,
    provider_surface: false,
    credentials: false,
    novelty: 'existing-modules',
    ...overrides,
  }
}

describe('mapSignalsToProfile', () => {
  it('maps a db migration or credentials to L', () => {
    expect(mapSignalsToProfile(signals({ db_migration: true }))).toBe('L')
    expect(mapSignalsToProfile(signals({ credentials: true }))).toBe('L')
  })

  it('maps provider-wide surface or a new subsystem to L', () => {
    expect(mapSignalsToProfile(signals({ provider_surface: true }))).toBe('L')
    expect(mapSignalsToProfile(signals({ novelty: 'new-subsystem' }))).toBe('L')
  })

  it('maps a single-module change in existing modules to S', () => {
    expect(mapSignalsToProfile(signals())).toBe('S')
  })

  it('maps cross-module impact without L signals to M', () => {
    expect(mapSignalsToProfile(signals({ cross_module: true }))).toBe('M')
  })
})

describe('prescreenProfile', () => {
  it('classifies obviously-small keyword tasks as S', () => {
    expect(prescreenProfile('fix typo in the README')).toBe('S')
  })

  it('classifies migration/credential keywords as L', () => {
    expect(prescreenProfile('add a drizzle migration for sessions')).toBe('L')
    expect(prescreenProfile('rotate credential storage to envelope encryption')).toBe('L')
  })

  it('defaults to M when no keyword matches', () => {
    expect(prescreenProfile('refactor the chat router fan-out')).toBe('M')
  })
})

describe('resolveDepth', () => {
  it('escalates to the higher profile on a one-level disagreement without flagging', () => {
    expect(resolveDepth('M', 'S')).toEqual({ profile: 'M', disagreement: false })
    expect(resolveDepth('S', 'M')).toEqual({ profile: 'M', disagreement: false })
  })

  it('flags a two-level disagreement while escalating to L', () => {
    expect(resolveDepth('L', 'S')).toEqual({ profile: 'L', disagreement: true })
    expect(resolveDepth('S', 'L')).toEqual({ profile: 'L', disagreement: true })
  })

  it('agrees trivially', () => {
    expect(resolveDepth('M', 'M')).toEqual({ profile: 'M', disagreement: false })
  })
})

const ESTIMATION = JSON.stringify({
  implicated_files: ['src/chat/router.ts', 'src/providers/config.ts', 'drizzle/0002_x.sql'],
  signals: {
    cross_module: true,
    db_migration: true,
    provider_surface: false,
    credentials: false,
    novelty: 'existing-modules',
  },
  rationale: 'router plus providers plus a migration',
})

interface IntakeFixture {
  readonly deps: IntakeDeps
  readonly emitted: EventInput[]
  readonly spawned: { count: number }
}

function makeFixture(dir: string, estimatorOutput?: string): IntakeFixture {
  const emitted: EventInput[] = []
  const spawned = { count: 0 }
  const exec: ExecFn = () => Promise.resolve({ stdout: 'ok', stderr: '', exitCode: 0 })
  const config: RunnerConfig = {
    repoRoot: dir,
    workDir: path.join(dir, '.sdd-runner'),
    model: 'test-model',
    budget: 5,
  }
  const spawn: SpawnFn = (_command, _args, options) => {
    spawned.count += 1
    const target = agentWritePath(options.cwd, 'depth.json')
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, estimatorOutput ?? ESTIMATION)
    return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
  }
  const execGit = (): Promise<{ stdout: string; stderr: string }> => Promise.resolve({ stdout: '', stderr: '' })
  const deps: IntakeDeps = {
    driver: createOpenSpecDriver({ exec, cwd: dir }),
    agent: { spawn, config, execGit, emit: () => undefined },
    emit: (event) => {
      emitted.push(EventInputSchema.parse(event))
    },
    sidecarDir: path.join(dir, 'sidecars'),
    runDir: dir,
    cwd: dir,
  }
  return { deps, emitted, spawned }
}

describe('runIntake', () => {
  it('scaffolds the change and records an override depth event without spawning the estimator', async () => {
    const dir = makeDir()
    const fixture = makeFixture(dir)
    const result = await runIntake(fixture.deps, {
      changeName: 'fix-typo',
      taskText: 'fix typo in README',
      depthOverride: 'S',
    })
    expect(result).toEqual({ changeName: 'fix-typo', depth: 'S', disagreement: false })
    expect(fixture.spawned.count).toBe(0)
    const events = fixture.emitted
    expect(events[0]).toMatchObject({ type: 'depth', profile: 'S', source: 'override' })
  })

  it('skips scaffolding when the change dir already exists — resume re-entry into intake is idempotent', async () => {
    const dir = makeDir()
    fs.mkdirSync(path.join(dir, 'openspec', 'changes', 'fix-typo'), { recursive: true })
    let newChangeCalls = 0
    const fixture = makeFixture(dir)
    const guardedDriver = {
      ...fixture.deps.driver,
      newChange: (): Promise<{ changeName: string }> => {
        newChangeCalls += 1
        return Promise.resolve({ changeName: 'fix-typo' })
      },
    }
    const result = await runIntake(
      { ...fixture.deps, driver: guardedDriver },
      { changeName: 'fix-typo', taskText: 'fix typo in README', depthOverride: 'S' },
    )
    expect(newChangeCalls).toBe(0)
    expect(result.depth).toBe('S')
  })

  it('runs the estimator when no override is given and records the classification', async () => {
    const dir = makeDir()
    const fixture = makeFixture(dir)
    const result = await runIntake(fixture.deps, { changeName: 'add-sessions', taskText: 'add session storage' })
    expect(result.depth).toBe('L')
    expect(result.disagreement).toBe(false)
    expect(fixture.spawned.count).toBe(1)
    const events = fixture.emitted
    expect(events[0]).toMatchObject({
      type: 'depth',
      profile: 'L',
      source: 'estimator',
      rationale: 'router plus providers plus a migration',
    })
  })

  it('flags a two-level disagreement between prescreen and estimator in the depth event', async () => {
    const dir = makeDir()
    const fixture = makeFixture(dir)
    const result = await runIntake(fixture.deps, { changeName: 'fix-typo', taskText: 'fix typo in README' })
    expect(result.depth).toBe('L')
    expect(result.disagreement).toBe(true)
    const events = fixture.emitted
    expect(events[0]).toMatchObject({ type: 'depth', disagreement: true })
  })
})

describe('runIntake warn sink', () => {
  it('warns exactly once on an S override: skipped estimation, the S round cap, and the S tail clause', async () => {
    const dir = makeDir()
    const fixture = makeFixture(dir)
    const lines: string[] = []
    const result = await runIntake(
      { ...fixture.deps, stdout: (line: string) => void lines.push(line) },
      { changeName: 'fix-typo', taskText: 'fix typo in README', depthOverride: 'S' },
    )
    expect(lines).toEqual([
      '--depth S skips scope estimation — the forced profile sets the review round cap (S: 1) and skips the atomicity stage (decompose presents the final gate)',
    ])
    expect(result).toEqual({ changeName: 'fix-typo', depth: 'S', disagreement: false })
  })

  it('warns on an M override with the M round cap and makes no atomicity claim', async () => {
    const dir = makeDir()
    const fixture = makeFixture(dir)
    const lines: string[] = []
    await runIntake(
      { ...fixture.deps, stdout: (line: string) => void lines.push(line) },
      { changeName: 'fix-typo', taskText: 'fix typo in README', depthOverride: 'M' },
    )
    expect(lines).toEqual(['--depth M skips scope estimation — the forced profile sets the review round cap (M: 3)'])
  })

  it('warns on a two-level disagreement naming both readings and the higher taken; event and result keep their shapes', async () => {
    const dir = makeDir()
    const fixture = makeFixture(dir)
    const lines: string[] = []
    const result = await runIntake(
      { ...fixture.deps, stdout: (line: string) => void lines.push(line) },
      { changeName: 'fix-typo', taskText: 'fix typo in README' },
    )
    expect(lines).toEqual(['depth readings disagree by two levels (estimator L, prescreen S) — taking the higher'])
    expect(result).toEqual({ changeName: 'fix-typo', depth: 'L', disagreement: true })
    expect(fixture.emitted[0]).toMatchObject({ type: 'depth', profile: 'L', disagreement: true })
  })

  it('stays silent without a sink on the deps — no warn, no throw', async () => {
    const dir = makeDir()
    const fixture = makeFixture(dir)
    const result = await runIntake(fixture.deps, {
      changeName: 'fix-typo',
      taskText: 'fix typo in README',
      depthOverride: 'S',
    })
    expect(result).toEqual({ changeName: 'fix-typo', depth: 'S', disagreement: false })
  })
})
