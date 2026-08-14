// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
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
import { runGateResume, runResume, runStart } from '../../sdd-runner/src/orchestrator.js'
import type { RunGateResumeResult } from '../../sdd-runner/src/orchestrator.js'
import type { ReviewLoopResult } from '../../sdd-runner/src/review-loop.js'
import { createRunState } from '../../sdd-runner/src/run-state.js'
import { loadRunState } from '../../sdd-runner/src/run-state.js'
import type { RunState } from '../../sdd-runner/src/run-state.js'

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
    'resolutions-1.json': JSON.stringify({ resolutions: [], assumptions: [] }),
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
      fs.mkdirSync(path.join(changeDir, 'specs', 'thing'), { recursive: true })
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
      models: {},
      timeouts: { wallClockMs: 60_000, inactivityMs: 5_000 },
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

function glmFallbackResolver(
  modelId: string,
): { input: number; output: number; source: 'primary' | 'fallback' } | null {
  const table: Record<string, { input: number; output: number; source: 'primary' | 'fallback' }> = {
    'zai-coding-plan/glm-5.2': { input: 5, output: 15, source: 'fallback' },
  }
  return table[modelId] ?? null
}

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
    expect(fixture.stdoutLines.some((l) => l.includes('gate resume'))).toBe(true)
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
})

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

function requireGateMdPath(result: RunGateResumeResult): string {
  if (result.gateMdPath === undefined) throw new Error('expected gateMdPath on the result')
  return result.gateMdPath
}

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
  })

  it('marks the run completed on an approved gate', async () => {
    const fixture = makeFixture()
    const started = await runStart(fixture.deps, {
      taskFile: fixture.taskFile,
      depthOverride: 'S',
    })
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

    const events = readEvents(path.join(runDir, 'events.ndjson'))
    const round4 = events.filter((e) => e.type === 'round_open').filter((e) => (e as { round: number }).round === 4)
    expect(round4).toHaveLength(1)
    expect(round4[0]).toMatchObject({ type: 'round_open', round: 4, cap: 4 })

    expect(fs.existsSync(path.join(runDir, 'gate-2.md'))).toBe(true)
    const gate2 = fs.readFileSync(path.join(runDir, 'gate-2.md'), 'utf8')
    expect(gate2).toContain('round 4:')
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
        models: {},
        timeouts: { wallClockMs: 60_000, inactivityMs: 5_000 },
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
        models: {},
        timeouts: { wallClockMs: 60_000, inactivityMs: 5_000 },
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
