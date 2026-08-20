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
import { createStopMarkerSeam, requestCalmStop, stopMarkerPath } from '../../sdd-runner/src/stop-controller.js'
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
})

describe('CalmStopController shape', () => {
  it('exposes the review-loop stop-controller interface', () => {
    const controller: CalmStopController = createStopMarkerSeam(makeDir())
    expect(typeof controller.requested).toBe('function')
    expect(typeof controller.stopRequested).toBe('function')
    expect(typeof controller.consumeMarker).toBe('function')
  })
})
