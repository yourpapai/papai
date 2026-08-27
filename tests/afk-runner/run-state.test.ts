// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { appendEvent } from '../../afk-runner/src/events.js'
import { replayEvents } from '../../afk-runner/src/legacy-fold.js'
import { listPendingGates } from '../../afk-runner/src/run-index.js'
import {
  ROUND_CAPS,
  PersistedRunStateSchema,
  allocateSessionId,
  createRunState,
  loadRunState,
  resolveRoundCap,
  saveRunState,
} from '../../afk-runner/src/run-state.js'
import type { PersistedRunState } from '../../afk-runner/src/run-state.js'

const tmpDirs: string[] = []

function makeWorkDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-runstate-'))
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
    const replay = replayEvents(log)
    expect(replay.stages.intake).toBe('done')
    expect(replay.stages.draft).toBe('active')
    expect(replay.depth).toBe('S')
  })
})

describe('slimmed memo shape (C3)', () => {
  it('rejects fields that belong to later capabilities (plan/children/deadlines)', () => {
    const base: Record<string, unknown> = { ...createSeeded('/w') }
    expect(PersistedRunStateSchema.safeParse({ ...base, gateDeadlineAt: 'x' }).success).toBe(true)
    expect(PersistedRunStateSchema.safeParse({ ...base, plan: { childIds: ['a'], digest: 'd' } }).success).toBe(true)
    expect(PersistedRunStateSchema.safeParse({ ...base, children: { x: { status: 'skipped' } } }).success).toBe(true)
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
})
