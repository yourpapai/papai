// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { runChildren, runPlanBranch } from '../../sdd-runner/src/children.js'
import type { RunChildRun } from '../../sdd-runner/src/children.js'
import { appendEvent, readEvents } from '../../sdd-runner/src/events.js'
import type { SddEvent } from '../../sdd-runner/src/events.js'
import type { OrchestratorDeps, StageContext } from '../../sdd-runner/src/gate-digest.js'
import { createOpenSpecDriver } from '../../sdd-runner/src/openspec-driver.js'
import { planDigest } from '../../sdd-runner/src/plan.js'
import type { PlanChild, PlanFsDeps } from '../../sdd-runner/src/plan.js'
import { createRunState, loadRunState, saveRunState } from '../../sdd-runner/src/run-state.js'
import type { RunState } from '../../sdd-runner/src/run-state.js'
import { createStopMarkerSeam, requestCalmStop, stopMarkerPath } from '../../sdd-runner/src/stop-controller.js'
import { treeSpend } from '../../sdd-runner/src/usage-aggregate.js'

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-children-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

const CHILDREN: readonly PlanChild[] = [
  { id: 'auth-db', instruction: 'Add the auth database schema.\nSecond line ignored.', deps: [] },
  { id: 'auth-api', instruction: 'Add the auth API endpoints.', deps: ['auth-db'], capabilities: ['codeindex'] },
]

interface FakeFs {
  readonly fs: PlanFsDeps
  readonly dirs: string[]
  readonly writes: { readonly file: string; readonly data: string }[]
  readonly listed: string[]
  readonly unlinked: string[]
}

function makeFakeFs(): FakeFs {
  const dirs: string[] = []
  const writes: { file: string; data: string }[] = []
  const listed: string[] = []
  const unlinked: string[] = []
  const fsSeam: PlanFsDeps = {
    mkdir: (dir) => {
      dirs.push(dir)
      return Promise.resolve(undefined)
    },
    writeFile: (file, data) => {
      writes.push({ file, data })
      return Promise.resolve()
    },
    readdir: (dir) => {
      listed.push(dir)
      return Promise.resolve([])
    },
    unlink: (file) => {
      unlinked.push(file)
      return Promise.resolve()
    },
  }
  return { fs: fsSeam, dirs, writes, listed, unlinked }
}

interface ChildrenFixture {
  readonly repoRoot: string
  readonly state: RunState
  readonly deps: OrchestratorDeps
  readonly ctx: StageContext
}

async function makeFixture(): Promise<ChildrenFixture> {
  const repoRoot = makeDir()
  const workDir = path.join(repoRoot, '.sdd-runner')
  const state = await createRunState({ workDir, repoRoot, changeName: 'composite' })
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
  return { repoRoot, state, deps, ctx }
}

describe('runPlanBranch (D7)', () => {
  it('materializes through the injected fs seam, emits the plan event, sets and persists state, and presents the plan gate', async () => {
    const fixture = await makeFixture()
    const fake = makeFakeFs()
    const result = await runPlanBranch(fixture.deps, fixture.state, fixture.ctx, CHILDREN, { fs: fake.fs })

    expect(result.halted).toBe('gate')
    expect(result.gateMdPath).toBe(path.join(fixture.state.runDir, 'gate-1.md'))
    expect(result.version).toBe(1)

    const childrenDir = path.join(fixture.state.runDir, 'children')
    expect(fake.dirs).toEqual([childrenDir])
    expect(fake.listed).toEqual([childrenDir])
    expect(fake.writes.map((w) => w.file)).toEqual([
      path.join(childrenDir, '1-auth-db.md'),
      path.join(childrenDir, '2-auth-api.md'),
    ])
    expect(fake.writes[0]?.data).toContain('# auth-db')
    expect(fake.unlinked).toEqual([])

    const digest = planDigest(CHILDREN)
    const planEvents = readEvents(path.join(fixture.state.runDir, 'events.ndjson')).filter(
      (e): e is Extract<SddEvent, { type: 'plan' }> => e.type === 'plan',
    )
    expect(planEvents).toHaveLength(1)
    expect(planEvents[0]).toMatchObject({ childCount: 2, digest })

    expect(fixture.state.plan).toEqual({ childIds: ['auth-db', 'auth-api'], digest })
    expect(fixture.state.children).toEqual({
      'auth-db': { status: 'pending' },
      'auth-api': { status: 'pending' },
    })

    const persisted = await loadRunState(fixture.deps.config.workDir, fixture.state.runId)
    expect(persisted.plan).toEqual({ childIds: ['auth-db', 'auth-api'], digest })
    expect(persisted.children).toEqual({
      'auth-db': { status: 'pending' },
      'auth-api': { status: 'pending' },
    })
    expect(persisted.gate).toEqual({ mode: 'plan', version: 1 })

    const md = fs.readFileSync(result.gateMdPath, 'utf8')
    expect(md).toContain('## Plan gate')
    expect(md).toContain('- [ ] C1 auth-db — Add the auth database schema.')
    expect(md).toContain('- [ ] C2 auth-api — Add the auth API endpoints. · deps: auth-db · capabilities: codeindex')

    const gateEvents = readEvents(path.join(fixture.state.runDir, 'events.ndjson')).filter(
      (e): e is Extract<SddEvent, { type: 'gate' }> => e.type === 'gate',
    )
    expect(gateEvents).toHaveLength(1)
    expect(gateEvents[0]).toMatchObject({ action: 'presented', mode: 'plan', version: 1 })
  })

  it('topo-reorders an unsorted plan before numbering files, ids, and the digest', async () => {
    const fixture = await makeFixture()
    const fake = makeFakeFs()
    const unsorted: readonly PlanChild[] = [
      { id: 'auth-api', instruction: 'Add the auth API endpoints.', deps: ['auth-db'] },
      { id: 'auth-db', instruction: 'Add the auth database schema.', deps: [] },
    ]
    const result = await runPlanBranch(fixture.deps, fixture.state, fixture.ctx, unsorted, { fs: fake.fs })

    const childrenDir = path.join(fixture.state.runDir, 'children')
    expect(fake.writes.map((w) => w.file)).toEqual([
      path.join(childrenDir, '1-auth-db.md'),
      path.join(childrenDir, '2-auth-api.md'),
    ])
    expect(fixture.state.plan).toEqual({
      childIds: ['auth-db', 'auth-api'],
      digest: planDigest(unsorted.slice().reverse()),
    })
    const md = fs.readFileSync(result.gateMdPath, 'utf8')
    expect(md).toContain('- [ ] C1 auth-db — Add the auth database schema.')
    expect(md).toContain('- [ ] C2 auth-api — Add the auth API endpoints. · deps: auth-db')
  })

  it('presents at the requested version with the plan policy skipped (replan tail options)', async () => {
    const fixture = await makeFixture()
    const fake = makeFakeFs()

    const result = await runPlanBranch(fixture.deps, fixture.state, fixture.ctx, CHILDREN, {
      fs: fake.fs,
      version: 4,
      skipPolicy: true,
    })

    expect(result.version).toBe(4)
    expect(result.gateMdPath).toBe(path.join(fixture.state.runDir, 'gate-4.md'))
    const persisted = await loadRunState(fixture.deps.config.workDir, fixture.state.runId)
    expect(persisted.gate).toEqual({ mode: 'plan', version: 4 })
    expect(fs.existsSync(path.join(fixture.state.runDir, 'auto-policy.jsonl'))).toBe(false)
    expect(fs.readFileSync(result.gateMdPath, 'utf8')).not.toContain('Auto-decision preview')
  })
})

const CHILD_DONE_USAGE = {
  inputTokens: 100,
  outputTokens: 50,
  reasoningTokens: 0,
  cachedReadTokens: 0,
  cachedWriteTokens: 0,
  costUsd: 0.25,
  wallMs: 1000,
}

interface ChildShape {
  readonly status?: RunState['status']
  readonly gate?: { readonly mode: 'early' | 'final' | 'plan'; readonly version: number }
  readonly withUsage?: boolean
  /** The child log carries a zero-cost, token-bearing done event the resolver cannot price. */
  readonly unpricedUsage?: boolean
  /** The child is itself a plan parent: its log also carries a child_done with this cost. */
  readonly grandchildCostUsd?: number
  readonly unloadable?: boolean
  /** The fake waits for the child's own stop marker and honors it (D11). */
  readonly honorChildMarker?: boolean
}

interface RunnerTracker {
  readonly runChildRun: RunChildRun
  readonly spawned: string[]
  readonly taskFiles: string[]
  readonly runIds: Map<string, string>
  readonly maxInFlight: { value: number }
  readonly baselines: number[]
  readonly markersSeen: Map<string, boolean>
  readonly armInFlightGate: () => Promise<void>
}

async function seedParent(
  fixture: ChildrenFixture,
  childIds: readonly string[],
  statuses: Record<string, 'pending' | 'running' | 'done'>,
): Promise<void> {
  fixture.state.plan = { childIds: [...childIds], digest: 'd'.repeat(16) }
  fixture.state.children = Object.fromEntries(childIds.map((id) => [id, { status: statuses[id] ?? 'pending' }]))
  fs.mkdirSync(path.join(fixture.state.runDir, 'sidecars'), { recursive: true })
  fs.writeFileSync(path.join(fixture.state.runDir, 'sidecars', 'plan.json'), JSON.stringify({ children: CHILDREN }))
  await saveRunState(fixture.state, new Date('2026-08-12T08:00:00.000Z'))
}

function makeRunner(fixture: ChildrenFixture, shapes: Record<string, ChildShape>): RunnerTracker {
  const spawned: string[] = []
  const taskFiles: string[] = []
  const runIds = new Map<string, string>()
  const maxInFlight = { value: 0 }
  const baselines: number[] = []
  const markersSeen = new Map<string, boolean>()
  let inFlight = 0
  let inFlightRelease: (() => void) | null = null
  let inFlightGate: Promise<void> | null = null
  const defaultShape: ChildShape = { status: 'completed', withUsage: true }
  const runChildRun: RunChildRun = async (child, taskFile, spendBaselineUsd, onRunDirReady) => {
    inFlight += 1
    maxInFlight.value = Math.max(maxInFlight.value, inFlight)
    spawned.push(child.id)
    taskFiles.push(taskFile)
    baselines.push(spendBaselineUsd)
    const shape = shapes[child.id] ?? defaultShape
    const childState = await createRunState({
      workDir: fixture.deps.config.workDir,
      repoRoot: fixture.repoRoot,
      changeName: child.id,
    })
    if (shape.status !== undefined) childState.status = shape.status
    if (shape.gate !== undefined) childState.gate = shape.gate
    await saveRunState(childState, new Date('2026-08-12T08:00:00.000Z'))
    if (shape.unloadable === true) fs.rmSync(childState.statePath)
    if (shape.withUsage === true) {
      appendEvent(path.join(childState.runDir, 'events.ndjson'), {
        altitude: 'L1',
        type: 'done',
        agent: 'estimator',
        usage: CHILD_DONE_USAGE,
      })
    }
    if (shape.unpricedUsage === true) {
      appendEvent(path.join(childState.runDir, 'events.ndjson'), {
        altitude: 'L1',
        type: 'done',
        agent: 'estimator',
        usage: { ...CHILD_DONE_USAGE, costUsd: 0 },
      })
    }
    if (shape.grandchildCostUsd !== undefined) {
      appendEvent(path.join(childState.runDir, 'events.ndjson'), {
        altitude: 'L2',
        type: 'child_done',
        child: `${child.id}-grandchild`,
        outcome: 'done',
        usage: { ...CHILD_DONE_USAGE, costUsd: shape.grandchildCostUsd },
      })
    }
    onRunDirReady?.(childState.runDir)
    if (shape.honorChildMarker === true) {
      if (inFlightRelease !== null) inFlightRelease()
      const marker = stopMarkerPath(childState.runDir)
      const seen = await waitFor(() => fs.existsSync(marker))
      markersSeen.set(child.id, seen)
      if (seen) {
        childState.status = 'stopped'
        await saveRunState(childState, new Date('2026-08-12T08:00:00.000Z'))
      }
    }
    runIds.set(child.id, childState.runId)
    inFlight -= 1
    return { runId: childState.runId }
  }
  return {
    runChildRun,
    spawned,
    taskFiles,
    runIds,
    maxInFlight,
    baselines,
    markersSeen,
    armInFlightGate: (): Promise<void> => {
      let resolve: () => void = () => undefined
      inFlightGate = new Promise((res) => {
        resolve = res
      })
      inFlightRelease = resolve
      return inFlightGate
    },
  }
}

async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await condition()) return true
    await new Promise((resolve) => {
      setTimeout(resolve, 10)
    })
  }
  const final = await condition()
  return final
}

function eventsOf(fixture: ChildrenFixture, type: 'child_spawned' | 'child_done'): SddEvent[] {
  return readEvents(path.join(fixture.state.runDir, 'events.ndjson')).filter(
    (e): e is Extract<SddEvent, { type: typeof type }> => e.type === type,
  )
}

function childDoneOf(fixture: ChildrenFixture, childId: string): Extract<SddEvent, { type: 'child_done' }>[] {
  return readEvents(path.join(fixture.state.runDir, 'events.ndjson')).filter(
    (event): event is Extract<SddEvent, { type: 'child_done' }> =>
      event.type === 'child_done' && event.child === childId,
  )
}

describe('runChildren (D8)', () => {
  it('walks childIds in order with at most one child in flight, emitting spawned/done with usage per child', async () => {
    const fixture = await makeFixture()
    await seedParent(fixture, ['auth-db', 'auth-api'], {})
    const tracker = makeRunner(fixture, {})

    const result = await runChildren(fixture.deps, fixture.state, fixture.ctx, { runChildRun: tracker.runChildRun })

    expect(result.halted).toBe('completed')
    expect(tracker.spawned).toEqual(['auth-db', 'auth-api'])
    expect(tracker.maxInFlight.value).toBe(1)
    const childrenDir = path.join(fixture.state.runDir, 'children')
    expect(tracker.taskFiles).toEqual([path.join(childrenDir, '1-auth-db.md'), path.join(childrenDir, '2-auth-api.md')])

    const spawned = eventsOf(fixture, 'child_spawned')
    expect(spawned).toHaveLength(2)
    expect(spawned[0]).toMatchObject({ child: 'auth-db', runId: tracker.runIds.get('auth-db') })
    expect(spawned[1]).toMatchObject({ child: 'auth-api', runId: tracker.runIds.get('auth-api') })

    const done = eventsOf(fixture, 'child_done')
    expect(done).toHaveLength(2)
    expect(done[0]).toMatchObject({ child: 'auth-db', outcome: 'done', usage: { costUsd: 0.25, inputTokens: 100 } })
    expect(done[1]).toMatchObject({ child: 'auth-api', outcome: 'done' })

    expect(fixture.state.children).toEqual({
      'auth-db': { status: 'done' },
      'auth-api': { status: 'done' },
    })
    const persisted = await loadRunState(fixture.deps.config.workDir, fixture.state.runId)
    expect(persisted.children).toEqual({
      'auth-db': { status: 'done' },
      'auth-api': { status: 'done' },
    })
  })

  it('skips children already done and continues at the next not-done child', async () => {
    const fixture = await makeFixture()
    await seedParent(fixture, ['auth-db', 'auth-api'], { 'auth-db': 'done' })
    const tracker = makeRunner(fixture, {})

    const result = await runChildren(fixture.deps, fixture.state, fixture.ctx, { runChildRun: tracker.runChildRun })

    expect(result.halted).toBe('completed')
    expect(tracker.spawned).toEqual(['auth-api'])
    expect(eventsOf(fixture, 'child_spawned')).toHaveLength(1)
    expect(eventsOf(fixture, 'child_done')[0]).toMatchObject({ child: 'auth-api', outcome: 'done' })
    expect(fixture.state.children?.['auth-db']).toEqual({ status: 'done' })
    expect(fixture.state.children?.['auth-api']).toEqual({ status: 'done' })
  })

  it('a gate-pending child records running, prints the sdd line, and returns with the parent running', async () => {
    const fixture = await makeFixture()
    await seedParent(fixture, ['auth-db', 'auth-api'], {})
    const tracker = makeRunner(fixture, {
      'auth-db': { status: 'running', gate: { mode: 'final', version: 1 } },
      'auth-api': { status: 'completed' },
    })
    const stdoutLines: string[] = []
    const deps: OrchestratorDeps = {
      ...fixture.deps,
      stdout: (line: string) => {
        stdoutLines.push(line)
      },
    }

    const result = await runChildren(deps, fixture.state, fixture.ctx, { runChildRun: tracker.runChildRun })

    const childRunId = tracker.runIds.get('auth-db')
    assert(childRunId !== undefined)
    expect(result).toEqual({ halted: 'gate-pending', childRunId })
    expect(tracker.spawned).toEqual(['auth-db'])
    expect(fixture.state.children?.['auth-db']).toEqual({ status: 'running' })
    expect(fixture.state.children?.['auth-api']).toEqual({ status: 'pending' })
    expect(fixture.state.status).toBe('running')
    const persisted = await loadRunState(deps.config.workDir, fixture.state.runId)
    expect(persisted.children?.['auth-db']).toEqual({ status: 'running' })
    expect(persisted.status).toBe('running')

    expect(eventsOf(fixture, 'child_done')).toHaveLength(0)
    expect(stdoutLines.some((line) => line === `sdd ${childRunId}`)).toBe(true)
  })

  it('resume re-observes a gate-settled running child instead of re-spawning it', async () => {
    const fixture = await makeFixture()
    await seedParent(fixture, ['auth-db', 'auth-api'], {})
    const first = makeRunner(fixture, { 'auth-db': { status: 'running', gate: { mode: 'final', version: 1 } } })

    const halted = await runChildren(fixture.deps, fixture.state, fixture.ctx, { runChildRun: first.runChildRun })

    expect(halted.halted).toBe('gate-pending')
    const childRunId = first.runIds.get('auth-db')
    assert(childRunId !== undefined)
    const child = await loadRunState(fixture.deps.config.workDir, childRunId)
    child.gate = null
    child.status = 'completed'
    await saveRunState(child, new Date('2026-08-12T08:00:00.000Z'))
    appendEvent(path.join(child.runDir, 'events.ndjson'), {
      altitude: 'L1',
      type: 'done',
      agent: 'estimator',
      usage: CHILD_DONE_USAGE,
    })

    const resumed = await loadRunState(fixture.deps.config.workDir, fixture.state.runId)
    const second = makeRunner(fixture, {})

    const result = await runChildren(fixture.deps, resumed, fixture.ctx, { runChildRun: second.runChildRun })

    expect(result.halted).toBe('completed')
    expect(second.spawned).toEqual(['auth-api'])
    expect(resumed.children?.['auth-db']).toEqual({ status: 'done' })
    const done = eventsOf(fixture, 'child_done')
    expect(done[0]).toMatchObject({ child: 'auth-db', outcome: 'done', usage: { costUsd: 0.25 } })
    expect(done[1]).toMatchObject({ child: 'auth-api', outcome: 'done' })
  })

  it('resume surfaces a still-gate-pending running child again without re-spawning it', async () => {
    const fixture = await makeFixture()
    await seedParent(fixture, ['auth-db', 'auth-api'], {})
    const first = makeRunner(fixture, { 'auth-db': { status: 'running', gate: { mode: 'final', version: 1 } } })
    await runChildren(fixture.deps, fixture.state, fixture.ctx, { runChildRun: first.runChildRun })
    const childRunId = first.runIds.get('auth-db')
    assert(childRunId !== undefined)

    const resumed = await loadRunState(fixture.deps.config.workDir, fixture.state.runId)
    const second = makeRunner(fixture, {})
    const stdoutLines: string[] = []
    const deps: OrchestratorDeps = {
      ...fixture.deps,
      stdout: (line: string) => {
        stdoutLines.push(line)
      },
    }

    const result = await runChildren(deps, resumed, fixture.ctx, { runChildRun: second.runChildRun })

    expect(result).toEqual({ halted: 'gate-pending', childRunId })
    expect(second.spawned).toEqual([])
    expect(resumed.children?.['auth-db']).toEqual({ status: 'running' })
    expect(stdoutLines.some((line) => line === `sdd ${childRunId}`)).toBe(true)
  })

  it('records child_spawned and a running child before the nested run resolves (mid-flight crash keeps the runId)', async () => {
    const fixture = await makeFixture()
    await seedParent(fixture, ['auth-db'], {})
    let midFlight:
      | {
          readonly spawnedEvents: ReturnType<typeof eventsOf>
          readonly persistedRunning: boolean
          readonly childRunId: string
        }
      | undefined
    const runChildRun: RunChildRun = async (_child, _taskFile, _baseline, onRunDirReady) => {
      const childState = await createRunState({
        workDir: fixture.deps.config.workDir,
        repoRoot: fixture.repoRoot,
        changeName: 'auth-db',
      })
      onRunDirReady?.(childState.runDir)
      const spawnedEvents = eventsOf(fixture, 'child_spawned')
      const persistedRunning = await waitFor(async () => {
        const persisted = await loadRunState(fixture.deps.config.workDir, fixture.state.runId)
        return persisted.children?.['auth-db']?.status === 'running'
      }, 1000)
      midFlight = { spawnedEvents, persistedRunning, childRunId: childState.runId }
      childState.status = 'completed'
      await saveRunState(childState, new Date('2026-08-12T08:00:00.000Z'))
      appendEvent(path.join(childState.runDir, 'events.ndjson'), {
        altitude: 'L1',
        type: 'done',
        agent: 'estimator',
        usage: CHILD_DONE_USAGE,
      })
      return { runId: childState.runId }
    }

    const result = await runChildren(fixture.deps, fixture.state, fixture.ctx, { runChildRun })

    expect(result.halted).toBe('completed')
    assert(midFlight !== undefined)
    expect(midFlight.persistedRunning).toBe(true)
    expect(midFlight.spawnedEvents).toHaveLength(1)
    expect(midFlight.spawnedEvents[0]).toMatchObject({ child: 'auth-db', runId: midFlight.childRunId })
    expect(eventsOf(fixture, 'child_spawned')).toHaveLength(1)
  })

  it('a running child whose spawned runId was never recorded falls back to a fresh spawn', async () => {
    const fixture = await makeFixture()
    await seedParent(fixture, ['auth-db', 'auth-api'], { 'auth-db': 'running' })
    const tracker = makeRunner(fixture, {})

    const result = await runChildren(fixture.deps, fixture.state, fixture.ctx, { runChildRun: tracker.runChildRun })

    expect(result.halted).toBe('completed')
    expect(tracker.spawned).toEqual(['auth-db', 'auth-api'])
  })
})

describe('runChildren failure and completion semantics (D9)', () => {
  it('a child ending aborted/failed/stopped stops the loop immediately, emits child_done failed, and persists the parent stopped with an operator line', async () => {
    for (const status of ['aborted', 'failed', 'stopped'] as const) {
      const fixture = await makeFixture()
      await seedParent(fixture, ['auth-db', 'auth-api'], {})
      const tracker = makeRunner(fixture, {
        'auth-db': { status },
        'auth-api': { status: 'completed' },
      })
      const stdoutLines: string[] = []
      const deps: OrchestratorDeps = {
        ...fixture.deps,
        stdout: (line: string) => {
          stdoutLines.push(line)
        },
      }

      const result = await runChildren(deps, fixture.state, fixture.ctx, { runChildRun: tracker.runChildRun })

      expect(result).toEqual({ halted: 'stopped', child: 'auth-db', childStatus: status })
      expect(tracker.spawned).toEqual(['auth-db'])
      const done = eventsOf(fixture, 'child_done')
      expect(done).toHaveLength(1)
      expect(done[0]).toMatchObject({ child: 'auth-db', outcome: 'failed' })
      expect(fixture.state.children?.['auth-db']).toEqual({ status: 'failed' })
      expect(fixture.state.children?.['auth-api']).toEqual({ status: 'pending' })
      const persisted = await loadRunState(deps.config.workDir, fixture.state.runId)
      expect(persisted.status).toBe('stopped')
      expect(persisted.children?.['auth-db']).toEqual({ status: 'failed' })
      expect(stdoutLines.some((line) => line.includes(`child auth-db ended '${status}'`))).toBe(true)
      expect(fs.existsSync(path.join(fixture.repoRoot, 'openspec', 'changes', fixture.state.changeName))).toBe(false)
    }
  })

  it('an absent state.plan fails closed instead of completing the parent vacuously', async () => {
    const fixture = await makeFixture()
    await seedParent(fixture, ['auth-db', 'auth-api'], {})
    fixture.state.plan = undefined
    const tracker = makeRunner(fixture, {})

    await expect(
      runChildren(fixture.deps, fixture.state, fixture.ctx, { runChildRun: tracker.runChildRun }),
    ).rejects.toThrow('runChildren requires a recorded plan')
    expect(tracker.spawned).toEqual([])
    expect(fixture.state.status).toBe('running')
  })

  it('an absent state.plan fails closed even when the plan sidecar is also missing', async () => {
    const fixture = await makeFixture()
    await seedParent(fixture, ['auth-db', 'auth-api'], {})
    fixture.state.plan = undefined
    fs.rmSync(path.join(fixture.state.runDir, 'sidecars', 'plan.json'))
    const tracker = makeRunner(fixture, {})

    await expect(
      runChildren(fixture.deps, fixture.state, fixture.ctx, { runChildRun: tracker.runChildRun }),
    ).rejects.toThrow('runChildren requires a recorded plan')
    expect(tracker.spawned).toEqual([])
  })

  it('parent completed is persisted exactly when every child id reads done', async () => {
    const fixture = await makeFixture()
    await seedParent(fixture, ['auth-db', 'auth-api'], {})
    const tracker = makeRunner(fixture, {})

    const result = await runChildren(fixture.deps, fixture.state, fixture.ctx, { runChildRun: tracker.runChildRun })

    expect(result.halted).toBe('completed')
    const persisted = await loadRunState(fixture.deps.config.workDir, fixture.state.runId)
    expect(persisted.status).toBe('completed')
    expect(persisted.children).toEqual({
      'auth-db': { status: 'done' },
      'auth-api': { status: 'done' },
    })
    expect(fs.existsSync(path.join(fixture.repoRoot, 'openspec', 'changes', fixture.state.changeName))).toBe(false)
  })

  it('a parent resume after a child failure passes the budget guard and re-runs the failed child (D9x D10)', async () => {
    const fixture = await makeFixture()
    await seedParent(fixture, ['auth-db', 'auth-api'], {})
    const first = makeRunner(fixture, { 'auth-db': { status: 'failed', withUsage: true } })

    const halted = await runChildren(fixture.deps, fixture.state, fixture.ctx, { runChildRun: first.runChildRun })

    expect(halted).toEqual({ halted: 'stopped', child: 'auth-db', childStatus: 'failed' })
    expect(eventsOf(fixture, 'child_done')[0]).toMatchObject({
      child: 'auth-db',
      outcome: 'failed',
      usage: { costUsd: 0.25 },
    })

    const resumed = await loadRunState(fixture.deps.config.workDir, fixture.state.runId)
    const second = makeRunner(fixture, {})

    const result = await runChildren(fixture.deps, resumed, fixture.ctx, { runChildRun: second.runChildRun })

    expect(result.halted).toBe('completed')
    expect(second.spawned).toEqual(['auth-db', 'auth-api'])
  })

  it('an unloadable child state counts as not-done and fails closed', async () => {
    const fixture = await makeFixture()
    await seedParent(fixture, ['auth-db', 'auth-api'], {})
    const tracker = makeRunner(fixture, {
      'auth-db': { unloadable: true },
      'auth-api': { status: 'completed' },
    })
    const stdoutLines: string[] = []
    const deps: OrchestratorDeps = {
      ...fixture.deps,
      stdout: (line: string) => {
        stdoutLines.push(line)
      },
    }

    const result = await runChildren(deps, fixture.state, fixture.ctx, { runChildRun: tracker.runChildRun })

    expect(result).toEqual({ halted: 'stopped', child: 'auth-db', childStatus: 'unloadable' })
    expect(tracker.spawned).toEqual(['auth-db'])
    expect(eventsOf(fixture, 'child_done')[0]).toMatchObject({ child: 'auth-db', outcome: 'failed' })
    const persisted = await loadRunState(deps.config.workDir, fixture.state.runId)
    expect(persisted.status).toBe('stopped')
    expect(stdoutLines.some((line) => line.includes(`child auth-db ended 'unloadable'`))).toBe(true)
  })

  it('a parent resume after an unloadable child state prices the failed settlement from the spawned run dir and re-runs the child', async () => {
    const fixture = await makeFixture()
    await seedParent(fixture, ['auth-db', 'auth-api'], {})
    const first = makeRunner(fixture, { 'auth-db': { unloadable: true, withUsage: true } })

    const halted = await runChildren(fixture.deps, fixture.state, fixture.ctx, { runChildRun: first.runChildRun })

    expect(halted).toEqual({ halted: 'stopped', child: 'auth-db', childStatus: 'unloadable' })
    expect(eventsOf(fixture, 'child_done')[0]).toMatchObject({
      child: 'auth-db',
      outcome: 'failed',
      usage: { costUsd: 0.25 },
    })

    const resumed = await loadRunState(fixture.deps.config.workDir, fixture.state.runId)
    const second = makeRunner(fixture, {})

    const result = await runChildren(fixture.deps, resumed, fixture.ctx, { runChildRun: second.runChildRun })

    expect(result.halted).toBe('completed')
    expect(second.spawned).toEqual(['auth-db', 'auth-api'])
  })
})

describe('aggregate budget ledger (D10)', () => {
  it('halts before the next child_spawned when recorded spend meets the budget, with a loud budget-guard line', async () => {
    const fixture = await makeFixture()
    await seedParent(fixture, ['auth-db', 'auth-api'], { 'auth-db': 'done' })
    appendEvent(path.join(fixture.state.runDir, 'events.ndjson'), {
      altitude: 'L2',
      type: 'child_done',
      child: 'auth-db',
      outcome: 'done',
      usage: { ...CHILD_DONE_USAGE, costUsd: 5 },
    })
    const tracker = makeRunner(fixture, {})
    const stdoutLines: string[] = []
    const deps: OrchestratorDeps = {
      ...fixture.deps,
      stdout: (line: string) => {
        stdoutLines.push(line)
      },
    }

    const result = await runChildren(deps, fixture.state, fixture.ctx, { runChildRun: tracker.runChildRun })

    expect(result).toEqual({ halted: 'stopped', child: 'auth-api', childStatus: 'budget-guard' })
    expect(tracker.spawned).toEqual([])
    expect(eventsOf(fixture, 'child_spawned')).toHaveLength(0)
    const persisted = await loadRunState(deps.config.workDir, fixture.state.runId)
    expect(persisted.status).toBe('stopped')
    expect(persisted.children?.['auth-api']).toEqual({ status: 'pending' })
    expect(stdoutLines.some((line) => line.includes('budget guard'))).toBe(true)
  })

  it('counts a composite child subtree (grandchild) spend against the budget, halting the next spawn', async () => {
    const fixture = await makeFixture()
    await seedParent(fixture, ['auth-db', 'auth-api'], {})
    const tracker = makeRunner(fixture, {
      'auth-db': { status: 'completed', withUsage: true, grandchildCostUsd: 4.9 },
      'auth-api': { status: 'completed', withUsage: true },
    })
    const stdoutLines: string[] = []
    const deps: OrchestratorDeps = {
      ...fixture.deps,
      stdout: (line: string) => {
        stdoutLines.push(line)
      },
    }

    const result = await runChildren(deps, fixture.state, fixture.ctx, { runChildRun: tracker.runChildRun })

    expect(result).toEqual({ halted: 'stopped', child: 'auth-api', childStatus: 'budget-guard' })
    expect(tracker.spawned).toEqual(['auth-db'])
    expect(eventsOf(fixture, 'child_done')[0]).toMatchObject({
      child: 'auth-db',
      outcome: 'done',
      usage: { costUsd: 0.25 + 4.9 },
    })
    expect(stdoutLines.some((line) => line.includes('tree spend $5.15'))).toBe(true)
  })

  it('halts before the next child_spawned on unknown spend (a child_done without usage)', async () => {
    const fixture = await makeFixture()
    await seedParent(fixture, ['auth-db', 'auth-api'], { 'auth-db': 'done' })
    appendEvent(path.join(fixture.state.runDir, 'events.ndjson'), {
      altitude: 'L2',
      type: 'child_done',
      child: 'auth-db',
      outcome: 'done',
    })
    const tracker = makeRunner(fixture, {})
    const stdoutLines: string[] = []
    const deps: OrchestratorDeps = {
      ...fixture.deps,
      stdout: (line: string) => {
        stdoutLines.push(line)
      },
    }

    const result = await runChildren(deps, fixture.state, fixture.ctx, { runChildRun: tracker.runChildRun })

    expect(result).toEqual({ halted: 'stopped', child: 'auth-api', childStatus: 'budget-guard' })
    expect(tracker.spawned).toEqual([])
    const persisted = await loadRunState(deps.config.workDir, fixture.state.runId)
    expect(persisted.status).toBe('stopped')
    expect(stdoutLines.some((line) => /budget guard.*unknown/u.test(line))).toBe(true)
  })

  it('an unmetered parent (budget: null) keeps spawning despite unpriceable spend — no ceiling to guard', async () => {
    const fixture = await makeFixture()
    await seedParent(fixture, ['auth-db', 'auth-api'], { 'auth-db': 'done' })
    appendEvent(path.join(fixture.state.runDir, 'events.ndjson'), {
      altitude: 'L2',
      type: 'child_done',
      child: 'auth-db',
      outcome: 'done',
    })
    const tracker = makeRunner(fixture, {})
    const stdoutLines: string[] = []
    const deps: OrchestratorDeps = {
      ...fixture.deps,
      config: { ...fixture.deps.config, budget: null },
      stdout: (line: string) => {
        stdoutLines.push(line)
      },
    }

    const result = await runChildren(deps, fixture.state, fixture.ctx, { runChildRun: tracker.runChildRun })

    expect(result.halted).toBe('completed')
    expect(tracker.spawned).toEqual(['auth-api'])
    expect(stdoutLines.some((line) => line.includes('budget guard'))).toBe(false)
  })

  it('halts before the next child_spawned when a completed child usage cannot be priced (fail closed)', async () => {
    const fixture = await makeFixture()
    await seedParent(fixture, ['auth-db', 'auth-api'], {})
    const tracker = makeRunner(fixture, {
      'auth-db': { status: 'completed', unpricedUsage: true },
      'auth-api': { status: 'completed', withUsage: true },
    })
    const stdoutLines: string[] = []
    const deps: OrchestratorDeps = {
      ...fixture.deps,
      stdout: (line: string) => {
        stdoutLines.push(line)
      },
    }

    const result = await runChildren(deps, fixture.state, fixture.ctx, { runChildRun: tracker.runChildRun })

    expect(result).toEqual({ halted: 'stopped', child: 'auth-api', childStatus: 'budget-guard' })
    expect(tracker.spawned).toEqual(['auth-db'])
    const done = eventsOf(fixture, 'child_done')
    expect(done[0]).toMatchObject({ child: 'auth-db', outcome: 'done' })
    expect(done[0]).not.toHaveProperty('usage')
    const persisted = await loadRunState(deps.config.workDir, fixture.state.runId)
    expect(persisted.status).toBe('stopped')
    expect(persisted.children?.['auth-api']).toEqual({ status: 'pending' })
    expect(stdoutLines.some((line) => /budget guard.*unknown/u.test(line))).toBe(true)
  })

  it('passes the running tree spend as spendBaselineUsd into each nested run', async () => {
    const fixture = await makeFixture()
    await seedParent(fixture, ['auth-db', 'auth-api'], {})
    const tracker = makeRunner(fixture, {})

    const result = await runChildren(fixture.deps, fixture.state, fixture.ctx, { runChildRun: tracker.runChildRun })

    expect(result.halted).toBe('completed')
    expect(tracker.baselines).toEqual([0, 0.25])
  })

  it('a nested parent counts its ancestor baseline against the budget, halting the next spawn', async () => {
    const fixture = await makeFixture()
    fixture.state.spendBaselineUsd = 4.9
    await seedParent(fixture, ['auth-db', 'auth-api'], {})
    const tracker = makeRunner(fixture, {})
    const stdoutLines: string[] = []
    const deps: OrchestratorDeps = {
      ...fixture.deps,
      stdout: (line: string) => {
        stdoutLines.push(line)
      },
    }

    const result = await runChildren(deps, fixture.state, fixture.ctx, { runChildRun: tracker.runChildRun })

    expect(result).toEqual({ halted: 'stopped', child: 'auth-api', childStatus: 'budget-guard' })
    expect(tracker.spawned).toEqual(['auth-db'])
    expect(stdoutLines.some((line) => line.includes('tree spend $5.15'))).toBe(true)
  })

  it('a nested parent seeds its children with ancestor spend plus its own committed spend', async () => {
    const fixture = await makeFixture()
    fixture.state.spendBaselineUsd = 2
    await seedParent(fixture, ['auth-db', 'auth-api'], {})
    const tracker = makeRunner(fixture, {})

    const result = await runChildren(fixture.deps, fixture.state, fixture.ctx, { runChildRun: tracker.runChildRun })

    expect(result.halted).toBe('completed')
    expect(tracker.baselines).toEqual([2, 2.25])
  })
})

describe('parent calm-stop is subtree-scoped (D11)', () => {
  it('a stop already requested before a spawn settles calmly: no child runs, completed children untouched', async () => {
    const fixture = await makeFixture()
    await seedParent(fixture, ['auth-db', 'auth-api'], { 'auth-db': 'done' })
    const tracker = makeRunner(fixture, {})
    requestCalmStop(fixture.state.runDir)
    const stop = createStopMarkerSeam(fixture.state.runDir)
    const stdoutLines: string[] = []
    const deps: OrchestratorDeps = {
      ...fixture.deps,
      stdout: (line: string) => {
        stdoutLines.push(line)
      },
    }

    const result = await runChildren(deps, fixture.state, fixture.ctx, {
      runChildRun: tracker.runChildRun,
      stop,
    })

    expect(result).toEqual({ runId: fixture.state.runId, halted: 'stopped' })
    expect(tracker.spawned).toEqual([])
    const persisted = await loadRunState(deps.config.workDir, fixture.state.runId)
    expect(persisted.status).toBe('stopped')
    expect(persisted.children?.['auth-db']).toEqual({ status: 'done' })
    expect(persisted.children?.['auth-api']).toEqual({ status: 'pending' })
    expect(fs.existsSync(stopMarkerPath(fixture.state.runDir))).toBe(false)
    expect(stdoutLines.some((line) => line.includes('stopped calmly'))).toBe(true)
  })

  it('a stop requested while a child is in flight writes the child marker, the child honors it, and the parent settles stopped', async () => {
    const fixture = await makeFixture()
    await seedParent(fixture, ['auth-db', 'auth-api'], {})
    const tracker = makeRunner(fixture, {
      'auth-db': { status: 'completed', withUsage: true },
      'auth-api': { honorChildMarker: true },
    })
    const inFlightGate = tracker.armInFlightGate()
    const stop = createStopMarkerSeam(fixture.state.runDir)
    const stdoutLines: string[] = []
    const deps: OrchestratorDeps = {
      ...fixture.deps,
      stdout: (line: string) => {
        stdoutLines.push(line)
      },
    }

    const started = runChildren(deps, fixture.state, fixture.ctx, {
      runChildRun: tracker.runChildRun,
      stop,
    })
    await inFlightGate
    requestCalmStop(fixture.state.runDir)
    const result = await started

    expect(result).toEqual({ runId: fixture.state.runId, halted: 'stopped' })
    expect(tracker.spawned).toEqual(['auth-db', 'auth-api'])
    expect(tracker.markersSeen.get('auth-api')).toBe(true)

    const childRunId = tracker.runIds.get('auth-api')
    assert(childRunId !== undefined)
    const childState = await loadRunState(deps.config.workDir, childRunId)
    expect(childState.status).toBe('stopped')

    const persisted = await loadRunState(deps.config.workDir, fixture.state.runId)
    expect(persisted.status).toBe('stopped')
    expect(persisted.children?.['auth-db']).toEqual({ status: 'done' })
    expect(persisted.children?.['auth-api']).toEqual({ status: 'running' })
    expect(fs.existsSync(stopMarkerPath(fixture.state.runDir))).toBe(false)
    const done = eventsOf(fixture, 'child_done')
    expect(done).toHaveLength(1)
    expect(done[0]).toMatchObject({ child: 'auth-db', outcome: 'done' })
    expect(stdoutLines.some((line) => line.includes('stopped calmly'))).toBe(true)
  })

  it('a parent resume after the calm stop re-observes the child instead of spawning a duplicate run', async () => {
    const fixture = await makeFixture()
    await seedParent(fixture, ['auth-db', 'auth-api'], {})
    const tracker = makeRunner(fixture, {
      'auth-db': { status: 'completed', withUsage: true },
      'auth-api': { honorChildMarker: true },
    })
    const inFlightGate = tracker.armInFlightGate()
    const stop = createStopMarkerSeam(fixture.state.runDir)
    const stdoutLines: string[] = []
    const deps: OrchestratorDeps = {
      ...fixture.deps,
      stdout: (line: string) => {
        stdoutLines.push(line)
      },
    }

    const started = runChildren(deps, fixture.state, fixture.ctx, {
      runChildRun: tracker.runChildRun,
      stop,
    })
    await inFlightGate
    requestCalmStop(fixture.state.runDir)
    await started

    const resumed = await runChildren(deps, fixture.state, fixture.ctx, {
      runChildRun: tracker.runChildRun,
      stop: createStopMarkerSeam(fixture.state.runDir),
    })

    expect(tracker.spawned).toEqual(['auth-db', 'auth-api'])
    expect(resumed).toEqual({ halted: 'stopped', child: 'auth-api', childStatus: 'stopped' })
    expect(stdoutLines.some((line) => line.includes("child auth-api ended 'stopped'"))).toBe(true)
    const persisted = await loadRunState(deps.config.workDir, fixture.state.runId)
    expect(persisted.children?.['auth-api']).toEqual({ status: 'failed' })
  })

  it('a second parent resume after the failed-marked calm-stopped child surfaces the child run instead of re-spawning over its live session id', async () => {
    const fixture = await makeFixture()
    await seedParent(fixture, ['auth-db', 'auth-api'], {})
    const tracker = makeRunner(fixture, {
      'auth-db': { status: 'completed', withUsage: true },
      'auth-api': { honorChildMarker: true, withUsage: true },
    })
    const inFlightGate = tracker.armInFlightGate()
    const stop = createStopMarkerSeam(fixture.state.runDir)
    const stdoutLines: string[] = []
    const deps: OrchestratorDeps = {
      ...fixture.deps,
      stdout: (line: string) => {
        stdoutLines.push(line)
      },
    }

    const started = runChildren(deps, fixture.state, fixture.ctx, {
      runChildRun: tracker.runChildRun,
      stop,
    })
    await inFlightGate
    requestCalmStop(fixture.state.runDir)
    await started
    const first = await runChildren(deps, fixture.state, fixture.ctx, {
      runChildRun: tracker.runChildRun,
      stop: createStopMarkerSeam(fixture.state.runDir),
    })
    expect(first).toEqual({ halted: 'stopped', child: 'auth-api', childStatus: 'stopped' })

    const second = await runChildren(deps, await loadRunState(deps.config.workDir, fixture.state.runId), fixture.ctx, {
      runChildRun: tracker.runChildRun,
      stop: createStopMarkerSeam(fixture.state.runDir),
    })

    const childRunId = tracker.runIds.get('auth-api')
    assert(childRunId !== undefined)
    expect(second).toEqual({ halted: 'stopped', child: 'auth-api', childStatus: 'stopped' })
    expect(tracker.spawned).toEqual(['auth-db', 'auth-api'])
    expect(stdoutLines.some((line) => line === `sdd ${childRunId}`)).toBe(true)
    expect(stdoutLines.some((line) => line.includes('resume or settle'))).toBe(true)
    const persisted = await loadRunState(deps.config.workDir, fixture.state.runId)
    expect(persisted.status).toBe('stopped')
    expect(persisted.children?.['auth-api']).toEqual({ status: 'failed' })
  })

  it('a parent resume after the operator completes the surfaced child run adopts the flight as done instead of re-spawning a duplicate', async () => {
    const fixture = await makeFixture()
    await seedParent(fixture, ['auth-db', 'auth-api'], {})
    const tracker = makeRunner(fixture, {
      'auth-db': { status: 'completed', withUsage: true },
      'auth-api': { honorChildMarker: true, withUsage: true },
    })
    const inFlightGate = tracker.armInFlightGate()
    const stop = createStopMarkerSeam(fixture.state.runDir)
    const stdoutLines: string[] = []
    const deps: OrchestratorDeps = {
      ...fixture.deps,
      stdout: (line: string) => {
        stdoutLines.push(line)
      },
    }

    const started = runChildren(deps, fixture.state, fixture.ctx, {
      runChildRun: tracker.runChildRun,
      stop,
    })
    await inFlightGate
    requestCalmStop(fixture.state.runDir)
    await started
    const first = await runChildren(deps, fixture.state, fixture.ctx, {
      runChildRun: tracker.runChildRun,
      stop: createStopMarkerSeam(fixture.state.runDir),
    })
    expect(first).toEqual({ halted: 'stopped', child: 'auth-api', childStatus: 'stopped' })
    const second = await runChildren(deps, await loadRunState(deps.config.workDir, fixture.state.runId), fixture.ctx, {
      runChildRun: tracker.runChildRun,
      stop: createStopMarkerSeam(fixture.state.runDir),
    })
    expect(second).toEqual({ halted: 'stopped', child: 'auth-api', childStatus: 'stopped' })
    const childRunId = tracker.runIds.get('auth-api')
    assert(childRunId !== undefined)
    expect(stdoutLines.some((line) => line.includes('resume or settle'))).toBe(true)

    const childState = await loadRunState(deps.config.workDir, childRunId)
    childState.status = 'completed'
    await saveRunState(childState, new Date('2026-08-12T08:00:00.000Z'))

    const third = await runChildren(deps, await loadRunState(deps.config.workDir, fixture.state.runId), fixture.ctx, {
      runChildRun: tracker.runChildRun,
      stop: createStopMarkerSeam(fixture.state.runDir),
    })

    expect(third).toEqual({ halted: 'completed' })
    expect(tracker.spawned).toEqual(['auth-db', 'auth-api'])
    const done = childDoneOf(fixture, 'auth-api')
    expect(done).toHaveLength(2)
    expect(done[0]).toMatchObject({ outcome: 'failed', usage: { costUsd: 0.25 } })
    expect(done[1]).toMatchObject({ outcome: 'done', usage: { costUsd: 0.25 } })
    const spend = treeSpend(readEvents(path.join(fixture.state.runDir, 'events.ndjson')))
    expect(spend).toEqual({ spentUsd: 0.5, costKnown: true })
    const persisted = await loadRunState(deps.config.workDir, fixture.state.runId)
    expect(persisted.status).toBe('completed')
    expect(persisted.children?.['auth-api']).toEqual({ status: 'done' })
  }, 20000)
})

describe('crash-window idempotency at the event-log/state boundary (D8)', () => {
  async function seedChildRun(
    fixture: ChildrenFixture,
    childId: string,
    status: RunState['status'],
  ): Promise<RunState> {
    const childState = await createRunState({
      workDir: fixture.deps.config.workDir,
      repoRoot: fixture.repoRoot,
      changeName: childId,
    })
    childState.status = status
    await saveRunState(childState, new Date('2026-08-12T08:00:00.000Z'))
    appendEvent(path.join(childState.runDir, 'events.ndjson'), {
      altitude: 'L1',
      type: 'done',
      agent: 'estimator',
      usage: CHILD_DONE_USAGE,
    })
    return childState
  }

  it('a crash after the child_done append but before the done-status save emits no second child_done on resume', async () => {
    const fixture = await makeFixture()
    await seedParent(fixture, ['auth-db', 'auth-api'], { 'auth-db': 'running' })
    const childState = await seedChildRun(fixture, 'auth-db', 'completed')
    const log = path.join(fixture.state.runDir, 'events.ndjson')
    appendEvent(log, { altitude: 'L2', type: 'child_spawned', child: 'auth-db', runId: childState.runId })
    appendEvent(log, {
      altitude: 'L2',
      type: 'child_done',
      child: 'auth-db',
      outcome: 'done',
      usage: CHILD_DONE_USAGE,
    })
    const tracker = makeRunner(fixture, {})

    const result = await runChildren(fixture.deps, fixture.state, fixture.ctx, { runChildRun: tracker.runChildRun })

    expect(result.halted).toBe('completed')
    expect(tracker.spawned).toEqual(['auth-api'])
    expect(childDoneOf(fixture, 'auth-db')).toHaveLength(1)
    const persisted = await loadRunState(fixture.deps.config.workDir, fixture.state.runId)
    expect(persisted.children?.['auth-db']).toEqual({ status: 'done' })
  })

  it('a crash after the child_spawned append but before the running-status save re-observes the recorded runId instead of re-spawning', async () => {
    const fixture = await makeFixture()
    await seedParent(fixture, ['auth-db', 'auth-api'], {})
    const childState = await seedChildRun(fixture, 'auth-db', 'completed')
    appendEvent(path.join(fixture.state.runDir, 'events.ndjson'), {
      altitude: 'L2',
      type: 'child_spawned',
      child: 'auth-db',
      runId: childState.runId,
    })
    const tracker = makeRunner(fixture, {})

    const result = await runChildren(fixture.deps, fixture.state, fixture.ctx, { runChildRun: tracker.runChildRun })

    expect(result.halted).toBe('completed')
    expect(tracker.spawned).toEqual(['auth-api'])
    const done = childDoneOf(fixture, 'auth-db')
    expect(done).toHaveLength(1)
    expect(done[0]).toMatchObject({ outcome: 'done', usage: { costUsd: 0.25 } })
    const persisted = await loadRunState(fixture.deps.config.workDir, fixture.state.runId)
    expect(persisted.children?.['auth-db']).toEqual({ status: 'done' })
  })

  it('a crash after a failed child_done append emits no second failed settlement on resume', async () => {
    const fixture = await makeFixture()
    await seedParent(fixture, ['auth-db'], { 'auth-db': 'running' })
    const childState = await seedChildRun(fixture, 'auth-db', 'failed')
    const log = path.join(fixture.state.runDir, 'events.ndjson')
    appendEvent(log, { altitude: 'L2', type: 'child_spawned', child: 'auth-db', runId: childState.runId })
    appendEvent(log, {
      altitude: 'L2',
      type: 'child_done',
      child: 'auth-db',
      outcome: 'failed',
      usage: CHILD_DONE_USAGE,
    })
    const tracker = makeRunner(fixture, {})

    const result = await runChildren(fixture.deps, fixture.state, fixture.ctx, { runChildRun: tracker.runChildRun })

    expect(result).toEqual({ halted: 'stopped', child: 'auth-db', childStatus: 'failed' })
    expect(tracker.spawned).toEqual([])
    expect(childDoneOf(fixture, 'auth-db')).toHaveLength(1)
    const persisted = await loadRunState(fixture.deps.config.workDir, fixture.state.runId)
    expect(persisted.children?.['auth-db']).toEqual({ status: 'failed' })
  })
})
