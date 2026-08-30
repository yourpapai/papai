// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { agentWritePath } from '../../review-loop/src/agent-runner.js'
import type { SpawnFn } from '../../review-loop/src/agent-runner.js'
import type { DepthSignals } from '../../sdd-runner/src/agent-layer.js'
import type { RunnerConfig } from '../../sdd-runner/src/config.js'
import { EventInputSchema } from '../../sdd-runner/src/events.js'
import type { EventInput } from '../../sdd-runner/src/events.js'
import {
  buildEstimatorPrompt,
  mapSignalsToProfile,
  prescreenProfile,
  resolveDepth,
  runIntake,
  runPlanner,
} from '../../sdd-runner/src/intake.js'
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

const OVERSIZE_ESTIMATION = JSON.stringify({
  implicated_files: ['src/chat/router.ts'],
  signals: {
    cross_module: true,
    db_migration: false,
    provider_surface: false,
    credentials: false,
    novelty: 'existing-modules',
  },
  rationale: 'declared scope too large for one change',
  oversize: true,
})

const kbFiles = (count: number): string[] => Array.from({ length: count }, (_, i) => `src/kb/file-${i}.ts`)

const KB_ESTIMATION = JSON.stringify({
  implicated_files: kbFiles(36),
  signals: {
    cross_module: true,
    db_migration: false,
    provider_surface: false,
    credentials: false,
    novelty: 'new-subsystem',
  },
  rationale: 'new knowledge-base subsystem across chat, tools, and storage',
})

const CLAUDE_CLI_ESTIMATION = JSON.stringify({
  implicated_files: kbFiles(19),
  signals: {
    cross_module: true,
    db_migration: false,
    provider_surface: false,
    credentials: false,
    novelty: 'new-subsystem',
  },
  rationale: 'new cli subsystem across chat and providers',
})

const PLAN = JSON.stringify({
  children: [
    { id: 'auth-api', instruction: 'Add the auth API endpoints.', deps: ['auth-db'] },
    { id: 'auth-db', instruction: 'Add the auth database schema.', deps: [] },
  ],
})

const DUPLICATE_IDS_PLAN = JSON.stringify({
  children: [
    { id: 'auth-db', instruction: 'Add the auth database schema.', deps: [] },
    { id: 'auth-db', instruction: 'Add the schema again.', deps: [] },
  ],
})

const CYCLIC_PLAN = JSON.stringify({
  children: [
    { id: 'auth-api', instruction: 'Add the auth API endpoints.', deps: ['auth-db'] },
    { id: 'auth-db', instruction: 'Add the auth database schema.', deps: ['auth-api'] },
  ],
})

interface IntakeFixture {
  readonly deps: IntakeDeps
  readonly emitted: EventInput[]
  readonly agentEmitted: EventInput[]
  readonly spawned: { count: number }
  readonly timeline: string[]
  readonly prompts: string[]
  readonly warnings: string[]
}

function makeFixture(dir: string, outputs: Record<string, string | string[]> = {}): IntakeFixture {
  const warnings: string[] = []
  const emitted: EventInput[] = []
  const agentEmitted: EventInput[] = []
  const spawned = { count: 0 }
  const timeline: string[] = []
  const prompts: string[] = []
  const sequences = new Map<string, string[]>(
    Object.entries(outputs).map(([name, value]) => [name, Array.isArray(value) ? [...value] : [value]]),
  )
  const exec: ExecFn = (args) => {
    timeline.push(`exec:${args.slice(1, 3).join(' ')}`)
    return Promise.resolve({ stdout: 'ok', stderr: '', exitCode: 0 })
  }
  const config: RunnerConfig = {
    repoRoot: dir,
    workDir: path.join(dir, '.sdd-runner'),
    model: 'test-model',
    budget: 5,
  }
  const spawn: SpawnFn = (_command, args, options) => {
    const prompt = String(args[args.length - 1])
    prompts.push(prompt)
    const match = prompt.match(/\.review-loop\/([\w-]+\.json)/u)
    const basename = match?.[1] ?? 'depth.json'
    spawned.count += 1
    timeline.push(`spawn:${basename}`)
    const sequence = sequences.get(basename)
    const next = sequence === undefined ? undefined : sequence.length > 1 ? sequence.shift() : sequence[0]
    const content = next ?? ESTIMATION
    const target = agentWritePath(options.cwd, basename)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
    return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
  }
  const execGit = (): Promise<{ stdout: string; stderr: string }> => Promise.resolve({ stdout: '', stderr: '' })
  const deps: IntakeDeps = {
    driver: createOpenSpecDriver({ exec, cwd: dir }),
    agent: {
      spawn,
      config,
      execGit,
      emit: (event) => {
        agentEmitted.push(EventInputSchema.parse(event))
      },
    },
    emit: (event) => {
      emitted.push(EventInputSchema.parse(event))
    },
    sidecarDir: path.join(dir, 'sidecars'),
    runDir: dir,
    cwd: dir,
    stdout: (line) => {
      warnings.push(line)
    },
  }
  return { deps, emitted, agentEmitted, spawned, timeline, prompts, warnings }
}

describe('buildEstimatorPrompt', () => {
  it('asks for the raw signals, stays read-only, and never instructs oversize self-declaration', () => {
    const prompt = buildEstimatorPrompt('build the knowledge base', '/repo')
    expect(prompt).toContain('Do not edit anything')
    expect(prompt).toMatch(/implicated_files/u)
    expect(prompt).toMatch(/cross_module/u)
    expect(prompt).toMatch(/novelty/u)
    expect(prompt).not.toMatch(/declares scope too large/u)
    expect(prompt).not.toMatch(/Set oversize/u)
  })
})

describe('runIntake', () => {
  it('a forced plan routes to the planner despite a non-routing verdict, recording routeForced', async () => {
    const dir = makeDir()
    const fixture = makeFixture(dir, { 'depth.json': ESTIMATION, 'plan-draft.json': PLAN })
    const result = await runIntake(fixture.deps, {
      changeName: 'forced',
      taskText: 'small task the operator wants decomposed',
      forcePlan: true,
    })
    expect(result.kind).toBe('plan')
    expect(fixture.timeline).toEqual(['spawn:depth.json', 'spawn:plan-draft.json'])
    expect(fixture.emitted[0]).toMatchObject({
      type: 'depth',
      oversize: false,
      routeForced: 'plan',
      oversizeSignals: { novelty: 'existing-modules', cross_module: true, implicatedFiles: 3 },
    })
  })

  it('rejects forcePlan together with a depth override naming the conflict', async () => {
    const fixture = makeFixture(makeDir())
    const failure = await runIntake(fixture.deps, {
      changeName: 'conflicted',
      taskText: 'conflicting flags',
      depthOverride: 'S',
      forcePlan: true,
    }).catch((error: unknown) => error)
    expect(failure instanceof Error).toBe(true)
    assert(failure instanceof Error)
    expect(failure.message).toMatch(/--plan.*--depth/u)
  })

  it('scaffolds the change and records an override depth event without spawning the estimator', async () => {
    const dir = makeDir()
    const fixture = makeFixture(dir)
    const result = await runIntake(fixture.deps, {
      changeName: 'fix-typo',
      taskText: 'fix typo in README',
      depthOverride: 'S',
    })
    expect(result).toEqual({ kind: 'single', changeName: 'fix-typo', depth: 'S', disagreement: false })
    expect(fixture.spawned.count).toBe(0)
    expect(fixture.timeline).toEqual(['exec:new change'])
    const events = fixture.emitted
    expect(events[0]).toMatchObject({ type: 'depth', profile: 'S', source: 'override', routeForced: 'depth' })
  })

  it('runs the estimator when no override is given and records the classification', async () => {
    const dir = makeDir()
    const fixture = makeFixture(dir)
    const result = await runIntake(fixture.deps, { changeName: 'add-sessions', taskText: 'add session storage' })
    expect(result).toEqual({ kind: 'single', changeName: 'add-sessions', depth: 'L', disagreement: false })
    expect(fixture.spawned.count).toBe(1)
    expect(fixture.timeline).toEqual(['spawn:depth.json', 'exec:new change'])
    const events = fixture.emitted
    expect(events[0]).toMatchObject({
      type: 'depth',
      profile: 'L',
      source: 'estimator',
      oversize: false,
      rationale: 'router plus providers plus a migration',
    })
  })

  it('flags a two-level disagreement between prescreen and estimator in the depth event', async () => {
    const dir = makeDir()
    const fixture = makeFixture(dir)
    const result = await runIntake(fixture.deps, { changeName: 'fix-typo', taskText: 'fix typo in README' })
    expect(result).toEqual({ kind: 'single', changeName: 'fix-typo', depth: 'L', disagreement: true })
    const events = fixture.emitted
    expect(events[0]).toMatchObject({ type: 'depth', disagreement: true })
  })

  it('warns on a two-level disagreement instead of only recording it in the event', async () => {
    const dir = makeDir()
    const fixture = makeFixture(dir)
    await runIntake(fixture.deps, { changeName: 'fix-typo', taskText: 'fix typo in README' })
    const warning = fixture.warnings.find((line) => line.includes('disagree'))
    expect(warning).toBeDefined()
    // Names both readings and the one that was taken, so the operator can
    // judge the escalation without opening the event log.
    expect(warning).toContain('S')
    expect(warning).toContain('L')
  })

  it('stays quiet when the estimator and the prescreen agree within one level', async () => {
    const dir = makeDir()
    const fixture = makeFixture(dir)
    await runIntake(fixture.deps, { changeName: 'add-sessions', taskText: 'add session storage' })
    expect(fixture.warnings.filter((line) => line.includes('disagree'))).toEqual([])
  })

  it('warns that a depth override skips oversize detection', async () => {
    const dir = makeDir()
    const fixture = makeFixture(dir)
    await runIntake(fixture.deps, {
      changeName: 'fix-typo',
      taskText: 'fix typo in README',
      depthOverride: 'S',
    })
    // The estimator is the only source of the oversize verdict, so an override
    // silently rules out decomposition — say so rather than letting an oversize
    // task draft one outsized change.
    const warning = fixture.warnings.find((line) => line.includes('oversize'))
    expect(warning).toBeDefined()
    expect(warning).toContain('--depth')
    expect(fixture.spawned.count).toBe(0)
  })

  it('does not warn about oversize detection when the estimator runs', async () => {
    const dir = makeDir()
    const fixture = makeFixture(dir)
    await runIntake(fixture.deps, { changeName: 'add-sessions', taskText: 'add session storage' })
    expect(fixture.warnings.filter((line) => line.includes('oversize'))).toEqual([])
  })

  it('returns a plan outcome with topo-ordered children and never scaffolds a change folder', async () => {
    const dir = makeDir()
    const fixture = makeFixture(dir, { 'depth.json': KB_ESTIMATION, 'plan-draft.json': PLAN })
    const result = await runIntake(fixture.deps, { changeName: 'composite', taskText: 'build the knowledge base' })
    expect(result).toEqual({
      kind: 'plan',
      children: [
        { id: 'auth-db', instruction: 'Add the auth database schema.', deps: [] },
        { id: 'auth-api', instruction: 'Add the auth API endpoints.', deps: ['auth-db'] },
      ],
    })
    expect(fixture.spawned.count).toBe(2)
    expect(fixture.timeline).toEqual(['spawn:depth.json', 'spawn:plan-draft.json'])
    expect(fixture.emitted[0]).toMatchObject({ type: 'depth', source: 'estimator', oversize: true })
  })

  it('records the weighed signals in the depth event and the sidecar when the conjunction routes', async () => {
    const dir = makeDir()
    const fixture = makeFixture(dir, { 'depth.json': KB_ESTIMATION, 'plan-draft.json': PLAN })
    await runIntake(fixture.deps, { changeName: 'composite', taskText: 'build the knowledge base' })
    expect(fixture.emitted[0]).toMatchObject({
      type: 'depth',
      oversizeSignals: { novelty: 'new-subsystem', cross_module: true, implicatedFiles: 36 },
    })
    const sidecar: unknown = JSON.parse(fs.readFileSync(path.join(dir, 'sidecars', 'depth.json'), 'utf8'))
    expect(sidecar).toMatchObject({
      oversize: true,
      oversize_signals: { novelty: 'new-subsystem', cross_module: true, implicatedFiles: 36 },
    })
  })

  it('keeps the 19-file claude-cli-shaped estimation single-path (threshold at 30)', async () => {
    const dir = makeDir()
    const fixture = makeFixture(dir, { 'depth.json': CLAUDE_CLI_ESTIMATION })
    const result = await runIntake(fixture.deps, { changeName: 'claude-cli', taskText: 'build the cli' })
    expect(result).toEqual({ kind: 'single', changeName: 'claude-cli', depth: 'L', disagreement: false })
    expect(fixture.timeline).toEqual(['spawn:depth.json', 'exec:new change'])
    expect(fixture.emitted[0]).toMatchObject({ type: 'depth', oversize: false })
  })

  it('keeps any missing signal single-path: existing-modules or non-cross-module despite the file count', async () => {
    const existingModules = makeFixture(makeDir(), {
      'depth.json': JSON.stringify({
        implicated_files: kbFiles(36),
        signals: {
          cross_module: true,
          db_migration: false,
          provider_surface: false,
          credentials: false,
          novelty: 'existing-modules',
        },
        rationale: 'large but inside existing modules',
      }),
    })
    const result = await runIntake(existingModules.deps, { changeName: 'wide', taskText: 'widen everything' })
    expect(result.kind).toBe('single')
    const singleModule = makeFixture(makeDir(), {
      'depth.json': JSON.stringify({
        implicated_files: kbFiles(36),
        signals: {
          cross_module: false,
          db_migration: false,
          provider_surface: false,
          credentials: false,
          novelty: 'new-subsystem',
        },
        rationale: 'new but one module',
      }),
    })
    const narrow = await runIntake(singleModule.deps, { changeName: 'deep', taskText: 'one deep module' })
    expect(narrow.kind).toBe('single')
  })

  it('overrides an agent-emitted oversize boolean with the computed verdict', async () => {
    const dir = makeDir()
    const fixture = makeFixture(dir, { 'depth.json': OVERSIZE_ESTIMATION })
    const result = await runIntake(fixture.deps, { changeName: 'declared', taskText: 'task declaring its own size' })
    expect(result.kind).toBe('single')
    expect(fixture.timeline).toEqual(['spawn:depth.json', 'exec:new change'])
    expect(fixture.emitted[0]).toMatchObject({ type: 'depth', oversize: false })
    const sidecar: unknown = JSON.parse(fs.readFileSync(path.join(dir, 'sidecars', 'depth.json'), 'utf8'))
    expect(sidecar).toMatchObject({ oversize: false })
  })
})

describe('runPlanner', () => {
  it('spawns the planner with role planner targeting plan-draft.json and returns topo-ordered children', async () => {
    const dir = makeDir()
    const fixture = makeFixture(dir, { 'plan-draft.json': PLAN })
    const children = await runPlanner(fixture.deps, { changeName: 'composite', taskText: 'build the platform' })
    expect(children).toEqual([
      { id: 'auth-db', instruction: 'Add the auth database schema.', deps: [] },
      { id: 'auth-api', instruction: 'Add the auth API endpoints.', deps: ['auth-db'] },
    ])
    const roles = fixture.agentEmitted
      .filter((e): e is Extract<EventInput, { type: 'spawned' }> => e.type === 'spawned')
      .map((e) => e.role)
    expect(roles).toEqual(['planner'])
    expect(fixture.prompts[0]).toContain(agentWritePath(dir, 'plan-draft.json'))
    const persisted: unknown = JSON.parse(fs.readFileSync(path.join(dir, 'sidecars', 'plan.json'), 'utf8'))
    expect(persisted).toEqual(JSON.parse(PLAN))
  })

  it('replans exactly once with the structural error appended when the draft has duplicate ids', async () => {
    const dir = makeDir()
    const fixture = makeFixture(dir, { 'plan-draft.json': [DUPLICATE_IDS_PLAN, PLAN] })
    const children = await runPlanner(fixture.deps, { changeName: 'composite', taskText: 'build the platform' })
    expect(children.map((child) => child.id)).toEqual(['auth-db', 'auth-api'])
    expect(fixture.spawned.count).toBe(2)
    expect(fixture.prompts[0]).not.toContain('duplicate child ids')
    expect(fixture.prompts[1]).toContain('duplicate child ids')
    const persisted: unknown = JSON.parse(fs.readFileSync(path.join(dir, 'sidecars', 'plan.json'), 'utf8'))
    expect(persisted).toEqual(JSON.parse(PLAN))
  })

  it('fails loudly naming the structural errors when the replan bound is exhausted', async () => {
    const dir = makeDir()
    const fixture = makeFixture(dir, { 'plan-draft.json': CYCLIC_PLAN })
    const failure = await runPlanner(fixture.deps, {
      changeName: 'composite',
      taskText: 'build the platform',
    }).catch((error: unknown) => error)
    expect(failure instanceof Error).toBe(true)
    assert(failure instanceof Error)
    expect(failure.message).toMatch(/dependency cycle/u)
    expect(failure.message).toMatch(/replan/u)
    expect(fixture.spawned.count).toBe(2)
  })

  it('stages drafts at plan-draft.json, never overwriting plan.json with a structurally invalid draft', async () => {
    const dir = makeDir()
    fs.mkdirSync(path.join(dir, 'sidecars'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'sidecars', 'plan.json'), PLAN)
    const fixture = makeFixture(dir, { 'plan-draft.json': CYCLIC_PLAN })

    const failure = await runPlanner(fixture.deps, {
      changeName: 'composite',
      taskText: 'build the platform',
    }).catch((error: unknown) => error)

    assert(failure instanceof Error)
    expect(failure.message).toMatch(/dependency cycle/u)
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'sidecars', 'plan.json'), 'utf8'))).toEqual(JSON.parse(PLAN))
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'sidecars', 'plan-draft.json'), 'utf8'))).toEqual(
      JSON.parse(CYCLIC_PLAN),
    )
  })
})
