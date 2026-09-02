// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import { existsSync } from 'node:fs'
import fs from 'node:fs'
import path from 'node:path'

import { flattenPosition } from '../../../afk-runner/src/drive/loop.js'
import { appendEvent } from '../../../afk-runner/src/events.js'
import type { EventInput, SddEvent } from '../../../afk-runner/src/events.js'
import { readEvents } from '../../../afk-runner/src/events.js'
import { pipelineMachine } from '../../../afk-runner/src/graph/pipeline.js'
import { foldEvents } from '../../../afk-runner/src/kernel/fold.js'
import { resumeRun } from '../../../afk-runner/src/run-resume.js'
import { PersistedRunStateSchema } from '../../../afk-runner/src/run-state.js'
import { recordSessionId, updateSessionStatus } from '../../../afk-runner/src/session-ledger.js'
import { TASK_TEXT, makeFakePipeline } from '../fixtures/fake-pipeline.js'

const STAMP = new Date('2026-08-29T00:00:00.000Z')

function gateEventsOf(events: readonly SddEvent[], action: 'presented' | 'answered'): SddEvent[] {
  return events.filter((event) => event.type === 'gate' && event.action === action)
}

function firstOfKind(events: readonly SddEvent[], kind: string): SddEvent | undefined {
  return events.find((event) => event.type === kind)
}

function answeredOutcomeAt(events: readonly SddEvent[], outcome: string): number {
  return events.findIndex((event) => event.type === 'gate' && event.action === 'answered' && event.outcome === outcome)
}

const FAILURE: EventInput = {
  altitude: 'L2',
  type: 'stage_failed',
  stage: 'review',
  kind: 'exhausted',
  reason: 'review round 1 failed after 2 attempts: schema invalid',
  resumeHint: 'resume the run',
}

/** Walk to an over-budget review with two declared failures (no gate record). */
const OVER_BUDGET: readonly EventInput[] = [
  { altitude: 'L2', type: 'stage_enter', stage: 'intake' },
  { altitude: 'L2', type: 'depth', profile: 'S', rationale: 'one module', source: 'estimator' },
  { altitude: 'L2', type: 'stage_exit', stage: 'intake' },
  { altitude: 'L2', type: 'stage_enter', stage: 'draft' },
  { altitude: 'L2', type: 'stage_exit', stage: 'draft' },
  { altitude: 'L2', type: 'stage_enter', stage: 'review' },
  { altitude: 'L2', type: 'round_open', round: 1, cap: 1 },
  FAILURE,
  FAILURE,
]

interface RecoveryHarness {
  readonly pipeline: ReturnType<typeof makeFakePipeline>
  readonly runId: string
  readonly runDir: string
  readonly logPath: string
}

function makeCrashedRun(extra: readonly EventInput[], withGateFile: boolean): RecoveryHarness {
  const pipeline = makeFakePipeline()
  const runId = 'add-thing'
  const runDir = path.join(pipeline.deps.config.workDir, 'runs', runId)
  fs.mkdirSync(runDir, { recursive: true })
  fs.writeFileSync(path.join(runDir, 'task.md'), TASK_TEXT)
  // the artifacts a mid-run crash leaves behind: the change dir intake created
  const changeDir = path.join(pipeline.deps.config.repoRoot, 'openspec', 'changes', runId)
  fs.mkdirSync(path.join(changeDir, 'specs'), { recursive: true })
  fs.writeFileSync(path.join(changeDir, 'proposal.md'), '<!-- content for draft-proposal.json -->\n')
  const logPath = path.join(runDir, 'events.ndjson')
  for (const event of [...OVER_BUDGET, ...extra]) appendEvent(logPath, event, STAMP)
  if (withGateFile) {
    fs.writeFileSync(
      path.join(runDir, 'gate-1.md'),
      '<!-- gate-1.md -->\n\n## Escalation gate — review exhausted its retry budget — change add-thing\n\n- [ ] T1 I reviewed the failure ledger above\n',
    )
  }
  return { pipeline, runId, runDir, logPath }
}

function foldOf(logPath: string): { readonly value: string; readonly failures: Record<string, number> } {
  const snapshot = foldEvents(pipelineMachine, readEvents(logPath)).snapshot
  return {
    value: flattenPosition(snapshot.value),
    failures: { ...snapshot.context.failures },
  }
}

describe('W5/W6 — owed escalation presentation on resume (C6 D10)', () => {
  it('files present: resume re-presents at the on-disk file version and parks gate-pending', async () => {
    const h = makeCrashedRun([], true)
    const result = await resumeRun(h.pipeline.deps, h.runId)
    expect(result.halted).toBe('gate-pending')
    const events = readEvents(h.logPath)
    expect(gateEventsOf(events, 'presented').at(-1)).toMatchObject({ mode: 'escalation', version: 1 })
    expect(firstOfKind(events, 'auto_decision')).toMatchObject({ decision: 'gate', gateVersion: 1 })
    expect(foldOf(h.logPath).value).toBe('gate.awaiting')
    // the failed stage stays active in the map through the healed presentation
    const memo = PersistedRunStateSchema.parse(JSON.parse(fs.readFileSync(path.join(h.runDir, 'state.json'), 'utf8')))
    expect(memo.status).toBe('running')
    expect(memo.gate).toEqual({ mode: 'escalation', version: 1 })
  })

  it('files absent: resume fresh-renders the escalation gate and parks gate-pending', async () => {
    const h = makeCrashedRun([], false)
    const result = await resumeRun(h.pipeline.deps, h.runId)
    expect(result.halted).toBe('gate-pending')
    expect(existsSync(path.join(h.runDir, 'gate-1.md'))).toBe(true)
    const md = fs.readFileSync(path.join(h.runDir, 'gate-1.md'), 'utf8')
    expect(md).toContain('Failure ledger')
    expect(gateEventsOf(readEvents(h.logPath), 'presented').at(-1)).toMatchObject({
      mode: 'escalation',
      version: 1,
    })
  })
})

describe('W7 — answered escalation gate whose mover never landed (C6 D10)', () => {
  it('approve: resume appends the owed stage_enter mover targeting the still-active stage and completes', async () => {
    const h = makeCrashedRun(
      [
        { altitude: 'L2', type: 'gate', action: 'presented', mode: 'escalation', version: 1 },
        { altitude: 'L2', type: 'auto_decision', rule: 'none', decision: 'gate', evidenceDigest: 'x', gateVersion: 1 },
        { altitude: 'L2', type: 'gate', action: 'answered', mode: 'escalation', version: 1, outcome: 'approve' },
      ],
      true,
    )
    const result = await resumeRun(h.pipeline.deps, h.runId)
    expect(result.drove).toBe(true)
    expect(result.halted).toBe('final')
    expect(result.position).toBe('completed')
    const events = readEvents(h.logPath)
    const answeredAt = answeredOutcomeAt(events, 'approve')
    expect(events[answeredAt + 1]).toMatchObject({ type: 'stage_exit', stage: 'review' })
    expect(events[answeredAt + 2]).toMatchObject({ type: 'stage_enter', stage: 'review' })
    // the retry re-ran the round work and completed the tail
    expect(events.at(-1)?.type).toBe('stage_exit')
  })

  it('extend: resume appends exit+enter — the ledger clears and the run completes', async () => {
    const h = makeCrashedRun(
      [
        { altitude: 'L2', type: 'gate', action: 'presented', mode: 'escalation', version: 1 },
        { altitude: 'L2', type: 'auto_decision', rule: 'none', decision: 'gate', evidenceDigest: 'x', gateVersion: 1 },
        { altitude: 'L2', type: 'gate', action: 'answered', mode: 'escalation', version: 1, outcome: 'extend' },
      ],
      true,
    )
    const result = await resumeRun(h.pipeline.deps, h.runId)
    expect(result.halted).toBe('final')
    expect(result.position).toBe('completed')
    const events = readEvents(h.logPath)
    const answeredAt = answeredOutcomeAt(events, 'extend')
    expect(events[answeredAt + 1]).toMatchObject({ type: 'stage_exit', stage: 'review' })
    expect(events[answeredAt + 2]).toMatchObject({ type: 'stage_enter', stage: 'review' })
    expect(foldOf(h.logPath).failures).toEqual({})
  })
})

describe('W5 against a live-shaped run — the unpresented park heals on resume', () => {
  it('a run parked by the failure catch without a presenter (loop-test shape) re-presents on resume', async () => {
    const h = makeCrashedRun([], false)
    // simulate the drive parking gate-pending unpresented: exactly OVER_BUDGET state
    const result = await resumeRun(h.pipeline.deps, h.runId)
    expect(result.halted).toBe('gate-pending')
    expect(result.drove).toBe(false)
    expect(gateEventsOf(readEvents(h.logPath), 'presented').at(-1)).toMatchObject({
      mode: 'escalation',
      version: 1,
    })
  })
})

describe('escalation-approve re-entry continues the killed session (escalation-retry-session-continuation D1/D2)', () => {
  it('an approved intake escalation re-enters continuing the ledger killed session id', async () => {
    const pipeline = makeFakePipeline()
    const runId = 'add-thing'
    const runDir = path.join(pipeline.deps.config.workDir, 'runs', runId)
    fs.mkdirSync(runDir, { recursive: true })
    fs.writeFileSync(path.join(runDir, 'task.md'), TASK_TEXT)
    // the artifacts a mid-run crash leaves behind: the change dir intake created
    const changeDir = path.join(pipeline.deps.config.repoRoot, 'openspec', 'changes', runId)
    fs.mkdirSync(path.join(changeDir, 'specs'), { recursive: true })
    fs.writeFileSync(path.join(changeDir, 'proposal.md'), '<!-- content for draft-proposal.json -->\n')
    const logPath = path.join(runDir, 'events.ndjson')
    const intakeFailure: EventInput = {
      altitude: 'L2',
      type: 'stage_failed',
      stage: 'intake',
      kind: 'exhausted',
      reason: 'stage agent estimator failed validation after 2 attempts: schema invalid',
      resumeHint: 'resume the run',
    }
    const answered = [
      { altitude: 'L2', type: 'stage_enter', stage: 'intake' } as const,
      intakeFailure,
      intakeFailure,
      { altitude: 'L2', type: 'gate', action: 'presented', mode: 'escalation', version: 1 } as const,
      {
        altitude: 'L2',
        type: 'auto_decision',
        rule: 'none',
        decision: 'gate',
        evidenceDigest: 'x',
        gateVersion: 1,
      } as const,
      { altitude: 'L2', type: 'gate', action: 'answered', mode: 'escalation', version: 1, outcome: 'approve' } as const,
    ]
    for (const event of answered) appendEvent(logPath, event, STAMP)
    fs.writeFileSync(
      path.join(runDir, 'gate-1.md'),
      '<!-- gate-1.md -->\n\n## Escalation gate — intake exhausted its retry budget — change add-thing\n\n- [ ] T1 I reviewed the failure ledger above\n',
    )
    // the ledger's killed in-flight estimator session the re-entry must continue
    recordSessionId(runDir, { label: 'estimator', role: 'estimator', round: 0, model: 'test-model' }, 'ses-intake')
    updateSessionStatus(runDir, 'estimator', 0, 'killed')

    const result = await resumeRun(pipeline.deps, runId)
    expect(result.drove).toBe(true)
    expect(result.halted).toBe('final')
    const depthArgs = pipeline.spawnArgs['depth.json']!
    const depthPrompts = pipeline.spawnPrompts['depth.json']!
    expect(depthArgs).toHaveLength(1)
    const sessionIndex = depthArgs[0]!.indexOf('--session')
    expect(sessionIndex).toBeGreaterThan(-1)
    expect(depthArgs[0]![sessionIndex + 1]).toBe('ses-intake')
    expect(depthPrompts[0]).toContain('Continue the interrupted task in this session.')
  })
})
