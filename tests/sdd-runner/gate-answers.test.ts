// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import type { GateAnswers } from '../../sdd-runner/src/gate-answers.js'
import { renderGateAnswers, responseFromAnswers } from '../../sdd-runner/src/gate-answers.js'
import type { GateAssumption, GateBlocker, GateFinding } from '../../sdd-runner/src/gate-model.js'
import { parseGateResponse } from '../../sdd-runner/src/gate-model.js'

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
