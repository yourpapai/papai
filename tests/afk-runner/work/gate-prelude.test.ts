// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { readEvents, stampEvent } from '../../../afk-runner/src/events.js'
import type { EventInput, SddEvent } from '../../../afk-runner/src/events.js'
import type { KernelContext } from '../../../afk-runner/src/kernel/machine.js'
import { initialKernelContext } from '../../../afk-runner/src/kernel/machine.js'
import { startRun } from '../../../afk-runner/src/run.js'
import { presentGate } from '../../../afk-runner/src/work/gate-files.js'
import { autoExtendsUsedOf, runGatePrelude } from '../../../afk-runner/src/work/gate-prelude.js'
import type { GatePreludeInput } from '../../../afk-runner/src/work/gate-prelude.js'
import type { ReviewLoopResult } from '../../../afk-runner/src/work/review-loop.js'
import { makeFakePipeline, TASK_TEXT } from '../fixtures/fake-pipeline.js'

const NULL_DIGEST = { what: null, why: null, touches: null, hasTasks: false }

function reviewResult(overrides: Partial<ReviewLoopResult> = {}): ReviewLoopResult {
  return { outcome: 'cap-hit', rounds: 1, openBlockers: [], openMaterial: [], openNitpicks: [], ...overrides }
}

interface PreludeHarness {
  readonly runDir: string
  readonly emitted: EventInput[]
  readonly prelude: (overrides?: Partial<GatePreludeInput>) => ReturnType<typeof runGatePrelude>
}

async function makePreludeHarness(): Promise<PreludeHarness> {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-prelude-'))
  const changeDir = path.join(runDir, 'change')
  const sidecarDir = path.join(runDir, 'sidecars')
  fs.mkdirSync(sidecarDir, { recursive: true })
  fs.mkdirSync(path.join(changeDir, 'specs'), { recursive: true })
  fs.writeFileSync(path.join(changeDir, 'proposal.md'), 'hello')
  const emitted: EventInput[] = []
  const emit = (event: EventInput): void => {
    emitted.push(event)
  }
  await presentGate(
    { emit, runDir, changeDir, driftCheck: () => Promise.resolve() },
    {
      version: 1,
      mode: 'early',
      changeName: 'add-thing',
      runId: 'run-1',
      assumptions: [],
      blockers: [],
      openMaterial: [{ id: 'F1', gap: 'F1', evidence: 'evidence-answered — documented' }],
      openNitpicks: [],
      trajectory: [],
      capHitFired: true,
      summary: 'add-thing',
      costUsd: 0,
      costKnown: true,
      durationMs: 0,
      changeDigest: NULL_DIGEST,
    },
  )
  const base: GatePreludeInput = {
    version: 1,
    mode: 'early',
    reviewResult: reviewResult(),
    context: initialKernelContext({}),
    events: [],
    sidecarDir,
    changeDir,
    runDir,
    repoRoot: runDir,
    emit,
    autonomy: { level: 'assist', costCeilingUsd: 5 },
  }
  return {
    runDir,
    emitted,
    prelude: (overrides = {}) => runGatePrelude({ ...base, ...overrides }),
  }
}

function typesOf(events: readonly { readonly type: string }[]): string[] {
  return events.map((event) => event.type)
}

describe('gate prelude — the autonomy ladder as producer', () => {
  it('always appends an auto_decision, rule none included (open BLOCKER never-cut)', async () => {
    const h = await makePreludeHarness()
    const result = await h.prelude({
      reviewResult: reviewResult({ openBlockers: [{ id: 'F1', class: 'BLOCKER', resolution: 'edited' }] }),
    })
    expect(result).toMatchObject({ rule: 'none', action: 'gate' })
    expect(h.emitted.at(-1)).toMatchObject({ type: 'auto_decision', rule: 'none', decision: 'gate' })
    expect(typesOf(h.emitted).includes('gate')).toBe(true)
  })

  it('R4 fails closed to the human gate when spend is unknown', async () => {
    const h = await makePreludeHarness()
    const result = await h.prelude({
      events: [
        stampEvent(
          {
            altitude: 'L1',
            type: 'done',
            agent: 'reviewer-r1',
            usage: { inputTokens: 100, outputTokens: 100, reasoningTokens: 0, costUsd: 0, wallMs: 1 },
          },
          1,
          '2026-08-27T00:00:00.000Z',
        ),
      ],
    })
    expect(result).toMatchObject({ rule: 'R4', action: 'gate' })
    expect(typesOf(h.emitted).filter((type) => type === 'gate').length).toBe(1)
  })

  it('R2 at an early gate auto-extends through the seam', async () => {
    const h = await makePreludeHarness()
    const context: KernelContext = {
      ...initialKernelContext({}),
      perRound: [
        { round: 1, counts: { blocker: 0, material: 3, nitpick: 0 }, resolved: 0, dismissed: 0, verdict: 'open' },
        { round: 2, counts: { blocker: 0, material: 2, nitpick: 0 }, resolved: 0, dismissed: 0, verdict: 'open' },
        { round: 3, counts: { blocker: 0, material: 1, nitpick: 0 }, resolved: 0, dismissed: 0, verdict: 'open' },
      ],
      round: { current: 3, cap: 3 },
    }
    const result = await h.prelude({
      context,
      reviewResult: reviewResult({
        rounds: 3,
        openMaterial: [{ id: 'F1', class: 'MATERIAL', resolution: 'evidence-answered', outcome: 'kept' }],
      }),
    })
    expect(result).toMatchObject({ rule: 'R2', action: 'extend' })
    expect(h.emitted.at(-3)).toMatchObject({ type: 'auto_decision', rule: 'R2', decision: 'extend' })
    expect(h.emitted.at(-2)).toMatchObject({ type: 'gate', action: 'answered', outcome: 'extend' })
    expect(h.emitted.at(-1)).toMatchObject({ type: 'round_open', round: 4, cap: 4 })
  })

  it('R1 at a final gate auto-approves through the seam', async () => {
    const h = await makePreludeHarness()
    const result = await h.prelude({
      mode: 'final',
      reviewResult: reviewResult({ outcome: 'converged' }),
    })
    expect(result).toMatchObject({ rule: 'R1', action: 'approve' })
    expect(h.emitted.at(-1)).toMatchObject({ type: 'gate', action: 'answered', outcome: 'approve' })
    const md = fs.readFileSync(path.join(h.runDir, 'gate-1.md'), 'utf8')
    expect(md).toContain('decided-by: policy R1')
  })

  it('the auto-extend allowance derives from folded auto-decision records', () => {
    const context: KernelContext = {
      ...initialKernelContext({}),
      autoDecisions: [
        { rule: 'R2', decision: 'extend', evidenceDigest: 'a', gateVersion: 1, seq: 1, ts: '' },
        { rule: 'none', decision: 'gate', evidenceDigest: 'b', gateVersion: 2, seq: 2, ts: '' },
        { rule: 'R2', decision: 'extend', evidenceDigest: 'c', gateVersion: 3, seq: 3, ts: '' },
      ],
    }
    expect(autoExtendsUsedOf(context)).toBe(2)
  })
})

function firstRunOf(pipeline: ReturnType<typeof makeFakePipeline>): string {
  const runsDir = path.join(pipeline.workDir, 'runs')
  const first = fs.readdirSync(runsDir)[0]
  if (first === undefined) throw new Error(`no runs under ${runsDir}`)
  return first
}

function roundOpenFour(event: SddEvent): boolean {
  return event.type === 'round_open' && event.round === 4
}

function hasEventType(events: readonly SddEvent[], type: string, action: string): boolean {
  return events.some((event) => event.type === type && 'action' in event && event.action === action)
}

function isR2Extend(event: SddEvent): boolean {
  return event.type === 'auto_decision' && event.rule === 'R2' && event.decision === 'extend'
}

function presentedGates(events: readonly SddEvent[]): SddEvent[] {
  return events.filter((event) => event.type === 'gate' && event.action === 'presented')
}

describe('gate prelude wired into the live presentation (integration)', () => {
  it('an M-depth run with a decreasing trajectory auto-extends at the cap and runs the extended round', async () => {
    const materials = (count: number, round: number): Record<string, string> => ({
      [`findings-${round}.json`]: JSON.stringify({
        findings: Array.from({ length: count }, (_, i) => ({
          id: `F${i + 1}`,
          class: 'MATERIAL',
          gap: `gap ${i + 1}`,
          question: `q ${i + 1}`,
          code_evidence_attempted: 'searched',
        })),
      }),
      [`resolutions-${round}.json`]: JSON.stringify({
        resolutions: Array.from({ length: count }, (_, i) => ({
          id: `F${i + 1}`,
          class: 'MATERIAL',
          resolution: 'evidence-answered',
          outcome: 'kept',
        })),
        assumptions: [],
      }),
    })
    const pipeline = makeFakePipeline({
      sidecarOverrides: {
        'depth.json': JSON.stringify({
          implicated_files: ['src/a.ts', 'src/b.ts'],
          signals: {
            cross_module: true,
            db_migration: false,
            provider_surface: false,
            credentials: false,
            novelty: 'existing-modules',
          },
          rationale: 'two modules',
        }),
        'draft-design.json': JSON.stringify({ files_written: ['openspec/changes/add-thing/design.md'] }),
        ...materials(3, 1),
        ...materials(2, 2),
        ...materials(1, 3),
        ...materials(0, 4),
      },
    })
    const taskFile = path.join(pipeline.repoRoot, 'task.md')
    fs.writeFileSync(taskFile, TASK_TEXT)
    const halted = await startRun(pipeline.deps, { taskFile })

    expect(halted.halted).toBe('gate-pending')
    const runDir = pipeline.runDirOf(firstRunOf(pipeline))
    const events = readEvents(path.join(runDir, 'events.ndjson'))
    const autoDecisions = events.filter((event) => event.type === 'auto_decision')
    expect(autoDecisions.length).toBeGreaterThan(0)
    expect(autoDecisions.some(isR2Extend)).toBe(true)
    // the final-gate presentation's ladder decision is the last one logged
    expect(autoDecisions[autoDecisions.length - 1]).toMatchObject({ gateVersion: 2 })
    expect(hasEventType(events, 'gate', 'answered')).toBe(true)
    expect(events.some(roundOpenFour)).toBe(true)
    expect(pipeline.spawnOrder).toContain('findings-4.json')
    expect(pipeline.spawnOrder).toContain('resolutions-4.json')
    // The converged extended round runs the M tail: both brackets and the
    // final-gate presentation land before the park.
    expect(pipeline.spawnOrder).toContain('decompose-tasks.json')
    expect(pipeline.spawnOrder).toContain('atomicity.json')
    expect(presentedGates(events).at(-1)).toMatchObject({ mode: 'final' })
  })
})
