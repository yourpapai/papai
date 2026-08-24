// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { z } from 'zod'

import type { SpawnFn } from '../../review-loop/src/agent-runner.js'
import { agentWritePath } from '../../review-loop/src/agent-runner.js'
import { readEvents } from '../../sdd-runner/src/events.js'
import type { EventInput } from '../../sdd-runner/src/events.js'
import { presentGateAt } from '../../sdd-runner/src/gate-digest.js'
import type { OrchestratorDeps } from '../../sdd-runner/src/gate-digest.js'
import type { StageContext } from '../../sdd-runner/src/gate-digest.js'
import { createOpenSpecDriver } from '../../sdd-runner/src/openspec-driver.js'
import type { OpenSpecDriver } from '../../sdd-runner/src/openspec-driver.js'
import { runContinue, runGateResume, runResume, runStart } from '../../sdd-runner/src/orchestrator.js'
import type { RunGateResumeResult } from '../../sdd-runner/src/orchestrator.js'
import { materializeChildFiles } from '../../sdd-runner/src/plan.js'
import { deriveResumeDecision } from '../../sdd-runner/src/resume-flow.js'
import type { ReviewLoopResult } from '../../sdd-runner/src/review-loop.js'
import { createRunState } from '../../sdd-runner/src/run-state.js'
import { loadRunState } from '../../sdd-runner/src/run-state.js'
import type { RunState } from '../../sdd-runner/src/run-state.js'
import { readHolder } from '../../sdd-runner/src/stop-controller.js'

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-orch-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

function errorMessageOf(failure: unknown): string {
  if (!(failure instanceof Error)) throw new Error('expected a rejection holding an Error')
  return failure.message
}

interface Fixture {
  readonly deps: OrchestratorDeps
  readonly repoRoot: string
  readonly changeName: string
  readonly changeDir: string
  readonly taskFile: string
  readonly rendered: EventInput[]
  readonly stdoutLines: string[]
  readonly spawnOrder: string[]
}

function makeFixture(sidecarOverrides: Record<string, string> = {}): Fixture {
  const repoRoot = makeDir()
  const changeName = 'add-thing'
  const changeDir = path.join(repoRoot, 'openspec', 'changes', changeName)
  const taskFile = path.join(repoRoot, 'task.md')
  fs.writeFileSync(taskFile, `# Add thing\n\ndoes a thing\n`)
  const rendered: EventInput[] = []
  const stdoutLines: string[] = []
  const spawnOrder: string[] = []

  const sidecars: Record<string, string> = {
    'draft-proposal.json': JSON.stringify({
      files_written: ['openspec/changes/add-thing/proposal.md'],
    }),
    'draft-specs.json': JSON.stringify({
      files_written: ['openspec/changes/add-thing/specs/thing/spec.md'],
    }),
    'draft-design.json': JSON.stringify({
      files_written: ['openspec/changes/add-thing/design.md'],
    }),
    'findings-1.json': JSON.stringify({ findings: [] }),
    'resolutions-1.json': JSON.stringify({
      resolutions: [],
      assumptions: [
        {
          id: 'A1',
          text: 'guests stay read-only',
          basis: 'default',
          confidence: 'medium',
          blast_radius: 'group replies',
          status: 'open',
          evidence: { files: ['openspec/changes/thing/proposal.md'] },
        },
      ],
    }),
    'decompose-tasks.json': JSON.stringify({
      tasks_file: 'openspec/changes/add-thing/tasks.md',
    }),
    'atomicity.json': JSON.stringify({ split: 0, merged: 0 }),
    'drift.json': JSON.stringify({
      tasks_file: 'openspec/changes/add-thing/tasks.md',
    }),
    'veto-updater.json': JSON.stringify({
      files_updated: ['openspec/changes/add-thing/proposal.md'],
    }),
    ...sidecarOverrides,
  }
  const artifacts: Record<string, string> = {
    'draft-proposal.json': path.join(changeDir, 'proposal.md'),
    'draft-specs.json': path.join(changeDir, 'specs', 'thing', 'spec.md'),
    'draft-design.json': path.join(changeDir, 'design.md'),
    'decompose-tasks.json': path.join(changeDir, 'tasks.md'),
    'veto-updater.json': path.join(changeDir, 'proposal.md'),
  }
  const spawn: SpawnFn = (_command, args, options) => {
    const prompt = String(args[args.length - 1])
    const match = prompt.match(/\.review-loop\/([\w-]+\.json)/u)
    const basename = match?.[1] ?? 'unknown.json'
    spawnOrder.push(basename)
    if (artifacts[basename] !== undefined) {
      fs.mkdirSync(path.dirname(artifacts[basename]), { recursive: true })
      fs.writeFileSync(artifacts[basename], `<!-- content for ${basename} -->\n`)
    }
    const content = sidecars[basename] ?? '{}'
    const target = agentWritePath(options.cwd, basename)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
    return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
  }

  const driverExec = (args: readonly string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
    const [bin, subcommand, ...rest] = args
    void bin
    if (subcommand === 'new' && rest[0] === 'change') {
      const createdName = typeof rest[1] === 'string' ? rest[1] : changeName
      fs.mkdirSync(path.join(repoRoot, 'openspec', 'changes', createdName, 'specs', 'thing'), { recursive: true })
      return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })
    }
    if (subcommand === 'instructions') {
      const artifactId = rest[0]
      const resolved =
        artifactId === 'tasks' ? path.join(changeDir, 'tasks.md') : path.join(changeDir, `${artifactId}.md`)
      return Promise.resolve({
        stdout: JSON.stringify({
          instruction: `write the ${artifactId}`,
          resolvedOutputPath: resolved,
        }),
        stderr: '',
        exitCode: 0,
      })
    }
    if (subcommand === 'validate') {
      return Promise.resolve({ stdout: 'is valid', stderr: '', exitCode: 0 })
    }
    if (subcommand === 'status') {
      return Promise.resolve({
        stdout: JSON.stringify({
          schemaName: 'auto-sdd',
          artifacts: [{ id: 'proposal', status: 'done' }],
        }),
        stderr: '',
        exitCode: 0,
      })
    }
    return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })
  }
  const driver: OpenSpecDriver = createOpenSpecDriver({
    exec: driverExec,
    cwd: repoRoot,
  })

  const deps: OrchestratorDeps = {
    config: {
      repoRoot,
      workDir: path.join(repoRoot, '.sdd-runner'),
      model: 'test-model',
      budget: 5,
    },
    spawn,
    execGit: () => Promise.resolve({ stdout: '', stderr: '' }),
    driver,
    render: (event) => {
      rendered.push(event)
    },
    stdout: (line) => {
      stdoutLines.push(line)
    },
    // Without this, presentGateAt falls back to buildResolveCost(), which fetches the
    // models.dev pricing table over the network. That made every test in this file depend on
    // a live HTTP round trip finishing inside bun's 5s timeout — and when it did not, the
    // afterEach cleanup deleted the run directory while the run was still going, so the real
    // failure surfaced as an unrelated ENOENT on events.ndjson. A unit test has no business
    // reaching the network; the pricing fetch itself is covered hermetically in pricing.test.ts.
    resolveCost: () => null,
  }
  return {
    deps,
    repoRoot,
    changeName,
    changeDir,
    taskFile,
    rendered,
    stdoutLines,
    spawnOrder,
  }
}

function gateEventKinds(events: readonly ReturnType<typeof readEvents>[number][]): string[] {
  return events.filter((e) => e.type === 'gate').map((e) => (e as { action: string }).action)
}

function glmFallbackResolver(
  modelId: string,
): { input: number; output: number; source: 'primary' | 'fallback' } | null {
  const table: Record<string, { input: number; output: number; source: 'primary' | 'fallback' }> = {
    'zai-coding-plan/glm-5.2': { input: 5, output: 15, source: 'fallback' },
  }
  return table[modelId] ?? null
}

describe('holder lifecycle (process ownership)', () => {
  const runDirOf = (fixture: Fixture): string => path.join(fixture.deps.config.workDir, 'runs', 'add-thing')

  it('runStart holds the run during stage work and releases it at the halt', async () => {
    const fixture = makeFixture()
    const inner = fixture.deps.spawn
    const duringWork: boolean[] = []
    const deps: OrchestratorDeps = {
      ...fixture.deps,
      spawn: (command, args, options) => {
        duringWork.push(readHolder(runDirOf(fixture)) !== null)
        return inner(command, args, options)
      },
    }
    const result = await runStart(deps, { taskFile: fixture.taskFile, depthOverride: 'S' })
    expect(result.halted).toBe('gate')
    expect(duringWork.length).toBeGreaterThan(0)
    expect(duringWork.every(Boolean)).toBe(true)
    expect(readHolder(runDirOf(fixture))).toBe(null)
  })

  it('a stage failure still releases the holder — only a hard process death leaves it behind', async () => {
    const fixture = makeFixture()
    const deps: OrchestratorDeps = {
      ...fixture.deps,
      spawn: () => Promise.reject(new Error('agent crashed')),
    }
    const failure = await runStart(deps, { taskFile: fixture.taskFile, depthOverride: 'S' }).catch(
      (error: unknown) => error,
    )
    expect(failure instanceof Error).toBe(true)
    expect(readHolder(runDirOf(fixture))).toBe(null)
  })

  it('an oversize intake routes into the plan branch: no draft/review stages, no parent change folder', async () => {
    const fixture = makeFixture({
      'depth.json': JSON.stringify({
        implicated_files: ['src/a.ts'],
        signals: {
          cross_module: false,
          db_migration: false,
          provider_surface: false,
          credentials: false,
          novelty: 'existing-modules',
        },
        rationale: 'declared scope too large for one change',
        oversize: true,
      }),
      'plan.json': JSON.stringify({
        children: [
          { id: 'auth-db', instruction: 'Add the auth database schema.', deps: [] },
          { id: 'auth-api', instruction: 'Add the auth API endpoints.', deps: ['auth-db'] },
        ],
      }),
    })
    const result = await runStart(fixture.deps, { taskFile: fixture.taskFile })

    expect(result.halted).toBe('gate')
    expect(result.version).toBe(1)
    expect(fs.readFileSync(result.gateMdPath, 'utf8')).toContain('## Plan gate')
    expect(fs.existsSync(fixture.changeDir)).toBe(false)
    expect(fixture.spawnOrder).toEqual(['depth.json', 'plan.json'])

    const state = await loadRunState(fixture.deps.config.workDir, result.runId)
    const plan = state.plan
    assert(plan !== undefined)
    expect(plan.childIds).toEqual(['auth-db', 'auth-api'])
    expect(plan.digest).toMatch(/^[0-9a-f]{16}$/u)
    expect(state.children).toEqual({
      'auth-db': { status: 'pending' },
      'auth-api': { status: 'pending' },
    })
    expect(state.gate).toEqual({ mode: 'plan', version: 1 })
    const events = readEvents(path.join(state.runDir, 'events.ndjson'))
    const stages = events
      .filter(
        (e): e is Extract<ReturnType<typeof readEvents>[number], { type: 'stage_enter' }> => e.type === 'stage_enter',
      )
      .map((e) => e.stage)
    expect(stages).toEqual(['intake'])
    const planEvents = events.filter(
      (e): e is Extract<ReturnType<typeof readEvents>[number], { type: 'plan' }> => e.type === 'plan',
    )
    expect(planEvents).toHaveLength(1)
    expect(planEvents[0]).toMatchObject({ childCount: 2 })
    expect(fs.existsSync(path.join(state.runDir, 'children', '1-auth-db.md'))).toBe(true)
    expect(fs.existsSync(path.join(state.runDir, 'children', '2-auth-api.md'))).toBe(true)
  })
})

describe('runStart', () => {
  it('sequences intake→draft→review→decompose→gate at S, persists state, and drives bus + persister', async () => {
    const fixture = makeFixture()
    const result = await runStart(fixture.deps, {
      taskFile: fixture.taskFile,
      depthOverride: 'S',
    })
    expect(result.halted).toBe('gate')
    expect(result.version).toBe(1)

    const state = await loadRunState(fixture.deps.config.workDir, result.runId)
    expect(state.status).toBe('running')
    expect(state.gate).toEqual({ mode: 'final', version: 1 })
    expect(state.changeName).toBe(fixture.changeName)
    expect(state.depth).toBe('S')

    const events = readEvents(state.statePath.replace('state.json', 'events.ndjson'))
    const stages = events.filter((e) => e.type === 'stage_enter').map((e) => (e as { stage: string }).stage)
    expect(stages).toEqual(['intake', 'draft', 'review', 'decompose', 'gate'])
    expect(events.some((e) => e.type === 'convergence')).toBe(true)

    expect(fixture.rendered.some((e) => e.type === 'stage_enter')).toBe(true)
    expect(fixture.spawnOrder).toEqual([
      'draft-proposal.json',
      'draft-specs.json',
      'findings-1.json',
      'resolutions-1.json',
      'decompose-tasks.json',
    ])
    expect(fs.existsSync(path.join(fixture.changeDir, 'proposal.md'))).toBe(true)
    expect(fs.existsSync(path.join(fixture.changeDir, 'tasks.md'))).toBe(true)
    expect(fs.existsSync(result.gateMdPath)).toBe(true)
    expect(fixture.stdoutLines.some((l) => l.includes(`sdd ${result.runId}`))).toBe(true)
    expect(fixture.stdoutLines.some((l) => l.includes('sdd-runner '))).toBe(false)
  })

  it('drafts design.md at M and runs the atomicity check after decompose', async () => {
    const fixture = makeFixture()
    const result = await runStart(fixture.deps, {
      taskFile: fixture.taskFile,
      depthOverride: 'M',
    })
    expect(result.halted).toBe('gate')
    expect(fs.existsSync(path.join(fixture.changeDir, 'design.md'))).toBe(true)
    expect(fixture.spawnOrder).toContain('draft-design.json')
    expect(fixture.spawnOrder).toContain('atomicity.json')
    expect(fixture.spawnOrder.indexOf('decompose-tasks.json')).toBeLessThan(
      fixture.spawnOrder.indexOf('atomicity.json'),
    )
  })

  it('accepts a verbosity option on StartOptions (carried for the harness renderer)', async () => {
    const fixture = makeFixture()
    const result = await runStart(fixture.deps, {
      taskFile: fixture.taskFile,
      depthOverride: 'S',
      verbosity: 'debug',
    })
    expect(result.halted).toBe('gate')
  })
})

describe('runStart text source (inline session)', () => {
  it('starts from typed text with no task file, naming the session and persisting task.md into the run dir', async () => {
    const fixture = makeFixture()
    const taskText = '# Inline thing\n\nstraight from the operator\n'
    const result = await runStart(fixture.deps, { taskText, changeName: 'inline-thing', depthOverride: 'S' })
    expect(result.halted).toBe('gate')

    const state = await loadRunState(fixture.deps.config.workDir, result.runId)
    expect(state.runId).toBe('inline-thing')
    expect(state.changeName).toBe('inline-thing')
    expect(state.depth).toBe('S')
    const taskRecord = await fs.promises.readFile(path.join(state.runDir, 'task.md'), 'utf8')
    expect(taskRecord).toBe(taskText)
    expect(fs.existsSync(path.join(fixture.repoRoot, 'inline-thing.md'))).toBe(false)
  })

  it('derives the change name from the first heading when only text is given', async () => {
    const fixture = makeFixture()
    const result = await runStart(fixture.deps, {
      taskText: '# Titled By Heading\n\nbody\n',
      depthOverride: 'S',
    })
    const state = await loadRunState(fixture.deps.config.workDir, result.runId)
    expect(state.changeName).toBe('titled-by-heading')
    expect(result.halted).toBe('gate')
  })

  it('refuses to start without either source', async () => {
    const fixture = makeFixture()
    const failure = await runStart(fixture.deps, { depthOverride: 'S' }).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    expect(errorMessageOf(failure)).toBe('runStart requires a task file or inline task text')
  })

  it('falls back to the generic task basename when inline text has no heading', async () => {
    const fixture = makeFixture()
    const result = await runStart(fixture.deps, {
      taskText: 'no heading, just body\n',
      depthOverride: 'S',
    })
    const state = await loadRunState(fixture.deps.config.workDir, result.runId)
    expect(state.changeName).toBe('task')
  })

  it('never writes a run-dir task.md when the task came from a file', async () => {
    const fixture = makeFixture()
    const result = await runStart(fixture.deps, { taskFile: fixture.taskFile, depthOverride: 'S' })
    const state = await loadRunState(fixture.deps.config.workDir, result.runId)
    expect(fs.existsSync(path.join(state.runDir, 'task.md'))).toBe(false)
  })
})

describe('autonomy resolution onto OrchestratorDeps', () => {
  it('runStart accepts deadline overrides; budget stays the config-file ceiling', async () => {
    const fixture = makeFixture()
    const result = await runStart(fixture.deps, {
      taskFile: fixture.taskFile,
      depthOverride: 'S',
      autonomy: { deadlineMinutes: 10 },
    })
    expect(result.halted).toBe('gate')
    const { autonomyOf } = await import('../../sdd-runner/src/config.js')
    expect(autonomyOf(fixture.deps.config, 10)).toMatchObject({ level: 'assist', deadlineMinutes: 10 })
    expect(autonomyOf({ ...fixture.deps.config, budget: 2 })).toMatchObject({ costCeilingUsd: 2 })
  })

  it('the ladder always runs: a converged clean run auto-approves with no level to set', async () => {
    const fixture = makeFixture({
      'resolutions-1.json': JSON.stringify({ resolutions: [], assumptions: [] }),
    })
    const meteredCost = (modelId: string): { input: number; output: number; source: 'primary' } | null => {
      void modelId
      return { input: 1, output: 2, source: 'primary' }
    }
    const deps: OrchestratorDeps = { ...fixture.deps, resolveCost: meteredCost }
    const result = await runStart(deps, { taskFile: fixture.taskFile, depthOverride: 'S' })
    const state = await loadRunState(deps.config.workDir, result.runId)
    expect(state.status).toBe('completed')
    expect(state.gate).toBeNull()
  })

  it('the R4 budget guard fails closed against the config budget', async () => {
    const fixture = makeFixture()
    const meteredCost = (modelId: string): { input: number; output: number; source: 'primary' } | null => {
      void modelId
      return { input: 1, output: 2, source: 'primary' }
    }
    const usageLine = JSON.stringify({
      type: 'step_finish',
      part: { reason: 'stop', tokens: { input: 2_000_000, output: 1_000_000 }, cost: 0 },
    })
    const deps: OrchestratorDeps = {
      ...fixture.deps,
      resolveCost: meteredCost,
      spawn: (command, args, options, onLine) => {
        onLine?.(usageLine)
        return fixture.deps.spawn(command, args, options)
      },
      config: { ...fixture.deps.config, budget: 0.001 },
    }
    const result = await runStart(deps, { taskFile: fixture.taskFile, depthOverride: 'S' })
    const state = await loadRunState(deps.config.workDir, result.runId)
    expect(state.status).toBe('running')
    expect(state.gate).toEqual({ mode: 'final', version: 1 })
  })
})

describe('runResume', () => {
  it('resumes from review without re-running intake or draft', async () => {
    const fixture = makeFixture()
    const workDir = fixture.deps.config.workDir
    const runId = 'seeded-run-1'
    const runDir = path.join(workDir, 'runs', runId)
    fs.mkdirSync(path.join(runDir, 'sidecars'), { recursive: true })
    fs.mkdirSync(path.join(fixture.changeDir, 'specs', 'thing'), {
      recursive: true,
    })
    fs.writeFileSync(path.join(fixture.changeDir, 'proposal.md'), '## Why\nseeded\n')
    fs.writeFileSync(path.join(fixture.changeDir, 'specs', 'thing', 'spec.md'), '## ADDED Requirements\n')
    const events = [
      {
        altitude: 'L2',
        type: 'stage_enter',
        stage: 'intake',
        seq: 1,
        ts: '2026-01-01T00:00:00.000Z',
      },
      {
        altitude: 'L2',
        type: 'depth',
        profile: 'S',
        rationale: 'override',
        source: 'override',
        seq: 2,
        ts: '2026-01-01T00:00:00.000Z',
      },
      {
        altitude: 'L2',
        type: 'stage_exit',
        stage: 'intake',
        seq: 3,
        ts: '2026-01-01T00:00:00.000Z',
      },
      {
        altitude: 'L2',
        type: 'stage_enter',
        stage: 'draft',
        seq: 4,
        ts: '2026-01-01T00:00:00.000Z',
      },
      {
        altitude: 'L2',
        type: 'stage_exit',
        stage: 'draft',
        seq: 5,
        ts: '2026-01-01T00:00:00.000Z',
      },
    ]
    fs.writeFileSync(path.join(runDir, 'events.ndjson'), events.map((e) => JSON.stringify(e)).join('\n') + '\n')
    fs.writeFileSync(
      path.join(runDir, 'state.json'),
      `${JSON.stringify(
        {
          runId,
          repoRoot: fixture.repoRoot,
          workDir,
          changeName: fixture.changeName,
          stage: 'draft',
          depth: 'S',
          round: 0,
          gate: null,
          status: 'running',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        null,
        2,
      )}\n`,
    )

    const calls: string[] = []
    const trackingDriver = createTrackingDriver(fixture, calls)
    const deps: OrchestratorDeps = { ...fixture.deps, driver: trackingDriver }
    const result = await runResume(deps, runId)
    expect(result.halted).toBe('gate')
    expect(calls).not.toContain('proposal')
    expect(calls).not.toContain('specs')
    expect(calls).toContain('tasks')
    expect(fixture.spawnOrder).toContain('findings-1.json')
    expect(fixture.spawnOrder).toContain('decompose-tasks.json')
  })

  it('a review-stage resume forwards conventions and surfaces steer warnings on stdout', async () => {
    const fixture = makeFixture()
    const workDir = fixture.deps.config.workDir
    const runId = 'seeded-review-steer'
    const runDir = path.join(workDir, 'runs', runId)
    fs.mkdirSync(path.join(runDir, 'sidecars'), { recursive: true })
    fs.mkdirSync(path.join(fixture.changeDir, 'specs', 'thing'), { recursive: true })
    fs.writeFileSync(path.join(fixture.changeDir, 'proposal.md'), '## Why\nseeded\n')
    fs.writeFileSync(path.join(fixture.changeDir, 'specs', 'thing', 'spec.md'), '## ADDED Requirements\n')
    const now = '2026-01-01T00:00:00.000Z'
    const events = [
      { altitude: 'L2', type: 'stage_enter', stage: 'intake', seq: 1, ts: now },
      { altitude: 'L2', type: 'depth', profile: 'M', rationale: 'override', source: 'override', seq: 2, ts: now },
      { altitude: 'L2', type: 'stage_exit', stage: 'intake', seq: 3, ts: now },
      { altitude: 'L2', type: 'stage_enter', stage: 'draft', seq: 4, ts: now },
      { altitude: 'L2', type: 'stage_exit', stage: 'draft', seq: 5, ts: now },
      { altitude: 'L2', type: 'stage_enter', stage: 'review', seq: 6, ts: now },
    ]
    fs.writeFileSync(path.join(runDir, 'events.ndjson'), events.map((e) => JSON.stringify(e)).join('\n') + '\n')
    fs.writeFileSync(
      path.join(runDir, 'state.json'),
      `${JSON.stringify(
        {
          runId,
          repoRoot: fixture.repoRoot,
          workDir,
          changeName: fixture.changeName,
          stage: 'draft',
          depth: 'M',
          round: 0,
          gate: null,
          status: 'running',
          createdAt: now,
          updatedAt: now,
        },
        null,
        2,
      )}\n`,
    )
    fs.writeFileSync(path.join(runDir, 'steer.md'), 'nonsense directive\n')

    const reviewerPrompts: string[] = []
    const stdoutLines: string[] = []
    const settled = createSettledDriver(fixture)
    const deps: OrchestratorDeps = {
      ...fixture.deps,
      driver: settled,
      conventions: 'convention sentinel XYZ',
      spawn: (command, args, options) => {
        reviewerPrompts.push(String(args[args.length - 1]))
        return fixture.deps.spawn(command, args, options)
      },
      stdout: (line: string) => {
        stdoutLines.push(line)
      },
    }
    const result = await runResume(deps, runId)
    expect(result.halted).toBe('gate')
    const reviewerSpawns = reviewerPrompts.filter((p) => p.includes('findings-'))
    expect(reviewerSpawns.length).toBeGreaterThan(0)
    expect(reviewerSpawns.every((p) => p.includes('convention sentinel XYZ'))).toBe(true)
    const steerWarnings = stdoutLines.filter((l) => l.startsWith('steer:'))
    expect(steerWarnings.join('\n')).toContain('unknown directive: nonsense directive')
  })

  it('re-enters at decompose after an interrupted post-review stage and continues to the final gate (task 3.3)', async () => {
    const fixture = makeFixture()
    const workDir = fixture.deps.config.workDir
    const runId = 'seeded-decompose'
    const runDir = path.join(workDir, 'runs', runId)
    fs.mkdirSync(path.join(runDir, 'sidecars'), { recursive: true })
    fs.mkdirSync(path.join(fixture.changeDir, 'specs', 'thing'), { recursive: true })
    fs.writeFileSync(path.join(fixture.changeDir, 'proposal.md'), '## Why\nseeded\n')
    fs.writeFileSync(path.join(fixture.changeDir, 'design.md'), '## Context\nseeded\n')
    fs.writeFileSync(path.join(fixture.changeDir, 'specs', 'thing', 'spec.md'), '## ADDED Requirements\n')
    const materialResolution = { id: 'F1', class: 'MATERIAL', resolution: 'edited', outcome: 'narrowed gap' }
    fs.writeFileSync(
      path.join(runDir, 'sidecars', 'resolutions-1.json'),
      JSON.stringify({ resolutions: [materialResolution], assumptions: [] }),
    )
    const now = '2026-01-01T00:00:00.000Z'
    const events = [
      { altitude: 'L2', type: 'stage_enter', stage: 'intake', seq: 1, ts: now },
      { altitude: 'L2', type: 'depth', profile: 'M', rationale: 'override', source: 'override', seq: 2, ts: now },
      { altitude: 'L2', type: 'stage_exit', stage: 'intake', seq: 3, ts: now },
      { altitude: 'L2', type: 'stage_enter', stage: 'draft', seq: 4, ts: now },
      { altitude: 'L2', type: 'stage_exit', stage: 'draft', seq: 5, ts: now },
      { altitude: 'L2', type: 'stage_enter', stage: 'review', seq: 6, ts: now },
      { altitude: 'L2', type: 'round_open', round: 1, cap: 3, seq: 7, ts: now },
      {
        altitude: 'L2',
        type: 'convergence',
        round: 1,
        verdict: 'open',
        counts: { blocker: 0, material: 1, nitpick: 0 },
        seq: 8,
        ts: now,
      },
      { altitude: 'L2', type: 'round_close', round: 1, cap: 3, seq: 9, ts: now },
      { altitude: 'L2', type: 'stage_exit', stage: 'review', seq: 10, ts: now },
      { altitude: 'L2', type: 'gate', action: 'presented', mode: 'early', version: 1, seq: 11, ts: now },
      { altitude: 'L2', type: 'gate', action: 'answered', mode: 'early', version: 1, seq: 12, ts: now },
    ]
    fs.writeFileSync(path.join(runDir, 'events.ndjson'), events.map((e) => JSON.stringify(e)).join('\n') + '\n')
    fs.writeFileSync(
      path.join(runDir, 'state.json'),
      `${JSON.stringify(
        {
          runId,
          repoRoot: fixture.repoRoot,
          workDir,
          changeName: fixture.changeName,
          stage: 'review',
          depth: 'M',
          round: 1,
          gate: null,
          status: 'running',
          createdAt: now,
          updatedAt: now,
        },
        null,
        2,
      )}\n`,
    )

    const deps: OrchestratorDeps = { ...fixture.deps, driver: createSettledDriver(fixture) }
    const before = fixture.spawnOrder.length
    const result = await runResume(deps, runId)

    expect(result.halted).toBe('gate')
    const reviewSpawns = fixture.spawnOrder.slice(before)
    expect(reviewSpawns).not.toContain('findings-1.json')
    expect(reviewSpawns).toContain('decompose-tasks.json')
    expect(reviewSpawns).toContain('atomicity.json')
    const gateMd = fs.readFileSync(requireGateMdPath({ gateMdPath: result.gateMdPath }), 'utf8')
    expect(gateMd).toContain('Final gate')
    const state = await loadRunState(workDir, runId)
    expect(state.gate).toEqual({ mode: 'final', version: 1 })
  })

  it('re-enters at atomicity when tasks are done but the atomicity check is unrecorded', async () => {
    const fixture = makeFixture()
    const workDir = fixture.deps.config.workDir
    const runId = 'seeded-atomicity'
    const runDir = path.join(workDir, 'runs', runId)
    fs.mkdirSync(path.join(runDir, 'sidecars'), { recursive: true })
    fs.mkdirSync(path.join(fixture.changeDir, 'specs', 'thing'), { recursive: true })
    fs.writeFileSync(path.join(fixture.changeDir, 'proposal.md'), '## Why\nseeded\n')
    fs.writeFileSync(path.join(fixture.changeDir, 'design.md'), '## Context\nseeded\n')
    fs.writeFileSync(path.join(fixture.changeDir, 'spec.md'), '## ADDED Requirements\n')
    fs.writeFileSync(path.join(fixture.changeDir, 'tasks.md'), '- [ ] 1. do it\n')
    fs.writeFileSync(
      path.join(runDir, 'sidecars', 'resolutions-1.json'),
      JSON.stringify({
        resolutions: [{ id: 'F1', class: 'MATERIAL', resolution: 'edited', outcome: 'narrowed gap' }],
        assumptions: [],
      }),
    )
    const now = '2026-01-01T00:00:00.000Z'
    const events = [
      { altitude: 'L2', type: 'stage_enter', stage: 'intake', seq: 1, ts: now },
      { altitude: 'L2', type: 'depth', profile: 'M', rationale: 'override', source: 'override', seq: 2, ts: now },
      { altitude: 'L2', type: 'stage_exit', stage: 'intake', seq: 3, ts: now },
      { altitude: 'L2', type: 'stage_enter', stage: 'draft', seq: 4, ts: now },
      { altitude: 'L2', type: 'stage_exit', stage: 'draft', seq: 5, ts: now },
      { altitude: 'L2', type: 'stage_enter', stage: 'review', seq: 6, ts: now },
      { altitude: 'L2', type: 'round_open', round: 1, cap: 3, seq: 7, ts: now },
      {
        altitude: 'L2',
        type: 'convergence',
        round: 1,
        verdict: 'converged',
        counts: { blocker: 0, material: 1, nitpick: 0 },
        seq: 8,
        ts: now,
      },
      { altitude: 'L2', type: 'round_close', round: 1, cap: 3, seq: 9, ts: now },
      { altitude: 'L2', type: 'stage_exit', stage: 'review', seq: 10, ts: now },
    ]
    fs.writeFileSync(path.join(runDir, 'events.ndjson'), events.map((e) => JSON.stringify(e)).join('\n') + '\n')
    fs.writeFileSync(
      path.join(runDir, 'state.json'),
      `${JSON.stringify(
        {
          runId,
          repoRoot: fixture.repoRoot,
          workDir,
          changeName: fixture.changeName,
          stage: 'review',
          depth: 'M',
          round: 1,
          gate: null,
          status: 'running',
          createdAt: now,
          updatedAt: now,
        },
        null,
        2,
      )}\n`,
    )

    const settled = createSettledDriver(fixture)
    const driver: OpenSpecDriver = {
      ...settled,
      status: () =>
        Promise.resolve({
          schemaName: 'auto-sdd',
          artifacts: { proposal: 'done', specs: 'done', design: 'done', tasks: 'done' },
          isPlanningComplete: true,
        }),
    }
    const deps: OrchestratorDeps = { ...fixture.deps, driver }
    const before = fixture.spawnOrder.length
    const result = await runResume(deps, runId)

    expect(result.halted).toBe('gate')
    const spawns = fixture.spawnOrder.slice(before)
    expect(spawns).not.toContain('findings-1.json')
    expect(spawns).toContain('decompose-tasks.json')
    expect(spawns).toContain('atomicity.json')
    expect(fs.existsSync(requireGateMdPath({ gateMdPath: result.gateMdPath }))).toBe(true)
  })

  it('re-enters at gate with the next version when every post-review stage is already done', async () => {
    const fixture = makeFixture()
    const workDir = fixture.deps.config.workDir
    const runId = 'seeded-gate'
    const runDir = path.join(workDir, 'runs', runId)
    fs.mkdirSync(path.join(runDir, 'sidecars'), { recursive: true })
    fs.mkdirSync(path.join(fixture.changeDir, 'specs', 'thing'), { recursive: true })
    fs.writeFileSync(path.join(fixture.changeDir, 'proposal.md'), '## Why\nseeded\n')
    fs.writeFileSync(path.join(fixture.changeDir, 'design.md'), '## Context\nseeded\n')
    fs.writeFileSync(path.join(fixture.changeDir, 'spec.md'), '## ADDED Requirements\n')
    fs.writeFileSync(path.join(fixture.changeDir, 'tasks.md'), '- [ ] 1. do it\n')
    fs.writeFileSync(path.join(runDir, 'gate-1.md'), '# Final gate (stale)\n')
    fs.writeFileSync(
      path.join(runDir, 'sidecars', 'resolutions-1.json'),
      JSON.stringify({ resolutions: [], assumptions: [] }),
    )
    const now = '2026-01-01T00:00:00.000Z'
    const events = [
      { altitude: 'L2', type: 'stage_enter', stage: 'intake', seq: 1, ts: now },
      { altitude: 'L2', type: 'depth', profile: 'M', rationale: 'override', source: 'override', seq: 2, ts: now },
      { altitude: 'L2', type: 'stage_exit', stage: 'intake', seq: 3, ts: now },
      { altitude: 'L2', type: 'stage_enter', stage: 'draft', seq: 4, ts: now },
      { altitude: 'L2', type: 'stage_exit', stage: 'draft', seq: 5, ts: now },
      { altitude: 'L2', type: 'stage_enter', stage: 'review', seq: 6, ts: now },
      { altitude: 'L2', type: 'round_open', round: 1, cap: 3, seq: 7, ts: now },
      {
        altitude: 'L2',
        type: 'convergence',
        round: 1,
        verdict: 'converged',
        counts: { blocker: 0, material: 0, nitpick: 0 },
        seq: 8,
        ts: now,
      },
      { altitude: 'L2', type: 'round_close', round: 1, cap: 3, seq: 9, ts: now },
      { altitude: 'L2', type: 'stage_exit', stage: 'review', seq: 10, ts: now },
      { altitude: 'L2', type: 'stage_enter', stage: 'decompose', seq: 11, ts: now },
      { altitude: 'L2', type: 'stage_exit', stage: 'decompose', seq: 12, ts: now },
      { altitude: 'L2', type: 'stage_enter', stage: 'atomicity', seq: 13, ts: now },
      { altitude: 'L2', type: 'stage_exit', stage: 'atomicity', seq: 14, ts: now },
    ]
    fs.writeFileSync(path.join(runDir, 'events.ndjson'), events.map((e) => JSON.stringify(e)).join('\n') + '\n')
    fs.writeFileSync(
      path.join(runDir, 'state.json'),
      `${JSON.stringify(
        {
          runId,
          repoRoot: fixture.repoRoot,
          workDir,
          changeName: fixture.changeName,
          stage: 'atomicity',
          depth: 'M',
          round: 1,
          gate: null,
          status: 'running',
          createdAt: now,
          updatedAt: now,
        },
        null,
        2,
      )}\n`,
    )

    const settled = createSettledDriver(fixture)
    const driver: OpenSpecDriver = {
      ...settled,
      status: () =>
        Promise.resolve({
          schemaName: 'auto-sdd',
          artifacts: { proposal: 'done', specs: 'done', design: 'done', tasks: 'done' },
          isPlanningComplete: true,
        }),
    }
    const deps: OrchestratorDeps = { ...fixture.deps, driver }
    const result = await runResume(deps, runId)

    expect(result.halted).toBe('gate')
    expect(result.version).toBe(2)
    expect(requireGateMdPath({ gateMdPath: result.gateMdPath })).toContain('gate-2.md')
  })

  it('a cap-hit resume at the gate stage with an answered early gate settles as converged, not cap-hit', async () => {
    const fixture = makeFixture()
    const workDir = fixture.deps.config.workDir
    const runId = 'seeded-gate-caphit'
    const runDir = path.join(workDir, 'runs', runId)
    fs.mkdirSync(path.join(runDir, 'sidecars'), { recursive: true })
    fs.mkdirSync(path.join(fixture.changeDir, 'specs', 'thing'), { recursive: true })
    fs.writeFileSync(path.join(fixture.changeDir, 'proposal.md'), '## Why\nseeded\n')
    fs.writeFileSync(path.join(fixture.changeDir, 'design.md'), '## Context\nseeded\n')
    fs.writeFileSync(path.join(fixture.changeDir, 'spec.md'), '## ADDED Requirements\n')
    fs.writeFileSync(path.join(fixture.changeDir, 'tasks.md'), '- [ ] 1. do it\n')
    fs.writeFileSync(
      path.join(runDir, 'sidecars', 'resolutions-1.json'),
      JSON.stringify({ resolutions: [], assumptions: [] }),
    )
    const now = '2026-01-01T00:00:00.000Z'
    const events = [
      { altitude: 'L2', type: 'stage_enter', stage: 'intake', seq: 1, ts: now },
      { altitude: 'L2', type: 'depth', profile: 'M', rationale: 'override', source: 'override', seq: 2, ts: now },
      { altitude: 'L2', type: 'stage_exit', stage: 'intake', seq: 3, ts: now },
      { altitude: 'L2', type: 'stage_enter', stage: 'draft', seq: 4, ts: now },
      { altitude: 'L2', type: 'stage_exit', stage: 'draft', seq: 5, ts: now },
      { altitude: 'L2', type: 'stage_enter', stage: 'review', seq: 6, ts: now },
      { altitude: 'L2', type: 'round_open', round: 1, cap: 3, seq: 7, ts: now },
      {
        altitude: 'L2',
        type: 'convergence',
        round: 1,
        verdict: 'open',
        counts: { blocker: 0, material: 0, nitpick: 0 },
        seq: 8,
        ts: now,
      },
      { altitude: 'L2', type: 'round_close', round: 1, cap: 3, seq: 9, ts: now },
      { altitude: 'L2', type: 'stage_exit', stage: 'review', seq: 10, ts: now },
      { altitude: 'L2', type: 'stage_enter', stage: 'decompose', seq: 11, ts: now },
      { altitude: 'L2', type: 'stage_exit', stage: 'decompose', seq: 12, ts: now },
      { altitude: 'L2', type: 'stage_enter', stage: 'atomicity', seq: 13, ts: now },
      { altitude: 'L2', type: 'stage_exit', stage: 'atomicity', seq: 14, ts: now },
      { altitude: 'L2', type: 'gate', action: 'presented', mode: 'early', version: 1, seq: 15, ts: now },
      { altitude: 'L2', type: 'gate', action: 'answered', mode: 'early', version: 1, seq: 16, ts: now },
    ]
    fs.writeFileSync(path.join(runDir, 'events.ndjson'), events.map((e) => JSON.stringify(e)).join('\n') + '\n')
    fs.writeFileSync(
      path.join(runDir, 'state.json'),
      `${JSON.stringify(
        {
          runId,
          repoRoot: fixture.repoRoot,
          workDir,
          changeName: fixture.changeName,
          stage: 'atomicity',
          depth: 'M',
          round: 1,
          gate: null,
          status: 'running',
          createdAt: now,
          updatedAt: now,
        },
        null,
        2,
      )}\n`,
    )

    const settled = createSettledDriver(fixture)
    const driver: OpenSpecDriver = {
      ...settled,
      status: () =>
        Promise.resolve({
          schemaName: 'auto-sdd',
          artifacts: { proposal: 'done', specs: 'done', design: 'done', tasks: 'done' },
          isPlanningComplete: true,
        }),
    }
    const deps: OrchestratorDeps = { ...fixture.deps, driver }
    const result = await runResume(deps, runId)

    expect(result.halted).toBe('gate')
    expect(result.version).toBe(1)
    const gateMd = fs.readFileSync(requireGateMdPath({ gateMdPath: result.gateMdPath }), 'utf8')
    // settled by the answered early gate: the ladder auto-approves the converged final gate (single mode),
    // writing the attributed response — no cap-hit extend directive
    expect(gateMd).toContain('## Gate response')
    expect(gateMd).toContain('decided-by: policy R1')
    expect(gateMd).not.toContain('RUN 1 MORE')
    expect(gateMd).not.toContain('→ RUN 1 MORE')
  })
})

function createSettledDriver(fixture: Fixture): OpenSpecDriver {
  return {
    newChange: () => Promise.resolve({ changeName: fixture.changeName }),
    status: () =>
      Promise.resolve({
        schemaName: 'auto-sdd',
        artifacts: { proposal: 'done', specs: 'done', design: 'done' },
        isPlanningComplete: true,
      }),
    instructions: (artifactId: string) =>
      Promise.resolve({
        instruction: `write the ${artifactId}`,
        template: undefined,
        rules: [],
        resolvedOutputPath: path.join(fixture.changeDir, artifactId === 'tasks' ? 'tasks.md' : `${artifactId}.md`),
        existingOutputPaths: [],
        dependencies: [],
      }),
    validateStrict: () => Promise.resolve({ ok: true, output: 'is valid' }),
  }
}

function createTrackingDriver(fixture: Fixture, calls: string[]): OpenSpecDriver {
  return {
    newChange: () => Promise.resolve({ changeName: fixture.changeName }),
    status: () =>
      Promise.resolve({
        schemaName: 'auto-sdd',
        artifacts: { proposal: 'done', specs: 'done' },
        isPlanningComplete: true,
      }),
    instructions: (artifactId) => {
      calls.push(artifactId)
      return Promise.resolve({
        instruction: `write the ${artifactId}`,
        template: undefined,
        rules: [],
        resolvedOutputPath: path.join(fixture.changeDir, artifactId === 'tasks' ? 'tasks.md' : `${artifactId}.md`),
        existingOutputPaths: [],
        dependencies: [],
      })
    },
    validateStrict: () => Promise.resolve({ ok: true, output: 'is valid' }),
  }
}

function requireGateMdPath(result: { readonly gateMdPath?: string }): string {
  if (result.gateMdPath === undefined) throw new Error('expected gateMdPath on the result')
  return result.gateMdPath
}

describe('runResume gate-pending loudness (task 4.3)', () => {
  it('prints that the run awaits a gate decision plus the exact gate command with the run id', async () => {
    const fixture = makeFixture()
    const started = await runStart(fixture.deps, {
      taskFile: fixture.taskFile,
      depthOverride: 'S',
    })
    const result = await runResume(fixture.deps, started.runId)
    expect(result.halted).toBe('gate-pending')
    expect(fixture.stdoutLines.some((l) => l.includes('awaits a gate decision'))).toBe(true)
    expect(fixture.stdoutLines.includes(`sdd ${started.runId}`)).toBe(true)
    expect(fixture.stdoutLines.some((l) => l.includes(started.runId))).toBe(true)
    expect(fixture.stdoutLines.some((l) => l.includes('sdd-runner '))).toBe(false)
  })

  it('halting at a gate prints a copy-pasteable next-step line with the full resume command and run id', async () => {
    const fixture = makeFixture()
    const started = await runStart(fixture.deps, {
      taskFile: fixture.taskFile,
      depthOverride: 'S',
    })
    expect(fixture.stdoutLines.includes(`Next: sdd ${started.runId}`)).toBe(true)
  })
})

describe('runContinue routing (task 4.7)', () => {
  it('routes a gate-pending run into the gate flow', async () => {
    const fixture = makeFixture()
    const started = await runStart(fixture.deps, { taskFile: fixture.taskFile, depthOverride: 'S' })
    const result = await runContinue(fixture.deps, started.runId)
    expect(result.routed).toBe('gate')
    expect(result.runId).toBe(started.runId)
  })

  it('routes a completed run to a report pointer', async () => {
    const fixture = makeFixture()
    const started = await runStart(fixture.deps, { taskFile: fixture.taskFile, depthOverride: 'S' })
    await runGateResume(fixture.deps, started.runId, { confirmAll: true })
    const result = await runContinue(fixture.deps, started.runId)
    expect(result.routed).toBe('report')
    expect(fixture.stdoutLines.some((l) => l.includes(`sdd ${started.runId}`))).toBe(true)
  })

  it('routes an interrupted mid-stage run to stage resume', async () => {
    const fixture = makeFixture()
    const workDir = fixture.deps.config.workDir
    const runId = 'cont-mid'
    const runDir = path.join(workDir, 'runs', runId)
    fs.mkdirSync(path.join(runDir, 'sidecars'), { recursive: true })
    fs.mkdirSync(path.join(fixture.changeDir, 'specs', 'thing'), { recursive: true })
    fs.writeFileSync(path.join(fixture.changeDir, 'proposal.md'), '## Why\nseeded\n')
    fs.writeFileSync(path.join(fixture.changeDir, 'specs', 'thing', 'spec.md'), '## ADDED Requirements\n')
    fs.writeFileSync(
      path.join(runDir, 'events.ndjson'),
      [
        { altitude: 'L2', type: 'stage_enter', stage: 'intake', seq: 1, ts: '2026-01-01T00:00:00.000Z' },
        {
          altitude: 'L2',
          type: 'depth',
          profile: 'S',
          rationale: 'override',
          source: 'override',
          seq: 2,
          ts: '2026-01-01T00:00:00.000Z',
        },
        { altitude: 'L2', type: 'stage_exit', stage: 'intake', seq: 3, ts: '2026-01-01T00:00:00.000Z' },
        { altitude: 'L2', type: 'stage_enter', stage: 'draft', seq: 4, ts: '2026-01-01T00:00:00.000Z' },
        { altitude: 'L2', type: 'stage_exit', stage: 'draft', seq: 5, ts: '2026-01-01T00:00:00.000Z' },
      ]
        .map((e) => JSON.stringify(e))
        .join('\n') + '\n',
    )
    fs.writeFileSync(
      path.join(runDir, 'state.json'),
      `${JSON.stringify(
        {
          runId,
          repoRoot: fixture.repoRoot,
          workDir,
          changeName: fixture.changeName,
          stage: 'draft',
          depth: 'S',
          round: 0,
          gate: null,
          status: 'running',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        null,
        2,
      )}\n`,
    )
    const calls: string[] = []
    const trackingDriver = createTrackingDriver(fixture, calls)
    const deps: OrchestratorDeps = { ...fixture.deps, driver: trackingDriver }
    const result = await runContinue(deps, runId)
    expect(result.routed).toBe('resume')
    expect(result.runId).toBe(runId)
  })

  it('with no id, a single pending/active run routes directly', async () => {
    const fixture = makeFixture()
    const started = await runStart(fixture.deps, { taskFile: fixture.taskFile, depthOverride: 'S' })
    const result = await runContinue(fixture.deps, null)
    expect(result.routed).toBe('gate')
    expect(result.runId).toBe(started.runId)
  })

  it('with no id and several candidate runs, lists them instead of guessing (non-TTY)', async () => {
    const fixture = makeFixture()
    const first = await runStart(fixture.deps, { taskFile: fixture.taskFile, depthOverride: 'S' })
    const fixture2 = makeFixture()
    fs.writeFileSync(fixture2.taskFile, '# Add other thing\n\ndoes another thing\n')
    const second = await runStart(fixture2.deps, { taskFile: fixture2.taskFile, depthOverride: 'S' })
    fs.cpSync(
      path.join(fixture2.deps.config.workDir, 'runs', second.runId),
      path.join(fixture.deps.config.workDir, 'runs', second.runId),
      { recursive: true },
    )
    const result = await runContinue(fixture.deps, null)
    expect(result.routed).toBe('list')
    expect(fixture.stdoutLines.some((l) => l.includes(first.runId))).toBe(true)
    expect(fixture.stdoutLines.some((l) => l.includes(second.runId))).toBe(true)
  })
})

describe('runGateResume flags + TTY wiring (tasks 4.5-4.6)', () => {
  function gatedFixture(): Fixture {
    const assumption = {
      id: 'A1',
      text: 'guests stay read-only',
      basis: 'default',
      confidence: 'medium',
      blast_radius: 'group replies',
      status: 'open',
      evidence: { files: ['openspec/changes/thing/proposal.md'] },
    }
    const fixture = makeFixture({
      'resolutions-1.json': JSON.stringify({ resolutions: [], assumptions: [assumption] }),
    })
    return fixture
  }

  it('non-TTY with no flags parses the hand-edited file and never prompts', async () => {
    const fixture = gatedFixture()
    const started = await runStart(fixture.deps, { taskFile: fixture.taskFile, depthOverride: 'S' })
    const result = await runGateResume(fixture.deps, started.runId, {})
    expect(result.outcome).toBe('veto')
  })

  it('--confirm-all with --veto A1=<redirect> writes the equivalent hand-edited file', async () => {
    const fixture = gatedFixture()
    const started = await runStart(fixture.deps, { taskFile: fixture.taskFile, depthOverride: 'S' })
    const result = await runGateResume(fixture.deps, started.runId, {
      confirmAll: true,
      vetoes: [{ id: 'A1', redirect: 'narrowed to dm-only' }],
    })
    expect(result.outcome).toBe('veto')
    expect(result.version).toBe(2)
    const runDir = path.join(fixture.deps.config.workDir, 'runs', started.runId)
    const gate2 = fs.readFileSync(path.join(runDir, 'gate-2.md'), 'utf8')
    expect(gate2).toContain('- [ ] A1 narrowed to dm-only')
  })

  it('an unknown veto id fails before any pipeline action', async () => {
    const fixture = gatedFixture()
    const started = await runStart(fixture.deps, { taskFile: fixture.taskFile, depthOverride: 'S' })
    const spawnCount = fixture.spawnOrder.length
    await expect(
      runGateResume(fixture.deps, started.runId, { confirmAll: true, vetoes: [{ id: 'Z9' }] }),
    ).rejects.toThrow(/Z9/u)
    expect(fixture.spawnOrder.length).toBe(spawnCount)
  })

  it('--extend desugars to the extend directive outcome', async () => {
    const materialFinding = {
      id: 'F1',
      class: 'MATERIAL',
      gap: 'design lacks rollback',
      question: 'how?',
      code_evidence_attempted: 'searched design.md',
    }
    const materialResolution = { id: 'F1', class: 'MATERIAL', resolution: 'edited', outcome: 'narrowed gap' }
    const fixture = makeFixture({
      'findings-1.json': JSON.stringify({ findings: [materialFinding] }),
      'resolutions-1.json': JSON.stringify({ resolutions: [materialResolution], assumptions: [] }),
      'findings-2.json': JSON.stringify({ findings: [materialFinding] }),
      'resolutions-2.json': JSON.stringify({ resolutions: [materialResolution], assumptions: [] }),
      'findings-3.json': JSON.stringify({ findings: [materialFinding] }),
      'resolutions-3.json': JSON.stringify({ resolutions: [materialResolution], assumptions: [] }),
      'findings-4.json': JSON.stringify({ findings: [materialFinding] }),
      'resolutions-4.json': JSON.stringify({ resolutions: [materialResolution], assumptions: [] }),
    })
    const started = await runStart(fixture.deps, { taskFile: fixture.taskFile, depthOverride: 'M' })
    const result = await runGateResume(fixture.deps, started.runId, { extend: true })
    expect(result.outcome).toBe('extend')
    expect(result.version).toBe(2)
  })

  it('--abort writes ABORT without prompting', async () => {
    const fixture = gatedFixture()
    const started = await runStart(fixture.deps, { taskFile: fixture.taskFile, depthOverride: 'S' })
    const result = await runGateResume(fixture.deps, started.runId, { abort: true })
    expect(result.outcome).toBe('aborted')
    const state = await loadRunState(fixture.deps.config.workDir, started.runId)
    expect(state.status).toBe('aborted')
  })

  it('an abandoned interactive session prints the pending notice, writes nothing, and returns abandoned', async () => {
    const fixture = gatedFixture()
    const started = await runStart(fixture.deps, { taskFile: fixture.taskFile, depthOverride: 'S' })
    const gatePath = path.join(fixture.deps.config.workDir, 'runs', started.runId, 'gate-1.md')
    const before = fs.readFileSync(gatePath, 'utf8')
    const stdoutLines: string[] = []
    const deps: OrchestratorDeps = {
      ...fixture.deps,
      interactive: () => true,
      gateKeyScript: 'q',
      stdout: (line: string) => {
        stdoutLines.push(line)
      },
    }
    const result = await runGateResume(deps, started.runId, {})
    expect(result.outcome).toBe('abandoned')
    expect(stdoutLines.some((l) => l.includes('gate session abandoned'))).toBe(true)
    expect(fs.readFileSync(gatePath, 'utf8')).toBe(before)
    const state = await loadRunState(deps.config.workDir, started.runId)
    expect(state.gate).toEqual({ mode: 'final', version: 1 })
  })

  it('a material finding rides into the resumeGate input and a cap-hit early gate carries the requiredAck', async () => {
    const materialFinding = {
      id: 'F1',
      class: 'MATERIAL',
      gap: 'design lacks rollback',
      question: 'how?',
      code_evidence_attempted: 'searched design.md',
    }
    const materialResolution = { id: 'F1', class: 'MATERIAL', resolution: 'edited', outcome: 'narrowed gap' }
    const fixture = makeFixture({
      'findings-1.json': JSON.stringify({ findings: [materialFinding] }),
      'resolutions-1.json': JSON.stringify({ resolutions: [materialResolution], assumptions: [] }),
      'findings-2.json': JSON.stringify({ findings: [materialFinding] }),
      'resolutions-2.json': JSON.stringify({ resolutions: [materialResolution], assumptions: [] }),
      'findings-3.json': JSON.stringify({ findings: [materialFinding] }),
      'resolutions-3.json': JSON.stringify({ resolutions: [materialResolution], assumptions: [] }),
    })
    const started = await runStart(fixture.deps, { taskFile: fixture.taskFile, depthOverride: 'M' })
    const runDir = path.join(fixture.deps.config.workDir, 'runs', started.runId)
    const gate1 = fs.readFileSync(path.join(runDir, 'gate-1.md'), 'utf8')
    expect(gate1).toContain('- [ ] T1')
    // approve the trajectory but veto the finding: the finding block and T1 ack must re-appear at gate-2
    fs.writeFileSync(path.join(runDir, 'gate-1.md'), gate1.replace('- [ ] T1', '- [x] T1'))
    const result = await runGateResume(fixture.deps, started.runId, {})
    expect(result.outcome).toBe('veto')
    const gate2 = fs.readFileSync(path.join(runDir, 'gate-2.md'), 'utf8')
    expect(gate2).toContain('### Open MATERIAL findings at cap (reviewed)')
    expect(gate2).toContain('- [ ] F1 F1')
    expect(gate2).toContain('resolver: edited — narrowed gap')
    expect(gate2).toContain('- [ ] T1 I reviewed the trajectory')
  })

  it('a TTY with no decision flags runs the interactive session and writes its answers', async () => {
    const fixture = gatedFixture()
    const started = await runStart(fixture.deps, { taskFile: fixture.taskFile, depthOverride: 'S' })
    const deps: OrchestratorDeps = {
      ...fixture.deps,
      interactive: (): boolean => true,
      gateKeyScript: 'a',
    }
    const result = await runGateResume(deps, started.runId, {})
    expect(result.outcome).toBe('approved')
    const state = await loadRunState(fixture.deps.config.workDir, started.runId)
    expect(state.status).toBe('completed')
  })

  it('--veto without --confirm-all counts as a decision flag and is rejected by flag desugaring', async () => {
    const fixture = gatedFixture()
    const started = await runStart(fixture.deps, { taskFile: fixture.taskFile, depthOverride: 'S' })
    await expect(runGateResume(fixture.deps, started.runId, { vetoes: [{ id: 'A1' }] })).rejects.toThrow(
      /no decision flags/u,
    )
  })

  it('an abandoned interactive session writes nothing and leaves the gate pending', async () => {
    const fixture = gatedFixture()
    const started = await runStart(fixture.deps, { taskFile: fixture.taskFile, depthOverride: 'S' })
    const runDir = path.join(fixture.deps.config.workDir, 'runs', started.runId)
    const gate1Path = path.join(runDir, 'gate-1.md')
    const before = fs.readFileSync(gate1Path, 'utf8')
    const deps: OrchestratorDeps = {
      ...fixture.deps,
      interactive: (): boolean => true,
      gateKeyScript: '',
    }
    const result = await runGateResume(deps, started.runId, {})
    expect(result.outcome).toBe('abandoned')
    expect(fixture.stdoutLines.some((line) => line.includes('gate session abandoned'))).toBe(true)
    expect(fs.readFileSync(gate1Path, 'utf8')).toBe(before)
    const state = await loadRunState(fixture.deps.config.workDir, started.runId)
    expect(state.gate).toEqual({ mode: 'final', version: 1 })
  })
})

describe('runGateResume', () => {
  it('halts at an early cap-hit gate with trajectory, open MATERIAL checkboxes, and T1 ack; rejects resume without T1', async () => {
    const materialFinding = {
      id: 'F1',
      class: 'MATERIAL',
      gap: 'design lacks rollback',
      question: 'how?',
      code_evidence_attempted: 'searched design.md',
    }
    const materialResolution = {
      id: 'F1',
      class: 'MATERIAL',
      resolution: 'edited',
      outcome: 'narrowed gap',
    }
    const fixture = makeFixture({
      'findings-1.json': JSON.stringify({ findings: [materialFinding] }),
      'resolutions-1.json': JSON.stringify({
        resolutions: [materialResolution],
        assumptions: [],
      }),
      'findings-2.json': JSON.stringify({ findings: [materialFinding] }),
      'resolutions-2.json': JSON.stringify({
        resolutions: [materialResolution],
        assumptions: [],
      }),
      'findings-3.json': JSON.stringify({ findings: [materialFinding] }),
      'resolutions-3.json': JSON.stringify({
        resolutions: [materialResolution],
        assumptions: [],
      }),
    })
    const started = await runStart(fixture.deps, {
      taskFile: fixture.taskFile,
      depthOverride: 'M',
    })
    expect(started.halted).toBe('gate')

    const gateMd = fs.readFileSync(started.gateMdPath, 'utf8')
    expect(gateMd).toContain('### Cap-hit trajectory')
    expect(gateMd).toContain('round 1:')
    expect(gateMd).toContain('round 2:')
    expect(gateMd).toContain('round 3:')
    expect(gateMd).toContain('### Open MATERIAL findings at cap (reviewed)')
    expect(gateMd).toContain('- [ ] F1')
    expect(gateMd).toContain('resolver: edited — narrowed gap')
    expect(gateMd).toContain('### Trajectory reviewed')
    expect(gateMd).toContain('- [ ] T1')

    await expect(runGateResume(fixture.deps, started.runId, {})).rejects.toThrow(/T1/u)
  })

  it('records a veto when an open-MATERIAL-finding box is left unchecked at the cap-hit gate', async () => {
    const materialFinding = {
      id: 'F1',
      class: 'MATERIAL',
      gap: 'design lacks rollback',
      question: 'how?',
      code_evidence_attempted: 'searched design.md',
    }
    const materialResolution = {
      id: 'F1',
      class: 'MATERIAL',
      resolution: 'edited',
      outcome: 'narrowed gap',
    }
    const fixture = makeFixture({
      'findings-1.json': JSON.stringify({ findings: [materialFinding] }),
      'resolutions-1.json': JSON.stringify({
        resolutions: [materialResolution],
        assumptions: [],
      }),
      'findings-2.json': JSON.stringify({ findings: [materialFinding] }),
      'resolutions-2.json': JSON.stringify({
        resolutions: [materialResolution],
        assumptions: [],
      }),
      'findings-3.json': JSON.stringify({ findings: [materialFinding] }),
      'resolutions-3.json': JSON.stringify({
        resolutions: [materialResolution],
        assumptions: [],
      }),
    })
    const started = await runStart(fixture.deps, {
      taskFile: fixture.taskFile,
      depthOverride: 'M',
    })
    const gatePath = path.join(fixture.deps.config.workDir, 'runs', started.runId, 'gate-1.md')
    const gateMd = fs.readFileSync(gatePath, 'utf8')
    fs.writeFileSync(gatePath, gateMd.replace('- [ ] T1', '- [x] T1'))

    const result = await runGateResume(fixture.deps, started.runId, {})
    expect(result.outcome).toBe('veto')
    expect(result.version).toBe(2)

    // a veto at an early cap-hit gate re-presents an early gate, not a final one
    const gate2 = fs.readFileSync(path.join(fixture.deps.config.workDir, 'runs', started.runId, 'gate-2.md'), 'utf8')
    expect(gate2).toContain('Early gate')
  })

  it('marks the run completed on an approved gate', async () => {
    const fixture = makeFixture()
    const started = await runStart(fixture.deps, {
      taskFile: fixture.taskFile,
      depthOverride: 'S',
    })
    const gatePath = path.join(fixture.deps.config.workDir, 'runs', started.runId, 'gate-1.md')
    const gateMd = fs.readFileSync(gatePath, 'utf8')
    fs.writeFileSync(gatePath, gateMd.replace(/- \[ \] /gu, '- [x] '))
    const result = await runGateResume(fixture.deps, started.runId, {})
    expect(result.outcome).toBe('approved')
    const state = await loadRunState(fixture.deps.config.workDir, started.runId)
    expect(state.status).toBe('completed')
    expect(state.gate).toBeNull()
  })

  it('continues into decompose + atomicity + final gate on an approved early gate, without completing (task 1.1)', async () => {
    const materialFinding = {
      id: 'F1',
      class: 'MATERIAL',
      gap: 'design lacks rollback',
      question: 'how?',
      code_evidence_attempted: 'searched design.md',
    }
    const materialResolution = {
      id: 'F1',
      class: 'MATERIAL',
      resolution: 'edited',
      outcome: 'narrowed gap',
    }
    const fixture = makeFixture({
      'findings-1.json': JSON.stringify({ findings: [materialFinding] }),
      'resolutions-1.json': JSON.stringify({
        resolutions: [materialResolution],
        assumptions: [],
      }),
      'findings-2.json': JSON.stringify({ findings: [materialFinding] }),
      'resolutions-2.json': JSON.stringify({
        resolutions: [materialResolution],
        assumptions: [],
      }),
      'findings-3.json': JSON.stringify({ findings: [materialFinding] }),
      'resolutions-3.json': JSON.stringify({
        resolutions: [materialResolution],
        assumptions: [],
      }),
    })
    const started = await runStart(fixture.deps, {
      taskFile: fixture.taskFile,
      depthOverride: 'M',
    })
    const runDir = path.join(fixture.deps.config.workDir, 'runs', started.runId)
    expect(fs.readFileSync(path.join(runDir, 'gate-1.md'), 'utf8')).toContain('Early gate')

    const result = await runGateResume(fixture.deps, started.runId, {
      confirmAll: true,
    })

    expect(result.outcome).toBe('approved')
    expect(result.version).toBe(2)
    const gate2 = fs.readFileSync(requireGateMdPath(result), 'utf8')
    expect(gate2).toContain('Final gate')
    expect(fixture.spawnOrder).toContain('decompose-tasks.json')
    expect(fixture.spawnOrder).toContain('atomicity.json')
    expect(fixture.spawnOrder.indexOf('decompose-tasks.json')).toBeLessThan(
      fixture.spawnOrder.indexOf('atomicity.json'),
    )
    expect(fs.existsSync(path.join(fixture.changeDir, 'tasks.md'))).toBe(true)

    const state = await loadRunState(fixture.deps.config.workDir, started.runId)
    expect(state.status).toBe('running')
    expect(state.gate).toEqual({ mode: 'final', version: 2 })
  })

  it('skips atomicity but still reaches the final gate when an approved early gate continues at S (task 1.2)', async () => {
    const materialFinding = {
      id: 'F1',
      class: 'MATERIAL',
      gap: 'design lacks rollback',
      question: 'how?',
      code_evidence_attempted: 'searched design.md',
    }
    const materialResolution = {
      id: 'F1',
      class: 'MATERIAL',
      resolution: 'edited',
      outcome: 'narrowed gap',
    }
    const fixture = makeFixture({
      'findings-1.json': JSON.stringify({ findings: [materialFinding] }),
      'resolutions-1.json': JSON.stringify({
        resolutions: [materialResolution],
        assumptions: [],
      }),
    })
    const started = await runStart(fixture.deps, {
      taskFile: fixture.taskFile,
      depthOverride: 'S',
    })
    const runDir = path.join(fixture.deps.config.workDir, 'runs', started.runId)
    expect(fs.readFileSync(path.join(runDir, 'gate-1.md'), 'utf8')).toContain('Early gate')

    const result = await runGateResume(fixture.deps, started.runId, {
      confirmAll: true,
    })

    expect(result.outcome).toBe('approved')
    expect(result.version).toBe(2)
    expect(fs.readFileSync(requireGateMdPath(result), 'utf8')).toContain('Final gate')
    expect(fixture.spawnOrder).toContain('decompose-tasks.json')
    expect(fixture.spawnOrder).not.toContain('atomicity.json')

    const state = await loadRunState(fixture.deps.config.workDir, started.runId)
    expect(state.status).toBe('running')
    expect(state.gate).toEqual({ mode: 'final', version: 2 })
  })

  it('completes the run only when the final gate is approved (task 1.4)', async () => {
    const fixture = makeFixture()
    const started = await runStart(fixture.deps, {
      taskFile: fixture.taskFile,
      depthOverride: 'S',
    })
    const runDir = path.join(fixture.deps.config.workDir, 'runs', started.runId)
    const gate1 = fs.readFileSync(path.join(runDir, 'gate-1.md'), 'utf8')
    expect(gate1).toContain('Final gate')

    const result = await runGateResume(fixture.deps, started.runId, {
      confirmAll: true,
    })
    expect(result.outcome).toBe('approved')
    const state = await loadRunState(fixture.deps.config.workDir, started.runId)
    expect(state.status).toBe('completed')
    expect(state.gate).toBeNull()
    expect(fs.existsSync(path.join(fixture.changeDir, 'tasks.md'))).toBe(true)
  })

  it('aborts at an early gate without running decompose (abort is the only early exit)', async () => {
    const materialFinding = {
      id: 'F1',
      class: 'MATERIAL',
      gap: 'design lacks rollback',
      question: 'how?',
      code_evidence_attempted: 'searched design.md',
    }
    const materialResolution = {
      id: 'F1',
      class: 'MATERIAL',
      resolution: 'edited',
      outcome: 'narrowed gap',
    }
    const fixture = makeFixture({
      'findings-1.json': JSON.stringify({ findings: [materialFinding] }),
      'resolutions-1.json': JSON.stringify({
        resolutions: [materialResolution],
        assumptions: [],
      }),
    })
    const started = await runStart(fixture.deps, {
      taskFile: fixture.taskFile,
      depthOverride: 'S',
    })
    const result = await runGateResume(fixture.deps, started.runId, {
      abort: true,
    })
    expect(result.outcome).toBe('aborted')
    const state = await loadRunState(fixture.deps.config.workDir, started.runId)
    expect(state.status).toBe('aborted')
    expect(fixture.spawnOrder).not.toContain('decompose-tasks.json')
  })

  it('treats a nitpick-only cap-hit as converged and flows into decompose + atomicity + final gate (task 2.1)', async () => {
    const nitpicks = [1, 2, 3, 4].map((n) => ({
      id: `F${n}`,
      class: 'NITPICK',
      gap: `wording wobble ${n}`,
      question: 'minor',
      code_evidence_attempted: 'searched design.md',
    }))
    const nitpickResolutions = [1, 2, 3, 4].map((n) => ({
      id: `F${n}`,
      class: 'NITPICK',
      resolution: 'dismissed',
      justification: `cosmetic ${n}`,
    }))
    const rounds: Record<string, string> = {}
    for (const round of [1, 2, 3]) {
      rounds[`findings-${round}.json`] = JSON.stringify({ findings: nitpicks })
      rounds[`resolutions-${round}.json`] = JSON.stringify({ resolutions: nitpickResolutions, assumptions: [] })
    }
    const fixture = makeFixture(rounds)
    const started = await runStart(fixture.deps, { taskFile: fixture.taskFile, depthOverride: 'M' })

    expect(started.version).toBe(1)
    const gate1 = fs.readFileSync(started.gateMdPath, 'utf8')
    expect(gate1).toContain('Final gate')
    expect(gate1).not.toContain('Early gate')
    expect(fixture.spawnOrder).toContain('decompose-tasks.json')
    expect(fixture.spawnOrder).toContain('atomicity.json')
    expect(fs.existsSync(path.join(fixture.changeDir, 'tasks.md'))).toBe(true)

    const state = await loadRunState(fixture.deps.config.workDir, started.runId)
    expect(state.gate).toEqual({ mode: 'final', version: 1 })
    expect(state.status).toBe('running')
  })

  it('still presents an early gate and halts when a BLOCKER is open at cap (task 2.3)', async () => {
    const blockerFinding = {
      id: 'B1',
      class: 'BLOCKER',
      gap: 'no rollback path',
      question: 'how?',
      code_evidence_attempted: 'searched design.md',
    }
    const blockerResolution = { id: 'B1', class: 'BLOCKER', resolution: 'assumed', outcome: 'defaulted' }
    const rounds: Record<string, string> = {}
    for (const round of [1, 2, 3]) {
      rounds[`findings-${round}.json`] = JSON.stringify({ findings: [blockerFinding] })
      rounds[`resolutions-${round}.json`] = JSON.stringify({ resolutions: [blockerResolution], assumptions: [] })
    }
    rounds['findings-skeptic-3.json'] = JSON.stringify({ findings: [blockerFinding] })
    const fixture = makeFixture(rounds)
    const started = await runStart(fixture.deps, { taskFile: fixture.taskFile, depthOverride: 'M' })

    const gate1 = fs.readFileSync(started.gateMdPath, 'utf8')
    expect(gate1).toContain('Early gate')
    expect(fixture.spawnOrder).not.toContain('decompose-tasks.json')
    const state = await loadRunState(fixture.deps.config.workDir, started.runId)
    expect(state.gate).toEqual({ mode: 'early', version: 1 })
    expect(fs.existsSync(path.join(fixture.changeDir, 'tasks.md'))).toBe(false)
  })

  it('a --confirm-all at an early gate with an open BLOCKER overrides it and continues to the final gate', async () => {
    const blockerFinding = {
      id: 'B1',
      class: 'BLOCKER',
      gap: 'no rollback path',
      question: 'how?',
      code_evidence_attempted: 'searched design.md',
    }
    const blockerResolution = { id: 'B1', class: 'BLOCKER', resolution: 'assumed', outcome: 'defaulted' }
    const rounds: Record<string, string> = {}
    for (const round of [1, 2, 3]) {
      rounds[`findings-${round}.json`] = JSON.stringify({ findings: [blockerFinding] })
      rounds[`resolutions-${round}.json`] = JSON.stringify({ resolutions: [blockerResolution], assumptions: [] })
    }
    rounds['findings-skeptic-3.json'] = JSON.stringify({ findings: [blockerFinding] })
    const fixture = makeFixture(rounds)
    const started = await runStart(fixture.deps, { taskFile: fixture.taskFile, depthOverride: 'M' })

    const result = await runGateResume(fixture.deps, started.runId, { confirmAll: true })
    expect(result.outcome).toBe('approved')
    const runDir = path.join(fixture.deps.config.workDir, 'runs', started.runId)
    const answered = fs.readFileSync(path.join(runDir, 'gate-1.md'), 'utf8')
    expect(answered).toContain('→ OVERRIDE')
    const state = await loadRunState(fixture.deps.config.workDir, started.runId)
    expect(state.gate?.mode).toBe('final')
  })

  it('marks the run aborted on an ABORT gate response', async () => {
    const fixture = makeFixture()
    const started = await runStart(fixture.deps, {
      taskFile: fixture.taskFile,
      depthOverride: 'S',
    })
    fs.writeFileSync(path.join(fixture.deps.config.workDir, 'runs', started.runId, 'gate-1.md'), 'ABORT\n')
    const result = await runGateResume(fixture.deps, started.runId, {})
    expect(result.outcome).toBe('aborted')
    const state = await loadRunState(fixture.deps.config.workDir, started.runId)
    expect(state.status).toBe('aborted')
  })

  it('runs the drift-check resolver when a spec changed while gate-pending', async () => {
    const fixture = makeFixture()
    const started = await runStart(fixture.deps, {
      taskFile: fixture.taskFile,
      depthOverride: 'S',
    })
    fs.writeFileSync(
      path.join(fixture.changeDir, 'specs', 'thing', 'spec.md'),
      '## ADDED Requirements\n### Requirement: Hand-edit\n',
    )
    const before = fixture.spawnOrder.length
    const gatePath = path.join(fixture.deps.config.workDir, 'runs', started.runId, 'gate-1.md')
    const gateMd = fs.readFileSync(gatePath, 'utf8')
    fs.writeFileSync(gatePath, gateMd.replace(/- \[ \] /gu, '- [x] '))
    const result = await runGateResume(fixture.deps, started.runId, {})
    expect(result.outcome).toBe('approved')
    const driftSpawn = fixture.spawnOrder.slice(before).find((name) => name === 'drift.json')
    expect(driftSpawn).toBe('drift.json')
  })

  it('runs the veto updater at the final gate and re-presents gate-2 with redirected assumption text and new artifact hashes', async () => {
    const assumption = {
      id: 'A1',
      text: 'guests stay read-only',
      basis: 'default',
      confidence: 'medium',
      blast_radius: 'group replies',
      status: 'open',
      evidence: { files: ['openspec/changes/thing/proposal.md'] },
    }
    const fixture = makeFixture({
      'resolutions-1.json': JSON.stringify({
        resolutions: [],
        assumptions: [assumption],
      }),
    })
    const started = await runStart(fixture.deps, {
      taskFile: fixture.taskFile,
      depthOverride: 'S',
    })
    const runDir = path.join(fixture.deps.config.workDir, 'runs', started.runId)
    const gate1Path = path.join(runDir, 'gate-1.md')
    const gate1 = fs.readFileSync(gate1Path, 'utf8')
    expect(gate1).toContain('- [ ] A1 guests stay read-only')
    fs.writeFileSync(
      gate1Path,
      gate1.replace('- [ ] A1 guests stay read-only', '- [ ] A1 guests stay read-only\n→ narrowed to dm-only'),
    )

    const result = await runGateResume(fixture.deps, started.runId, {})
    expect(result.outcome).toBe('veto')
    expect(result.version).toBe(2)

    const gate2 = fs.readFileSync(path.join(runDir, 'gate-2.md'), 'utf8')
    expect(gate2).toContain('- [ ] A1 narrowed to dm-only')

    const HashesSchema = z.record(z.string(), z.string())
    const hashes1 = HashesSchema.parse(JSON.parse(fs.readFileSync(path.join(runDir, 'gate-hashes-1.json'), 'utf8')))
    const hashes2 = HashesSchema.parse(JSON.parse(fs.readFileSync(path.join(runDir, 'gate-hashes-2.json'), 'utf8')))
    expect(hashes1['proposal.md']).not.toBe(hashes2['proposal.md'])
    expect(fixture.spawnOrder).toContain('veto-updater.json')
  })

  it('extends by one round on → RUN 1 MORE at an early cap-hit gate (task 5.1)', async () => {
    const materialFinding = {
      id: 'F1',
      class: 'MATERIAL',
      gap: 'design lacks rollback',
      question: 'how?',
      code_evidence_attempted: 'searched design.md',
    }
    const materialResolution = {
      id: 'F1',
      class: 'MATERIAL',
      resolution: 'edited',
      outcome: 'narrowed gap',
    }
    const fixture = makeFixture({
      'findings-1.json': JSON.stringify({ findings: [materialFinding] }),
      'resolutions-1.json': JSON.stringify({
        resolutions: [materialResolution],
        assumptions: [],
      }),
      'findings-2.json': JSON.stringify({ findings: [materialFinding] }),
      'resolutions-2.json': JSON.stringify({
        resolutions: [materialResolution],
        assumptions: [],
      }),
      'findings-3.json': JSON.stringify({ findings: [materialFinding] }),
      'resolutions-3.json': JSON.stringify({
        resolutions: [materialResolution],
        assumptions: [],
      }),
      'findings-4.json': JSON.stringify({ findings: [materialFinding] }),
      'resolutions-4.json': JSON.stringify({
        resolutions: [materialResolution],
        assumptions: [],
      }),
    })
    const started = await runStart(fixture.deps, {
      taskFile: fixture.taskFile,
      depthOverride: 'M',
    })
    const runDir = path.join(fixture.deps.config.workDir, 'runs', started.runId)
    const gate1Path = path.join(runDir, 'gate-1.md')
    fs.writeFileSync(gate1Path, '→ RUN 1 MORE\n')

    const result = await runGateResume(fixture.deps, started.runId, {})
    expect(result.outcome).toBe('extend')
    expect(result.version).toBe(2)
    expect(result.gateMdPath).toBeDefined()

    const state = await loadRunState(fixture.deps.config.workDir, started.runId)
    expect(state.roundCap).toBe(4)
    expect(state.round).toBe(4)
    expect(state.gate).toEqual({ mode: 'early', version: 2 })

    const events = readEvents(path.join(fixture.deps.config.workDir, 'runs', started.runId, 'events.ndjson'))
    const round4 = events.filter((e) => e.type === 'round_open').filter((e) => (e as { round: number }).round === 4)
    expect(round4).toHaveLength(1)
    expect(round4[0]).toMatchObject({ type: 'round_open', round: 4, cap: 4 })
    // the extended round enters directly at round 4 — no re-run of rounds 1-3
    const allOpens = events.filter((e) => e.type === 'round_open')
    expect(allOpens.map((e) => (e as { round: number }).round)).toEqual([1, 2, 3, 4])

    expect(fs.existsSync(path.join(runDir, 'gate-2.md'))).toBe(true)
    const gate2 = fs.readFileSync(path.join(runDir, 'gate-2.md'), 'utf8')
    expect(gate2).toContain('round 4:')
  })

  it('an extend round surfaces steer warnings through stdout and forwards conventions to the reviewer', async () => {
    const materialFinding = {
      id: 'F1',
      class: 'MATERIAL',
      gap: 'design lacks rollback',
      question: 'how?',
      code_evidence_attempted: 'searched design.md',
    }
    const materialResolution = { id: 'F1', class: 'MATERIAL', resolution: 'edited', outcome: 'narrowed gap' }
    const fixture = makeFixture({
      'findings-1.json': JSON.stringify({ findings: [materialFinding] }),
      'resolutions-1.json': JSON.stringify({ resolutions: [materialResolution], assumptions: [] }),
      'findings-2.json': JSON.stringify({ findings: [materialFinding] }),
      'resolutions-2.json': JSON.stringify({ resolutions: [materialResolution], assumptions: [] }),
      'findings-3.json': JSON.stringify({ findings: [materialFinding] }),
      'resolutions-3.json': JSON.stringify({ resolutions: [materialResolution], assumptions: [] }),
      'findings-4.json': JSON.stringify({ findings: [materialFinding] }),
      'resolutions-4.json': JSON.stringify({ resolutions: [materialResolution], assumptions: [] }),
    })
    const stdoutLines: string[] = []
    const deps: OrchestratorDeps = {
      ...fixture.deps,
      conventions: 'convention sentinel for extend',
      stdout: (line: string) => {
        stdoutLines.push(line)
      },
    }
    const started = await runStart(deps, { taskFile: fixture.taskFile, depthOverride: 'M' })
    const runDir = path.join(deps.config.workDir, 'runs', started.runId)
    fs.writeFileSync(path.join(runDir, 'steer.md'), 'bogus directive\n')
    fs.writeFileSync(path.join(runDir, 'gate-1.md'), '→ RUN 1 MORE\n')

    const result = await runGateResume(deps, started.runId, {})
    expect(result.outcome).toBe('extend')
    const steerWarnings = stdoutLines.filter((l) => l.startsWith('steer:'))
    expect(steerWarnings.join('\n')).toContain('unknown directive: bogus directive')
  })

  it('flows into decompose + final gate when the extended round converges (task 5.2)', async () => {
    const materialFinding = {
      id: 'F1',
      class: 'MATERIAL',
      gap: 'design lacks rollback',
      question: 'how?',
      code_evidence_attempted: 'searched design.md',
    }
    const materialResolution = {
      id: 'F1',
      class: 'MATERIAL',
      resolution: 'edited',
      outcome: 'narrowed gap',
    }
    const convergedResolution = {
      id: 'F1',
      class: 'NITPICK',
      resolution: 'edited',
      outcome: 'specs clarified',
    }
    const fixture = makeFixture({
      'findings-1.json': JSON.stringify({ findings: [materialFinding] }),
      'resolutions-1.json': JSON.stringify({
        resolutions: [materialResolution],
        assumptions: [],
      }),
      'findings-2.json': JSON.stringify({ findings: [materialFinding] }),
      'resolutions-2.json': JSON.stringify({
        resolutions: [materialResolution],
        assumptions: [],
      }),
      'findings-3.json': JSON.stringify({ findings: [materialFinding] }),
      'resolutions-3.json': JSON.stringify({
        resolutions: [materialResolution],
        assumptions: [],
      }),
      'findings-4.json': JSON.stringify({ findings: [] }),
      'resolutions-4.json': JSON.stringify({
        resolutions: [convergedResolution],
        assumptions: [],
      }),
    })
    const started = await runStart(fixture.deps, {
      taskFile: fixture.taskFile,
      depthOverride: 'M',
    })
    const runDir = path.join(fixture.deps.config.workDir, 'runs', started.runId)
    fs.writeFileSync(path.join(runDir, 'gate-1.md'), '→ RUN 1 MORE\n')

    const result = await runGateResume(fixture.deps, started.runId, {})
    expect(result.outcome).toBe('extend')
    expect(result.version).toBe(2)

    const state = await loadRunState(fixture.deps.config.workDir, started.runId)
    expect(state.roundCap).toBe(4)
    expect(state.round).toBe(4)
    expect(state.gate).toEqual({ mode: 'final', version: 2 })

    const gate2 = fs.readFileSync(path.join(runDir, 'gate-2.md'), 'utf8')
    expect(gate2).toContain('Final gate')
    expect(fixture.spawnOrder).toContain('decompose-tasks.json')
    expect(fixture.spawnOrder).toContain('atomicity.json')
  })

  it('repeated extend bumps roundCap each time and appends a trajectory row (task 5.3)', async () => {
    const materialFinding = {
      id: 'F1',
      class: 'MATERIAL',
      gap: 'design lacks rollback',
      question: 'how?',
      code_evidence_attempted: 'searched design.md',
    }
    const materialResolution = {
      id: 'F1',
      class: 'MATERIAL',
      resolution: 'edited',
      outcome: 'narrowed gap',
    }
    const fixture = makeFixture({
      'findings-1.json': JSON.stringify({ findings: [materialFinding] }),
      'resolutions-1.json': JSON.stringify({
        resolutions: [materialResolution],
        assumptions: [],
      }),
      'findings-2.json': JSON.stringify({ findings: [materialFinding] }),
      'resolutions-2.json': JSON.stringify({
        resolutions: [materialResolution],
        assumptions: [],
      }),
      'findings-3.json': JSON.stringify({ findings: [materialFinding] }),
      'resolutions-3.json': JSON.stringify({
        resolutions: [materialResolution],
        assumptions: [],
      }),
    })
    const started = await runStart(fixture.deps, {
      taskFile: fixture.taskFile,
      depthOverride: 'S',
    })
    const runDir = path.join(fixture.deps.config.workDir, 'runs', started.runId)

    fs.writeFileSync(path.join(runDir, 'gate-1.md'), '→ RUN 1 MORE\n')
    const first = await runGateResume(fixture.deps, started.runId, {})
    expect(first.outcome).toBe('extend')
    expect(first.version).toBe(2)
    let state = await loadRunState(fixture.deps.config.workDir, started.runId)
    expect(state.roundCap).toBe(2)

    fs.writeFileSync(path.join(runDir, 'gate-2.md'), '→ RUN 1 MORE\n')
    const second = await runGateResume(fixture.deps, started.runId, {})
    expect(second.outcome).toBe('extend')
    expect(second.version).toBe(3)

    state = await loadRunState(fixture.deps.config.workDir, started.runId)
    expect(state.roundCap).toBe(3)
    expect(state.round).toBe(3)
    expect(state.gate).toEqual({ mode: 'early', version: 3 })

    const gate3 = fs.readFileSync(path.join(runDir, 'gate-3.md'), 'utf8')
    expect(gate3).toContain('round 1:')
    expect(gate3).toContain('round 2:')
    expect(gate3).toContain('round 3:')
  })

  it('rejects resuming a run that is not gate-pending', async () => {
    const fixture = makeFixture()
    const started = await runStart(fixture.deps, { taskFile: fixture.taskFile, depthOverride: 'S' })
    await runGateResume(fixture.deps, started.runId, { confirmAll: true })
    await expect(runGateResume(fixture.deps, started.runId, {})).rejects.toThrow(/not gate-pending/u)
  })

  async function vetoAtFinalGate(
    vetoUpdaterFiles: string[],
  ): Promise<{ fixture: Fixture; result: RunGateResumeResult; spawnsAfterVeto: string[] }> {
    const assumption = {
      id: 'A1',
      text: 'guests stay read-only',
      basis: 'default',
      confidence: 'medium',
      blast_radius: 'group replies',
      status: 'open',
      evidence: { files: ['openspec/changes/thing/proposal.md'] },
    }
    const fixture = makeFixture({
      'resolutions-1.json': JSON.stringify({ resolutions: [], assumptions: [assumption] }),
      'veto-updater.json': JSON.stringify({ files_updated: vetoUpdaterFiles }),
    })
    const started = await runStart(fixture.deps, { taskFile: fixture.taskFile, depthOverride: 'S' })
    const gate1Path = path.join(fixture.deps.config.workDir, 'runs', started.runId, 'gate-1.md')
    const gate1 = fs.readFileSync(gate1Path, 'utf8')
    fs.writeFileSync(
      gate1Path,
      gate1.replace('- [ ] A1 guests stay read-only', '- [ ] A1 guests stay read-only\n→ narrower'),
    )
    const before = fixture.spawnOrder.length
    const result = await runGateResume(fixture.deps, started.runId, {})
    expect(result.outcome).toBe('veto')
    return { fixture, result, spawnsAfterVeto: fixture.spawnOrder.slice(before) }
  }

  it('skips the drift resolver when the veto updater touched only non-spec files', async () => {
    const { spawnsAfterVeto } = await vetoAtFinalGate(['openspec/changes/add-thing/proposal.md'])
    expect(spawnsAfterVeto).toContain('veto-updater.json')
    expect(spawnsAfterVeto).not.toContain('drift.json')
  })

  it('runs the drift resolver when the veto updater touched a spec file', async () => {
    const { spawnsAfterVeto } = await vetoAtFinalGate([
      'openspec/changes/add-thing/proposal.md',
      'openspec/changes/add-thing/specs/thing/spec.md',
    ])
    expect(spawnsAfterVeto).toContain('drift.json')
  })

  it('runs the drift resolver when the veto updater touched tasks.md', async () => {
    const { spawnsAfterVeto } = await vetoAtFinalGate(['openspec/changes/add-thing/tasks.md'])
    expect(spawnsAfterVeto).toContain('drift.json')
  })
})

describe('presentGateAt cost fallback', () => {
  it('reprices a zero-cost subscription run into a non-zero estimated gate line', async () => {
    const repoRoot = makeDir()
    const workDir = path.join(repoRoot, '.sdd-runner')
    const changeDir = path.join(repoRoot, 'openspec', 'changes', 'add-thing')
    fs.mkdirSync(changeDir, { recursive: true })
    fs.writeFileSync(path.join(changeDir, 'proposal.md'), '## Why\nseeded\n')

    const now = new Date('2026-01-01T00:00:00.000Z')
    const state: RunState = await createRunState({ workDir, repoRoot, changeName: 'add-thing' }, now)
    const events = [
      {
        altitude: 'L1',
        type: 'spawned',
        agent: 'drafter-1',
        role: 'drafter',
        model: 'zai-coding-plan/glm-5.2',
        seq: 1,
        ts: now.toISOString(),
      },
      {
        altitude: 'L1',
        type: 'done',
        agent: 'drafter-1',
        usage: {
          inputTokens: 1_000_000,
          outputTokens: 500_000,
          reasoningTokens: 0,
          costUsd: 0,
          wallMs: 1000,
        },
        seq: 2,
        ts: now.toISOString(),
      },
    ]
    fs.writeFileSync(path.join(state.runDir, 'events.ndjson'), events.map((e) => JSON.stringify(e)).join('\n') + '\n')

    const deps: OrchestratorDeps = {
      config: {
        repoRoot,
        workDir,
        model: 'zai-coding-plan/glm-5.2',
        budget: 5,
      },
      spawn: () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
      execGit: () => Promise.resolve({ stdout: '', stderr: '' }),
      driver: createOpenSpecDriver({
        exec: () => Promise.resolve({ stdout: '', stderr: '', exitCode: 0 }),
        cwd: repoRoot,
      }),
      resolveCost: glmFallbackResolver,
      now: () => new Date('2026-01-01T00:43:27.000Z'),
    }
    const ctx: StageContext = {
      cwd: repoRoot,
      changeDir,
      sidecarDir: path.join(state.runDir, 'sidecars'),
      emit: () => {},
    }
    const reviewResult: ReviewLoopResult = {
      outcome: 'converged',
      rounds: 1,
      openBlockers: [],
      openMaterial: [],
      openNitpicks: [],
    }

    const result = await presentGateAt(deps, state, ctx, reviewResult, 1, 'final')
    const gateMd = fs.readFileSync(result.gateMdPath, 'utf8')

    expect(gateMd).toContain('· estimated')
    expect(gateMd).not.toContain('$0.00')
    expect(gateMd).toMatch(/\$12\.50/u)
  })
})

describe('presentGateAt change digest', () => {
  const PROPOSAL = [
    '## Why',
    '',
    'The slug is useless at the gate. A human needs context fast.',
    '',
    '## Impact',
    '',
    '- **Code**: `src/a.ts` (new)',
    '',
  ].join('\n')
  const DESIGN = ['## Risks / Trade-offs', '', '- misparse degrades to placeholder', ''].join('\n')

  async function setup(opts: { withTasksMd: boolean }): Promise<{
    deps: OrchestratorDeps
    state: RunState
    ctx: StageContext
  }> {
    const repoRoot = makeDir()
    const workDir = path.join(repoRoot, '.sdd-runner')
    const changeDir = path.join(repoRoot, 'openspec', 'changes', 'add-thing')
    fs.mkdirSync(changeDir, { recursive: true })
    fs.writeFileSync(path.join(changeDir, 'proposal.md'), PROPOSAL)
    fs.writeFileSync(path.join(changeDir, 'design.md'), DESIGN)
    if (opts.withTasksMd) {
      const lines: string[] = ['## 1. Section', '']
      for (let i = 1; i <= 8; i++) lines.push(`- [x] 1.${i} done`)
      for (let i = 9; i <= 12; i++) lines.push(`- [ ] 1.${i} todo`)
      fs.writeFileSync(path.join(changeDir, 'tasks.md'), `${lines.join('\n')}\n`)
    }
    const now = new Date('2026-01-01T00:00:00.000Z')
    const state = await createRunState({ workDir, repoRoot, changeName: 'add-thing' }, now)
    fs.mkdirSync(path.join(state.runDir, 'sidecars'), { recursive: true })
    fs.writeFileSync(path.join(state.runDir, 'events.ndjson'), '')
    const deps: OrchestratorDeps = {
      config: {
        repoRoot,
        workDir,
        model: 'test-model',
        budget: 5,
      },
      spawn: () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
      execGit: () => Promise.resolve({ stdout: '', stderr: '' }),
      driver: createOpenSpecDriver({
        exec: () => Promise.resolve({ stdout: '', stderr: '', exitCode: 0 }),
        cwd: repoRoot,
      }),
      // Keeps presentGateAt off the network — see the note in makeFixture.
      resolveCost: () => null,
      now: () => new Date('2026-01-01T00:00:10.000Z'),
    }
    const ctx: StageContext = {
      cwd: repoRoot,
      changeDir,
      sidecarDir: path.join(state.runDir, 'sidecars'),
      emit: () => {},
    }
    return { deps, state, ctx }
  }

  const reviewResult: ReviewLoopResult = {
    outcome: 'converged',
    rounds: 1,
    openBlockers: [],
    openMaterial: [],
    openNitpicks: [],
  }

  it('threads a populated change digest (what/why/touches) with hasTasks false when tasks.md is absent (task 3.1)', async () => {
    const { deps, state, ctx } = await setup({ withTasksMd: false })
    const result = await presentGateAt(deps, state, ctx, reviewResult, 1, 'early')
    const md = fs.readFileSync(result.gateMdPath, 'utf8')

    expect(md).toContain('### Change digest')
    expect(md).toContain('- **WHAT**: The slug is useless at the gate. A human needs context fast.')
    expect(md).toContain('- **WHY**: The slug is useless at the gate. A human needs context fast.')
    expect(md).toContain('- **TOUCHES**: **Code**: `src/a.ts` (new)')
    expect(md).not.toMatch(/tasks: \d+\/\d+/u)
  })

  it('threads tasks: done/total into TOUCHES when tasks.md is present (task 3.2)', async () => {
    const { deps, state, ctx } = await setup({ withTasksMd: true })
    const result = await presentGateAt(deps, state, ctx, reviewResult, 1, 'final')
    const md = fs.readFileSync(result.gateMdPath, 'utf8')

    expect(md).toContain('- **TOUCHES**: **Code**: `src/a.ts` (new), tasks: 8/12')
    expect(md).toContain('- **RISKS**: see "Nitpicks (informational)" below')
  })
})

describe('runResume hardening', () => {
  it('reports gate-pending without a stdout dep and never crashes', async () => {
    const fixture = makeFixture()
    const started = await runStart(fixture.deps, { taskFile: fixture.taskFile, depthOverride: 'S' })
    const deps: OrchestratorDeps = { ...fixture.deps, stdout: undefined }
    const result = await runResume(deps, started.runId)
    expect(result.halted).toBe('gate-pending')
  })

  it('refuses to resume from a stage the post-review branches do not cover', async () => {
    const fixture = makeFixture()
    const workDir = fixture.deps.config.workDir
    const runId = 'seeded-draft'
    const runDir = path.join(workDir, 'runs', runId)
    fs.mkdirSync(path.join(runDir, 'sidecars'), { recursive: true })
    const now = '2026-01-01T00:00:00.000Z'
    fs.writeFileSync(
      path.join(runDir, 'events.ndjson'),
      [
        { altitude: 'L2', type: 'stage_enter', stage: 'intake', seq: 1, ts: now },
        { altitude: 'L2', type: 'depth', profile: 'S', rationale: 'override', source: 'override', seq: 2, ts: now },
        { altitude: 'L2', type: 'stage_exit', stage: 'intake', seq: 3, ts: now },
      ]
        .map((e) => JSON.stringify(e))
        .join('\n') + '\n',
    )
    fs.writeFileSync(
      path.join(runDir, 'state.json'),
      `${JSON.stringify(
        {
          runId,
          repoRoot: fixture.repoRoot,
          workDir,
          changeName: fixture.changeName,
          stage: 'intake',
          depth: 'S',
          round: 0,
          gate: null,
          status: 'running',
          createdAt: now,
          updatedAt: now,
        },
        null,
        2,
      )}\n`,
    )
    await expect(runResume(fixture.deps, runId)).rejects.toThrow(/not supported yet/u)
  })

  it('derives the next gate version from existing gate-*.md files, ignoring lookalikes', async () => {
    const fixture = makeFixture()
    const workDir = fixture.deps.config.workDir
    const runId = 'seeded-versioned'
    const runDir = path.join(workDir, 'runs', runId)
    fs.mkdirSync(path.join(runDir, 'sidecars'), { recursive: true })
    fs.mkdirSync(path.join(fixture.changeDir, 'specs', 'thing'), { recursive: true })
    fs.writeFileSync(path.join(fixture.changeDir, 'proposal.md'), '## Why\nseeded\n')
    fs.writeFileSync(path.join(fixture.changeDir, 'design.md'), '## Context\nseeded\n')
    fs.writeFileSync(path.join(fixture.changeDir, 'specs', 'thing', 'spec.md'), '## ADDED Requirements\n')
    fs.writeFileSync(
      path.join(runDir, 'sidecars', 'resolutions-1.json'),
      JSON.stringify({
        resolutions: [],
        assumptions: [
          {
            id: 'A1',
            text: 'undecidable without a human',
            basis: 'default',
            confidence: 'medium',
            blast_radius: 'repo',
            status: 'open',
            evidence: { files: ['openspec/changes/thing/proposal.md'] },
          },
        ],
      }),
    )
    const now = '2026-01-01T00:00:00.000Z'
    const events = [
      { altitude: 'L2', type: 'stage_enter', stage: 'intake', seq: 1, ts: now },
      { altitude: 'L2', type: 'depth', profile: 'M', rationale: 'override', source: 'override', seq: 2, ts: now },
      { altitude: 'L2', type: 'stage_exit', stage: 'intake', seq: 3, ts: now },
      { altitude: 'L2', type: 'stage_enter', stage: 'draft', seq: 4, ts: now },
      { altitude: 'L2', type: 'stage_exit', stage: 'draft', seq: 5, ts: now },
      { altitude: 'L2', type: 'stage_enter', stage: 'review', seq: 6, ts: now },
      { altitude: 'L2', type: 'round_open', round: 1, cap: 3, seq: 7, ts: now },
      {
        altitude: 'L2',
        type: 'convergence',
        round: 1,
        verdict: 'converged',
        counts: { blocker: 0, material: 0, nitpick: 0 },
        seq: 8,
        ts: now,
      },
      { altitude: 'L2', type: 'round_close', round: 1, cap: 3, seq: 9, ts: now },
      { altitude: 'L2', type: 'stage_exit', stage: 'review', seq: 10, ts: now },
      { altitude: 'L2', type: 'gate', action: 'presented', mode: 'early', version: 1, seq: 11, ts: now },
      { altitude: 'L2', type: 'gate', action: 'answered', mode: 'early', version: 1, seq: 12, ts: now },
    ]
    fs.writeFileSync(path.join(runDir, 'events.ndjson'), events.map((e) => JSON.stringify(e)).join('\n') + '\n')
    fs.writeFileSync(
      path.join(runDir, 'state.json'),
      `${JSON.stringify(
        {
          runId,
          repoRoot: fixture.repoRoot,
          workDir,
          changeName: fixture.changeName,
          stage: 'review',
          depth: 'M',
          round: 1,
          gate: null,
          status: 'running',
          createdAt: now,
          updatedAt: now,
        },
        null,
        2,
      )}\n`,
    )
    for (const name of ['gate-1.md', 'gate-10.md', 'gate-50.md.bak', 'notgate-99.md', 'gate-x.md']) {
      fs.writeFileSync(path.join(runDir, name), 'stale\n')
    }
    const deps: OrchestratorDeps = { ...fixture.deps, driver: createSettledDriver(fixture) }
    const result = await runResume(deps, runId)
    expect(result.halted).toBe('gate')
    expect(result.version).toBe(11)
    expect(fs.readFileSync(requireGateMdPath(result), 'utf8')).toContain('Final gate')
  })
})

describe('policy prelude at the extend-round seam (observe)', () => {
  it('a --extend re-presented early gate carries the observe preview record', async () => {
    const materialFinding = {
      id: 'F1',
      class: 'MATERIAL',
      gap: 'design lacks rollback',
      question: 'how?',
      code_evidence_attempted: 'searched design.md',
    }
    const materialResolution = { id: 'F1', class: 'MATERIAL', resolution: 'edited', outcome: 'narrowed gap' }
    const fixture = makeFixture({
      'findings-1.json': JSON.stringify({ findings: [materialFinding] }),
      'resolutions-1.json': JSON.stringify({ resolutions: [materialResolution], assumptions: [] }),
      'findings-2.json': JSON.stringify({ findings: [materialFinding] }),
      'resolutions-2.json': JSON.stringify({ resolutions: [materialResolution], assumptions: [] }),
      'findings-3.json': JSON.stringify({ findings: [materialFinding] }),
      'resolutions-3.json': JSON.stringify({ resolutions: [materialResolution], assumptions: [] }),
      'findings-4.json': JSON.stringify({ findings: [materialFinding] }),
      'resolutions-4.json': JSON.stringify({ resolutions: [materialResolution], assumptions: [] }),
    })
    const started = await runStart(fixture.deps, { taskFile: fixture.taskFile, depthOverride: 'M' })
    const result = await runGateResume(fixture.deps, started.runId, { extend: true })
    expect(result.outcome).toBe('extend')
    const runDir = path.join(fixture.deps.config.workDir, 'runs', started.runId)
    const gate2 = fs.readFileSync(path.join(runDir, 'gate-2.md'), 'utf8')
    expect(gate2).toContain('### Auto-decision preview')
    const sidecar = fs.readFileSync(path.join(runDir, 'auto-policy.jsonl'), 'utf8').trim().split('\n')
    expect(sidecar.length).toBeGreaterThanOrEqual(2)
  })
})

describe('assist auto-settle (7.2)', () => {
  const meteredCost = (modelId: string): { input: number; output: number; source: 'primary' } | null => {
    void modelId
    return { input: 1, output: 2, source: 'primary' }
  }

  it('the ladder auto-approves a converged clean run with zero prompts and full attribution', async () => {
    const fixture = makeFixture({
      'resolutions-1.json': JSON.stringify({ resolutions: [], assumptions: [] }),
    })
    const deps: OrchestratorDeps = {
      ...fixture.deps,
      resolveCost: meteredCost,
      autonomy: { level: 'assist', costCeilingUsd: 5 },
    }
    const result = await runStart(deps, { taskFile: fixture.taskFile, depthOverride: 'S' })

    const state = await loadRunState(deps.config.workDir, result.runId)
    expect(state.status).toBe('completed')
    expect(state.gate).toBeNull()

    const gateMd = fs.readFileSync(result.gateMdPath, 'utf8')
    expect(gateMd).toContain('## Gate response')
    expect(gateMd).toContain('decided-by: policy R1')

    const events = readEvents(path.join(deps.config.workDir, 'runs', result.runId, 'events.ndjson'))
    expect(gateEventKinds(events)).toEqual(['presented', 'answered'])
    const autoDecisions = events.filter((e) => e.type === 'auto_decision')
    expect(autoDecisions).toHaveLength(1)
    expect(autoDecisions[0]).toMatchObject({ rule: 'R1', decision: 'approve', gateVersion: 1 })
  })

  it('an undecidable gate stays pending with its audit recorded unconditionally', async () => {
    const fixture = makeFixture()
    const result = await runStart(fixture.deps, { taskFile: fixture.taskFile, depthOverride: 'S' })
    const state = await loadRunState(fixture.deps.config.workDir, result.runId)
    expect(state.status).toBe('running')
    expect(state.gate).toEqual({ mode: 'final', version: 1 })
    const gateMd = fs.readFileSync(result.gateMdPath, 'utf8')
    expect(gateMd).not.toContain('## Gate response')
    expect(gateMd).toContain('### Auto-decision preview')
    const sidecar = fs.readFileSync(
      path.join(fixture.deps.config.workDir, 'runs', result.runId, 'auto-policy.jsonl'),
      'utf8',
    )
    expect(sidecar).toContain('"decision":"gate"')
  })
})

describe('policy prelude at the extend-round seam (observe)', () => {
  it('a --extend re-presented early gate carries the observe preview record', async () => {
    const materialFinding = {
      id: 'F1',
      class: 'MATERIAL',
      gap: 'design lacks rollback',
      question: 'how?',
      code_evidence_attempted: 'searched design.md',
    }
    const materialResolution = { id: 'F1', class: 'MATERIAL', resolution: 'edited', outcome: 'narrowed gap' }
    const fixture = makeFixture({
      'findings-1.json': JSON.stringify({ findings: [materialFinding] }),
      'resolutions-1.json': JSON.stringify({ resolutions: [materialResolution], assumptions: [] }),
      'findings-2.json': JSON.stringify({ findings: [materialFinding] }),
      'resolutions-2.json': JSON.stringify({ resolutions: [materialResolution], assumptions: [] }),
      'findings-3.json': JSON.stringify({ findings: [materialFinding] }),
      'resolutions-3.json': JSON.stringify({ resolutions: [materialResolution], assumptions: [] }),
      'findings-4.json': JSON.stringify({ findings: [materialFinding] }),
      'resolutions-4.json': JSON.stringify({ resolutions: [materialResolution], assumptions: [] }),
    })
    const started = await runStart(fixture.deps, { taskFile: fixture.taskFile, depthOverride: 'M' })
    const result = await runGateResume(fixture.deps, started.runId, { extend: true })
    expect(result.outcome).toBe('extend')
    const runDir = path.join(fixture.deps.config.workDir, 'runs', started.runId)
    const gate2 = fs.readFileSync(path.join(runDir, 'gate-2.md'), 'utf8')
    expect(gate2).toContain('### Auto-decision preview')
    const sidecar = fs.readFileSync(path.join(runDir, 'auto-policy.jsonl'), 'utf8').trim().split('\n')
    expect(sidecar.length).toBeGreaterThanOrEqual(2)
  })
})

describe('assist auto-settle (7.2)', () => {
  const meteredCost = (modelId: string): { input: number; output: number; source: 'primary' } | null => {
    void modelId
    return { input: 1, output: 2, source: 'primary' }
  }

  it('the ladder auto-approves a converged clean run with zero prompts and full attribution', async () => {
    const fixture = makeFixture({
      'resolutions-1.json': JSON.stringify({ resolutions: [], assumptions: [] }),
    })
    const deps: OrchestratorDeps = {
      ...fixture.deps,
      resolveCost: meteredCost,
      autonomy: { level: 'assist', costCeilingUsd: 5 },
    }
    const result = await runStart(deps, { taskFile: fixture.taskFile, depthOverride: 'S' })

    const state = await loadRunState(deps.config.workDir, result.runId)
    expect(state.status).toBe('completed')
    expect(state.gate).toBeNull()

    const gateMd = fs.readFileSync(result.gateMdPath, 'utf8')
    expect(gateMd).toContain('## Gate response')
    expect(gateMd).toContain('decided-by: policy R1')

    const events = readEvents(path.join(deps.config.workDir, 'runs', result.runId, 'events.ndjson'))
    expect(gateEventKinds(events)).toEqual(['presented', 'answered'])
    const autoDecisions = events.filter((e) => e.type === 'auto_decision')
    expect(autoDecisions).toHaveLength(1)
    expect(autoDecisions[0]).toMatchObject({ rule: 'R1', decision: 'approve', gateVersion: 1 })
  })

  it('an undecidable gate stays pending with its audit recorded unconditionally', async () => {
    const fixture = makeFixture()
    const result = await runStart(fixture.deps, { taskFile: fixture.taskFile, depthOverride: 'S' })
    const state = await loadRunState(fixture.deps.config.workDir, result.runId)
    expect(state.status).toBe('running')
    expect(state.gate).toEqual({ mode: 'final', version: 1 })
    const gateMd = fs.readFileSync(result.gateMdPath, 'utf8')
    expect(gateMd).not.toContain('## Gate response')
    expect(gateMd).toContain('### Auto-decision preview')
    const sidecar = fs.readFileSync(
      path.join(fixture.deps.config.workDir, 'runs', result.runId, 'auto-policy.jsonl'),
      'utf8',
    )
    expect(sidecar).toContain('"decision":"gate"')
  })
})

describe('R3 accept-items partial path (7.5)', () => {
  const meteredCost = (modelId: string): { input: number; output: number; source: 'primary' } | null => {
    void modelId
    return { input: 1, output: 2, source: 'primary' }
  }

  it('a mixed gate pre-checks low-blast items, emits accept-items, and still presents to the human', async () => {
    const nitpickFinding = {
      id: 'F1',
      class: 'NITPICK',
      gap: 'typo in proposal',
      question: 'fix?',
      code_evidence_attempted: 'read proposal.md',
    }
    const nitpickResolution = { id: 'F1', class: 'NITPICK', resolution: 'dismissed', justification: 'cosmetic' }
    const fixture = makeFixture({
      'findings-1.json': JSON.stringify({ findings: [nitpickFinding] }),
      'resolutions-1.json': JSON.stringify({
        resolutions: [nitpickResolution],
        assumptions: [
          {
            id: 'A1',
            text: 'low blast one',
            basis: 'default',
            confidence: 'high',
            blast_radius: 'tiny',
            status: 'open',
            evidence: { files: ['openspec/changes/add-thing/proposal.md'] },
          },
          {
            id: 'A2',
            text: 'high blast one',
            basis: 'default',
            confidence: 'low',
            blast_radius: 'huge',
            status: 'open',
            evidence: { files: ['src/chat/router.ts'] },
          },
        ],
      }),
    })
    const deps: OrchestratorDeps = {
      ...fixture.deps,
      resolveCost: meteredCost,
      autonomy: { level: 'assist', costCeilingUsd: 5 },
    }
    const result = await runStart(deps, { taskFile: fixture.taskFile, depthOverride: 'S' })

    const state = await loadRunState(deps.config.workDir, result.runId)
    expect(state.gate).not.toBeNull()
    expect(state.status).toBe('running')

    const gateMd = fs.readFileSync(result.gateMdPath, 'utf8')
    expect(gateMd).toContain('### Auto-decision preview')
    expect(gateMd).toContain('- [x] A1 low blast one · decided-by: policy R3')
    expect(gateMd).toContain('- [ ] A2 high blast one')

    const events = readEvents(path.join(deps.config.workDir, 'runs', result.runId, 'events.ndjson'))
    const autoDecisions = events.filter((e) => e.type === 'auto_decision')
    expect(autoDecisions[autoDecisions.length - 1]).toMatchObject({
      rule: 'R3',
      decision: 'accept-items',
    })
  })
})

describe('R2 trajectory auto-extend (8.2)', () => {
  const meteredCost = (modelId: string): { input: number; output: number; source: 'primary' } | null => {
    void modelId
    return { input: 1, output: 2, source: 'primary' }
  }

  function makeTrajectoryFixture(script: { reviewer: string[]; resolver: string[] }): Fixture {
    const fixture = makeFixture({
      'findings-1.json': script.reviewer[0] ?? '{}',
      'resolutions-1.json': script.resolver[0] ?? '{}',
      'findings-2.json': script.reviewer[1] ?? script.reviewer[0] ?? '{}',
      'resolutions-2.json': script.resolver[1] ?? script.resolver[0] ?? '{}',
      'findings-3.json': script.reviewer[2] ?? script.reviewer[1] ?? '{}',
      'resolutions-3.json': script.resolver[2] ?? script.resolver[1] ?? '{}',
      'findings-4.json': script.reviewer[3] ?? script.reviewer[2] ?? '{}',
      'resolutions-4.json': script.resolver[3] ?? script.resolver[2] ?? '{}',
    })
    return fixture
  }

  const materialFinding = (id: string): Record<string, string> => ({
    id,
    class: 'MATERIAL',
    gap: 'gap grows',
    question: 'q',
    code_evidence_attempted: 'e',
  })
  const openMaterial = (id: string): Record<string, string> => ({
    id,
    class: 'MATERIAL',
    resolution: 'edited',
    outcome: 'narrowed',
  })

  it('strictly decreasing burndown at cap-hit auto-extends one round, no prompt', async () => {
    // M depth, cap 3: rounds 1-3 open MATERIAL (3 then 1), cap-hit at 3 →
    // trajectory [.., 3, 1] strictly decreasing → R2 fires, extends to round 4.
    const fixture = makeTrajectoryFixture({
      reviewer: [
        JSON.stringify({ findings: [materialFinding('F1'), materialFinding('F2'), materialFinding('F3')] }),
        JSON.stringify({ findings: [materialFinding('F1')] }),
        JSON.stringify({ findings: [materialFinding('F1')] }),
        JSON.stringify({ findings: [] }),
      ],
      resolver: [
        JSON.stringify({ resolutions: [openMaterial('F1'), openMaterial('F2'), openMaterial('F3')], assumptions: [] }),
        JSON.stringify({ resolutions: [openMaterial('F1'), openMaterial('F2')], assumptions: [] }),
        JSON.stringify({ resolutions: [openMaterial('F1')], assumptions: [] }),
        JSON.stringify({ resolutions: [], assumptions: [] }),
      ],
    })
    const deps: OrchestratorDeps = {
      ...fixture.deps,
      resolveCost: meteredCost,
      autonomy: { level: 'assist', costCeilingUsd: 5 },
    }
    const result = await runStart(deps, { taskFile: fixture.taskFile, depthOverride: 'M' })

    const state = await loadRunState(deps.config.workDir, result.runId)
    const events = readEvents(path.join(deps.config.workDir, 'runs', result.runId, 'events.ndjson'))
    const extendDecisions = events.filter(isExtendDecision)
    expect(extendDecisions).toHaveLength(1)
    expect(state.autoExtendsUsed).toBe(1)
    expect(state.round).toBe(4)
    expect(result.halted).toBe('gate')
  })

  it('flat trajectory presents the human gate', async () => {
    const fixture = makeTrajectoryFixture({
      reviewer: [
        JSON.stringify({ findings: [materialFinding('F1'), materialFinding('F2')] }),
        JSON.stringify({ findings: [materialFinding('F1'), materialFinding('F2')] }),
        JSON.stringify({ findings: [materialFinding('F1'), materialFinding('F2')] }),
      ],
      resolver: [
        JSON.stringify({ resolutions: [openMaterial('F1'), openMaterial('F2')], assumptions: [] }),
        JSON.stringify({ resolutions: [openMaterial('F1'), openMaterial('F2')], assumptions: [] }),
        JSON.stringify({ resolutions: [openMaterial('F1'), openMaterial('F2')], assumptions: [] }),
      ],
    })
    const deps: OrchestratorDeps = {
      ...fixture.deps,
      resolveCost: meteredCost,
      autonomy: { level: 'assist', costCeilingUsd: 5 },
    }
    const result = await runStart(deps, { taskFile: fixture.taskFile, depthOverride: 'M' })
    const events = readEvents(path.join(deps.config.workDir, 'runs', result.runId, 'events.ndjson'))
    expect(events.filter(isExtendDecision)).toHaveLength(0)
    const state = await loadRunState(deps.config.workDir, result.runId)
    expect(state.gate).toEqual({ mode: 'early', version: 1 })
  })
})

function isExtendDecision(e: ReturnType<typeof readEvents>[number]): boolean {
  return e.type === 'auto_decision' && (e as { decision?: string }).decision === 'extend'
}

describe('live-view mounts (tui wiring)', () => {
  function trackMounts(deps: OrchestratorDeps): { deps: OrchestratorDeps; mounts: string[]; unmounts: () => number } {
    const mounts: string[] = []
    let count = 0
    return {
      deps: {
        ...deps,
        mountRunScreen: ({ runDir }): void => {
          mounts.push(runDir)
        },
        unmountRunScreen: (): void => {
          count += 1
        },
      },
      mounts,
      unmounts: (): number => count,
    }
  }

  function seedInterruptedReview(fixture: ReturnType<typeof makeFixture>, runId: string): string {
    const workDir = fixture.deps.config.workDir
    const runDir = path.join(workDir, 'runs', runId)
    fs.mkdirSync(path.join(runDir, 'sidecars'), { recursive: true })
    fs.mkdirSync(path.join(fixture.changeDir, 'specs', 'thing'), { recursive: true })
    fs.writeFileSync(path.join(fixture.changeDir, 'proposal.md'), '## Why\nseeded\n')
    fs.writeFileSync(path.join(fixture.changeDir, 'specs', 'thing', 'spec.md'), '## ADDED Requirements\n')
    const events = [
      { altitude: 'L2', type: 'stage_enter', stage: 'intake', seq: 1, ts: '2026-01-01T00:00:00.000Z' },
      {
        altitude: 'L2',
        type: 'depth',
        profile: 'S',
        rationale: 'override',
        source: 'override',
        seq: 2,
        ts: '2026-01-01T00:00:00.000Z',
      },
      { altitude: 'L2', type: 'stage_exit', stage: 'intake', seq: 3, ts: '2026-01-01T00:00:00.000Z' },
      { altitude: 'L2', type: 'stage_enter', stage: 'draft', seq: 4, ts: '2026-01-01T00:00:00.000Z' },
      { altitude: 'L2', type: 'stage_exit', stage: 'draft', seq: 5, ts: '2026-01-01T00:00:00.000Z' },
    ]
    fs.writeFileSync(path.join(runDir, 'events.ndjson'), events.map((e) => JSON.stringify(e)).join('\n') + '\n')
    fs.writeFileSync(
      path.join(runDir, 'state.json'),
      `${JSON.stringify(
        {
          runId,
          repoRoot: fixture.repoRoot,
          workDir,
          changeName: fixture.changeName,
          stage: 'draft',
          depth: 'S',
          round: 0,
          gate: null,
          status: 'running',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        null,
        2,
      )}\n`,
    )
    return runDir
  }

  it('runStart mounts the running screen and unmounts it at the halt', async () => {
    const fixture = makeFixture()
    const live = trackMounts(fixture.deps)
    const result = await runStart(live.deps, { taskFile: fixture.taskFile, depthOverride: 'S' })
    expect(result.halted).toBe('gate')
    expect(live.mounts).toEqual([path.join(fixture.deps.config.workDir, 'runs', result.runId)])
    expect(live.unmounts()).toBe(1)
  })

  it('runResume mounts and unmounts around the continued stages', async () => {
    const fixture = makeFixture()
    const runId = 'seeded-run-1'
    await seedInterruptedReview(fixture, runId)
    const live = trackMounts(fixture.deps)
    const calls: string[] = []
    const deps: OrchestratorDeps = { ...live.deps, driver: createTrackingDriver(fixture, calls) }
    const result = await runResume(deps, runId)
    expect(result.halted).toBe('gate')
    expect(live.mounts).toEqual([path.join(fixture.deps.config.workDir, 'runs', runId)])
    expect(live.unmounts()).toBe(1)
  })

  it('a verb without mount hooks still runs (line mode unchanged)', async () => {
    const fixture = makeFixture()
    const result = await runStart(fixture.deps, { taskFile: fixture.taskFile, depthOverride: 'S' })
    expect(result.halted).toBe('gate')
    expect(fixture.rendered.some((e) => e.type === 'stage_enter')).toBe(true)
  })
})

describe('plan-parent resume interception (D9)', () => {
  const PLAN = {
    children: [
      { id: 'db-schema', instruction: 'Rename the schema columns.', deps: [] },
      { id: 'db-api', instruction: 'Rename the API route helpers.', deps: ['db-schema'] },
    ],
  }

  async function seedPlanParent(fixture: ReturnType<typeof makeFixture>): Promise<string> {
    const runId = 'composite-parent'
    const runDir = path.join(fixture.deps.config.workDir, 'runs', runId)
    fs.mkdirSync(path.join(runDir, 'sidecars'), { recursive: true })
    fs.writeFileSync(path.join(runDir, 'sidecars', 'plan.json'), JSON.stringify(PLAN))
    fs.writeFileSync(path.join(runDir, 'events.ndjson'), '')
    await materializeChildFiles(PLAN, runDir)
    fs.writeFileSync(
      path.join(runDir, 'state.json'),
      `${JSON.stringify(
        {
          runId,
          repoRoot: fixture.repoRoot,
          workDir: fixture.deps.config.workDir,
          changeName: 'composite',
          stage: 'intake',
          depth: null,
          round: 0,
          gate: null,
          status: 'running',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          plan: { childIds: ['db-schema', 'db-api'], digest: 'd'.repeat(16) },
          children: { 'db-schema': { status: 'pending' }, 'db-api': { status: 'pending' } },
        },
        null,
        2,
      )}\n`,
    )
    return runId
  }

  it('runResume intercepts a plan parent before resumeFromPoint and drives runChildren through nested runStart', async () => {
    const fixture = makeFixture({
      'depth.json': JSON.stringify({
        implicated_files: ['drizzle/x.sql'],
        signals: {
          cross_module: false,
          db_migration: false,
          provider_surface: false,
          credentials: false,
          novelty: 'existing-modules',
        },
        rationale: 'single-module child change',
      }),
      'findings-skeptic-1.json': JSON.stringify({ findings: [] }),
    })
    const runId = await seedPlanParent(fixture)
    const stdoutLines: string[] = []
    const deps: OrchestratorDeps = {
      ...fixture.deps,
      stdout: (line: string) => {
        stdoutLines.push(line)
      },
    }

    const result = await runResume(deps, runId)

    expect(result).toEqual({ runId, halted: 'gate-pending' })
    const parent = await loadRunState(deps.config.workDir, runId)
    expect(parent.children?.['db-schema']).toEqual({ status: 'running' })
    expect(parent.children?.['db-api']).toEqual({ status: 'pending' })
    const child = await loadRunState(deps.config.workDir, 'db-schema')
    expect(child.gate).not.toBe(null)
    expect(stdoutLines.some((line) => line === 'sdd db-schema')).toBe(true)
    const events = readEvents(path.join(parent.runDir, 'events.ndjson'))
    const spawn = events.filter(
      (e): e is Extract<ReturnType<typeof readEvents>[number], { type: 'child_spawned' }> => e.type === 'child_spawned',
    )
    expect(spawn).toHaveLength(1)
    expect(spawn[0]).toMatchObject({ child: 'db-schema', runId: 'db-schema' })
  })
})

describe('deriveResumeDecision tolerates an absent change folder', () => {
  it('a driver.status rejection resolves to a decision instead of throwing', async () => {
    const fixture = makeFixture()
    const state = await createRunState({
      workDir: fixture.deps.config.workDir,
      repoRoot: fixture.repoRoot,
      changeName: 'folderless-parent',
    })
    fs.writeFileSync(path.join(state.runDir, 'events.ndjson'), '')
    const deps: OrchestratorDeps = {
      ...fixture.deps,
      driver: createOpenSpecDriver({ exec: rejectingStatusExec, cwd: fixture.repoRoot }),
    }

    const decision = await deriveResumeDecision(deps, state)

    expect(typeof decision.stage).toBe('string')
    expect(typeof decision.reason).toBe('string')
  })
})

/** Driver exec double (D9): `openspec status` fails like an absent change folder; the rest succeed. */
function rejectingStatusExec(args: readonly string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  if (args[1] === 'status') return Promise.reject(new Error('change not found'))
  return Promise.resolve({ stdout: 'ok', stderr: '', exitCode: 0 })
}

describe('runGateResume plan mode (D12)', () => {
  const PLAN = {
    children: [
      { id: 'db-schema', instruction: 'Rename the schema columns.', deps: [] },
      { id: 'db-api', instruction: 'Rename the API route helpers.', deps: ['db-schema'] },
    ],
  }

  async function seedPlanGateParent(fixture: ReturnType<typeof makeFixture>, gateMd: string): Promise<string> {
    const runId = 'plan-gate-parent'
    const runDir = path.join(fixture.deps.config.workDir, 'runs', runId)
    fs.mkdirSync(path.join(runDir, 'sidecars'), { recursive: true })
    fs.writeFileSync(path.join(runDir, 'sidecars', 'plan.json'), JSON.stringify(PLAN))
    fs.writeFileSync(path.join(runDir, 'events.ndjson'), '')
    await materializeChildFiles(PLAN, runDir)
    fs.writeFileSync(path.join(runDir, 'gate-1.md'), gateMd)
    fs.writeFileSync(path.join(runDir, 'gate-hashes-1.json'), '{}\n')
    fs.writeFileSync(
      path.join(runDir, 'state.json'),
      `${JSON.stringify(
        {
          runId,
          repoRoot: fixture.repoRoot,
          workDir: fixture.deps.config.workDir,
          changeName: 'composite',
          stage: 'intake',
          depth: null,
          round: 0,
          gate: { mode: 'plan', version: 1 },
          status: 'running',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          plan: { childIds: ['db-schema', 'db-api'], digest: 'd'.repeat(16) },
          children: { 'db-schema': { status: 'pending' }, 'db-api': { status: 'pending' } },
        },
        null,
        2,
      )}\n`,
    )
    return runId
  }

  const CHECKED_GATE = [
    '## Plan gate — change composite',
    '',
    '- [x] C1 db-schema — Rename the schema columns.',
    '- [x] C2 db-api — Rename the API route helpers. · deps: db-schema',
    '',
  ].join('\n')

  it('an approved plan gate (hand-edited file) settles, emits answered mode plan, and drives runChildren', async () => {
    const fixture = makeFixture({
      'depth.json': JSON.stringify({
        implicated_files: ['drizzle/x.sql'],
        signals: {
          cross_module: false,
          db_migration: false,
          provider_surface: false,
          credentials: false,
          novelty: 'existing-modules',
        },
        rationale: 'single-module child change',
      }),
      'findings-skeptic-1.json': JSON.stringify({ findings: [] }),
    })
    const runId = await seedPlanGateParent(fixture, CHECKED_GATE)
    const stdoutLines: string[] = []
    const deps: OrchestratorDeps = {
      ...fixture.deps,
      stdout: (line: string) => {
        stdoutLines.push(line)
      },
    }

    const result = await runGateResume(deps, runId, {})

    expect(result.outcome).toBe('approved')
    expect(result.version).toBe(1)
    const parent = await loadRunState(deps.config.workDir, runId)
    expect(parent.gate).toBe(null)
    expect(parent.children?.['db-schema']).toEqual({ status: 'running' })
    expect(parent.children?.['db-api']).toEqual({ status: 'pending' })
    const child = await loadRunState(deps.config.workDir, 'db-schema')
    expect(child.gate).not.toBe(null)
    const events = readEvents(path.join(parent.runDir, 'events.ndjson'))
    const answered = gateAnsweredOf(events)
    expect(answered).toHaveLength(1)
    expect(answered[0]).toMatchObject({ mode: 'plan', version: 1 })
    const spawn = events.filter(
      (e): e is Extract<ReturnType<typeof readEvents>[number], { type: 'child_spawned' }> => e.type === 'child_spawned',
    )
    expect(spawn).toHaveLength(1)
    expect(spawn[0]).toMatchObject({ child: 'db-schema', runId: 'db-schema' })
    expect(fs.existsSync(fixture.changeDir.replace(fixture.changeName, 'composite'))).toBe(false)
  })

  it('an abort flag finalizes the gate aborted before any child exists', async () => {
    const fixture = makeFixture()
    const runId = await seedPlanGateParent(fixture, CHECKED_GATE)

    const result = await runGateResume(fixture.deps, runId, { abort: true })

    expect(result.outcome).toBe('aborted')
    const parent = await loadRunState(fixture.deps.config.workDir, runId)
    expect(parent.status).toBe('aborted')
    expect(parent.gate).toBe(null)
    const events = readEvents(path.join(parent.runDir, 'events.ndjson'))
    expect(events.filter((e) => e.type === 'child_spawned')).toHaveLength(0)
    const answered = gateAnsweredOf(events)
    expect(answered[0]).toMatchObject({ mode: 'plan', version: 1 })
    expect(await loadRunState(fixture.deps.config.workDir, 'db-schema').catch(() => null)).toBe(null)
  })

  it('vetoes desugar through the render-then-parse grammar before routing (routing lands in 6.3)', async () => {
    const fixture = makeFixture()
    const runId = await seedPlanGateParent(fixture, CHECKED_GATE)

    const failure = await runGateResume(fixture.deps, runId, {
      confirmAll: true,
      vetoes: [{ id: 'C1', redirect: 'split the schema child' }],
    }).catch((error: unknown) => error)
    expect(errorMessageOf(failure)).toMatch(/plan-gate veto/u)
    const md = fs.readFileSync(path.join(fixture.deps.config.workDir, 'runs', runId, 'gate-1.md'), 'utf8')
    expect(md).toContain('- [ ] C1 db-schema — Rename the schema columns.')
    expect(md).toContain('→ split the schema child')
    expect(md).toContain('- [x] C2 db-api — Rename the API route helpers. · deps: db-schema')
  })

  it('an extend flag is rejected by the parser at plan mode (cap-hit only)', async () => {
    const fixture = makeFixture()
    const runId = await seedPlanGateParent(fixture, CHECKED_GATE)

    const failure = await runGateResume(fixture.deps, runId, { extend: true }).catch((error: unknown) => error)
    expect(errorMessageOf(failure)).toMatch(/RUN 1 MORE.*plan gate.*cap-hit/u)
  })

  it('an unknown veto id fails before anything is written', async () => {
    const fixture = makeFixture()
    const runId = await seedPlanGateParent(fixture, CHECKED_GATE)
    const before = fs.readFileSync(path.join(fixture.deps.config.workDir, 'runs', runId, 'gate-1.md'), 'utf8')

    const failure = await runGateResume(fixture.deps, runId, {
      confirmAll: true,
      vetoes: [{ id: 'C9' }],
    }).catch((error: unknown) => error)
    expect(errorMessageOf(failure)).toMatch(/unknown veto id: C9/u)
    const after = fs.readFileSync(path.join(fixture.deps.config.workDir, 'runs', runId, 'gate-1.md'), 'utf8')
    expect(after).toBe(before)
  })
})

function gateAnsweredOf(
  events: readonly ReturnType<typeof readEvents>[number][],
): Extract<ReturnType<typeof readEvents>[number], { type: 'gate' }>[] {
  return events.filter(
    (e): e is Extract<ReturnType<typeof readEvents>[number], { type: 'gate' }> =>
      e.type === 'gate' && e.action === 'answered',
  )
}
