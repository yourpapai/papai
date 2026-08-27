// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { render } from 'ink-testing-library'
import { createElement } from 'react'

import type { GateAnswers, GateAnswerItem } from '../../sdd-runner/src/gate-answers.js'
import { renderGateAnswers, responseFromAnswers } from '../../sdd-runner/src/gate-answers.js'
import { parseGateResponse } from '../../sdd-runner/src/gate-model.js'
import type { GateSessionView } from '../../sdd-runner/src/gate-session.js'
import type { KeyFlags } from '../../sdd-runner/src/tui-gate-session.js'
import { createKeyFeed, GateSessionTui, runTuiGateSession } from '../../sdd-runner/src/tui-gate-session.js'

const VIEW: GateSessionView = {
  gateMode: 'early',
  items: [
    {
      kind: 'assumption',
      id: 'A1',
      text: 'guests stay read-only',
      evidence: 'src/chat/guard.ts:12',
      blastRadius: 'group replies',
    },
    {
      kind: 'finding',
      id: 'F1',
      text: 'proposal never names the scope id',
      evidence: 'proposal.md L5',
      blastRadius: '',
    },
  ],
  blockers: [{ id: 'B1', gap: 'migration untested', evidence: 'drizzle/0007 x.sql' }],
  requiredAck: { id: 'T1', text: 'trajectory is improving' },
}

function expectSelfChecks(answers: GateAnswers): void {
  const md = renderGateAnswers(answers)
  const parsed = parseGateResponse(md, {
    assumptions: [{ id: 'A1', text: 'guests stay read-only', blast_radius: 'group replies' }],
    blockers: [{ id: 'B1', gap: 'migration untested', evidence: 'drizzle/0007 x.sql' }],
    findings: [{ id: 'F1', gap: 'proposal never names the scope id', evidence: 'proposal.md L5' }],
    requiredAck: 'T1',
    gateMode: 'early',
  })
  expect(JSON.stringify(parsed)).toBe(JSON.stringify(responseFromAnswers(answers)))
}

async function drive(
  keys: readonly string[],
  view: GateSessionView = VIEW,
): Promise<{ settled: GateAnswers[]; abandoned: boolean; frame: () => string }> {
  const settled: GateAnswers[] = []
  let abandoned = false
  const instance = render(
    createElement(GateSessionTui, {
      view,
      onSettle: (answers) => {
        settled.push(answers)
      },
      onAbandoned: () => {
        abandoned = true
      },
    }),
  )
  for (const key of keys) await instance.stdin.write(key)
  const frame = (): string => instance.lastFrame() ?? ''
  return { settled, abandoned, frame }
}

describe('TUI gate session driver (4.5)', () => {
  it('toggle → redirect → blocker answer → ack → approve settles veto answers', async () => {
    const { settled, frame } = await drive([
      '\u001b[B',
      ' ',
      '\r',
      'quote the scope id',
      '\r',
      '\u001b[B',
      '\r',
      'covered by test x',
      '\r',
      '\u001b[B',
      ' ',
      'a',
    ])
    expect(frame()).toContain('→ quote the scope id')
    expect(settled.length).toBe(1)
    const answers = settled[0]!
    const f1 = answers.items.find((item: GateAnswerItem) => item.id === 'F1')
    expect(f1?.accepted).toBe(false)
    expect(f1?.redirect).toBe('quote the scope id')
    expect(answers.blockerAnswers).toEqual([{ id: 'B1', gap: 'migration untested', answer: 'covered by test x' }])
    expect(answers.acks).toEqual([{ id: 'T1', text: 'trajectory is improving' }])
    expect(answers.decision).toBe('veto')
    expectSelfChecks(answers)
  })

  it('approve key is ignored while the ack is unaffirmed or a blocker unanswered', async () => {
    const { settled, frame } = await drive(['a', '\u001b[B', '\r', 'ans', '\r', 'a'])
    expect(settled.length).toBe(0)
    expect(frame()).toContain('approve unavailable: T1 not affirmed')
    const after = await drive(['a', '\u001b[B', '\u001b[B', '\u001b[B', ' ', 'a'])
    expect(after.settled.length).toBe(0)
    expect(after.frame()).toContain('approve unavailable: blocker B1 unanswered')
  })

  it('accepting everything approves', async () => {
    const { settled } = await drive(['\u001b[B', '\u001b[B', '\r', 'OVERRIDE', '\r', '\u001b[B', ' ', 'a'])
    expect(settled[0]?.decision).toBe('approve')
    expect(settled[0]).toBeDefined()
    expectSelfChecks(settled[0]!)
  })

  it('e extends at an early gate; x aborts; q abandons', async () => {
    const { settled, abandoned } = await drive(['e', 'x', 'q'])
    expect(settled[0]?.decision).toBe('extend')
    expect(settled[1]?.decision).toBe('abort')
    expect(abandoned).toBe(true)
  })

  it('e is unavailable at a final gate', async () => {
    const finalView: GateSessionView = { ...VIEW, gateMode: 'final' }
    const { settled } = await drive(['e'], finalView)
    expect(settled.length).toBe(0)
  })
})

describe('GateSessionTui scripted key feed', () => {
  it('applies a synchronous key burst after subscription without losing keys', async () => {
    const feed = createKeyFeed()
    const settled: GateAnswers[] = []
    render(
      createElement(GateSessionTui, {
        view: VIEW,
        onSettle: (answers) => {
          settled.push(answers)
        },
        onAbandoned: () => {},
        keys: feed,
      }),
    )
    await feed.whenSubscribed
    const plain: KeyFlags = {
      upArrow: false,
      downArrow: false,
      return: false,
      escape: false,
      backspace: false,
      delete: false,
    }
    const down: KeyFlags = { ...plain, downArrow: true }
    const cr: KeyFlags = { ...plain, return: true }
    const burst: ReadonlyArray<readonly [string, KeyFlags]> = [
      ['\u001b[B', down],
      ['\u001b[B', down],
      ['\r', cr],
      ['O', plain],
      ['V', plain],
      ['E', plain],
      ['R', plain],
      ['R', plain],
      ['I', plain],
      ['D', plain],
      ['E', plain],
      ['\r', cr],
      ['\u001b[B', down],
      [' ', plain],
      ['a', plain],
    ]
    for (const [token, key] of burst) {
      feed.emit(token, key)
    }
    expect(settled.length).toBe(1)
    expect(settled[0]?.decision).toBe('approve')
  })
})

describe('runTuiGateSession kind/id-mismatch regression', () => {
  it('settles approve when a stale round carries a finding id inside an assumption item', async () => {
    const poisonedView: GateSessionView = {
      gateMode: 'final',
      items: [
        { kind: 'finding', id: 'F13', text: 'F13', evidence: 'edited — pinned the reading', blastRadius: '' },
        { kind: 'finding', id: 'F14', text: 'F14', evidence: 'edited — abort fan-out', blastRadius: '' },
        { kind: 'finding', id: 'F15', text: 'F15', evidence: 'edited — single driver', blastRadius: '' },
        {
          kind: 'assumption',
          id: 'F4',
          text: 'Plan-gate veto rounds are unbounded',
          evidence: '',
          blastRadius: '',
        },
      ],
      blockers: [],
      requiredAck: null,
    }
    const written: string[] = []
    const result = await runTuiGateSession({
      view: poisonedView,
      writeGateMd: (md) => {
        written.push(md)
        return Promise.resolve()
      },
      keyScript: 'a',
    })
    expect(result).toMatchObject({ status: 'answered', decision: 'approve' })
    expect(written[0]).toContain('- [x] F4 Plan-gate veto rounds are unbounded')
  })
})

describe('runTuiGateSession', () => {
  it('settles through the write-then-parse self-check and writes the gate md', async () => {
    const written: string[] = []
    const result = await runTuiGateSession({
      view: VIEW,
      writeGateMd: (md) => {
        written.push(md)
        return Promise.resolve()
      },
      keyScript: '\u001b[B\u001b[B\rOVERRIDE\r\u001b[B a',
    })
    expect(result).toMatchObject({ status: 'answered', decision: 'approve' })
    expect(written.length).toBe(1)
    expect(written[0]).toContain('## Gate response')
  })

  it('scripted q abandons without writing', async () => {
    const written: string[] = []
    const result = await runTuiGateSession({
      view: VIEW,
      writeGateMd: (md) => {
        written.push(md)
        return Promise.resolve()
      },
      keyScript: 'q',
    })
    expect(result.status).toBe('abandoned')
    expect(written.length).toBe(0)
  })
})

describe('plan-gate settle self-check (D10)', () => {
  const PLAN_VIEW: GateSessionView = {
    gateMode: 'plan',
    items: [
      { kind: 'child', id: 'C1', text: 'auth-db — Ship the drafted slice.', evidence: '', blastRadius: '' },
      { kind: 'child', id: 'C2', text: 'auth-api — Partition the remainder.', evidence: '', blastRadius: '' },
    ],
    blockers: [],
    requiredAck: null,
  }

  it('a plan-gate approve settle passes the write-then-parse self-check through the shared children-aware expected content', async () => {
    const written: string[] = []
    const result = await runTuiGateSession({
      view: PLAN_VIEW,
      writeGateMd: (md) => {
        written.push(md)
        return Promise.resolve()
      },
      keyScript: 'a',
    })
    expect(result).toMatchObject({ status: 'answered', decision: 'approve' })
    expect(written.length).toBe(1)
    expect(written[0]).toContain('- [x] C1 auth-db — Ship the drafted slice.')
    expect(written[0]).toContain('- [x] C2 auth-api — Partition the remainder.')
  })
})
