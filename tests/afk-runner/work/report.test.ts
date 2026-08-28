// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { runReportCommand } from '../../../afk-runner/src/cli.js'
import { readEvents } from '../../../afk-runner/src/events.js'
import type { EventInput, SddEvent } from '../../../afk-runner/src/events.js'
import { startRun } from '../../../afk-runner/src/run.js'
import type { RunDeps } from '../../../afk-runner/src/run.js'
import { buildReport } from '../../../afk-runner/src/work/report.js'
import type { ChangeDirSummary, ReportInput } from '../../../afk-runner/src/work/report.js'
import { makeFakePipeline, TASK_TEXT } from '../fixtures/fake-pipeline.js'

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-report-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

/** The v1 human answer lands 4 minutes after its presentation (median-dwell pricing). */
function tsOf(input: EventInput, base: number, index: number): string {
  if (input.type === 'gate' && input.action === 'answered' && input.version === 1) {
    return new Date(base + 240_000).toISOString()
  }
  return new Date(base + index).toISOString()
}

/** Stamp inputs with controlled timestamps. */
function stamped(inputs: readonly EventInput[]): SddEvent[] {
  const dir = makeDir()
  const logPath = path.join(dir, 'events.ndjson')
  const base = Date.parse('2026-01-01T00:00:00.000Z')
  inputs.forEach((input, index) => {
    const ts = tsOf(input, base, index)
    fs.appendFileSync(logPath, `${JSON.stringify({ ...input, seq: index + 1, ts })}\n`)
  })
  return readEvents(logPath)
}

/**
 * A completed-run event log: depth M, one open round, early gate v1
 * (human-answered 4 minutes after presentation), tail, final gate v2
 * (R1-approved — the avoided intervention).
 */
const COMPLETED_INPUTS: readonly EventInput[] = [
  { altitude: 'L2', type: 'stage_enter', stage: 'intake' },
  { altitude: 'L2', type: 'depth', profile: 'M', rationale: 'two modules', source: 'estimator' },
  { altitude: 'L2', type: 'stage_exit', stage: 'intake' },
  { altitude: 'L2', type: 'stage_enter', stage: 'draft' },
  { altitude: 'L2', type: 'stage_exit', stage: 'draft' },
  { altitude: 'L2', type: 'stage_enter', stage: 'review' },
  { altitude: 'L2', type: 'round_open', round: 1, cap: 3 },
  {
    altitude: 'L2',
    type: 'convergence',
    round: 1,
    verdict: 'open',
    counts: { blocker: 0, material: 2, nitpick: 0 },
  },
  { altitude: 'L2', type: 'round_close', round: 1, cap: 3 },
  { altitude: 'L2', type: 'gate', action: 'presented', mode: 'early', version: 1 },
  { altitude: 'L2', type: 'auto_decision', rule: 'none', decision: 'gate', evidenceDigest: 'x', gateVersion: 1 },
  { altitude: 'L2', type: 'gate', action: 'answered', mode: 'final', version: 1, outcome: 'approve' },
  { altitude: 'L2', type: 'stage_enter', stage: 'decompose' },
  { altitude: 'L2', type: 'stage_exit', stage: 'decompose' },
  { altitude: 'L2', type: 'stage_enter', stage: 'atomicity' },
  { altitude: 'L2', type: 'stage_enter', stage: 'gate' },
  { altitude: 'L2', type: 'gate', action: 'presented', mode: 'final', version: 2 },
  { altitude: 'L2', type: 'auto_decision', rule: 'R1', decision: 'approve', evidenceDigest: 'x', gateVersion: 2 },
  { altitude: 'L2', type: 'stage_exit', stage: 'atomicity' },
  { altitude: 'L2', type: 'stage_exit', stage: 'gate' },
  { altitude: 'L2', type: 'gate', action: 'answered', mode: 'final', version: 2, outcome: 'approve' },
]

/** The completed log without the v1 human answer: every settle is an auto-decide, no dwell history. */
function autoOnlyInputs(): readonly EventInput[] {
  return COMPLETED_INPUTS.filter(
    (event) => event.type !== 'gate' || event.action === 'presented' || event.version === 2,
  )
}

const CHANGE: ChangeDirSummary = { tasksDone: 3, tasksTotal: 5, artifacts: ['proposal.md'] }

function makeInput(events: readonly SddEvent[], overrides: Partial<ReportInput> = {}): ReportInput {
  return {
    readEvents: () => events,
    readChangeDir: () => Promise.resolve(CHANGE),
    execGit: () => Promise.resolve({ stdout: 'abc1234 feat: the change\nabc1235 test: the change\n', stderr: '' }),
    runId: 'add-thing',
    changeName: 'add-thing',
    branch: 'feat/add-thing',
    pr: false,
    ...overrides,
  }
}

describe('buildReport (sdd-runner/src/report.ts work copy)', () => {
  it('renders the pipeline facts: depth, review verdict, gate versions, skeptic lens', async () => {
    const report = await buildReport(makeInput(stamped(COMPLETED_INPUTS)))
    expect(report).toContain('### Depth')
    expect(report).toContain('M — two modules')
    expect(report).toContain('### Review')
    expect(report).toContain('open after 1 round')
    expect(report).toContain('gate versions presented: 2')
    expect(report).toContain('skeptic lens: not run — M profile')
    expect(report).toContain('### Tasks')
    expect(report).toContain('3/5 tasks complete')
  })

  it('records the skeptic lens when a skeptic role spawned', async () => {
    const withSkeptic = stamped([
      ...COMPLETED_INPUTS,
      { altitude: 'L1', type: 'spawned', agent: 'skeptic-r1', role: 'skeptic', model: 'm' },
    ])
    const report = await buildReport(makeInput(withSkeptic))
    expect(report).toContain('skeptic lens: run')
  })

  it('renders the commits line from git log on the branch', async () => {
    const report = await buildReport(makeInput(stamped(COMPLETED_INPUTS)))
    expect(report).toContain('### Commits on feat/add-thing')
    expect(report).toContain('abc1234 feat: the change')
    expect(report).toContain('abc1235 test: the change')
  })

  it('gains: the median human-gate dwell prices the R1-avoided gate; human gates counted', async () => {
    const report = await buildReport(makeInput(stamped(COMPLETED_INPUTS)))
    expect(report).toContain('### Gains')
    expect(report).toContain('interventions avoided: 1 · human gates: 1 · ~wall-time saved: 4m')
    expect(report).toContain('per rule: R1 × 1')
  })

  it('gains fall back to the conservative default dwell when no human history exists', async () => {
    const report = await buildReport(makeInput(stamped(autoOnlyInputs())))
    expect(report).toContain('interventions avoided: 1 · human gates: 0 · ~wall-time saved: 5m')
  })

  it('closes with the run and transcript paths', async () => {
    const report = await buildReport(makeInput(stamped(COMPLETED_INPUTS)))
    expect(report).toContain('run: add-thing')
    expect(report).toContain('transcripts: runs/add-thing/transcripts/')
    expect(report).toContain('sessions: runs/add-thing/sessions.jsonl')
  })

  it('PR-body mode wraps the same facts with a summary header and archive footer', async () => {
    const report = await buildReport(makeInput(stamped(COMPLETED_INPUTS), { pr: true }))
    expect(report.startsWith('## Summary')).toBe(true)
    expect(report).toContain('Change `add-thing` — see below for the scrutiny envelope.')
    expect(report).toContain('Archive: post-merge follow-up on master (human-triggered).')
  })
})

/** Git-aware deps: a branch name and two commits on it. */
function withGit(pipeline: ReturnType<typeof makeFakePipeline>): RunDeps {
  const execGit = (_cwd: string, args: readonly string[]): Promise<{ stdout: string; stderr: string }> => {
    if (args[0] === 'branch') return Promise.resolve({ stdout: 'feat/add-thing\n', stderr: '' })
    if (args[0] === 'log') return Promise.resolve({ stdout: 'abc1234 feat: the change\n', stderr: '' })
    return Promise.resolve({ stdout: '', stderr: '' })
  }
  return { ...pipeline.deps, execGit }
}

describe('report command (CLI)', () => {
  it('prints the report of a completed run without writing run state', async () => {
    const pipeline = makeFakePipeline()
    const started = await startRun(pipeline.deps, { taskText: TASK_TEXT })
    const memoPath = path.join(pipeline.runDirOf(started.runId), 'state.json')
    const before = fs.readFileSync(memoPath, 'utf8')
    const summary = await runReportCommand(withGit(pipeline), [started.runId])
    expect(summary).toContain('### Depth')
    expect(summary).toContain('### Gains')
    expect(summary).toContain('### Commits on')
    expect(summary).toContain(`run: ${started.runId}`)
    expect(fs.readFileSync(memoPath, 'utf8')).toBe(before)
  })

  it('--pr prints the PR-body variant', async () => {
    const pipeline = makeFakePipeline()
    const started = await startRun(pipeline.deps, { taskText: TASK_TEXT })
    const summary = await runReportCommand(withGit(pipeline), [started.runId, '--pr'])
    expect(summary.startsWith('## Summary')).toBe(true)
    expect(summary).toContain('Archive: post-merge follow-up on master (human-triggered).')
  })
})
