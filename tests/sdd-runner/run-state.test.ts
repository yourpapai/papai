// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { appendEvent } from '../../sdd-runner/src/events.js'
import type { DepthProfile } from '../../sdd-runner/src/events.js'
import type { ReplayState } from '../../sdd-runner/src/replay.js'
import { ROUND_CAPS } from '../../sdd-runner/src/review-model.js'
import { listPendingGates } from '../../sdd-runner/src/run-index.js'
import {
  createRunState,
  deriveResumePoint,
  loadRunState,
  PersistedRunStateSchema,
  resolveRoundCap,
  saveRunState,
} from '../../sdd-runner/src/run-state.js'
import type { PersistedRunState } from '../../sdd-runner/src/run-state.js'

const tmpDirs: string[] = []

function makeWorkDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-runstate-'))
  tmpDirs.push(dir)
  return dir
}

async function errorOf(promise: Promise<unknown>): Promise<Error> {
  const failure = await promise.catch((error: unknown) => error)
  if (!(failure instanceof Error)) throw new Error('expected the promise to reject with an Error')
  return failure
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

const emptyReplay: ReplayState = {
  stages: {
    intake: 'pending',
    draft: 'pending',
    review: 'pending',
    decompose: 'pending',
    atomicity: 'pending',
    gate: 'pending',
  },
  depth: null,
  round: null,
  perRound: [],
  lastVerdict: null,
  gate: null,
  autoDecisions: [],
}

type ArtifactStates = Record<'proposal' | 'specs' | 'design' | 'assumptions' | 'review' | 'tasks', string>

function artifacts(overrides: Partial<ArtifactStates> = {}): ArtifactStates {
  return {
    proposal: 'ready',
    specs: 'blocked',
    design: 'blocked',
    assumptions: 'blocked',
    review: 'blocked',
    tasks: 'blocked',
    ...overrides,
  }
}

describe('createRunState + loadRunState', () => {
  it('creates a run dir with a schema-valid state.json and reloads it', async () => {
    const workDir = makeWorkDir()
    const state = await createRunState({ workDir, repoRoot: '/repo', changeName: 'add-thing' })
    expect(state.runId).toMatch(/^\d{4}-\d{2}-\d{2}T/u)
    expect(state.stage).toBe('intake')
    expect(state.depth).toBeNull()
    expect(state.round).toBe(0)
    expect(state.roundCap).toBe(ROUND_CAPS.S)
    expect(state.gate).toBeNull()
    expect(state.status).toBe('running')
    expect(fs.existsSync(path.join(state.runDir, 'state.json'))).toBe(true)

    const loaded = await loadRunState(workDir, state.runId)
    expect(loaded).toEqual(state)
  })

  it('builds the run id from the ISO timestamp with colons and dots dashed plus an 8-char uuid prefix', async () => {
    const workDir = makeWorkDir()
    const state = await createRunState(
      { workDir, repoRoot: '/repo', changeName: 'add-thing' },
      new Date('2026-03-04T05:06:07.891Z'),
    )
    expect(state.runId).toMatch(/^2026-03-04T05-06-07-891Z-[0-9a-f]{8}$/u)
  })

  it('rejects a corrupt state.json naming the run and preserving the cause', async () => {
    const workDir = makeWorkDir()
    const state = await createRunState({ workDir, repoRoot: '/repo', changeName: 'add-thing' })
    fs.writeFileSync(path.join(state.runDir, 'state.json'), '{"runId": 42}')
    const failure = await errorOf(loadRunState(workDir, state.runId))
    expect(failure.message).toMatch(/state\.json/u)
    expect(failure.message).toContain(state.runId)
    expect(failure.cause).toBeDefined()
  })
})

describe('saveRunState', () => {
  it('persists transitions: depth classification, round advance, gate-pending with mode', async () => {
    const workDir = makeWorkDir()
    const created = await createRunState({ workDir, repoRoot: '/repo', changeName: 'add-thing' })
    await saveRunState({ ...created, depth: 'M', round: 2 })
    const mid = await loadRunState(workDir, created.runId)
    expect(mid.depth).toBe('M')
    expect(mid.round).toBe(2)
    await saveRunState({ ...mid, stage: 'gate', gate: { mode: 'early', version: 1 } })
    const gated = await loadRunState(workDir, created.runId)
    expect(gated.gate).toEqual({ mode: 'early', version: 1 })
  })
})

describe('roundCap', () => {
  it('loadRunState populates roundCap from ROUND_CAPS[depth] when the field is missing', async () => {
    const workDir = makeWorkDir()
    const created = await createRunState({ workDir, repoRoot: '/repo', changeName: 'add-thing' })
    await saveRunState({ ...created, depth: 'M', round: 3, roundCap: undefined })
    const loaded = await loadRunState(workDir, created.runId)
    expect(loaded.roundCap).toBe(ROUND_CAPS.M)
  })

  it('preserves an explicit roundCap when present through a round-trip', async () => {
    const workDir = makeWorkDir()
    const created = await createRunState({ workDir, repoRoot: '/repo', changeName: 'add-thing' })
    await saveRunState({ ...created, depth: 'M', round: 3, roundCap: 4 })
    const loaded = await loadRunState(workDir, created.runId)
    expect(loaded.roundCap).toBe(4)
    await saveRunState({ ...loaded, round: 4 })
    const reloaded = await loadRunState(workDir, created.runId)
    expect(reloaded.roundCap).toBe(4)
  })

  it('resolveRoundCap returns the explicit cap when set, else ROUND_CAPS[depth]', () => {
    expect(resolveRoundCap({ depth: 'M', roundCap: 5 })).toBe(5)
    expect(resolveRoundCap({ depth: 'M', roundCap: undefined })).toBe(ROUND_CAPS.M)
    expect(resolveRoundCap({ depth: 'S', roundCap: undefined })).toBe(ROUND_CAPS.S)
    expect(resolveRoundCap({ depth: null, roundCap: undefined })).toBe(ROUND_CAPS.S)
  })

  it('loadRunState rejects a non-positive roundCap in the persisted state', async () => {
    const workDir = makeWorkDir()
    const created = await createRunState({ workDir, repoRoot: '/repo', changeName: 'add-thing' })
    const valid = fs.readFileSync(created.statePath, 'utf8')
    fs.writeFileSync(created.statePath, valid.replace(/"roundCap":\s*\d+/u, '"roundCap":0'))
    await expect(loadRunState(workDir, created.runId)).rejects.toThrow(/state\.json/u)
  })
})

function createSeeded(workDir: string): PersistedRunState {
  return {
    runId: 'seeded-run',
    repoRoot: '/repo',
    workDir,
    changeName: 'add-thing',
    stage: 'review' as const,
    depth: null as DepthProfile | null,
    round: 0,
    gate: null,
    status: 'running' as const,
    autoExtendsUsed: 0,
    gateDeadlineAt: null,
    gateDeadlineReArmed: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('deriveResumePoint', () => {
  it('resumes at the gate when gate-pending, preserving mode and round', async () => {
    const workDir = makeWorkDir()
    const created = await createRunState({ workDir, repoRoot: '/repo', changeName: 'add-thing' })
    const gated = {
      ...created,
      stage: 'gate' as const,
      depth: 'M' as const,
      round: 3,
      gate: { mode: 'final' as const, version: 2 },
    }
    const point = deriveResumePoint(
      gated,
      artifacts({ proposal: 'done', specs: 'done', design: 'done', review: 'done', tasks: 'done' }),
      emptyReplay,
    )
    expect(point).toMatchObject({ stage: 'gate', round: 3 })
  })

  it('resumes at intake when depth is not yet classified', async () => {
    const workDir = makeWorkDir()
    const created = await createRunState({ workDir, repoRoot: '/repo', changeName: 'add-thing' })
    expect(deriveResumePoint(created, artifacts(), emptyReplay).stage).toBe('intake')
  })

  it('resumes at draft when draft artifacts are incomplete for the depth profile', async () => {
    const workDir = makeWorkDir()
    const created = await createRunState({ workDir, repoRoot: '/repo', changeName: 'add-thing' })
    const mRun = { ...created, depth: 'M' as const, stage: 'draft' as const }
    expect(deriveResumePoint(mRun, artifacts({ proposal: 'done', specs: 'done' }), emptyReplay).stage).toBe('draft')
    const sRun = { ...created, depth: 'S' as const, stage: 'draft' as const }
    const point = deriveResumePoint(sRun, artifacts({ proposal: 'done', specs: 'done', review: 'ready' }), {
      ...emptyReplay,
      lastVerdict: null,
    })
    expect(point.stage).not.toBe('draft')
  })

  it('resumes mid-review at the recorded round when killed mid-round', async () => {
    const workDir = makeWorkDir()
    const created = await createRunState({ workDir, repoRoot: '/repo', changeName: 'add-thing' })
    const midRound = { ...created, depth: 'M' as const, stage: 'review' as const, round: 2 }
    const replay: ReplayState = {
      ...emptyReplay,
      round: { current: 2, cap: 3 },
      lastVerdict: {
        round: 1,
        verdict: 'open',
        counts: { blocker: 1, material: 0, nitpick: 0 },
        resolved: 0,
        dismissed: 0,
      },
    }
    const point = deriveResumePoint(
      midRound,
      artifacts({ proposal: 'done', specs: 'done', design: 'done', review: 'ready' }),
      replay,
    )
    expect(point).toMatchObject({ stage: 'review', round: 2 })
  })

  it('skips the review loop only when a converged verdict is recorded', async () => {
    const workDir = makeWorkDir()
    const created = await createRunState({ workDir, repoRoot: '/repo', changeName: 'add-thing' })
    const afterReview = { ...created, depth: 'M' as const, stage: 'decompose' as const, round: 2 }
    const converged: ReplayState = {
      ...emptyReplay,
      lastVerdict: {
        round: 2,
        verdict: 'converged',
        counts: { blocker: 0, material: 0, nitpick: 1 },
        resolved: 0,
        dismissed: 0,
      },
    }
    const done = artifacts({ proposal: 'done', specs: 'done', design: 'done', review: 'done' })
    expect(deriveResumePoint(afterReview, done, converged).stage).toBe('decompose')
    const notConverged: ReplayState = {
      ...emptyReplay,
      lastVerdict: {
        round: 1,
        verdict: 'open',
        counts: { blocker: 1, material: 0, nitpick: 0 },
        resolved: 0,
        dismissed: 0,
      },
    }
    expect(deriveResumePoint(afterReview, done, notConverged).stage).toBe('review')
  })

  it('resumes at atomicity when tasks exist but atomicity was not exited (M profile)', async () => {
    const workDir = makeWorkDir()
    const created = await createRunState({ workDir, repoRoot: '/repo', changeName: 'add-thing' })
    const state = { ...created, depth: 'M' as const, stage: 'atomicity' as const, round: 1 }
    const converged: ReplayState = {
      ...emptyReplay,
      lastVerdict: {
        round: 1,
        verdict: 'converged',
        counts: { blocker: 0, material: 0, nitpick: 0 },
        resolved: 0,
        dismissed: 0,
      },
    }
    const arts = artifacts({ proposal: 'done', specs: 'done', design: 'done', review: 'done', tasks: 'done' })
    expect(deriveResumePoint(state, arts, converged).stage).toBe('atomicity')
    const exitedReplay: ReplayState = { ...converged, stages: { ...converged.stages, atomicity: 'done' } }
    expect(deriveResumePoint(state, arts, exitedReplay).stage).toBe('gate')
  })

  it('skips atomicity for the S profile', async () => {
    const workDir = makeWorkDir()
    const created = await createRunState({ workDir, repoRoot: '/repo', changeName: 'add-thing' })
    const state = { ...created, depth: 'S' as const, stage: 'atomicity' as const, round: 1 }
    const converged: ReplayState = {
      ...emptyReplay,
      lastVerdict: {
        round: 1,
        verdict: 'converged',
        counts: { blocker: 0, material: 0, nitpick: 0 },
        resolved: 0,
        dismissed: 0,
      },
    }
    const arts = artifacts({ proposal: 'done', specs: 'done', review: 'done', tasks: 'done' })
    expect(deriveResumePoint(state, arts, converged).stage).toBe('gate')
  })

  it('resumes at decompose when a settled review left tasks.md missing with no final gate presented (task 3.1)', () => {
    const workDir = makeWorkDir()
    const settled: ReplayState = {
      ...emptyReplay,
      lastVerdict: {
        round: 3,
        verdict: 'open',
        counts: { blocker: 0, material: 1, nitpick: 0 },
        resolved: 2,
        dismissed: 1,
      },
      gate: { mode: 'early', version: 1, answered: true },
    }
    const state = {
      ...createSeeded(workDir),
      depth: 'M' as const,
      stage: 'review' as const,
      round: 3,
      gate: null,
    }
    const arts = artifacts({ proposal: 'done', specs: 'done', design: 'done', review: 'done', tasks: 'blocked' })
    expect(deriveResumePoint(state, arts, settled)).toMatchObject({ stage: 'decompose', round: 3 })
  })

  it('resumes at atomicity when tasks.md exists at depth != S but the atomicity report is absent (task 3.1)', () => {
    const workDir = makeWorkDir()
    const settled: ReplayState = {
      ...emptyReplay,
      lastVerdict: {
        round: 2,
        verdict: 'converged',
        counts: { blocker: 0, material: 0, nitpick: 1 },
        resolved: 1,
        dismissed: 0,
      },
    }
    const state = {
      ...createSeeded(workDir),
      depth: 'M' as const,
      stage: 'decompose' as const,
      round: 2,
      gate: null,
    }
    const arts = artifacts({ proposal: 'done', specs: 'done', design: 'done', review: 'done', tasks: 'done' })
    expect(deriveResumePoint(state, arts, settled)).toMatchObject({ stage: 'atomicity', round: 2 })
  })

  it('keeps gate-pending for a run whose final gate was presented (pin, task 3.1)', () => {
    const workDir = makeWorkDir()
    const presented: ReplayState = {
      ...emptyReplay,
      lastVerdict: {
        round: 2,
        verdict: 'converged',
        counts: { blocker: 0, material: 0, nitpick: 0 },
        resolved: 0,
        dismissed: 0,
      },
      gate: { mode: 'final', version: 1, answered: false },
    }
    const state = {
      ...createSeeded(workDir),
      depth: 'M' as const,
      stage: 'gate' as const,
      round: 2,
      gate: { mode: 'final' as const, version: 1 },
    }
    const arts = artifacts({ proposal: 'done', specs: 'done', design: 'done', review: 'done', tasks: 'done' })
    expect(deriveResumePoint(state, arts, presented)).toMatchObject({ stage: 'gate', round: 2 })
  })
})

describe('event replay integration', () => {
  it('rebuilds renderer state from the run dir events log after a simulated kill', async () => {
    const workDir = makeWorkDir()
    const state = await createRunState({ workDir, repoRoot: '/repo', changeName: 'add-thing' })
    const log = path.join(state.runDir, 'events.ndjson')
    appendEvent(log, { altitude: 'L2', type: 'stage_enter', stage: 'intake' })
    appendEvent(log, { altitude: 'L2', type: 'depth', profile: 'S', rationale: 'typo', source: 'override' })
    appendEvent(log, { altitude: 'L2', type: 'stage_exit', stage: 'intake' })
    appendEvent(log, { altitude: 'L2', type: 'stage_enter', stage: 'draft' })
    const { replayEvents } = await import('../../sdd-runner/src/replay.js')
    const replay = replayEvents(log)
    expect(replay.stages.intake).toBe('done')
    expect(replay.stages.draft).toBe('active')
    expect(replay.depth).toBe('S')
  })
})

describe('reviewSettled via deriveResumePoint', () => {
  const settledBase = (): PersistedRunState => {
    const base: PersistedRunState = {
      runId: 'run-1',
      repoRoot: '/repo',
      workDir: '/w',
      changeName: 'add-thing',
      stage: 'review',
      depth: 'M',
      round: 1,
      roundCap: 3,
      autoExtendsUsed: 0,
      gate: null,
      gateDeadlineAt: null,
      gateDeadlineReArmed: false,
      status: 'running',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    return base
  }
  const doneArtifacts = artifacts({ proposal: 'done', specs: 'done', design: 'done', tasks: 'done' })

  it('treats an answered early gate as settled and resumes past review', () => {
    const point = deriveResumePoint(settledBase(), doneArtifacts, {
      ...emptyReplay,
      gate: { mode: 'early', answered: true, version: 1 },
      lastVerdict: {
        round: 1,
        verdict: 'open',
        counts: { blocker: 0, material: 0, nitpick: 0 },
        resolved: 0,
        dismissed: 0,
      },
    })
    expect(point.stage).toBe('atomicity')
    expect(point.reason).toBe('atomicity check not recorded')
  })

  it('an unanswered early gate with a cap-hit verdict stays at review', () => {
    const point = deriveResumePoint(settledBase(), doneArtifacts, {
      ...emptyReplay,
      gate: { mode: 'early', answered: false, version: 1 },
      lastVerdict: {
        round: 1,
        verdict: 'open',
        counts: { blocker: 0, material: 0, nitpick: 0 },
        resolved: 0,
        dismissed: 0,
      },
    })
    expect(point.stage).toBe('review')
    expect(point.reason).toBe('review loop not converged')
  })

  it('a final answered gate does not count as an early-gate approve', () => {
    const point = deriveResumePoint(settledBase(), doneArtifacts, {
      ...emptyReplay,
      gate: { mode: 'final', answered: true, version: 1 },
    })
    expect(point.stage).toBe('review')
  })

  it('a decompose stage exit counts as settled even without a verdict', () => {
    const point = deriveResumePoint(settledBase(), doneArtifacts, {
      ...emptyReplay,
      stages: { ...emptyReplay.stages, decompose: 'done', atomicity: 'done' },
    })
    expect(point.stage).toBe('gate')
    expect(point.reason).toBe('all stages complete')
  })

  it('picks the max of recorded round, replay round, and 1 when resuming mid-review', () => {
    const base = { ...settledBase(), round: 0 }
    const point = deriveResumePoint(base, doneArtifacts, { ...emptyReplay, round: { current: 3, cap: 3 } })
    expect(point).toMatchObject({ stage: 'review', round: 3 })
  })
})

describe('autoExtendsUsed persistence (8.1)', () => {
  it('defaults to zero on create, persists increments via saveRunState', async () => {
    const workDir = makeWorkDir()
    const state = await createRunState({ workDir, repoRoot: '/repo', changeName: 'add-thing' })
    expect(state.autoExtendsUsed).toBe(0)
    const saved = await saveRunState({ ...state, autoExtendsUsed: 1 }, new Date('2026-08-10T10:10:00.000Z'))
    const loaded = await loadRunState(workDir, state.runId)
    expect(loaded.autoExtendsUsed).toBe(1)
    expect(saved.autoExtendsUsed).toBe(1)
  })

  it('an old state.json without the field still loads (additive default)', async () => {
    const workDir = makeWorkDir()
    const state = await createRunState({ workDir, repoRoot: '/repo', changeName: 'add-thing' })
    const stateJson = fs.readFileSync(state.statePath, 'utf8')
    fs.writeFileSync(state.statePath, stateJson.replace(/,\s*"autoExtendsUsed":\s*\d+/u, ''))
    const loaded = await loadRunState(workDir, state.runId)
    expect(loaded.autoExtendsUsed).toBe(0)
  })
})

describe('plan/children state fields (3.2)', () => {
  const plan = { childIds: ['foundation', 'data-layer', 'ui'], digest: '0123456789abcdef' }

  it('parses a pre-change state.json fixture without plan/children unchanged', async () => {
    const workDir = makeWorkDir()
    const runId = 'legacy-run'
    fs.mkdirSync(path.join(workDir, 'runs', runId), { recursive: true })
    const legacy = {
      runId,
      repoRoot: '/repo',
      workDir,
      changeName: 'legacy-change',
      stage: 'review',
      depth: 'M',
      round: 2,
      roundCap: 3,
      gate: null,
      status: 'running',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      autoExtendsUsed: 1,
      gateDeadlineAt: null,
      gateDeadlineReArmed: false,
    }
    fs.writeFileSync(path.join(workDir, 'runs', runId, 'state.json'), JSON.stringify(legacy, null, 2))
    const parsed = PersistedRunStateSchema.parse(legacy)
    expect(parsed.plan).toBeUndefined()
    expect(parsed.children).toBeUndefined()
    const loaded = await loadRunState(workDir, runId)
    expect(loaded.changeName).toBe('legacy-change')
    expect(loaded.plan).toBeUndefined()
    expect(loaded.children).toBeUndefined()
  })

  it('round-trips plan and children through save/load', async () => {
    const workDir = makeWorkDir()
    const created = await createRunState({ workDir, repoRoot: '/repo', changeName: 'parent-run' })
    const children = {
      foundation: { status: 'done' as const },
      'data-layer': { status: 'running' as const },
      ui: { status: 'failed' as const },
    }
    await saveRunState({ ...created, plan, children })
    const loaded = await loadRunState(workDir, created.runId)
    expect(loaded.plan).toEqual(plan)
    expect(loaded.children).toEqual(children)
  })

  it("reloads a persisted gate with mode 'plan' and lists it pending", async () => {
    const workDir = makeWorkDir()
    const created = await createRunState({ workDir, repoRoot: '/repo', changeName: 'parent-run' })
    await saveRunState({ ...created, gate: { mode: 'plan', version: 1 } })
    const loaded = await loadRunState(workDir, created.runId)
    expect(loaded.gate).toEqual({ mode: 'plan', version: 1 })
    const pending = await listPendingGates(workDir)
    expect(pending[0]).toMatchObject({ runId: created.runId, gateMode: 'plan', gateVersion: 1 })
  })

  it('rejects a plan with empty childIds and a child status outside the enum', () => {
    const base: Record<string, unknown> = { ...createSeeded('/w') }
    expect(PersistedRunStateSchema.safeParse({ ...base, plan: { childIds: [], digest: 'd' } }).success).toBe(false)
    expect(PersistedRunStateSchema.safeParse({ ...base, plan: { childIds: ['a'], digest: '' } }).success).toBe(false)
    expect(PersistedRunStateSchema.safeParse({ ...base, children: { x: { status: 'skipped' } } }).success).toBe(false)
  })
})

describe('deriveResumePoint parent branch (3.2)', () => {
  const plan3 = { childIds: ['foundation', 'data-layer', 'ui'], digest: '0123456789abcdef' }

  it('returns the first pending child in topo order when no children map exists', () => {
    const state = { ...createSeeded('/w'), plan: plan3 }
    const point = deriveResumePoint(state, artifacts(), emptyReplay)
    expect(point).toMatchObject({ stage: 'decompose', round: 0 })
    expect(point.reason).toBe('children pending: next foundation (1 of 3)')
  })

  it('skips done children to the next pending child in topo order', () => {
    const state = {
      ...createSeeded('/w'),
      round: 4,
      stage: 'decompose' as const,
      plan: plan3,
      children: { foundation: { status: 'done' as const }, 'data-layer': { status: 'running' as const } },
    }
    const point = deriveResumePoint(state, artifacts(), emptyReplay)
    expect(point).toMatchObject({ stage: 'decompose', round: 4 })
    expect(point.reason).toBe('children pending: next data-layer (2 of 3)')
  })

  it('treats a failed child as still pending', () => {
    const state = {
      ...createSeeded('/w'),
      plan: plan3,
      children: {
        foundation: { status: 'done' as const },
        'data-layer': { status: 'failed' as const },
        ui: { status: 'done' as const },
      },
    }
    const point = deriveResumePoint(state, artifacts(), emptyReplay)
    expect(point.reason).toBe('children pending: next data-layer (2 of 3)')
  })

  it('a pending gate still wins over the parent branch', () => {
    const state = {
      ...createSeeded('/w'),
      round: 2,
      stage: 'gate' as const,
      gate: { mode: 'plan' as const, version: 1 },
      plan: plan3,
    }
    expect(deriveResumePoint(state, artifacts(), emptyReplay)).toMatchObject({
      stage: 'gate',
      round: 2,
      reason: 'gate-pending',
    })
  })

  it('an all-done plan falls through to the cascade, deciding identically to a non-parent state', () => {
    const base = createSeeded('/w')
    const parent = {
      ...base,
      plan: plan3,
      children: {
        foundation: { status: 'done' as const },
        'data-layer': { status: 'done' as const },
        ui: { status: 'done' as const },
      },
    }
    expect(deriveResumePoint(parent, artifacts(), emptyReplay)).toEqual(
      deriveResumePoint(base, artifacts(), emptyReplay),
    )
  })
})
