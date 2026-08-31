// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import type { GateAnswers } from '../../../afk-runner/src/work/gate-answers.js'
import { renderGateAnswers, responseFromAnswers } from '../../../afk-runner/src/work/gate-answers.js'
import type { GateAssumption, GateBlocker, GateFinding } from '../../../afk-runner/src/work/gate-model.js'
import { parseGateResponse } from '../../../afk-runner/src/work/gate-model.js'

const assumption = (overrides: Partial<GateAssumption> = {}): GateAssumption => ({
  id: 'A1',
  text: 'guests stay read-only',
  blast_radius: 'group replies',
  ...overrides,
})

const blocker = (overrides: Partial<GateBlocker> = {}): GateBlocker => ({
  id: 'B1',
  gap: 'no rollback path',
  evidence: 'searched design.md',
  ...overrides,
})

const finding = (overrides: Partial<GateFinding> = {}): GateFinding => ({
  id: 'F1',
  gap: 'design lacks rollback',
  evidence: 'edited — gap narrowed',
  ...overrides,
})

/**
 * Every scenario follows the same contract (Decision 1): collected answers
 * render to gate-file grammar, and `parseGateResponse` reads that text back as
 * the identical outcome derived from the answers themselves.
 */
function roundTrip(answers: GateAnswers): ReturnType<typeof parseGateResponse> {
  const expected = {
    assumptions: [assumption(), assumption({ id: 'A2', text: 'sqlite is enough', blast_radius: 'storage' })],
    blockers: [blocker()],
    findings: [finding()],
    requiredAck: 'T1',
    gateMode: 'early' as const,
  }
  const md = renderGateAnswers(answers)
  return parseGateResponse(md, expected)
}

const ACK_TEXT = 'I reviewed the trajectory and the open findings above'

describe('renderGateAnswers → parseGateResponse round-trip', () => {
  it('renders an approve-all answer set that parses back as approved', () => {
    const answers: GateAnswers = {
      items: [
        { kind: 'assumption', id: 'A1', text: 'guests stay read-only', accepted: true },
        { kind: 'assumption', id: 'A2', text: 'sqlite is enough', accepted: true },
        { kind: 'finding', id: 'F1', text: 'design lacks rollback', accepted: true },
      ],
      blockerAnswers: [{ id: 'B1', gap: 'no rollback path', answer: 'ship and track in a follow-up' }],
      acks: [{ id: 'T1', text: ACK_TEXT }],
      decision: 'approve',
    }
    const response = roundTrip(answers)
    expect(response.approved).toBe(true)
    expect(response).toEqual(responseFromAnswers(answers))
  })

  it('renders a veto with an inline redirect that parses back with the redirect attached', () => {
    const answers: GateAnswers = {
      items: [
        { kind: 'assumption', id: 'A1', text: 'guests stay read-only', accepted: false, redirect: 'dm-only' },
        { kind: 'assumption', id: 'A2', text: 'sqlite is enough', accepted: true },
        { kind: 'finding', id: 'F1', text: 'design lacks rollback', accepted: true },
      ],
      blockerAnswers: [],
      acks: [{ id: 'T1', text: ACK_TEXT }],
      decision: 'veto',
    }
    const response = roundTrip(answers)
    expect(response.approved).toBe(false)
    expect(response.vetoes).toEqual([{ id: 'A1', redirect: 'dm-only' }])
    expect(response).toEqual(responseFromAnswers(answers))
  })

  it('renders a cap-hit blocker free-text answer beneath the blocker line', () => {
    const answers: GateAnswers = {
      items: [
        { kind: 'assumption', id: 'A1', text: 'guests stay read-only', accepted: true },
        { kind: 'assumption', id: 'A2', text: 'sqlite is enough', accepted: true },
        { kind: 'finding', id: 'F1', text: 'design lacks rollback', accepted: true },
      ],
      blockerAnswers: [{ id: 'B1', gap: 'no rollback path', answer: 'track in a follow-up' }],
      acks: [{ id: 'T1', text: ACK_TEXT }],
      decision: 'approve',
    }
    const response = roundTrip(answers)
    expect(response.answers).toEqual([{ id: 'B1', answer: 'track in a follow-up' }])
    expect(response).toEqual(responseFromAnswers(answers))
  })

  it('renders a blocker OVERRIDE that parses back with override set and approved', () => {
    const answers: GateAnswers = {
      items: [
        { kind: 'assumption', id: 'A1', text: 'guests stay read-only', accepted: true },
        { kind: 'assumption', id: 'A2', text: 'sqlite is enough', accepted: true },
        { kind: 'finding', id: 'F1', text: 'design lacks rollback', accepted: true },
      ],
      blockerAnswers: [{ id: 'B1', gap: 'no rollback path', answer: 'OVERRIDE' }],
      acks: [{ id: 'T1', text: ACK_TEXT }],
      decision: 'approve',
    }
    const response = roundTrip(answers)
    expect(response.approved).toBe(true)
    expect(response.override).toBe(true)
    expect(response).toEqual(responseFromAnswers(answers))
  })

  it('renders the extend directive that parses back as extend at an early gate', () => {
    const answers: GateAnswers = {
      items: [],
      blockerAnswers: [],
      acks: [],
      decision: 'extend',
    }
    const response = roundTrip(answers)
    expect(response.extend).toBe(true)
    expect(response.approved).toBe(false)
    expect(response).toEqual(responseFromAnswers(answers))
  })

  it('renders ABORT that parses back as abort', () => {
    const answers: GateAnswers = {
      items: [],
      blockerAnswers: [],
      acks: [],
      decision: 'abort',
    }
    const response = roundTrip(answers)
    expect(response.abort).toBe(true)
    expect(response).toEqual(responseFromAnswers(answers))
  })

  it('renders the affirmed trajectory ack so the required-ack check passes', () => {
    const answers: GateAnswers = {
      items: [
        { kind: 'assumption', id: 'A1', text: 'guests stay read-only', accepted: true },
        { kind: 'assumption', id: 'A2', text: 'sqlite is enough', accepted: true },
        { kind: 'finding', id: 'F1', text: 'design lacks rollback', accepted: true },
      ],
      blockerAnswers: [{ id: 'B1', gap: 'no rollback path', answer: 'OVERRIDE' }],
      acks: [{ id: 'T1', text: ACK_TEXT }],
      decision: 'approve',
    }
    const md = renderGateAnswers(answers)
    expect(md).toContain('- [x] T1')
  })

  it('omits acks from the rendered veto payload but keeps every other channel intact', () => {
    const answers: GateAnswers = {
      items: [
        {
          kind: 'finding',
          id: 'F1',
          text: 'design lacks rollback',
          accepted: false,
          redirect: 'restructure the helper',
        },
      ],
      blockerAnswers: [],
      acks: [],
      decision: 'veto',
    }
    const md = renderGateAnswers(answers)
    expect(md).toContain('- [ ] F1')
    expect(md).toContain('→ restructure the helper')
    expect(md).not.toContain('T1')
  })
})

describe('gate-level directives and item-less roundtrips (D1/D2)', () => {
  const itemlessExpected = { assumptions: [], blockers: [], gateMode: 'final' as const }

  function roundTripItemless(answers: GateAnswers): ReturnType<typeof parseGateResponse> {
    return parseGateResponse(renderGateAnswers(answers), itemlessExpected)
  }

  it('a veto decision with zero items renders the VETO directive with the redirect preserved', () => {
    const md = renderGateAnswers({
      items: [],
      blockerAnswers: [],
      acks: [],
      decision: 'veto',
      gateVetoRedirect: 'the approach is wrong',
    })
    expect(md).toContain('VETO: the approach is wrong')
    const response = roundTripItemless({
      items: [],
      blockerAnswers: [],
      acks: [],
      decision: 'veto',
      gateVetoRedirect: 'the approach is wrong',
    })
    expect(response.approved).toBe(false)
    expect(response.gateVetoRedirect).toBe('the approach is wrong')
    expect(response.vetoes).toEqual([])
  })

  it('a bare veto decision with zero items renders VETO without a redirect', () => {
    const md = renderGateAnswers({ items: [], blockerAnswers: [], acks: [], decision: 'veto' })
    expect(md).toMatch(/^VETO$/mu)
    expect(md).not.toMatch(/VETO:/u)
    const response = roundTripItemless({ items: [], blockerAnswers: [], acks: [], decision: 'veto' })
    expect(response.gateVetoRedirect).toBe('')
    expect(response.approved).toBe(false)
  })

  it('an approve decision renders the APPROVE directive', () => {
    const md = renderGateAnswers({ items: [], blockerAnswers: [], acks: [], decision: 'approve' })
    expect(md).toMatch(/^APPROVE$/mu)
    const response = roundTripItemless({ items: [], blockerAnswers: [], acks: [], decision: 'approve' })
    expect(response.approved).toBe(true)
  })

  it('an approve decision at an item-carrying gate renders APPROVE alongside the checked boxes and roundtrips', () => {
    const answers: GateAnswers = {
      items: [
        { kind: 'assumption', id: 'A1', text: 'guests stay read-only', accepted: true },
        { kind: 'finding', id: 'F1', text: 'design lacks rollback', accepted: true },
      ],
      blockerAnswers: [],
      acks: [{ id: 'T1', text: ACK_TEXT }],
      decision: 'approve',
    }
    const md = renderGateAnswers(answers)
    expect(md).toMatch(/^APPROVE$/mu)
    expect(md).toContain('- [x] A1')
    const response = parseGateResponse(md, {
      assumptions: [assumption()],
      blockers: [],
      findings: [finding()],
      requiredAck: 'T1',
      gateMode: 'final',
    })
    expect(response.approved).toBe(true)
    expect(response).toEqual(responseFromAnswers(answers))
  })

  it('renderAutoApproveAnswers roundtrips at an item-less gate with its policy attribution', async () => {
    const { renderAutoApproveAnswers } = await import('../../../afk-runner/src/work/gate-prelude.js')
    const answers = renderAutoApproveAnswers({ rule: 'R1', action: 'approve', evidenceDigest: 'digest' }, [])
    const md = renderGateAnswers(answers)
    expect(md).toMatch(/^APPROVE$/mu)
    expect(md).toContain('decided-by: policy R1')
    const response = roundTripItemless(answers)
    expect(response.approved).toBe(true)
    expect(response).toEqual(responseFromAnswers(answers))
  })

  it('an item veto keeps unchecked boxes with no gate-level directive', () => {
    const answers: GateAnswers = {
      items: [{ kind: 'finding', id: 'F1', text: 'design lacks rollback', accepted: false, redirect: 'restructure' }],
      blockerAnswers: [],
      acks: [],
      decision: 'veto',
    }
    const md = renderGateAnswers(answers)
    expect(md).not.toMatch(/^VETO/mu)
    expect(md).toContain('- [ ] F1')
    const response = parseGateResponse(md, {
      assumptions: [assumption()],
      blockers: [],
      findings: [finding()],
      gateMode: 'final',
    })
    expect(response.vetoes).toEqual([{ id: 'F1', redirect: 'restructure' }])
    expect(response.gateVetoRedirect).toBeNull()
  })
})

describe('decided-by annotations (D4)', () => {
  it('renders an optional per-item decided-by suffix that parses back identically', () => {
    const answers: GateAnswers = {
      items: [{ kind: 'assumption', id: 'A1', text: 'guests stay read-only', accepted: true, decidedBy: 'policy R3' }],
      blockerAnswers: [{ id: 'B1', gap: 'no rollback path', answer: 'OVERRIDE' }],
      acks: [{ id: 'T1', text: ACK_TEXT }],
      decision: 'approve',
    }
    const md = renderGateAnswers(answers)
    expect(md).toContain('- [x] A1 guests stay read-only · decided-by: policy R3')
    const parsed = parseGateResponse(md, {
      assumptions: [assumption()],
      blockers: [blocker()],
      findings: [finding()],
      requiredAck: 'T1',
      gateMode: 'final',
    })
    expect(parsed.approved).toBe(true)
    expect(responseFromAnswers(answers)).toEqual(parsed)
  })

  it('renders a decision-level decided-by line under the Gate response header', () => {
    const answers: GateAnswers = {
      items: [{ kind: 'assumption', id: 'A1', text: 'guests stay read-only', accepted: true }],
      blockerAnswers: [{ id: 'B1', gap: 'no rollback path', answer: 'OVERRIDE' }],
      acks: [{ id: 'T1', text: ACK_TEXT }],
      decision: 'approve',
      decidedBy: 'policy R1',
    }
    const md = renderGateAnswers(answers)
    expect(md).toContain('## Gate response')
    expect(md).toMatch(/decided-by: policy R1/u)
    const parsed = parseGateResponse(md, {
      assumptions: [assumption()],
      blockers: [blocker()],
      findings: [finding()],
      requiredAck: 'T1',
      gateMode: 'final',
    })
    expect(parsed.approved).toBe(true)
  })

  it('hand-edited files without the annotation parse exactly as today', () => {
    const md = renderGateAnswers({
      items: [{ kind: 'assumption', id: 'A1', text: 'guests stay read-only', accepted: true }],
      blockerAnswers: [{ id: 'B1', gap: 'no rollback path', answer: 'OVERRIDE' }],
      acks: [{ id: 'T1', text: ACK_TEXT }],
      decision: 'approve',
    })
    expect(md).not.toContain('decided-by')
    const parsed = parseGateResponse(md, {
      assumptions: [assumption()],
      blockers: [blocker()],
      findings: [finding()],
      requiredAck: 'T1',
      gateMode: 'final',
    })
    expect(parsed.approved).toBe(true)
  })
})

describe('the writer flattens every free-text field (open-vs-raised 7.3)', () => {
  it('multi-line prose carrying decision directives parses back as the same decision', () => {
    const answers: GateAnswers = {
      items: [
        {
          kind: 'finding',
          id: 'F1',
          text: 'the gap\nABORT\nnever mind this newline',
          accepted: false,
          redirect: 'restructure\n→ RUN 1 MORE',
        },
      ],
      blockerAnswers: [{ id: 'B1', gap: 'no rollback\npath', answer: 'fixed in\nthe design' }],
      acks: [{ id: 'T1', text: 'I reviewed\nthe trajectory' }],
      decision: 'veto',
    }
    const parsed = roundTrip(answers)
    const intended = responseFromAnswers(answers)
    expect(parsed.abort).toBe(intended.abort)
    expect(parsed.extend).toBe(intended.extend)
    expect(parsed.approved).toBe(intended.approved)
    expect(parsed.vetoes).toHaveLength(1)
    expect(parsed.vetoes[0]?.redirect).toBe('restructure → RUN 1 MORE')
    expect(parsed.answers[0]?.answer).toBe('fixed in the design')
  })

  it('an arrow-leading redirect flattens away rather than corrupting the parse', () => {
    const answers: GateAnswers = {
      items: [{ kind: 'finding', id: 'F1', text: 'gap', accepted: false, redirect: '→ rewrite it all' }],
      blockerAnswers: [],
      acks: [{ id: 'T1', text: 'I reviewed the trajectory and the open findings above' }],
      decision: 'veto',
    }
    const parsed = roundTrip(answers)
    expect(parsed.vetoes[0]?.redirect).toBe('rewrite it all')
  })

  it('a redirect that flattens to nothing is no redirect at all', () => {
    const answers: GateAnswers = {
      items: [{ kind: 'finding', id: 'F1', text: 'gap', accepted: false, redirect: '   \n\t ' }],
      blockerAnswers: [],
      acks: [{ id: 'T1', text: 'I reviewed the trajectory and the open findings above' }],
      decision: 'veto',
    }
    const parsed = roundTrip(answers)
    expect(parsed.vetoes[0]).toEqual({ id: 'F1' })
  })
})
