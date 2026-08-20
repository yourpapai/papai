// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { appendEvent } from '../../sdd-runner/src/events.js'
import type { EventInput } from '../../sdd-runner/src/events.js'
import { createRunState } from '../../sdd-runner/src/run-state.js'
import { createWatcher, isIdleExit } from '../../sdd-runner/src/watch.js'

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-watch-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

const at = (s: string): Date => new Date(`2026-08-10T10:00:${s}.000Z`)

async function seedRun(status: 'running' | 'completed' = 'running'): Promise<{ workDir: string; runId: string }> {
  const workDir = path.join(makeDir(), '.sdd-runner')
  const state = await createRunState({ workDir, repoRoot: workDir, changeName: 'thing' })
  const logPath = path.join(state.runDir, 'events.ndjson')
  appendEvent(logPath, { altitude: 'L2', type: 'stage_enter', stage: 'review' }, at('00'))
  appendEvent(logPath, { altitude: 'L2', type: 'round_open', round: 1, cap: 3 }, at('01'))
  if (status !== 'running') {
    fs.writeFileSync(state.statePath, fs.readFileSync(state.statePath, 'utf8').replace('"running"', `"${status}"`))
  }
  return { workDir, runId: state.runId }
}

describe('createWatcher (15.3)', () => {
  it('replays the existing log exactly once, then folds only bytes past the offset', async () => {
    const { workDir, runId } = await seedRun()
    const watcher = createWatcher(workDir, runId)
    const first = await watcher.replay()
    expect(first.state.round).toEqual({ current: 1, cap: 3 })

    // An event appended between replay and first poll folds exactly once.
    const logPath = path.join(workDir, 'runs', runId, 'events.ndjson')
    appendEvent(logPath, {
      altitude: 'L2',
      type: 'finding',
      action: 'filed',
      id: 'F1',
      round: 1,
      class: 'MATERIAL',
    } as EventInput)
    const second = await watcher.poll()
    expect(second.state.autoDecisions).toEqual([])
    expect(second.findings).toHaveLength(1)
    const third = await watcher.poll()
    expect(third.findings).toHaveLength(1)
  })

  it('exits when the run reaches a terminal status (polled read-only)', async () => {
    const { workDir, runId } = await seedRun('completed')
    const watcher = createWatcher(workDir, runId)
    await watcher.replay()
    const frame = await watcher.poll()
    expect(frame.done).toBe(true)
  })

  it('rejects run ids containing path separators (path-traversal safety)', async () => {
    const { workDir } = await seedRun()
    expect(() => createWatcher(workDir, '../evil')).toThrow(/path separator/u)
    expect(() => createWatcher(workDir, 'sub/dir')).toThrow(/path separator/u)
  })

  it('watch is read-only: no writes to the run dir', async () => {
    const { workDir, runId } = await seedRun()
    const runDir = path.join(workDir, 'runs', runId)
    const before = fs.readdirSync(runDir).sort()
    const watcher = createWatcher(workDir, runId)
    await watcher.replay()
    await watcher.poll()
    const after = fs.readdirSync(runDir).sort()
    expect(after).toEqual(before)
  })
})

describe('idle-exit accounting (15.3)', () => {
  it('reports idle after 60s with no new events on a terminal log', () => {
    expect(isIdleExit({ lastEventAt: 1_000, now: 61_500, terminal: true })).toBe(true)
    expect(isIdleExit({ lastEventAt: 1_000, now: 30_000, terminal: true })).toBe(false)
    expect(isIdleExit({ lastEventAt: 1_000, now: 61_500, terminal: false })).toBe(false)
  })
})
