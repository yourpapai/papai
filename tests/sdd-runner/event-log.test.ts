// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { appendEvent, readEvents, stampEvent } from '../../sdd-runner/src/event-log.js'

const tmpDirs: string[] = []

function makeLog(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-event-log-'))
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

  it('throws naming the line when the log contains a corrupt entry', () => {
    const log = makeLog()
    appendEvent(log, { altitude: 'L2', type: 'stage_enter', stage: 'intake' }, at('00'))
    fs.appendFileSync(log, '{"altitude":"L2","type":"stage_enter"}\n')
    expect(() => readEvents(log)).toThrow(/line 2/u)
  })
})

describe('stampEvent', () => {
  it('validates an event input and attaches stamp fields without touching disk', () => {
    const stamped = stampEvent(
      { altitude: 'L2', type: 'plan', childCount: 2, digest: 'feedface' },
      4,
      '2026-08-10T10:00:00.000Z',
    )
    expect(stamped).toMatchObject({ seq: 4, ts: '2026-08-10T10:00:00.000Z', type: 'plan', childCount: 2 })
    expect(() => stampEvent({ altitude: 'L2', type: 'plan', childCount: -1, digest: 'x' }, 5, 't')).toThrow()
  })
})
