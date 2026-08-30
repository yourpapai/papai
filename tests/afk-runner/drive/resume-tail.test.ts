// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'

import { appendEvent, readEvents } from '../../../afk-runner/src/events.js'
import type { EventInput, SddEvent } from '../../../afk-runner/src/events.js'
import { resumeRun } from '../../../afk-runner/src/run-resume.js'
import { makeFakePipeline, TASK_TEXT } from '../fixtures/fake-pipeline.js'

interface CrashRun {
  readonly pipeline: ReturnType<typeof makeFakePipeline>
  readonly runId: string
  readonly runDir: string
  readonly logPath: string
}

/** A fake-pipeline run dir seeded with a hand-crafted crash log (no agents run). */
function makeCrashRun(events: readonly EventInput[], gateFiles: readonly string[]): CrashRun {
  const pipeline = makeFakePipeline()
  const runId = 'add-thing'
  const runDir = pipeline.runDirOf(runId)
  fs.mkdirSync(runDir, { recursive: true })
  fs.writeFileSync(path.join(runDir, 'task.md'), TASK_TEXT)
  const logPath = path.join(runDir, 'events.ndjson')
  for (const event of events) appendEvent(logPath, event)
  for (const file of gateFiles) {
    const match = /^gate-(\d+)\.md$/u.exec(file)
    fs.writeFileSync(path.join(runDir, file), 'gate digest placeholder\n')
    if (match !== null) fs.writeFileSync(path.join(runDir, `gate-hashes-${match[1]}.json`), '{}\n')
  }
  return { pipeline, runId, runDir, logPath }
}

const DEPTH_M: EventInput = {
  altitude: 'L2',
  type: 'depth',
  profile: 'M',
  rationale: 'two modules',
  source: 'estimator',
}

/** An unknown-cost done event: R4 fail-closed keeps the recovery ladder at the human gate. */
const UNKNOWN_COST_DONE: EventInput = {
  altitude: 'L1',
  type: 'done',
  agent: 'reviewer-r1',
  model: 'test-model',
  usage: {
    inputTokens: 100,
    outputTokens: 10,
    reasoningTokens: 0,
    cachedReadTokens: 0,
    cachedWriteTokens: 0,
    costUsd: 0,
    wallMs: 5,
  },
}

/** The M walk through the converged tail, stopping where the caller cuts it. */
function mTailWalk(through: 'gate-enter' | 'early-extend-history'): readonly EventInput[] {
  const base: EventInput[] = [
    UNKNOWN_COST_DONE,
    { altitude: 'L2', type: 'stage_enter', stage: 'intake' },
    DEPTH_M,
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
  ]
  if (through === 'gate-enter') return [...base, { altitude: 'L2', type: 'stage_enter', stage: 'gate' }]
  return [
    ...base,
    { altitude: 'L2', type: 'gate', action: 'presented', mode: 'early', version: 1 },
    { altitude: 'L2', type: 'auto_decision', rule: 'none', decision: 'gate', evidenceDigest: 'x', gateVersion: 1 },
    { altitude: 'L2', type: 'gate', action: 'answered', mode: 'final', version: 1, outcome: 'extend' },
    { altitude: 'L2', type: 'stage_exit', stage: 'gate' },
    { altitude: 'L2', type: 'round_open', round: 2, cap: 4 },
    {
      altitude: 'L2',
      type: 'convergence',
      round: 2,
      verdict: 'converged',
      counts: { blocker: 0, material: 0, nitpick: 0 },
    },
    { altitude: 'L2', type: 'round_close', round: 2, cap: 4 },
    { altitude: 'L2', type: 'stage_exit', stage: 'review' },
    { altitude: 'L2', type: 'stage_enter', stage: 'decompose' },
    { altitude: 'L2', type: 'stage_exit', stage: 'decompose' },
    { altitude: 'L2', type: 'stage_enter', stage: 'atomicity' },
    { altitude: 'L2', type: 'stage_enter', stage: 'gate' },
  ]
}

function presentedEventsOf(logPath: string): SddEvent[] {
  return readEvents(logPath).filter((event) => event.type === 'gate' && event.action === 'presented')
}

function roundOpensOf(logPath: string): Extract<SddEvent, { type: 'round_open' }>[] {
  return readEvents(logPath).filter(
    (event): event is Extract<SddEvent, { type: 'round_open' }> => event.type === 'round_open',
  )
}

describe('resume tail crash-window recovery (C5 D5)', () => {
  it('W3a: crash between gate entry and presentation — resume appends the owed presentation at the file-scan version and re-runs the ladder', async () => {
    // The early gate file was rendered before the crash too (file-first).
    const h = makeCrashRun(mTailWalk('gate-enter'), ['gate-1.md'])
    const before = readEvents(h.logPath).length

    const resumed = await resumeRun(h.pipeline.deps, h.runId)

    expect(resumed).toMatchObject({ halted: 'gate-pending', position: 'gate.awaiting' })
    const events = readEvents(h.logPath)
    expect(events.length).toBeGreaterThan(before)
    expect(presentedEventsOf(h.logPath)).toHaveLength(1)
    expect(presentedEventsOf(h.logPath)[0]).toMatchObject({ mode: 'final', version: 1 })
    const ladder = events.filter((event) => event.type === 'auto_decision')
    expect(ladder.at(-1)).toMatchObject({ gateVersion: 1 })
    // parks gate-pending with an unanswered record — no waiter loop, no agents spawned
    expect(h.pipeline.spawnOrder).toEqual([])
  })

  it('W3b: stale answered early record — resume appends the owed final presentation, not a phantom round_open', async () => {
    // gate-1.md is the landed early gate; gate-2.md is the final file the
    // crashed presenter rendered before its stage_enter(gate).
    const h = makeCrashRun(mTailWalk('early-extend-history'), ['gate-1.md', 'gate-2.md'])
    const before = readEvents(h.logPath).length

    const resumed = await resumeRun(h.pipeline.deps, h.runId)

    expect(resumed).toMatchObject({ halted: 'gate-pending', position: 'gate.awaiting' })
    const events = readEvents(h.logPath)
    expect(events.length).toBeGreaterThan(before)
    expect(presentedEventsOf(h.logPath).at(-1)).toMatchObject({ mode: 'final', version: 2 })
    // the extend mover already landed as round 2 — a third round is never opened
    expect(roundOpensOf(h.logPath).filter((event) => event.round === 3)).toHaveLength(0)
    expect(h.pipeline.spawnOrder).toEqual([])
  })
})
