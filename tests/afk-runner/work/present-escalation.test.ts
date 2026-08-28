// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { RunnerConfig } from '../../../afk-runner/src/config.js'
import { createAppendBoundary } from '../../../afk-runner/src/drive/boundary.js'
import type { WorkIO } from '../../../afk-runner/src/drive/loop.js'
import { appendEvent } from '../../../afk-runner/src/events.js'
import type { EventInput, SddEvent } from '../../../afk-runner/src/events.js'
import { readEvents } from '../../../afk-runner/src/events.js'
import { pipelineMachine } from '../../../afk-runner/src/graph/pipeline.js'
import { foldEvents } from '../../../afk-runner/src/kernel/fold.js'
import { presentEscalationGate } from '../../../afk-runner/src/work/present-escalation.js'
import type { PresentEscalationDeps } from '../../../afk-runner/src/work/present-escalation.js'

const STAMP = new Date('2026-08-29T00:00:00.000Z')

const PRELUDE: readonly EventInput[] = [
  { altitude: 'L2', type: 'stage_enter', stage: 'intake' },
  { altitude: 'L2', type: 'depth', profile: 'S', rationale: 'one module', source: 'estimator' },
  { altitude: 'L2', type: 'stage_exit', stage: 'intake' },
  { altitude: 'L2', type: 'stage_enter', stage: 'draft' },
  { altitude: 'L2', type: 'stage_exit', stage: 'draft' },
  { altitude: 'L2', type: 'stage_enter', stage: 'review' },
  { altitude: 'L2', type: 'round_open', round: 1, cap: 1 },
]

const FAILURES: readonly EventInput[] = [
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
    kind: 'infra',
    reason: 'could not reach the agent: spawn opencode ENOENT',
    resumeHint: 'resume the run',
  },
]

const USAGE = {
  altitude: 'L1' as const,
  type: 'done' as const,
  agent: 'reviewer-r1',
  usage: {
    inputTokens: 100,
    outputTokens: 50,
    reasoningTokens: 0,
    cachedReadTokens: 0,
    cachedWriteTokens: 0,
    costUsd: 0.42,
    wallMs: 1_000,
  },
}

interface Harness {
  readonly runDir: string
  readonly io: (context: WorkIO['context']) => WorkIO
  readonly gateMd: () => string
  readonly config: (budget: number) => RunnerConfig
}

function makeHarness(usage: readonly EventInput[] = [USAGE]): Harness {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-escal-'))
  const changeDir = path.join(runDir, 'change')
  fs.mkdirSync(path.join(changeDir, 'specs'), { recursive: true })
  const logPath = path.join(runDir, 'events.ndjson')
  for (const event of [...PRELUDE, ...FAILURES, ...usage]) {
    appendEvent(logPath, event, STAMP)
  }
  const boundary = createAppendBoundary(pipelineMachine, logPath, { now: () => STAMP })
  return {
    runDir,
    io: (ctx: WorkIO['context']): WorkIO => ({ append: boundary.append, context: ctx, runDir }),
    gateMd: (): string => fs.readFileSync(path.join(runDir, 'gate-1.md'), 'utf8'),
    config: (budget): RunnerConfig => ({
      repoRoot: runDir,
      workDir: path.join(runDir, '.afk'),
      model: 'test-model',
      budget,
    }),
  }
}

const DEPS = (config: RunnerConfig, runDir: string): PresentEscalationDeps => ({
  config,
  repoRoot: runDir,
  changeName: 'add-thing',
  runId: 'add-thing',
})

function autoDecisionOf(events: readonly SddEvent[]): SddEvent | undefined {
  return events.find((event) => event.type === 'auto_decision')
}

function presentedEventsOf(events: readonly SddEvent[]): SddEvent[] {
  return events.filter((event) => event.type === 'gate' && event.action === 'presented')
}

describe('escalation presentation — file-first, interstitial, ladder always logs (C6 D4/D5)', () => {
  it('renders the failure ledger, resume hint, budget math, and spend into gate-<v>.md', async () => {
    const h = makeHarness()
    const context = foldEvents(pipelineMachine, readEvents(path.join(h.runDir, 'events.ndjson'))).snapshot.context
    await presentEscalationGate(DEPS(h.config(5), h.runDir), h.io(context), 'review')
    const md = h.gateMd()
    expect(md).toContain('review · exhausted: review round 1 failed after 2 attempts: schema invalid')
    expect(md).toContain('review · infra: could not reach the agent: spawn opencode ENOENT')
    expect(md).toContain('resume: resume the run')
    expect(md).toContain('2 declared failures · budget 1')
    expect(md).toContain('$0.42')
    expect(md).toContain('afk-runner resume add-thing')
  })

  it('the presented event is the mover: parks gate.awaiting with the failed stage still active', async () => {
    const h = makeHarness()
    const context = foldEvents(pipelineMachine, readEvents(path.join(h.runDir, 'events.ndjson'))).snapshot.context
    await presentEscalationGate(DEPS(h.config(5), h.runDir), h.io(context), 'review')
    const events = readEvents(path.join(h.runDir, 'events.ndjson'))
    expect(presentedEventsOf(events).at(-1)).toMatchObject({ mode: 'escalation', version: 1 })
    const snapshot = foldEvents(pipelineMachine, events).snapshot
    expect(snapshot.value).toEqual({ gate: 'awaiting' })
    expect(snapshot.context.stages['review']).toBe('active')
    expect(snapshot.context.stages['gate']).toBe('pending')
    expect(snapshot.context.failures).toEqual({ review: 2 })
  })

  it('under the ceiling the ladder logs rule none at the human gate and the extend directive is offered', async () => {
    const h = makeHarness()
    const context = foldEvents(pipelineMachine, readEvents(path.join(h.runDir, 'events.ndjson'))).snapshot.context
    await presentEscalationGate(DEPS(h.config(5), h.runDir), h.io(context), 'review')
    const decision = readEvents(path.join(h.runDir, 'events.ndjson')).find((event) => event.type === 'auto_decision')
    expect(decision).toMatchObject({ rule: 'none', decision: 'gate', gateVersion: 1 })
    expect(h.gateMd()).toContain('→ RUN 1 MORE')
  })

  it('over the ceiling attributes R5 and suppresses the extend offer', async () => {
    const h = makeHarness()
    const context = foldEvents(pipelineMachine, readEvents(path.join(h.runDir, 'events.ndjson'))).snapshot.context
    await presentEscalationGate(DEPS(h.config(0.01), h.runDir), h.io(context), 'review')
    const decision = readEvents(path.join(h.runDir, 'events.ndjson')).find((event) => event.type === 'auto_decision')
    expect(decision).toMatchObject({ rule: 'R5', decision: 'gate', gateVersion: 1 })
    expect(h.gateMd()).not.toContain('→ RUN 1 MORE')
  })

  it('unknown cost attributes R5 too — fail-closed on the retry question', async () => {
    const unknownCost = {
      ...USAGE,
      usage: { ...USAGE.usage, costUsd: 0, inputTokens: 900 },
    }
    const h = makeHarness([unknownCost])
    const context = foldEvents(pipelineMachine, readEvents(path.join(h.runDir, 'events.ndjson'))).snapshot.context
    await presentEscalationGate(DEPS(h.config(5), h.runDir), h.io(context), 'review')
    expect(autoDecisionOf(readEvents(path.join(h.runDir, 'events.ndjson')))).toMatchObject({ rule: 'R5' })
    expect(h.gateMd()).toContain('unknown')
  })

  it('shares the gate file namespace: a prior presentation bumps the version', async () => {
    const h = makeHarness()
    const logPath = path.join(h.runDir, 'events.ndjson')
    appendEvent(logPath, { altitude: 'L2', type: 'gate', action: 'presented', mode: 'early', version: 3 }, STAMP)
    const context = foldEvents(pipelineMachine, readEvents(logPath)).snapshot.context
    await presentEscalationGate(DEPS(h.config(5), h.runDir), h.io(context), 'review')
    expect(fs.existsSync(path.join(h.runDir, 'gate-4.md'))).toBe(true)
    expect(presentedEventsOf(readEvents(logPath)).at(-1)).toMatchObject({ mode: 'escalation', version: 4 })
  })
})
