// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { appendEvent, readEvents } from '../../afk-runner/src/events.js'
import type { EventInput } from '../../afk-runner/src/events.js'

const STAMP = new Date('2026-08-29T00:00:00.000Z')

const EVENTS: readonly EventInput[] = [
  { altitude: 'L2', type: 'stage_enter', stage: 'intake' },
  { altitude: 'L2', type: 'depth', profile: 'S', rationale: 'r', source: 'estimator' },
  { altitude: 'L2', type: 'stage_exit', stage: 'intake' },
]

function writeLog(tail: string): string {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-torn-'))
  const logPath = path.join(runDir, 'events.ndjson')
  for (const event of EVENTS) appendEvent(logPath, event, STAMP)
  if (tail.length > 0) fs.appendFileSync(logPath, tail)
  return logPath
}

function readWithSink(logPath: string): { events: ReturnType<typeof readEvents>; warnings: string[] } {
  const warnings: string[] = []
  const events = readEvents(logPath, (line) => {
    warnings.push(line)
  })
  return { events, warnings }
}

describe('readEvents — torn-tail tolerance (C6 D10)', () => {
  it('a clean log reads unchanged with no warning', () => {
    const { events, warnings } = readWithSink(writeLog(''))
    expect(events).toHaveLength(3)
    expect(warnings).toEqual([])
  })

  it('a malformed final line is tolerated as absent with a warning', () => {
    const logPath = writeLog('{"altitude":"L2","type":"stage_')
    const { events, warnings } = readWithSink(logPath)
    expect(events).toHaveLength(3)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('torn tail')
  })

  it('a schema-invalid final line (valid JSON, unknown event) is tolerated as absent', () => {
    const logPath = writeLog('{"altitude":"L9","type":"warp","seq":4}\n')
    const { events, warnings } = readWithSink(logPath)
    expect(events).toHaveLength(3)
    expect(warnings).toHaveLength(1)
  })

  it('a malformed interior line throws, naming the line', () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-torn-'))
    const logPath = path.join(runDir, 'events.ndjson')
    for (const event of EVENTS) appendEvent(logPath, event, STAMP)
    const lines = fs.readFileSync(logPath, 'utf8').split('\n')
    const corrupted = [...lines.slice(0, 2), '{"broken":', ...lines.slice(2)].join('\n')
    fs.writeFileSync(logPath, corrupted)
    expect(() => readEvents(logPath)).toThrow('events.ndjson line 3')
  })

  it('two malformed trailing lines throw — only ONE final line is tolerable', () => {
    const logPath = writeLog('{"broken":\n{"also":"broke')
    expect(() => readEvents(logPath)).toThrow('events.ndjson line 4')
  })
})
