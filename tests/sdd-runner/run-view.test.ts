// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { render } from 'ink-testing-library'
import { createElement } from 'react'

import type { EventInput, SddEvent } from '../../sdd-runner/src/events.js'
import { stampEvent } from '../../sdd-runner/src/events.js'
import { createRunView, emptyRunFold, foldRunView } from '../../sdd-runner/src/run-view.js'

function stamped(seq: number, event: EventInput): SddEvent {
  return stampEvent(event, seq, '2026-01-01T00:00:00.000Z')
}

describe('foldRunView', () => {
  it('folds slots, findings, and replay state in one pass', () => {
    let bag = emptyRunFold()
    bag = foldRunView(
      bag,
      stamped(1, { altitude: 'L1', type: 'spawned', agent: 'reviewer-r1', role: 'reviewer', model: 'glm' }),
    )
    bag = foldRunView(
      bag,
      stamped(2, { altitude: 'L0', type: 'tool_use', agent: 'reviewer-r1', tool: 'search', arg: 'scope' }),
    )
    bag = foldRunView(
      bag,
      stamped(3, { altitude: 'L2', type: 'finding', action: 'filed', id: 'F1', round: 1, class: 'MATERIAL' }),
    )
    expect(bag.slots[0]).toMatchObject({ agent: 'reviewer-r1', label: 'search scope' })
    expect(bag.findings).toHaveLength(1)
    expect(bag.state.stages).toBeDefined()
  })
})

describe('createRunView rendering', () => {
  it('renders the pipeline map, agent slot with tool call, burndown row, status line, stop affordance', () => {
    let bag = emptyRunFold()
    const events: readonly SddEvent[] = [
      stamped(1, { altitude: 'L2', type: 'stage_enter', stage: 'review' }),
      stamped(2, { altitude: 'L2', type: 'round_open', round: 2, cap: 3 }),
      stamped(3, { altitude: 'L1', type: 'spawned', agent: 'resolver-r2', role: 'resolver', model: 'glm' }),
      stamped(4, { altitude: 'L0', type: 'tool_use', agent: 'resolver-r2', tool: 'edit', arg: 'tasks.md' }),
      stamped(5, { altitude: 'L2', type: 'finding', action: 'filed', id: 'F2', round: 1, class: 'BLOCKER' }),
      stamped(6, {
        altitude: 'L2',
        type: 'convergence',
        round: 1,
        verdict: 'open',
        counts: { blocker: 1, material: 0, nitpick: 0 },
      }),
    ]
    for (const event of events) {
      bag = foldRunView(bag, event)
    }
    const RunView = createRunView()
    const { lastFrame, unmount } = render(
      createElement(RunView, {
        state: bag.state,
        slots: bag.slots,
        findings: bag.findings,
        width: 100,
        startedAt: Date.parse('2026-01-01T00:00:00.000Z'),
        now: Date.parse('2026-01-01T00:01:00.000Z'),
      }),
    )
    const frame = lastFrame()
    expect(frame).toContain('review')
    expect(frame).toContain('resolver-r2')
    expect(frame).toContain('edit tasks.md')
    expect(frame).toContain('round 1:')
    expect(frame).toContain('round 2/3')
    expect(frame).toContain('q to stop')
    unmount()
  })

  it('idle fold renders the idle marker', () => {
    const RunView = createRunView()
    const bag = emptyRunFold()
    const { lastFrame, unmount } = render(
      createElement(RunView, {
        state: bag.state,
        slots: bag.slots,
        findings: bag.findings,
        width: 100,
        startedAt: 0,
        now: 0,
      }),
    )
    expect(lastFrame()).toContain('idle')
    unmount()
  })
})
