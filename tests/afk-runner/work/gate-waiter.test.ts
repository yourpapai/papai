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
import { foldEvents } from '../../../afk-runner/src/kernel/fold.js'
import { startRun } from '../../../afk-runner/src/run.js'
import { holderPath } from '../../../afk-runner/src/stop-controller.js'
import { renderGateAnswers } from '../../../afk-runner/src/work/gate-answers.js'
import { presentGate } from '../../../afk-runner/src/work/gate-files.js'
import { guardedReviewResult } from '../../../afk-runner/src/work/gate-integrity.js'
import { readReviewResultFromSidecars } from '../../../afk-runner/src/work/gate-settle.js'
import { findingsOf } from '../../../afk-runner/src/work/gate-signals.js'
import { awaitGateSettle, digestOf } from '../../../afk-runner/src/work/gate-waiter.js'
import type { GateWaiterPorts, GateWaiterResult } from '../../../afk-runner/src/work/gate-waiter.js'
import { readFailedDigest } from '../../../afk-runner/src/work/response-error.js'
import { makeFakePipeline, TASK_TEXT } from '../fixtures/fake-pipeline.js'

const NULL_DIGEST = { what: null, why: null, touches: null, hasTasks: false }

/** Release one tick and let the waiter's continuation run before the next. */
/**
 * Release one tick and let the waiter's async work (fs reads across the
 * settle/expiry chain) finish before the next release — a bare one-turn wait
 * races the reads under parallel-worker load, leaving the tick queue empty
 * while the waiter is mid-attempt.
 */
async function releaseTick(clock: { readonly release: () => void }): Promise<void> {
  clock.release()
  await new Promise((resolve) => {
    setTimeout(resolve, 1)
  })
  await new Promise((resolve) => {
    setTimeout(resolve, 1)
  })
}

/**
 * Release ticks (a no-op release while the waiter is mid-async-work) until
 * the waiter's promise settles — a fixed tick count races the settle chain's
 * fs reads under parallel-worker load. The settled flag flips in the same
 * microtask batch as the promise (a `Promise.race` against an already-settled
 * marker loses to the marker: the `.then` derivation costs an extra hop).
 */
async function settleViaTicks<T>(
  pending: Promise<T>,
  clock: { readonly release: () => void },
  budgetMs = 5_000,
): Promise<T> {
  const state = { settled: false }
  const tracked = pending.then(
    (value: T): T => {
      state.settled = true
      return value
    },
    (error: unknown): never => {
      state.settled = true
      throw error
    },
  )
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline && !state.settled) {
    clock.release()
    await new Promise((resolve) => {
      setTimeout(resolve, 2)
    })
  }
  return tracked
}

/** Release ticks until the predicate holds — fixed tick counts race the settle chain's fs reads under load. */
async function ticksUntil(
  clock: { readonly release: () => void },
  done: () => boolean,
  budgetMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    if (done()) return
    clock.release()
    await new Promise((resolve) => {
      setTimeout(resolve, 2)
    })
  }
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

async function makeAwaitingGate(
  mode: 'early' | 'final' = 'early',
  options: { readonly substituted?: boolean } = {},
): Promise<WaiterHarness> {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-waiter-'))
  const changeDir = path.join(runDir, 'change')
  const sidecarDir = path.join(runDir, 'sidecars')
  fs.mkdirSync(sidecarDir, { recursive: true })
  fs.mkdirSync(path.join(changeDir, 'specs'), { recursive: true })
  fs.writeFileSync(path.join(changeDir, 'proposal.md'), 'hello')
  fs.writeFileSync(
    path.join(sidecarDir, 'resolutions-1.json'),
    options.substituted === true
      ? '{not json'
      : JSON.stringify({
          // Dismissed stays genuinely open under the raised-vs-open split, so the
          // presented rows and the sidecar re-read agree on F1 being a finding row.
          resolutions: [{ id: 'F1', class: 'MATERIAL', resolution: 'dismissed', justification: 'kept as documented' }],
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
  // the fold's perRound must carry round 1's record — the guard's input
  const convergence: readonly EventInput[] =
    options.substituted === true
      ? [
          {
            altitude: 'L2',
            type: 'convergence',
            round: 1,
            verdict: 'open',
            counts: { blocker: 0, material: 1, nitpick: 0 },
          },
        ]
      : []
  const prelude: readonly EventInput[] = [
    { altitude: 'L2', type: 'stage_enter', stage: 'intake' },
    { altitude: 'L2', type: 'stage_exit', stage: 'intake' },
    { altitude: 'L2', type: 'stage_enter', stage: 'draft' },
    { altitude: 'L2', type: 'stage_exit', stage: 'draft' },
    { altitude: 'L2', type: 'stage_enter', stage: 'review' },
    { altitude: 'L2', type: 'round_open', round: 1, cap: 1 },
    ...convergence,
    { altitude: 'L2', type: 'stage_exit', stage: 'review' },
  ]
  for (const event of prelude) appendEvent(logPath, event, new Date('2026-08-27T00:00:00.000Z'))
  // The substituted variant renders through the guarded path the presenters
  // use after D3: the corrupted sidecar substitutes the POLICY-INTEGRITY row.
  const findings =
    options.substituted === true
      ? findingsOf(
          await guardedReviewResult(
            await readReviewResultFromSidecars(sidecarDir, 1, 'cap-hit'),
            foldEvents(pipelineMachine, readEvents(logPath)).snapshot.context.perRound,
            sidecarDir,
          ),
        )
      : {
          blockers: [] as { id: string; gap: string; evidence: string }[],
          material: [{ id: 'F1', gap: 'F1', evidence: 'dismissed — kept as documented' }],
          nitpicks: [] as { id: string; gap: string; evidence: string }[],
        }
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
      assumptions:
        options.substituted === true
          ? []
          : [
              {
                id: 'A1',
                text: 'guests stay read-only',
                blast_radius: 'group replies',
                evidence: { files: ['src/a.ts'] },
              },
            ],
      blockers: findings.blockers,
      openMaterial: findings.material,
      openNitpicks: findings.nitpicks,
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
    const result = await settleViaTicks(waiter, h.clock)
    expect(result).toEqual({ kind: 'settled', outcome: 'approve' })
    const events = readEvents(h.logPath)
    expect(events.at(-2)).toMatchObject({ type: 'gate', action: 'answered', outcome: 'approve' })
    expect(events.at(-1)).toMatchObject({ type: 'stage_enter', stage: 'decompose' })
    // attempt-scoped (D4): the claim is released when the attempt ends
    expect(fs.existsSync(path.join(h.runDir, 'gate-1.settle-claim'))).toBe(false)
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
    const result = await settleViaTicks(waiter, h.clock)
    expect(result).toEqual({ kind: 'settled', outcome: 'abort' })
    expect(fs.existsSync(path.join(h.runDir, 'steer.consumed.1.md'))).toBe(true)
  })

  it('an extend steer at an early gate settles as extend', async () => {
    const h = await makeAwaitingGate('early')
    const waiter = h.start()
    h.writeSteer('extend\n')
    h.clock.release()
    const result = await settleViaTicks(waiter, h.clock)
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
    const result = await settleViaTicks(waiter, h.clock)
    expect(result).toEqual({ kind: 'settled', outcome: 'veto' })
    expect(readEvents(h.logPath).at(-1)).toMatchObject({ type: 'stage_enter', stage: 'draft' })
  })
})

describe('gate waiter — settle containment (D3)', () => {
  it('a malformed hand edit yields a rejected settle, the waiter stays alive, and the error artifact names the reason', async () => {
    const h = await makeAwaitingGate()
    const waiter = h.start()
    h.writeGateMd('## Gate response\n\n- [x] A9 never declared\n')
    await ticksUntil(h.clock, () => fs.existsSync(path.join(h.runDir, 'gate-1.response-error.md')))
    const probe = await Promise.race([waiter.then((r) => r), Promise.resolve('still-waiting' as const)])
    expect(probe).toBe('still-waiting')
    expect(hasAnsweredGate(readEvents(h.logPath))).toBe(false)
    const errorMd = fs.readFileSync(path.join(h.runDir, 'gate-1.response-error.md'), 'utf8')
    expect(errorMd).toContain('unknown assumption A9')
    expect(h.warnings.some((line) => line.includes('unknown assumption A9'))).toBe(true)
  })

  it('no re-attempt until the gate file digest changes; the corrected file settles', async () => {
    const h = await makeAwaitingGate()
    const waiter = h.start()
    h.writeGateMd('## Gate response\n\n- [x] A9 never declared\n')
    await ticksUntil(h.clock, () => h.warnings.some((line) => line.includes('unknown assumption A9')))
    // one rejection line only — an unchanged digest never re-attempts
    expect(h.warnings.filter((line) => line.includes('unknown assumption A9'))).toHaveLength(1)
    h.writeGateMd(APPROVE_MD)
    await releaseTick(h.clock)
    await releaseTick(h.clock)
    await releaseTick(h.clock)
    const result = await settleViaTicks(waiter, h.clock)
    expect(result).toEqual({ kind: 'settled', outcome: 'approve' })
    expect(hasAnsweredGate(readEvents(h.logPath))).toBe(true)
  })

  it('a settled gate removes the stale error artifact', async () => {
    const h = await makeAwaitingGate()
    const waiter = h.start()
    h.writeGateMd('## Gate response\n\n- [x] A9 never declared\n')
    await ticksUntil(h.clock, () => fs.existsSync(path.join(h.runDir, 'gate-1.response-error.md')))
    expect(fs.existsSync(path.join(h.runDir, 'gate-1.response-error.md'))).toBe(true)
    h.writeGateMd(APPROVE_MD)
    for (let i = 0; i < 3; i += 1) await releaseTick(h.clock)
    await settleViaTicks(waiter, h.clock)
    expect(fs.existsSync(path.join(h.runDir, 'gate-1.response-error.md'))).toBe(false)
  })

  it('an unchanged poisoned file on resume does not re-attempt', async () => {
    const h = await makeAwaitingGate()
    const poisoned = '## Gate response\n\n- [x] A9 never declared\n'
    h.writeGateMd(poisoned)
    // first waiter: rejects once
    const first = h.start()
    await ticksUntil(h.clock, () => h.warnings.some((line) => line.includes('unknown assumption A9')))
    await Promise.race([first.then((r) => r), Promise.resolve('still-waiting' as const)])
    expect(h.warnings.filter((line) => line.includes('unknown assumption A9'))).toHaveLength(1)
    // resumed waiter over the same unchanged file: seeds the digest guard from
    // the error artifact and never re-attempts
    const resumed = h.start()
    for (let i = 0; i < 5; i += 1) await releaseTick(h.clock)
    const probe = await Promise.race([resumed.then((r) => r), Promise.resolve('still-waiting' as const)])
    expect(probe).toBe('still-waiting')
    expect(h.warnings.filter((line) => line.includes('unknown assumption A9'))).toHaveLength(1)
    expect(hasAnsweredGate(readEvents(h.logPath))).toBe(false)
  })

  it('the empty-expected rejection hints at a missing sidecar', async () => {
    const h = await makeAwaitingGate()
    fs.writeFileSync(
      path.join(h.runDir, 'sidecars', 'resolutions-1.json'),
      JSON.stringify({ resolutions: [], assumptions: [] }),
    )
    const waiter = h.start()
    h.writeGateMd('## Gate response\n\n- [x] A1 guests stay read-only\n')
    await ticksUntil(h.clock, () => fs.existsSync(path.join(h.runDir, 'gate-1.response-error.md')))
    const errorMd = fs.readFileSync(path.join(h.runDir, 'gate-1.response-error.md'), 'utf8')
    expect(errorMd).toContain('expected content is empty')
    expect(errorMd).toContain('sidecar')
    const probe = await Promise.race([waiter.then((r) => r), Promise.resolve('still-waiting' as const)])
    expect(probe).toBe('still-waiting')
  })
})

describe('gate waiter — thrown steer settle stays contained (F-C1/D2)', () => {
  it('a well-formed steer item-veto with a foreign id becomes feedback: artifact, stdout, consumed — the waiter survives', async () => {
    const h = await makeAwaitingGate()
    const waiter = h.start()
    h.writeSteer('veto F99=drop the rollback promise\n')
    await ticksUntil(h.clock, () => fs.existsSync(path.join(h.runDir, 'gate-1.response-error.md')))
    const probe = await Promise.race([waiter.then((r) => r), Promise.resolve('still-waiting' as const)])
    expect(probe).toBe('still-waiting')
    // the steer file is consumed (append-only audit), never re-driven
    expect(fs.existsSync(path.join(h.runDir, 'steer.consumed.1.md'))).toBe(true)
    expect(fs.existsSync(path.join(h.runDir, 'steer.md'))).toBe(false)
    // the artifact is written unconditionally, (steer)-marked, with the
    // consumed directive embedded — the operator no longer has the file
    const errorMd = fs.readFileSync(path.join(h.runDir, 'gate-1.response-error.md'), 'utf8')
    expect(errorMd).toContain('(steer)')
    expect(errorMd).toContain('veto F99=drop the rollback promise')
    expect(errorMd).toContain('unknown finding F99')
    expect(h.warnings.some((line) => line.includes('unknown finding F99'))).toBe(true)
    expect(hasAnsweredGate(readEvents(h.logPath))).toBe(false)
  })

  it("the steer rejection's digest (the directive line's sha256) is inert for the file-path guard: a stable hand edit settles", async () => {
    const h = await makeAwaitingGate()
    const waiter = h.start()
    h.writeSteer('veto F99=drop it\n')
    await ticksUntil(h.clock, () => fs.existsSync(path.join(h.runDir, 'gate-1.response-error.md')))
    // what a resumed waiter would seed from the artifact: the steer line's
    // digest — which no gate-file content digest can equal
    expect(readFailedDigest(h.runDir, 1)).toBe(digestOf('veto F99=drop it'))
    expect(readFailedDigest(h.runDir, 1)).not.toBe(digestOf(APPROVE_MD))
    h.writeGateMd(APPROVE_MD)
    for (let i = 0; i < 3; i += 1) await releaseTick(h.clock)
    const result = await settleViaTicks(waiter, h.clock)
    expect(result).toEqual({ kind: 'settled', outcome: 'approve' })
    expect(fs.existsSync(path.join(h.runDir, 'gate-1.response-error.md'))).toBe(false)
  })
})

describe('gate waiter — end-to-end at an integrity-substituted gate (F-C2/D3)', () => {
  it('render → operator writes → acknowledged + APPROVE (the directive trips looksAnswered) → settles approve through the seam', async () => {
    const h = await makeAwaitingGate('early', { substituted: true })
    const rendered = fs.readFileSync(path.join(h.runDir, 'gate-1.md'), 'utf8')
    expect(rendered).toContain('POLICY-INTEGRITY')
    expect(rendered).toContain('evidence: sidecar unparseable')
    const waiter = h.start()
    h.writeGateMd('## Gate response\n\nPOLICY-INTEGRITY POLICY-INTEGRITY\n→ acknowledged\nAPPROVE\n')
    for (let i = 0; i < 3; i += 1) await releaseTick(h.clock)
    const result = await settleViaTicks(waiter, h.clock)
    expect(result).toEqual({ kind: 'settled', outcome: 'approve' })
    const events = readEvents(h.logPath)
    expect(events.at(-2)).toMatchObject({ type: 'gate', action: 'answered', outcome: 'approve' })
    expect(events.at(-1)).toMatchObject({ type: 'stage_enter', stage: 'decompose' })
    expect(fs.existsSync(path.join(h.runDir, 'gate-1.response-error.md'))).toBe(false)
  })
})

describe('gate waiter — attempt-scoped claims (D4)', () => {
  it('a rejected settle releases the claim and the corrected answer settles', async () => {
    const h = await makeAwaitingGate()
    const waiter = h.start()
    h.writeGateMd('## Gate response\n\n- [x] A9 never declared\n')
    await ticksUntil(h.clock, () => fs.existsSync(path.join(h.runDir, 'gate-1.response-error.md')))
    expect(fs.existsSync(path.join(h.runDir, 'gate-1.settle-claim'))).toBe(false)
    h.writeGateMd(APPROVE_MD)
    for (let i = 0; i < 3; i += 1) await releaseTick(h.clock)
    const result = await settleViaTicks(waiter, h.clock)
    expect(result).toEqual({ kind: 'settled', outcome: 'approve' })
  })

  it('a settled hand edit also releases the claim when the attempt ends', async () => {
    const h = await makeAwaitingGate()
    const waiter = h.start()
    h.writeGateMd(APPROVE_MD)
    for (let i = 0; i < 3; i += 1) await releaseTick(h.clock)
    await settleViaTicks(waiter, h.clock)
    expect(fs.existsSync(path.join(h.runDir, 'gate-1.settle-claim'))).toBe(false)
  })
})

describe('gate waiter — already-answered guard (D5)', () => {
  it('exits external on an already-answered gate record instead of re-settling', async () => {
    const h = await makeAwaitingGate()
    // another producer answered but its mover never landed — the record is
    // answered while the position still awaits (the W3 crash window)
    h.append({ altitude: 'L2', type: 'gate', action: 'answered', mode: 'early', version: 1, outcome: 'approve' })
    const answeredCount = answeredGateCount(h.logPath)
    const waiter = h.start()
    h.writeGateMd(APPROVE_MD)
    h.clock.release()
    await expect(waiter).resolves.toEqual({ kind: 'external' })
    expect(answeredGateCount(h.logPath)).toBe(answeredCount)
  })
})

function answeredGateCount(logPath: string): number {
  return readEvents(logPath).filter((event) => event.type === 'gate' && event.action === 'answered').length
}

describe('gate waiter — steer grammar and hygiene (D7)', () => {
  async function itemlessFinalGate(): Promise<WaiterHarness> {
    const h = await makeAwaitingGate('final')
    fs.writeFileSync(
      path.join(h.runDir, 'sidecars', 'resolutions-1.json'),
      JSON.stringify({ resolutions: [], assumptions: [] }),
    )
    return h
  }

  it('a bare veto steer settles an item-less final gate as a gate-level veto without crashing', async () => {
    const h = await itemlessFinalGate()
    const waiter = h.start()
    h.writeSteer('veto\n')
    h.clock.release()
    const result = await settleViaTicks(waiter, h.clock)
    expect(result).toEqual({ kind: 'settled', outcome: 'veto' })
    const md = fs.readFileSync(path.join(h.runDir, 'gate-1.md'), 'utf8')
    expect(md).toMatch(/^VETO$/mu)
    expect(readEvents(h.logPath).at(-1)).toMatchObject({ type: 'stage_enter', stage: 'draft' })
  })

  it('a veto-text steer maps to a gate-level veto carrying the redirect', async () => {
    const h = await itemlessFinalGate()
    const waiter = h.start()
    h.writeSteer('veto the approach is wrong\n')
    h.clock.release()
    const result = await settleViaTicks(waiter, h.clock)
    expect(result).toEqual({ kind: 'settled', outcome: 'veto' })
    expect(fs.readFileSync(path.join(h.runDir, 'gate-1.md'), 'utf8')).toContain('VETO: the approach is wrong')
  })

  it('veto <id>=<redirect> stays an item veto with an unchecked box', async () => {
    const h = await makeAwaitingGate()
    const waiter = h.start()
    h.writeSteer('veto F1=drop the rollback promise\n')
    h.clock.release()
    const result = await settleViaTicks(waiter, h.clock)
    expect(result).toEqual({ kind: 'settled', outcome: 'veto' })
    const md = fs.readFileSync(path.join(h.runDir, 'gate-1.md'), 'utf8')
    expect(md).toContain('- [ ] F1')
    expect(md).toContain('→ drop the rollback promise')
    expect(md).not.toMatch(/^VETO/mu)
  })

  it('an unparseable steer first line is warned and consumed; the gate stays pending', async () => {
    const h = await makeAwaitingGate()
    const waiter = h.start()
    h.writeSteer('do the thing yourself\n')
    await releaseTick(h.clock)
    await releaseTick(h.clock)
    const probe = await Promise.race([waiter.then((r) => r), Promise.resolve('still-waiting' as const)])
    expect(probe).toBe('still-waiting')
    expect(h.warnings.some((line) => line.includes('unrecognized steer directive'))).toBe(true)
    expect(fs.existsSync(path.join(h.runDir, 'steer.consumed.1.md'))).toBe(true)
    expect(hasAnsweredGate(readEvents(h.logPath))).toBe(false)
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
        // Dismissed stays genuinely open under the raised-vs-open split, so the
        // presented rows and the sidecar re-read agree on F1 being a finding row.
        resolutions: [{ id: 'F1', class: 'MATERIAL', resolution: 'dismissed', justification: 'kept as documented' }],
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
    // The extended round converges; the S tail presents the final gate and
    // R1 approves it — the waiter's re-drive exits on the final park and the
    // holder is removed (C5 D6).
    const halted = await waitForRunEnd(runPromise, clock)
    expect(halted.halted).toBe('final')
    const events = readEvents(path.join(runDir, 'events.ndjson'))
    expect(hasAnsweredGate(events)).toBe(true)
    expect(hasRoundOpen(events, 2)).toBe(true)
    expect(pipeline.spawnOrder).toContain('findings-2.json')
    expect(presentedGateEvents(events).at(-1)).toMatchObject({ mode: 'final', version: 2 })
    expect(fs.existsSync(holderPath(runDir))).toBe(false)
  })
})

function presentedGateEvents(events: readonly SddEvent[]): SddEvent[] {
  return events.filter((event) => event.type === 'gate' && event.action === 'presented')
}

/** One waiter-clock poll step: release a tick, then report whether the re-drive has presented the final gate and parked. */
function waitForRunEnd<T>(pending: Promise<T>, clock: { readonly release: () => void }): Promise<T> {
  return settleViaTicks(pending, clock, 10_000)
}

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
