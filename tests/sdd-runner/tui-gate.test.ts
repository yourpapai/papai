// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { render } from 'ink-testing-library'
import { createElement } from 'react'

import { renderGateAnswers, responseFromAnswers } from '../../sdd-runner/src/gate-answers.js'
import { parseGateResponse } from '../../sdd-runner/src/gate-model.js'
import { createGateScreen, gateAnswersFromToggles } from '../../sdd-runner/src/tui-gate.js'
import type { GateScreenProps } from '../../sdd-runner/src/tui-gate.js'

const VIEW = {
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
    {
      kind: 'finding' as const,
      id: 'F2',
      text: 'design lacks rollback',
      evidence: 'design.md L30',
      blastRadius: '',
      decidedBy: 'policy R3',
    },
  ],
  blockers: [{ id: 'B1', gap: 'migration untested', evidence: 'drizzle/0007 x.sql' }],
  requiredAck: { id: 'T1', text: 'trajectory is improving' },
}

function baseProps(overrides: Partial<GateScreenProps> = {}): GateScreenProps {
  return {
    view: VIEW,
    toggles: { A1: true, F1: true, F2: true },
    redirects: {},
    blockerAnswers: {},
    ackAffirmed: false,
    width: 100,
    ...overrides,
  }
}

describe('TUI gate screen (4.4/4.5)', () => {
  it('lists items with evidence and checkbox state', () => {
    const GateScreen = createGateScreen()
    const { lastFrame, unmount } = render(createElement(GateScreen, baseProps()))
    const frame = lastFrame()
    expect(frame).toContain('[x] A1 guests stay read-only')
    expect(frame).toContain('F1 proposal never names the scope id')
    expect(frame).toContain('evidence: proposal.md L5')
    expect(frame).toContain('B1 migration untested')
    unmount()
  })

  it('unaccepted items render unchecked with their redirect', () => {
    const GateScreen = createGateScreen()
    const { lastFrame, unmount } = render(
      createElement(
        GateScreen,
        baseProps({ toggles: { A1: false, F1: true, F2: true }, redirects: { A1: 'narrow to config scope' } }),
      ),
    )
    const frame = lastFrame()
    expect(frame).toContain('[ ] A1')
    expect(frame).toContain('→ narrow to config scope')
    unmount()
  })

  it('policy-prechecked items render read-only with their attribution', () => {
    const GateScreen = createGateScreen()
    const { lastFrame, unmount } = render(createElement(GateScreen, baseProps()))
    const frame = lastFrame()
    expect(frame).toContain('F2')
    expect(frame).toContain('decided-by: policy R3')
    expect(frame).toContain('(read-only)')
    unmount()
  })

  it('marks the cursor row so keyboard navigation is visible', () => {
    const GateScreen = createGateScreen()
    const { lastFrame, unmount } = render(createElement(GateScreen, baseProps({ cursor: 1 })))
    const frame = lastFrame()
    expect(frame).toContain('❯ [x] F1')
    expect(frame).not.toContain('❯ [x] A1')
    expect(frame).toContain('  [x] A1 guests stay read-only')
    unmount()
    const { lastFrame: frame2, unmount: u2 } = render(createElement(GateScreen, baseProps({ cursor: 4 })))
    expect(frame2()).toContain('❯ [ ] T1 trajectory is improving')
    expect(frame2()).not.toContain('❯ [x] F2')
    u2()
  })

  it('renders consequences beside the decision menu', () => {
    const GateScreen = createGateScreen()
    const { lastFrame, unmount } = render(createElement(GateScreen, baseProps()))
    const frame = lastFrame()
    expect(frame).toContain('(a)pprove')
    expect(frame).toContain('(e)xtend')
    expect(frame).toContain('(x)abort')
    expect(frame).toContain('runs one more review round, then re-gates')
    expect(frame).toContain('ends the run without completing')
    unmount()
  })

  it('approve is blocked until the ack is affirmed and blockers answered, naming the unmet condition', () => {
    const GateScreen = createGateScreen()
    const { lastFrame, unmount } = render(createElement(GateScreen, baseProps()))
    expect(lastFrame()).toContain('approve unavailable: T1 not affirmed, blocker B1 unanswered')
    unmount()
    const { lastFrame: frame2, unmount: u2 } = render(createElement(GateScreen, baseProps({ ackAffirmed: true })))
    expect(frame2()).toContain('approve unavailable: blocker B1 unanswered')
    u2()
    const { lastFrame: frame3, unmount: u3 } = render(
      createElement(GateScreen, baseProps({ ackAffirmed: true, blockerAnswers: { B1: 'covered by test x' } })),
    )
    expect(frame3()).not.toContain('approve unavailable')
    u3()
  })
})

describe('gateAnswersFromToggles', () => {
  it('builds GateAnswers the write-then-parse self-check accepts', () => {
    const answers = gateAnswersFromToggles(VIEW, {
      toggles: { A1: true, F1: false, F2: true },
      redirects: { F1: 'quote the scope id' },
      blockerAnswers: { B1: 'covered by test x' },
      ackAffirmed: true,
    })
    const md = renderGateAnswers(answers)
    const parsed = parseGateResponse(md, {
      assumptions: [{ id: 'A1', text: 'guests stay read-only', blast_radius: 'group replies' }],
      blockers: [{ id: 'B1', gap: 'migration untested', evidence: 'drizzle/0007 x.sql' }],
      findings: [
        { id: 'F1', gap: 'proposal never names the scope id', evidence: 'proposal.md L5' },
        { id: 'F2', gap: 'design lacks rollback', evidence: 'design.md L30' },
      ],
      requiredAck: 'T1',
      gateMode: 'early',
    })
    expect(JSON.stringify(parsed)).toBe(JSON.stringify(responseFromAnswers(answers)))
    expect(parsed.approved).toBe(false)
    expect(parsed.vetoes).toEqual([{ id: 'F1', redirect: 'quote the scope id' }])
  })

  it('approve with everything accepted and answered parses back approved', () => {
    const answers = gateAnswersFromToggles(VIEW, {
      toggles: { A1: true, F1: true, F2: true },
      redirects: {},
      blockerAnswers: { B1: 'OVERRIDE' },
      ackAffirmed: true,
    })
    const md = renderGateAnswers(answers)
    const parsed = parseGateResponse(md, {
      assumptions: [{ id: 'A1', text: 'guests stay read-only', blast_radius: 'group replies' }],
      blockers: [{ id: 'B1', gap: 'migration untested', evidence: 'drizzle/0007 x.sql' }],
      findings: [
        { id: 'F1', gap: 'proposal never names the scope id', evidence: 'proposal.md L5' },
        { id: 'F2', gap: 'design lacks rollback', evidence: 'design.md L30' },
      ],
      requiredAck: 'T1',
      gateMode: 'early',
    })
    expect(parsed.approved).toBe(true)
    expect(parsed.override).toBe(true)
  })
})
