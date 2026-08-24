// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { appendEvent } from '../../sdd-runner/src/events.js'
import type { OrchestratorDeps } from '../../sdd-runner/src/gate-digest.js'
import { createOpenSpecDriver } from '../../sdd-runner/src/openspec-driver.js'
import { isPlanParentResume, resumePlanParent } from '../../sdd-runner/src/plan-resume.js'
import type { StartChildRun } from '../../sdd-runner/src/plan-resume.js'
import type { PlanChild } from '../../sdd-runner/src/plan.js'
import { createRunState, loadRunState, saveRunState } from '../../sdd-runner/src/run-state.js'
import type { RunState } from '../../sdd-runner/src/run-state.js'
import { requestCalmStop, stopMarkerPath } from '../../sdd-runner/src/stop-controller.js'

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-planresume-'))
  tmpDirs.push(dir)
  return dir
}

/** Poll with jitter tolerance (D11 propagation runs on a 25 ms watcher). */
async function pollFor(condition: () => boolean, timeoutMs = 2000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (condition()) return true
    await new Promise((resolve) => {
      setTimeout(resolve, 10)
    })
  }
  return condition()
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

const CHILDREN: readonly PlanChild[] = [
  { id: 'db-schema', instruction: 'Rename the schema columns.', deps: [] },
  { id: 'db-api', instruction: 'Rename the API route helpers.', deps: ['db-schema'] },
]

async function makeFixture(): Promise<{ repoRoot: string; deps: OrchestratorDeps; state: RunState }> {
  const repoRoot = makeDir()
  const workDir = path.join(repoRoot, '.sdd-runner')
  const state = await createRunState({ workDir, repoRoot, changeName: 'composite' })
  appendEvent(path.join(state.runDir, 'events.ndjson'), { altitude: 'L2', type: 'stage_enter', stage: 'intake' })
  state.plan = { childIds: CHILDREN.map((child) => child.id), digest: 'd'.repeat(16) }
  state.children = Object.fromEntries(CHILDREN.map((child) => [child.id, { status: 'pending' }]))
  fs.mkdirSync(path.join(state.runDir, 'sidecars'), { recursive: true })
  fs.writeFileSync(path.join(state.runDir, 'sidecars', 'plan.json'), JSON.stringify({ children: CHILDREN }))
  await saveRunState(state, new Date('2026-08-12T08:00:00.000Z'))
  const deps: OrchestratorDeps = {
    config: { repoRoot, workDir, model: 'test-model', budget: 5 },
    spawn: () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
    execGit: () => Promise.resolve({ stdout: '', stderr: '' }),
    driver: createOpenSpecDriver({
      exec: () => Promise.resolve({ stdout: 'ok', stderr: '', exitCode: 0 }),
      cwd: repoRoot,
    }),
    resolveCost: () => null,
    now: () => new Date('2026-08-12T08:00:00.000Z'),
  }
  return { repoRoot, deps, state }
}

describe('isPlanParentResume', () => {
  it('accepts a plan-carrying running or stopped state and rejects completed or plan-less states', async () => {
    const fixture = await makeFixture()
    expect(isPlanParentResume(fixture.state)).toBe(true)
    fixture.state.status = 'stopped'
    expect(isPlanParentResume(fixture.state)).toBe(true)
    fixture.state.status = 'completed'
    expect(isPlanParentResume(fixture.state)).toBe(false)
    const single = await createRunState({
      workDir: fixture.deps.config.workDir,
      repoRoot: fixture.repoRoot,
      changeName: 'plain-run',
    })
    expect(isPlanParentResume(single)).toBe(false)
  })
})

describe('resumePlanParent (D9 interception)', () => {
  it('drives runChildren through the supplied starter with the materialized task file', async () => {
    const fixture = await makeFixture()
    const startedFiles: string[] = []
    const startChildRun: StartChildRun = async (_deps, options) => {
      startedFiles.push(options.taskFile)
      const child = await createRunState({
        workDir: fixture.deps.config.workDir,
        repoRoot: fixture.repoRoot,
        changeName: 'db-schema',
      })
      child.status = 'stopped'
      await saveRunState(child, new Date('2026-08-12T08:00:00.000Z'))
      return { runId: child.runId }
    }

    const result = await resumePlanParent(
      fixture.deps,
      fixture.state,
      () => undefined,
      { level: 'assist', costCeilingUsd: 5 },
      startChildRun,
    )

    expect(result.halted).toBe('stopped')
    expect(startedFiles).toEqual([path.join(fixture.state.runDir, 'children', '1-db-schema.md')])
    const persisted = await loadRunState(fixture.deps.config.workDir, fixture.state.runId)
    expect(persisted.status).toBe('stopped')
    expect(fs.existsSync(path.join(fixture.repoRoot, 'openspec', 'changes', 'composite'))).toBe(false)
  })

  it('forwards the running tree spend as spendBaselineUsd into the nested starter (D10)', async () => {
    const fixture = await makeFixture()
    appendEvent(path.join(fixture.state.runDir, 'events.ndjson'), {
      altitude: 'L2',
      type: 'child_done',
      child: 'db-schema',
      outcome: 'done',
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        reasoningTokens: 0,
        cachedReadTokens: 0,
        cachedWriteTokens: 0,
        costUsd: 1.25,
        wallMs: 1000,
      },
    })
    fixture.state.children = { 'db-schema': { status: 'done' }, 'db-api': { status: 'pending' } }
    await saveRunState(fixture.state, new Date('2026-08-12T08:00:00.000Z'))
    const baselines: number[] = []
    const startChildRun: StartChildRun = async (_deps, options) => {
      baselines.push(options.spendBaselineUsd)
      const child = await createRunState({
        workDir: fixture.deps.config.workDir,
        repoRoot: fixture.repoRoot,
        changeName: 'db-api',
      })
      child.status = 'stopped'
      await saveRunState(child, new Date('2026-08-12T08:00:00.000Z'))
      return { runId: child.runId }
    }

    const result = await resumePlanParent(
      fixture.deps,
      fixture.state,
      () => undefined,
      { level: 'assist', costCeilingUsd: 5 },
      startChildRun,
    )

    expect(result.halted).toBe('stopped')
    expect(baselines).toEqual([1.25])
  })

  it('surfaces a gate-pending child and records it running', async () => {
    const fixture = await makeFixture()
    const startChildRun: StartChildRun = async (_deps, _options) => {
      const child = await createRunState({
        workDir: fixture.deps.config.workDir,
        repoRoot: fixture.repoRoot,
        changeName: 'db-schema',
      })
      child.gate = { mode: 'final', version: 1 }
      await saveRunState(child, new Date('2026-08-12T08:00:00.000Z'))
      return { runId: child.runId }
    }

    const result = await resumePlanParent(
      fixture.deps,
      fixture.state,
      () => undefined,
      { level: 'assist', costCeilingUsd: 5 },
      startChildRun,
    )

    expect(result.halted).toBe('gate-pending')
    const persisted = await loadRunState(fixture.deps.config.workDir, fixture.state.runId)
    expect(persisted.children?.['db-schema']).toEqual({ status: 'running' })
  })

  it('forwards onRunDirReady so a parent calm-stop mid-flight reaches the child run dir (D11)', async () => {
    const fixture = await makeFixture()
    let markerArrived = false
    const startChildRun: StartChildRun = async (_deps, options) => {
      const child = await createRunState({
        workDir: fixture.deps.config.workDir,
        repoRoot: fixture.repoRoot,
        changeName: 'db-schema',
      })
      options.onRunDirReady?.(child.runDir)
      requestCalmStop(fixture.state.runDir)
      markerArrived = await pollFor(() => fs.existsSync(stopMarkerPath(child.runDir)))
      child.status = 'stopped'
      await saveRunState(child, new Date('2026-08-12T08:00:00.000Z'))
      return { runId: child.runId }
    }

    const result = await resumePlanParent(
      fixture.deps,
      fixture.state,
      () => undefined,
      { level: 'assist', costCeilingUsd: 5 },
      startChildRun,
    )

    expect(result.halted).toBe('stopped')
    expect(markerArrived).toBe(true)
  })
})
