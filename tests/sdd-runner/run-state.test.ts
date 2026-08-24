// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { appendEvent } from '../../sdd-runner/src/events.js'
import { ROUND_CAPS } from '../../sdd-runner/src/review-model.js'
import { listPendingGates } from '../../sdd-runner/src/run-index.js'
import {
  PersistedRunStateSchema,
  allocateSessionId,
  createRunState,
  loadRunState,
  narrowGateMode,
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

describe('createRunState + loadRunState', () => {
  it('creates a run dir with a schema-valid state.json and reloads it', async () => {
    const workDir = makeWorkDir()
    const state = await createRunState({ workDir, repoRoot: '/repo', changeName: 'add-thing' })
    expect(state.runId).toBe('add-thing')
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

  it('honors an explicit runId override so legacy datetime dirs stay creatable', async () => {
    const workDir = makeWorkDir()
    const state = await createRunState(
      { workDir, repoRoot: '/repo', changeName: 'add-thing', runId: '2026-03-04T05-06-07-891Z-abcd1234' },
      new Date('2026-03-04T05:06:07.891Z'),
    )
    expect(state.runId).toBe('2026-03-04T05-06-07-891Z-abcd1234')
    expect(state.createdAt).toBe('2026-03-04T05:06:07.891Z')
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

describe('session id allocation', () => {
  it('refuses creation while a non-terminal run holds the name, naming the holder', async () => {
    const workDir = makeWorkDir()
    await createRunState({ workDir, repoRoot: '/repo', changeName: 'fix-flaky-auth-test' })
    const failure = await errorOf(createRunState({ workDir, repoRoot: '/repo', changeName: 'fix-flaky-auth-test' }))
    expect(failure.message).toContain('fix-flaky-auth-test')
    expect(failure.message).toMatch(/non-terminal/u)
  })

  it('suffixes the id when only terminal runs hold the name', async () => {
    const workDir = makeWorkDir()
    const first = await createRunState({ workDir, repoRoot: '/repo', changeName: 'add-thing' })
    await saveRunState({ ...first, status: 'completed' })
    const second = await createRunState({ workDir, repoRoot: '/repo', changeName: 'add-thing' })
    expect(second.runId).toBe('add-thing-2')
  })

  it('uses the plain name when it is entirely free, even with sibling suffixed runs', async () => {
    const workDir = makeWorkDir()
    const sibling = await createRunState({ workDir, repoRoot: '/repo', changeName: 'add-thing-2' })
    await saveRunState({ ...sibling, status: 'completed' })
    const state = await createRunState({ workDir, repoRoot: '/repo', changeName: 'add-thing' })
    expect(state.runId).toBe('add-thing')
  })

  it('refuses an empty name outright rather than synthesizing an id', async () => {
    const workDir = makeWorkDir()
    const failure = await errorOf(allocateSessionId(workDir, ''))
    expect(failure.message).toBe('cannot derive a session id from an empty change name')
  })

  it('walks past terminal holders of every terminal status before allocating the next suffix', async () => {
    const workDir = makeWorkDir()
    const first = await createRunState({ workDir, repoRoot: '/repo', changeName: 'add-thing' })
    await saveRunState({ ...first, status: 'completed' })
    const second = await createRunState({ workDir, repoRoot: '/repo', changeName: 'add-thing' })
    expect(second.runId).toBe('add-thing-2')
    await saveRunState({ ...second, status: 'aborted' })
    const third = await createRunState({ workDir, repoRoot: '/repo', changeName: 'add-thing' })
    expect(third.runId).toBe('add-thing-3')

    const failedHolder = await createRunState({ workDir, repoRoot: '/repo', changeName: 'flaky-fix' })
    await saveRunState({ ...failedHolder, status: 'failed' })
    const afterFailure = await createRunState({ workDir, repoRoot: '/repo', changeName: 'flaky-fix' })
    expect(afterFailure.runId).toBe('flaky-fix-2')
  })

  it('refuses a suffix held live even when the bare name is terminally held, naming the holder', async () => {
    const workDir = makeWorkDir()
    const first = await createRunState({ workDir, repoRoot: '/repo', changeName: 'add-thing' })
    await saveRunState({ ...first, status: 'completed' })
    await createRunState({ workDir, repoRoot: '/repo', changeName: 'add-thing-2' })
    const failure = await errorOf(allocateSessionId(workDir, 'add-thing'))
    expect(failure.message).toContain('add-thing-2')
    expect(failure.message).toMatch(/non-terminal/u)
  })

  it('falls back to a datetime id when the change name slugifies to nothing', async () => {
    const workDir = makeWorkDir()
    const state = await createRunState(
      { workDir, repoRoot: '/repo', changeName: '###' },
      new Date('2026-03-04T05:06:07.891Z'),
    )
    expect(state.runId).toMatch(/^2026-03-04T05-06-07-891Z-[0-9a-f]{8}$/u)
  })

  it('parses an old state.json without gateDeadlineReArmed as not re-armed', () => {
    const parsed = PersistedRunStateSchema.parse({
      runId: 'add-thing',
      repoRoot: '/repo',
      workDir: '/work',
      changeName: 'add-thing',
      stage: 'intake',
      depth: null,
      round: 0,
      gate: null,
      status: 'completed',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(parsed.gateDeadlineReArmed).toBe(false)
    expect(parsed.autoExtendsUsed).toBe(0)
  })

  it('creates a fresh run with the deadline not re-armed, in memory and on reload', async () => {
    const workDir = makeWorkDir()
    const state = await createRunState({ workDir, repoRoot: '/repo', changeName: 'add-thing' })
    expect(state.gateDeadlineReArmed).toBe(false)
    expect(state.gateDeadlineAt).toBeNull()
    const loaded = await loadRunState(workDir, state.runId)
    expect(loaded.gateDeadlineReArmed).toBe(false)
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
    depth: null,
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

describe('narrowGateMode (part-1 scaffolding)', () => {
  it('narrows the pre-part-3 modes and refuses plan with the wiring note', () => {
    expect(narrowGateMode('early')).toBe('early')
    expect(narrowGateMode('final')).toBe('final')
    expect(() => narrowGateMode('plan')).toThrow("gate mode 'plan' has no resume path before part 3 wiring")
  })
})
