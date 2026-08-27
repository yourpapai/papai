// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { loadRunState } from '../../afk-runner/src/run-state.js'
import {
  createStopMarkerSeam,
  HolderRecordSchema,
  holderPath,
  pidIsAlive,
  readHolder,
  removeHolder,
  runHasLiveOwner,
  requestCalmStop,
  stopMarkerPath,
  stopRun,
  stopRunMessage,
  writeHolder,
} from '../../afk-runner/src/stop-controller.js'
import type { CalmStopController } from '../../afk-runner/src/stop-controller.js'

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-stop-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('holder record (process ownership)', () => {
  it('writes { pid, startedAt } and reads it back schema-valid', () => {
    const dir = makeDir()
    writeHolder(dir, 4242, new Date('2026-01-01T00:00:00Z'))
    const raw = JSON.parse(fs.readFileSync(holderPath(dir), 'utf8')) as unknown
    expect(HolderRecordSchema.safeParse(raw).success).toBe(true)
    expect(readHolder(dir)).toEqual({ pid: 4242, startedAt: '2026-01-01T00:00:00.000Z' })
  })

  it('removeHolder deletes the record; readHolder tolerates absence', () => {
    const dir = makeDir()
    writeHolder(dir, 1, new Date())
    removeHolder(dir)
    expect(fs.existsSync(holderPath(dir))).toBe(false)
    expect(readHolder(dir)).toBe(null)
  })

  it('readHolder reports null for a corrupt record', () => {
    const dir = makeDir()
    fs.writeFileSync(holderPath(dir), '{not json')
    expect(readHolder(dir)).toBe(null)
  })

  it('runHasLiveOwner follows the injected liveness of the holder pid', () => {
    const dir = makeDir()
    writeHolder(dir, 99, new Date())
    expect(runHasLiveOwner(dir, () => true)).toBe(true)
    expect(runHasLiveOwner(dir, () => false)).toBe(false)
  })

  it('a missing holder reads as dead (legacy runs)', () => {
    expect(runHasLiveOwner(makeDir(), () => true)).toBe(false)
  })
})

describe('pidIsAlive', () => {
  it('kill(0) success and EPERM mean alive; ESRCH means dead', () => {
    const okay = (): void => {}
    const eperm = (): void => {
      const error = new Error('ep') as NodeJS.ErrnoException
      error.code = 'EPERM'
      throw error
    }
    const esrch = (): void => {
      const error = new Error('no such process') as NodeJS.ErrnoException
      error.code = 'ESRCH'
      throw error
    }
    expect(pidIsAlive(1, okay)).toBe(true)
    expect(pidIsAlive(1, eperm)).toBe(true)
    expect(pidIsAlive(1, esrch)).toBe(false)
  })

  it('answers alive for this very process', () => {
    expect(pidIsAlive(process.pid)).toBe(true)
  })
})

interface SeedInput {
  readonly status?: string
  readonly stage?: string
  readonly depth?: string | null
  readonly gate?: { mode: 'early' | 'final'; version: number } | null
  readonly holderPid?: number
  readonly stopMarker?: boolean
  readonly updatedAt?: string
}

function seedRun(overrides: SeedInput = {}): { workDir: string; runId: string; runDir: string } {
  const workDir = makeDir()
  const runId = 'seeded-run'
  const runDir = path.join(workDir, 'runs', runId)
  fs.mkdirSync(runDir, { recursive: true })
  const updatedAt = overrides.updatedAt ?? '2026-01-01T00:00:00.000Z'
  fs.writeFileSync(
    path.join(runDir, 'state.json'),
    `${JSON.stringify(
      {
        runId,
        repoRoot: workDir,
        workDir,
        changeName: 'seeded-change',
        stage: overrides.stage ?? 'review',
        depth: overrides.depth === undefined ? 'S' : overrides.depth,
        round: 1,
        gate: overrides.gate === undefined ? null : overrides.gate,
        status: overrides.status ?? 'running',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt,
      },
      null,
      2,
    )}\n`,
  )
  if (overrides.holderPid !== undefined) writeHolder(runDir, overrides.holderPid, new Date(updatedAt))
  if (overrides.stopMarker === true) requestCalmStop(runDir)
  return { workDir, runId, runDir }
}

const DEAD: () => boolean = () => false
const ALIVE: () => boolean = () => true

describe('stopRun (liveness-aware stop seam)', () => {
  it('is a no-op for a non-running run, leaving state untouched', async () => {
    for (const status of ['stopped', 'aborted', 'completed', 'failed']) {
      const seed = seedRun({ status })
      const result = await stopRun(seed.workDir, seed.runId, { isAlive: ALIVE })
      expect(result).toEqual({ kind: 'no-op', runId: seed.runId, status, gatePending: false })
      expect((await loadRunState(seed.workDir, seed.runId)).updatedAt).toBe('2026-01-01T00:00:00.000Z')
    }
  })

  it('is a no-op for a gate-pending run — a decision awaits, nothing to stop', async () => {
    const seed = seedRun({ gate: { mode: 'final', version: 1 } })
    const result = await stopRun(seed.workDir, seed.runId, { isAlive: ALIVE })
    expect(result).toEqual({ kind: 'no-op', runId: seed.runId, status: 'running', gatePending: true })
    expect(fs.existsSync(stopMarkerPath(seed.runDir))).toBe(false)
    expect((await loadRunState(seed.workDir, seed.runId)).status).toBe('running')
  })

  it('writes the calm-stop marker when the owning process is alive', async () => {
    const seed = seedRun({ holderPid: 4242 })
    const result = await stopRun(seed.workDir, seed.runId, { isAlive: ALIVE })
    expect(result).toEqual({ kind: 'marker-requested', runId: seed.runId })
    expect(fs.existsSync(stopMarkerPath(seed.runDir))).toBe(true)
    expect((await loadRunState(seed.workDir, seed.runId)).status).toBe('running')
  })

  it('settles a dead mid-pipeline run as stopped and bumps updatedAt', async () => {
    const seed = seedRun({ stage: 'review', depth: 'S' })
    const result = await stopRun(seed.workDir, seed.runId, {
      isAlive: DEAD,
      now: () => new Date('2026-01-02T00:00:00Z'),
    })
    expect(result).toEqual({ kind: 'settled', runId: seed.runId, to: 'stopped' })
    const state = await loadRunState(seed.workDir, seed.runId)
    expect(state.status).toBe('stopped')
    expect(state.updatedAt).toBe('2026-01-02T00:00:00.000Z')
  })

  it('settles a dead pre-classification run (depth null) as aborted', async () => {
    const seed = seedRun({ stage: 'intake', depth: null })
    const result = await stopRun(seed.workDir, seed.runId, { isAlive: DEAD })
    expect(result).toEqual({ kind: 'settled', runId: seed.runId, to: 'aborted' })
    expect((await loadRunState(seed.workDir, seed.runId)).status).toBe('aborted')
  })

  it('settles a legacy zombie (no holder file) as dead', async () => {
    const seed = seedRun({ stage: 'review', depth: 'S' })
    expect(fs.existsSync(holderPath(seed.runDir))).toBe(false)
    const result = await stopRun(seed.workDir, seed.runId, { isAlive: ALIVE })
    expect(result).toEqual({ kind: 'settled', runId: seed.runId, to: 'stopped' })
  })

  it('consumes a stale stop-requested marker when settling', async () => {
    const seed = seedRun({ stopMarker: true })
    expect(fs.existsSync(stopMarkerPath(seed.runDir))).toBe(true)
    await stopRun(seed.workDir, seed.runId, { isAlive: DEAD })
    expect(fs.existsSync(stopMarkerPath(seed.runDir))).toBe(false)
  })
})

describe('stopRunMessage (outcome → operator line)', () => {
  it('marker outcome names the boundary', () => {
    expect(stopRunMessage({ kind: 'marker-requested', runId: 'r1' })).toBe(
      'calm stop requested for r1 — honored at the next boundary',
    )
  })

  it('settled stopped is resumable via the run id', () => {
    expect(stopRunMessage({ kind: 'settled', runId: 'r1', to: 'stopped' })).toBe(
      'run r1 has no live process — settled as stopped · resumable via sdd r1',
    )
  })

  it('settled aborted points at a fresh start', () => {
    expect(stopRunMessage({ kind: 'settled', runId: 'r1', to: 'aborted' })).toBe(
      'run r1 has no live process — settled as aborted · nothing to resume, start fresh: sdd <task-file>',
    )
  })

  it('no-op reports the current status; gate-pending names the pending decision', () => {
    expect(stopRunMessage({ kind: 'no-op', runId: 'r1', status: 'completed', gatePending: false })).toBe(
      'run r1 is completed — nothing to stop',
    )
    expect(stopRunMessage({ kind: 'no-op', runId: 'r1', status: 'running', gatePending: true })).toBe(
      'run r1 awaits a gate decision — nothing to stop',
    )
  })
})

describe('calm stop controller (boundary-honoring)', () => {
  it('starts un-requested; request is sticky and first-reason-wins', () => {
    const controller = createStopMarkerSeam(makeDir())
    expect(controller.requested()).toBe(null)
    controller.request()
    expect(controller.requested()).toBe('key')
    expect(controller.stopRequested()).toBe(true)
  })

  it('observes a marker file written by another process at the next boundary check', () => {
    const dir = makeDir()
    const controller = createStopMarkerSeam(dir)
    expect(controller.stopRequested()).toBe(false)
    requestCalmStop(dir)
    expect(fs.existsSync(stopMarkerPath(dir))).toBe(true)
    expect(controller.stopRequested()).toBe(true)
    expect(controller.requested()).toBe('marker')
  })

  it('a marker for a different run dir is not observed', () => {
    const a = makeDir()
    const b = makeDir()
    requestCalmStop(a)
    expect(createStopMarkerSeam(b).stopRequested()).toBe(false)
  })

  it('consumes the marker when the stop is honored, so a later resume is not stopped', () => {
    const dir = makeDir()
    const controller = createStopMarkerSeam(dir)
    requestCalmStop(dir)
    controller.consumeMarker()
    expect(fs.existsSync(stopMarkerPath(dir))).toBe(false)
  })
})

describe('CalmStopController shape', () => {
  it('exposes the review-loop stop-controller interface', () => {
    const controller: CalmStopController = createStopMarkerSeam(makeDir())
    expect(typeof controller.requested).toBe('function')
    expect(typeof controller.stopRequested).toBe('function')
    expect(typeof controller.consumeMarker).toBe('function')
  })
})
