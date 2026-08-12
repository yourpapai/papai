// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { appendEvent } from '../../sdd-runner/src/events.js'
import type { ReplayState } from '../../sdd-runner/src/replay.js'
import { ROUND_CAPS } from '../../sdd-runner/src/review-model.js'
import {
  createRunState,
  deriveResumePoint,
  loadRunState,
  resolveRoundCap,
  saveRunState,
} from '../../sdd-runner/src/run-state.js'

const tmpDirs: string[] = []

function makeWorkDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-runstate-'))
  tmpDirs.push(dir)
  return dir
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

  it('rejects a corrupt state.json', async () => {
    const workDir = makeWorkDir()
    const state = await createRunState({ workDir, repoRoot: '/repo', changeName: 'add-thing' })
    fs.writeFileSync(path.join(state.runDir, 'state.json'), '{"runId": 42}')
    await expect(loadRunState(workDir, state.runId)).rejects.toThrow(/state\.json/u)
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
