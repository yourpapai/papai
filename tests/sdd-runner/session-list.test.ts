// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { appendEvent } from '../../sdd-runner/src/events.js'
import { createRunState, saveRunState } from '../../sdd-runner/src/run-state.js'
import { listSessions } from '../../sdd-runner/src/session-list.js'

const tmpDirs: string[] = []

function makeWorkDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-sessionlist-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

function logPathFor(workDir: string, runId: string): string {
  return path.join(workDir, 'runs', runId, 'events.ndjson')
}

function emitDone(logPath: string, tokensIn: number, tokensOut: number): void {
  const event = {
    altitude: 'L1',
    type: 'done',
    agent: 'drafter-proposal',
    model: 'test-model',
    usage: {
      inputTokens: tokensIn,
      outputTokens: tokensOut,
      reasoningTokens: 0,
      cachedReadTokens: 0,
      cachedWriteTokens: 0,
      costUsd: 0.25,
      wallMs: 1000,
    },
  }
  appendEvent(logPath, event)
}

describe('listSessions', () => {
  it('returns one row per run with identity, progress, and pending decision', async () => {
    const workDir = makeWorkDir()
    const active = await createRunState({ workDir, repoRoot: '/repo', changeName: 'fix-flaky-auth-test' })
    await saveRunState({ ...active, stage: 'review', depth: 'M', round: 2, roundCap: 3 })
    const log = logPathFor(workDir, active.runId)
    emitDone(log, 100, 50)
    appendEvent(log, { altitude: 'L2', type: 'stage_enter', stage: 'review' })

    const rows = await listSessions(workDir)
    expect(rows).toHaveLength(1)
    const row = rows[0]!
    expect(row.runId).toBe('fix-flaky-auth-test')
    expect(row.changeName).toBe('fix-flaky-auth-test')
    expect(row.status).toBe('running')
    expect(row.stage).toBe('review')
    expect(row.roundCap).toBe(3)
    expect(row.tokensIn).toBe(100)
    expect(row.tokensOut).toBe(50)
    expect(row.costUsd).toBeCloseTo(0.25)
    expect(row.pendingDecision).toBeNull()
  })

  it('marks a gate-pending run with its pending decision', async () => {
    const workDir = makeWorkDir()
    const run = await createRunState({ workDir, repoRoot: '/repo', changeName: 'gated' })
    await saveRunState({ ...run, gate: { mode: 'early', version: 2 }, stage: 'gate' })
    const rows = await listSessions(workDir)
    expect(rows[0]?.pendingDecision).toEqual({ kind: 'gate', mode: 'early', version: 2 })
  })

  it('marks a stopped run as awaiting resume', async () => {
    const workDir = makeWorkDir()
    const run = await createRunState({ workDir, repoRoot: '/repo', changeName: 'halted' })
    await saveRunState({ ...run, status: 'stopped' })
    const rows = await listSessions(workDir)
    expect(rows[0]?.pendingDecision).toEqual({ kind: 'stop' })
  })

  it('sorts most recently updated first and skips corrupt entries', async () => {
    const workDir = makeWorkDir()
    const older = await createRunState(
      { workDir, repoRoot: '/repo', changeName: 'older-task' },
      new Date('2026-01-01T00:00:00.000Z'),
    )
    const newer = await createRunState(
      { workDir, repoRoot: '/repo', changeName: 'newer-task' },
      new Date('2026-01-02T00:00:00.000Z'),
    )
    fs.mkdirSync(path.join(workDir, 'runs', 'corrupt'), { recursive: true })
    fs.writeFileSync(path.join(workDir, 'runs', 'corrupt', 'state.json'), '{not json')
    const rows = await listSessions(workDir)
    expect(rows.map((row) => row.runId)).toEqual([newer.runId, older.runId])
  })

  it('returns an empty list when no runs exist', async () => {
    const workDir = makeWorkDir()
    expect(await listSessions(workDir)).toEqual([])
  })

  it('reports cost as unknown when usage carries no recorded cost', async () => {
    const workDir = makeWorkDir()
    const run = await createRunState({ workDir, repoRoot: '/repo', changeName: 'unmetered' })
    const event = {
      altitude: 'L1',
      type: 'done',
      agent: 'estimator',
      model: 'unknown-model',
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        reasoningTokens: 0,
        cachedReadTokens: 0,
        cachedWriteTokens: 0,
        costUsd: 0,
        wallMs: 10,
      },
    }
    appendEvent(logPathFor(workDir, run.runId), event)
    const rows = await listSessions(workDir)
    expect(rows[0]?.costKnown).toBe(false)
  })
})
