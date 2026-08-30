// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'

import type { EventInput, SddEvent } from '../../afk-runner/src/events.js'
import { readEvents, stampEvent } from '../../afk-runner/src/events.js'
import { initialKernelContext } from '../../afk-runner/src/kernel/machine.js'
import type { KernelContext } from '../../afk-runner/src/kernel/machine.js'
import { owedStageExitsOf } from '../../afk-runner/src/run-recovery.js'
import { resumeRun, startRun } from '../../afk-runner/src/run.js'
import { makeFakePipeline, TASK_TEXT } from './fixtures/fake-pipeline.js'

const NITPICK_ROUND = {
  'findings-1.json': JSON.stringify({
    findings: [{ id: 'F1', class: 'NITPICK', gap: 'typo', question: 'q', code_evidence_attempted: 'a' }],
  }),
  'resolutions-1.json': JSON.stringify({
    resolutions: [{ id: 'F1', class: 'NITPICK', resolution: 'evidence-answered', outcome: 'kept as informational' }],
    assumptions: [],
  }),
  'findings-2.json': JSON.stringify({
    findings: [{ id: 'F1', class: 'NITPICK', gap: 'typo', question: 'q', code_evidence_attempted: 'a' }],
  }),
  'resolutions-2.json': JSON.stringify({
    resolutions: [{ id: 'F1', class: 'NITPICK', resolution: 'evidence-answered', outcome: 'kept as informational' }],
    assumptions: [],
  }),
}

/** Depth-M shape: blocker round 1, nitpick-only round 2 — decompose then atomicity present the final gate. */
const M_ATOMICITY_ROUND = {
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
  'findings-1.json': JSON.stringify({
    findings: [{ id: 'F1', class: 'BLOCKER', gap: 'no rollback story', question: 'q', code_evidence_attempted: 'a' }],
  }),
  'resolutions-1.json': JSON.stringify({
    resolutions: [{ id: 'F1', class: 'BLOCKER', resolution: 'edited', outcome: 'added a rollback section' }],
    assumptions: [],
  }),
  'findings-2.json': JSON.stringify({
    findings: [{ id: 'F2', class: 'NITPICK', gap: 'typo', question: 'q', code_evidence_attempted: 'a' }],
  }),
  'resolutions-2.json': JSON.stringify({
    resolutions: [{ id: 'F2', class: 'NITPICK', resolution: 'evidence-answered', outcome: 'kept as informational' }],
    assumptions: [],
  }),
}

interface CrashHarness {
  readonly pipeline: ReturnType<typeof makeFakePipeline>
  readonly runId: string
  readonly runDir: string
  readonly logPath: string
  readonly droppedStage: string
}

/** Park a run at its final gate, then simulate a kill after `presented` by dropping the tail stage's closing exit. */
async function killedAfterPresented(sidecars: Record<string, string>): Promise<CrashHarness> {
  const pipeline = makeFakePipeline({ sidecarOverrides: sidecars })
  const started = await startRun(pipeline.deps, { taskText: TASK_TEXT })
  const runId = started.runId
  const runDir = pipeline.runDirOf(runId)
  const logPath = path.join(runDir, 'events.ndjson')
  expect(started.halted).toBe('gate-pending')
  const events = readEvents(logPath)
  const last = events.at(-1)
  if (last === undefined || last.type !== 'stage_exit')
    throw new Error(`log does not end at a stage exit: ${JSON.stringify(last)}`)
  const droppedStage = last.stage
  const kept = events.slice(0, -1)
  fs.writeFileSync(logPath, '')
  for (const event of kept) {
    appendRaw(logPath, event)
  }
  return { pipeline, runId, runDir, logPath, droppedStage }
}

/** Re-append a folded event as raw NDJSON (identity re-stamp of the already-recorded line). */
function appendRaw(logPath: string, event: SddEvent): void {
  fs.appendFileSync(
    logPath,
    `${JSON.stringify({ ...event, ts: 'ts' in event ? event.ts : new Date().toISOString() })}\n`,
  )
}

function eventTokens(events: readonly SddEvent[]): string[] {
  return events.map((event) =>
    event.type === 'stage_enter' || event.type === 'stage_exit'
      ? `${event.type}:${event.stage}`
      : event.type === 'gate'
        ? `gate:${event.action}:${'outcome' in event ? (event.outcome ?? '') : ''}`
        : event.type,
  )
}

describe('owedStageExitsOf — pure reader of the mid-presentation crash window (D5)', () => {
  it('returns [] outside gate.awaiting, for unanswered-null gates, and for answered gates', () => {
    expect(owedStageExitsOf(contextOf({}), 'review')).toEqual([])
    expect(owedStageExitsOf(contextOf({ gate: null }), 'gate.awaiting')).toEqual([])
    expect(
      owedStageExitsOf(
        contextOf({ gate: { mode: 'final', version: 1, answered: true }, gateOutcome: 'veto' }),
        'gate.awaiting',
      ),
    ).toEqual([])
  })

  it('an escalation gate\u2019s failed-stage bracket is NOT an orphan — no exits owed', () => {
    const context = contextOf({
      gate: { mode: 'escalation', version: 1, answered: false },
      stages: { ...baseStages(), review: 'active' },
    })
    expect(owedStageExitsOf(context, 'gate.awaiting')).toEqual([])
  })

  it('a presented-unanswered final gate with an active presenting stage owes that stage\u2019s exit', () => {
    const context = contextOf({
      gate: { mode: 'final', version: 1, answered: false },
      stages: { ...baseStages(), atomicity: 'active', gate: 'active' },
    })
    expect(owedStageExitsOf(context, 'gate.awaiting')).toEqual([
      { altitude: 'L2', type: 'stage_exit', stage: 'atomicity' },
    ])
  })

  it('the final-gate tail crash is log-visible even though the map auto-closed the presenter', () => {
    const crashed = stamped([
      { altitude: 'L2', type: 'stage_enter', stage: 'decompose' },
      { altitude: 'L2', type: 'stage_enter', stage: 'gate' },
      { altitude: 'L2', type: 'gate', action: 'presented', mode: 'final', version: 1 },
      { altitude: 'L2', type: 'auto_decision', rule: 'none', decision: 'gate', evidenceDigest: 'x', gateVersion: 1 },
    ])
    const context = contextOf({ gate: { mode: 'final', version: 1, answered: false } })
    expect(owedStageExitsOf(context, 'gate.awaiting', crashed)).toEqual([
      { altitude: 'L2', type: 'stage_exit', stage: 'decompose' },
    ])
    // healthy park: the closing exit after the gate enter owes nothing
    const healthy = stamped([
      { altitude: 'L2', type: 'stage_enter', stage: 'decompose' },
      { altitude: 'L2', type: 'stage_enter', stage: 'gate' },
      { altitude: 'L2', type: 'gate', action: 'presented', mode: 'final', version: 1 },
      { altitude: 'L2', type: 'stage_exit', stage: 'decompose' },
    ])
    expect(owedStageExitsOf(context, 'gate.awaiting', healthy)).toEqual([])
  })
})

/** Stamp raw event inputs into their folded shape with synthetic seq/ts ordering. */
function stamped(raw: readonly EventInput[]): SddEvent[] {
  return raw.map((event, index) => stampEvent(event, index + 1, '2026-08-30T00:00:00.000Z'))
}

function baseStages(): Record<string, 'pending' | 'active' | 'done'> {
  return { intake: 'done', draft: 'done', review: 'done', decompose: 'done', atomicity: 'pending', gate: 'pending' }
}

function contextOf(overrides: {
  gate?: { mode: 'early' | 'final' | 'plan' | 'escalation'; version: number; answered: boolean } | null
  gateOutcome?: 'approve' | 'veto' | 'extend' | 'abort' | null
  stages?: Record<string, 'pending' | 'active' | 'done'>
}): KernelContext {
  return {
    ...initialKernelContext(baseStages()),
    ...(overrides.gate === undefined ? {} : { gate: overrides.gate }),
    ...(overrides.gateOutcome === undefined ? {} : { gateOutcome: overrides.gateOutcome }),
    ...(overrides.stages === undefined ? {} : { stages: overrides.stages }),
  }
}

describe('mid-presentation crash heals on resume (D5)', () => {
  it('depth-S decompose shape: resume appends the owed stage_exit and parks; a later approve completes the run', async () => {
    const h = await killedAfterPresented(NITPICK_ROUND)
    expect(h.droppedStage).toBe('decompose')
    // the log ends inside the presentation prelude — presented-unanswered, no closing exit
    expect(eventTokens(readEvents(h.logPath)).at(-1)).toBe('auto_decision')

    const resumed = await resumeRun(h.pipeline.deps, h.runId)
    expect(resumed).toMatchObject({ halted: 'gate-pending', drove: false })
    expect(eventTokens(readEvents(h.logPath))).toContain('stage_exit:decompose')

    fs.writeFileSync(
      path.join(h.runDir, 'gate-1.md'),
      '<!-- gate-1.md -->\n\n## Final gate\n\n## Gate response\n\nAPPROVE\n',
    )
    const clock = fakeClock()
    const approved = driveResume({ ...h.pipeline.deps, gateWait: { tick: clock.tick } }, h.runId)
    const halted = await settleAndWait(approved, clock)
    expect(halted.halted).toBe('final')
    const tokens = eventTokens(readEvents(h.logPath))
    expect(tokens.filter((token) => token === 'gate:answered:approve')).toHaveLength(1)
  })

  it('atomicity shape: the same heal closes the atomicity bracket', async () => {
    const h = await killedAfterPresented(M_ATOMICITY_ROUND)
    expect(h.droppedStage).toBe('atomicity')
    const resumed = await resumeRun(h.pipeline.deps, h.runId)
    expect(resumed).toMatchObject({ halted: 'gate-pending', drove: false })
    expect(eventTokens(readEvents(h.logPath))).toContain('stage_exit:atomicity')

    fs.writeFileSync(
      path.join(h.runDir, 'gate-1.md'),
      '<!-- gate-1.md -->\n\n## Final gate\n\n## Gate response\n\nAPPROVE\n',
    )
    const clock = fakeClock()
    const approved = driveResume({ ...h.pipeline.deps, gateWait: { tick: clock.tick } }, h.runId)
    const halted = await settleAndWait(approved, clock)
    expect(halted.halted).toBe('final')
  })
})

type ResumeOutcome = Awaited<ReturnType<typeof resumeRun>>

/** Resume through the injected clock, releasing ticks (bounded) until the run halts. */
async function settleAndWait(
  pending: Promise<ResumeOutcome>,
  clock: { readonly release: () => void },
  budget = 30,
): Promise<ResumeOutcome> {
  for (let i = 0; i < budget; i += 1) {
    clock.release()
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })
    const done = await Promise.race([pending.then((): boolean => true), Promise.resolve(false)])
    if (done) break
  }
  return pending
}

function driveResume(deps: Parameters<typeof resumeRun>[0], runId: string): Promise<ResumeOutcome> {
  return resumeRun(deps, runId)
}

/** Fake clock: each tick resolves only when the test releases it. */
function fakeClock(): { readonly tick: () => Promise<void>; readonly release: () => void } {
  const queue: Array<() => void> = []
  return {
    tick: () =>
      new Promise<void>((resolve) => {
        queue.push(resolve)
      }),
    release: (): void => {
      const resolve = queue.shift()
      if (resolve !== undefined) resolve()
    },
  }
}
