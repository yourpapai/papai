// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { drive } from '../../../afk-runner/src/drive/loop.js'
import type { StateModule, WorkIO } from '../../../afk-runner/src/drive/loop.js'
import { readEvents } from '../../../afk-runner/src/events.js'
import type { SddEvent } from '../../../afk-runner/src/events.js'
import {
  initialKernelContext,
  createKernelMachine,
  kernelRootHandlers,
  kernelSetup,
} from '../../../afk-runner/src/kernel/machine.js'

function tempRunDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'afk-resume-'))
}

/** Review-position stub with a self-loop: the corpus-real re-entry shape. */
function reviewSelfLoopMachine(): ReturnType<typeof createKernelMachine> {
  return createKernelMachine({
    id: 'resume-stub',
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

function modules(opts: {
  readonly intakeWork: (io: WorkIO) => void | Promise<void>
  readonly reviewWork: (io: WorkIO) => void | Promise<void>
}): (state: string) => StateModule | null {
  return (state): StateModule | null =>
    state === 'start'
      ? { work: null, outcomeOf: () => 'boot', successors: { boot: { enter: 'intake' } } }
      : state === 'intake'
        ? {
            work: { kind: 'stub-intake', run: opts.intakeWork },
            outcomeOf: (context) => (context.depth === null ? 'incomplete' : 'done'),
            successors: { done: { enter: 'review' } },
          }
        : state === 'review'
          ? {
              work: { kind: 'stub-review', run: opts.reviewWork },
              outcomeOf: (context) => (context.lastVerdict?.verdict === 'converged' ? 'converged' : 'incomplete'),
              successors: { converged: { park: 'awaiting-tail' } },
            }
          : null
}

/** Map a log to readable type tokens (stage events carry their stage). */
function logTypes(logPath: string): string[] {
  return readEvents(logPath).map((event: SddEvent) =>
    event.type === 'stage_enter' || event.type === 'stage_exit' ? `${event.type}:${event.stage}` : event.type,
  )
}

/** Record the folded round a work run was entered with. */
function roundRecorder(seen: number[]): (io: WorkIO) => void {
  return (io) => {
    seen.push(io.context.round === null ? 0 : io.context.round.current)
  }
}

describe('drive crash-resume drill (loop level)', () => {
  it('a log truncated mid-work re-folds to the interrupted state and the loop re-enters via workFor', async () => {
    const runDir = tempRunDir()
    const logPath = path.join(runDir, 'events.ndjson')
    const machine = reviewSelfLoopMachine()

    // First drive: intake completes; review work dies mid-round after opening the round.
    const crashing = modules({
      intakeWork: (io) => {
        io.append({ altitude: 'L2', type: 'depth', profile: 'S', rationale: 'stub', source: 'estimator' })
      },
      reviewWork: (io) => {
        io.append({ altitude: 'L2', type: 'round_open', round: 1, cap: 1 })
        throw new Error('simulated crash mid-round')
      },
    })
    await expect(drive({ machine, logPath }, crashing)).rejects.toThrow('simulated crash mid-round')

    const truncated = readEvents(logPath)
    expect(truncated.at(-1)?.type).toBe('round_open')
    expect(existsSync(path.join(runDir, 'state.json'))).toBe(false)

    // Second drive (new process shape): same loop, completing work.
    const completing = modules({
      intakeWork: (io) => {
        io.append({ altitude: 'L2', type: 'depth', profile: 'S', rationale: 'stub', source: 'estimator' })
      },
      reviewWork: (io) => {
        io.append({
          altitude: 'L2',
          type: 'convergence',
          round: 1,
          verdict: 'converged',
          counts: { blocker: 0, material: 0, nitpick: 0 },
        })
      },
    })
    const result = await drive({ machine, logPath }, completing)
    expect(result.parked).toBe('awaiting-tail')

    const types = logTypes(logPath)
    expect(types).toEqual([
      'stage_enter:intake',
      'depth',
      'stage_exit:intake',
      'stage_enter:review',
      'round_open',
      'stage_enter:review',
      'convergence',
      'stage_exit:review',
    ])
  })

  it('re-entry re-runs the work from the folded context without persisted pointers', async () => {
    const runDir = tempRunDir()
    const logPath = path.join(runDir, 'events.ndjson')
    const machine = reviewSelfLoopMachine()

    const crashing = modules({
      intakeWork: (io) => {
        io.append({ altitude: 'L2', type: 'depth', profile: 'S', rationale: 'stub', source: 'estimator' })
      },
      reviewWork: (io) => {
        io.append({ altitude: 'L2', type: 'round_open', round: 1, cap: 1 })
        throw new Error('crash')
      },
    })
    await expect(drive({ machine, logPath }, crashing)).rejects.toThrow('crash')

    const seenRounds: number[] = []
    const recordRound = roundRecorder(seenRounds)
    const observing = modules({
      intakeWork: () => {},
      reviewWork: (io) => {
        recordRound(io)
        io.append({
          altitude: 'L2',
          type: 'convergence',
          round: 1,
          verdict: 'converged',
          counts: { blocker: 0, material: 0, nitpick: 0 },
        })
      },
    })
    const result = await drive({ machine, logPath }, observing)
    expect(result.parked).toBe('awaiting-tail')
    expect(seenRounds).toEqual([1])
  })
})
