// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'

import { appendEvent, readEvents } from '../../afk-runner/src/events.js'
import type { EventInput } from '../../afk-runner/src/events.js'
import { resumeRun } from '../../afk-runner/src/run-resume.js'
import { createRunState, PersistedRunStateSchema } from '../../afk-runner/src/run-state.js'
import type { PersistedRunState } from '../../afk-runner/src/run-state.js'
import { startRun } from '../../afk-runner/src/run.js'
import { makeFakePipeline, TASK_TEXT } from './fixtures/fake-pipeline.js'

function memoOf(runDir: string): PersistedRunState {
  return PersistedRunStateSchema.parse(JSON.parse(fs.readFileSync(path.join(runDir, 'state.json'), 'utf8')))
}

/** A parked final gate (presented, ladder logged, tail bracket closed) as a hand-seeded log. */
function seedParkedFinalGate(): { readonly pipeline: ReturnType<typeof makeFakePipeline>; readonly runId: string } {
  const pipeline = makeFakePipeline()
  const runId = 'add-thing'
  const runDir = pipeline.runDirOf(runId)
  fs.mkdirSync(runDir, { recursive: true })
  fs.writeFileSync(path.join(runDir, 'task.md'), TASK_TEXT)
  const logPath = path.join(runDir, 'events.ndjson')
  const events: EventInput[] = [
    { altitude: 'L2', type: 'stage_enter', stage: 'intake' },
    { altitude: 'L2', type: 'depth', profile: 'M', rationale: 'two modules', source: 'estimator' },
    { altitude: 'L2', type: 'stage_exit', stage: 'intake' },
    { altitude: 'L2', type: 'stage_enter', stage: 'draft' },
    { altitude: 'L2', type: 'stage_exit', stage: 'draft' },
    { altitude: 'L2', type: 'stage_enter', stage: 'review' },
    { altitude: 'L2', type: 'round_open', round: 1, cap: 3 },
    {
      altitude: 'L2',
      type: 'convergence',
      round: 1,
      verdict: 'converged',
      counts: { blocker: 0, material: 0, nitpick: 0 },
    },
    { altitude: 'L2', type: 'round_close', round: 1, cap: 3 },
    { altitude: 'L2', type: 'stage_exit', stage: 'review' },
    { altitude: 'L2', type: 'stage_enter', stage: 'decompose' },
    { altitude: 'L2', type: 'stage_exit', stage: 'decompose' },
    { altitude: 'L2', type: 'stage_enter', stage: 'atomicity' },
    { altitude: 'L2', type: 'stage_enter', stage: 'gate' },
    { altitude: 'L2', type: 'gate', action: 'presented', mode: 'final', version: 1 },
    { altitude: 'L2', type: 'auto_decision', rule: 'none', decision: 'gate', evidenceDigest: 'x', gateVersion: 1 },
    { altitude: 'L2', type: 'stage_exit', stage: 'atomicity' },
  ]
  for (const event of events) appendEvent(logPath, event)
  return { pipeline, runId }
}

describe('finals end the run cleanly (C5 D6)', () => {
  it('a final-approve run parks final, the memo says completed, and the session id is released', async () => {
    const pipeline = makeFakePipeline()
    const result = await startRun(pipeline.deps, { taskText: TASK_TEXT })
    expect(result.halted).toBe('final')
    expect(result.position).toBe('completed')
    const memo = memoOf(pipeline.runDirOf(result.runId))
    expect(memo['status']).toBe('completed')

    // TERMINAL_STATUSES releases the slug family: a new run of the same
    // change name allocates the next suffix past the terminal holder
    // instead of being refused.
    const state = await createRunState({
      workDir: pipeline.workDir,
      repoRoot: pipeline.repoRoot,
      changeName: pipeline.changeName,
    })
    expect(state.runId).toBe('add-thing-2')
  })

  it('an aborted run parks final at the aborted position and the memo says aborted', async () => {
    const h = seedParkedFinalGate()
    const logPath = path.join(h.pipeline.runDirOf(h.runId), 'events.ndjson')
    appendEvent(logPath, {
      altitude: 'L2',
      type: 'gate',
      action: 'answered',
      mode: 'final',
      version: 1,
      outcome: 'abort',
    })

    const resumed = await resumeRun(h.pipeline.deps, h.runId)

    expect(resumed.halted).toBe('final')
    expect(resumed.position).toBe('aborted')
    expect(memoOf(h.pipeline.runDirOf(h.runId))['status']).toBe('aborted')
  })

  it('resume of a terminal run prints the report pointer and appends exactly its one resume event', async () => {
    const pipeline = makeFakePipeline()
    const started = await startRun(pipeline.deps, { taskText: TASK_TEXT })
    const runDir = pipeline.runDirOf(started.runId)
    const logPath = path.join(runDir, 'events.ndjson')
    const before = readEvents(logPath).length

    const resumed = await resumeRun(pipeline.deps, started.runId)

    expect(resumed).toMatchObject({ halted: 'final', position: 'completed', drove: false })
    // per-invocation honesty (log-fidelity D3): one resume event, nothing else
    const appended = readEvents(logPath).slice(before)
    expect(appended).toHaveLength(1)
    expect(appended[0]).toMatchObject({ type: 'resume', path: 'artifact-skip', stage: 'gate' })
    expect(pipeline.stdoutLines.some((line: string) => line.includes('afk-runner report'))).toBe(true)
  })
})
