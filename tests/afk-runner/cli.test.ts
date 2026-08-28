// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'

import {
  runCli,
  runResumeCommand,
  runStartCommand,
  runStatusCommand,
  fullStateSummary,
} from '../../afk-runner/src/cli.js'
import { readEvents } from '../../afk-runner/src/events.js'
import { BLOCKER_ROUND, TASK_TEXT, makeFakePipeline } from './fixtures/fake-pipeline.js'

/** The run id from a start-command summary's first line. */
function runIdOf(summary: string): string {
  const first = summary.split('\n')[0]
  return first === undefined ? '' : first.replace('run: ', '')
}

/** Truncate the log to everything up to and including the first event of a type (crash simulation). */
function truncateAfterFirst(logPath: string, type: string): void {
  const events = readEvents(logPath)
  const cut = events.findIndex((event) => event.type === type)
  const keep = cut === -1 ? events.length - 1 : cut
  const truncated = events.filter((_event, index) => index <= keep)
  fs.writeFileSync(logPath, truncated.map((event) => JSON.stringify(event)).join('\n') + '\n')
}

/** How many times review was entered in the log. */
function reviewEnterCount(logPath: string): number {
  return readEvents(logPath).filter((event) => event.type === 'stage_enter' && event.stage === 'review').length
}

/** The first run id under a fake pipeline's work dir. */
function firstRunOf(pipeline: ReturnType<typeof makeFakePipeline>): string {
  const entries = fs.readdirSync(path.join(pipeline.workDir, 'runs'))
  return entries[0] ?? ''
}

const FIXTURE_RUN = path.join(import.meta.dir, 'fixtures', 'real', '2026-08-21T19-44-19-770Z-2f6e644a')

describe('afk-runner cli', () => {
  it('prints a folded state summary with mapped/tolerated accounting for a run dir', () => {
    const summary = runCli([FIXTURE_RUN])
    expect(summary).toContain('value: completed')
    expect(summary).toContain('intake: done')
    expect(summary).toContain('gate: done')
    expect(summary).toContain('events: 886 (mapped 68, tolerated 818)')
  })

  it('exits with a usage error when no run dir is given', () => {
    expect(() => runCli([])).toThrow('usage: afk-runner <runDir>')
  })

  it('exits with a clear error for a run dir without events.ndjson', () => {
    expect(() => runCli([import.meta.dir])).toThrow('events.ndjson not found')
  })
})

describe('afk-runner cli commands (fake agents)', () => {
  it('start drives a fresh think-half run to park and prints the halt', async () => {
    const pipeline = makeFakePipeline()
    const taskFile = path.join(pipeline.repoRoot, 'task.md')
    fs.writeFileSync(taskFile, TASK_TEXT)
    const summary = await runStartCommand(pipeline.deps, [taskFile])
    expect(summary).toContain('halted: final')
    const runId = runIdOf(summary)
    expect(fs.existsSync(path.join(pipeline.runDirOf(runId), 'events.ndjson'))).toBe(true)
  })

  it('status prints the folded full-state summary', async () => {
    const pipeline = makeFakePipeline()
    const taskFile = path.join(pipeline.repoRoot, 'task.md')
    fs.writeFileSync(taskFile, TASK_TEXT)
    const started = await runStartCommand(pipeline.deps, [taskFile])
    const runId = runIdOf(started)
    const summary = await runStatusCommand(pipeline.deps, runId)
    expect(summary).toContain('value: completed')
    expect(summary).toContain('depth: S')
    expect(summary).toContain('round: 1/1')
    expect(summary).toContain('last verdict: converged')
    expect(summary).toContain('gate: final v1 answered')
    expect(summary).toContain('halted: final')
  })

  it('fullStateSummary renders the gate-pending flavor from folded context', async () => {
    const pipeline = makeFakePipeline({ sidecarOverrides: BLOCKER_ROUND })
    const taskFile = path.join(pipeline.repoRoot, 'task.md')
    fs.writeFileSync(taskFile, TASK_TEXT)
    await runStartCommand(pipeline.deps, [taskFile])
    const runId = firstRunOf(pipeline)
    const { statusRun } = await import('../../afk-runner/src/run.js')
    const status = await statusRun(pipeline.deps, runId)
    const lines = fullStateSummary(status)
    expect(lines).toContain('gate: early v1 awaiting')
    expect(lines).toContain('halted: gate-pending')
  })

  it('resume re-enters an interrupted think-half run through the review self-loop', async () => {
    const pipeline = makeFakePipeline()
    const taskFile = path.join(pipeline.repoRoot, 'task.md')
    fs.writeFileSync(taskFile, TASK_TEXT)
    await runStartCommand(pipeline.deps, [taskFile])
    const runId = firstRunOf(pipeline)
    const logPath = path.join(pipeline.runDirOf(runId), 'events.ndjson')

    // simulate a crash mid-review: drop everything after round_open(1)
    truncateAfterFirst(logPath, 'round_open')
    fs.rmSync(path.join(pipeline.runDirOf(runId), 'state.json'))

    const summary = await runResumeCommand(pipeline.deps, runId)
    expect(summary).toContain('halted: final')
    expect(summary).toContain('resumed: re-entered work')

    expect(reviewEnterCount(logPath)).toBe(2)
  })
})
