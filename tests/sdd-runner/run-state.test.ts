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
import {
  createRunState,
  deriveResumePoint,
  listPendingGates,
  loadRunState,
  resolveRoundCap,
  resolveRunId,
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

async function seedRun(
  workDir: string,
  runId: string,
  opts: { gate?: { mode: 'early' | 'final'; version: number } | null; changeName?: string; updatedAt?: string },
): Promise<void> {
  const created = await createRunState({
    workDir,
    repoRoot: '/repo',
    changeName: opts.changeName ?? 'add-thing',
    runId,
  })
  const gate = opts.gate === undefined ? { mode: 'early' as const, version: 1 } : opts.gate
  const stamp = opts.updatedAt ?? created.updatedAt
  await saveRunState({ ...created, gate, updatedAt: stamp }, new Date(stamp))
}

describe('listPendingGates', () => {
  it('scans runs/*/state.json, keeps only gate-pending runs, and returns change name, gate version, and wait time sorted by recency', async () => {
    const workDir = makeWorkDir()
    await seedRun(workDir, 'run-old', {
      gate: { mode: 'early', version: 1 },
      changeName: 'old-change',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    await seedRun(workDir, 'run-new', {
      gate: { mode: 'final', version: 3 },
      changeName: 'new-change',
      updatedAt: '2026-02-01T00:00:00.000Z',
    })
    await seedRun(workDir, 'run-done', { gate: null, updatedAt: '2026-03-01T00:00:00.000Z' })

    const pending = await listPendingGates(workDir)
    expect(pending.map((entry) => entry.runId)).toEqual(['run-new', 'run-old'])
    expect(pending[0]).toMatchObject({ runId: 'run-new', changeName: 'new-change', gateVersion: 3 })
    expect(pending[1]).toMatchObject({ runId: 'run-old', changeName: 'old-change', gateVersion: 1 })
  })

  it('returns an empty list when no runs exist', async () => {
    expect(await listPendingGates(makeWorkDir())).toEqual([])
  })
})

describe('resolveRunId', () => {
  it('accepts an exact id', async () => {
    const workDir = makeWorkDir()
    await seedRun(workDir, '2026-01-01T00-00-00-000Z-abcd1234', { gate: { mode: 'early', version: 1 } })
    expect(await resolveRunId(workDir, '2026-01-01T00-00-00-000Z-abcd1234')).toBe('2026-01-01T00-00-00-000Z-abcd1234')
  })

  it('accepts an unambiguous prefix among known runs (gate-pending or not)', async () => {
    const workDir = makeWorkDir()
    await seedRun(workDir, '2026-01-01T00-00-00-000Z-abcd1234', { gate: { mode: 'early', version: 1 } })
    await seedRun(workDir, '2026-02-01T00-00-00-000Z-ffff0000', { gate: null })
    expect(await resolveRunId(workDir, '2026-01-01T00')).toBe('2026-01-01T00-00-00-000Z-abcd1234')
    expect(await resolveRunId(workDir, '2026-02')).toBe('2026-02-01T00-00-00-000Z-ffff0000')
  })

  it('accepts an exact id even when it is also a prefix of another run id', async () => {
    const workDir = makeWorkDir()
    await seedRun(workDir, 'run-1', { gate: { mode: 'early', version: 1 } })
    await seedRun(workDir, 'run-1-extended', { gate: { mode: 'final', version: 1 } })
    expect(await resolveRunId(workDir, 'run-1')).toBe('run-1')
  })

  it('fails on an unknown id naming the input', async () => {
    const workDir = makeWorkDir()
    await seedRun(workDir, '2026-01-01T00-00-00-000Z-abcd1234', { gate: { mode: 'early', version: 1 } })
    const resolution = resolveRunId(workDir, 'nope')
    await expect(resolution).rejects.toThrow(/unknown run id/iu)
    await expect(resolution).rejects.toThrow(/nope/u)
  })

  it('fails on an ambiguous prefix listing every matching candidate id', async () => {
    const workDir = makeWorkDir()
    await seedRun(workDir, '2026-01-01T00-00-00-000Z-abcd1234', { gate: { mode: 'early', version: 1 } })
    await seedRun(workDir, '2026-01-01T00-00-00-000Z-ffff0000', { gate: { mode: 'final', version: 1 } })
    const message = (await errorOf(resolveRunId(workDir, '2026-01-01'))).message
    expect(message).toMatch(/ambiguous/iu)
    expect(message).toContain('abcd1234')
    expect(message).toContain('ffff0000')
    // one candidate per line, order-free: both candidate lines start with the shared timestamp prefix
    expect(message.match(/\n {2}2026-01-01/gu)).toHaveLength(2)
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
