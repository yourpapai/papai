// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { createAppendBoundary } from '../../../afk-runner/src/drive/boundary.js'
import { appendEvent } from '../../../afk-runner/src/events.js'
import { readEvents } from '../../../afk-runner/src/events.js'
import { pipelineMachine } from '../../../afk-runner/src/graph/pipeline.js'
import { foldLog } from '../../../afk-runner/src/kernel/fold.js'
import { initialStep, step } from '../../../afk-runner/src/kernel/machine.js'

function tempLogPath(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), 'afk-boundary-')), 'events.ndjson')
}

/** Fold the pipeline machine to the review position with real enter events. */
function logAtReview(logPath: string): void {
  for (const stage of ['intake', 'draft', 'review'] as const) {
    appendEvent(logPath, { altitude: 'L2', type: 'stage_enter', stage })
  }
}

describe('append boundary — pure transition probe', () => {
  it('appends legal events and moves the fold', () => {
    const logPath = tempLogPath()
    const boundary = createAppendBoundary(pipelineMachine, logPath)
    const stamped = boundary.append({ altitude: 'L2', type: 'stage_enter', stage: 'intake' })
    expect(stamped.seq).toBe(1)
    expect(foldLog(pipelineMachine, logPath).snapshot.value).toBe('intake')
  })

  it('refuses an illegal stage enter: nothing appended, error names the refused event', () => {
    const logPath = tempLogPath()
    logAtReview(logPath)
    const before = readEvents(logPath)
    const beforeFold = foldLog(pipelineMachine, logPath).snapshot
    const boundary = createAppendBoundary(pipelineMachine, logPath)
    expect(() => boundary.append({ altitude: 'L2', type: 'stage_enter', stage: 'draft' })).toThrow(
      /stage_enter.*draft/u,
    )
    expect(readEvents(logPath)).toEqual(before)
    const afterFold = foldLog(pipelineMachine, logPath).snapshot
    expect(afterFold.context).toEqual(beforeFold.context)
    expect(afterFold.value).toBe(beforeFold.value)
  })

  it('passes the legal review self-loop re-entry (snapshot-reference probe)', () => {
    const logPath = tempLogPath()
    logAtReview(logPath)
    const boundary = createAppendBoundary(pipelineMachine, logPath)
    const stamped = boundary.append({ altitude: 'L2', type: 'stage_enter', stage: 'review' })
    expect(stamped.type).toBe('stage_enter')
    const folded = foldLog(pipelineMachine, logPath).snapshot
    expect(folded.value).toBe('review')
    expect(folded.context.stages['review']).toBe('active')
  })

  it('refuses an enter for which the probe returns the identical snapshot with zero actions', () => {
    const logPath = tempLogPath()
    logAtReview(logPath)
    const boundary = createAppendBoundary(pipelineMachine, logPath)
    expect(() => boundary.append({ altitude: 'L2', type: 'stage_enter', stage: 'intake' })).toThrow(/refused/u)
  })

  it('domain bookkeeping events append without a probe (always root-legal)', () => {
    const logPath = tempLogPath()
    logAtReview(logPath)
    const boundary = createAppendBoundary(pipelineMachine, logPath)
    boundary.append({ altitude: 'L2', type: 'round_open', round: 1, cap: 3 })
    boundary.append({ altitude: 'L2', type: 'finding', action: 'resolved', id: 'F1', round: 1 })
    const folded = foldLog(pipelineMachine, logPath).snapshot
    expect(folded.context.round).toEqual({ current: 1, cap: 3 })
    expect(folded.context.tally).toEqual({ 1: { resolved: 1, dismissed: 0 } })
  })

  it('the probe agrees with the machine step: identical reference plus zero actions means refused', () => {
    const logPath = tempLogPath()
    logAtReview(logPath)
    const snapshot = foldLog(pipelineMachine, logPath).snapshot
    const [next, actions] = step(pipelineMachine, snapshot, { type: 'stage.enter', stage: 'draft' })
    expect(next === snapshot).toBe(true)
    expect(actions.length).toBe(0)
    const [selfNext, selfActions] = step(pipelineMachine, snapshot, { type: 'stage.enter', stage: 'review' })
    expect(selfNext === snapshot).toBe(false)
    expect(initialStep(pipelineMachine)[0].value).toBe('start')
    expect(selfActions.length).toBe(0)
  })
})
