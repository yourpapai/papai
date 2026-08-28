// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'

import { owedMoverOf } from '../../../afk-runner/src/drive/resume.js'
import { appendEvent, readEvents } from '../../../afk-runner/src/events.js'
import type { EventInput, SddEvent } from '../../../afk-runner/src/events.js'
import { initialKernelContext } from '../../../afk-runner/src/kernel/machine.js'
import type { KernelContext } from '../../../afk-runner/src/kernel/machine.js'
import { resumeRun } from '../../../afk-runner/src/run.js'
import { startRun } from '../../../afk-runner/src/run.js'
import { makeFakePipeline, TASK_TEXT } from '../fixtures/fake-pipeline.js'

function contextOf(overrides: Partial<KernelContext> = {}): KernelContext {
  return {
    ...initialKernelContext({}),
    gate: { mode: 'early', version: 1, answered: true },
    gateOutcome: 'extend',
    round: { current: 4, cap: 4 },
    ...overrides,
  }
}

describe('owedMoverOf — pure reader of the answered-but-unmoved window', () => {
  it('an answered extend with no mover owes round_open n+1 at cap+1', () => {
    expect(owedMoverOf(contextOf(), 'gate.awaiting')).toEqual({
      altitude: 'L2',
      type: 'round_open',
      round: 5,
      cap: 5,
    })
  })

  it('an answered early approve owes the stage_enter(decompose) mover', () => {
    expect(owedMoverOf(contextOf({ gateOutcome: 'approve' }), 'gate.awaiting')).toEqual({
      altitude: 'L2',
      type: 'stage_enter',
      stage: 'decompose',
    })
  })

  it('an answered veto owes the stage_enter(draft) mover', () => {
    expect(owedMoverOf(contextOf({ gateOutcome: 'veto' }), 'gate.awaiting')).toEqual({
      altitude: 'L2',
      type: 'stage_enter',
      stage: 'draft',
    })
  })

  it('a historical answered-no-outcome gate owes nothing (parks awaiting settlement)', () => {
    expect(owedMoverOf(contextOf({ gateOutcome: null }), 'gate.awaiting')).toBeNull()
  })

  it('an unanswered gate owes nothing, and positions outside awaiting owe nothing', () => {
    expect(owedMoverOf(contextOf({ gate: { mode: 'early', version: 1, answered: false } }), 'gate.awaiting')).toBeNull()
    expect(owedMoverOf(contextOf(), 'review')).toBeNull()
  })

  it('an abort outcome never owes a mover (the graph edge already terminated the run)', () => {
    expect(owedMoverOf(contextOf({ gateOutcome: 'abort' }), 'gate.awaiting')).toBeNull()
  })
})

interface DrillHarness {
  readonly pipeline: ReturnType<typeof makeFakePipeline>
  readonly runId: string
  readonly runDir: string
  readonly append: (event: EventInput) => void
}

async function parkedGateRun(): Promise<DrillHarness> {
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
  const taskFile = path.join(pipeline.repoRoot, 'task.md')
  fs.writeFileSync(taskFile, TASK_TEXT)
  const halted = await startRun(pipeline.deps, { taskFile })
  const runId = halted.runId
  const runDir = pipeline.runDirOf(runId)
  return {
    pipeline,
    runId,
    runDir,
    append: (event) => {
      appendEvent(path.join(runDir, 'events.ndjson'), event)
    },
  }
}

function readLog(runDir: string): SddEvent[] {
  return readEvents(path.join(runDir, 'events.ndjson'))
}

function roundOpenTwo(event: SddEvent): boolean {
  return event.type === 'round_open' && event.round === 2
}

function presentedGates(events: readonly SddEvent[]): SddEvent[] {
  return events.filter((event) => event.type === 'gate' && event.action === 'presented')
}

describe('resume gate — owed movers and historical parks', () => {
  it('resume appends the owed round_open for a crash between answer and mover, then drives the round', async () => {
    const h = await parkedGateRun()
    h.append({ altitude: 'L2', type: 'gate', action: 'answered', mode: 'early', version: 1, outcome: 'extend' })
    const resumed = await resumeRun(h.pipeline.deps, h.runId)
    expect(resumed.drove).toBe(true)
    const events = readLog(h.runDir)
    expect(events.some(roundOpenTwo)).toBe(true)
    expect(h.pipeline.spawnOrder).toContain('findings-2.json')
  })

  it('resume appends the owed stage_enter(decompose) and drives the S tail to the final gate', async () => {
    const h = await parkedGateRun()
    h.append({ altitude: 'L2', type: 'gate', action: 'answered', mode: 'final', version: 1, outcome: 'approve' })
    const before = readLog(h.runDir).length
    const resumed = await resumeRun(h.pipeline.deps, h.runId)
    expect(resumed.halted).toBe('gate-pending')
    const events = readLog(h.runDir)
    expect(events.length).toBeGreaterThan(before + 1)
    expect(events.at(-1)).toMatchObject({ type: 'stage_exit', stage: 'decompose' })
    expect(presentedGates(events).at(-1)).toMatchObject({ mode: 'final', version: 2 })
  })

  it('a historical answered-no-outcome log parks awaiting settlement with nothing appended', async () => {
    const h = await parkedGateRun()
    h.append({ altitude: 'L2', type: 'gate', action: 'answered', mode: 'early', version: 1 })
    const before = readLog(h.runDir).length
    const resumed = await resumeRun(h.pipeline.deps, h.runId)
    expect(resumed).toMatchObject({ halted: 'gate-pending', drove: false })
    expect(readLog(h.runDir).length).toBe(before)
  })
})
