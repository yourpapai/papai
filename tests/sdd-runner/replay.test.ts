// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { appendEvent } from '../../sdd-runner/src/events.js'
import { createReplayFolder, initialReplayState, replayEvents } from '../../sdd-runner/src/replay.js'

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

describe('auto_decision fold', () => {
  it('replay alone rebuilds every auto-decision preview from the log', () => {
    const log = makeLog()
    appendEvent(
      log,
      { altitude: 'L2', type: 'auto_decision', rule: 'R1', decision: 'preview', evidenceDigest: 'd1', gateVersion: 1 },
      at('00'),
    )
    appendEvent(log, { altitude: 'L2', type: 'gate', action: 'presented', mode: 'final', version: 1 }, at('01'))
    appendEvent(
      log,
      {
        altitude: 'L2',
        type: 'auto_decision',
        rule: 'R2',
        decision: 'extend',
        evidenceDigest: 'd2',
        gateVersion: 2,
      },
      at('02'),
    )
    const state = replayEvents(log)
    expect(state.autoDecisions).toHaveLength(2)
    expect(state.autoDecisions[0]).toEqual({
      rule: 'R1',
      decision: 'preview',
      evidenceDigest: 'd1',
      gateVersion: 1,
      seq: 1,
      ts: '2026-08-10T10:00:00.000Z',
    })
    expect(state.autoDecisions[1]).toMatchObject({ rule: 'R2', decision: 'extend', gateVersion: 2 })
  })

  it('initial replay state carries an empty autoDecisions list', () => {
    const log = makeLogNoWrite()
    fs.writeFileSync(log, '')
    expect(replayEvents(log).autoDecisions).toEqual([])
    expect(createReplayFolder().state.autoDecisions).toEqual([])
  })

  it('folds auto_decision through createReplayFolder incrementally', () => {
    const folder = createReplayFolder()
    folder.fold({
      altitude: 'L2',
      type: 'auto_decision',
      rule: 'none',
      decision: 'gate',
      evidenceDigest: 'd',
      gateVersion: 3,
    })
    expect(folder.state.autoDecisions).toHaveLength(1)
    expect(folder.state.autoDecisions[0]).toMatchObject({ rule: 'none', decision: 'gate', gateVersion: 3 })
  })
})

describe('children fold (3.3)', () => {
  it('pre-change logs fold to today\u2019s state plus an empty children field', () => {
    const log = makeLog()
    appendEvent(log, { altitude: 'L2', type: 'stage_enter', stage: 'intake' }, at('00'))
    appendEvent(log, { altitude: 'L2', type: 'depth', profile: 'S', rationale: 'typo', source: 'override' }, at('01'))
    appendEvent(log, { altitude: 'L2', type: 'gate', action: 'presented', mode: 'final', version: 1 }, at('02'))
    const state = replayEvents(log)
    expect(state.children).toEqual({})
    expect(initialReplayState().children).toEqual({})
    expect(createReplayFolder().state.children).toEqual({})
  })

  it('the plan event seeds the fresh child list — a replan resets every child to pending', () => {
    const log = makeLog()
    appendEvent(log, { altitude: 'L2', type: 'plan', childCount: 2, digest: 'aaaa' }, at('00'))
    appendEvent(log, { altitude: 'L2', type: 'child_spawned', child: 'alpha' }, at('01'))
    appendEvent(log, { altitude: 'L2', type: 'child_done', child: 'alpha', outcome: 'done' }, at('02'))
    expect(replayEvents(log).children).toEqual({ alpha: { status: 'done' } })
    appendEvent(log, { altitude: 'L2', type: 'plan', childCount: 2, digest: 'bbbb' }, at('03'))
    expect(replayEvents(log).children).toEqual({})
  })

  it('child_spawned and child_done transition per-child status', () => {
    const log = makeLog()
    appendEvent(log, { altitude: 'L2', type: 'plan', childCount: 3, digest: 'aaaa' }, at('00'))
    appendEvent(log, { altitude: 'L2', type: 'child_spawned', child: 'alpha' }, at('01'))
    const seeded = replayEvents(log)
    expect(seeded.children).toEqual({ alpha: { status: 'running' } })
    appendEvent(log, { altitude: 'L2', type: 'child_spawned', child: 'beta' }, at('02'))
    appendEvent(log, { altitude: 'L2', type: 'child_done', child: 'alpha', outcome: 'done' }, at('03'))
    appendEvent(log, { altitude: 'L2', type: 'child_done', child: 'beta', outcome: 'failed' }, at('04'))
    expect(replayEvents(log).children).toEqual({
      alpha: { status: 'done' },
      beta: { status: 'failed' },
    })
  })

  it('a first mention of an unseeded child id creates its entry rather than erroring', () => {
    const log = makeLog()
    appendEvent(log, { altitude: 'L2', type: 'child_spawned', child: 'gamma' }, at('00'))
    appendEvent(log, { altitude: 'L2', type: 'child_done', child: 'delta', outcome: 'failed' }, at('01'))
    expect(replayEvents(log).children).toEqual({ gamma: { status: 'running' }, delta: { status: 'failed' } })
  })

  it('folds the child events incrementally through createReplayFolder', () => {
    const folder = createReplayFolder()
    folder.fold({ altitude: 'L2', type: 'plan', childCount: 1, digest: 'aaaa' })
    expect(folder.state.children).toEqual({})
    folder.fold({ altitude: 'L2', type: 'child_spawned', child: 'alpha' })
    expect(folder.state.children).toEqual({ alpha: { status: 'running' } })
    folder.fold({ altitude: 'L2', type: 'child_done', child: 'alpha', outcome: 'done' })
    expect(folder.state.children).toEqual({ alpha: { status: 'done' } })
  })
})

describe('concerns fold (loop-memory D5)', () => {
  it('the finding event schema accepts and preserves an optional fingerprint', () => {
    const log = makeLog()
    const stamped = appendEvent(
      log,
      {
        altitude: 'L2',
        type: 'finding',
        action: 'classified',
        id: 'F1',
        round: 1,
        class: 'MATERIAL',
        fingerprint: 'fp-a',
      },
      at('00'),
    )
    expect(stamped).toMatchObject({ type: 'finding', fingerprint: 'fp-a' })
  })

  it('folds per-fingerprint concern history from fingerprinted finding events', () => {
    const log = makeLog()
    appendEvent(
      log,
      {
        altitude: 'L2',
        type: 'finding',
        action: 'classified',
        id: 'F2',
        round: 1,
        class: 'MATERIAL',
        fingerprint: 'fp-a',
      },
      at('00'),
    )
    appendEvent(
      log,
      {
        altitude: 'L2',
        type: 'finding',
        action: 'resolved',
        id: 'F2',
        round: 1,
        class: 'MATERIAL',
        fingerprint: 'fp-a',
      },
      at('01'),
    )
    appendEvent(
      log,
      {
        altitude: 'L2',
        type: 'finding',
        action: 'classified',
        id: 'S1',
        round: 2,
        class: 'MATERIAL',
        fingerprint: 'fp-a',
      },
      at('02'),
    )
    appendEvent(
      log,
      {
        altitude: 'L2',
        type: 'finding',
        action: 'classified',
        id: 'F9',
        round: 2,
        class: 'NITPICK',
        fingerprint: 'fp-b',
      },
      at('03'),
    )
    const state = replayEvents(log)
    expect(state.concerns).toMatchObject({
      'fp-a': {
        entries: [
          { round: 1, id: 'F2', class: 'MATERIAL', action: 'classified' },
          { round: 1, id: 'F2', class: 'MATERIAL', action: 'resolved' },
          { round: 2, id: 'S1', class: 'MATERIAL', action: 'classified' },
        ],
      },
      'fp-b': { entries: [{ round: 2, id: 'F9', class: 'NITPICK', action: 'classified' }] },
    })
  })

  it('folds pre-change logs to empty concerns without touching any other fold', () => {
    const log = makeLog()
    appendEvent(
      log,
      { altitude: 'L2', type: 'finding', action: 'classified', id: 'F2', round: 1, class: 'MATERIAL' },
      at('00'),
    )
    appendEvent(
      log,
      { altitude: 'L2', type: 'finding', action: 'resolved', id: 'F2', round: 1, class: 'NITPICK' },
      at('01'),
    )
    appendEvent(
      log,
      {
        altitude: 'L2',
        type: 'convergence',
        round: 1,
        verdict: 'converged',
        counts: { blocker: 0, material: 0, nitpick: 1 },
      },
      at('02'),
    )
    const state = replayEvents(log)
    expect(state.concerns).toEqual({})
    expect(state.perRound).toEqual([
      { round: 1, counts: { blocker: 0, material: 0, nitpick: 1 }, resolved: 1, dismissed: 0, verdict: 'converged' },
    ])
  })
})

function makeLogNoWrite(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-replay-empty-'))
  tmpDirs.push(dir)
  return path.join(dir, 'events.ndjson')
}
