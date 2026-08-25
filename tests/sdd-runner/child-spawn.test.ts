// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { lastSpawnedHandleOf, spawnRecorderOf } from '../../sdd-runner/src/child-spawn.js'
import type { SpawnRecorder } from '../../sdd-runner/src/child-spawn.js'
import { appendEvent, readEvents } from '../../sdd-runner/src/events.js'
import type { OrchestratorDeps, StageContext } from '../../sdd-runner/src/gate-digest.js'
import { createOpenSpecDriver } from '../../sdd-runner/src/openspec-driver.js'
import { createRunState, loadRunState, saveRunState } from '../../sdd-runner/src/run-state.js'
import type { RunState } from '../../sdd-runner/src/run-state.js'

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-childspawn-'))
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
  state.children = { 'auth-db': { status: 'pending' } }
  await saveRunState(state, new Date('2026-08-12T08:00:00.000Z'))
  const logPath = path.join(state.runDir, 'events.ndjson')
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

describe('spawnRecorderOf (D8 crash-durability)', () => {
  it('emits child_spawned with the runId derived from the run dir and persists the child running', async () => {
    const { state, deps, ctx } = await makeFixture()
    const recorder = spawnRecorderOf(deps, state, ctx, 'auth-db')

    recorder.onRunDirReady(path.join(deps.config.workDir, 'runs', 'auth-db-7'))
    await recorder.persisted()

    const events = readEvents(path.join(state.runDir, 'events.ndjson'))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'child_spawned', child: 'auth-db', runId: 'auth-db-7' })
    const persisted = await loadRunState(deps.config.workDir, state.runId)
    expect(persisted.children?.['auth-db']).toEqual({ status: 'running' })
  })

  it('records only once per flight and reports recorded() accordingly', async () => {
    const { state, deps, ctx } = await makeFixture()
    const recorder = spawnRecorderOf(deps, state, ctx, 'auth-db')

    expect(recorder.recorded()).toBe(false)
    recorder.onRunDirReady(path.join(deps.config.workDir, 'runs', 'auth-db-7'))
    recorder.onRunDirReady(path.join(deps.config.workDir, 'runs', 'auth-db-8'))
    expect(recorder.recorded()).toBe(true)
    await recorder.persisted()

    const events = readEvents(path.join(state.runDir, 'events.ndjson'))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ runId: 'auth-db-7' })
  })

  it('persisted() resolves without side effects when the callback never fired', async () => {
    const { state, deps, ctx } = await makeFixture()
    const recorder: SpawnRecorder = spawnRecorderOf(deps, state, ctx, 'auth-db')

    await recorder.persisted()
    const persisted = await loadRunState(deps.config.workDir, state.runId)
    expect(persisted.children?.['auth-db']).toEqual({ status: 'pending' })
  })
})

describe('lastSpawnedHandleOf (D8 resume recovery)', () => {
  it('returns the most recent child_spawned runId for the child', async () => {
    const { state } = await makeFixture()
    const log = path.join(state.runDir, 'events.ndjson')
    appendEvent(log, { altitude: 'L2', type: 'child_spawned', child: 'auth-db', runId: 'run-1' })
    appendEvent(log, { altitude: 'L2', type: 'child_spawned', child: 'other', runId: 'run-2' })
    appendEvent(log, { altitude: 'L2', type: 'child_spawned', child: 'auth-db', runId: 'run-3' })

    expect(lastSpawnedHandleOf(state, 'auth-db')).toEqual({ runId: 'run-3' })
  })

  it('skips legacy child_spawned lines without a runId and yields null when none carry one', async () => {
    const { state } = await makeFixture()
    const log = path.join(state.runDir, 'events.ndjson')
    appendEvent(log, { altitude: 'L2', type: 'child_spawned', child: 'auth-db' })

    expect(lastSpawnedHandleOf(state, 'auth-db')).toBe(null)
    expect(lastSpawnedHandleOf(state, 'never-spawned')).toBe(null)
  })
})
