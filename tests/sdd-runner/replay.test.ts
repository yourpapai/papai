// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { appendEvent } from '../../sdd-runner/src/events.js'
import { createReplayFolder, replayEvents } from '../../sdd-runner/src/replay.js'

const tmpDirs: string[] = []

function makeLog(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-replay-'))
  tmpDirs.push(dir)
  return path.join(dir, 'events.ndjson')
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

const at = (s: string): Date => new Date(`2026-08-10T10:00:${s}.000Z`)

describe('replayEvents', () => {
  it('rebuilds stage map, current round, and gate state from the log alone', () => {
    const log = makeLog()
    const seq: Array<Parameters<typeof appendEvent>[1]> = [
      { altitude: 'L2', type: 'stage_enter', stage: 'intake' },
      { altitude: 'L2', type: 'depth', profile: 'M', rationale: 'multi-module', source: 'estimator' },
      { altitude: 'L2', type: 'stage_exit', stage: 'intake' },
      { altitude: 'L2', type: 'stage_enter', stage: 'draft' },
      { altitude: 'L2', type: 'stage_exit', stage: 'draft' },
      { altitude: 'L2', type: 'stage_enter', stage: 'review' },
      { altitude: 'L2', type: 'round_open', round: 1, cap: 3 },
      {
        altitude: 'L2',
        type: 'convergence',
        round: 1,
        verdict: 'open',
        counts: { blocker: 2, material: 1, nitpick: 0 },
      },
      { altitude: 'L2', type: 'round_close', round: 1, cap: 3 },
      { altitude: 'L2', type: 'round_open', round: 2, cap: 3 },
      {
        altitude: 'L2',
        type: 'convergence',
        round: 2,
        verdict: 'converged',
        counts: { blocker: 0, material: 0, nitpick: 1 },
      },
      { altitude: 'L2', type: 'round_close', round: 2, cap: 3 },
      { altitude: 'L2', type: 'stage_exit', stage: 'review' },
      { altitude: 'L2', type: 'stage_enter', stage: 'decompose' },
      { altitude: 'L2', type: 'stage_exit', stage: 'decompose' },
      { altitude: 'L2', type: 'stage_enter', stage: 'atomicity' },
      { altitude: 'L2', type: 'stage_exit', stage: 'atomicity' },
      { altitude: 'L2', type: 'stage_enter', stage: 'gate' },
      { altitude: 'L2', type: 'gate', action: 'presented', mode: 'final', version: 1 },
    ]
    seq.forEach((event, i) => {
      appendEvent(log, event, at(String(i).padStart(2, '0')))
    })
    const state = replayEvents(log)
    expect(state.stages).toEqual({
      intake: 'done',
      draft: 'done',
      review: 'done',
      decompose: 'done',
      atomicity: 'done',
      gate: 'active',
    })
    expect(state.depth).toBe('M')
    expect(state.round).toEqual({ current: 2, cap: 3 })
    expect(state.lastVerdict).toEqual({
      round: 2,
      verdict: 'converged',
      counts: { blocker: 0, material: 0, nitpick: 1 },
      resolved: 0,
      dismissed: 0,
    })
    expect(state.gate).toEqual({ mode: 'final', version: 1, answered: false })
  })

  it('marks the in-flight stage active and later stages pending', () => {
    const log = makeLog()
    appendEvent(log, { altitude: 'L2', type: 'stage_enter', stage: 'intake' }, at('00'))
    const state = replayEvents(log)
    expect(state.stages.intake).toBe('active')
    expect(state.stages.review).toBe('pending')
    expect(state.stages.gate).toBe('pending')
  })

  it('derives perRound DigestRecords and a full-shape lastVerdict from finding + convergence events', () => {
    const log = makeLog()
    const seq: Array<Parameters<typeof appendEvent>[1]> = [
      { altitude: 'L2', type: 'round_open', round: 1, cap: 3 },
      { altitude: 'L2', type: 'finding', action: 'classified', id: 'F1', round: 1, class: 'BLOCKER' },
      { altitude: 'L2', type: 'finding', action: 'classified', id: 'F2', round: 1, class: 'MATERIAL' },
      { altitude: 'L2', type: 'finding', action: 'resolved', id: 'F1', round: 1 },
      { altitude: 'L2', type: 'finding', action: 'dismissed', id: 'F2', round: 1 },
      {
        altitude: 'L2',
        type: 'convergence',
        round: 1,
        verdict: 'open',
        counts: { blocker: 1, material: 1, nitpick: 0 },
      },
      { altitude: 'L2', type: 'round_close', round: 1, cap: 3 },
    ]
    seq.forEach((event, i) => {
      appendEvent(log, event, at(String(i).padStart(2, '0')))
    })
    const state = replayEvents(log)
    const expected = {
      round: 1,
      counts: { blocker: 1, material: 1, nitpick: 0 },
      resolved: 1,
      dismissed: 1,
      verdict: 'open' as const,
    }
    expect(state.perRound).toHaveLength(1)
    expect(state.perRound[0]).toEqual(expected)
    expect(state.lastVerdict).toEqual(expected)
    expect(state.lastVerdict).toMatchObject({ resolved: 1, dismissed: 1 })
  })
})

describe('createReplayFolder', () => {
  it('folds events incrementally and exposes the current state', () => {
    const folder = createReplayFolder()
    expect(folder.state.stages.intake).toBe('pending')
    folder.fold({ altitude: 'L2', type: 'stage_enter', stage: 'intake' })
    expect(folder.state.stages.intake).toBe('active')
    folder.fold({
      altitude: 'L2',
      type: 'convergence',
      round: 1,
      verdict: 'converged',
      counts: { blocker: 0, material: 0, nitpick: 1 },
    })
    expect(folder.state.perRound).toHaveLength(1)
    expect(folder.state.lastVerdict).toMatchObject({ round: 1, verdict: 'converged' })
  })
})
