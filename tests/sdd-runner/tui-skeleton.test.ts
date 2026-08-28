// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { render } from 'ink-testing-library'
import { createElement } from 'react'

import type { EventInput, SddEvent } from '../../sdd-runner/src/events.js'
import { stampEvent } from '../../sdd-runner/src/events.js'
import { createReplayFolder } from '../../sdd-runner/src/replay.js'
import { createRunView } from '../../sdd-runner/src/run-view.js'
import { foldHistoryRows } from '../../sdd-runner/src/tui-history.js'
import type { HistoryRow } from '../../sdd-runner/src/tui-history.js'
import { foldFindings, foldSlots } from '../../sdd-runner/src/watch-view.js'
import type { SlotState, WatchFinding } from '../../sdd-runner/src/watch-view.js'

function fixtureEvents(): readonly SddEvent[] {
  const now = '2026-01-01T00:00:00.000Z'
  const e = (seq: number, init: EventInput): SddEvent => stampEvent(init, seq, now)
  return [
    e(1, { altitude: 'L2', type: 'stage_enter', stage: 'intake' }),
    e(2, { altitude: 'L2', type: 'depth', profile: 'S', rationale: 'override', source: 'override' }),
    e(3, { altitude: 'L2', type: 'stage_exit', stage: 'intake' }),
    e(4, { altitude: 'L2', type: 'stage_enter', stage: 'draft' }),
    e(5, { altitude: 'L1', type: 'spawned', agent: 'drafter-proposal', role: 'drafter', model: 'glm' }),
    e(6, { altitude: 'L0', type: 'tool_use', agent: 'drafter-proposal', tool: 'readFile', arg: 'proposal.md' }),
    e(7, {
      altitude: 'L1',
      type: 'done',
      agent: 'drafter-proposal',
      model: 'glm',
      usage: {
        inputTokens: 4000,
        outputTokens: 900,
        reasoningTokens: 0,
        cachedReadTokens: 0,
        cachedWriteTokens: 0,
        costUsd: 0.02,
        wallMs: 30_000,
      },
    }),
    e(8, { altitude: 'L2', type: 'stage_exit', stage: 'draft' }),
    e(9, { altitude: 'L2', type: 'stage_enter', stage: 'review' }),
    e(10, { altitude: 'L2', type: 'round_open', round: 1, cap: 2 }),
    e(11, { altitude: 'L1', type: 'spawned', agent: 'reviewer-r1', role: 'reviewer', model: 'glm' }),
    e(12, { altitude: 'L0', type: 'tool_use', agent: 'reviewer-r1', tool: 'search', arg: 'scope' }),
    e(13, { altitude: 'L2', type: 'finding', action: 'filed', id: 'F1', round: 1, class: 'MATERIAL', detail: 'gap x' }),
    e(14, {
      altitude: 'L2',
      type: 'convergence',
      round: 1,
      verdict: 'open',
      counts: { blocker: 0, material: 1, nitpick: 0 },
    }),
    e(15, { altitude: 'L2', type: 'round_close', round: 1, cap: 2 }),
    e(16, { altitude: 'L2', type: 'round_open', round: 2, cap: 2 }),
    e(17, {
      altitude: 'L2',
      type: 'convergence',
      round: 2,
      verdict: 'converged',
      counts: { blocker: 0, material: 0, nitpick: 0 },
    }),
    e(18, { altitude: 'L2', type: 'round_close', round: 2, cap: 2 }),
  ]
}

describe('TUI walking skeleton (4.1): Ink renders a full event sequence in-process', () => {
  it('folds a fixture event stream and renders the run view; unmount is clean', () => {
    const folder = createReplayFolder()
    let slots: readonly SlotState[] = []
    let findings: readonly WatchFinding[] = []
    let history: readonly HistoryRow[] = []
    for (const event of fixtureEvents()) {
      folder.fold(event)
      slots = foldSlots(slots, event)
      findings = foldFindings(findings, event)
      history = foldHistoryRows(history, event, slots)
    }
    const RunView = createRunView()
    const { lastFrame, unmount } = render(
      createElement(RunView, {
        state: folder.state,
        slots,
        findings,
        history,
        width: 100,
        startedAt: Date.parse('2026-01-01T00:00:00.000Z'),
        now: Date.parse('2026-01-01T00:02:00.000Z'),
      }),
    )
    const frame = lastFrame()
    expect(frame).toContain('review')
    expect(frame).toContain('reviewer-r1')
    expect(frame).toContain('search scope')
    expect(frame).toContain('round 2/2')
    expect(frame).toContain('F1')
    expect(() => unmount()).not.toThrow()
  })

  it('the view re-renders on a state update without remounting (event-loop driven)', () => {
    const RunView = createRunView()
    const { lastFrame, rerender, unmount } = render(
      createElement(RunView, {
        state: createReplayFolder().state,
        slots: [],
        findings: [],
        history: [],
        width: 100,
        startedAt: 0,
        now: 0,
      }),
    )
    expect(lastFrame()).toContain('idle')
    const folder = createReplayFolder()
    const spawnEvent = {
      altitude: 'L1',
      type: 'spawned',
      agent: 'estimator',
      role: 'estimator',
      model: 'glm',
      seq: 1,
      ts: '2026-01-01T00:00:00.000Z',
    } as const
    folder.fold(spawnEvent)
    const slots = foldSlots([], spawnEvent)
    rerender(
      createElement(RunView, {
        state: folder.state,
        slots,
        findings: [],
        history: [],
        width: 100,
        startedAt: 0,
        now: 0,
      }),
    )
    expect(lastFrame()).toContain('estimator')
    unmount()
  })
})

describe('foldSlots spawn ordinals through the fixture stream (7.1)', () => {
  it('every folded slot carries its ordinal; a re-spawn of the same label is distinct', () => {
    let slots: readonly SlotState[] = []
    for (const event of fixtureEvents()) slots = foldSlots(slots, event)
    expect(slots.map((slot) => [slot.agent, slot.spawn])).toEqual([
      ['drafter-proposal', 1],
      ['reviewer-r1', 2],
    ])
    const respawned = foldSlots(slots, {
      altitude: 'L1',
      type: 'spawned',
      agent: 'reviewer-r1',
      role: 'reviewer',
      model: 'glm',
    })
    expect(respawned.filter((slot) => slot.agent === 'reviewer-r1').map((slot) => slot.spawn)).toEqual([3])
  })
})
