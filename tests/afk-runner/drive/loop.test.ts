// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { drive } from '../../../afk-runner/src/drive/loop.js'
import type { StateModule, WorkIO } from '../../../afk-runner/src/drive/loop.js'
import { appendEvent, readEvents } from '../../../afk-runner/src/events.js'
import type { EventInput, SddEvent } from '../../../afk-runner/src/events.js'
import { workForOf } from '../../../afk-runner/src/graph/pipeline-work.js'
import { pipelineMachine } from '../../../afk-runner/src/graph/pipeline.js'
import {
  initialKernelContext,
  createKernelMachine,
  kernelRootHandlers,
  kernelSetup,
} from '../../../afk-runner/src/kernel/machine.js'
import { makeFakePipeline, TASK_TEXT } from '../fixtures/fake-pipeline.js'

function appendEvents(logPath: string, inputs: readonly EventInput[]): void {
  for (const input of inputs) appendEvent(logPath, input, new Date('2026-08-27T00:00:00.000Z'))
}

function tempRunDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'afk-drive-'))
}

/**
 * Stub topology: start → {intake, review}, intake self-loops and reaches
 * review — deliberately not the pipeline's shape, proving loop genericity.
 */
function stubMachine(): ReturnType<typeof createKernelMachine> {
  return createKernelMachine({
    id: 'stub',
    initial: 'start',
    context: initialKernelContext({ intake: 'pending', review: 'pending' }),
    on: kernelRootHandlers,
    states: {
      start: kernelSetup.createStateConfig({
        on: {
          'stage.enter': [
            {
              target: 'intake',
              guard: { type: 'isStage', params: { stage: 'intake' } },
              actions: ['closeThenActivate'],
            },
            {
              target: 'review',
              guard: { type: 'isStage', params: { stage: 'review' } },
              actions: ['closeThenActivate'],
            },
          ],
        },
      }),
      intake: kernelSetup.createStateConfig({
        on: {
          'stage.enter': [
            {
              target: 'intake',
              guard: { type: 'isStage', params: { stage: 'intake' } },
              actions: ['closeThenActivate'],
            },
            {
              target: 'review',
              guard: { type: 'isStage', params: { stage: 'review' } },
              actions: ['closeThenActivate'],
            },
          ],
        },
      }),
      review: {},
    },
  })
}

function startModule(next: 'intake' | 'review' = 'intake'): StateModule {
  return {
    work: null,
    outcomeOf: () => 'boot',
    successors: { boot: { enter: next } },
  }
}

function intakeModule(): StateModule {
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
    successors: {
      done: { enter: 'review' },
    },
  }
}

function reviewModule(fate: 'converged' | 'cap-hit'): StateModule {
  return {
    work: {
      kind: 'stub-review',
      run: (io: WorkIO) => {
        io.append({ altitude: 'L2', type: 'round_open', round: 1, cap: 1 })
        if (fate === 'cap-hit') {
          io.append({
            altitude: 'L2',
            type: 'gate',
            action: 'presented',
            mode: 'early',
            version: 1,
          })
        } else {
          io.append({
            altitude: 'L2',
            type: 'convergence',
            round: 1,
            verdict: 'converged',
            counts: { blocker: 0, material: 0, nitpick: 0 },
          })
        }
      },
    },
    outcomeOf: (context) => {
      if (context.gate !== null) return 'cap-hit'
      if (context.lastVerdict?.verdict === 'converged') return 'converged'
      return 'incomplete'
    },
    successors: {
      converged: { enter: 'decompose' },
      'cap-hit': { park: 'gate-pending' },
    },
  }
}

function logTypes(logPath: string): string[] {
  return readEvents(logPath).map((event: SddEvent) =>
    event.type === 'stage_enter' || event.type === 'stage_exit' ? `${event.type}:${event.stage}` : event.type,
  )
}

/**
 * Stub topology with a compound gate (C4 shape): start → review; review parks
 * into gate.awaiting on a presented event; awaiting returns to review on
 * round.open. Proves the loop's compound-position handling is generic.
 */
function gateStubMachine(): ReturnType<typeof createKernelMachine> {
  return createKernelMachine({
    id: 'gatestub',
    initial: 'start',
    context: initialKernelContext({ intake: 'pending', review: 'pending' }),
    on: kernelRootHandlers,
    states: {
      start: kernelSetup.createStateConfig({
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
          'gate.presented': { target: 'gate', actions: ['presentGate'] },
        },
      }),
      gate: kernelSetup.createStateConfig({
        initial: 'awaiting',
        states: {
          awaiting: kernelSetup.createStateConfig({
            on: {
              'round.open': {
                target: '#gatestub.review',
                actions: ['openRound'],
              },
            },
          }),
        },
      }),
    },
  })
}

/** The gate-stub work registry: review runs round work; gate.awaiting declares no work and parks. */
function gateStubWorkFor(fate: 'converged' | 'cap-hit'): (state: string) => StateModule | null {
  return (state) => {
    if (state === 'start') return startModule('review')
    if (state === 'review') {
      return {
        work: {
          kind: 'stub-review',
          run: (io: WorkIO) => {
            io.append({ altitude: 'L2', type: 'round_open', round: 1, cap: 1 })
            if (fate === 'cap-hit') {
              io.append({
                altitude: 'L2',
                type: 'gate',
                action: 'presented',
                mode: 'early',
                version: 1,
              })
            } else {
              io.append({
                altitude: 'L2',
                type: 'convergence',
                round: 1,
                verdict: 'converged',
                counts: { blocker: 0, material: 0, nitpick: 0 },
              })
            }
          },
        },
        outcomeOf: (context) => {
          if (context.gate !== null && !context.gate.answered) return 'cap-hit'
          if (context.lastVerdict?.verdict === 'converged') return 'converged'
          return 'incomplete'
        },
        successors: {
          converged: { park: 'final' },
          'cap-hit': { park: 'gate-pending' },
        },
      }
    }
    if (state === 'gate.awaiting') {
      return {
        work: null,
        outcomeOf: () => 'awaiting',
        successors: { awaiting: { park: 'gate-pending' } },
      }
    }
    return null
  }
}

/** A differently-shaped composition: start routes straight to review; intake is absent. */
function composedWorkFor(state: string): StateModule | null {
  if (state === 'start') return startModule('review')
  if (state === 'review') return reviewModule('converged')
  return null
}

/** The standard stub composition: start → intake → review(fate) with intake re-enterable. */
function standardWorkFor(fate: 'converged' | 'cap-hit'): (state: string) => StateModule | null {
  return (state) => composedChain(state, fate)
}

function composedChain(state: string, fate: 'converged' | 'cap-hit'): StateModule | null {
  if (state === 'start') return startModule()
  if (state === 'intake') return intakeModule()
  if (state === 'review') return reviewModule(fate)
  return null
}

/** Stage-enter tokens in the log, in order (`stage_enter:<stage>`). */
function enteredStages(logPath: string): string[] {
  return logTypes(logPath).filter((token) => token.startsWith('stage_enter:'))
}

describe('drive loop — generic, stage-agnostic', () => {
  it('brackets work with loop-appended enter/exit around the work domain events', async () => {
    const runDir = tempRunDir()
    const logPath = path.join(runDir, 'events.ndjson')
    const result = await drive({ machine: stubMachine(), logPath }, standardWorkFor('converged'))
    expect(logTypes(logPath)).toEqual([
      'stage_enter:intake',
      'depth',
      'stage_exit:intake',
      'stage_enter:review',
      'round_open',
      'convergence',
      'stage_exit:review',
    ])
    expect(result.parked).toBe('final')
    expect(result.position).toBe('review')
  })

  it('successor-or-park: enters a successor only when it declares work, else parks final', async () => {
    const runDir = tempRunDir()
    const logPath = path.join(runDir, 'events.ndjson')
    const result = await drive({ machine: stubMachine(), logPath }, standardWorkFor('converged'))
    expect(enteredStages(logPath)).not.toContain('stage_enter:decompose')
    expect(result.parked).toBe('final')
  })

  it('parks gate-pending when the successor map parks after a presented gate', async () => {
    const runDir = tempRunDir()
    const logPath = path.join(runDir, 'events.ndjson')
    const result = await drive({ machine: stubMachine(), logPath }, standardWorkFor('cap-hit'))
    expect(result.parked).toBe('gate-pending')
    expect(result.context.gate).toEqual({
      mode: 'early',
      version: 1,
      answered: false,
    })
  })

  it('parks stopped when the calm-stop seam fired after the work round completed', async () => {
    const runDir = tempRunDir()
    const logPath = path.join(runDir, 'events.ndjson')
    let consumed = false
    const result = await drive(
      {
        machine: stubMachine(),
        logPath,
        stop: {
          stopRequested: () => true,
          consumeMarker: () => {
            consumed = true
          },
        },
      },
      standardWorkFor('converged'),
    )
    expect(result.parked).toBe('stopped')
    expect(consumed).toBe(true)
  })

  it('contains no pipeline stage names — sequencing lives only in state-module data', () => {
    const source = readFileSync(new URL('../../../afk-runner/src/drive/loop.ts', import.meta.url), 'utf8')
    expect(source.includes("'intake'")).toBe(false)
    expect(source.includes("'draft'")).toBe(false)
    expect(source.includes("'review'")).toBe(false)
    expect(source.includes("'decompose'")).toBe(false)
    expect(source.includes("'atomicity'")).toBe(false)
    expect(source.includes("'gate'")).toBe(false)
  })

  it('executes a newly composed state module without loop edits (spec scenario)', async () => {
    const runDir = tempRunDir()
    const logPath = path.join(runDir, 'events.ndjson')
    const result = await drive({ machine: stubMachine(), logPath }, composedWorkFor)
    expect(logTypes(logPath)).toEqual(['stage_enter:review', 'round_open', 'convergence', 'stage_exit:review'])
    expect(result.parked).toBe('final')
  })
})

describe('drive loop — compound positions (C4 gate.awaiting)', () => {
  it('flattens a compound position to a dot-path and parks gate-pending at it', async () => {
    const runDir = tempRunDir()
    const logPath = path.join(runDir, 'events.ndjson')
    const result = await drive({ machine: gateStubMachine(), logPath }, gateStubWorkFor('cap-hit'))
    expect(result.position).toBe('gate.awaiting')
    expect(result.parked).toBe('gate-pending')
    expect(result.context.gate).toEqual({
      mode: 'early',
      version: 1,
      answered: false,
    })
  })

  it('parks gate-pending positionally from a log already in awaiting, with no bracket appends', async () => {
    const runDir = tempRunDir()
    const logPath = path.join(runDir, 'events.ndjson')
    appendEvents(logPath, [
      { altitude: 'L2', type: 'stage_enter', stage: 'review' },
      { altitude: 'L2', type: 'round_open', round: 1, cap: 1 },
      {
        altitude: 'L2',
        type: 'gate',
        action: 'presented',
        mode: 'early',
        version: 1,
      },
    ])
    const result = await drive({ machine: gateStubMachine(), logPath }, gateStubWorkFor('cap-hit'))
    expect(result.position).toBe('gate.awaiting')
    expect(result.parked).toBe('gate-pending')
    expect(logTypes(logPath)).toEqual(['stage_enter:review', 'round_open', 'gate'])
  })

  it('re-drives through the awaiting→review mover after an extend settle', async () => {
    const runDir = tempRunDir()
    const logPath = path.join(runDir, 'events.ndjson')
    appendEvents(logPath, [
      { altitude: 'L2', type: 'stage_enter', stage: 'review' },
      { altitude: 'L2', type: 'round_open', round: 1, cap: 1 },
      {
        altitude: 'L2',
        type: 'gate',
        action: 'presented',
        mode: 'early',
        version: 1,
      },
      {
        altitude: 'L2',
        type: 'gate',
        action: 'answered',
        mode: 'early',
        version: 1,
        outcome: 'extend',
      },
      { altitude: 'L2', type: 'round_open', round: 2, cap: 2 },
    ])
    const result = await drive({ machine: gateStubMachine(), logPath }, gateStubWorkFor('converged'))
    expect(result.position).toBe('review')
    expect(result.parked).toBe('final')
    expect(logTypes(logPath).slice(-4)).toEqual([
      'stage_enter:review',
      'round_open',
      'convergence',
      'stage_exit:review',
    ])
  })
})

describe('drive loop — pipeline intake wiring', () => {
  it('surfaces a depth-override intake warn on RunDeps.stdout prefixed intake:', async () => {
    const pipeline = makeFakePipeline()
    const runDir = tempRunDir()
    const logPath = path.join(runDir, 'events.ndjson')
    const result = await drive(
      { machine: pipelineMachine, logPath },
      workForOf(pipeline.deps, { taskText: TASK_TEXT, changeName: 'add-thing', depthOverride: 'S' }),
    )
    expect(result.parked).toBe('final')
    expect(pipeline.stdoutLines).toContain(
      'intake: --depth S skips scope estimation — the forced profile sets the review round cap (S: 1) and skips the atomicity stage (decompose presents the final gate)',
    )
  })
})
