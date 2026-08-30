// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { render } from 'ink-testing-library'
import { createElement } from 'react'

import type { EventInput, SddEvent } from '../../sdd-runner/src/events.js'
import { stampEvent } from '../../sdd-runner/src/events.js'
import { emptyRunFold, foldRunView } from '../../sdd-runner/src/run-view.js'
import { createRunView } from '../../sdd-runner/src/run-view.js'

const NOW = Date.parse('2026-01-01T00:05:00.000Z')
const START = Date.parse('2026-01-01T00:00:00.000Z')

function stamped(seq: number, init: EventInput): SddEvent {
  return stampEvent(init, seq, '2026-01-01T00:00:00.000Z')
}

function foldAll(events: readonly SddEvent[]): ReturnType<typeof emptyRunFold> {
  let bag = emptyRunFold()
  for (const event of events) bag = foldRunView(bag, event)
  return bag
}

function frameFor(bag: ReturnType<typeof emptyRunFold>, width = 100): string {
  const RunView = createRunView()
  const { lastFrame, unmount } = render(
    createElement(RunView, {
      state: bag.state,
      slots: bag.slots,
      findings: bag.findings,
      history: bag.history,
      width,
      startedAt: START,
      now: NOW,
    }),
  )
  const frame = lastFrame() ?? ''
  unmount()
  return frame
}

const RUNNING_ROUND: readonly SddEvent[] = [
  stamped(1, { altitude: 'L2', type: 'stage_enter', stage: 'intake' }),
  stamped(2, { altitude: 'L2', type: 'depth', profile: 'M', rationale: 'x', source: 'estimator' }),
  stamped(3, { altitude: 'L2', type: 'stage_exit', stage: 'intake' }),
  stamped(4, { altitude: 'L2', type: 'stage_enter', stage: 'draft' }),
  stamped(5, { altitude: 'L2', type: 'stage_exit', stage: 'draft' }),
  stamped(6, { altitude: 'L2', type: 'stage_enter', stage: 'review' }),
  stamped(7, { altitude: 'L2', type: 'round_open', round: 2, cap: 3 }),
  stamped(8, { altitude: 'L1', type: 'spawned', agent: 'reviewer-r2', role: 'reviewer', model: 'glm' }),
  stamped(9, { altitude: 'L0', type: 'tool_use', agent: 'reviewer-r2', tool: 'readFile', arg: 'spec.md' }),
  stamped(10, { altitude: 'L1', type: 'spawned', agent: 'skeptic-r2', role: 'skeptic', model: 'glm' }),
  stamped(11, { altitude: 'L0', type: 'tool_use', agent: 'skeptic-r2', tool: 'grep', arg: 'migrate' }),
  stamped(12, {
    altitude: 'L2',
    type: 'convergence',
    round: 1,
    verdict: 'open',
    counts: { blocker: 2, material: 3, nitpick: 1 },
  }),
  stamped(13, {
    altitude: 'L2',
    type: 'convergence',
    round: 2,
    verdict: 'open',
    counts: { blocker: 1, material: 1, nitpick: 0 },
  }),
]

describe('TUI running screen (4.2/4.3)', () => {
  it('shows the pipeline map with per-stage status', () => {
    const frame = frameFor(foldAll(RUNNING_ROUND))
    expect(frame).toContain('review')
    expect(frame).toContain('intake done')
    expect(frame).toContain('decompose pending')
  })

  it('shows one line per active agent carrying its current tool call', () => {
    const frame = frameFor(foldAll(RUNNING_ROUND))
    expect(frame).toContain('reviewer-r2')
    expect(frame).toContain('readFile spec.md')
    expect(frame).toContain('skeptic-r2')
    expect(frame).toContain('grep migrate')
  })

  it('shows a burndown row per completed round with per-severity counts', () => {
    const frame = frameFor(foldAll(RUNNING_ROUND))
    expect(frame).toContain('round 1: 2b 3m 1n')
    expect(frame).toContain('round 2: 1b 1m 0n')
  })

  it('status line carries round/cap, token totals, cost marker, elapsed', () => {
    const events = [
      ...RUNNING_ROUND,
      stamped(14, {
        altitude: 'L1',
        type: 'done',
        agent: 'reviewer-r2',
        model: 'glm',
        usage: {
          inputTokens: 5000,
          outputTokens: 1200,
          reasoningTokens: 0,
          cachedReadTokens: 0,
          cachedWriteTokens: 0,
          costUsd: 0.0123,
          wallMs: 10_000,
        },
      }),
    ]
    const frame = frameFor(foldAll(events))
    expect(frame).toContain('round 2/3')
    expect(frame).toContain('in 5.0k')
    expect(frame).toContain('out 1.2k')
    expect(frame).toContain('$0.01')
    expect(frame).toContain('5m')
  })

  it('shows the stop affordance with its calm-stop meaning', () => {
    const frame = frameFor(foldAll(RUNNING_ROUND))
    expect(frame).toContain('q to stop')
  })

  it('a done slot renders its token usage and cost; a retrying slot its badge', () => {
    const events = [
      stamped(1, { altitude: 'L1', type: 'spawned', agent: 'resolver-r1', role: 'resolver', model: 'glm' }),
      stamped(2, { altitude: 'L1', type: 'retrying', agent: 'resolver-r1', reason: 'stall', attempt: 2 }),
      stamped(3, { altitude: 'L1', type: 'spawned', agent: 'reviewer-r1', role: 'reviewer', model: 'glm' }),
      stamped(4, {
        altitude: 'L1',
        type: 'done',
        agent: 'reviewer-r1',
        model: 'glm',
        usage: {
          inputTokens: 8000,
          outputTokens: 2000,
          reasoningTokens: 0,
          cachedReadTokens: 0,
          cachedWriteTokens: 0,
          costUsd: 0.05,
          wallMs: 30_000,
        },
      }),
    ]
    const frame = frameFor(foldAll(events))
    expect(frame).toContain('[retry 2]')
    expect(frame).toContain('in 8.0k out 2.0k')
    expect(frame).toContain('$0.0500')
  })

  it('done agents leave the live panel and live once in the history region (7.4)', () => {
    const events = [
      stamped(1, { altitude: 'L1', type: 'spawned', agent: 'resolver-r1', role: 'resolver', model: 'glm' }),
      stamped(2, { altitude: 'L1', type: 'spawned', agent: 'fixer-r1', role: 'fixer', model: 'glm' }),
      stamped(3, {
        altitude: 'L1',
        type: 'done',
        agent: 'resolver-r1',
        model: 'glm',
        usage: {
          inputTokens: 8000,
          outputTokens: 2000,
          reasoningTokens: 0,
          cachedReadTokens: 0,
          cachedWriteTokens: 0,
          costUsd: 0.05,
          wallMs: 30_000,
        },
      }),
    ]
    const frame = frameFor(foldAll(events))
    expect(frame).toContain('resolver-r1 done')
    expect(frame).toContain('fixer-r1')
    const lines = frame.split('\n')
    const agentsPanel = lines.slice(lines.findIndex((line) => line.includes('╭─ Agents')))
    expect(agentsPanel.some((line) => line.includes('resolver-r1 done'))).toBe(false)
    const historyRow = lines.find((line) => line.includes('resolver-r1 done'))
    expect(historyRow).toContain('│')
  })
})
