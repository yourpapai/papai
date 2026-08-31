// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { EventInput, SddEvent, StageId } from '../../../afk-runner/src/events.js'
import { appendEvent, readEvents, stampEvent } from '../../../afk-runner/src/events.js'
import { pipelineMachine } from '../../../afk-runner/src/graph/pipeline.js'
import { foldEvents } from '../../../afk-runner/src/kernel/fold.js'
import type { GateAnswers } from '../../../afk-runner/src/work/gate-answers.js'
import { escalationExpectedContent, settleGateWithAnswers } from '../../../afk-runner/src/work/gate-settle.js'
import type { SettleInput } from '../../../afk-runner/src/work/gate-settle.js'
import { awaitGateSettle, translateSteer } from '../../../afk-runner/src/work/gate-waiter.js'
import type { GateWaiterPorts } from '../../../afk-runner/src/work/gate-waiter.js'

function gateEventsOf(events: readonly SddEvent[], action: 'rearmed' | 'answered'): SddEvent[] {
  return events.filter((event) => event.type === 'gate' && event.action === action)
}

const STAMP = new Date('2026-08-29T00:00:00.000Z')

const PRELUDE: readonly EventInput[] = [
  { altitude: 'L2', type: 'stage_enter', stage: 'intake' },
  { altitude: 'L2', type: 'depth', profile: 'S', rationale: 'one module', source: 'estimator' },
  { altitude: 'L2', type: 'stage_exit', stage: 'intake' },
  { altitude: 'L2', type: 'stage_enter', stage: 'draft' },
  { altitude: 'L2', type: 'stage_exit', stage: 'draft' },
  { altitude: 'L2', type: 'stage_enter', stage: 'review' },
  { altitude: 'L2', type: 'round_open', round: 1, cap: 1 },
  {
    altitude: 'L2',
    type: 'stage_failed',
    stage: 'review',
    kind: 'exhausted',
    reason: 'review round 1 failed after 2 attempts: schema invalid',
    resumeHint: 'resume the run',
  },
  {
    altitude: 'L2',
    type: 'stage_failed',
    stage: 'review',
    kind: 'exhausted',
    reason: 'review round 1 failed after 2 attempts: schema invalid',
    resumeHint: 'resume the run',
  },
  { altitude: 'L2', type: 'gate', action: 'presented', mode: 'escalation', version: 1 },
  { altitude: 'L2', type: 'auto_decision', rule: 'none', decision: 'gate', evidenceDigest: 'x', gateVersion: 1 },
]

interface Harness {
  readonly appended: EventInput[]
  readonly settleWith: (answers: GateAnswers) => ReturnType<typeof settleGateWithAnswers>
  readonly log: () => SddEvent[]
}

/** A parked ESCALATION gate (C6 D4): review failed twice, the presented event moved into the compound. */
function makeParkedEscalationGate(failedStage: StageId = 'review'): Harness {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-settle-esc-'))
  const changeDir = path.join(runDir, 'change')
  fs.mkdirSync(path.join(changeDir, 'specs'), { recursive: true })
  fs.writeFileSync(path.join(runDir, 'gate-hashes-1.json'), '{}\n')
  fs.writeFileSync(
    path.join(runDir, 'gate-1.md'),
    '<!-- gate-1.md -->\n\n## Escalation gate — review exhausted its retry budget\n\n- [ ] T1 I reviewed the failure ledger — approve retries the stage\n',
  )
  const appended: EventInput[] = []
  const emit = (event: EventInput): void => {
    appended.push(event)
  }
  const input: SettleInput = {
    gate: { emit, runDir, changeDir, driftCheck: (): Promise<void> => Promise.resolve() },
    version: 1,
    gateMode: 'escalation',
    failedStage,
    expected: escalationExpectedContent(),
    round: { current: 1, cap: 1 },
  }
  const stamp = (events: readonly EventInput[]): SddEvent[] =>
    [...PRELUDE, ...events].map((event, index) => stampEvent(event, index + 1, '2026-08-29T00:00:00.000Z'))
  return {
    appended,
    settleWith: (answers) => settleGateWithAnswers(input, answers),
    log: () => stamp(appended),
  }
}

describe('settle seam at escalation gates (C6 D4)', () => {
  it('approve appends the answered event then the exit+enter mover — fresh bracket, ledger cleared', async () => {
    const h = makeParkedEscalationGate()
    const result = await h.settleWith({
      items: [],
      blockerAnswers: [],
      acks: [{ id: 'T1', text: 'I reviewed the failure ledger' }],
      decision: 'approve',
    })
    expect(result.outcome).toBe('approve')
    expect(result.answeredMode).toBe('escalation')
    const events = h.log()
    expect(events.at(-3)).toMatchObject({ type: 'gate', action: 'answered', outcome: 'approve', mode: 'escalation' })
    expect(events.at(-2)).toMatchObject({ type: 'stage_exit', stage: 'review' })
    expect(events.at(-1)).toMatchObject({ type: 'stage_enter', stage: 'review' })
    const folded = foldEvents(pipelineMachine, events).snapshot
    expect(folded.value).toBe('review')
    expect(folded.context.stages['review']).toBe('active')
    expect(folded.context.stages['gate']).toBe('pending')
    // the retry runs as a fresh bracket: the exit cleared the ledger
    expect(folded.context.failures).toEqual({})
  })

  it('extend clears the ledger via the failed stage exit, then re-enters it', async () => {
    const h = makeParkedEscalationGate()
    const result = await h.settleWith({ items: [], blockerAnswers: [], acks: [], decision: 'extend' })
    expect(result.outcome).toBe('extend')
    const events = h.log()
    expect(events.at(-3)).toMatchObject({ type: 'gate', action: 'answered', outcome: 'extend', mode: 'escalation' })
    expect(events.at(-2)).toMatchObject({ type: 'stage_exit', stage: 'review' })
    expect(events.at(-1)).toMatchObject({ type: 'stage_enter', stage: 'review' })
    const folded = foldEvents(pipelineMachine, events).snapshot
    expect(folded.value).toBe('review')
    expect(folded.context.stages['review']).toBe('active')
    expect(folded.context.failures).toEqual({})
  })

  it('abort appends the answered event alone and reaches the aborted final', async () => {
    const h = makeParkedEscalationGate()
    const result = await h.settleWith({ items: [], blockerAnswers: [], acks: [], decision: 'abort' })
    expect(result.outcome).toBe('abort')
    expect(h.appended).toHaveLength(1)
    expect(h.log().at(-1)).toMatchObject({ type: 'gate', action: 'answered', outcome: 'abort', mode: 'escalation' })
    const folded = foldEvents(pipelineMachine, h.log()).snapshot
    expect(folded.value).toBe('aborted')
    expect(folded.status).toBe('done')
  })

  it('veto is not offered: a veto-shaped response is rejected at parse', async () => {
    const h = makeParkedEscalationGate()
    const settle = h.settleWith({
      items: [{ kind: 'assumption', id: 'A1', text: 'x', accepted: false }],
      blockerAnswers: [],
      acks: [{ id: 'T1', text: 'ack' }],
      decision: 'veto',
    })
    await expect(settle).rejects.toThrow(/unknown assumption A1/u)
    expect(h.appended).toHaveLength(0)
  })

  it('an unchecked required ack rejects — approve must be deliberate', async () => {
    const h = makeParkedEscalationGate()
    const settle = h.settleWith({
      items: [],
      blockerAnswers: [],
      acks: [],
      decision: 'approve',
    })
    await expect(settle).rejects.toThrow(/required ack T1/u)
  })
})

describe('steer answerability at escalation gates (C6 D6)', () => {
  it('extend is valid at an escalation gate (unlike final)', () => {
    const translated = translateSteer({ kind: 'extend' }, 'escalation')
    expect(translated.warn).toBeNull()
  })

  it('abort is valid', () => {
    const translated = translateSteer({ kind: 'abort' }, 'escalation')
    expect(translated.warn).toBeNull()
  })

  it('veto is invalid — no veto is offered at an escalation gate', () => {
    const translated = translateSteer({ kind: 'veto', id: 'A1' }, 'escalation')
    expect(translated.warn).toContain('veto is not valid at an escalation gate')
  })
})

describe('deadline expiry at an escalation gate inherits the standard path (C6 D5)', () => {
  function expiredEscalationGate(reArmed: boolean): {
    readonly runDir: string
    readonly start: () => ReturnType<typeof awaitGateSettle>
    readonly clock: { readonly release: () => void }
    readonly warnings: string[]
  } {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-esc-expiry-'))
    const logPath = path.join(runDir, 'events.ndjson')
    for (const event of PRELUDE) appendEvent(logPath, event, STAMP)
    const past = '2026-08-29T00:00:01.000Z'
    appendEvent(
      logPath,
      {
        altitude: 'L2',
        type: 'gate',
        action: 'presented',
        mode: 'escalation',
        version: 1,
        deadlineAt: past,
      },
      STAMP,
    )
    if (reArmed) {
      appendEvent(
        logPath,
        { altitude: 'L2', type: 'gate', action: 'rearmed', mode: 'escalation', version: 1, deadlineAt: past },
        STAMP,
      )
    }
    fs.writeFileSync(
      path.join(runDir, 'gate-1.md'),
      '<!-- gate-1.md -->\n\n## Escalation gate\n\n- [ ] T1 I reviewed the failure ledger\n',
    )
    const queue: Array<() => void> = []
    const clock = {
      release: (): void => {
        const resolve = queue.shift()
        if (resolve !== undefined) resolve()
      },
    }
    const warnings: string[] = []
    const ports: GateWaiterPorts = {
      runDir,
      logPath,
      sidecarDir: path.join(runDir, 'sidecars'),
      changeDir: path.join(runDir, 'change'),
      machine: pipelineMachine,
      emit: (event) => {
        appendEvent(logPath, event)
      },
      tick: (): Promise<void> =>
        new Promise((resolve) => {
          queue.push(resolve)
        }),
      stdout: (line) => {
        warnings.push(line)
      },
      repoRoot: runDir,
      autonomy: { level: 'assist', costCeilingUsd: 5, metered: true },
      now: () => new Date('2026-08-29T00:01:00.000Z'),
    }
    return { runDir, start: () => awaitGateSettle(ports), clock, warnings }
  }

  async function releaseTick(clock: { readonly release: () => void }): Promise<void> {
    clock.release()
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })
  }

  it('no conservative branch exists: re-arm once via one additive event, then stay pending — never abort', async () => {
    const h = expiredEscalationGate(false)
    const waiter = h.start()
    await releaseTick(h.clock)
    await releaseTick(h.clock)
    const probe = await Promise.race([waiter.then((r) => r), Promise.resolve('still-waiting' as const)])
    expect(probe).toBe('still-waiting')
    const events = readEvents(path.join(h.runDir, 'events.ndjson'))
    expect(gateEventsOf(events, 'rearmed')).toHaveLength(1)
    expect(gateEventsOf(events, 'answered')).toHaveLength(0)
    expect(h.warnings.some((line) => line.includes('re-armed once'))).toBe(true)
  })

  it('after the one re-arm the gate stays pending forever', async () => {
    const h = expiredEscalationGate(true)
    const waiter = h.start()
    await releaseTick(h.clock)
    await releaseTick(h.clock)
    const probe = await Promise.race([waiter.then((r) => r), Promise.resolve('still-waiting' as const)])
    expect(probe).toBe('still-waiting')
    const events = readEvents(path.join(h.runDir, 'events.ndjson'))
    expect(gateEventsOf(events, 'rearmed')).toHaveLength(1)
    expect(h.warnings.some((line) => line.includes('gate stays pending'))).toBe(true)
  })
})
