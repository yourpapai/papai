// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { renderDecisions } from '../../sdd-runner/src/gate-render.js'
import { consequenceLines, desugarFlags } from '../../sdd-runner/src/gate-session.js'
import type { GateSessionView } from '../../sdd-runner/src/gate-session.js'

const ACK_TEXT = 'I reviewed the trajectory and the open findings above'

function view(overrides: Partial<GateSessionView> = {}): GateSessionView {
  return {
    gateMode: 'final',
    items: [
      { kind: 'assumption', id: 'A1', text: 'guests stay read-only', evidence: '', blastRadius: 'group replies' },
      { kind: 'assumption', id: 'A2', text: 'sqlite is enough', evidence: '', blastRadius: 'storage' },
      { kind: 'finding', id: 'F1', text: 'design lacks rollback', evidence: 'edited — gap narrowed', blastRadius: '' },
    ],
    blockers: [],
    requiredAck: null,
    ...overrides,
  }
}

describe('desugarFlags (task 4.5)', () => {
  it('--confirm-all accepts all items then each --veto un-accepts its id with the redirect', async () => {
    const written: string[] = []
    const answers = await desugarFlags(
      {
        confirmAll: true,
        vetoes: [{ id: 'A1', redirect: 'dm-only' }],
      },
      view(),
      (md) => {
        written.push(md)
        return Promise.resolve()
      },
    )
    expect(answers.status).toBe('answered')
    expect(written).toHaveLength(1)
    expect(written[0]).toContain('- [ ] A1')
    expect(written[0]).toContain('→ dm-only')
    expect(written[0]).toContain('- [x] A2')
    expect(written[0]).toContain('- [x] F1')
  })

  it('--confirm-all answers every blocker with OVERRIDE and affirms the ack', async () => {
    const written: string[] = []
    const answers = await desugarFlags(
      { confirmAll: true },
      {
        ...view(),
        gateMode: 'early',
        blockers: [{ id: 'B1', gap: 'no rollback path', evidence: '' }],
        requiredAck: { id: 'T1', text: ACK_TEXT },
      },
      (md) => {
        written.push(md)
        return Promise.resolve()
      },
    )
    expect(answers.status).toBe('answered')
    expect(written[0]).toContain('→ OVERRIDE')
    expect(written[0]).toContain('- [x] T1')
  })

  it('fails on an unknown veto id before writing anything', async () => {
    const written: string[] = []
    const writer = (md: string): Promise<void> => {
      written.push(md)
      return Promise.resolve()
    }
    await expect(
      desugarFlags({ confirmAll: true, vetoes: [{ id: 'Z9', redirect: 'x' }] }, view(), writer),
    ).rejects.toThrow(/Z9/u)
    expect(written).toHaveLength(0)
  })

  it('requires --confirm-all or a veto for a pure flag invocation to be meaningful', async () => {
    const written: string[] = []
    const writer = (md: string): Promise<void> => {
      written.push(md)
      return Promise.resolve()
    }
    await expect(desugarFlags({ confirmAll: false, vetoes: [] }, view(), writer)).rejects.toThrow(
      /confirm-all|--veto|file/u,
    )
  })
})

describe('shared consequence copy (task 5.1)', () => {
  it('prints decision-menu consequence lines from the same source the gate file uses (early wording matches)', () => {
    const fileMd = renderDecisions('early').join('\n')
    const sessionMd = consequenceLines({ ...view(), gateMode: 'early' }).join('\n')
    const sharedPhrase = 'continues to task decomposition, atomicity checking, and a final gate'
    expect(sessionMd).toContain(sharedPhrase)
    expect(fileMd).toContain(sharedPhrase)
    expect(sessionMd).toContain('runs one more review round, then re-gates')
    expect(fileMd).toContain('runs one more review round, then re-gates')
  })

  it('final-gate wording matches between the session menu and the gate file', () => {
    const fileLines = renderDecisions('final')
    const sessionLines = consequenceLines({ ...view(), gateMode: 'final' })
    expect(sessionLines.join('\n')).toContain('completes the run with the full artifact set')
    expect(fileLines.join('\n')).toContain('completes the run with the full artifact set')
    expect(sessionLines.join('\n')).not.toContain('extend — runs one more review round')
  })
})

describe('settleAnswers decidedBy self-check (D4)', () => {
  it('a decidedBy field survives the write-then-parse round trip and parses as the same outcome', async () => {
    const written: string[] = []
    const result = await desugarFlags({ confirmAll: true, decidedBy: 'policy R1' }, view(), (md) => {
      written.push(md)
      return Promise.resolve()
    })
    expect(result).toMatchObject({ status: 'answered', decision: 'approve' })
    expect(written[0]).toContain('decided-by: policy R1')
    expect(written[0]).toContain('- [x] A1')
  })

  it('flag decisions without decidedBy render exactly as today', async () => {
    const written: string[] = []
    await desugarFlags({ confirmAll: true }, view(), (md) => {
      written.push(md)
      return Promise.resolve()
    })
    expect(written[0]).not.toContain('decided-by')
  })
})
