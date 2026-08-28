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
import { mountToStream, waitFor } from './stream-harness.js'

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

async function driveInteractive(view: GateSessionView = VIEW): Promise<{
  readonly press: (input: string, key?: KeyFlags) => Promise<void>
  readonly settled: GateAnswers[]
  readonly abandoned: () => boolean
  readonly frame: () => string
  readonly unmount: () => void
}> {
  const feed = createKeyFeed()
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
  return {
    press: async (input: string, key: KeyFlags = plain): Promise<void> => {
      const before = instance.lastFrame()
      feed.emit(input, key)
      const deadline = Date.now() + 150
      while (instance.lastFrame() === before && Date.now() < deadline) {
        await new Promise((resolve) => {
          setTimeout(resolve, 5)
        })
      }
    },
    settled,
    abandoned: (): boolean => abandoned,
    frame: (): string => instance.lastFrame() ?? '',
    unmount: (): void => {
      instance.unmount()
    },
  }
}

describe('gate chrome (6.1: footer + help overlay)', () => {
  it('renders the persistent gate footer with the current bindings', async () => {
    const session = await driveInteractive()
    expect(session.frame()).toContain('(a)pprove · (e)xtend · (x)abort · (q)uit · (?) help')
    session.unmount()
  })

  it('? opens the overlay above the footer; dismissal restores the frame exactly', async () => {
    const session = await driveInteractive()
    const plain = session.frame()
    await session.press('?')
    expect(session.frame()).toContain('Keys · gate')
    expect(session.frame()).toContain('(?) help')
    expect(session.frame()).toContain('(e)xtend — ')
    await session.press('?')
    expect(session.frame()).toBe(plain)
    session.unmount()
  })

  it('an open overlay swallows every key — no decisions, no abandon', async () => {
    const session = await driveInteractive()
    await session.press('?')
    await session.press('a', {
      upArrow: false,
      downArrow: false,
      return: false,
      escape: false,
      backspace: false,
      delete: false,
    })
    await session.press('x')
    await session.press('q')
    await session.press('\u001b[B', {
      upArrow: false,
      downArrow: true,
      return: false,
      escape: false,
      backspace: false,
      delete: false,
    })
    expect(session.settled.length).toBe(0)
    expect(session.abandoned()).toBe(false)
    expect(session.frame()).toContain('Keys · gate')
    session.unmount()
  })

  it('? stays literal while a redirect or blocker input is open', async () => {
    const session = await driveInteractive()
    await session.press('\u001b[B', {
      upArrow: false,
      downArrow: true,
      return: false,
      escape: false,
      backspace: false,
      delete: false,
    })
    await session.press(' ')
    await session.press('\r', {
      upArrow: false,
      downArrow: false,
      return: true,
      escape: false,
      backspace: false,
      delete: false,
    })
    await session.press('?')
    expect(session.frame()).toContain('redirect for F1: ?')
    expect(session.frame()).not.toContain('Keys · gate')
    await session.press('x')
    expect(session.frame()).toContain('redirect for F1: ?x')
    expect(session.settled.length).toBe(0)
    session.unmount()
  })

  it('a mid-entry resize preserves the in-view input buffer and typing continues', async () => {
    const feed = createKeyFeed()
    const mount = mountToStream(
      createElement(GateSessionTui, {
        view: VIEW,
        onSettle: () => {},
        onAbandoned: () => {},
        keys: feed,
      }),
    )
    try {
      await mount.waitUntilRenderFlush()
      const down: KeyFlags = {
        upArrow: false,
        downArrow: true,
        return: false,
        escape: false,
        backspace: false,
        delete: false,
      }
      const cr: KeyFlags = {
        upArrow: false,
        downArrow: false,
        return: true,
        escape: false,
        backspace: false,
        delete: false,
      }
      const plain: KeyFlags = {
        upArrow: false,
        downArrow: false,
        return: false,
        escape: false,
        backspace: false,
        delete: false,
      }
      await feed.whenSubscribed
      feed.emit('\u001b[B', down)
      feed.emit(' ', plain)
      feed.emit('\r', cr)
      feed.emit('why', plain)
      await waitFor(() => mount.streamText().includes('redirect for F1: why'))
      mount.stdout.resizeTo(48, 24)
      await waitFor(() => mount.streamText().includes('    evidence: proposal.md L5'))
      feed.emit(' now', plain)
      await waitFor(() => mount.streamText().includes('redirect for F1: why now'))
    } finally {
      mount.unmount()
    }
  })
})
describe('decision parity (8.1)', () => {
  const PLAIN: KeyFlags = {
    upArrow: false,
    downArrow: false,
    return: false,
    escape: false,
    backspace: false,
    delete: false,
  }
  const DOWN: KeyFlags = { ...PLAIN, downArrow: true }
  const CR: KeyFlags = { ...PLAIN, return: true }

  interface ParityLeg {
    readonly answers: GateAnswers
    readonly md: string
  }

  async function settleLeg(options: { toggles: boolean; noColor: boolean; resizes: boolean }): Promise<ParityLeg> {
    const priorNoColor = process.env['NO_COLOR']
    if (options.noColor) process.env['NO_COLOR'] = '1'
    try {
      const feed = createKeyFeed()
      const answers = new Promise<GateAnswers>((settle) => {
        void (async (): Promise<void> => {
          const mount = mountToStream(
            createElement(GateSessionTui, {
              view: VIEW,
              onSettle: (settled) => {
                settle(settled)
              },
              onAbandoned: () => {
                settle({ items: [], blockerAnswers: [], acks: [], decision: 'abort' })
              },
              keys: feed,
            }),
          )
          await feed.whenSubscribed
          await mount.waitUntilRenderFlush()
          const script: ReadonlyArray<readonly [string, KeyFlags]> = [
            ['\u001b[B', DOWN],
            [' ', PLAIN],
            ['\r', CR],
            ['quote the scope id', PLAIN],
            ['\r', CR],
            ['\u001b[B', DOWN],
            ['\r', CR],
            ['covered by test x', PLAIN],
            ['\r', CR],
            ['\u001b[B', DOWN],
            [' ', PLAIN],
            ['a', PLAIN],
          ]
          for (const [input, key] of script) {
            if (input === '\u001b[B' && options.toggles) {
              feed.emit('?', PLAIN)
              feed.emit('?', PLAIN)
            }
            feed.emit(input, key)
            if (input === '\r' && options.resizes) mount.stdout.resizeTo(64, 24)
            if (input === 'a' && options.resizes) mount.stdout.resizeTo(100, 24)
            await new Promise((resolve) => {
              setTimeout(resolve, 5)
            })
          }
          await mount.waitUntilRenderFlush()
        })()
      })
      const settled = await answers
      return { answers: settled, md: renderGateAnswers(settled) }
    } finally {
      if (priorNoColor === undefined) delete process.env['NO_COLOR']
      else process.env['NO_COLOR'] = priorNoColor
    }
  }

  it('the same key script yields byte-identical answers and gate markdown under ? toggles, NO_COLOR, and width changes', async () => {
    const plain = await settleLeg({ toggles: false, noColor: false, resizes: false })
    const decorated = await settleLeg({ toggles: true, noColor: true, resizes: true })
    expect(JSON.stringify(decorated.answers)).toBe(JSON.stringify(plain.answers))
    expect(decorated.md).toBe(plain.md)
    expect(plain.answers.decision).toBe('veto')
    expectSelfChecks(plain.answers)
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

describe('plan-mode child-row toggle semantics (D10)', () => {
  const PLAN_VIEW: GateSessionView = {
    gateMode: 'plan',
    items: [
      { kind: 'child', id: 'C1', text: 'auth-db — Ship the drafted slice.', evidence: '', blastRadius: '' },
      { kind: 'child', id: 'C2', text: 'auth-api — Partition the remainder.', evidence: '', blastRadius: '' },
    ],
    blockers: [],
    requiredAck: null,
  }

  it('child rows toggle exactly like assumption checkboxes — a toggle cycle returns to checked and settles approve', async () => {
    const { settled, frame } = await drive([' ', ' ', 'a'], PLAN_VIEW)
    expect(frame()).toContain('[x] C1 auth-db — Ship the drafted slice.')
    expect(settled.length).toBe(1)
    expect(settled[0]?.decision).toBe('approve')
    expect(settled[0]?.items.every((item) => item.accepted)).toBe(true)
  })

  it('settle with an unchecked child vetoes, carrying the redirect collected beneath the row', async () => {
    const { settled, frame } = await drive([' ', '\r', 'fold the API slice into child 1', '\r', 'a'], PLAN_VIEW)
    expect(frame()).toContain('[ ] C1 auth-db — Ship the drafted slice.')
    expect(frame()).toContain('→ fold the API slice into child 1')
    expect(settled.length).toBe(1)
    const answers = settled[0]
    expect(answers?.decision).toBe('veto')
    const c1 = answers?.items.find((item) => item.id === 'C1')
    expect(c1).toMatchObject({ accepted: false, redirect: 'fold the API slice into child 1' })
    expect(answers?.items.find((item) => item.id === 'C2')?.accepted).toBe(true)
  })

  it('an unchecked-child veto passes the full write-then-parse self-check and writes the redirect into the gate md', async () => {
    const written: string[] = []
    const result = await runTuiGateSession({
      view: PLAN_VIEW,
      writeGateMd: (md) => {
        written.push(md)
        return Promise.resolve()
      },
      keyScript: ' \rfold the API slice into child 1\ra',
    })
    expect(result).toMatchObject({ status: 'answered', decision: 'veto' })
    expect(written.length).toBe(1)
    expect(written[0]).toContain('- [ ] C1 auth-db — Ship the drafted slice.')
    expect(written[0]).toContain('→ fold the API slice into child 1')
    expect(written[0]).toContain('- [x] C2 auth-api — Partition the remainder.')
  })

  it('e (extend) is refused at plan mode — no settle, no write', async () => {
    const written: string[] = []
    const result = await runTuiGateSession({
      view: PLAN_VIEW,
      writeGateMd: (md) => {
        written.push(md)
        return Promise.resolve()
      },
      keyScript: 'e',
    })
    expect(result.status).toBe('abandoned')
    expect(written.length).toBe(0)
  })
})
