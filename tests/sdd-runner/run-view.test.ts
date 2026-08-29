// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import assert from 'node:assert'

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
        history: bag.history,
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
        history: bag.history,
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

function firstHistoryLineOf(line: string | undefined): string {
  return line ?? ''
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

  it('history rows render as framed body lines beside the live panels (7.4 split)', () => {
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
        history: bag.history,
        width: 100,
        startedAt: 0,
        now: 0,
      }),
    )
    const frame = frameText(lastFrame())
    expect(frame).toContain('│ BLOCKER  F1 r1')
    expect(frame).toContain('│ round 1: 1b 0m 0n')
    expect(frame).toContain('╭─ Pipeline')
    expect(frame).toContain('╭─ Agents')
    frame.split('\n').forEach((line) => expect(displayWidth(line)).toBeLessThanOrEqual(100))
    unmount()
  })

  it('narrow width truncates history and live rows instead of overflowing', () => {
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
        history: bag.history,
        width: 48,
        startedAt: 0,
        now: 0,
      }),
    )
    const frame = frameText(lastFrame())
    expect(frame).toContain('NITPICK')
    expect(frame).toContain('round 1:')
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
        history: bag.history,
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
        history: bag.history,
        width: 100,
        startedAt: Date.parse('2026-01-01T00:00:00.000Z'),
        now: Date.parse('2026-01-01T00:01:00.000Z'),
      }),
    )
    const frame = frameText(lastFrame())
    expect(frame).toContain('$0.0500')
    expect(frame).toContain('\u001b[36m$0.0500')
    expect(frame).toContain('\u001b[36m$0.05')
    expect(frame).toContain('\u001b[36m $0.05')
    unmount()
  })

  it('zero total cost renders no cost segment on the status line', () => {
    let bag = emptyRunFold()
    bag = foldRunView(bag, stamped(1, { altitude: 'L2', type: 'stage_enter', stage: 'review' }))
    bag = foldRunView(
      bag,
      stamped(2, { altitude: 'L1', type: 'spawned', agent: 'reviewer-r1', role: 'reviewer', model: 'glm' }),
    )
    bag = foldRunView(bag, stamped(3, usage(0)))
    const RunView = createRunView()
    const { lastFrame, unmount } = render(
      createElement(RunView, {
        state: bag.state,
        slots: bag.slots,
        findings: bag.findings,
        history: bag.history,
        width: 100,
        startedAt: 0,
        now: 0,
      }),
    )
    const frame = frameText(lastFrame())
    const statusLine = frame.split('\n').find((line) => line.includes('q to stop'))
    assert(statusLine !== undefined)
    expect(statusLine.includes('$')).toBe(false)
    expect(frame).toContain('$0.0000')
    unmount()
  })

  it('narrow stacked pipeline lines carry the stage token for their icon', () => {
    let bag = emptyRunFold()
    bag = foldRunView(
      bag,
      stamped(1, { altitude: 'L2', type: 'depth', profile: 'S', rationale: 'single-file bugfix', source: 'override' }),
    )
    bag = foldRunView(bag, stamped(2, { altitude: 'L2', type: 'stage_enter', stage: 'intake' }))
    bag = foldRunView(bag, stamped(3, { altitude: 'L2', type: 'stage_enter', stage: 'draft' }))
    const RunView = createRunView()
    const { lastFrame, unmount } = render(
      createElement(RunView, {
        state: bag.state,
        slots: bag.slots,
        findings: bag.findings,
        history: bag.history,
        width: 48,
        startedAt: 0,
        now: 0,
      }),
    )
    const lines = frameText(lastFrame()).split('\n')
    const lineOf = (needle: string): string => {
      const hit = lines.find((line) => line.includes(needle))
      assert(hit !== undefined)
      return hit
    }
    const done = lineOf('\u2713 intake done')
    expect(done.includes('\u001b[32m')).toBe(true)
    expect(done.includes('\u001b[1m')).toBe(false)
    const active = lineOf('\u25b6 draft active')
    expect(active.includes('\u001b[1m\u001b[32m')).toBe(true)
    const skipped = lineOf('\u2014 atomicity skipped')
    expect(skipped.includes('\u001b[90m')).toBe(true)
    const pending = lineOf('\u00b7 review pending')
    expect(pending.includes('\u001b[2m')).toBe(true)
    expect(pending.includes('\u001b[32m')).toBe(false)
    unmount()
  })

  it('the retry badge rides only retrying slots', () => {
    let bag = emptyRunFold()
    bag = foldRunView(bag, stamped(1, { altitude: 'L2', type: 'stage_enter', stage: 'review' }))
    bag = foldRunView(
      bag,
      stamped(2, { altitude: 'L1', type: 'spawned', agent: 'resolver-r1', role: 'resolver', model: 'glm' }),
    )
    const RunView = createRunView()
    const props = {
      state: bag.state,
      slots: bag.slots,
      findings: bag.findings,
      history: bag.history,
      width: 100,
      startedAt: 0,
      now: 0,
    }
    const first = render(createElement(RunView, props))
    expect(frameText(first.lastFrame()).includes('[retry')).toBe(false)
    first.unmount()
    bag = foldRunView(
      bag,
      stamped(3, { altitude: 'L1', type: 'retrying', agent: 'resolver-r1', reason: 'stall', attempt: 2 }),
    )
    const second = render(
      createElement(RunView, {
        state: bag.state,
        slots: bag.slots,
        findings: bag.findings,
        history: bag.history,
        width: 100,
        startedAt: 0,
        now: 0,
      }),
    )
    const frame = frameText(second.lastFrame())
    expect(frame).toContain('[retry 2]')
    expect(frame).toContain('\u001b[1m\u001b[35m')
    second.unmount()
  })

  it('later events never mutate or reorder emitted history rows (7.4)', () => {
    let bag = emptyRunFold()
    bag = foldRunView(
      bag,
      stamped(1, { altitude: 'L2', type: 'finding', action: 'filed', id: 'F1', round: 1, class: 'BLOCKER' }),
    )
    const RunView = createRunView()
    const { lastFrame, rerender, unmount } = render(
      createElement(RunView, {
        state: bag.state,
        slots: bag.slots,
        findings: bag.findings,
        history: bag.history,
        width: 100,
        startedAt: 0,
        now: 0,
      }),
    )
    const firstHistoryLine = frameText(lastFrame())
      .split('\n')
      .find((line) => line.includes('BLOCKER'))
    expect(firstHistoryLine).toBeDefined()
    bag = foldRunView(
      bag,
      stamped(2, { altitude: 'L2', type: 'finding', action: 'filed', id: 'F2', round: 1, class: 'NITPICK' }),
    )
    bag = foldRunView(
      bag,
      stamped(3, {
        altitude: 'L2',
        type: 'convergence',
        round: 1,
        verdict: 'open',
        counts: { blocker: 1, material: 0, nitpick: 1 },
      }),
    )
    rerender(
      createElement(RunView, {
        state: bag.state,
        slots: bag.slots,
        findings: bag.findings,
        history: bag.history,
        width: 100,
        startedAt: 0,
        now: 0,
      }),
    )
    const grown = frameText(lastFrame())
    const f1Index = grown.indexOf('F1 r1')
    const f2Index = grown.indexOf('F2 r1')
    expect(f1Index).toBeGreaterThanOrEqual(0)
    expect(f2Index).toBeGreaterThan(f1Index)
    expect(grown).toContain(firstHistoryLineOf(firstHistoryLine))
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
        history: bag.history,
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

describe('run-view children block (D8)', () => {
  function renderFold(events: readonly EventInput[]): string | undefined {
    let bag = emptyRunFold()
    for (const [index, event] of events.entries()) {
      bag = foldRunView(bag, stamped(index + 1, event))
    }
    const RunView = createRunView()
    const { lastFrame, unmount } = render(
      createElement(RunView, {
        state: bag.state,
        slots: bag.slots,
        findings: bag.findings,
        history: bag.history,
        width: 100,
        startedAt: 0,
        now: 0,
      }),
    )
    const frame = lastFrame()
    unmount()
    return frame
  }

  it('renders one <child-id> <status> line per fold entry, the active node marked', () => {
    const frame = renderFold([
      { altitude: 'L2', type: 'plan', childCount: 2, digest: 'd'.repeat(16) },
      { altitude: 'L2', type: 'child_spawned', child: 'auth-db', runId: 'auth-db-2' },
      { altitude: 'L2', type: 'child_done', child: 'auth-db', outcome: 'done' },
      { altitude: 'L2', type: 'child_spawned', child: 'auth-api', runId: 'auth-api-2' },
    ])
    assert(frame !== undefined)
    expect(frame).toContain('╭─ Children ')
    expect(frame).toContain('auth-db done')
    expect(frame).toContain('auth-api running')
    const childrenLines = frame.split('\n').filter((line) => line.includes('auth-'))
    expect(childrenLines).toHaveLength(2)
    const activeLine = childrenLines.find((line) => line.includes('auth-api'))
    assert(activeLine !== undefined)
    expect(activeLine.includes('▶')).toBe(true)
    const doneLine = childrenLines.find((line) => line.includes('auth-db'))
    assert(doneLine !== undefined)
    expect(doneLine.includes('▶')).toBe(false)
  })

  it('marks a failed in-flight child as the active node too — the first non-done entry', () => {
    const frame = renderFold([
      { altitude: 'L2', type: 'plan', childCount: 1, digest: 'd'.repeat(16) },
      { altitude: 'L2', type: 'child_spawned', child: 'auth-db', runId: 'auth-db-2' },
      { altitude: 'L2', type: 'child_done', child: 'auth-db', outcome: 'failed' },
    ])
    assert(frame !== undefined)
    const failedLine = frame.split('\n').find((line) => line.includes('auth-db failed'))
    assert(failedLine !== undefined)
    expect(failedLine.includes('▶')).toBe(true)
  })

  it('omits the section entirely when the fold is empty — single-run screens unchanged', () => {
    const frame = renderFold([
      { altitude: 'L2', type: 'stage_enter', stage: 'review' },
      { altitude: 'L2', type: 'round_open', round: 1, cap: 2 },
    ])
    assert(frame !== undefined)
    expect(frame).not.toContain('Children')
  })
})
