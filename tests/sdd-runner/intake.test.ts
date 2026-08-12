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
import type { DepthSignals } from '../../sdd-runner/src/agent-layer.js'
import type { RunnerConfig } from '../../sdd-runner/src/config.js'
import { EventInputSchema } from '../../sdd-runner/src/events.js'
import type { EventInput } from '../../sdd-runner/src/events.js'
import { mapSignalsToProfile, prescreenProfile, resolveDepth, runIntake } from '../../sdd-runner/src/intake.js'
import type { IntakeDeps } from '../../sdd-runner/src/intake.js'
import { createOpenSpecDriver } from '../../sdd-runner/src/openspec-driver.js'
import type { ExecFn } from '../../sdd-runner/src/openspec-driver.js'

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
    models: {},
    timeouts: { wallClockMs: 60_000, inactivityMs: 5_000 },
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
