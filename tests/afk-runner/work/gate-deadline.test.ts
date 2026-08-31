// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { appendEvent } from '../../../afk-runner/src/events.js'
import type { EventInput, SddEvent } from '../../../afk-runner/src/events.js'
import { readEvents } from '../../../afk-runner/src/events.js'
import { stampEvent } from '../../../afk-runner/src/events.js'
import { pipelineMachine } from '../../../afk-runner/src/graph/pipeline.js'
import { foldEvents } from '../../../afk-runner/src/kernel/fold.js'
import { startRun } from '../../../afk-runner/src/run.js'
import { awaitGateSettle } from '../../../afk-runner/src/work/gate-waiter.js'
import type { GateWaiterPorts } from '../../../afk-runner/src/work/gate-waiter.js'
import { makeFakePipeline, TASK_TEXT } from '../fixtures/fake-pipeline.js'

const MATERIAL_ROUND = {
  'findings-1.json': JSON.stringify({
    findings: [
      {
        id: 'F1',
        class: 'MATERIAL',
        gap: 'proposal lacks a rollback story',
        question: 'how do we roll back?',
        code_evidence_attempted: 'searched the repo, none found',
      },
    ],
  }),
  'resolutions-1.json': JSON.stringify({
    resolutions: [{ id: 'F1', class: 'MATERIAL', resolution: 'evidence-answered', outcome: 'kept as documented' }],
    assumptions: [],
  }),
}

function epochOf(at: string | null): number {
  return new Date(at ?? '1970-01-01T00:00:00.000Z').getTime()
}

function presentedEvents(events: readonly SddEvent[]): SddEvent[] {
  return events.filter((event) => event.type === 'gate' && event.action === 'presented')
}

function answeredGateEvents(events: readonly SddEvent[]): SddEvent[] {
  return events.filter((event) => event.type === 'gate' && event.action === 'answered')
}

function rearmedEvents(events: readonly SddEvent[]): SddEvent[] {
  return events.filter((event) => event.type === 'gate' && event.action === 'rearmed')
}

function autoDecisionEvents(events: readonly SddEvent[]): Extract<SddEvent, { type: 'auto_decision' }>[] {
  return events.flatMap((event) => (event.type === 'auto_decision' ? [event] : []))
}

function answeredGateIndexOf(events: readonly SddEvent[]): number {
  return events.findIndex((event) => event.type === 'gate' && event.action === 'answered')
}

function sha256Of(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

function gateDeadlineOf(event: SddEvent | undefined): string | null {
  if (event === undefined || event.type !== 'gate') return null
  if ('deadlineAt' in event && event.deadlineAt !== undefined) return event.deadlineAt
  return null
}

describe('gate deadline — presentation stamp (C4 9.1)', () => {
  it('stamps an absolute deadlineAt when configured; nothing when unconfigured', async () => {
    const configured = makeFakePipeline({ sidecarOverrides: MATERIAL_ROUND })
    const before = Date.now()
    const started = await startRun(
      { ...configured.deps, config: { ...configured.deps.config, deadline: 30 } },
      { taskText: TASK_TEXT },
    )
    const runDir = configured.runDirOf(started.runId)
    const presented = presentedEvents(readEvents(path.join(runDir, 'events.ndjson')))[0]
    const deadlineAt = gateDeadlineOf(presented)
    expect(deadlineAt).not.toBeNull()
    const delta = epochOf(deadlineAt) - before
    expect(delta).toBeGreaterThan(29 * 60_000)
    expect(delta).toBeLessThan(31 * 60_000)

    const bare = makeFakePipeline({ sidecarOverrides: MATERIAL_ROUND })
    const bareStarted = await startRun(bare.deps, { taskText: TASK_TEXT })
    const barePresented = presentedEvents(readEvents(path.join(bare.runDirOf(bareStarted.runId), 'events.ndjson')))
    expect(barePresented).toHaveLength(1)
    expect(gateDeadlineOf(barePresented[0])).toBeNull()
  })
})

describe('gate deadline — rearmed events fold into the residue', () => {
  it('presented stamps the deadline and resets the re-arm flag; rearmed restamps and sets it', () => {
    const stamp = (input: EventInput, seq: number): SddEvent => stampEvent(input, seq, '2026-08-27T00:00:00.000Z')
    const presented = foldEvents(pipelineMachine, [
      stamp(
        {
          altitude: 'L2',
          type: 'gate',
          action: 'presented',
          mode: 'early',
          version: 1,
          deadlineAt: '2026-08-27T01:00:00.000Z',
        },
        1,
      ),
    ]).snapshot.context
    expect(presented.gateDeadlineAt).toBe('2026-08-27T01:00:00.000Z')
    expect(presented.gateDeadlineReArmed).toBe(false)

    const rearmed = foldEvents(pipelineMachine, [
      stamp(
        {
          altitude: 'L2',
          type: 'gate',
          action: 'presented',
          mode: 'early',
          version: 1,
          deadlineAt: '2026-08-27T01:00:00.000Z',
        },
        1,
      ),
      stamp(
        {
          altitude: 'L2',
          type: 'gate',
          action: 'rearmed',
          mode: 'early',
          version: 1,
          deadlineAt: '2026-08-27T02:00:00.000Z',
        },
        2,
      ),
    ]).snapshot.context
    expect(rearmed.gateDeadlineAt).toBe('2026-08-27T02:00:00.000Z')
    expect(rearmed.gateDeadlineReArmed).toBe(true)
  })
})

interface ExpiryHarness {
  readonly runDir: string
  readonly start: () => ReturnType<typeof awaitGateSettle>
  readonly clock: ReturnType<typeof fakeClock>
  readonly warnings: string[]
}

function fakeClock(): { readonly tick: () => Promise<void>; readonly release: () => void } {
  const queue: Array<() => void> = []
  return {
    tick: () =>
      new Promise<void>((resolve) => {
        queue.push(resolve)
      }),
    release: () => {
      const resolve = queue.shift()
      if (resolve !== undefined) resolve()
    },
  }
}

function expiredGate(options: {
  readonly trajectory?: boolean
  readonly preClaimed?: boolean
  readonly reArmed?: boolean
  readonly unmetered?: boolean
  readonly costUnknown?: boolean
}): ExpiryHarness {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-deadline-'))
  const changeDir = path.join(runDir, 'change')
  const sidecarDir = path.join(runDir, 'sidecars')
  fs.mkdirSync(sidecarDir, { recursive: true })
  fs.mkdirSync(path.join(changeDir, 'specs'), { recursive: true })
  fs.writeFileSync(path.join(changeDir, 'proposal.md'), 'hello')
  const resolutions = MATERIAL_ROUND['resolutions-1.json'] ?? '{}'
  fs.writeFileSync(path.join(sidecarDir, 'resolutions-1.json'), resolutions)
  if (options.trajectory === true) {
    // the capped round is round 2 in the trajectory variant — its resolver
    // sidecar is what the expiry ladder reads
    fs.writeFileSync(path.join(sidecarDir, 'resolutions-2.json'), resolutions)
  }
  const logPath = path.join(runDir, 'events.ndjson')
  const prelude: readonly EventInput[] = [
    { altitude: 'L2', type: 'stage_enter', stage: 'intake' },
    { altitude: 'L2', type: 'stage_exit', stage: 'intake' },
    { altitude: 'L2', type: 'stage_enter', stage: 'draft' },
    { altitude: 'L2', type: 'stage_exit', stage: 'draft' },
    { altitude: 'L2', type: 'stage_enter', stage: 'review' },
    { altitude: 'L2', type: 'round_open', round: 1, cap: 1 },
    { altitude: 'L2', type: 'stage_exit', stage: 'review' },
  ]
  const trajectory: readonly EventInput[] =
    options.trajectory === true
      ? [
          {
            altitude: 'L2',
            type: 'convergence',
            round: 1,
            verdict: 'open',
            counts: { blocker: 0, material: 3, nitpick: 0 },
          },
          { altitude: 'L2', type: 'round_open', round: 2, cap: 2 },
          {
            altitude: 'L2',
            type: 'convergence',
            round: 2,
            verdict: 'open',
            counts: { blocker: 0, material: 1, nitpick: 0 },
          },
        ]
      : []
  for (const event of [...prelude, ...trajectory]) {
    appendEvent(logPath, event, new Date('2026-08-27T00:00:00.000Z'))
  }
  if (options.costUnknown === true) {
    // subscription shape: a done agent with tokens moved but costUsd 0 —
    // repricing falls through to unknown, so costKnown folds false
    appendEvent(
      logPath,
      {
        altitude: 'L1',
        type: 'done',
        agent: 'drafter',
        usage: { inputTokens: 100, outputTokens: 10, reasoningTokens: 0, costUsd: 0, wallMs: 1_000 },
      },
      new Date('2026-08-27T00:00:00.000Z'),
    )
  }
  const past = '2026-08-27T00:00:01.000Z'
  appendEvent(logPath, {
    altitude: 'L2',
    type: 'gate',
    action: 'presented',
    mode: 'early',
    version: 1,
    deadlineAt: past,
  })
  if (options.reArmed === true) {
    appendEvent(logPath, {
      altitude: 'L2',
      type: 'gate',
      action: 'rearmed',
      mode: 'early',
      version: 1,
      deadlineAt: past,
    })
  }
  fs.writeFileSync(path.join(runDir, 'gate-1.md'), `<!-- gate-1.md -->\n\n## Early gate (cap hit) — change add-thing\n`)
  fs.writeFileSync(path.join(runDir, 'gate-hashes-1.json'), '{}\n')
  if (options.preClaimed === true) {
    fs.writeFileSync(path.join(runDir, 'gate-1.settle-claim'), 'someone-else\n')
  }
  const clock = fakeClock()
  const warnings: string[] = []
  const ports: GateWaiterPorts = {
    runDir,
    logPath,
    sidecarDir,
    changeDir,
    machine: pipelineMachine,
    emit: (event) => {
      appendEvent(logPath, event)
    },
    tick: clock.tick,
    stdout: (line) => {
      warnings.push(line)
    },
    repoRoot: runDir,
    autonomy:
      options.unmetered === true
        ? { level: 'assist', costCeilingUsd: null, metered: false }
        : { level: 'assist', costCeilingUsd: 5, metered: true },
    now: () => new Date('2026-08-27T00:01:00.000Z'),
  }
  return { runDir, start: () => awaitGateSettle(ports), clock, warnings }
}

async function releaseTick(clock: { readonly release: () => void }): Promise<void> {
  clock.release()
  await new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

describe('gate deadline — expiry (C4 9.2)', () => {
  it('an expired gate with a conservative branch (R2) settles extend through the seam, never abort', async () => {
    const h = expiredGate({ trajectory: true })
    const waiter = h.start()
    await releaseTick(h.clock)
    const result = await waiter
    expect(result).toEqual({ kind: 'settled', outcome: 'extend' })
    expect(fs.existsSync(path.join(h.runDir, 'gate-1.settle-claim'))).toBe(false)
    const events = readEvents(path.join(h.runDir, 'events.ndjson'))
    expect(answeredGateEvents(events).length).toBe(1)
  })

  it('no conservative branch: re-arm once via one additive event, then stay pending', async () => {
    const h = expiredGate({ trajectory: false })
    const waiter = h.start()
    await releaseTick(h.clock)
    await releaseTick(h.clock)
    const probe = await Promise.race([waiter.then((r) => r), Promise.resolve('still-waiting' as const)])
    expect(probe).toBe('still-waiting')
    const rearmed = rearmedEvents(readEvents(path.join(h.runDir, 'events.ndjson')))
    expect(rearmed).toHaveLength(1)
    expect(h.warnings.some((line) => line.includes('re-armed once'))).toBe(true)
  })

  it('a second expiry after the one re-arm never re-arms again', async () => {
    const h = expiredGate({ trajectory: false, reArmed: true })
    const waiter = h.start()
    await releaseTick(h.clock)
    await releaseTick(h.clock)
    const probe = await Promise.race([waiter.then((r) => r), Promise.resolve('still-waiting' as const)])
    expect(probe).toBe('still-waiting')
    const rearmed = rearmedEvents(readEvents(path.join(h.runDir, 'events.ndjson')))
    expect(rearmed).toHaveLength(1)
    expect(h.warnings.some((line) => line.includes('gate stays pending'))).toBe(true)
  })

  it('the expiry claim loser exits as external', async () => {
    const h = expiredGate({ trajectory: true, preClaimed: true })
    const waiter = h.start()
    await releaseTick(h.clock)
    await expect(waiter).resolves.toEqual({ kind: 'external' })
  })
})

describe('gate deadline — waiter auto_decision protocol (D3)', () => {
  it('a claiming waiter settle appends auto_decision naming the deciding rule after the settle write', async () => {
    const h = expiredGate({ trajectory: true })
    const waiter = h.start()
    await releaseTick(h.clock)
    const result = await waiter
    expect(result).toEqual({ kind: 'settled', outcome: 'extend' })
    const events = readEvents(path.join(h.runDir, 'events.ndjson'))
    const decisions = autoDecisionEvents(events)
    expect(decisions).toHaveLength(1)
    expect(decisions[0]).toMatchObject({ rule: 'R2', decision: 'extend', gateVersion: 1 })
    const answeredAt = answeredGateIndexOf(events)
    expect(answeredAt).toBeGreaterThanOrEqual(0)
    expect(events.indexOf(decisions[0]!)).toBeGreaterThan(answeredAt)
  })

  it('re-arm appends none/pending after the rearmed event; the rearmed flow itself is unchanged', async () => {
    const h = expiredGate({ trajectory: false })
    const waiter = h.start()
    await releaseTick(h.clock)
    await releaseTick(h.clock)
    await Promise.race([waiter.then((r) => r), Promise.resolve('still-waiting' as const)])
    const events = readEvents(path.join(h.runDir, 'events.ndjson'))
    const rearmed = rearmedEvents(events)
    expect(rearmed).toHaveLength(1)
    const decisions = autoDecisionEvents(events)
    expect(decisions).toHaveLength(1)
    expect(decisions[0]).toMatchObject({ rule: 'none', decision: 'pending', gateVersion: 1 })
    expect(decisions[0]!.evidenceDigest).toBe(sha256Of('expiry-pending:1'))
    expect(events.indexOf(decisions[0]!)).toBeGreaterThan(events.indexOf(rearmed[0]!))
  })

  it('stay-pending after the one re-arm appends none/pending and never a second re-arm', async () => {
    const h = expiredGate({ trajectory: false, reArmed: true })
    const waiter = h.start()
    // one expiry attempt only — the seeded re-arm left the deadline in the
    // past, so every further tick would append another pending record
    h.clock.release()
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })
    const probe = await Promise.race([waiter.then((r) => r), Promise.resolve('still-waiting' as const)])
    expect(probe).toBe('still-waiting')
    const events = readEvents(path.join(h.runDir, 'events.ndjson'))
    expect(rearmedEvents(events)).toHaveLength(1)
    const decisions = autoDecisionEvents(events)
    expect(decisions).toHaveLength(1)
    expect(decisions[0]).toMatchObject({ rule: 'none', decision: 'pending', gateVersion: 1 })
  })

  it('a lost claim appends nothing — another producer owns the gate', async () => {
    const h = expiredGate({ trajectory: true, preClaimed: true })
    const waiter = h.start()
    await releaseTick(h.clock)
    await expect(waiter).resolves.toEqual({ kind: 'external' })
    expect(autoDecisionEvents(readEvents(path.join(h.runDir, 'events.ndjson')))).toHaveLength(0)
  })
})

describe('gate deadline — expiry ladder metered semantics (D5)', () => {
  it('unmetered + unknown cost: the shared expiry ladder passes R4 and R2 settles extend', async () => {
    const h = expiredGate({ trajectory: true, unmetered: true, costUnknown: true })
    const waiter = h.start()
    await releaseTick(h.clock)
    const result = await waiter
    expect(result).toEqual({ kind: 'settled', outcome: 'extend' })
    const events = readEvents(path.join(h.runDir, 'events.ndjson'))
    expect(answeredGateEvents(events)).toHaveLength(1)
    expect(autoDecisionEvents(events).at(-1)).toMatchObject({ rule: 'R2', decision: 'extend' })
  })

  it('metered + unknown cost: R4 still gates at expiry — re-arm, no settle', async () => {
    const h = expiredGate({ trajectory: true, costUnknown: true })
    const waiter = h.start()
    await releaseTick(h.clock)
    await releaseTick(h.clock)
    const probe = await Promise.race([waiter.then((r) => r), Promise.resolve('still-waiting' as const)])
    expect(probe).toBe('still-waiting')
    const events = readEvents(path.join(h.runDir, 'events.ndjson'))
    expect(rearmedEvents(events)).toHaveLength(1)
    expect(answeredGateEvents(events)).toHaveLength(0)
  })
})

describe('gate deadline — natural sequence (D4 attempt-scoped claims)', () => {
  it('first expiry (claim, rule-none, re-arm) releases the claim: a hand settle during the window succeeds', async () => {
    const h = expiredGate({ trajectory: false })
    const waiter = h.start()
    // first expiry: no conservative branch → one re-arm, claim released
    await releaseTick(h.clock)
    await releaseTick(h.clock)
    expect(rearmedEvents(readEvents(path.join(h.runDir, 'events.ndjson')))).toHaveLength(1)
    expect(fs.existsSync(path.join(h.runDir, 'gate-1.settle-claim'))).toBe(false)
    // the operator answers by hand during the re-arm window
    fs.writeFileSync(path.join(h.runDir, 'gate-1.md'), '## Gate response\n\n- [x] T1 reviewed\nAPPROVE\n')
    await releaseTick(h.clock)
    await releaseTick(h.clock)
    await releaseTick(h.clock)
    const result = await waiter
    expect(result).toEqual({ kind: 'settled', outcome: 'approve' })
    expect(answeredGateEvents(readEvents(path.join(h.runDir, 'events.ndjson')))).toHaveLength(1)
  })

  it('a second deadline after the re-arm re-runs the ladder instead of reporting an already-held claim', async () => {
    const h = expiredGate({ trajectory: false, reArmed: true })
    const waiter = h.start()
    await releaseTick(h.clock)
    await releaseTick(h.clock)
    const probe = await Promise.race([waiter.then((r) => r), Promise.resolve('still-waiting' as const)])
    expect(probe).toBe('still-waiting')
    // the ladder ran again (the pending warning came from a fresh attempt, not a claim loss)
    expect(h.warnings.some((line) => line.includes('gate stays pending'))).toBe(true)
    expect(h.warnings.some((line) => line.includes('already claimed'))).toBe(false)
    expect(answeredGateEvents(readEvents(path.join(h.runDir, 'events.ndjson')))).toHaveLength(0)
  })
})
