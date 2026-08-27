// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'

import { readEvents } from '../../../afk-runner/src/events.js'
import type { SddEvent } from '../../../afk-runner/src/events.js'
import { resumeRun, startRun } from '../../../afk-runner/src/run.js'
import { BLOCKER_ROUND, M_MULTI_ROUND, TASK_TEXT, makeFakePipeline } from '../fixtures/fake-pipeline.js'

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

type Token = string

function skeletonTokens(logPath: string): Token[] {
  return readEvents(logPath).flatMap((event: SddEvent): Token[] => {
    if (event.type === 'stage_enter' || event.type === 'stage_exit') return [`${event.type}:${event.stage}`]
    if (event.type === 'round_open' || event.type === 'round_close') return [`${event.type}:${event.round}`]
    if (event.type === 'convergence') return [`convergence:${event.round}:${event.verdict}`]
    if (event.type === 'gate') return [`gate:${event.action}:${event.mode}`]
    if (event.type === 'artifact') return ['artifact']
    if (event.type === 'depth') return ['depth']
    if (event.type === 'finding') return [`finding:${event.action}:${event.id}`]
    return []
  })
}

describe('live-shaped think-half integration (stubbed agents)', () => {
  it('start → intake → draft → review → park awaiting-tail after convergence', async () => {
    const pipeline = makeFakePipeline()
    const result = await startRun(pipeline.deps, { taskText: TASK_TEXT })
    expect(result.halted).toBe('awaiting-tail')
    const tokens = skeletonTokens(path.join(pipeline.runDirOf(result.runId), 'events.ndjson'))
    expect(tokens).toEqual([
      'stage_enter:intake',
      'depth',
      'stage_exit:intake',
      'stage_enter:draft',
      'artifact',
      'artifact',
      'stage_exit:draft',
      'stage_enter:review',
      'round_open:1',
      'convergence:1:converged',
      'artifact',
      'artifact',
      'round_close:1',
      'stage_exit:review',
    ])
  })

  it('cap-hit with open blockers appends gate presented and parks gate-pending', async () => {
    const pipeline = makeFakePipeline({ sidecarOverrides: BLOCKER_ROUND })
    const result = await startRun(pipeline.deps, { taskText: TASK_TEXT })
    expect(result.halted).toBe('gate-pending')
    const tokens = skeletonTokens(path.join(pipeline.runDirOf(result.runId), 'events.ndjson'))
    expect(tokens).toContain('finding:classified:F1')
    expect(tokens).toContain('finding:resolved:F1')
    expect(tokens).toContain('convergence:1:open')
    expect(tokens.indexOf('gate:presented:early')).toBeGreaterThan(tokens.indexOf('round_close:1'))
    expect(tokens.filter((token) => token.startsWith('stage_enter:'))).toEqual([
      'stage_enter:intake',
      'stage_enter:draft',
      'stage_enter:review',
    ])
  })

  it('kill between rounds: resume re-enters review through the corpus-real self-loop', async () => {
    const crashed = makeFakePipeline({ sidecarOverrides: M_MULTI_ROUND, crashOn: killOnceOn('findings-2.json') })
    await expect(startRun(crashed.deps, { taskText: TASK_TEXT })).rejects.toThrow('simulated kill')
    const runId = firstRunOf(crashed)
    const logPath = path.join(crashed.runDirOf(runId), 'events.ndjson')
    const truncated = skeletonTokens(logPath)
    expect(truncated).toContain('round_open:2')
    expect(truncated).not.toContain('convergence:2:converged')

    // the process died; the holder is gone and the memo is stale garbage
    fs.rmSync(path.join(crashed.runDirOf(runId), 'state.json'))

    const resumed = await resumeRun(crashed.deps, runId)
    expect(resumed.halted).toBe('awaiting-tail')
    expect(resumed.drove).toBe(true)

    const tokens = skeletonTokens(logPath)
    const reviewEnters = tokens.filter((token) => token === 'stage_enter:review')
    expect(reviewEnters).toHaveLength(2)
    const firstEnter = tokens.indexOf('stage_enter:review')
    const secondEnter = tokens.indexOf('stage_enter:review', firstEnter + 1)
    expect(tokens.slice(firstEnter, secondEnter)).toEqual([
      'stage_enter:review',
      'round_open:1',
      'finding:classified:F1',
      'finding:resolved:F1',
      'convergence:1:open',
      'artifact',
      'artifact',
      'round_close:1',
      'round_open:2',
    ])
    expect(tokens.slice(secondEnter)).toEqual([
      'stage_enter:review',
      'round_open:2',
      'convergence:2:converged',
      'artifact',
      'artifact',
      'round_close:2',
      'stage_exit:review',
    ])
  })
})
