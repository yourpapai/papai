// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import path from 'node:path'

import { stampEvent } from '../../../afk-runner/src/events.js'
import type { SddEvent } from '../../../afk-runner/src/events.js'
import { pipelineMachine } from '../../../afk-runner/src/graph/pipeline.js'
import { foldEvents, foldLog, toKernelEvent } from '../../../afk-runner/src/kernel/fold.js'
import { createKernelMachine, initialKernelContext, initialStep, step } from '../../../afk-runner/src/kernel/machine.js'
import type { KernelEvent } from '../../../afk-runner/src/kernel/machine.js'
import { createReplayFolder } from '../../../afk-runner/src/legacy-fold.js'

function linearMachine(): ReturnType<typeof createKernelMachine> {
  return createKernelMachine({
    id: 'linear',
    initial: 'start',
    context: initialKernelContext({ intake: 'pending', draft: 'pending', review: 'pending' }),
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
    ).toEqual({ type: 'gate.presented', mode: 'final', version: 1 })
    expect(
      toKernelEvent(stamp({ altitude: 'L2', type: 'gate', action: 'answered', mode: 'final', version: 1 }, 4)),
    ).toEqual({ type: 'gate.answered' })
    expect(toKernelEvent(stamp({ altitude: 'L0', type: 'tool_use', agent: 'a', tool: 't' }, 5))).toBeNull()
    expect(
      toKernelEvent(
        stamp(
          {
            altitude: 'L1',
            type: 'done',
            agent: 'a',
            usage: { inputTokens: 1, outputTokens: 1, reasoningTokens: 1, costUsd: 0.1, wallMs: 1 },
          },
          6,
        ),
      ),
    ).toBeNull()
  })

  it('maps every derived-state log event to its dot-notation kernel event', () => {
    expect(
      toKernelEvent(stamp({ altitude: 'L2', type: 'depth', profile: 'S', rationale: 'r', source: 'override' }, 1)),
    ).toEqual({
      type: 'depth',
      profile: 'S',
    })
    expect(toKernelEvent(stamp({ altitude: 'L2', type: 'round_open', round: 1, cap: 3 }, 2))).toEqual({
      type: 'round.open',
      round: 1,
      cap: 3,
    })
    expect(toKernelEvent(stamp({ altitude: 'L2', type: 'round_close', round: 1, cap: 3 }, 3))).toEqual({
      type: 'round.close',
      round: 1,
      cap: 3,
    })
    expect(
      toKernelEvent(stamp({ altitude: 'L2', type: 'finding', action: 'resolved', id: 'f1', round: 1 }, 4)),
    ).toEqual({
      type: 'finding',
      action: 'resolved',
      round: 1,
    })
    expect(toKernelEvent(stamp({ altitude: 'L2', type: 'finding', action: 'filed', id: 'f2', round: 1 }, 5))).toEqual({
      type: 'finding',
      action: 'filed',
      round: 1,
    })
    expect(
      toKernelEvent(
        stamp(
          {
            altitude: 'L2',
            type: 'convergence',
            round: 1,
            verdict: 'converged',
            counts: { blocker: 0, material: 0, nitpick: 0 },
          },
          6,
        ),
      ),
    ).toEqual({ type: 'convergence', round: 1, verdict: 'converged', counts: { blocker: 0, material: 0, nitpick: 0 } })
    expect(
      toKernelEvent(
        stamp(
          {
            altitude: 'L2',
            type: 'auto_decision',
            rule: 'R1',
            decision: 'approve',
            evidenceDigest: 'd',
            gateVersion: 2,
          },
          7,
        ),
      ),
    ).toEqual({
      type: 'auto.decision',
      rule: 'R1',
      decision: 'approve',
      evidenceDigest: 'd',
      gateVersion: 2,
      seq: 7,
      ts: '2026-08-27T00:00:00.000Z',
    })
    expect(toKernelEvent(stamp({ altitude: 'L2', type: 'plan', childCount: 3, digest: 'x' }, 8))).toEqual({
      type: 'plan',
    })
    expect(toKernelEvent(stamp({ altitude: 'L2', type: 'child_spawned', child: 'c1' }, 9))).toEqual({
      type: 'child.spawned',
      child: 'c1',
    })
    expect(toKernelEvent(stamp({ altitude: 'L2', type: 'child_done', child: 'c1', outcome: 'failed' }, 10))).toEqual({
      type: 'child.done',
      child: 'c1',
      outcome: 'failed',
    })
  })

  it('maps gate answered/presented optional outcome/deadlineAt when present, absent on historical logs', () => {
    expect(
      toKernelEvent(
        stamp({ altitude: 'L2', type: 'gate', action: 'answered', mode: 'early', version: 1, outcome: 'extend' }, 1),
      ),
    ).toEqual({ type: 'gate.answered', outcome: 'extend' })
    expect(
      toKernelEvent(stamp({ altitude: 'L2', type: 'gate', action: 'answered', mode: 'early', version: 1 }, 2)),
    ).toEqual({ type: 'gate.answered' })
    expect(
      toKernelEvent(
        stamp(
          {
            altitude: 'L2',
            type: 'gate',
            action: 'presented',
            mode: 'final',
            version: 2,
            deadlineAt: '2026-09-01T00:00:00.000Z',
          },
          3,
        ),
      ),
    ).toEqual({ type: 'gate.presented', mode: 'final', version: 2, deadlineAt: '2026-09-01T00:00:00.000Z' })
    expect(
      toKernelEvent(stamp({ altitude: 'L2', type: 'gate', action: 'presented', mode: 'final', version: 2 }, 4)),
    ).toEqual({ type: 'gate.presented', mode: 'final', version: 2 })
  })

  it('folds outcome/deadlineAt into non-projected context residue; historical logs stay null', () => {
    const kernel = foldEvents(pipelineMachine, [
      stamp(
        {
          altitude: 'L2',
          type: 'gate',
          action: 'presented',
          mode: 'early',
          version: 1,
          deadlineAt: '2026-09-01T00:00:00.000Z',
        },
        1,
      ),
      stamp({ altitude: 'L2', type: 'gate', action: 'answered', mode: 'early', version: 1, outcome: 'extend' }, 2),
    ])
    expect(kernel.snapshot.context.gateOutcome).toBe('extend')
    expect(kernel.snapshot.context.gateDeadlineAt).toBe('2026-09-01T00:00:00.000Z')
    expect(kernel.snapshot.context.gate).toEqual({ mode: 'early', version: 1, answered: true })

    const historical = foldEvents(pipelineMachine, [
      stamp({ altitude: 'L2', type: 'gate', action: 'presented', mode: 'early', version: 1 }, 1),
      stamp({ altitude: 'L2', type: 'gate', action: 'answered', mode: 'early', version: 1 }, 2),
    ])
    expect(historical.snapshot.context.gateOutcome).toBeNull()
    expect(historical.snapshot.context.gateDeadlineAt).toBeNull()

    const rePresented = foldEvents(pipelineMachine, [
      stamp({ altitude: 'L2', type: 'gate', action: 'presented', mode: 'early', version: 1 }, 1),
      stamp({ altitude: 'L2', type: 'gate', action: 'answered', mode: 'early', version: 1, outcome: 'extend' }, 2),
      stamp({ altitude: 'L2', type: 'gate', action: 'presented', mode: 'early', version: 2 }, 3),
    ])
    expect(rePresented.snapshot.context.gateOutcome).toBeNull()
    expect(rePresented.snapshot.context.gateDeadlineAt).toBeNull()
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
    expect(result.accounting).toEqual({ total: 4, mapped: 4, tolerated: 0 })
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

  it('folding a full derived-state log twice deep-equals the whole context, scratch tally residue included', () => {
    const events = [
      stamp({ altitude: 'L2', type: 'depth', profile: 'S', rationale: 'r', source: 'estimator' }, 1),
      stamp({ altitude: 'L2', type: 'round_open', round: 1, cap: 3 }, 2),
      stamp({ altitude: 'L2', type: 'finding', action: 'resolved', id: 'f1', round: 1 }, 3),
      stamp({ altitude: 'L2', type: 'finding', action: 'dismissed', id: 'f2', round: 1 }, 4),
      stamp({ altitude: 'L2', type: 'finding', action: 'filed', id: 'f3', round: 2 }, 5),
      stamp({ altitude: 'L2', type: 'finding', action: 'resolved', id: 'f4', round: 2 }, 6),
      stamp(
        {
          altitude: 'L2',
          type: 'convergence',
          round: 1,
          verdict: 'open',
          counts: { blocker: 1, material: 0, nitpick: 2 },
        },
        7,
      ),
      stamp(
        {
          altitude: 'L2',
          type: 'auto_decision',
          rule: 'R2',
          decision: 'extend',
          evidenceDigest: 'd',
          gateVersion: 1,
        },
        8,
      ),
    ]
    const first = foldEvents(pipelineMachine, events)
    const second = foldEvents(pipelineMachine, events)
    expect(first.snapshot.context).toEqual(second.snapshot.context)
    expect(first.snapshot.context).toEqual({
      stages: {
        intake: 'pending',
        draft: 'pending',
        review: 'pending',
        decompose: 'pending',
        atomicity: 'pending',
        gate: 'pending',
      },
      depth: 'S',
      round: { current: 1, cap: 3 },
      perRound: [
        {
          round: 1,
          counts: { blocker: 1, material: 0, nitpick: 2 },
          open: { blocker: 1, material: 0, nitpick: 2 },
          concerns: [],
          resolved: 1,
          dismissed: 1,
          verdict: 'open',
        },
      ],
      lastVerdict: {
        round: 1,
        counts: { blocker: 1, material: 0, nitpick: 2 },
        open: { blocker: 1, material: 0, nitpick: 2 },
        concerns: [],
        resolved: 1,
        dismissed: 1,
        verdict: 'open',
      },
      gate: null,
      autoDecisions: [
        {
          rule: 'R2',
          decision: 'extend',
          evidenceDigest: 'd',
          gateVersion: 1,
          seq: 8,
          ts: '2026-08-27T00:00:00.000Z',
        },
      ],
      children: {},
      tally: { 2: { resolved: 1, dismissed: 0 } },
      gateOutcome: null,
      gateDeadlineAt: null,
      gateDeadlineReArmed: false,
      failures: {},
      failureKinds: {},
    })
  })

  it('scratch tally residue matches legacy Map semantics: converged rounds clear, unconverged rounds stay', () => {
    const events = [
      stamp({ altitude: 'L2', type: 'round_open', round: 1, cap: 3 }, 1),
      stamp({ altitude: 'L2', type: 'finding', action: 'resolved', id: 'f1', round: 1 }, 2),
      stamp({ altitude: 'L2', type: 'finding', action: 'dismissed', id: 'f2', round: 1 }, 3),
      stamp({ altitude: 'L2', type: 'round_open', round: 2, cap: 3 }, 4),
      stamp({ altitude: 'L2', type: 'finding', action: 'resolved', id: 'f3', round: 2 }, 5),
      stamp({ altitude: 'L2', type: 'finding', action: 'resolved', id: 'f4', round: 2 }, 6),
      stamp(
        {
          altitude: 'L2',
          type: 'convergence',
          round: 2,
          verdict: 'converged',
          counts: { blocker: 0, material: 0, nitpick: 0 },
        },
        7,
      ),
    ]
    const legacy = createReplayFolder()
    for (const event of events) legacy.fold(event)
    const kernel = foldEvents(pipelineMachine, events)
    expect(kernel.snapshot.context.perRound).toEqual([
      {
        round: 2,
        counts: { blocker: 0, material: 0, nitpick: 0 },
        open: { blocker: 0, material: 0, nitpick: 0 },
        concerns: [],
        resolved: 2,
        dismissed: 0,
        verdict: 'converged',
      },
    ])
    expect(legacy.state.perRound).toEqual(kernel.snapshot.context.perRound)
    expect(kernel.snapshot.context.tally).toEqual({ 1: { resolved: 1, dismissed: 1 } })
  })

  it('tolerates unmapped noise and mapped-but-edge-less events without error or state change', () => {
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
    expect(result.accounting).toEqual({ total: 4, mapped: 2, tolerated: 2 })
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

describe('convergence carries both count sets through the kernel fold', () => {
  const raised = { blocker: 1, material: 2, nitpick: 0 }
  const open = { blocker: 0, material: 1, nitpick: 0 }

  it('translates the open set onto the kernel event', () => {
    expect(
      toKernelEvent(
        stamp({ altitude: 'L2', type: 'convergence', round: 1, verdict: 'needs-review', counts: raised, open }, 1),
      ),
    ).toEqual({ type: 'convergence', round: 1, verdict: 'needs-review', counts: raised, open })
  })

  it('omits the open set for a pre-change line, folding it as equal to counts', () => {
    const { snapshot } = foldEvents(pipelineMachine, [
      stamp({ altitude: 'L2', type: 'convergence', round: 1, verdict: 'open', counts: raised }, 1),
    ])
    expect(snapshot.context.lastVerdict).toMatchObject({ counts: raised, open: raised })
  })

  it('stamps the open set on perRound records and lastVerdict', () => {
    const { snapshot } = foldEvents(pipelineMachine, [
      stamp({ altitude: 'L2', type: 'round_open', round: 1, cap: 3 }, 1),
      stamp({ altitude: 'L2', type: 'convergence', round: 1, verdict: 'needs-review', counts: raised, open }, 2),
    ])
    expect(snapshot.context.perRound[0]).toMatchObject({ verdict: 'needs-review', counts: raised, open })
    expect(snapshot.context.lastVerdict).toMatchObject({ open })
  })
})

describe('kernel fold — loop-memory additive concerns (D5)', () => {
  const concernsCounts = { blocker: 1, material: 2, nitpick: 0 }
  it('translates concerns onto the kernel convergence event and stamps the record; a pre-change line folds []', () => {
    expect(
      toKernelEvent(
        stamp(
          {
            altitude: 'L2',
            type: 'convergence',
            round: 3,
            verdict: 'open',
            counts: concernsCounts,
            concerns: ['fingerprint a'],
          },
          1,
        ),
      ),
    ).toEqual({
      type: 'convergence',
      round: 3,
      verdict: 'open',
      counts: concernsCounts,
      concerns: ['fingerprint a'],
    })
    const { snapshot } = foldEvents(pipelineMachine, [
      stamp({ altitude: 'L2', type: 'round_open', round: 3, cap: 3 }, 1),
      stamp(
        {
          altitude: 'L2',
          type: 'convergence',
          round: 3,
          verdict: 'open',
          counts: concernsCounts,
          concerns: ['fingerprint a'],
        },
        2,
      ),
      stamp({ altitude: 'L2', type: 'round_open', round: 4, cap: 4 }, 3),
      stamp({ altitude: 'L2', type: 'convergence', round: 4, verdict: 'converged', counts: concernsCounts }, 4),
    ])
    expect(snapshot.context.perRound[0]).toMatchObject({ concerns: ['fingerprint a'] })
    expect(snapshot.context.perRound[1]).toMatchObject({ concerns: [] })
    expect(snapshot.context.lastVerdict).toMatchObject({ concerns: [] })
  })
})
