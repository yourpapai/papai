// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { appendEvent } from '../../../afk-runner/src/events.js'
import type { EventInput, SddEvent } from '../../../afk-runner/src/events.js'
import { readEvents } from '../../../afk-runner/src/events.js'
import { pipelineMachine } from '../../../afk-runner/src/graph/pipeline.js'
import { startRun } from '../../../afk-runner/src/run.js'
import { holderPath } from '../../../afk-runner/src/stop-controller.js'
import { renderGateAnswers } from '../../../afk-runner/src/work/gate-answers.js'
import { presentGate } from '../../../afk-runner/src/work/gate-files.js'
import { awaitGateSettle } from '../../../afk-runner/src/work/gate-waiter.js'
import type { GateWaiterPorts, GateWaiterResult } from '../../../afk-runner/src/work/gate-waiter.js'
import { makeFakePipeline, TASK_TEXT } from '../fixtures/fake-pipeline.js'

const NULL_DIGEST = { what: null, why: null, touches: null, hasTasks: false }

/** Release one tick and let the waiter's continuation run before the next. */
async function releaseTick(clock: { readonly release: () => void }): Promise<void> {
  clock.release()
  await new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

/** Fake clock: each tick resolves only when the test releases it. */
function fakeClock(): { readonly tick: () => Promise<void>; readonly release: () => void; pending: () => number } {
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
    pending: () => queue.length,
  }
}

interface WaiterHarness {
  readonly runDir: string
  readonly logPath: string
  readonly clock: ReturnType<typeof fakeClock>
  readonly warnings: string[]
  readonly start: () => Promise<GateWaiterResult>
  readonly append: (event: EventInput) => void
  readonly writeGateMd: (md: string) => void
  readonly writeSteer: (content: string) => void
}

async function makeAwaitingGate(mode: 'early' | 'final' = 'early'): Promise<WaiterHarness> {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-waiter-'))
  const changeDir = path.join(runDir, 'change')
  const sidecarDir = path.join(runDir, 'sidecars')
  fs.mkdirSync(sidecarDir, { recursive: true })
  fs.mkdirSync(path.join(changeDir, 'specs'), { recursive: true })
  fs.writeFileSync(path.join(changeDir, 'proposal.md'), 'hello')
  fs.writeFileSync(
    path.join(sidecarDir, 'resolutions-1.json'),
    JSON.stringify({
      resolutions: [{ id: 'F1', class: 'MATERIAL', resolution: 'evidence-answered', outcome: 'kept as documented' }],
      assumptions: [
        {
          id: 'A1',
          text: 'guests stay read-only',
          basis: 'code-evidence',
          confidence: 'high',
          blast_radius: 'group replies',
          status: 'open',
          evidence: { files: ['src/a.ts'] },
        },
      ],
    }),
  )
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
  for (const event of prelude) appendEvent(logPath, event, new Date('2026-08-27T00:00:00.000Z'))
  await presentGate(
    {
      emit: (event) => {
        appendEvent(logPath, event)
      },
      runDir,
      changeDir,
      driftCheck: () => Promise.resolve(),
    },
    {
      version: 1,
      mode,
      changeName: 'add-thing',
      runId: 'run-1',
      assumptions: [
        { id: 'A1', text: 'guests stay read-only', blast_radius: 'group replies', evidence: { files: ['src/a.ts'] } },
      ],
      blockers: [],
      openMaterial: [{ id: 'F1', gap: 'F1', evidence: 'evidence-answered — kept as documented' }],
      openNitpicks: [],
      trajectory: [],
      capHitFired: mode === 'early',
      summary: 'add-thing',
      costUsd: 0,
      costKnown: false,
      durationMs: 0,
      changeDigest: NULL_DIGEST,
    },
  )
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
  }
  return {
    runDir,
    logPath,
    clock,
    warnings,
    start: () => awaitGateSettle(ports),
    append: (event) => {
      appendEvent(logPath, event)
    },
    writeGateMd: (md) => {
      fs.writeFileSync(path.join(runDir, 'gate-1.md'), md)
    },
    writeSteer: (content) => fs.writeFileSync(path.join(runDir, 'steer.md'), content),
  }
}

const APPROVE_MD = renderGateAnswers({
  items: [
    { kind: 'assumption', id: 'A1', text: 'guests stay read-only', accepted: true },
    { kind: 'finding', id: 'F1', text: 'F1', accepted: true },
  ],
  blockerAnswers: [],
  acks: [{ id: 'T1', text: 'I reviewed the trajectory and the open findings above' }],
  decision: 'approve',
})

describe('gate waiter — foreground continuation (C4 5.1)', () => {
  it('exits cleanly when another process settles the gate (external settlement)', async () => {
    const h = await makeAwaitingGate()
    const waiter = h.start()
    h.append({ altitude: 'L2', type: 'gate', action: 'answered', mode: 'early', version: 1, outcome: 'extend' })
    h.append({ altitude: 'L2', type: 'round_open', round: 2, cap: 2 })
    h.clock.release()
    await expect(waiter).resolves.toEqual({ kind: 'external' })
  })

  it('waits through ticks while the gate stays pending and unanswered', async () => {
    const h = await makeAwaitingGate()
    const waiter = h.start()
    for (let i = 0; i < 5; i += 1) await releaseTick(h.clock)
    const probe = await Promise.race([waiter.then((r) => r), Promise.resolve('still-waiting' as const)])
    expect(probe).toBe('still-waiting')
  })

  it('calm-stop markers are a no-op at gate-pending: the waiter keeps waiting', async () => {
    const h = await makeAwaitingGate()
    fs.writeFileSync(path.join(h.runDir, 'stop-requested'), 'now\n')
    const waiter = h.start()
    for (let i = 0; i < 3; i += 1) await releaseTick(h.clock)
    const probe = await Promise.race([waiter.then((r) => r), Promise.resolve('still-waiting' as const)])
    expect(probe).toBe('still-waiting')
    expect(fs.existsSync(path.join(h.runDir, 'stop-requested'))).toBe(true)
  })
})

describe('gate waiter — stability guard (C4 5.2)', () => {
  it('settles a hand-edited gate file through the seam once stable across 3 ticks', async () => {
    const h = await makeAwaitingGate()
    const waiter = h.start()
    h.writeGateMd(APPROVE_MD)
    await releaseTick(h.clock)
    await releaseTick(h.clock)
    await releaseTick(h.clock)
    const result = await waiter
    expect(result).toEqual({ kind: 'settled', outcome: 'approve' })
    const events = readEvents(h.logPath)
    expect(events.at(-2)).toMatchObject({ type: 'gate', action: 'answered', outcome: 'approve' })
    expect(events.at(-1)).toMatchObject({ type: 'stage_enter', stage: 'decompose' })
    expect(fs.existsSync(path.join(h.runDir, 'gate-1.settle-claim'))).toBe(true)
  })

  it('content still changing between ticks never settles', async () => {
    const h = await makeAwaitingGate()
    const waiter = h.start()
    h.writeGateMd(`${APPROVE_MD}draft 1\n`)
    await releaseTick(h.clock)
    h.writeGateMd(`${APPROVE_MD}draft 2\n`)
    await releaseTick(h.clock)
    h.writeGateMd(APPROVE_MD)
    await releaseTick(h.clock)
    await releaseTick(h.clock)
    const probe = await Promise.race([waiter.then((r) => r), Promise.resolve('still-waiting' as const)])
    expect(probe).toBe('still-waiting')
    expect(hasAnsweredGate(readEvents(h.logPath))).toBe(false)
  })

  it('an unanswered gate file is never mistaken for a settle', async () => {
    const h = await makeAwaitingGate()
    const waiter = h.start()
    for (let i = 0; i < 4; i += 1) await releaseTick(h.clock)
    const probe = await Promise.race([waiter.then((r) => r), Promise.resolve('still-waiting' as const)])
    expect(probe).toBe('still-waiting')
  })
})

describe('gate waiter — steer translation (C4 5.2)', () => {
  it('an abort steer settles the gate as abort', async () => {
    const h = await makeAwaitingGate()
    const waiter = h.start()
    h.writeSteer('abort\n')
    h.clock.release()
    const result = await waiter
    expect(result).toEqual({ kind: 'settled', outcome: 'abort' })
    expect(fs.existsSync(path.join(h.runDir, 'steer.consumed.1.md'))).toBe(true)
  })

  it('an extend steer at an early gate settles as extend', async () => {
    const h = await makeAwaitingGate('early')
    const waiter = h.start()
    h.writeSteer('extend\n')
    h.clock.release()
    const result = await waiter
    expect(result).toEqual({ kind: 'settled', outcome: 'extend' })
    expect(readEvents(h.logPath).at(-1)).toMatchObject({ type: 'round_open', round: 2, cap: 2 })
  })

  it('an extend steer at a final gate is skipped with a warning; the gate stays pending', async () => {
    const h = await makeAwaitingGate('final')
    const waiter = h.start()
    h.writeSteer('extend\n')
    await releaseTick(h.clock)
    await releaseTick(h.clock)
    const probe = await Promise.race([waiter.then((r) => r), Promise.resolve('still-waiting' as const)])
    expect(probe).toBe('still-waiting')
    expect(h.warnings.some(extendSkipWarning)).toBe(true)
    expect(fs.existsSync(path.join(h.runDir, 'steer.consumed.1.md'))).toBe(true)
    expect(hasAnsweredGate(readEvents(h.logPath))).toBe(false)
  })

  it('a veto steer settles as veto with the redirect', async () => {
    const h = await makeAwaitingGate()
    const waiter = h.start()
    h.writeSteer('veto F1=drop the rollback promise\n')
    h.clock.release()
    const result = await waiter
    expect(result).toEqual({ kind: 'settled', outcome: 'veto' })
    expect(readEvents(h.logPath).at(-1)).toMatchObject({ type: 'stage_enter', stage: 'draft' })
  })
})

describe('gate waiter as run-level continuation (C4 5.1)', () => {
  it('startRun with gate wait keeps the holder alive, settles by file edit, re-drives the extended round', async () => {
    const materialRound = {
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
      'findings-2.json': JSON.stringify({ findings: [] }),
      'resolutions-2.json': JSON.stringify({ resolutions: [], assumptions: [] }),
    }
    const pipeline = makeFakePipeline({ sidecarOverrides: materialRound })
    const clock = fakeClock()
    const taskFile = path.join(pipeline.repoRoot, 'task.md')
    fs.writeFileSync(taskFile, TASK_TEXT)
    const runPromise = startRun({ ...pipeline.deps, gateWait: { tick: clock.tick } }, { taskFile })

    const parked = await waitFor((): boolean => pipeline.stdoutLines.some((line) => line.includes('gate-pending')))
    expect(parked).toBe(true)
    const runDir = pipeline.runDirOf(firstRunOf(pipeline))
    expect(fs.existsSync(holderPath(runDir))).toBe(true)

    const gateMd = path.join(runDir, 'gate-1.md')
    fs.writeFileSync(gateMd, `${fs.readFileSync(gateMd, 'utf8')}\n## Gate response\n\n→ RUN 1 MORE\n`)
    for (let i = 0; i < 6; i += 1) await releaseTick(clock)

    const halted = await runPromise
    expect(halted.halted).toBe('awaiting-tail')
    const events = readEvents(path.join(runDir, 'events.ndjson'))
    expect(hasAnsweredGate(events)).toBe(true)
    expect(hasRoundOpen(events, 2)).toBe(true)
    expect(pipeline.spawnOrder).toContain('findings-2.json')
    expect(fs.existsSync(holderPath(runDir))).toBe(false)
  })
})

function extendSkipWarning(line: string): boolean {
  return line.includes('extend is not valid at a final gate')
}

function hasAnsweredGate(events: readonly SddEvent[]): boolean {
  return events.some((event) => event.type === 'gate' && event.action === 'answered')
}

function hasRoundOpen(events: readonly SddEvent[], round: number): boolean {
  return events.some((event) => event.type === 'round_open' && event.round === round)
}

function firstRunOf(pipeline: ReturnType<typeof makeFakePipeline>): string {
  const runsDir = path.join(pipeline.workDir, 'runs')
  const first = fs.readdirSync(runsDir)[0]
  if (first === undefined) throw new Error(`no runs under ${runsDir}`)
  return first
}

async function waitFor(predicate: () => boolean, budgetMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise((resolve) => {
      setTimeout(resolve, 25)
    })
  }
  return predicate()
}
