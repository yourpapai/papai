// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { completedFailedChildHandleOf, settleObservedChild } from '../../sdd-runner/src/child-settle.js'
import type { RunChildrenResult } from '../../sdd-runner/src/child-settle.js'
import { appendEvent, readEvents } from '../../sdd-runner/src/events.js'
import type { SddEvent } from '../../sdd-runner/src/events.js'
import type { OrchestratorDeps, StageContext } from '../../sdd-runner/src/gate-digest.js'
import { createOpenSpecDriver } from '../../sdd-runner/src/openspec-driver.js'
import { createRunState, loadRunState, saveRunState } from '../../sdd-runner/src/run-state.js'
import type { RunState } from '../../sdd-runner/src/run-state.js'
import type { ResolveCostFn } from '../../sdd-runner/src/usage-aggregate.js'

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-childsettle-'))
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
  readonly state: RunState
  readonly deps: OrchestratorDeps
  readonly ctx: StageContext
}

async function makeFixture(): Promise<Fixture> {
  const repoRoot = makeDir()
  const workDir = path.join(repoRoot, '.sdd-runner')
  const state = await createRunState({ workDir, repoRoot, changeName: 'composite' })
  state.children = { 'auth-db': { status: 'failed' } }
  await saveRunState(state, new Date('2026-08-12T08:00:00.000Z'))
  const logPath = path.join(state.runDir, 'events.ndjson')
  appendEvent(logPath, { altitude: 'L2', type: 'stage_enter', stage: 'intake' })
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
  const ctx: StageContext = {
    cwd: repoRoot,
    changeDir: path.join(repoRoot, 'openspec', 'changes', 'composite'),
    sidecarDir: path.join(state.runDir, 'sidecars'),
    emit: (event) => {
      appendEvent(logPath, event)
    },
  }
  return { state, deps, ctx }
}

/** A real child run in the fixture workDir plus its `child_spawned` line in the parent log. */
async function seedSpawnedChildRun(fixture: Fixture, status: RunState['status'], withUsage = false): Promise<RunState> {
  const childState = await createRunState({
    workDir: fixture.deps.config.workDir,
    repoRoot: fixture.deps.config.repoRoot,
    changeName: 'auth-db',
  })
  childState.status = status
  await saveRunState(childState, new Date('2026-08-12T08:00:00.000Z'))
  if (withUsage) {
    appendEvent(path.join(childState.runDir, 'events.ndjson'), {
      altitude: 'L1',
      type: 'done',
      agent: 'estimator',
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        reasoningTokens: 0,
        cachedReadTokens: 0,
        cachedWriteTokens: 0,
        costUsd: 0.25,
        wallMs: 1000,
      },
    })
  }
  appendEvent(path.join(fixture.state.runDir, 'events.ndjson'), {
    altitude: 'L2',
    type: 'child_spawned',
    child: 'auth-db',
    runId: childState.runId,
  })
  return childState
}

function childDoneOf(fixture: Fixture, childId: string): Extract<SddEvent, { type: 'child_done' }>[] {
  return readEvents(path.join(fixture.state.runDir, 'events.ndjson')).filter(
    (event): event is Extract<SddEvent, { type: 'child_done' }> =>
      event.type === 'child_done' && event.child === childId,
  )
}

describe('completedFailedChildHandleOf (D9 ledger sync)', () => {
  it('returns the last spawned handle for a failed-marked child whose run has since completed', async () => {
    const fixture = await makeFixture()
    const childState = await seedSpawnedChildRun(fixture, 'completed')

    expect(await completedFailedChildHandleOf(fixture.deps, fixture.state, 'auth-db')).toEqual({
      runId: childState.runId,
    })
  })

  it('returns null for a pending child even when its closed flight completed (stale spawn of a superseded plan)', async () => {
    const fixture = await makeFixture()
    fixture.state.children = { 'auth-db': { status: 'pending' } }
    await seedSpawnedChildRun(fixture, 'completed')

    expect(await completedFailedChildHandleOf(fixture.deps, fixture.state, 'auth-db')).toBeNull()
  })

  it('returns null while the last spawned run is still non-terminal (stopAtLiveChildHolder owns that stop)', async () => {
    const fixture = await makeFixture()
    await seedSpawnedChildRun(fixture, 'stopped')

    expect(await completedFailedChildHandleOf(fixture.deps, fixture.state, 'auth-db')).toBeNull()
  })

  it('returns null when the child has no recorded spawn line', async () => {
    const fixture = await makeFixture()

    expect(await completedFailedChildHandleOf(fixture.deps, fixture.state, 'auth-db')).toBeNull()
  })
})

describe('settleObservedChild adoption of an operator-completed failed child', () => {
  it('settles the flight done with usage, marks the child done, and continues the walk', async () => {
    const fixture = await makeFixture()
    const childState = await seedSpawnedChildRun(fixture, 'completed', true)
    const resolve: ResolveCostFn = () => null
    const walked: string[] = []
    const next = (): Promise<RunChildrenResult> => {
      walked.push('next')
      return Promise.resolve({ halted: 'completed' })
    }

    const result = await settleObservedChild(
      fixture.deps,
      fixture.state,
      fixture.ctx,
      undefined,
      'auth-db',
      { runId: childState.runId },
      resolve,
      next,
    )

    expect(result).toEqual({ halted: 'completed' })
    expect(walked).toEqual(['next'])
    const done = childDoneOf(fixture, 'auth-db')
    expect(done).toHaveLength(1)
    expect(done[0]).toMatchObject({ outcome: 'done', usage: { costUsd: 0.25 } })
    const persisted = await loadRunState(fixture.deps.config.workDir, fixture.state.runId)
    expect(persisted.children?.['auth-db']).toEqual({ status: 'done' })
  })
})
