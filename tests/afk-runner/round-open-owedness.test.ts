// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'

import { readEvents } from '../../afk-runner/src/events.js'
import type { SddEvent } from '../../afk-runner/src/events.js'
import { resumeRun } from '../../afk-runner/src/run-resume.js'
import { startRun } from '../../afk-runner/src/run.js'
import { roundOpenOwed } from '../../afk-runner/src/work/review-loop.js'
import { M_MULTI_ROUND, TASK_TEXT, makeFakePipeline } from './fixtures/fake-pipeline.js'

function roundOpensOf(events: readonly SddEvent[], round: number): SddEvent[] {
  return events.filter((event) => event.type === 'round_open' && event.round === round)
}

function hasRoundEvent(
  events: readonly SddEvent[],
  type: 'convergence' | 'round_close' | 'finding',
  round: number,
): boolean {
  return events.some((event) => event.type === type && event.round === round)
}

/** A crash predicate that fires exactly once on the given output basename, then lets the resume proceed. */
function killOnceOn(basename: string): (candidate: string) => boolean {
  let fired = false
  return (candidate: string): boolean => {
    if (fired || candidate !== basename) return false
    fired = true
    return true
  }
}

/** The first run id under a fake pipeline's work dir. */
function firstRunOf(pipeline: ReturnType<typeof makeFakePipeline>): string {
  const entries = fs.readdirSync(path.join(pipeline.workDir, 'runs'))
  return entries[0] ?? ''
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

/**
 * Release ticks until the re-presented final gate has parked (two presentations, tail
 * closed) — a fixed tick count races the settle chain's fs reads under load (the CI
 * 4-vCPU serial run wedged the waiter mid-settle and hung to the global timeout).
 */
async function ticksUntilSecondPresentation(
  clock: { readonly release: () => void },
  logPath: string,
  budgetMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    const tokens = typeTokens(readEvents(logPath))
    const presentations = tokens.filter((token) => token === 'gate:presented:').length
    const tailClosed = tokens.at(-1) === 'stage_exit:atomicity' || tokens.at(-1) === 'stage_exit:decompose'
    if (presentations >= 2 && tailClosed) return
    clock.release()
    await new Promise((resolve) => {
      setTimeout(resolve, 2)
    })
  }
}

/**
 * Release ticks (bounded) until the pending run resolves — the settled flag flips in
 * the same microtask batch as the promise (a `Promise.race` against an already-settled
 * marker loses to the marker).
 */
async function settleViaTicks<T>(
  pending: Promise<T>,
  clock: { readonly release: () => void },
  budgetMs = 10_000,
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

function typeTokens(events: readonly SddEvent[]): string[] {
  return events.map((event) =>
    event.type === 'stage_enter' || event.type === 'stage_exit'
      ? `${event.type}:${event.stage}`
      : event.type === 'gate'
        ? `gate:${event.action}:${'outcome' in event ? (event.outcome ?? '') : ''}`
        : `${event.type}:${'round' in event ? event.round : ''}`,
  )
}

/** The M shape whose final gate parks for the human (a high-blast assumption blocks R1). */
function highBlastAssumptionRound(): Record<string, string> {
  return {
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
    'resolutions-1.json': JSON.stringify({
      resolutions: [],
      assumptions: [
        {
          id: 'A1',
          text: 'the rollout stays behind a flag',
          basis: 'code-evidence',
          confidence: 'high',
          blast_radius: 'group replies',
          status: 'open',
          evidence: { files: ['src/a.ts'] },
        },
      ],
    }),
    'findings-2.json': JSON.stringify({ findings: [] }),
    'resolutions-2.json': JSON.stringify({ resolutions: [], assumptions: [] }),
  }
}

describe('round_open owedness — state-shaped no-ops are not re-appended (log-fidelity D1/D2)', () => {
  it('extend-at-final cycle: the mover opens round 2 once — review re-entry adds no second round_open (the seq 605/607 shape)', async () => {
    const pipeline = makeFakePipeline({ sidecarOverrides: highBlastAssumptionRound() })
    const clock = fakeClock()
    const taskFile = path.join(pipeline.repoRoot, 'task.md')
    fs.writeFileSync(taskFile, TASK_TEXT)
    const runPromise = startRun({ ...pipeline.deps, gateWait: { tick: clock.tick } }, { taskFile })

    await waitFor((): boolean => pipeline.stdoutLines.some((line) => line.includes('gate-pending')))
    const runDir = pipeline.runDirOf(firstRunOf(pipeline))
    const logPath = path.join(runDir, 'events.ndjson')

    fs.writeFileSync(path.join(runDir, 'gate-1.md'), '## Gate response\n\n→ RUN 1 MORE\n')
    await ticksUntilSecondPresentation(clock, logPath)

    fs.writeFileSync(path.join(runDir, 'gate-2.md'), '## Gate response\n\nABORT\n')
    const halted = await settleViaTicks(runPromise, clock)

    expect(halted).toMatchObject({ halted: 'final' })
    const events = readEvents(logPath)
    // the mover's round_open(2) is the only one: review's re-entry owes nothing
    expect(roundOpensOf(events, 2)).toHaveLength(1)
    // and it sits in the settle's position: answered → exit → round_open
    const tokens = typeTokens(events)
    const extendAnswer = tokens.indexOf('gate:answered:extend')
    expect(extendAnswer).toBeGreaterThan(-1)
    expect(tokens[extendAnswer + 1]).toBe('stage_exit:gate')
    expect(tokens[extendAnswer + 2]).toBe('round_open:2')
  })

  it('same-round resume: an in-process kill/resume of an open round appends no fresh round_open (the seq 195/202 shape)', async () => {
    const crashed = makeFakePipeline({ sidecarOverrides: M_MULTI_ROUND, crashOn: killOnceOn('findings-2.json') })
    await expect(startRun(crashed.deps, { taskText: TASK_TEXT })).rejects.toThrow('simulated kill')
    const runId = firstRunOf(crashed)
    const logPath = path.join(crashed.runDirOf(runId), 'events.ndjson')
    // round 2 opened in the dying process; its verdict never recorded
    expect(roundOpensOf(readEvents(logPath), 2)).toHaveLength(1)

    fs.rmSync(path.join(crashed.runDirOf(runId), 'state.json'))
    const resumed = await resumeRun(crashed.deps, runId)
    expect(resumed.halted).toBe('final')

    const events = readEvents(logPath)
    expect(roundOpensOf(events, 2)).toHaveLength(1)
  })

  it('under-budget escalation retry: the in-place bracket re-run appends no fresh round_open', async () => {
    const pipeline = makeFakePipeline({
      sidecarSequences: {
        'findings-1.json': [
          JSON.stringify({ findings: [{ id: 'F1' }] }),
          JSON.stringify({ findings: [{ id: 'F1' }] }),
          JSON.stringify({ findings: [] }),
        ],
      },
    })
    const result = await startRun(pipeline.deps, { taskText: TASK_TEXT })
    expect(result.halted).toBe('final')
    const events = readEvents(path.join(pipeline.runDirOf(result.runId), 'events.ndjson'))
    expect(events.filter((event) => event.type === 'stage_failed')).toHaveLength(1)
    expect(roundOpensOf(events, 1)).toHaveLength(1)
  })

  it('the pure predicate: identical round+cap owes nothing; a cap amendment or a different round still does', () => {
    expect(roundOpenOwed({ current: 2, cap: 4 }, 2, 4)).toBe(false)
    expect(roundOpenOwed({ current: 2, cap: 4 }, 2, 5)).toBe(true)
    expect(roundOpenOwed({ current: 2, cap: 4 }, 3, 4)).toBe(true)
    expect(roundOpenOwed(null, 1, 3)).toBe(true)
    expect(roundOpenOwed(undefined, 1, 3)).toBe(true)
  })

  it('a re-run round still records its work: findings, convergence, and round_close are never suppressed', async () => {
    const crashed = makeFakePipeline({ sidecarOverrides: M_MULTI_ROUND, crashOn: killOnceOn('findings-2.json') })
    await expect(startRun(crashed.deps, { taskText: TASK_TEXT })).rejects.toThrow('simulated kill')
    const runId = firstRunOf(crashed)
    fs.rmSync(path.join(crashed.runDirOf(runId), 'state.json'))
    await resumeRun(crashed.deps, runId)

    const events = readEvents(path.join(crashed.runDirOf(runId), 'events.ndjson'))
    expect(hasRoundEvent(events, 'convergence', 2)).toBe(true)
    expect(hasRoundEvent(events, 'round_close', 2)).toBe(true)
    // round 1's work-shaped events ride the pre-crash log untouched
    expect(hasRoundEvent(events, 'finding', 1)).toBe(true)
  })
})
