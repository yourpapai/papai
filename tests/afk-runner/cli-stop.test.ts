// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { runStopCommand } from '../../afk-runner/src/cli.js'
import { drive } from '../../afk-runner/src/drive/loop.js'
import type { StateModule, WorkIO } from '../../afk-runner/src/drive/loop.js'
import { readEvents } from '../../afk-runner/src/events.js'
import { pipelineMachine } from '../../afk-runner/src/graph/pipeline.js'
import { foldEvents } from '../../afk-runner/src/kernel/fold.js'
import {
  createKernelMachine,
  initialKernelContext,
  kernelRootHandlers,
  kernelSetup,
} from '../../afk-runner/src/kernel/machine.js'
import { allocateSessionId, PersistedRunStateSchema } from '../../afk-runner/src/run-state.js'
import type { RunDeps } from '../../afk-runner/src/run.js'
import { startRun } from '../../afk-runner/src/run.js'
import {
  createStopMarkerSeam,
  requestCalmStop,
  stopMarkerPath,
  writeHolder,
} from '../../afk-runner/src/stop-controller.js'
import { BLOCKER_ROUND, TASK_TEXT, makeFakePipeline } from './fixtures/fake-pipeline.js'

/** A crash predicate that fires exactly once on the given output basename. */
function killOnceOn(basename: string): (candidate: string) => boolean {
  let fired = false
  return (candidate: string): boolean => {
    if (fired || candidate !== basename) return false
    fired = true
    return true
  }
}

function stopStubMachine(): ReturnType<typeof createKernelMachine> {
  return createKernelMachine({
    id: 'stopstub',
    initial: 'start',
    context: initialKernelContext({ intake: 'pending' }),
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
      intake: kernelSetup.createStateConfig({}),
    },
  })
}

function stopStubWorkFor(state: string): StateModule | null {
  if (state === 'start') {
    return { work: null, outcomeOf: () => 'boot', successors: { boot: { enter: 'intake' } } }
  }
  if (state === 'intake') {
    return {
      work: {
        kind: 'stub-intake',
        run: (io: WorkIO) => {
          io.append({ altitude: 'L2', type: 'depth', profile: 'S', rationale: 'stub', source: 'estimator' })
        },
      },
      outcomeOf: (context) => (context.depth === null ? 'incomplete' : 'done'),
      successors: { done: { park: 'final' } },
    }
  }
  return null
}

/** A run id under a fake pipeline's work dir. */
function firstRunOf(deps: RunDeps): string {
  return fs.readdirSync(path.join(deps.config.workDir, 'runs'))[0] ?? ''
}

function crashedPipeline(): ReturnType<typeof makeFakePipeline> {
  return makeFakePipeline({ crashOn: killOnceOn('findings-1.json') })
}

describe('afk-runner stop — dead run aborts through events, slug released (C6 D7)', () => {
  it('appends run_abort, folds to aborted, writes the terminal memo, and releases the session id', async () => {
    const pipeline = crashedPipeline()
    await expect(startRun(pipeline.deps, { taskText: TASK_TEXT })).rejects.toThrow('simulated kill')
    const runId = firstRunOf(pipeline.deps)
    const runDir = pipeline.runDirOf(runId)
    const logPath = path.join(runDir, 'events.ndjson')

    // the slug is held by the stale running memo the crash left behind
    await expect(allocateSessionId(pipeline.deps.config.workDir, 'add-thing')).rejects.toThrow(/held by non-terminal/u)

    const summary = await runStopCommand(pipeline.deps, runId)
    expect(summary).toContain('aborted')

    const events = readEvents(logPath)
    expect(events.at(-1)).toMatchObject({ type: 'run_abort', reason: 'operator' })
    const snapshot = foldEvents(pipelineMachine, events).snapshot
    expect(snapshot.value).toBe('aborted')
    expect(snapshot.status).toBe('done')

    const memo = PersistedRunStateSchema.parse(JSON.parse(fs.readFileSync(path.join(runDir, 'state.json'), 'utf8')))
    expect(memo.status).toBe('aborted')

    // released: the slug allocates again instead of refusing (a fresh name
    // may carry a suffix past the terminal holder — C3's allocation rule)
    const allocated = await allocateSessionId(pipeline.deps.config.workDir, 'add-thing')
    expect(allocated.startsWith('add-thing')).toBe(true)
  })
})

describe('afk-runner stop — live owner gets the calm-stop marker (C6 D7)', () => {
  it('writes the marker, appends nothing, leaves the live process owner', async () => {
    const pipeline = crashedPipeline()
    await expect(startRun(pipeline.deps, { taskText: TASK_TEXT })).rejects.toThrow('simulated kill')
    const runId = firstRunOf(pipeline.deps)
    const runDir = pipeline.runDirOf(runId)
    const logPath = path.join(runDir, 'events.ndjson')
    const before = readEvents(logPath).length

    // a live process owns the run — this test process itself
    writeHolder(runDir, process.pid)

    const summary = await runStopCommand(pipeline.deps, runId)
    expect(summary).toContain('calm stop requested')
    expect(fs.existsSync(stopMarkerPath(runDir))).toBe(true)
    expect(readEvents(logPath)).toHaveLength(before)
  })

  it('the marker parks the drive stopped at the next boundary and is consumed', async () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-stop-'))
    const logPath = path.join(runDir, 'events.ndjson')
    requestCalmStop(runDir)
    const result = await drive(
      { machine: stopStubMachine(), logPath, stop: createStopMarkerSeam(runDir) },
      stopStubWorkFor,
    )
    expect(result.parked).toBe('stopped')
    expect(fs.existsSync(stopMarkerPath(runDir))).toBe(false)
  })
})

describe('afk-runner stop — parked-gate and final runs (C6 D7)', () => {
  it('a gate-pending run points at steer abort and appends nothing', async () => {
    const pipeline = makeFakePipeline({ sidecarOverrides: BLOCKER_ROUND })
    await startRun(pipeline.deps, { taskText: TASK_TEXT })
    const runId = firstRunOf(pipeline.deps)
    const logPath = path.join(pipeline.runDirOf(runId), 'events.ndjson')
    const before = readEvents(logPath).length

    const summary = await runStopCommand(pipeline.deps, runId)
    expect(summary).toContain('steer.md')
    expect(summary).toContain('abort')
    expect(readEvents(logPath)).toHaveLength(before)
  })

  it('a final run has nothing to stop', async () => {
    const pipeline = makeFakePipeline()
    const result = await startRun(pipeline.deps, { taskText: TASK_TEXT })
    expect(result.halted).toBe('final')
    const summary = await runStopCommand(pipeline.deps, result.runId)
    expect(summary).toContain('nothing to stop')
  })
})
