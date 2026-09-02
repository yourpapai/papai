// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { EventInput, SddEvent } from '../../../afk-runner/src/events.js'
import { stampEvent } from '../../../afk-runner/src/events.js'
import { pipelineMachine } from '../../../afk-runner/src/graph/pipeline.js'
import { foldEvents } from '../../../afk-runner/src/kernel/fold.js'
import type { GateAnswers } from '../../../afk-runner/src/work/gate-answers.js'
import { settleGateWithAnswers } from '../../../afk-runner/src/work/gate-settle.js'
import type { SettleInput } from '../../../afk-runner/src/work/gate-settle.js'

interface FinalHarness {
  readonly appended: EventInput[]
  readonly settleWith: (answers: GateAnswers) => ReturnType<typeof settleGateWithAnswers>
  readonly log: () => SddEvent[]
}

/** Narrow an answers settle to its settled shape — throws (failing the test) on a rejection. */
function settledOf(result: Awaited<ReturnType<typeof settleGateWithAnswers>>): { outcome: string } {
  if ('kind' in result) throw new Error(`expected a settled result, got rejection: ${result.reason}`)
  return result
}

/**
 * A parked FINAL gate (C5 tail shape): the walk entered the gate compound
 * through the tail's presentation and the bracket closed from awaiting.
 */
function makeParkedFinalGate(): FinalHarness {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-settle-final-'))
  const changeDir = path.join(runDir, 'change')
  fs.mkdirSync(path.join(changeDir, 'specs'), { recursive: true })
  fs.writeFileSync(path.join(changeDir, 'proposal.md'), 'hello')
  fs.writeFileSync(path.join(runDir, 'gate-hashes-1.json'), '{}\n')
  const appended: EventInput[] = []
  const emit = (event: EventInput): void => {
    appended.push(event)
  }
  const input: SettleInput = {
    gate: { emit, runDir, changeDir, driftCheck: (): Promise<void> => Promise.resolve() },
    version: 1,
    gateMode: 'final',
    expected: {
      assumptions: [{ id: 'A1', text: 'guests stay read-only', blast_radius: 'group replies' }],
      blockers: [],
      gateMode: 'final',
    },
    round: { current: 1, cap: 3 },
  }
  const PRELUDE: readonly EventInput[] = [
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
  const stamp = (events: readonly EventInput[]): SddEvent[] =>
    [...PRELUDE, ...events].map((event, index) => stampEvent(event, index + 1, '2026-08-27T00:00:00.000Z'))
  return {
    appended,
    settleWith: (answers) => settleGateWithAnswers(input, answers),
    log: () => stamp(appended),
  }
}

describe('settle seam at final gates — outcome-ordered settlement (C5 D3)', () => {
  it('approve appends the gate stage exit before the answered event and completes on the answer', async () => {
    const h = makeParkedFinalGate()
    const result = settledOf(
      await h.settleWith({
        items: [{ kind: 'assumption', id: 'A1', text: 'guests stay read-only', accepted: true }],
        blockerAnswers: [],
        acks: [],
        decision: 'approve',
      }),
    )
    expect(result.outcome).toBe('approve')
    const events = h.log()
    expect(events.at(-2)).toMatchObject({ type: 'stage_exit', stage: 'gate' })
    expect(events.at(-1)).toMatchObject({ type: 'gate', action: 'answered', outcome: 'approve', mode: 'final' })
    const folded = foldEvents(pipelineMachine, events).snapshot
    expect(folded.value).toBe('completed')
    expect(folded.status).toBe('done')
    expect(folded.context.stages['gate']).toBe('done')
  })

  it('extend appends answered first (no completion), then the exit, then the round_open mover', async () => {
    const h = makeParkedFinalGate()
    const result = settledOf(await h.settleWith({ items: [], blockerAnswers: [], acks: [], decision: 'extend' }))
    expect(result.outcome).toBe('extend')
    const events = h.log()
    expect(events.at(-3)).toMatchObject({ type: 'gate', action: 'answered', outcome: 'extend', mode: 'final' })
    expect(events.at(-2)).toMatchObject({ type: 'stage_exit', stage: 'gate' })
    expect(events.at(-1)).toMatchObject({ type: 'round_open', round: 2, cap: 4 })
    const folded = foldEvents(pipelineMachine, events).snapshot
    expect(folded.value).toBe('review')
    expect(folded.status).toBe('active')
    expect(folded.context.round).toEqual({ current: 2, cap: 4 })
  })

  it('veto appends answered, exit, then the stage_enter(draft) mover — completed is never reached', async () => {
    const h = makeParkedFinalGate()
    const result = settledOf(
      await h.settleWith({
        items: [{ kind: 'assumption', id: 'A1', text: 'guests stay read-only', accepted: false, redirect: 'dm-only' }],
        blockerAnswers: [],
        acks: [],
        decision: 'veto',
      }),
    )
    expect(result.outcome).toBe('veto')
    const events = h.log()
    expect(events.at(-3)).toMatchObject({ type: 'gate', action: 'answered', outcome: 'veto', mode: 'final' })
    expect(events.at(-2)).toMatchObject({ type: 'stage_exit', stage: 'gate' })
    expect(events.at(-1)).toMatchObject({ type: 'stage_enter', stage: 'draft' })
    const folded = foldEvents(pipelineMachine, events).snapshot
    expect(folded.value).toBe('draft')
    expect(folded.status).toBe('active')
  })

  it('abort appends the answered event alone and reaches the aborted final', async () => {
    const h = makeParkedFinalGate()
    const result = settledOf(await h.settleWith({ items: [], blockerAnswers: [], acks: [], decision: 'abort' }))
    expect(result.outcome).toBe('abort')
    expect(h.appended).toHaveLength(1)
    expect(h.log().at(-1)).toMatchObject({ type: 'gate', action: 'answered', outcome: 'abort', mode: 'final' })
    const folded = foldEvents(pipelineMachine, h.log()).snapshot
    expect(folded.value).toBe('aborted')
    expect(folded.status).toBe('done')
  })
})
