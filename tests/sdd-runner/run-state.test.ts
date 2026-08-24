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
import {
  PersistedRunStateSchema,
  allocateSessionId,
  createRunState,
  listPendingGates,
  loadRunState,
  readAllRunStates,
  resolveRoundCap,
  resolveRunId,
  saveRunState,
} from '../../sdd-runner/src/run-state.js'

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

describe('readAllRunStates', () => {
  it('returns every readable run, most recently updated first', async () => {
    const workDir = makeWorkDir()
    const older = await createRunState({ workDir, repoRoot: '/repo', changeName: 'older-change' })
    await saveRunState({ ...older, status: 'stopped' }, new Date('2026-01-01T00:00:01Z'))
    const newer = await createRunState({ workDir, repoRoot: '/repo', changeName: 'newer-change' })
    await saveRunState(
      { ...newer, stage: 'gate', gate: { mode: 'early', version: 1 } },
      new Date('2026-01-01T00:00:02Z'),
    )

    const states = await readAllRunStates(workDir)

    expect(states.map((s) => s.runId)).toEqual([newer.runId, older.runId])
    expect(states[0]).toMatchObject({ runId: newer.runId, status: 'running', gate: { mode: 'early', version: 1 } })
    expect(states[1]).toMatchObject({ runId: older.runId, status: 'stopped', gate: null })
  })

  it('skips runs whose state.json is missing or malformed', async () => {
    const workDir = makeWorkDir()
    const good = await createRunState({ workDir, repoRoot: '/repo', changeName: 'good-change' })
    await saveRunState(good)
    fs.mkdirSync(path.join(workDir, 'runs', 'broken-run'), { recursive: true })
    fs.writeFileSync(path.join(workDir, 'runs', 'broken-run', 'state.json'), '{ not json')
    fs.mkdirSync(path.join(workDir, 'runs', 'empty-run'), { recursive: true })

    const states = await readAllRunStates(workDir)

    expect(states.map((s) => s.runId)).toEqual([good.runId])
  })

  it('returns an empty list when the workDir has no runs directory', async () => {
    expect(await readAllRunStates(makeWorkDir())).toEqual([])
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

  it('skips a run whose state.json is corrupt rather than failing the listing', async () => {
    const workDir = makeWorkDir()
    await seedRun(workDir, 'run-broken', { gate: { mode: 'early', version: 1 } })
    fs.writeFileSync(path.join(workDir, 'runs', 'run-broken', 'state.json'), '{"runId": 42}')
    await seedRun(workDir, 'run-live', { gate: { mode: 'final', version: 1 } })
    const pending = await listPendingGates(workDir)
    expect(pending.map((entry) => entry.runId)).toEqual(['run-live'])
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

  it('names the runs directory when no runs exist at all', async () => {
    const workDir = makeWorkDir()
    const message = (await errorOf(resolveRunId(workDir, 'anything'))).message
    expect(message).toContain(path.join(workDir, 'runs'))
    expect(message).toContain('anything')
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
