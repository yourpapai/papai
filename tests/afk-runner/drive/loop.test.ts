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
import { readEvents } from '../../../afk-runner/src/events.js'
import type { SddEvent } from '../../../afk-runner/src/events.js'
import {
  initialKernelContext,
  createKernelMachine,
  kernelRootHandlers,
  kernelSetup,
} from '../../../afk-runner/src/kernel/machine.js'

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
        io.append({ altitude: 'L2', type: 'depth', profile: 'S', rationale: 'stub', source: 'estimator' })
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
          io.append({ altitude: 'L2', type: 'gate', action: 'presented', mode: 'early', version: 1 })
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
    expect(result.parked).toBe('awaiting-tail')
    expect(result.position).toBe('review')
  })

  it('successor-or-park: enters a successor only when it declares work, else parks awaiting-tail', async () => {
    const runDir = tempRunDir()
    const logPath = path.join(runDir, 'events.ndjson')
    const result = await drive({ machine: stubMachine(), logPath }, standardWorkFor('converged'))
    expect(enteredStages(logPath)).not.toContain('stage_enter:decompose')
    expect(result.parked).toBe('awaiting-tail')
  })

  it('parks gate-pending when the successor map parks after a presented gate', async () => {
    const runDir = tempRunDir()
    const logPath = path.join(runDir, 'events.ndjson')
    const result = await drive({ machine: stubMachine(), logPath }, standardWorkFor('cap-hit'))
    expect(result.parked).toBe('gate-pending')
    expect(result.context.gate).toEqual({ mode: 'early', version: 1, answered: false })
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
    expect(result.parked).toBe('awaiting-tail')
  })
})
