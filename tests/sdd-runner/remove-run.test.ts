// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { removeRun, removeRunMessage } from '../../sdd-runner/src/remove-run.js'
import { PersistedRunStateSchema } from '../../sdd-runner/src/run-state.js'
import { requestCalmStop, writeHolder } from '../../sdd-runner/src/stop-controller.js'

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-remove-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

interface SeedInput {
  readonly status?: 'running' | 'completed' | 'aborted' | 'failed' | 'stopped'
  readonly gate?: { mode: 'early' | 'final'; version: number } | null
  readonly stopMarker?: boolean
  readonly holderPid?: number
}

function seedRun(workDir: string, runId: string, overrides: SeedInput = {}): string {
  const runDir = path.join(workDir, 'runs', runId)
  fs.mkdirSync(runDir, { recursive: true })
  fs.writeFileSync(
    path.join(runDir, 'state.json'),
    `${JSON.stringify(
      {
        runId,
        repoRoot: workDir,
        workDir,
        changeName: 'seeded-change',
        stage: 'review',
        depth: 'S',
        round: 1,
        gate: overrides.gate === undefined ? null : overrides.gate,
        status: overrides.status ?? 'running',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      null,
      2,
    )}\n`,
  )
  fs.writeFileSync(path.join(runDir, 'events.ndjson'), '')
  if (overrides.holderPid !== undefined) writeHolder(runDir, overrides.holderPid, new Date('2026-01-01T00:00:00Z'))
  if (overrides.stopMarker === true) requestCalmStop(runDir)
  return runDir
}

function setup(overrides: SeedInput = {}): { workDir: string; runId: string; runDir: string } {
  const workDir = makeDir()
  const runId = 'seeded-run'
  return { workDir, runId, runDir: seedRun(workDir, runId, overrides) }
}

const DEAD: () => boolean = () => false
const ALIVE: () => boolean = () => true

describe('removeRun (guard + delete)', () => {
  it('deletes a terminal run directory (completed, aborted, failed)', async () => {
    for (const status of ['completed', 'aborted', 'failed'] as const) {
      const seed = setup({ status })
      const result = await removeRun(seed.workDir, seed.runId, { isAlive: ALIVE })
      expect(result).toEqual({ kind: 'removed', runId: seed.runId })
      expect(fs.existsSync(seed.runDir)).toBe(false)
    }
  })

  it('deletes a stopped run', async () => {
    const seed = setup({ status: 'stopped' })
    const result = await removeRun(seed.workDir, seed.runId, { isAlive: DEAD })
    expect(result).toEqual({ kind: 'removed', runId: seed.runId })
    expect(fs.existsSync(seed.runDir)).toBe(false)
  })

  it('refuses a running run — plain, gate-pending, or stop-requested — leaving it untouched', async () => {
    const cases: readonly { label: string; overrides: SeedInput }[] = [
      { label: 'plain running', overrides: { status: 'running' } },
      { label: 'gate-pending', overrides: { status: 'running', gate: { mode: 'final', version: 1 } } },
      { label: 'stop-requested', overrides: { status: 'running', stopMarker: true } },
    ]
    for (const testCase of cases) {
      const seed = setup(testCase.overrides)
      const result = await removeRun(seed.workDir, seed.runId, { isAlive: DEAD })
      expect(result.kind).toBe('refused')
      expect(result).toEqual({ kind: 'refused', runId: seed.runId, reason: 'running' })
      expect(fs.existsSync(seed.runDir)).toBe(true)
      expect(removeRunMessage(result)).toContain('calm-stop')
    }
  })

  it('refuses any status while a live owner holds the run', async () => {
    const running = setup({ status: 'running', holderPid: 4242 })
    expect(await removeRun(running.workDir, running.runId, { isAlive: ALIVE })).toEqual({
      kind: 'refused',
      runId: running.runId,
      reason: 'running',
    })
    expect(fs.existsSync(running.runDir)).toBe(true)
    for (const status of ['stopped', 'completed'] as const) {
      const seed = setup({ status, holderPid: 4242 })
      const result = await removeRun(seed.workDir, seed.runId, { isAlive: ALIVE })
      expect(result).toEqual({ kind: 'refused', runId: seed.runId, reason: 'live-owner' })
      expect(fs.existsSync(seed.runDir)).toBe(true)
    }
  })

  it('a dead holder pid does not block deletion (crash-left holder)', async () => {
    const seed = setup({ status: 'stopped', holderPid: 4242 })
    const result = await removeRun(seed.workDir, seed.runId, { isAlive: DEAD })
    expect(result).toEqual({ kind: 'removed', runId: seed.runId })
    expect(fs.existsSync(seed.runDir)).toBe(false)
  })

  it('the guard reads fresh persisted state at delete time, not a caller snapshot', async () => {
    const seed = setup({ status: 'completed' })
    const persisted = PersistedRunStateSchema.parse(
      JSON.parse(fs.readFileSync(path.join(seed.runDir, 'state.json'), 'utf8')),
    )
    fs.writeFileSync(
      path.join(seed.runDir, 'state.json'),
      `${JSON.stringify({ ...persisted, status: 'running' }, null, 2)}\n`,
    )
    const result = await removeRun(seed.workDir, seed.runId, { isAlive: DEAD })
    expect(result).toEqual({ kind: 'refused', runId: seed.runId, reason: 'running' })
    expect(fs.existsSync(seed.runDir)).toBe(true)
  })

  it('removes only the targeted run directory', async () => {
    const workDir = makeDir()
    const alpha = seedRun(workDir, 'alpha', { status: 'completed' })
    const beta = seedRun(workDir, 'beta', { status: 'completed' })
    const result = await removeRun(workDir, 'alpha', { isAlive: DEAD })
    expect(result).toEqual({ kind: 'removed', runId: 'alpha' })
    expect(fs.existsSync(alpha)).toBe(false)
    expect(fs.existsSync(beta)).toBe(true)
  })
})

describe('removeRunMessage (outcome → operator line)', () => {
  it('removed names the deleted run', () => {
    expect(removeRunMessage({ kind: 'removed', runId: 'r1' })).toBe('run r1 deleted')
  })

  it('a running refusal points at calm-stop with the concrete command', () => {
    expect(removeRunMessage({ kind: 'refused', runId: 'r1', reason: 'running' })).toBe(
      'run r1 is running (gate-pending or stop-requested included) — calm-stop it first: sdd stop r1',
    )
  })

  it('a live-owner refusal points at calm-stop with the concrete command', () => {
    expect(removeRunMessage({ kind: 'refused', runId: 'r1', reason: 'live-owner' })).toBe(
      'run r1 has a live owner process — calm-stop it first: sdd stop r1',
    )
  })
})
