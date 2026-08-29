// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'

import { appendEvent, stampEvent } from '../../afk-runner/src/events.js'
import type { EventInput, SddEvent } from '../../afk-runner/src/events.js'
import { pipelineMachine } from '../../afk-runner/src/graph/pipeline.js'
import { foldEvents } from '../../afk-runner/src/kernel/fold.js'
import { memoFieldsOf } from '../../afk-runner/src/memo-project.js'
import { resumeRun, startRun } from '../../afk-runner/src/run.js'
import { makeFakePipeline, TASK_TEXT } from './fixtures/fake-pipeline.js'

const STAMP = new Date('2026-08-29T00:00:00.000Z')

function stampAll(inputs: readonly EventInput[]): SddEvent[] {
  return inputs.map((input, index) => stampEvent(input, index + 1, '2026-08-29T00:00:00.000Z'))
}

/** Memo projection over stamped inputs, with the fold's own position and terminal halt. */
function memoOf(inputs: readonly EventInput[]): ReturnType<typeof memoFieldsOf> {
  const events = stampAll(inputs)
  const snapshot = foldEvents(pipelineMachine, events).snapshot
  const position = typeof snapshot.value === 'string' ? snapshot.value : Object.values(snapshot.value).join('.')
  return memoFieldsOf(events, snapshot.context, 'final', position)
}

describe('memoFieldsOf — the failed status is failure-caused terminal (C6 D8)', () => {
  const WALK: readonly EventInput[] = [
    { altitude: 'L2', type: 'stage_enter', stage: 'intake' },
    { altitude: 'L2', type: 'depth', profile: 'S', rationale: 'r', source: 'estimator' },
    { altitude: 'L2', type: 'stage_exit', stage: 'intake' },
    { altitude: 'L2', type: 'stage_enter', stage: 'draft' },
    { altitude: 'L2', type: 'stage_exit', stage: 'draft' },
    { altitude: 'L2', type: 'stage_enter', stage: 'review' },
    { altitude: 'L2', type: 'stage_failed', stage: 'review', kind: 'exhausted', reason: 'r' },
    { altitude: 'L2', type: 'stage_failed', stage: 'review', kind: 'exhausted', reason: 'r' },
    { altitude: 'L2', type: 'gate', action: 'presented', mode: 'escalation', version: 1 },
    { altitude: 'L2', type: 'auto_decision', rule: 'none', decision: 'gate', evidenceDigest: 'x', gateVersion: 1 },
  ]

  it('an abort settled at an escalation gate memos as failed', () => {
    const memo = memoOf([
      ...WALK,
      { altitude: 'L2', type: 'gate', action: 'answered', mode: 'escalation', version: 1, outcome: 'abort' },
    ])
    expect(memo.status).toBe('failed')
  })

  it('every other abort memos as aborted — final gates, historical shapes, operator run_abort', () => {
    const finalAbort = memoOf([
      ...WALK,
      { altitude: 'L2', type: 'gate', action: 'presented', mode: 'final', version: 1 },
      { altitude: 'L2', type: 'gate', action: 'answered', mode: 'final', version: 1, outcome: 'abort' },
    ])
    expect(finalAbort.status).toBe('aborted')
  })

  it('an escalation park memos running with the escalation gate record', () => {
    const events = stampAll(WALK)
    const snapshot = foldEvents(pipelineMachine, events).snapshot
    const memo = memoFieldsOf(events, snapshot.context, 'gate-pending', 'gate.awaiting')
    expect(memo.status).toBe('running')
    expect(memo.gate).toEqual({ mode: 'escalation', version: 1 })
  })
})

describe('every drive exit path writes an honest memo (C6 D8)', () => {
  it('a failure-driven park writes running + the escalation gate — no stale copy', async () => {
    const invalid = JSON.stringify({ findings: [{ id: 'F1' }] })
    const pipeline = makeFakePipeline({
      sidecarSequences: {
        // four invalid writes = two agent-layer exhaustions = two declared
        // failures = the escalation park
        'findings-1.json': [invalid, invalid, invalid, invalid, invalid, invalid],
      },
    })
    const result = await startRun(pipeline.deps, { taskText: TASK_TEXT })
    expect(result.halted).toBe('gate-pending')
    const runDir = pipeline.runDirOf(result.runId)
    const memo = JSON.parse(fs.readFileSync(path.join(runDir, 'state.json'), 'utf8'))
    expect(memo.status).toBe('running')
    expect(memo.gate).toEqual({ mode: 'escalation', version: 1 })
    const events = fs.readFileSync(path.join(runDir, 'events.ndjson'), 'utf8')
    expect(events).toContain('"stage_failed"')
  })

  it('aborting the parked escalation gate memos failed on resume', async () => {
    const invalid = JSON.stringify({ findings: [{ id: 'F1' }] })
    const pipeline = makeFakePipeline({
      sidecarSequences: { 'findings-1.json': [invalid, invalid, invalid, invalid, invalid, invalid] },
    })
    const started = await startRun(pipeline.deps, { taskText: TASK_TEXT })
    const runDir = pipeline.runDirOf(started.runId)
    const logPath = path.join(runDir, 'events.ndjson')

    // the watcher answers abort through the seam-equivalent event shape
    appendEvent(
      logPath,
      { altitude: 'L2', type: 'gate', action: 'answered', mode: 'escalation', version: 1, outcome: 'abort' },
      STAMP,
    )

    const resumed = await resumeRun(pipeline.deps, started.runId)
    expect(resumed.halted).toBe('final')
    expect(resumed.position).toBe('aborted')
    const memo = JSON.parse(fs.readFileSync(path.join(runDir, 'state.json'), 'utf8'))
    expect(memo.status).toBe('failed')
  })
})
