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
import type { OrchestratorDeps } from '../../sdd-runner/src/gate-digest.js'
import { runResume } from '../../sdd-runner/src/orchestrator.js'
import { loadRunState } from '../../sdd-runner/src/run-state.js'
import {
  createStopMarkerSeam,
  HolderRecordSchema,
  holderPath,
  pidIsAlive,
  readHolder,
  removeHolder,
  runHasLiveOwner,
  requestCalmStop,
  stopMarkerPath,
  stopRun,
  stopRunMessage,
  writeHolder,
} from '../../sdd-runner/src/stop-controller.js'
import type { CalmStopController } from '../../sdd-runner/src/stop-controller.js'
const tmpDirs: string[] = []

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-stop-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('holder record (process ownership)', () => {
  it('writes { pid, startedAt } and reads it back schema-valid', () => {
    const dir = makeDir()
    writeHolder(dir, 4242, new Date('2026-01-01T00:00:00Z'))
    const raw = JSON.parse(fs.readFileSync(holderPath(dir), 'utf8')) as unknown
    expect(HolderRecordSchema.safeParse(raw).success).toBe(true)
    expect(readHolder(dir)).toEqual({ pid: 4242, startedAt: '2026-01-01T00:00:00.000Z' })
  })

  it('removeHolder deletes the record; readHolder tolerates absence', () => {
    const dir = makeDir()
    writeHolder(dir, 1, new Date())
    removeHolder(dir)
    expect(fs.existsSync(holderPath(dir))).toBe(false)
    expect(readHolder(dir)).toBe(null)
  })

  it('readHolder reports null for a corrupt record', () => {
    const dir = makeDir()
    fs.writeFileSync(holderPath(dir), '{not json')
    expect(readHolder(dir)).toBe(null)
  })

  it('runHasLiveOwner follows the injected liveness of the holder pid', () => {
    const dir = makeDir()
    writeHolder(dir, 99, new Date())
    expect(runHasLiveOwner(dir, () => true)).toBe(true)
    expect(runHasLiveOwner(dir, () => false)).toBe(false)
  })

  it('a missing holder reads as dead (legacy runs)', () => {
    expect(runHasLiveOwner(makeDir(), () => true)).toBe(false)
  })
})

describe('pidIsAlive', () => {
  it('kill(0) success and EPERM mean alive; ESRCH means dead', () => {
    const okay = (): void => {}
    const eperm = (): void => {
      const error = new Error('ep') as NodeJS.ErrnoException
      error.code = 'EPERM'
      throw error
    }
    const esrch = (): void => {
      const error = new Error('no such process') as NodeJS.ErrnoException
      error.code = 'ESRCH'
      throw error
    }
    expect(pidIsAlive(1, okay)).toBe(true)
    expect(pidIsAlive(1, eperm)).toBe(true)
    expect(pidIsAlive(1, esrch)).toBe(false)
  })

  it('answers alive for this very process', () => {
    expect(pidIsAlive(process.pid)).toBe(true)
  })
})

interface SeedInput {
  readonly status?: string
  readonly stage?: string
  readonly depth?: string | null
  readonly gate?: { mode: 'early' | 'final'; version: number } | null
  readonly holderPid?: number
  readonly stopMarker?: boolean
  readonly updatedAt?: string
  readonly plan?: { childIds: string[]; digest: string }
}

function seedRun(overrides: SeedInput = {}): { workDir: string; runId: string; runDir: string } {
  const workDir = makeDir()
  const runId = 'seeded-run'
  const runDir = path.join(workDir, 'runs', runId)
  fs.mkdirSync(runDir, { recursive: true })
  const updatedAt = overrides.updatedAt ?? '2026-01-01T00:00:00.000Z'
  fs.writeFileSync(
    path.join(runDir, 'state.json'),
    `${JSON.stringify(
      {
        runId,
        repoRoot: workDir,
        workDir,
        changeName: 'seeded-change',
        stage: overrides.stage ?? 'review',
        depth: overrides.depth === undefined ? 'S' : overrides.depth,
        round: 1,
        gate: overrides.gate === undefined ? null : overrides.gate,
        status: overrides.status ?? 'running',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt,
        ...(overrides.plan === undefined ? {} : { plan: overrides.plan }),
      },
      null,
      2,
    )}\n`,
  )
  if (overrides.holderPid !== undefined) writeHolder(runDir, overrides.holderPid, new Date(updatedAt))
  if (overrides.stopMarker === true) requestCalmStop(runDir)
  return { workDir, runId, runDir }
}

const DEAD: () => boolean = () => false
const ALIVE: () => boolean = () => true

describe('stopRun (liveness-aware stop seam)', () => {
  it('is a no-op for a non-running run, leaving state untouched', async () => {
    for (const status of ['stopped', 'aborted', 'completed', 'failed']) {
      const seed = seedRun({ status })
      const result = await stopRun(seed.workDir, seed.runId, { isAlive: ALIVE })
      expect(result).toEqual({ kind: 'no-op', runId: seed.runId, status, gatePending: false })
      expect((await loadRunState(seed.workDir, seed.runId)).updatedAt).toBe('2026-01-01T00:00:00.000Z')
    }
  })

  it('is a no-op for a gate-pending run — a decision awaits, nothing to stop', async () => {
    const seed = seedRun({ gate: { mode: 'final', version: 1 } })
    const result = await stopRun(seed.workDir, seed.runId, { isAlive: ALIVE })
    expect(result).toEqual({ kind: 'no-op', runId: seed.runId, status: 'running', gatePending: true })
    expect(fs.existsSync(stopMarkerPath(seed.runDir))).toBe(false)
    expect((await loadRunState(seed.workDir, seed.runId)).status).toBe('running')
  })

  it('writes the calm-stop marker when the owning process is alive', async () => {
    const seed = seedRun({ holderPid: 4242 })
    const result = await stopRun(seed.workDir, seed.runId, { isAlive: ALIVE })
    expect(result).toEqual({ kind: 'marker-requested', runId: seed.runId })
    expect(fs.existsSync(stopMarkerPath(seed.runDir))).toBe(true)
    expect((await loadRunState(seed.workDir, seed.runId)).status).toBe('running')
  })

  it('settles a dead mid-pipeline run as stopped and bumps updatedAt', async () => {
    const seed = seedRun({ stage: 'review', depth: 'S' })
    const result = await stopRun(seed.workDir, seed.runId, {
      isAlive: DEAD,
      now: () => new Date('2026-01-02T00:00:00Z'),
    })
    expect(result).toEqual({ kind: 'settled', runId: seed.runId, to: 'stopped' })
    const state = await loadRunState(seed.workDir, seed.runId)
    expect(state.status).toBe('stopped')
    expect(state.updatedAt).toBe('2026-01-02T00:00:00.000Z')
  })

  it('settles a dead pre-classification run (depth null) as aborted', async () => {
    const seed = seedRun({ stage: 'intake', depth: null })
    const result = await stopRun(seed.workDir, seed.runId, { isAlive: DEAD })
    expect(result).toEqual({ kind: 'settled', runId: seed.runId, to: 'aborted' })
    expect((await loadRunState(seed.workDir, seed.runId)).status).toBe('aborted')
  })

  it('settles a dead plan parent (depth null, plan recorded) as stopped — resumable, not aborted', async () => {
    const seed = seedRun({ stage: 'decompose', depth: null, plan: { childIds: ['c1', 'c2'], digest: 'd' } })
    const result = await stopRun(seed.workDir, seed.runId, { isAlive: DEAD })
    expect(result).toEqual({ kind: 'settled', runId: seed.runId, to: 'stopped' })
    expect((await loadRunState(seed.workDir, seed.runId)).status).toBe('stopped')
  })

  it('settles a legacy zombie (no holder file) as dead', async () => {
    const seed = seedRun({ stage: 'review', depth: 'S' })
    expect(fs.existsSync(holderPath(seed.runDir))).toBe(false)
    const result = await stopRun(seed.workDir, seed.runId, { isAlive: ALIVE })
    expect(result).toEqual({ kind: 'settled', runId: seed.runId, to: 'stopped' })
  })

  it('consumes a stale stop-requested marker when settling', async () => {
    const seed = seedRun({ stopMarker: true })
    expect(fs.existsSync(stopMarkerPath(seed.runDir))).toBe(true)
    await stopRun(seed.workDir, seed.runId, { isAlive: DEAD })
    expect(fs.existsSync(stopMarkerPath(seed.runDir))).toBe(false)
  })
})

describe('stopRunMessage (outcome → operator line)', () => {
  it('marker outcome names the boundary', () => {
    expect(stopRunMessage({ kind: 'marker-requested', runId: 'r1' })).toBe(
      'calm stop requested for r1 — honored at the next boundary',
    )
  })

  it('settled stopped is resumable via the run id', () => {
    expect(stopRunMessage({ kind: 'settled', runId: 'r1', to: 'stopped' })).toBe(
      'run r1 has no live process — settled as stopped · resumable via sdd r1',
    )
  })

  it('settled aborted points at a fresh start', () => {
    expect(stopRunMessage({ kind: 'settled', runId: 'r1', to: 'aborted' })).toBe(
      'run r1 has no live process — settled as aborted · nothing to resume, start fresh: sdd <task-file>',
    )
  })

  it('no-op reports the current status; gate-pending names the pending decision', () => {
    expect(stopRunMessage({ kind: 'no-op', runId: 'r1', status: 'completed', gatePending: false })).toBe(
      'run r1 is completed — nothing to stop',
    )
    expect(stopRunMessage({ kind: 'no-op', runId: 'r1', status: 'running', gatePending: true })).toBe(
      'run r1 awaits a gate decision — nothing to stop',
    )
  })
})

describe('calm stop controller (boundary-honoring)', () => {
  it('starts un-requested; request is sticky and first-reason-wins', () => {
    const controller = createStopMarkerSeam(makeDir())
    expect(controller.requested()).toBe(null)
    controller.request()
    expect(controller.requested()).toBe('key')
    expect(controller.stopRequested()).toBe(true)
  })

  it('observes a marker file written by another process at the next boundary check', () => {
    const dir = makeDir()
    const controller = createStopMarkerSeam(dir)
    expect(controller.stopRequested()).toBe(false)
    requestCalmStop(dir)
    expect(fs.existsSync(stopMarkerPath(dir))).toBe(true)
    expect(controller.stopRequested()).toBe(true)
    expect(controller.requested()).toBe('marker')
  })

  it('a marker for a different run dir is not observed', () => {
    const a = makeDir()
    const b = makeDir()
    requestCalmStop(a)
    expect(createStopMarkerSeam(b).stopRequested()).toBe(false)
  })

  it('consumes the marker when the stop is honored, so a later resume is not stopped', () => {
    const dir = makeDir()
    const controller = createStopMarkerSeam(dir)
    requestCalmStop(dir)
    controller.consumeMarker()
    expect(fs.existsSync(stopMarkerPath(dir))).toBe(false)
  })
})

describe('calm stop honored at orchestrator round/stage boundaries', () => {
  interface Fixture {
    readonly deps: OrchestratorDeps
    readonly workDir: string
    readonly runDir: string
    readonly spawnCount: () => number
  }

  function makeReviewFixture(stopAfterSpawns: number): Fixture {
    const repoRoot = makeDir()
    const workDir = path.join(repoRoot, '.sdd-runner')
    const runDir = path.join(workDir, 'runs', 'seeded-review')
    fs.mkdirSync(path.join(runDir, 'sidecars'), { recursive: true })
    const changeDir = path.join(repoRoot, 'openspec', 'changes', 'add-thing')
    fs.mkdirSync(path.join(changeDir, 'specs', 'thing'), { recursive: true })
    fs.writeFileSync(path.join(changeDir, 'proposal.md'), '## Why\nseeded\n')
    fs.writeFileSync(path.join(changeDir, 'specs', 'thing', 'spec.md'), '## ADDED Requirements\n')
    const now = '2026-01-01T00:00:00.000Z'
    const events = [
      { altitude: 'L2', type: 'stage_enter', stage: 'intake', seq: 1, ts: now },
      { altitude: 'L2', type: 'depth', profile: 'S', rationale: 'override', source: 'override', seq: 2, ts: now },
      { altitude: 'L2', type: 'stage_exit', stage: 'intake', seq: 3, ts: now },
      { altitude: 'L2', type: 'stage_enter', stage: 'draft', seq: 4, ts: now },
      { altitude: 'L2', type: 'stage_exit', stage: 'draft', seq: 5, ts: now },
      { altitude: 'L2', type: 'stage_enter', stage: 'review', seq: 6, ts: now },
      { altitude: 'L2', type: 'round_open', round: 1, cap: 3, seq: 7, ts: now },
    ]
    fs.writeFileSync(path.join(runDir, 'events.ndjson'), events.map((e) => JSON.stringify(e)).join('\n') + '\n')
    fs.writeFileSync(
      path.join(runDir, 'state.json'),
      `${JSON.stringify(
        {
          runId: 'seeded-review',
          repoRoot,
          workDir,
          changeName: 'add-thing',
          stage: 'review',
          depth: 'S',
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
    let spawns = 0
    const spawn: SpawnFn = (_command, args, options) => {
      spawns += 1
      if (spawns > stopAfterSpawns) requestCalmStop(runDir)
      const prompt = String(args[args.length - 1])
      const match = prompt.match(/\.review-loop\/([\w.-]+\.json)/u)
      const basename = match?.[1] ?? 'unknown.json'
      const sidecars: Record<string, string> = {
        'findings-1.json': JSON.stringify({ findings: [] }),
        'resolutions-1.json': JSON.stringify({ resolutions: [], assumptions: [] }),
        'decompose-tasks.json': JSON.stringify({ tasks_file: 'openspec/changes/add-thing/tasks.md' }),
      }
      const target = agentWritePath(options.cwd, basename)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, sidecars[basename] ?? '{}')
      return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
    }
    const driverExec = (args: readonly string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
      const sub = args[1]
      if (sub === 'status') {
        return Promise.resolve({
          stdout: JSON.stringify({
            schemaName: 'auto-sdd',
            artifacts: [
              { id: 'proposal', status: 'done' },
              { id: 'specs', status: 'done' },
            ],
          }),
          stderr: '',
          exitCode: 0,
        })
      }
      return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })
    }
    const deps: OrchestratorDeps = {
      config: { repoRoot, workDir, model: 'm', budget: 5 },
      spawn,
      execGit: () => Promise.resolve({ stdout: '', stderr: '' }),
      driver: {
        newChange: () => Promise.resolve({ changeName: 'add-thing' }),
        instructions: () =>
          Promise.resolve({
            instruction: '',
            template: undefined,
            rules: [],
            resolvedOutputPath: '',
            existingOutputPaths: [],
            dependencies: [],
          }),
        validateStrict: () => Promise.resolve({ ok: true, output: 'is valid' }),
        status: () =>
          Promise.resolve({
            schemaName: 'auto-sdd',
            artifacts: { proposal: 'done', specs: 'done' },
            isPlanningComplete: false,
          }),
      },
      resolveCost: () => null,
    }
    void driverExec
    return { deps, workDir, runDir, spawnCount: () => spawns }
  }

  it('a stop landing mid-round lets the in-flight round finish, records status stopped, and skips later rounds', async () => {
    const fixture = makeReviewFixture(2)
    const result = await runResume(fixture.deps, 'seeded-review')
    expect(result.halted).toBe('stopped')
    const state = await loadRunState(fixture.workDir, 'seeded-review')
    expect(state.status).toBe('stopped')
    // round 1's artifacts landed even though the stop arrived during it
    expect(fs.existsSync(path.join(fixture.runDir, 'sidecars', 'resolutions-1.json'))).toBe(true)
  })

  it('without a stop request the same resume run reaches the gate', async () => {
    const fixture = makeReviewFixture(Number.POSITIVE_INFINITY)
    const result = await runResume(fixture.deps, 'seeded-review')
    expect(result.halted).toBe('gate')
  })

  it('runResume holds the run during stage work and releases it at the end', async () => {
    const fixture = makeReviewFixture(Number.POSITIVE_INFINITY)
    const inner = fixture.deps.spawn
    let holderSeenDuringWork = false
    const deps: OrchestratorDeps = {
      ...fixture.deps,
      spawn: (command, args, options) => {
        holderSeenDuringWork ||= readHolder(fixture.runDir) !== null
        return inner(command, args, options)
      },
    }
    const result = await runResume(deps, 'seeded-review')
    expect(result.halted).toBe('gate')
    expect(holderSeenDuringWork).toBe(true)
    expect(readHolder(fixture.runDir)).toBe(null)
  })
})

describe('CalmStopController shape', () => {
  it('exposes the review-loop stop-controller interface', () => {
    const controller: CalmStopController = createStopMarkerSeam(makeDir())
    expect(typeof controller.requested).toBe('function')
    expect(typeof controller.stopRequested).toBe('function')
    expect(typeof controller.consumeMarker).toBe('function')
  })
})
