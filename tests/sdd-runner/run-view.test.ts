// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import './color-frames.js'
import { render } from 'ink-testing-library'
import { createElement } from 'react'

import type { EventInput, SddEvent } from '../../sdd-runner/src/events.js'
import { stampEvent } from '../../sdd-runner/src/events.js'
import { createRunView, emptyRunFold, foldRunView } from '../../sdd-runner/src/run-view.js'
import { displayWidth } from '../../sdd-runner/src/tui-panels.js'

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

function frameText(frame: string | undefined): string {
  return frame ?? ''
}

function historyTitleLines(frame: string): readonly string[] {
  return frame.split('\n').filter((line) => line.includes('╭─ Findings') || line.includes('╭─ Burndown'))
}

describe('running screen presentation (6.2)', () => {
  function usage(costUsd: number): EventInput {
    return {
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
        costUsd,
        wallMs: 30_000,
      },
    }
  }

  it('frames panels with findings beside burndown at wide width', () => {
    let bag = emptyRunFold()
    bag = foldRunView(bag, stamped(1, { altitude: 'L2', type: 'stage_enter', stage: 'review' }))
    bag = foldRunView(
      bag,
      stamped(2, { altitude: 'L2', type: 'finding', action: 'filed', id: 'F1', round: 1, class: 'BLOCKER' }),
    )
    bag = foldRunView(
      bag,
      stamped(3, {
        altitude: 'L2',
        type: 'convergence',
        round: 1,
        verdict: 'open',
        counts: { blocker: 1, material: 0, nitpick: 0 },
      }),
    )
    const RunView = createRunView()
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
    const frame = frameText(lastFrame())
    expect(frame).toContain('╭─ Findings')
    expect(frame).toContain('╭─ Burndown')
    expect(frame).toContain('╮╭─ Burndown')
    frame.split('\n').forEach((line) => expect(displayWidth(line)).toBeLessThanOrEqual(100))
    unmount()
  })

  it('narrow width stacks findings above burndown and stays inside the width', () => {
    let bag = emptyRunFold()
    bag = foldRunView(bag, stamped(1, { altitude: 'L2', type: 'stage_enter', stage: 'review' }))
    bag = foldRunView(
      bag,
      stamped(2, { altitude: 'L2', type: 'finding', action: 'filed', id: 'F1', round: 1, class: 'NITPICK' }),
    )
    bag = foldRunView(
      bag,
      stamped(3, {
        altitude: 'L2',
        type: 'convergence',
        round: 1,
        verdict: 'open',
        counts: { blocker: 0, material: 2, nitpick: 1 },
      }),
    )
    const RunView = createRunView()
    const { lastFrame, unmount } = render(
      createElement(RunView, {
        state: bag.state,
        slots: bag.slots,
        findings: bag.findings,
        width: 48,
        startedAt: 0,
        now: 0,
      }),
    )
    const frame = frameText(lastFrame())
    expect(frame).not.toContain('╮╭─ Burndown')
    const titles = historyTitleLines(frame)
    expect(titles.length).toBe(2)
    expect(titles[0]).toContain('Findings')
    expect(titles[1]).toContain('Burndown')
    frame.split('\n').forEach((line) => expect(displayWidth(line)).toBeLessThanOrEqual(48))
    unmount()
  })

  it('severity tokens color findings by class and retry badges mark retrying slots', () => {
    let bag = emptyRunFold()
    bag = foldRunView(bag, stamped(1, { altitude: 'L2', type: 'stage_enter', stage: 'review' }))
    bag = foldRunView(
      bag,
      stamped(2, { altitude: 'L2', type: 'finding', action: 'filed', id: 'F1', round: 1, class: 'BLOCKER' }),
    )
    bag = foldRunView(
      bag,
      stamped(3, { altitude: 'L2', type: 'finding', action: 'filed', id: 'F2', round: 1, class: 'NITPICK' }),
    )
    bag = foldRunView(
      bag,
      stamped(4, { altitude: 'L1', type: 'spawned', agent: 'resolver-r1', role: 'resolver', model: 'glm' }),
    )
    bag = foldRunView(
      bag,
      stamped(5, { altitude: 'L1', type: 'retrying', agent: 'resolver-r1', reason: 'stall', attempt: 2 }),
    )
    const RunView = createRunView()
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
    const frame = frameText(lastFrame())
    expect(frame).toContain('BLOCKER')
    expect(frame).toContain('F1 r1')
    expect(frame).toContain('NITPICK')
    expect(frame).toContain('F2 r1')
    expect(frame).toContain('[retry 2]')
    expect(frame).toContain('\u001b[1m\u001b[31m')
    expect(frame).toContain('\u001b[2m')
    expect(frame).toContain('\u001b[1m\u001b[35m')
    unmount()
  })

  it('a done slot and the status line carry the known-cost token', () => {
    let bag = emptyRunFold()
    bag = foldRunView(bag, stamped(1, { altitude: 'L2', type: 'stage_enter', stage: 'review' }))
    bag = foldRunView(
      bag,
      stamped(2, { altitude: 'L1', type: 'spawned', agent: 'reviewer-r1', role: 'reviewer', model: 'glm' }),
    )
    bag = foldRunView(bag, stamped(3, usage(0.05)))
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
    const frame = frameText(lastFrame())
    expect(frame).toContain('$0.0500')
    expect(frame).toContain('\u001b[36m$0.0500')
    expect(frame).toContain('\u001b[36m$0.05')
    unmount()
  })

  it('monochrome mode omits every color escape', () => {
    let bag = emptyRunFold()
    bag = foldRunView(bag, stamped(1, { altitude: 'L2', type: 'stage_enter', stage: 'review' }))
    bag = foldRunView(
      bag,
      stamped(2, { altitude: 'L2', type: 'finding', action: 'filed', id: 'F1', round: 1, class: 'BLOCKER' }),
    )
    bag = foldRunView(
      bag,
      stamped(3, { altitude: 'L1', type: 'spawned', agent: 'resolver-r1', role: 'resolver', model: 'glm' }),
    )
    bag = foldRunView(
      bag,
      stamped(4, { altitude: 'L1', type: 'retrying', agent: 'resolver-r1', reason: 'stall', attempt: 2 }),
    )
    const RunView = createRunView()
    const { lastFrame, unmount } = render(
      createElement(RunView, {
        state: bag.state,
        slots: bag.slots,
        findings: bag.findings,
        width: 100,
        startedAt: 0,
        now: 0,
        colorMode: 'monochrome',
      }),
    )
    const frame = frameText(lastFrame())
    expect(frame).toContain('BLOCKER')
    expect(frame).toContain('F1 r1')
    expect(frame).toContain('[retry 2]')
    expect(frame).not.toContain('\u001b[')
    unmount()
  })
})
