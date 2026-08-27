// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'

import { readEvents } from '../../../afk-runner/src/events.js'
import { resumeRun, startRun, statusRun } from '../../../afk-runner/src/run.js'
import { BLOCKER_ROUND, TASK_TEXT, makeFakePipeline } from '../fixtures/fake-pipeline.js'

describe('state.json is a derived memo, never truth (design D6)', () => {
  it('a converged run parks awaiting-tail and writes the memo from the fold', async () => {
    const pipeline = makeFakePipeline()
    const result = await startRun(pipeline.deps, { taskText: TASK_TEXT })
    expect(result.halted).toBe('awaiting-tail')
    expect(result.position).toBe('review')
    const runDir = pipeline.runDirOf(result.runId)
    const memoPath = path.join(runDir, 'state.json')
    expect(fs.existsSync(memoPath)).toBe(true)
    const memo: Record<string, unknown> = JSON.parse(fs.readFileSync(memoPath, 'utf8'))
    expect(memo['depth']).toBe('S')
    expect(memo['round']).toBe(1)
    expect(memo['gate']).toBeNull()
    expect(memo['status']).toBe('running')
    const types = readEvents(path.join(runDir, 'events.ndjson')).map((event) => event.type)
    expect(types).toContain('stage_enter')
    expect(types).toContain('convergence')
  })

  it('deleting the memo changes nothing: status and resume behave identically', async () => {
    const pipeline = makeFakePipeline()
    const started = await startRun(pipeline.deps, { taskText: TASK_TEXT })
    const runDir = pipeline.runDirOf(started.runId)

    const statusWithMemo = await statusRun(pipeline.deps, started.runId)
    const resumeWithMemo = await resumeRun(pipeline.deps, started.runId)
    const memoBody = fs.readFileSync(path.join(runDir, 'state.json'), 'utf8')

    fs.rmSync(path.join(runDir, 'state.json'))
    const statusWithout = await statusRun(pipeline.deps, started.runId)
    const resumeWithout = await resumeRun(pipeline.deps, started.runId)

    expect(statusWithout.position).toBe(statusWithMemo.position)
    expect(statusWithout.parked).toBe(statusWithMemo.parked)
    expect(statusWithout.context).toEqual(statusWithMemo.context)
    expect(resumeWithout).toEqual(resumeWithMemo)
    expect(resumeWithout).toMatchObject({ halted: 'awaiting-tail', drove: false })

    // the resume rewrote the memo from the fold — identical body
    expect(fs.readFileSync(path.join(runDir, 'state.json'), 'utf8')).toBe(memoBody)
  })

  it('a stale memo is overwritten from the fold on the next status/resume', async () => {
    const pipeline = makeFakePipeline()
    const started = await startRun(pipeline.deps, { taskText: TASK_TEXT })
    const runDir = pipeline.runDirOf(started.runId)
    const memoPath = path.join(runDir, 'state.json')
    const stale: Record<string, unknown> = JSON.parse(fs.readFileSync(memoPath, 'utf8'))
    stale['depth'] = 'L'
    stale['round'] = 99
    fs.writeFileSync(memoPath, JSON.stringify(stale))

    const status = await statusRun(pipeline.deps, started.runId)
    expect(status.context.depth).toBe('S')
    await resumeRun(pipeline.deps, started.runId)
    const rewritten: Record<string, unknown> = JSON.parse(fs.readFileSync(memoPath, 'utf8'))
    expect(rewritten['depth']).toBe('S')
    expect(rewritten['round']).toBe(1)
  })

  it('a cap-hit run records the presented gate in memo and log, parks gate-pending', async () => {
    const pipeline = makeFakePipeline({ sidecarOverrides: BLOCKER_ROUND })
    const result = await startRun(pipeline.deps, { taskText: TASK_TEXT })
    expect(result.halted).toBe('gate-pending')
    const runDir = pipeline.runDirOf(result.runId)
    const memo: Record<string, unknown> = JSON.parse(fs.readFileSync(path.join(runDir, 'state.json'), 'utf8'))
    expect(memo['gate']).toEqual({ mode: 'early', version: 1 })
    const gateEvents = readEvents(path.join(runDir, 'events.ndjson')).filter((event) => event.type === 'gate')
    expect(gateEvents).toHaveLength(1)
    expect(gateEvents[0]).toMatchObject({ action: 'presented', mode: 'early', version: 1 })

    fs.rmSync(path.join(runDir, 'state.json'))
    const resumed = await resumeRun(pipeline.deps, result.runId)
    expect(resumed).toMatchObject({ halted: 'gate-pending', drove: false })
  })
})
