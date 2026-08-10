// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { appendEvent, readEvents, replayEvents } from '../../sdd-runner/src/events.js'

const tmpDirs: string[] = []

function makeLog(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-events-'))
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

describe('appendEvent + readEvents', () => {
  it('round-trips an L1 lifecycle event, stamping seq and ts', () => {
    const log = makeLog()
    appendEvent(
      log,
      { altitude: 'L1', type: 'spawned', agent: 'drafter-1', role: 'drafter', model: 'test-model' },
      at('00'),
    )
    const events = readEvents(log)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      seq: 1,
      ts: '2026-08-10T10:00:00.000Z',
      altitude: 'L1',
      type: 'spawned',
      agent: 'drafter-1',
      role: 'drafter',
    })
  })

  it('assigns monotonically increasing seq across appends', () => {
    const log = makeLog()
    appendEvent(log, { altitude: 'L2', type: 'stage_enter', stage: 'intake' }, at('00'))
    appendEvent(log, { altitude: 'L2', type: 'stage_exit', stage: 'intake' }, at('01'))
    appendEvent(log, { altitude: 'L0', type: 'tool_use', agent: 'estimator-1', tool: 'code_search' }, at('02'))
    expect(readEvents(log).map((e) => e.seq)).toEqual([1, 2, 3])
  })

  it('rejects an invalid event at append time and writes nothing', () => {
    const log = makeLog()
    expect(() => appendEvent(log, JSON.parse('{"altitude":"L9","type":"spawned"}'), at('00'))).toThrow()
    expect(fs.existsSync(log)).toBe(false)
  })

  it('rejects a retrying event without a stall|validation reason', () => {
    const log = makeLog()
    const raw = '{"altitude":"L1","type":"retrying","agent":"drafter-1","reason":"vibes","attempt":1}'
    expect(() => appendEvent(log, JSON.parse(raw), at('00'))).toThrow()
  })

  it('throws naming the line when the log contains a corrupt entry', () => {
    const log = makeLog()
    appendEvent(log, { altitude: 'L2', type: 'stage_enter', stage: 'intake' }, at('00'))
    fs.appendFileSync(log, '{"altitude":"L2","type":"stage_enter"}\n')
    expect(() => readEvents(log)).toThrow(/line 2/u)
  })
})

describe('L2 semantic events', () => {
  it('accepts a depth-classified event with rationale and source', () => {
    const log = makeLog()
    appendEvent(
      log,
      { altitude: 'L2', type: 'depth', profile: 'S', rationale: 'single-file bugfix', source: 'override' },
      at('00'),
    )
    const [e] = readEvents(log)
    expect(e).toMatchObject({ type: 'depth', profile: 'S', source: 'override' })
  })

  it('accepts finding and convergence events with class counts', () => {
    const log = makeLog()
    appendEvent(
      log,
      { altitude: 'L2', type: 'finding', action: 'classified', id: 'F1', round: 1, class: 'BLOCKER' },
      at('00'),
    )
    appendEvent(
      log,
      {
        altitude: 'L2',
        type: 'convergence',
        round: 1,
        verdict: 'open',
        counts: { blocker: 1, material: 0, nitpick: 2 },
      },
      at('01'),
    )
    const events = readEvents(log)
    expect(events[1]).toMatchObject({ type: 'convergence', verdict: 'open', counts: { blocker: 1, nitpick: 2 } })
  })

  it('accepts a gate event with mode and version', () => {
    const log = makeLog()
    appendEvent(log, { altitude: 'L2', type: 'gate', action: 'presented', mode: 'early', version: 1 }, at('00'))
    expect(readEvents(log)[0]).toMatchObject({ type: 'gate', mode: 'early', version: 1 })
  })
})

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
})
