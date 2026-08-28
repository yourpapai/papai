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
import { parkedReasonOf, reviewResumeEntry } from '../../../afk-runner/src/drive/resume.js'
import { appendEvent, readEvents, stampEvent } from '../../../afk-runner/src/events.js'
import type { SddEvent } from '../../../afk-runner/src/events.js'
import { createPipelineWorkFor } from '../../../afk-runner/src/graph/pipeline-work.js'
import { pipelineMachine } from '../../../afk-runner/src/graph/pipeline.js'
import { foldEvents } from '../../../afk-runner/src/kernel/fold.js'
import type { KernelContext } from '../../../afk-runner/src/kernel/machine.js'
import {
  initialKernelContext,
  createKernelMachine,
  kernelRootHandlers,
  kernelSetup,
} from '../../../afk-runner/src/kernel/machine.js'
import type { SessionLedgerLine } from '../../../afk-runner/src/session-ledger.js'

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

const depthEvent = { altitude: 'L2', type: 'depth', profile: 'S', rationale: 'stub', source: 'estimator' } as const

/** Real-graph drill modules: work only at the named state, everything else workless. */
function singleStateModule(state: string, module: StateModule): (position: string) => StateModule | null {
  return (position): StateModule | null => (position === state ? module : null)
}

const intakeDepthModule = singleStateModule('intake', {
  work: {
    kind: 'stub-intake',
    run: (io: WorkIO) => {
      io.append(depthEvent)
    },
  },
  outcomeOf: (context) => (context.depth === null ? 'incomplete' : 'done'),
  successors: { done: { enter: 'draft' } },
})

const decomposeDoneModule = singleStateModule('decompose', {
  work: { kind: 'stub-decompose', run: () => {} },
  outcomeOf: (context) => (context.stages['decompose'] === 'done' ? 'done' : 'incomplete'),
  successors: { done: { enter: 'atomicity' } },
})

describe('drive crash-resume drill (real pipeline graph — C5 D4 self-loops)', () => {
  it('a mid-intake crash resumes by re-entering intake through its own self-loop — no append refusal', async () => {
    const runDir = tempRunDir()
    const logPath = path.join(runDir, 'events.ndjson')
    // Crash log: the intake bracket opened, work died before any bookkeeping.
    appendEvent(logPath, { altitude: 'L2', type: 'stage_enter', stage: 'intake' })

    const result = await drive({ machine: pipelineMachine, logPath }, intakeDepthModule)
    expect(result.parked).toBe('awaiting-tail')
    expect(result.position).toBe('intake')
    expect(logTypes(logPath)).toEqual(['stage_enter:intake', 'stage_enter:intake', 'depth', 'stage_exit:intake'])
  })

  it('a mid-decompose crash resumes by re-entering decompose through its own self-loop — no append refusal', async () => {
    const runDir = tempRunDir()
    const logPath = path.join(runDir, 'events.ndjson')
    // Crash log: the walk reached decompose, whose bracket opened and work died.
    for (const event of [
      { altitude: 'L2', type: 'stage_enter', stage: 'intake' },
      depthEvent,
      { altitude: 'L2', type: 'stage_exit', stage: 'intake' },
      { altitude: 'L2', type: 'stage_enter', stage: 'draft' },
      { altitude: 'L2', type: 'stage_exit', stage: 'draft' },
      { altitude: 'L2', type: 'stage_enter', stage: 'review' },
      { altitude: 'L2', type: 'stage_exit', stage: 'review' },
      { altitude: 'L2', type: 'stage_enter', stage: 'decompose' },
    ] as const) {
      appendEvent(logPath, event)
    }

    const result = await drive({ machine: pipelineMachine, logPath }, decomposeDoneModule)
    expect(result.parked).toBe('awaiting-tail')
    expect(result.position).toBe('decompose')
    expect(logTypes(logPath).slice(-2)).toEqual(['stage_enter:decompose', 'stage_exit:decompose'])
  })
})

const resumeStamp = (input: Parameters<typeof stampEvent>[0], seq: number): SddEvent =>
  stampEvent(input, seq, '2026-08-27T00:00:00.000Z')

function pipelineContextOf(events: readonly SddEvent[]): KernelContext {
  return foldEvents(pipelineMachine, events).snapshot.context
}

function ledgerLine(overrides: Partial<SessionLedgerLine>): SessionLedgerLine {
  return {
    label: 'reviewer',
    role: 'reviewer',
    round: 1,
    attempt: 1,
    model: 'test-model',
    opencodeSessionId: 'ses-1',
    status: 'spawned',
    ts: '2026-08-27T00:00:00.000Z',
    ...overrides,
  }
}

const realWorkFor = createPipelineWorkFor(
  {
    spawn: (): Promise<{ exitCode: number; stdout: string; stderr: string }> =>
      Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
    execGit: () => Promise.resolve({ stdout: '', stderr: '' }),
    driver: {
      newChange: () => Promise.resolve({ changeName: 'c' }),
      status: () => Promise.resolve({ schemaName: 'auto-sdd', artifacts: {}, isPlanningComplete: false }),
      instructions: () =>
        Promise.resolve({
          instruction: '',
          template: undefined,
          rules: [],
          resolvedOutputPath: '',
          existingOutputPaths: [],
          dependencies: [],
        }),
      validateStrict: () => Promise.resolve({ ok: true, output: 'is valid' }),
    },
    config: { repoRoot: '/repo', workDir: '/work', model: 'm', budget: 5 },
  },
  { taskText: 'task', changeName: 'c' },
)

describe('resume decision — pure function of folded context + session ledger (design D6)', () => {
  it('a run with no opened round starts fresh at round 1 with the depth cap', () => {
    expect(reviewResumeEntry(initialKernelContext({}), [], null)).toEqual({ startRound: 1, cap: 1 })
    expect(reviewResumeEntry(initialKernelContext({}), [], 'M')).toEqual({ startRound: 1, cap: 3 })
  })

  it('the interrupted round re-runs from the ledger continuation session when one is in flight', () => {
    const context = pipelineContextOf([resumeStamp({ altitude: 'L2', type: 'round_open', round: 2, cap: 4 }, 1)])
    const withSession = reviewResumeEntry(
      context,
      [ledgerLine({ round: 2, label: 'reviewer', opencodeSessionId: 'ses-9', status: 'spawned' })],
      'M',
    )
    expect(withSession).toEqual({
      startRound: 2,
      cap: 4,
      resumeSession: { label: 'reviewer', opencodeSessionId: 'ses-9', round: 2 },
    })
  })

  it('no in-flight session for the round re-runs it fresh (no continuation)', () => {
    const context = pipelineContextOf([resumeStamp({ altitude: 'L2', type: 'round_open', round: 3, cap: 5 }, 1)])
    const settled = reviewResumeEntry(context, [ledgerLine({ round: 1, status: 'done' })], 'M')
    expect(settled).toEqual({ startRound: 3, cap: 5 })
  })

  it('a round with a recorded verdict completed: the resume enters the next round fresh', () => {
    const context = pipelineContextOf([
      resumeStamp({ altitude: 'L2', type: 'round_open', round: 1, cap: 3 }, 1),
      resumeStamp(
        {
          altitude: 'L2',
          type: 'convergence',
          round: 1,
          verdict: 'open',
          counts: { blocker: 1, material: 0, nitpick: 0 },
        },
        2,
      ),
    ])
    const next = reviewResumeEntry(context, [ledgerLine({ round: 1, status: 'spawned' })], 'M')
    expect(next).toEqual({ startRound: 2, cap: 3 })
  })

  it('parked reporting is data: converged reports awaiting-tail, presented gate reports gate-pending', () => {
    const converged = pipelineContextOf([
      resumeStamp({ altitude: 'L2', type: 'stage_enter', stage: 'review' }, 1),
      resumeStamp(
        {
          altitude: 'L2',
          type: 'convergence',
          round: 1,
          verdict: 'converged',
          counts: { blocker: 0, material: 0, nitpick: 0 },
        },
        2,
      ),
      resumeStamp({ altitude: 'L2', type: 'stage_exit', stage: 'review' }, 3),
    ])
    expect(parkedReasonOf(converged, 'review', realWorkFor)).toBe('awaiting-tail')

    const gated = pipelineContextOf([
      resumeStamp({ altitude: 'L2', type: 'gate', action: 'presented', mode: 'early', version: 1 }, 1),
    ])
    expect(parkedReasonOf(gated, 'review', realWorkFor)).toBe('gate-pending')
  })

  it('a run that still owes work reports drivable, not parked', () => {
    expect(parkedReasonOf(initialKernelContext({}), 'start', realWorkFor)).toBe('drivable')
    const midIntake = pipelineContextOf([resumeStamp({ altitude: 'L2', type: 'stage_enter', stage: 'intake' }, 1)])
    expect(parkedReasonOf(midIntake, 'intake', realWorkFor)).toBe('drivable')
    const stopped = pipelineContextOf([
      resumeStamp({ altitude: 'L2', type: 'stage_enter', stage: 'review' }, 1),
      resumeStamp({ altitude: 'L2', type: 'round_open', round: 1, cap: 1 }, 2),
      resumeStamp({ altitude: 'L2', type: 'stage_exit', stage: 'review' }, 3),
    ])
    expect(parkedReasonOf(stopped, 'review', realWorkFor)).toBe('drivable')
  })
})
