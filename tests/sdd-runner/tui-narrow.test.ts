// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import './color-frames.js'
import { render } from 'ink-testing-library'
import { createElement } from 'react'

import type { SddEvent } from '../../sdd-runner/src/events.js'
import { stampEvent } from '../../sdd-runner/src/events.js'
import { renderPipelineMap } from '../../sdd-runner/src/renderer.js'
import { createRunView } from '../../sdd-runner/src/run-view.js'
import { emptyRunFold, foldRunView } from '../../sdd-runner/src/run-view.js'
import type { RunFold } from '../../sdd-runner/src/run-view.js'
import type { SessionRow } from '../../sdd-runner/src/session-list.js'
import { createGateScreen } from '../../sdd-runner/src/tui-gate.js'
import { displayWidth } from '../../sdd-runner/src/tui-panels.js'
import { SessionScreen } from '../../sdd-runner/src/tui-session-screen.js'

const NOW = 9_000_000
const START = 0

function frameFor(bag: RunFold, width: number): string {
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
      colorMode: 'monochrome',
    }),
  )
  const frame = lastFrame() ?? ''
  unmount()
  return frame
}

describe('narrow-terminal degradation (4.8)', () => {
  it('wide width joins pipeline stages to one line', () => {
    const line = renderPipelineMap(emptyRunFold().state, { width: 100 })
    expect(line.length).toBe(1)
    expect(line[0]).toContain('intake')
    expect(line[0]).toContain('atomicity')
  })

  it('under 60 cols the pipeline stacks vertically, one stage per line', () => {
    const lines = renderPipelineMap(emptyRunFold().state, { width: 40 })
    expect(lines.length).toBe(6)
    expect(lines.every((line) => line.length <= 40)).toBe(true)
  })

  it('the run view under 60 cols renders no line wider than the terminal', () => {
    const frame = frameFor(emptyRunFold(), 40)
    const widest = Math.max(...frame.split('\n').map((line) => displayWidth(line)))
    expect(widest).toBeLessThanOrEqual(40)
  })

  it('decision consequence lines are never truncated at narrow width', () => {
    const frame = frameFor(emptyRunFold(), 40)
    expect(frame).not.toContain('…')
    expect(frame.split('\n').some((line) => line.includes('(a)pprove'))).toBe(false)
  })
})
const ESC = String.fromCharCode(27)

function frameText(frame: string | undefined): string {
  return frame ?? ''
}

function stripAnsi(frame: string): string {
  return frame.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, 'gu'), '')
}

function richFold(): RunFold {
  const events: readonly SddEvent[] = [
    stampEvent({ altitude: 'L2', type: 'stage_enter', stage: 'review' }, 1, '2026-01-01T00:00:00.000Z'),
    stampEvent(
      { altitude: 'L1', type: 'spawned', agent: 'reviewer-r1', role: 'reviewer', model: 'glm' },
      2,
      '2026-01-01T00:00:00.000Z',
    ),
    stampEvent(
      { altitude: 'L2', type: 'finding', action: 'filed', id: 'F1', round: 1, class: 'BLOCKER' },
      3,
      '2026-01-01T00:00:00.000Z',
    ),
    stampEvent(
      { altitude: 'L1', type: 'retrying', agent: 'reviewer-r1', reason: 'stall', attempt: 2 },
      4,
      '2026-01-01T00:00:00.000Z',
    ),
    stampEvent(
      {
        altitude: 'L2',
        type: 'convergence',
        round: 1,
        verdict: 'open',
        counts: { blocker: 1, material: 2, nitpick: 0 },
      },
      5,
      '2026-01-01T00:00:00.000Z',
    ),
    stampEvent({ altitude: 'L2', type: 'round_open', round: 2, cap: 3 }, 6, '2026-01-01T00:00:00.000Z'),
  ]
  let bag = emptyRunFold()
  for (const event of events) bag = foldRunView(bag, event)
  return bag
}

const GATE_VIEW = {
  gateMode: 'early' as const,
  items: [
    {
      kind: 'assumption' as const,
      id: 'A1',
      text: 'guests stay read-only',
      evidence: 'src/chat/guard.ts:12',
      blastRadius: 'group replies',
    },
    {
      kind: 'finding' as const,
      id: 'F1',
      text: 'proposal never names the scope id',
      evidence: 'proposal.md L5',
      blastRadius: '',
    },
  ],
  blockers: [{ id: 'B1', gap: 'migration untested', evidence: 'drizzle/0007 x.sql' }],
  requiredAck: { id: 'T1', text: 'trajectory is improving' },
}

function sessionRow(): SessionRow {
  return {
    runId: 'fix-flaky-auth-test',
    changeName: 'fix-flaky-auth-test',
    status: 'running',
    stage: 'review',
    depth: 'M',
    round: 2,
    roundCap: 3,
    tokensIn: 84_000,
    tokensOut: 12_000,
    costUsd: 0.31,
    costKnown: true,
    updatedAt: '2026-01-03T11:48:00.000Z',
    pendingDecision: null,
  }
}

describe('NO_COLOR structural equality (8.2)', () => {
  it('the colored frame equals the monochrome frame line-for-line once ANSI is stripped, across every screen shape', () => {
    const bag = richFold()
    const GateScreen = createGateScreen()
    const runColored = render(
      createElement(createRunView(), {
        state: bag.state,
        slots: bag.slots,
        findings: bag.findings,
        history: bag.history,
        width: 100,
        startedAt: 0,
        now: 60_000,
        colorMode: 'color',
      }),
    ).lastFrame()
    const runMono = render(
      createElement(createRunView(), {
        state: bag.state,
        slots: bag.slots,
        findings: bag.findings,
        history: bag.history,
        width: 100,
        startedAt: 0,
        now: 60_000,
        colorMode: 'monochrome',
      }),
    ).lastFrame()
    const gateColored = render(
      createElement(GateScreen, {
        view: GATE_VIEW,
        toggles: {},
        redirects: {},
        blockerAnswers: {},
        ackAffirmed: false,
        width: 100,
        cursor: 0,
        colorMode: 'color',
      }),
    ).lastFrame()
    const gateMono = render(
      createElement(GateScreen, {
        view: GATE_VIEW,
        toggles: {},
        redirects: {},
        blockerAnswers: {},
        ackAffirmed: false,
        width: 100,
        cursor: 0,
        colorMode: 'monochrome',
      }),
    ).lastFrame()
    const now = new Date('2026-01-03T12:00:00.000Z')
    const sessionColored = render(
      createElement(SessionScreen, {
        rows: [sessionRow()],
        state: { screen: 'list', cursor: 0 },
        now,
        width: 100,
        colorMode: 'color',
      }),
    ).lastFrame()
    const sessionMono = render(
      createElement(SessionScreen, {
        rows: [sessionRow()],
        state: { screen: 'list', cursor: 0 },
        now,
        width: 100,
        colorMode: 'monochrome',
      }),
    ).lastFrame()
    expect(stripAnsi(frameText(runColored))).toBe(frameText(runMono))
    expect(stripAnsi(frameText(gateColored))).toBe(frameText(gateMono))
    expect(stripAnsi(frameText(sessionColored))).toBe(frameText(sessionMono))
    expect(frameText(runColored)).toContain(ESC)
    expect(frameText(gateColored)).toContain(ESC)
    expect(frameText(sessionColored)).toContain(ESC)
  })
})
