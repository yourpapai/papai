// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { appendEvent, readEvents } from '../../sdd-runner/src/events.js'
import type { EventInput, SddEvent } from '../../sdd-runner/src/events.js'
import type { OrchestratorDeps } from '../../sdd-runner/src/gate-digest.js'
import { createOpenSpecDriver } from '../../sdd-runner/src/openspec-driver.js'
import {
  isInterruptedPlanBranchResume,
  isPlanParentResume,
  resumePlanParent,
} from '../../sdd-runner/src/plan-resume.js'
import type { StartChildRun } from '../../sdd-runner/src/plan-resume.js'
import { planDigest } from '../../sdd-runner/src/plan.js'
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

const DIGEST = 'd'.repeat(16)
const REPLAN_DIGEST = 'e'.repeat(16)

/**
 * Durable plan-gate record shapes: `answered` is an approved plan parent
 * (the only shape whose resume may drive children); the rest are crash
 * windows between the `state.plan` persist and the `state.gate` persist.
 * The `*-noise`/`*-trailing`/`wrong-digest` shapes pin the fail-closed scan:
 * only a digest-matching plan event opens a gate window, only plan-mode
 * gate events inside it count, and only a new plan event resets the window.
 */
type GateLog =
  | 'answered'
  | 'plan-only'
  | 'presented-unanswered'
  | 'replanned-unanswered'
  | 'answered-trailing-event'
  | 'wrong-digest-plan-answered'
  | 'final-gate-noise'
  | 'presented-v2-unanswered'

async function makeFixture(
  gateLog: GateLog = 'answered',
): Promise<{ repoRoot: string; deps: OrchestratorDeps; state: RunState }> {
  const repoRoot = makeDir()
  const workDir = path.join(repoRoot, '.sdd-runner')
  const state = await createRunState({ workDir, repoRoot, changeName: 'composite' })
  appendEvent(path.join(state.runDir, 'events.ndjson'), { altitude: 'L2', type: 'stage_enter', stage: 'intake' })
  state.plan = {
    childIds: CHILDREN.map((child) => child.id),
    digest: gateLog === 'replanned-unanswered' ? REPLAN_DIGEST : DIGEST,
  }
  state.children = Object.fromEntries(CHILDREN.map((child) => [child.id, { status: 'pending' }]))
  fs.mkdirSync(path.join(state.runDir, 'sidecars'), { recursive: true })
  fs.writeFileSync(path.join(state.runDir, 'sidecars', 'plan.json'), JSON.stringify({ children: CHILDREN }))
  const logPath = path.join(state.runDir, 'events.ndjson')
  appendEvent(logPath, {
    altitude: 'L2',
    type: 'plan',
    childCount: CHILDREN.length,
    digest: gateLog === 'wrong-digest-plan-answered' ? REPLAN_DIGEST : DIGEST,
  })
  if (gateLog !== 'plan-only') {
    appendEvent(logPath, {
      altitude: 'L2',
      type: 'gate',
      action: 'presented',
      mode: 'plan',
      version: gateLog === 'presented-v2-unanswered' ? 2 : 1,
    })
  }
  const answeredLog =
    gateLog === 'answered' ||
    gateLog === 'replanned-unanswered' ||
    gateLog === 'answered-trailing-event' ||
    gateLog === 'wrong-digest-plan-answered' ||
    gateLog === 'final-gate-noise'
  if (answeredLog) {
    appendEvent(logPath, {
      altitude: 'L2',
      type: 'gate',
      action: 'answered',
      mode: gateLog === 'final-gate-noise' ? 'final' : 'plan',
      version: 1,
    })
  }
  if (gateLog === 'answered-trailing-event') {
    appendEvent(logPath, { altitude: 'L2', type: 'stage_exit', stage: 'intake' })
  }
  if (gateLog === 'replanned-unanswered') {
    appendEvent(logPath, { altitude: 'L2', type: 'plan', childCount: CHILDREN.length, digest: REPLAN_DIGEST })
  }
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

/**
 * The earlier crash windows: the planner promoted `sidecars/plan.json` but the
 * crash landed anywhere before `runPlanBranch`'s first `saveRunState` — so
 * `state.plan` was never persisted. Two entries reach that window: the
 * intake-oversize plan (default — the `depth oversize` verdict is durable) and
 * the decompose-split diversion (`diverted` — a `needs_split` verdict promoted
 * the sidecar past the persisted `stage: 'decompose'`, and the depth event
 * never carries `oversize` because intake classified the run a single).
 */
async function makeCrashedFixture(
  options: {
    readonly oversize?: boolean
    readonly withSidecar?: boolean
    readonly withPlanEvent?: boolean
    readonly diverted?: boolean
  } = {},
): Promise<{ repoRoot: string; deps: OrchestratorDeps; state: RunState }> {
  const { oversize = true, withSidecar = true, withPlanEvent = true, diverted = false } = options
  const repoRoot = makeDir()
  const workDir = path.join(repoRoot, '.sdd-runner')
  const state = await createRunState({ workDir, repoRoot, changeName: 'composite' })
  if (diverted) state.stage = 'decompose'
  if (withSidecar) {
    fs.mkdirSync(path.join(state.runDir, 'sidecars'), { recursive: true })
    fs.writeFileSync(path.join(state.runDir, 'sidecars', 'plan.json'), JSON.stringify({ children: CHILDREN }))
  }
  const logPath = path.join(state.runDir, 'events.ndjson')
  appendEvent(logPath, {
    altitude: 'L2',
    type: 'depth',
    profile: 'L',
    rationale: 'declares multi-change scope',
    source: 'estimator',
    ...(oversize && !diverted ? { oversize: true } : {}),
  })
  if (diverted) {
    appendEvent(logPath, { altitude: 'L2', type: 'stage_enter', stage: 'decompose' })
    appendEvent(logPath, { altitude: 'L2', type: 'stage_exit', stage: 'decompose' })
  }
  if (withPlanEvent) {
    appendEvent(logPath, { altitude: 'L2', type: 'plan', childCount: CHILDREN.length, digest: planDigest(CHILDREN) })
  }
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

describe('isInterruptedPlanBranchResume (crash before the state.plan persist)', () => {
  it('accepts the crashed plan-branch shape and rejects every lookalike', async () => {
    const crashed = await makeCrashedFixture()
    expect(isInterruptedPlanBranchResume(crashed.state)).toBe(true)
    crashed.state.status = 'stopped'
    expect(isInterruptedPlanBranchResume(crashed.state)).toBe(true)
    crashed.state.status = 'completed'
    expect(isInterruptedPlanBranchResume(crashed.state)).toBe(false)
    const notOversize = await makeCrashedFixture({ oversize: false })
    expect(isInterruptedPlanBranchResume(notOversize.state)).toBe(false)
    const withoutSidecar = await makeCrashedFixture({ withSidecar: false })
    expect(isInterruptedPlanBranchResume(withoutSidecar.state)).toBe(false)
    const noPlanEvent = await makeCrashedFixture({ withPlanEvent: false })
    expect(isInterruptedPlanBranchResume(noPlanEvent.state)).toBe(true)
    const settled = await makeFixture()
    expect(isInterruptedPlanBranchResume(settled.state)).toBe(false)
  })

  it('accepts the interrupted decompose-split diversion shape (D5) — stage decompose, no oversize verdict', async () => {
    const diverted = await makeCrashedFixture({ diverted: true })
    expect(isInterruptedPlanBranchResume(diverted.state)).toBe(true)
    diverted.state.status = 'stopped'
    expect(isInterruptedPlanBranchResume(diverted.state)).toBe(true)
    diverted.state.status = 'completed'
    expect(isInterruptedPlanBranchResume(diverted.state)).toBe(false)
    const withoutSidecar = await makeCrashedFixture({ diverted: true, withSidecar: false })
    expect(isInterruptedPlanBranchResume(withoutSidecar.state)).toBe(false)
    const withoutPlanEvent = await makeCrashedFixture({ diverted: true, withPlanEvent: false })
    expect(isInterruptedPlanBranchResume(withoutPlanEvent.state)).toBe(true)
  })
})

describe('resumePlanParent interrupted plan-branch recovery', () => {
  it('finishes the interrupted settle from the sidecar and presents the plan gate (recovered, not stranded)', async () => {
    const fixture = await makeCrashedFixture()
    const spawned: string[] = []
    const startChildRun: StartChildRun = () => {
      spawned.push('ran')
      return Promise.resolve({ runId: 'must-not-run' })
    }

    const result = await resumePlanParent(
      fixture.deps,
      fixture.state,
      (event) => {
        appendEvent(path.join(fixture.state.runDir, 'events.ndjson'), event)
      },
      { level: 'assist', costCeilingUsd: 5, metered: true },
      startChildRun,
    )

    expect(spawned).toEqual([])
    expect(result).toEqual({ runId: fixture.state.runId, halted: 'gate-pending' })
    const persisted = await loadRunState(fixture.deps.config.workDir, fixture.state.runId)
    expect(persisted.plan).toEqual({ childIds: CHILDREN.map((child) => child.id), digest: planDigest(CHILDREN) })
    expect(persisted.children).toEqual({ 'db-schema': { status: 'pending' }, 'db-api': { status: 'pending' } })
    expect(persisted.gate).toEqual({ mode: 'plan', version: 1 })
    const md = fs.readFileSync(path.join(fixture.state.runDir, 'gate-1.md'), 'utf8')
    expect(md).toContain('- [ ] C1 db-schema — Rename the schema columns.')
    expect(md).toContain('- [ ] C2 db-api — Rename the API route helpers. · deps: db-schema')
    expect(fs.existsSync(path.join(fixture.state.runDir, 'children', '1-db-schema.md'))).toBe(true)
  })
})

describe('resumePlanParent decompose-split diversion recovery (D5 crash window)', () => {
  it('finishes the interrupted settle from the promoted sidecar — no decompose re-run, no child spawn, pin preserved', async () => {
    const fixture = await makeCrashedFixture({ diverted: true })
    const pinned = [{ ...CHILDREN[0]!, changeName: 'composite' }, ...CHILDREN.slice(1)]
    fs.writeFileSync(path.join(fixture.state.runDir, 'sidecars', 'plan.json'), JSON.stringify({ children: pinned }))
    const spawned: string[] = []
    const startChildRun: StartChildRun = () => {
      spawned.push('ran')
      return Promise.resolve({ runId: 'must-not-run' })
    }

    const result = await resumePlanParent(
      fixture.deps,
      fixture.state,
      (event) => {
        appendEvent(path.join(fixture.state.runDir, 'events.ndjson'), event)
      },
      { level: 'assist', costCeilingUsd: 5, metered: true },
      startChildRun,
    )

    expect(spawned).toEqual([])
    expect(result).toEqual({ runId: fixture.state.runId, halted: 'gate-pending' })
    const persisted = await loadRunState(fixture.deps.config.workDir, fixture.state.runId)
    expect(persisted.plan).toEqual({ childIds: CHILDREN.map((child) => child.id), digest: planDigest(CHILDREN) })
    expect(persisted.children).toEqual({ 'db-schema': { status: 'pending' }, 'db-api': { status: 'pending' } })
    expect(persisted.gate).toEqual({ mode: 'plan', version: 1 })
    const md = fs.readFileSync(path.join(fixture.state.runDir, 'gate-1.md'), 'utf8')
    expect(md).toContain('- [ ] C1 db-schema — Rename the schema columns.')
    expect(md).toContain('- [ ] C2 db-api — Rename the API route helpers. · deps: db-schema')
    expect(fs.existsSync(path.join(fixture.state.runDir, 'children', '1-db-schema.md'))).toBe(true)
    expect(fs.readFileSync(path.join(fixture.state.runDir, 'sidecars', 'plan.json'), 'utf8')).toBe(
      JSON.stringify({ children: pinned }),
    )
  })

  it('presents the plan gate at the next free version instead of overwriting an earlier gate file', async () => {
    const fixture = await makeCrashedFixture({ diverted: true })
    const gateOne = path.join(fixture.state.runDir, 'gate-1.md')
    fs.writeFileSync(gateOne, 'early gate record\n')

    const result = await resumePlanParent(
      fixture.deps,
      fixture.state,
      (event) => {
        appendEvent(path.join(fixture.state.runDir, 'events.ndjson'), event)
      },
      { level: 'assist', costCeilingUsd: 5, metered: true },
      () => Promise.resolve({ runId: 'must-not-run' }),
    )

    expect(result.halted).toBe('gate-pending')
    const persisted = await loadRunState(fixture.deps.config.workDir, fixture.state.runId)
    expect(persisted.gate).toEqual({ mode: 'plan', version: 2 })
    expect(fs.readFileSync(gateOne, 'utf8')).toBe('early gate record\n')
    expect(fs.existsSync(path.join(fixture.state.runDir, 'gate-2.md'))).toBe(true)
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
      { level: 'assist', costCeilingUsd: 5, metered: true },
      startChildRun,
    )

    expect(result.halted).toBe('stopped')
    expect(startedFiles).toEqual([path.join(fixture.state.runDir, 'children', '1-db-schema.md')])
    const persisted = await loadRunState(fixture.deps.config.workDir, fixture.state.runId)
    expect(persisted.status).toBe('stopped')
    expect(fs.existsSync(path.join(fixture.repoRoot, 'openspec', 'changes', 'composite'))).toBe(false)
  })

  it('forwards the full PlanChild — changeName included — to the orchestrator-supplied starter (D6)', async () => {
    const fixture = await makeFixture()
    fs.writeFileSync(
      path.join(fixture.state.runDir, 'sidecars', 'plan.json'),
      JSON.stringify({
        children: [
          { id: 'db-schema', instruction: 'Rename the schema columns.', deps: [], changeName: 'add-thing' },
          { id: 'db-api', instruction: 'Rename the API route helpers.', deps: ['db-schema'] },
        ],
      }),
    )
    const seen: unknown[] = []
    const startChildRun: StartChildRun = async (_deps, options) => {
      seen.push(options.child)
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
      { level: 'assist', costCeilingUsd: 5, metered: true },
      startChildRun,
    )

    expect(result.halted).toBe('stopped')
    expect(seen[0]).toMatchObject({ id: 'db-schema', changeName: 'add-thing' })
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
      { level: 'assist', costCeilingUsd: 5, metered: true },
      startChildRun,
    )

    expect(result.halted).toBe('stopped')
    expect(baselines).toEqual([1.25])
  })

  it('surfaces a gate-pending child, records it running, and threads its runId for routing (D2)', async () => {
    const fixture = await makeFixture()
    let spawnedRunId = ''
    const startChildRun: StartChildRun = async (_deps, _options) => {
      const child = await createRunState({
        workDir: fixture.deps.config.workDir,
        repoRoot: fixture.repoRoot,
        changeName: 'db-schema',
      })
      spawnedRunId = child.runId
      child.gate = { mode: 'final', version: 1 }
      await saveRunState(child, new Date('2026-08-12T08:00:00.000Z'))
      return { runId: child.runId }
    }

    const result = await resumePlanParent(
      fixture.deps,
      fixture.state,
      () => undefined,
      { level: 'assist', costCeilingUsd: 5, metered: true },
      startChildRun,
    )

    expect(result.halted).toBe('gate-pending')
    expect(result.childRunId).toBe(spawnedRunId)
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
      { level: 'assist', costCeilingUsd: 5, metered: true },
      startChildRun,
    )

    expect(result.halted).toBe('stopped')
    expect(markerArrived).toBe(true)
  })
})

describe('resumePlanParent plan-gate guard (D5 fail-closed resume)', () => {
  function appendingEmit(state: RunState): (event: EventInput) => void {
    return (event) => {
      appendEvent(path.join(state.runDir, 'events.ndjson'), event)
    }
  }

  function makeNeverRunner(): { readonly startChildRun: StartChildRun; readonly spawned: () => string[] } {
    const spawned: string[] = []
    const startChildRun: StartChildRun = () => {
      spawned.push('ran')
      return Promise.resolve({ runId: 'must-not-run' })
    }
    return { startChildRun, spawned: () => spawned }
  }

  function presentedGateEvents(state: RunState): readonly { readonly mode: string; readonly version: number }[] {
    return readEvents(path.join(state.runDir, 'events.ndjson'))
      .filter((event): event is Extract<SddEvent, { type: 'gate' }> => event.type === 'gate')
      .filter((event) => event.action === 'presented')
  }

  it('presents the plan gate instead of driving children when the crash landed before the gate presentation', async () => {
    const fixture = await makeFixture('plan-only')
    const { startChildRun, spawned } = makeNeverRunner()

    const result = await resumePlanParent(
      fixture.deps,
      fixture.state,
      appendingEmit(fixture.state),
      { level: 'assist', costCeilingUsd: 5, metered: true },
      startChildRun,
    )

    expect(spawned()).toEqual([])
    expect(result).toEqual({ runId: fixture.state.runId, halted: 'gate-pending' })
    const persisted = await loadRunState(fixture.deps.config.workDir, fixture.state.runId)
    expect(persisted.gate).toEqual({ mode: 'plan', version: 1 })
    const md = fs.readFileSync(path.join(fixture.state.runDir, 'gate-1.md'), 'utf8')
    expect(md).toContain('- [ ] C1 db-schema — Rename the schema columns.')
    expect(md).toContain('- [ ] C2 db-api — Rename the API route helpers. · deps: db-schema')
    const presented = presentedGateEvents(fixture.state)
    expect(presented).toHaveLength(1)
    expect(presented[0]).toMatchObject({ mode: 'plan', version: 1 })
  })

  it('re-presents the unanswered gate when the crash landed after the presented event but before the state.gate persist', async () => {
    const fixture = await makeFixture('presented-unanswered')
    const { startChildRun, spawned } = makeNeverRunner()

    const result = await resumePlanParent(
      fixture.deps,
      fixture.state,
      appendingEmit(fixture.state),
      { level: 'assist', costCeilingUsd: 5, metered: true },
      startChildRun,
    )

    expect(spawned()).toEqual([])
    expect(result).toEqual({ runId: fixture.state.runId, halted: 'gate-pending' })
    const persisted = await loadRunState(fixture.deps.config.workDir, fixture.state.runId)
    expect(persisted.gate).toEqual({ mode: 'plan', version: 1 })
    const presented = presentedGateEvents(fixture.state)
    expect(presented).toHaveLength(2)
    expect(presented[1]).toMatchObject({ mode: 'plan', version: 1 })
  })

  it('presents again when the log answers an older plan but the current digest was never answered', async () => {
    const fixture = await makeFixture('replanned-unanswered')
    const { startChildRun, spawned } = makeNeverRunner()

    const result = await resumePlanParent(
      fixture.deps,
      fixture.state,
      appendingEmit(fixture.state),
      { level: 'assist', costCeilingUsd: 5, metered: true },
      startChildRun,
    )

    expect(spawned()).toEqual([])
    expect(result).toEqual({ runId: fixture.state.runId, halted: 'gate-pending' })
    const persisted = await loadRunState(fixture.deps.config.workDir, fixture.state.runId)
    expect(persisted.gate).toEqual({ mode: 'plan', version: 1 })
  })

  it('drives children once the log records the answered plan gate for the current digest', async () => {
    const fixture = await makeFixture('answered')
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
      appendingEmit(fixture.state),
      { level: 'assist', costCeilingUsd: 5, metered: true },
      startChildRun,
    )

    expect(result.halted).toBe('stopped')
    expect(startedFiles).toEqual([path.join(fixture.state.runDir, 'children', '1-db-schema.md')])
  })

  it('still drives children when quiet events follow the answered plan gate — only a plan event resets the window', async () => {
    const fixture = await makeFixture('answered-trailing-event')
    const startedFiles: string[] = []
    const startChildRun: StartChildRun = async () => {
      startedFiles.push('started')
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
      appendingEmit(fixture.state),
      { level: 'assist', costCeilingUsd: 5, metered: true },
      startChildRun,
    )

    expect(result.halted).toBe('stopped')
    expect(startedFiles).toEqual(['started'])
  })

  it('ignores an answered plan gate logged against a different digest — fail closed, re-present', async () => {
    const fixture = await makeFixture('wrong-digest-plan-answered')
    const { startChildRun, spawned } = makeNeverRunner()

    const result = await resumePlanParent(
      fixture.deps,
      fixture.state,
      appendingEmit(fixture.state),
      { level: 'assist', costCeilingUsd: 5, metered: true },
      startChildRun,
    )

    expect(spawned()).toEqual([])
    expect(result).toEqual({ runId: fixture.state.runId, halted: 'gate-pending' })
    const persisted = await loadRunState(fixture.deps.config.workDir, fixture.state.runId)
    expect(persisted.gate).toEqual({ mode: 'plan', version: 1 })
  })

  it('ignores final-mode gate answers after the plan event — only plan-mode events settle the plan gate', async () => {
    const fixture = await makeFixture('final-gate-noise')
    const { startChildRun, spawned } = makeNeverRunner()

    const result = await resumePlanParent(
      fixture.deps,
      fixture.state,
      appendingEmit(fixture.state),
      { level: 'assist', costCeilingUsd: 5, metered: true },
      startChildRun,
    )

    expect(spawned()).toEqual([])
    expect(result).toEqual({ runId: fixture.state.runId, halted: 'gate-pending' })
    const persisted = await loadRunState(fixture.deps.config.workDir, fixture.state.runId)
    expect(persisted.gate).toEqual({ mode: 'plan', version: 1 })
  })

  it('re-presents an unanswered presentation at its recorded version — overwrites gate-2.md, never forks back to gate-1', async () => {
    const fixture = await makeFixture('presented-v2-unanswered')
    const { startChildRun, spawned } = makeNeverRunner()

    const result = await resumePlanParent(
      fixture.deps,
      fixture.state,
      appendingEmit(fixture.state),
      { level: 'assist', costCeilingUsd: 5, metered: true },
      startChildRun,
    )

    expect(spawned()).toEqual([])
    expect(result).toEqual({ runId: fixture.state.runId, halted: 'gate-pending' })
    const persisted = await loadRunState(fixture.deps.config.workDir, fixture.state.runId)
    expect(persisted.gate).toEqual({ mode: 'plan', version: 2 })
    expect(fs.existsSync(path.join(fixture.state.runDir, 'gate-2.md'))).toBe(true)
    expect(fs.existsSync(path.join(fixture.state.runDir, 'gate-1.md'))).toBe(false)
    const presented = presentedGateEvents(fixture.state)
    expect(presented).toHaveLength(2)
    expect(presented[1]).toMatchObject({ mode: 'plan', version: 2 })
  })
})
