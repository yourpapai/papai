// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'

import { appendEvent, readEvents } from '../../afk-runner/src/events.js'
import type { EventInput, SddEvent } from '../../afk-runner/src/events.js'
import { resumeRun } from '../../afk-runner/src/run-resume.js'
import { makeFakePipeline, TASK_TEXT } from './fixtures/fake-pipeline.js'

const PAST = '2026-08-27T00:00:01.000Z'
const NOW = new Date('2026-08-27T00:01:00.000Z')

function isRearmedEvent(event: SddEvent): boolean {
  return event.type === 'gate' && event.action === 'rearmed'
}

function isPendingDecision(event: SddEvent): boolean {
  return event.type === 'auto_decision' && event.decision === 'pending'
}

/** Fake clock: each tick resolves only when the test releases it. */
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

async function releaseTick(clock: { readonly release: () => void }): Promise<void> {
  clock.release()
  await new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

/**
 * Release ticks (a no-op release when the waiter is mid-async-work) until the
 * predicate holds — the expiry's fs reads span macrotask turns, so a fixed
 * tick count would race them.
 */
async function ticksUntil(
  clock: { readonly release: () => void },
  done: () => boolean,
  budgetMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    clock.release()
    await new Promise((resolve) => {
      setTimeout(resolve, 5)
    })
    if (done()) return
  }
}

/**
 * A parked early gate whose deadline already elapsed and whose ladder
 * refuses (an open BLOCKER): the expiry's refuse-and-rearm branch.
 * `withDeadline: false` mirrors an unconfigured run — no deadlineAt stamp.
 */
function makeExpiredRefusingGate(withDeadline = true): {
  readonly pipeline: ReturnType<typeof makeFakePipeline>
  readonly runId: string
} {
  const pipeline = makeFakePipeline()
  const runId = 'run-resume-expiry'
  const runDir = path.join(pipeline.workDir, 'runs', runId)
  const sidecarDir = path.join(runDir, 'sidecars')
  const changeDir = path.join(pipeline.repoRoot, 'openspec', 'changes', 'add-thing')
  fs.mkdirSync(sidecarDir, { recursive: true })
  fs.mkdirSync(path.join(changeDir, 'specs', 'thing'), { recursive: true })
  fs.writeFileSync(path.join(changeDir, 'proposal.md'), 'hello\n')
  fs.writeFileSync(path.join(runDir, 'task.md'), TASK_TEXT)
  fs.writeFileSync(
    path.join(sidecarDir, 'resolutions-1.json'),
    JSON.stringify({
      resolutions: [{ id: 'F1', class: 'BLOCKER', resolution: 'dismissed', justification: 'kept' }],
      assumptions: [],
    }),
  )
  const logPath = path.join(runDir, 'events.ndjson')
  const walk: readonly EventInput[] = [
    { altitude: 'L2', type: 'stage_enter', stage: 'intake' },
    { altitude: 'L2', type: 'depth', profile: 'S', rationale: 'one module', source: 'estimator' },
    { altitude: 'L2', type: 'stage_exit', stage: 'intake' },
    { altitude: 'L2', type: 'stage_enter', stage: 'draft' },
    { altitude: 'L2', type: 'stage_exit', stage: 'draft' },
    { altitude: 'L2', type: 'stage_enter', stage: 'review' },
    { altitude: 'L2', type: 'round_open', round: 1, cap: 1 },
    { altitude: 'L2', type: 'convergence', round: 1, verdict: 'open', counts: { blocker: 1, material: 0, nitpick: 0 } },
    { altitude: 'L2', type: 'stage_exit', stage: 'review' },
    {
      altitude: 'L2',
      type: 'gate',
      action: 'presented',
      mode: 'early',
      version: 1,
      ...(withDeadline ? { deadlineAt: PAST } : {}),
    },
  ]
  for (const event of walk) appendEvent(logPath, event, NOW)
  fs.writeFileSync(path.join(runDir, 'gate-1.md'), '<!-- gate-1.md -->\n\n## Early gate (cap hit) — change add-thing\n')
  fs.writeFileSync(path.join(runDir, 'gate-hashes-1.json'), '{}\n')
  return { pipeline, runId }
}

describe('waitSettledGates carries the expiry ports (F-C3/D5 wiring)', () => {
  it('a resumed parked gate with an elapsed deadline claims: one re-arm, the pending record after it', async () => {
    const { pipeline, runId } = makeExpiredRefusingGate()
    const logPath = path.join(pipeline.workDir, 'runs', runId, 'events.ndjson')
    const clock = fakeClock()
    const resumedPromise = resumeRun(
      {
        ...pipeline.deps,
        config: { ...pipeline.deps.config, deadline: 1 },
        gateWait: { tick: clock.tick },
        now: () => NOW,
      },
      runId,
    )
    await ticksUntil(clock, () => readEvents(logPath).some(isRearmedEvent))
    const events = readEvents(logPath)
    const rearmed = events.filter(isRearmedEvent)
    expect(rearmed).toHaveLength(1)
    const pending = events.filter(isPendingDecision)
    expect(pending).toHaveLength(1)
    expect(pending[0]).toMatchObject({ rule: 'none', decision: 'pending', gateVersion: 1 })
    expect(events.indexOf(pending[0]!)).toBeGreaterThan(events.indexOf(rearmed[0]!))
    const probe = await Promise.race([resumedPromise.then((): boolean => true), Promise.resolve(false)])
    expect(probe).toBe(false)
    void resumedPromise
  })

  it('without a deadline configured the resumed waiter stays inert — no claim, no events', async () => {
    const { pipeline, runId } = makeExpiredRefusingGate(false)
    const clock = fakeClock()
    const resumedPromise = resumeRun(
      {
        ...pipeline.deps,
        gateWait: { tick: clock.tick },
        now: () => NOW,
      },
      runId,
    )
    for (let i = 0; i < 5; i += 1) await releaseTick(clock)
    const events = readEvents(path.join(pipeline.workDir, 'runs', runId, 'events.ndjson'))
    expect(events.filter(isRearmedEvent)).toHaveLength(0)
    expect(events.filter(isPendingDecision)).toHaveLength(0)
    const probe = await Promise.race([resumedPromise.then((): boolean => true), Promise.resolve(false)])
    expect(probe).toBe(false)
    void resumedPromise
  })
})
