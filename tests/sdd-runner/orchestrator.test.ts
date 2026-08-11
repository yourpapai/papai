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
import { createOpenSpecDriver } from '../../sdd-runner/src/openspec-driver.js'
import type { OpenSpecDriver } from '../../sdd-runner/src/openspec-driver.js'
import { runGateResume, runResume, runStart } from '../../sdd-runner/src/orchestrator.js'
import type { OrchestratorDeps } from '../../sdd-runner/src/orchestrator.js'
import { loadRunState } from '../../sdd-runner/src/run-state.js'

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
    'draft-proposal.json': JSON.stringify({ files_written: ['openspec/changes/add-thing/proposal.md'] }),
    'draft-specs.json': JSON.stringify({ files_written: ['openspec/changes/add-thing/specs/thing/spec.md'] }),
    'draft-design.json': JSON.stringify({ files_written: ['openspec/changes/add-thing/design.md'] }),
    'findings-1.json': JSON.stringify({ findings: [] }),
    'resolutions-1.json': JSON.stringify({ resolutions: [], assumptions: [] }),
    'decompose-tasks.json': JSON.stringify({ tasks_file: 'openspec/changes/add-thing/tasks.md' }),
    'atomicity.json': JSON.stringify({ split: 0, merged: 0 }),
    'drift.json': JSON.stringify({ tasks_file: 'openspec/changes/add-thing/tasks.md' }),
    'veto-updater.json': JSON.stringify({ files_updated: ['openspec/changes/add-thing/proposal.md'] }),
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
        stdout: JSON.stringify({ schemaName: 'auto-sdd', artifacts: [{ id: 'proposal', status: 'done' }] }),
        stderr: '',
        exitCode: 0,
      })
    }
    return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })
  }
  const driver: OpenSpecDriver = createOpenSpecDriver({ exec: driverExec, cwd: repoRoot })

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
  }
  return { deps, repoRoot, changeName, changeDir, taskFile, rendered, stdoutLines, spawnOrder }
}

describe('runStart', () => {
  it('sequences intake→draft→review→decompose→gate at S, persists state, and drives bus + persister', async () => {
    const fixture = makeFixture()
    const result = await runStart(fixture.deps, { taskFile: fixture.taskFile, depthOverride: 'S' })
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
    const result = await runStart(fixture.deps, { taskFile: fixture.taskFile, depthOverride: 'M' })
    expect(result.halted).toBe('gate')
    expect(fs.existsSync(path.join(fixture.changeDir, 'design.md'))).toBe(true)
    expect(fixture.spawnOrder).toContain('draft-design.json')
    expect(fixture.spawnOrder).toContain('atomicity.json')
    expect(fixture.spawnOrder.indexOf('decompose-tasks.json')).toBeLessThan(
      fixture.spawnOrder.indexOf('atomicity.json'),
    )
  })
})

describe('runResume', () => {
  it('resumes from review without re-running intake or draft', async () => {
    const fixture = makeFixture()
    const workDir = fixture.deps.config.workDir
    const runId = 'seeded-run-1'
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

describe('runGateResume', () => {
  it('halts at an early cap-hit gate with trajectory, open MATERIAL checkboxes, and T1 ack; rejects resume without T1', async () => {
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
    const gatePath = path.join(fixture.deps.config.workDir, 'runs', started.runId, 'gate-1.md')
    const gateMd = fs.readFileSync(gatePath, 'utf8')
    fs.writeFileSync(gatePath, gateMd.replace('- [ ] T1', '- [x] T1'))

    const result = await runGateResume(fixture.deps, started.runId, {})
    expect(result.outcome).toBe('veto')
    expect(result.version).toBe(2)
  })

  it('marks the run completed on an approved gate', async () => {
    const fixture = makeFixture()
    const started = await runStart(fixture.deps, { taskFile: fixture.taskFile, depthOverride: 'S' })
    const result = await runGateResume(fixture.deps, started.runId, {})
    expect(result.outcome).toBe('approved')
    const state = await loadRunState(fixture.deps.config.workDir, started.runId)
    expect(state.status).toBe('completed')
    expect(state.gate).toBeNull()
  })

  it('marks the run aborted on an ABORT gate response', async () => {
    const fixture = makeFixture()
    const started = await runStart(fixture.deps, { taskFile: fixture.taskFile, depthOverride: 'S' })
    fs.writeFileSync(path.join(fixture.deps.config.workDir, 'runs', started.runId, 'gate-1.md'), 'ABORT\n')
    const result = await runGateResume(fixture.deps, started.runId, {})
    expect(result.outcome).toBe('aborted')
    const state = await loadRunState(fixture.deps.config.workDir, started.runId)
    expect(state.status).toBe('aborted')
  })

  it('runs the drift-check resolver when a spec changed while gate-pending', async () => {
    const fixture = makeFixture()
    const started = await runStart(fixture.deps, { taskFile: fixture.taskFile, depthOverride: 'S' })
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
      'resolutions-1.json': JSON.stringify({ resolutions: [], assumptions: [assumption] }),
    })
    const started = await runStart(fixture.deps, { taskFile: fixture.taskFile, depthOverride: 'S' })
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
})
