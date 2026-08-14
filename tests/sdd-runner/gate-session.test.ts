// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { runGateSession, scriptedPrompter } from '../../sdd-runner/src/gate-session.js'
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

function makeDeps(
  answers: readonly string[],
  viewOverrides: Partial<GateSessionView> = {},
): {
  deps: Parameters<typeof runGateSession>[0]
  transcript: string[]
  written: string[]
} {
  const { prompter, transcript } = scriptedPrompter(answers)
  const written: string[] = []
  return {
    deps: {
      prompter,
      view: view(viewOverrides),
      writeGateMd: (md) => {
        written.push(md)
        return Promise.resolve()
      },
    },
    transcript,
    written,
  }
}

describe('runGateSession walkthrough', () => {
  it('covers every finding and assumption with accept/veto/inspect and records an inline redirect', async () => {
    const { deps, transcript, written } = makeDeps(['i', 'a', 'a', 'v', 'restructure around a helper', 'approve'])
    const result = await runGateSession(deps)
    expect(result.status).toBe('answered')
    expect(transcript.some((line) => /\? .*A1/u.test(line))).toBe(true)
    expect(transcript.some((line) => /\? .*A2/u.test(line))).toBe(true)
    expect(transcript.some((line) => /\? .*F1/u.test(line))).toBe(true)
    expect(written).toHaveLength(1)
    expect(written[0]).toContain('- [x] A1')
    expect(written[0]).toContain('- [x] A2')
    expect(written[0]).toContain('- [ ] F1')
    expect(written[0]).toContain('→ restructure around a helper')
  })

  it('inspect prints the item evidence and blast radius before re-asking', async () => {
    const { deps, transcript } = makeDeps(['i', 'a', 'a', 'a', 'approve'])
    await runGateSession(deps)
    const inspectIndex = transcript.findIndex((line) => line.includes('evidence:'))
    expect(inspectIndex).toBeGreaterThan(-1)
    expect(transcript.some((line) => line.includes('blast radius: group replies'))).toBe(true)
    const a1Prompt = transcript.findIndex((line) => line.includes('A1'))
    expect(inspectIndex).toBeGreaterThan(a1Prompt)
  })

  it('prompts a cap-hit blocker for a free-text answer or explicit override', async () => {
    const { deps, written } = makeDeps(['a', 'a', 'a', 'ship without rollback; track in a follow-up', 'approve'], {
      blockers: [{ id: 'B1', gap: 'no rollback path', evidence: 'searched design.md' }],
      gateMode: 'early',
    })
    const result = await runGateSession(deps)
    expect(result.status).toBe('answered')
    expect(written[0]).toContain('B1 no rollback path')
    expect(written[0]).toContain('→ ship without rollback; track in a follow-up')
  })

  it('records an explicit blocker OVERRIDE', async () => {
    const { deps, written } = makeDeps(['a', 'a', 'a', 'OVERRIDE', 'approve'], {
      blockers: [{ id: 'B1', gap: 'no rollback path', evidence: 'searched design.md' }],
      gateMode: 'early',
    })
    const result = await runGateSession(deps)
    expect(result.status).toBe('answered')
    expect(written[0]).toContain('→ OVERRIDE')
  })

  it('blocks approve until the trajectory ack is affirmed, and abandons cleanly on quit', async () => {
    const { deps, transcript, written } = makeDeps(['a', 'a', 'a', 'OVERRIDE', 'n', 'approve', 'q'], {
      blockers: [{ id: 'B1', gap: 'no rollback path', evidence: 'searched design.md' }],
      gateMode: 'early',
      requiredAck: { id: 'T1', text: ACK_TEXT },
    })
    const result = await runGateSession(deps)
    expect(result.status).toBe('abandoned')
    expect(transcript.some((line) => line.includes('T1'))).toBe(true)
    expect(written).toHaveLength(0)
  })

  it('blocks approve while any blocker is unanswered', async () => {
    const { deps, transcript, written } = makeDeps(['a', 'a', 'a', 'skip', 'y', 'approve', 'q'], {
      blockers: [{ id: 'B1', gap: 'no rollback path', evidence: 'searched design.md' }],
      gateMode: 'early',
      requiredAck: { id: 'T1', text: ACK_TEXT },
    })
    const result = await runGateSession(deps)
    expect(result.status).toBe('abandoned')
    expect(transcript.some((line) => line.includes('B1'))).toBe(true)
    expect(written).toHaveLength(0)
  })

  it('approves once T1 is affirmed and every blocker is answered, writing the ack box', async () => {
    const { deps, written } = makeDeps(['a', 'a', 'a', 'OVERRIDE', 'y', 'approve'], {
      blockers: [{ id: 'B1', gap: 'no rollback path', evidence: 'searched design.md' }],
      gateMode: 'early',
      requiredAck: { id: 'T1', text: ACK_TEXT },
    })
    const result = await runGateSession(deps)
    expect(result).toMatchObject({ status: 'answered', decision: 'approve' })
    expect(written[0]).toContain('- [x] T1')
    expect(written[0]).toContain('→ OVERRIDE')
  })

  it('abandons without writing when quit arrives before the final decision', async () => {
    const { deps, written } = makeDeps(['a', 'q'])
    const result = await runGateSession(deps)
    expect(result.status).toBe('abandoned')
    expect(written).toHaveLength(0)
  })

  it('abandons without writing when the prompter input is exhausted (EOF)', async () => {
    const { deps, written } = makeDeps([])
    const result = await runGateSession(deps)
    expect(result.status).toBe('abandoned')
    expect(written).toHaveLength(0)
  })

  it('offers extend at an early gate and writes the extend directive', async () => {
    const { deps, written } = makeDeps(['a', 'a', 'a', 'y', 'extend'], {
      gateMode: 'early',
      requiredAck: { id: 'T1', text: ACK_TEXT },
    })
    const result = await runGateSession(deps)
    expect(result).toMatchObject({ status: 'answered', decision: 'extend' })
    expect(written[0]).toContain('→ RUN 1 MORE')
  })

  it('rejects extend at a final gate and re-asks the decision', async () => {
    const { deps, transcript, written } = makeDeps(['a', 'a', 'a', 'extend', 'abort'])
    const result = await runGateSession(deps)
    expect(result).toMatchObject({ status: 'answered', decision: 'abort' })
    expect(written[0]).toContain('ABORT')
    expect(transcript.filter((line) => line.includes('Decision')).length).toBeGreaterThanOrEqual(2)
  })

  it('renders veto with no redirect when the redirect line is empty', async () => {
    const { deps, written } = makeDeps(['a', 'a', 'v', '', 'approve'])
    const result = await runGateSession(deps)
    expect(result).toMatchObject({ status: 'answered', decision: 'approve' })
    expect(written[0]).toContain('- [ ] F1')
    expect(written[0]).not.toContain('→\n')
  })
})
