// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import path from 'node:path'

import { stampEvent } from '../../../afk-runner/src/events.js'
import type { SddEvent } from '../../../afk-runner/src/events.js'
import { foldEvents, foldLog, toKernelEvent } from '../../../afk-runner/src/kernel/fold.js'
import { createKernelMachine, initialStep, step } from '../../../afk-runner/src/kernel/machine.js'
import type { KernelEvent } from '../../../afk-runner/src/kernel/machine.js'

function linearMachine(): ReturnType<typeof createKernelMachine> {
  return createKernelMachine({
    id: 'linear',
    initial: 'start',
    context: { stages: { intake: 'pending', draft: 'pending', review: 'pending' } },
    on: { 'stage.exit': { actions: ['markStageDone'] } },
    states: {
      start: {
        on: {
          'stage.enter': {
            target: 'intake',
            guard: { type: 'isStage', params: { stage: 'intake' } },
            actions: ['closeThenActivate'],
          },
        },
      },
      intake: {
        on: {
          'stage.enter': {
            target: 'draft',
            guard: { type: 'isStage', params: { stage: 'draft' } },
            actions: ['closeThenActivate'],
          },
        },
      },
      draft: {
        on: {
          'stage.enter': {
            target: 'review',
            guard: { type: 'isStage', params: { stage: 'review' } },
            actions: ['closeThenActivate'],
          },
        },
      },
      review: {},
    },
  })
}

const stamp = (input: Parameters<typeof stampEvent>[0], seq: number): SddEvent =>
  stampEvent(input, seq, '2026-08-27T00:00:00.000Z')

describe('kernel fold', () => {
  it('maps stage and gate log events to kernel events, null for everything else', () => {
    expect(toKernelEvent(stamp({ altitude: 'L2', type: 'stage_enter', stage: 'draft' }, 1))).toEqual({
      type: 'stage.enter',
      stage: 'draft',
    })
    expect(toKernelEvent(stamp({ altitude: 'L2', type: 'stage_exit', stage: 'review' }, 2))).toEqual({
      type: 'stage.exit',
      stage: 'review',
    })
    expect(
      toKernelEvent(stamp({ altitude: 'L2', type: 'gate', action: 'presented', mode: 'final', version: 1 }, 3)),
    ).toEqual({ type: 'gate.presented' })
    expect(
      toKernelEvent(stamp({ altitude: 'L2', type: 'gate', action: 'answered', mode: 'final', version: 1 }, 4)),
    ).toEqual({ type: 'gate.answered' })
    expect(toKernelEvent(stamp({ altitude: 'L0', type: 'tool_use', agent: 'a', tool: 't' }, 5))).toBeNull()
    expect(toKernelEvent(stamp({ altitude: 'L2', type: 'round_close', round: 1, cap: 3 }, 6))).toBeNull()
  })

  it('folds a mapped event list into machine state with exact accounting', () => {
    const machine = linearMachine()
    const events = [
      stamp({ altitude: 'L2', type: 'depth', profile: 'M', rationale: 'r', source: 'estimator' }, 1),
      stamp({ altitude: 'L2', type: 'stage_enter', stage: 'intake' }, 2),
      stamp({ altitude: 'L2', type: 'stage_exit', stage: 'intake' }, 3),
      stamp({ altitude: 'L2', type: 'stage_enter', stage: 'draft' }, 4),
    ]
    const result = foldEvents(machine, events)
    expect(result.snapshot.value).toBe('draft')
    expect(result.snapshot.context.stages).toEqual({ intake: 'done', draft: 'active', review: 'pending' })
    expect(result.accounting).toEqual({ total: 4, mapped: 3, tolerated: 1 })
  })

  it('folding the same log twice produces deep-equal state', () => {
    const machine = linearMachine()
    const events = [
      stamp({ altitude: 'L2', type: 'stage_enter', stage: 'intake' }, 1),
      stamp({ altitude: 'L1', type: 'spawned', agent: 'a', role: 'r', model: 'm' }, 2),
      stamp({ altitude: 'L2', type: 'stage_exit', stage: 'intake' }, 3),
      stamp({ altitude: 'L2', type: 'stage_enter', stage: 'draft' }, 4),
      stamp({ altitude: 'L2', type: 'round_close', round: 1, cap: 3 }, 5),
    ]
    const first = foldEvents(machine, events)
    const second = foldEvents(machine, events)
    expect(first.snapshot.context).toEqual(second.snapshot.context)
    expect(first.snapshot.value).toEqual(second.snapshot.value)
    expect(first.snapshot.status).toEqual(second.snapshot.status)
    expect(first.accounting).toEqual(second.accounting)
  })

  it('skips unknown event types without error and leaves state untouched', () => {
    const machine = linearMachine()
    const noise = [
      stamp({ altitude: 'L0', type: 'tool_use', agent: 'a', tool: 't' }, 1),
      stamp(
        {
          altitude: 'L1',
          type: 'done',
          agent: 'a',
          usage: { inputTokens: 1, outputTokens: 1, reasoningTokens: 1, costUsd: 0.1, wallMs: 1 },
        },
        2,
      ),
      stamp({ altitude: 'L2', type: 'finding', action: 'filed', id: 'f1', round: 1 }, 3),
      stamp({ altitude: 'L2', type: 'round_close', round: 1, cap: 3 }, 4),
    ]
    const result = foldEvents(machine, noise)
    expect(result.accounting).toEqual({ total: 4, mapped: 0, tolerated: 4 })
    expect(result.snapshot.value).toBe('start')
    expect(result.snapshot.context.stages).toEqual({ intake: 'pending', draft: 'pending', review: 'pending' })
  })

  it('a mapped event with no valid edge is a no-op, not an error', () => {
    const machine = linearMachine()
    const events = [
      stamp({ altitude: 'L2', type: 'stage_enter', stage: 'intake' }, 1),
      stamp({ altitude: 'L2', type: 'stage_enter', stage: 'review' }, 2),
    ]
    const result = foldEvents(machine, events)
    expect(result.snapshot.value).toBe('intake')
    expect(result.snapshot.context.stages['review']).toBe('pending')
    expect(result.accounting).toEqual({ total: 2, mapped: 2, tolerated: 0 })
  })

  it('foldLog reads a real fixture run dir end to end', () => {
    const machine = linearMachine()
    const logPath = path.join(
      import.meta.dir,
      '..',
      'fixtures',
      'real',
      '2026-08-19T11-58-01-530Z-6d279752',
      'events.ndjson',
    )
    const result = foldLog(machine, logPath)
    expect(result.snapshot.value).toBe('intake')
    expect(result.snapshot.context.stages['intake']).toBe('active')
    expect(result.accounting.total).toBe(22)
    expect(result.accounting.mapped).toBe(1)
  })

  it('foldEvents matches an explicit manual step fold', () => {
    const machine = linearMachine()
    const events = [
      stamp({ altitude: 'L2', type: 'stage_enter', stage: 'intake' }, 1),
      stamp({ altitude: 'L2', type: 'stage_exit', stage: 'intake' }, 2),
      stamp({ altitude: 'L2', type: 'stage_enter', stage: 'draft' }, 3),
    ]
    const folded = foldEvents(machine, events).snapshot
    const kernelEvents: readonly KernelEvent[] = events
      .map(toKernelEvent)
      .filter((event): event is KernelEvent => event !== null)
    let manual = initialStep(machine)[0]
    for (const event of kernelEvents) {
      manual = step(machine, manual, event)[0]
    }
    expect(folded.context).toEqual(manual.context)
    expect(folded.value).toEqual(manual.value)
  })
})
