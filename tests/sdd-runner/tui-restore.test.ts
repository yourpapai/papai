// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { appendEvent } from '../../sdd-runner/src/events.js'
import { emptyRunFold, foldRunView } from '../../sdd-runner/src/run-view.js'
import { restoreRunFold } from '../../sdd-runner/src/tui-restore.js'

let runDir: string
beforeAll(() => {
  runDir = mkdtempSync(path.join(tmpdir(), 'sdd-restore-'))
})
afterAll(() => {
  rmSync(runDir, { recursive: true, force: true })
})

function foldInto(
  logPath: string,
  events: readonly Parameters<typeof appendEvent>[1][],
): ReturnType<typeof emptyRunFold> {
  let bag = emptyRunFold()
  for (const event of events) bag = foldRunView(bag, appendEvent(logPath, event))
  return bag
}

describe('disposable-view restore (4.7)', () => {
  it('re-folds the same view from events.ndjson alone after unmount', () => {
    const logPath = path.join(runDir, 'events.ndjson')
    const original = foldInto(logPath, [
      { altitude: 'L2', type: 'stage_enter', stage: 'intake' },
      { altitude: 'L2', type: 'stage_exit', stage: 'intake' },
      { altitude: 'L2', type: 'stage_enter', stage: 'review' },
      { altitude: 'L2', type: 'round_open', round: 1, cap: 2 },
      { altitude: 'L1', type: 'spawned', agent: 'reviewer-r1', role: 'reviewer', model: 'glm' },
      {
        altitude: 'L1',
        type: 'done',
        agent: 'reviewer-r1',
        model: 'glm',
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          reasoningTokens: 0,
          cachedReadTokens: 0,
          cachedWriteTokens: 0,
          costUsd: 0.01,
          wallMs: 100,
        },
      },
      {
        altitude: 'L2',
        type: 'convergence',
        round: 1,
        verdict: 'open',
        counts: { blocker: 1, material: 1, nitpick: 0 },
      },
    ])
    // the disposable view unmounts; the fold is rebuilt from the log alone
    const restored = restoreRunFold(logPath)
    expect(restored.state).toEqual(original.state)
    expect(restored.slots).toEqual(original.slots)
    expect(restored.findings).toEqual(original.findings)
    expect(restored.state.perRound.length).toBe(1)
  })

  it('restore absorbs events appended after the original fold (live tail)', () => {
    const logPath = path.join(runDir, 'events2.ndjson')
    foldInto(logPath, [{ altitude: 'L2', type: 'stage_enter', stage: 'intake' }])
    const first = restoreRunFold(logPath)
    expect(first.state.stages.draft).toBe('pending')
    appendEvent(logPath, { altitude: 'L2', type: 'stage_enter', stage: 'draft' })
    const second = restoreRunFold(logPath)
    expect(second.state.stages.draft).toBe('active')
  })

  it('a partially-answered gate restores its pending state for the gate screen', () => {
    const logPath = path.join(runDir, 'events3.ndjson')
    appendEvent(logPath, { altitude: 'L2', type: 'gate', action: 'presented', mode: 'early', version: 1 })
    appendEvent(logPath, { altitude: 'L2', type: 'round_open', round: 2, cap: 3 })
    const restored = restoreRunFold(logPath)
    expect(restored.state.gate).toEqual({ mode: 'early', version: 1, answered: false })
    expect(restored.state.round).toEqual({ current: 2, cap: 3 })
  })
})
