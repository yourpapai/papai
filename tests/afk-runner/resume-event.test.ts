// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'

import { readEvents } from '../../afk-runner/src/events.js'
import type { SddEvent } from '../../afk-runner/src/events.js'
import { resumeRun } from '../../afk-runner/src/run-resume.js'
import { startRun } from '../../afk-runner/src/run.js'
import { BLOCKER_ROUND, M_MULTI_ROUND, TASK_TEXT, makeFakePipeline } from './fixtures/fake-pipeline.js'

function resumeEvents(events: readonly SddEvent[]): SddEvent[] {
  return events.filter((event) => event.type === 'resume')
}

function isStageEnter(event: SddEvent, stage: string): boolean {
  return event.type === 'stage_enter' && event.stage === stage
}

function isGateOf(event: SddEvent, action: 'presented' | 'answered'): boolean {
  return event.type === 'gate' && event.action === action
}

/** A crash predicate that fires exactly once on the given output basename, then lets the resume proceed. */
function killOnceOn(basename: string): (candidate: string) => boolean {
  let fired = false
  return (candidate: string): boolean => {
    if (fired || candidate !== basename) return false
    fired = true
    return true
  }
}

/** A session-id seam reporting an id for exactly one basename (the in-flight ledger line of the drill). */
function sessionOnlyFor(basename: string, sessionId: string): (candidate: string) => string | undefined {
  return (candidate: string): string | undefined => (candidate === basename ? sessionId : undefined)
}

/** The first run id under a fake pipeline's work dir. */
function firstRunOf(pipeline: ReturnType<typeof makeFakePipeline>): string {
  const entries = fs.readdirSync(path.join(pipeline.workDir, 'runs'))
  return entries[0] ?? ''
}

interface RunHandle {
  readonly pipeline: ReturnType<typeof makeFakePipeline>
  readonly runId: string
  readonly runDir: string
  readonly logPath: string
}

function handleOf(pipeline: ReturnType<typeof makeFakePipeline>, runId: string): RunHandle {
  const runDir = pipeline.runDirOf(runId)
  return { pipeline, runId, runDir, logPath: path.join(runDir, 'events.ndjson') }
}

/** Rewrite the log to the given prefix (the in-process kill -9: only the log truncates). */
function truncateLog(logPath: string, keep: readonly SddEvent[]): void {
  fs.writeFileSync(logPath, `${keep.map((event) => JSON.stringify(event)).join('\n')}\n`)
}

describe('resume event producer — one log-visible resume per invocation (log-fidelity D3/D4/D5)', () => {
  it('session continuation: a resume of an open round with an in-flight ledger session reports the session id, before any drive event', async () => {
    const crashed = makeFakePipeline({
      sidecarOverrides: M_MULTI_ROUND,
      crashOn: killOnceOn('findings-2.json'),
      sessionIdOf: sessionOnlyFor('findings-2.json', 'ses-r2-reviewer'),
    })
    await expect(startRun(crashed.deps, { taskText: TASK_TEXT })).rejects.toThrow('simulated kill')
    const h = handleOf(crashed, firstRunOf(crashed))
    fs.rmSync(path.join(h.runDir, 'state.json'))

    const resumed = await resumeRun(crashed.deps, h.runId)
    expect(resumed.halted).toBe('final')

    const events = readEvents(h.logPath)
    const resumes = resumeEvents(events)
    expect(resumes).toHaveLength(1)
    expect(resumes[0]).toMatchObject({
      type: 'resume',
      path: 'session-continuation',
      stage: 'review',
      session: 'ses-r2-reviewer',
    })
    // ordering (D4): after any owed-recovery events, before the drive's re-entry
    const resumeAt = events.indexOf(resumes[0]!)
    expect(events.slice(resumeAt + 1).some((event) => isStageEnter(event, 'review'))).toBe(true)
  })

  it('stage rebuild: an open round with no in-flight session, and a non-review work stage, each report stage-rebuild', async () => {
    const crashed = makeFakePipeline({ sidecarOverrides: M_MULTI_ROUND, crashOn: killOnceOn('findings-2.json') })
    await expect(startRun(crashed.deps, { taskText: TASK_TEXT })).rejects.toThrow('simulated kill')
    const h = handleOf(crashed, firstRunOf(crashed))
    fs.rmSync(path.join(h.runDir, 'state.json'))
    await resumeRun(crashed.deps, h.runId)
    const openRound = resumeEvents(readEvents(h.logPath))
    expect(openRound).toHaveLength(1)
    expect(openRound[0]).toMatchObject({ type: 'resume', path: 'stage-rebuild', stage: 'review' })
    expect(openRound[0]).not.toHaveProperty('session')

    const intakeCrash = makeFakePipeline({ crashOn: killOnceOn('depth.json') })
    await expect(startRun(intakeCrash.deps, { taskText: TASK_TEXT })).rejects.toThrow('simulated kill')
    const intakeHandle = handleOf(intakeCrash, firstRunOf(intakeCrash))
    const resumedIntake = await resumeRun(intakeCrash.deps, intakeHandle.runId)
    expect(resumedIntake.halted).toBe('final')
    const intakeResumes = resumeEvents(readEvents(intakeHandle.logPath))
    expect(intakeResumes).toHaveLength(1)
    expect(intakeResumes[0]).toMatchObject({ type: 'resume', path: 'stage-rebuild', stage: 'intake' })
  })

  it('review never started: a resume at review with no opened round reports artifact-skip', async () => {
    const pipeline = makeFakePipeline()
    const started = await startRun(pipeline.deps, { taskText: TASK_TEXT })
    const h = handleOf(pipeline, started.runId)
    // the kill -9 shape: the log ends right after the review bracket opened, before round 1
    const events = readEvents(h.logPath)
    const enterReview = events.findIndex((event) => isStageEnter(event, 'review'))
    truncateLog(h.logPath, events.slice(0, enterReview + 1))

    const resumed = await resumeRun(pipeline.deps, h.runId)
    expect(resumed.halted).toBe('final')

    const resumes = resumeEvents(readEvents(h.logPath))
    expect(resumes).toHaveLength(1)
    expect(resumes[0]).toMatchObject({ type: 'resume', path: 'artifact-skip', stage: 'review' })
  })

  it('parked gate: resume reports artifact-skip at gate and parks again; a second resume appends its own event', async () => {
    const pipeline = makeFakePipeline({ sidecarOverrides: BLOCKER_ROUND })
    const started = await startRun(pipeline.deps, { taskText: TASK_TEXT })
    const h = handleOf(pipeline, started.runId)
    expect(started.halted).toBe('gate-pending')

    const first = await resumeRun(pipeline.deps, h.runId)
    expect(first).toMatchObject({ halted: 'gate-pending', drove: false })
    expect(readEvents(h.logPath).at(-1)).toMatchObject({ type: 'resume', path: 'artifact-skip', stage: 'gate' })

    const second = await resumeRun(pipeline.deps, h.runId)
    expect(second).toMatchObject({ halted: 'gate-pending', drove: false })
    expect(resumeEvents(readEvents(h.logPath))).toHaveLength(2)
  })

  it('terminal row: a W3 heal whose ladder (R1) completes the run during recovery still reports artifact-skip at gate, after the healed events', async () => {
    const pipeline = makeFakePipeline()
    const started = await startRun(pipeline.deps, { taskText: TASK_TEXT })
    const h = handleOf(pipeline, started.runId)
    // W3 window: the presenter died between stage_enter(gate) and presented —
    // the files (gate-1.md + hashes) landed file-first, the events never did.
    const events = readEvents(h.logPath)
    const gateEnter = events.findIndex((event) => isStageEnter(event, 'gate'))
    truncateLog(h.logPath, events.slice(0, gateEnter + 1))

    const resumed = await resumeRun(pipeline.deps, h.runId)
    expect(resumed).toMatchObject({ halted: 'final', position: 'completed', drove: false })

    const healed = readEvents(h.logPath)
    const resumes = resumeEvents(healed)
    expect(resumes).toHaveLength(1)
    const resumeAt = healed.indexOf(resumes[0]!)
    // after the recovery's presentation and settle, before nothing — the run is terminal
    expect(healed.slice(0, resumeAt).some((event) => isGateOf(event, 'presented'))).toBe(true)
    expect(healed.slice(0, resumeAt).some((event) => isGateOf(event, 'answered'))).toBe(true)
    expect(healed.at(-1)).toMatchObject({ type: 'resume', path: 'artifact-skip', stage: 'gate' })
  })
})
