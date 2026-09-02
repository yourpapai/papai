// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { drive } from '../../../afk-runner/src/drive/loop.js'
import type { StateModule, WorkIO } from '../../../afk-runner/src/drive/loop.js'
import { AgentValidationError } from '../../../afk-runner/src/errors.js'
import { SpawnError, StageHaltError } from '../../../afk-runner/src/errors.js'
import { readEvents } from '../../../afk-runner/src/events.js'
import type { SddEvent } from '../../../afk-runner/src/events.js'
import {
  createKernelMachine,
  initialKernelContext,
  kernelRootHandlers,
  kernelSetup,
} from '../../../afk-runner/src/kernel/machine.js'
import { startRun } from '../../../afk-runner/src/run.js'
import { TASK_TEXT, makeFakePipeline } from '../fixtures/fake-pipeline.js'

function tempRunDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'afk-fail-'))
}

/** Stub topology: start → intake → review(review self-loops, parks on convergence). */
function stubMachine(): ReturnType<typeof createKernelMachine> {
  return createKernelMachine({
    id: 'failstub',
    initial: 'start',
    context: initialKernelContext({ intake: 'pending', review: 'pending' }),
    on: kernelRootHandlers,
    states: {
      start: kernelSetup.createStateConfig({
        on: {
          'stage.enter': {
            target: 'intake',
            guard: { type: 'isStage', params: { stage: 'intake' } },
            actions: ['closeThenActivate'],
          },
        },
      }),
      intake: kernelSetup.createStateConfig({
        on: {
          'stage.enter': {
            target: 'review',
            guard: { type: 'isStage', params: { stage: 'review' } },
            actions: ['closeThenActivate'],
          },
        },
      }),
      review: kernelSetup.createStateConfig({
        on: {
          'stage.enter': {
            target: 'review',
            guard: { type: 'isStage', params: { stage: 'review' } },
            actions: ['closeThenActivate'],
          },
        },
      }),
    },
  })
}

/** Review work that throws each error in `failures` once, then converges. */
function failingThenConvergingWork(failures: readonly Error[]): StateModule['work'] {
  let attempt = 0
  return {
    kind: 'stub-review',
    run: (io: WorkIO) => {
      const failure = failures[attempt]
      attempt += 1
      if (failure !== undefined) throw failure
      io.append({ altitude: 'L2', type: 'round_open', round: 1, cap: 1 })
      io.append({
        altitude: 'L2',
        type: 'convergence',
        round: 1,
        verdict: 'converged',
        counts: { blocker: 0, material: 0, nitpick: 0 },
      })
    },
  }
}

function workOf(work: StateModule['work']): (state: string) => StateModule | null {
  return (state): StateModule | null => {
    if (state === 'start') {
      return { work: null, outcomeOf: () => 'boot', successors: { boot: { enter: 'intake' } } }
    }
    if (state === 'intake') {
      return {
        work: {
          kind: 'stub-intake',
          run: (io: WorkIO) => {
            io.append({
              altitude: 'L2',
              type: 'depth',
              profile: 'S',
              rationale: 'stub',
              source: 'estimator',
            })
          },
        },
        outcomeOf: (context) => (context.depth === null ? 'incomplete' : 'done'),
        successors: { done: { enter: 'review' } },
      }
    }
    if (state === 'review') {
      return {
        work,
        outcomeOf: (context) => (context.lastVerdict?.verdict === 'converged' ? 'converged' : 'incomplete'),
        successors: { converged: { park: 'final' }, incomplete: { enter: 'review' } },
      }
    }
    return null
  }
}

function logTypes(logPath: string): string[] {
  return readEvents(logPath).map((event: SddEvent) =>
    event.type === 'stage_enter' || event.type === 'stage_exit' ? `${event.type}:${event.stage}` : event.type,
  )
}

const HALT = new StageHaltError('review round 1 failed after 2 attempts: schema invalid', 'resume the run', 'exhausted')

/** A session-id seam reporting one id for exactly the given output basename. */
function sessionOnlyFor(basename: string, sessionId: string): (candidate: string) => string | undefined {
  return (candidate) => (candidate === basename ? sessionId : undefined)
}

describe('drive loop — classified failures are declared run facts (C6 D2/D3)', () => {
  it('catches a StageHaltError: appends stage_failed, skips the exit append, re-runs the bracket, completes', async () => {
    const runDir = tempRunDir()
    const logPath = path.join(runDir, 'events.ndjson')
    const result = await drive({ machine: stubMachine(), logPath }, workOf(failingThenConvergingWork([HALT])))
    expect(result.parked).toBe('final')
    expect(logTypes(logPath)).toEqual([
      'stage_enter:intake',
      'depth',
      'stage_exit:intake',
      'stage_enter:review',
      'stage_failed',
      'round_open',
      'convergence',
      'stage_exit:review',
    ])
    const failure = readEvents(logPath).find((event) => event.type === 'stage_failed')
    expect(failure).toMatchObject({
      stage: 'review',
      kind: 'exhausted',
      reason: 'review round 1 failed after 2 attempts: schema invalid',
      resumeHint: 'resume the run',
    })
  })

  it('classifies AgentValidationError and SpawnError identically — declared, retried, completed', async () => {
    const cases: readonly { readonly error: Error; readonly kind: 'exhausted' | 'infra' }[] = [
      {
        error: new AgentValidationError('stage agent reviewer-r1 failed validation after 2 attempts: bad shape'),
        kind: 'exhausted',
      },
      { error: new SpawnError('could not reach the agent: spawn opencode ENOENT'), kind: 'infra' },
    ]
    for (const { error, kind } of cases) {
      const runDir = tempRunDir()
      const logPath = path.join(runDir, 'events.ndjson')
      const result = await drive({ machine: stubMachine(), logPath }, workOf(failingThenConvergingWork([error])))
      expect(result.parked).toBe('final')
      const failure = readEvents(logPath).find((event) => event.type === 'stage_failed')
      expect(failure).toMatchObject({
        stage: 'review',
        reason: error.message,
        kind,
      })
    }
  })

  it('untyped errors rethrow unchanged with nothing appended after the enter', async () => {
    const runDir = tempRunDir()
    const logPath = path.join(runDir, 'events.ndjson')
    const bug = new Error('work-module bug')
    const failure = drive({ machine: stubMachine(), logPath }, workOf(failingThenConvergingWork([bug]))).then(
      () => null,
      (error: unknown) => error,
    )
    await expect(failure).resolves.toBe(bug)
    expect(logTypes(logPath)).toEqual(['stage_enter:intake', 'depth', 'stage_exit:intake', 'stage_enter:review'])
  })

  it('a failure past the budget parks gate-pending — the escalation is owed', async () => {
    const runDir = tempRunDir()
    const logPath = path.join(runDir, 'events.ndjson')
    const result = await drive({ machine: stubMachine(), logPath }, workOf(failingThenConvergingWork([HALT, HALT])))
    expect(result.parked).toBe('gate-pending')
    expect(result.position).toBe('review')
    expect(readEvents(logPath).filter((event) => event.type === 'stage_failed')).toHaveLength(2)
    // the bracket stays open: no exit ever landed for the failed stage
    expect(logTypes(logPath)).not.toContain('stage_exit:review')
  })

  it('a precondition failure escalates immediately — the first failure parks gate-pending', async () => {
    const runDir = tempRunDir()
    const logPath = path.join(runDir, 'events.ndjson')
    const precondition = new StageHaltError(
      'review cannot run: no findings sidecar',
      'resume after draft',
      'precondition',
    )
    const result = await drive({ machine: stubMachine(), logPath }, workOf(failingThenConvergingWork([precondition])))
    expect(result.parked).toBe('gate-pending')
    expect(readEvents(logPath).filter((event) => event.type === 'stage_failed')).toHaveLength(1)
  })
})

describe('drive loop — stage re-entry continues the killed session (escalation-retry-session-continuation D1)', () => {
  it('an under-budget re-run of a non-review stage re-spawns continuing the killed session id', async () => {
    const validDepth = JSON.stringify({
      implicated_files: ['src/thing.ts'],
      signals: {
        cross_module: false,
        db_migration: false,
        provider_surface: false,
        credentials: false,
        novelty: 'existing-modules',
      },
      rationale: 'one module',
    })
    // two invalid estimator sidecars exhaust the validation attempts (the
    // killed ledger session), the re-entry's continuation reads the valid one
    const pipeline = makeFakePipeline({
      sidecarSequences: { 'depth.json': ['{}', '{}', validDepth] },
      sessionIdOf: sessionOnlyFor('depth.json', 'ses-intake'),
    })
    const result = await startRun(pipeline.deps, { taskText: TASK_TEXT })
    expect(result.halted).toBe('final')
    const logPath = path.join(pipeline.runDirOf(result.runId), 'events.ndjson')
    const failures = readEvents(logPath).filter((event: SddEvent) => event.type === 'stage_failed')
    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatchObject({ stage: 'intake', kind: 'exhausted' })
    const depthArgs = pipeline.spawnArgs['depth.json']!
    const depthPrompts = pipeline.spawnPrompts['depth.json']!
    expect(depthArgs).toHaveLength(3)
    // the first bracket's two attempts are fresh — including the intra-bracket
    // validation retry (D3), which appends the error and never continues
    expect(depthArgs[0]!.includes('--session')).toBe(false)
    expect(depthArgs[1]!.includes('--session')).toBe(false)
    expect(depthPrompts[1]).toContain('Previous attempt failed')
    // the under-budget re-entry continues the killed session
    const sessionIndex = depthArgs[2]!.indexOf('--session')
    expect(sessionIndex).toBeGreaterThan(-1)
    expect(depthArgs[2]![sessionIndex + 1]).toBe('ses-intake')
    expect(depthPrompts[2]).toContain('Continue the interrupted task in this session.')
  })
})
