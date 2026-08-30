// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { ChangeDigest } from '../../sdd-runner/src/gate-digest-extract.js'
import { parseGateResponse, writeGateDigest } from '../../sdd-runner/src/gate-model.js'
import type { GateAssumption, GateBlocker, GateFinding } from '../../sdd-runner/src/gate-model.js'
import { detectHandEdits, recordArtifactHashes } from '../../sdd-runner/src/gate.js'
import type { DigestRecord } from '../../sdd-runner/src/replay.js'

const NULL_DIGEST: ChangeDigest = { what: null, why: null, touches: null, hasTasks: false }

const tmpDirs: string[] = []

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

function assumption(overrides: Partial<GateAssumption> = {}): GateAssumption {
  return { id: 'A1', text: 'guests stay read-only', blast_radius: 'group replies', ...overrides }
}

function blocker(overrides: Partial<GateBlocker> = {}): GateBlocker {
  return { id: 'B1', gap: 'no rollback path', evidence: 'searched design.md', ...overrides }
}

function finding(overrides: Partial<GateFinding> = {}): GateFinding {
  return { id: 'F1', gap: 'design lacks rollback', evidence: 'edited — gap narrowed', ...overrides }
}

describe('recordArtifactHashes + detectHandEdits', () => {
  it('hashes agent-authored files and flags only changed ones on resume', () => {
    const before = { 'proposal.md': 'h1', 'design.md': 'h2', 'specs/x/spec.md': 'h3', 'tasks.md': 'h4' }
    const unchanged = { ...before }
    expect(detectHandEdits(before, unchanged)).toEqual([])
    const edited = { ...before, 'design.md': 'h-changed', 'specs/x/spec.md': 'h-new' }
    expect(detectHandEdits(before, edited).sort()).toEqual(['design.md', 'specs/x/spec.md'])
  })

  it('records hashes as sha256 hex of file content', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-h-'))
    tmpDirs.push(tmp)
    fs.writeFileSync(path.join(tmp, 'proposal.md'), 'hello')
    const hashes = await recordArtifactHashes(tmp, ['proposal.md'])
    expect(hashes['proposal.md']).toMatch(/^[0-9a-f]{64}$/u)
  })
})

describe('writeGateDigest', () => {
  it('renders a final digest with blast-ranked assumption checkboxes and the resume command', () => {
    const md = writeGateDigest({
      version: 1,
      mode: 'final',
      changeName: 'add-thing',
      runId: 'run-1',
      assumptions: [assumption({ id: 'A2', blast_radius: 'whole bot' }), assumption()],
      blockers: [],
      openMaterial: [],
      openNitpicks: [],
      trajectory: [],
      capHitFired: false,
      summary: 'add a thing',
      costUsd: 0.42,
      costKnown: true,
      durationMs: 120_000,
      changeDigest: NULL_DIGEST,
    })
    expect(md).toContain('gate-1.md')
    expect(md).toContain('Final gate')
    expect(md.indexOf('whole bot')).toBeLessThan(md.indexOf('group replies'))
    expect(md).toContain('- [ ] A2')
    expect(md).toContain('- [ ] A1')
    expect(md).toContain('sdd run-1')
  })

  it('renders an early cap-hit digest focused on the open blockers with answer slots', () => {
    const md = writeGateDigest({
      version: 1,
      mode: 'early',
      changeName: 'add-thing',
      runId: 'run-1',
      assumptions: [assumption()],
      blockers: [blocker()],
      openMaterial: [],
      openNitpicks: [],
      trajectory: [],
      capHitFired: false,
      summary: 'add a thing',
      costUsd: 0.1,
      costKnown: true,
      durationMs: 60_000,
      changeDigest: NULL_DIGEST,
    })
    expect(md).toContain('Early gate')
    expect(md).toContain('B1')
    expect(md).toContain('no rollback path')
  })

  it('renders a trajectory block and open MATERIAL findings when mode is early and openMaterial is non-empty', () => {
    const trajectory: readonly DigestRecord[] = [
      { round: 1, counts: { blocker: 0, material: 2, nitpick: 0 }, resolved: 1, dismissed: 0, verdict: 'open' },
      { round: 2, counts: { blocker: 0, material: 1, nitpick: 0 }, resolved: 1, dismissed: 0, verdict: 'open' },
    ]
    const md = writeGateDigest({
      version: 1,
      mode: 'early',
      changeName: 'add-thing',
      runId: 'run-1',
      assumptions: [],
      blockers: [],
      openMaterial: [{ id: 'F1', gap: 'F1', evidence: 'edited — gap narrowed' }],
      openNitpicks: [],
      trajectory,
      capHitFired: true,
      summary: 'add a thing',
      costUsd: 0.1,
      costKnown: true,
      durationMs: 60_000,
      changeDigest: NULL_DIGEST,
    })
    expect(md).toContain('### Cap-hit trajectory')
    expect(md).toContain('round 1: 0b 2m 0n · 1 resolved · 0 dismissed · open')
    expect(md).toContain('round 2: 0b 1m 0n · 1 resolved · 0 dismissed · open')
    expect(md).toContain('- [ ] F1')
    expect(md).toContain('resolver: edited — gap narrowed')
  })

  it('renders surviving nitpicks as informational entries at the final gate', () => {
    const md = writeGateDigest({
      version: 1,
      mode: 'final',
      changeName: 'add-thing',
      runId: 'run-1',
      assumptions: [],
      blockers: [],
      openMaterial: [],
      openNitpicks: [
        { id: 'F1', gap: 'F1', evidence: 'edited — typo fixed' },
        { id: 'F2', gap: 'F2', evidence: 'dismissed — answered in design' },
      ],
      trajectory: [],
      capHitFired: false,
      summary: 'add a thing',
      costUsd: 0.42,
      costKnown: true,
      durationMs: 120_000,
      changeDigest: NULL_DIGEST,
    })
    expect(md).toContain('### Nitpicks (informational)')
    expect(md).toContain('F1')
    expect(md).toContain('resolver: edited — typo fixed')
    expect(md).toContain('F2')
    expect(md).toContain('resolver: dismissed — answered in design')
    expect(md).not.toContain('- [ ] F1')
  })
})

describe('parseGateResponse', () => {
  const expected = {
    assumptions: [assumption(), assumption({ id: 'A2' })],
    blockers: [blocker()],
  }

  it('approves when every assumption box is checked and there are no open blockers', () => {
    const md = '## Gate\n\n- [x] A1\n- [x] A2\n'
    const response = parseGateResponse(md, { ...expected, blockers: [] })
    expect(response).toMatchObject({ approved: true, abort: false, vetoes: [], answers: [] })
  })

  it('records a veto with redirect when an assumption box is left unchecked', () => {
    const md = '## Gate\n\n- [ ] A1\n→ suppress autonomous replies only\n- [x] A2\n'
    const response = parseGateResponse(md, expected)
    expect(response.approved).toBe(false)
    expect(response.vetoes).toEqual([{ id: 'A1', redirect: 'suppress autonomous replies only' }])
  })

  it('records a blocker answer from a → line under the blocker', () => {
    const md = '## Gate\n\n- [x] A1\n- [x] A2\n\nB1 no rollback path\n→ ship without rollback; track in a follow-up\n'
    const response = parseGateResponse(md, expected)
    expect(response.answers).toEqual([{ id: 'B1', answer: 'ship without rollback; track in a follow-up' }])
  })

  it('a → answer binds only to a blocker line anchored at line start, including indented blocker lines', () => {
    expect(() => parseGateResponse('## Gate\n\n- [x] A1\n- [x] A2\nnote B1 gap\n→ ship it\n', expected)).toThrow(
      /no preceding/u,
    )
    const indented = parseGateResponse(
      '## Gate\n\n- [x] A1\n- [x] A2\n   B12 no rollback path\n→ ship without rollback\n',
      { assumptions: [assumption(), assumption({ id: 'A2' })], blockers: [blocker({ id: 'B12' })] },
    )
    expect(indented.answers).toEqual([{ id: 'B12', answer: 'ship without rollback' }])
  })

  it('approves with an explicit OVERRIDE marker under an open blocker', () => {
    const md = '## Gate\n\n- [x] A1\n- [x] A2\n\nB1 no rollback path\n→ OVERRIDE\n'
    const response = parseGateResponse(md, expected)
    expect(response.approved).toBe(true)
    expect(response.override).toBe(true)
  })

  it('fails a bare approve with open blockers naming the entry, leaving state unchanged', () => {
    const md = '## Gate\n\n- [x] A1\n- [x] A2\n'
    expect(() => parseGateResponse(md, expected)).toThrow(/B1/u)
  })

  it('rejects an ambiguous mark naming the offending line', () => {
    const md = '## Gate\n\n- [~] A1\n- [x] A2\n'
    expect(() => parseGateResponse(md, expected)).toThrow('gate response line 3')
  })

  it('parses ack, finding, and redirect lines with padded or indented spacing', () => {
    const padded = parseGateResponse('## Gate\n\n- [x]  T1 reviewed\n- [x]  F1 design lacks rollback\n', {
      assumptions: [],
      blockers: [],
      findings: [finding()],
      requiredAck: 'T1',
    })
    expect(padded.approved).toBe(true)
    const indented = parseGateResponse('## Gate\n\n   - [x] T1 reviewed\n   - [x] F1 design lacks rollback\n', {
      assumptions: [],
      blockers: [],
      findings: [finding()],
      requiredAck: 'T1',
    })
    expect(indented.approved).toBe(true)
    const paddedRedirect = parseGateResponse('## Gate\n\n- [ ] A1\n→  narrow it\n', { ...expected, blockers: [] })
    expect(paddedRedirect.vetoes).toEqual([{ id: 'A1', redirect: 'narrow it' }])
  })

  it('a mid-line ABORT mention is not an abort marker', () => {
    const md = '## Gate\n\n- [ ] A1\nnever ABORT\n'
    const response = parseGateResponse(md, expected)
    expect(response.abort).toBe(false)
    expect(response.vetoes).toEqual([{ id: 'A1' }])
  })

  it('aborts on an explicit abort marker', () => {
    const md = '## Gate\n\nABORT\n'
    const response = parseGateResponse(md, expected)
    expect(response.abort).toBe(true)
  })

  it('rejects a cap-hit early gate without the trajectory-reviewed ack naming T1', () => {
    const md = '## Gate\n\n- [ ] T1 I reviewed the trajectory and the open findings above\n'
    expect(() => parseGateResponse(md, { assumptions: [], blockers: [], requiredAck: 'T1' })).toThrow(/T1/u)
  })

  it('approves a cap-hit early gate when the T1 ack is checked and no assumptions or blockers are open', () => {
    const md = '## Gate\n\n- [x] T1 I reviewed the trajectory and the open findings above\n'
    const response = parseGateResponse(md, { assumptions: [], blockers: [], requiredAck: 'T1' })
    expect(response.approved).toBe(true)
  })

  it('leaves the protocol unchanged when no requiredAck is set (final mode or blockers open)', () => {
    const md = '## Gate\n\n- [x] A1\n- [x] A2\n'
    const response = parseGateResponse(md, { ...expected, blockers: [] })
    expect(response.approved).toBe(true)
  })

  it('records a veto when an open-MATERIAL-finding box is left unchecked', () => {
    const md = '## Gate\n\n- [x] T1 reviewed\n- [ ] F1 design lacks rollback\n'
    const response = parseGateResponse(md, {
      assumptions: [],
      blockers: [],
      findings: [finding()],
      requiredAck: 'T1',
    })
    expect(response.approved).toBe(false)
    expect(response.vetoes).toEqual([{ id: 'F1' }])
  })

  it('attaches a redirect when a → line follows an unchecked finding box', () => {
    const md = '## Gate\n\n- [x] T1 reviewed\n- [ ] F1 design lacks rollback\n→ restructure around a helper\n'
    const response = parseGateResponse(md, {
      assumptions: [],
      blockers: [],
      findings: [finding()],
      requiredAck: 'T1',
    })
    expect(response.vetoes).toEqual([{ id: 'F1', redirect: 'restructure around a helper' }])
  })

  it('approves when every open-MATERIAL-finding box is checked alongside T1', () => {
    const md = '## Gate\n\n- [x] T1 reviewed\n- [x] F1 design lacks rollback\n'
    const response = parseGateResponse(md, {
      assumptions: [],
      blockers: [],
      findings: [finding()],
      requiredAck: 'T1',
    })
    expect(response.approved).toBe(true)
  })

  it('strips the appended auto-decision preview block — its noise boxes never vote', () => {
    const md = [
      '## Gate',
      '',
      '- [x] A1',
      '- [x] A2',
      '',
      '### Auto-decision preview',
      '',
      '> rule: none',
      '> decision: gate',
      '',
      '- [ ] A1 preview noise that must not vote',
    ].join('\n')
    const response = parseGateResponse(md, { ...expected, blockers: [] })
    expect(response.approved).toBe(true)
    expect(response.vetoes).toEqual([])
  })

  it('only a standalone preview header starts the stripped section, not an inline mention', () => {
    const md = ['## Gate', '', '- [ ] A1', 'see ### Auto-decision preview below', '- [x] A2'].join('\n')
    const response = parseGateResponse(md, expected)
    expect(response.approved).toBe(false)
    expect(response.vetoes).toEqual([{ id: 'A1' }])
  })

  it('a → RUN 1 MORE directive marks extend, tolerating padded spacing', () => {
    const canonical = parseGateResponse('## Gate\n\n→ RUN 1 MORE\n', {
      assumptions: [],
      blockers: [],
      gateMode: 'early',
    })
    expect(canonical.extend).toBe(true)
    const padded = parseGateResponse('## Gate\n\n→  RUN 1 MORE\n', { assumptions: [], blockers: [], gateMode: 'early' })
    expect(padded.extend).toBe(true)
  })

  it('a run-like arrow with extra words is rejected, not parsed as a redirect', () => {
    const md = '## Gate\n\n- [ ] A1\n→ RUN 1 MORE rounds after this one\n'
    expect(() => parseGateResponse(md, { ...expected, gateMode: 'early' })).toThrow(/not recognized/u)
  })

  it('decided-by annotations never create vetoes or answers', () => {
    const md = ['## Gate', '', '- [x] A1 · decided-by: policy R3', '- [x] A2', 'decided-by: policy R1'].join('\n')
    const response = parseGateResponse(md, { ...expected, blockers: [] })
    expect(response.approved).toBe(true)
    expect(response.vetoes).toEqual([])
    expect(response.answers).toEqual([])
  })
})

describe('parseGateResponse routes boxes by expected-content membership', () => {
  // Real-world poisoning: a stale resolver sidecar carried finding F4 inside
  // the assumptions array, so the view rendered an assumption item with an
  // F-prefixed id and the approve self-check crashed on "unknown finding F4".
  const mismatched = {
    assumptions: [{ id: 'F4', text: 'Plan-gate veto rounds are unbounded', blast_radius: '' }],
    blockers: [],
    findings: [finding({ id: 'F13' }), finding({ id: 'F14' }), finding({ id: 'F15' })],
    gateMode: 'final',
  } as const

  it('approves when every declared box is checked regardless of id-prefix/kind mismatch', () => {
    const md =
      '## Gate response\n\n- [x] F13 F13\n- [x] F14 F14\n- [x] F15 F15\n- [x] F4 Plan-gate veto rounds are unbounded\n'
    expect(parseGateResponse(md, mismatched)).toMatchObject({ approved: true, vetoes: [], answers: [] })
  })

  it('records a veto with redirect for an unchecked mismatched box', () => {
    const md =
      '## Gate response\n\n- [x] F13 F13\n- [x] F14 F14\n- [x] F15 F15\n- [ ] F4 Plan-gate veto rounds are unbounded\n→ cap veto rounds at three\n'
    const response = parseGateResponse(md, mismatched)
    expect(response.approved).toBe(false)
    expect(response.vetoes).toEqual([{ id: 'F4', redirect: 'cap veto rounds at three' }])
  })

  it('still rejects ids declared nowhere, labeled by their prefix', () => {
    expect(() =>
      parseGateResponse('## Gate response\n\n- [x] A9 never declared\n', { assumptions: [], blockers: [] }),
    ).toThrow(/unknown assumption A9/u)
    expect(() =>
      parseGateResponse('## Gate response\n\n- [x] F99 never declared\n', { assumptions: [], blockers: [] }),
    ).toThrow(/unknown finding F99/u)
  })
})

describe('parseGateResponse → RUN 1 MORE (extend directive)', () => {
  it('produces extend: true at an early gate when → RUN 1 MORE appears on its own line', () => {
    const md = '## Early gate\n\n→ RUN 1 MORE\n'
    const response = parseGateResponse(md, { assumptions: [], blockers: [], gateMode: 'early' })
    expect(response.extend).toBe(true)
    expect(response.approved).toBe(false)
  })

  it('throws at a final gate naming the line and explaining extend is cap-hit-only', () => {
    const md = '## Final gate\n\n→ RUN 1 MORE\n'
    expect(() => parseGateResponse(md, { assumptions: [], blockers: [], gateMode: 'final' })).toThrow(
      /RUN 1 MORE.*final gate.*cap-hit/u,
    )
  })

  it('rejects → RUN 2 MORE, → RUN MORE, and → RUN 1 MORE x with an error naming the line', () => {
    const invalid = ['→ RUN 2 MORE', '→ RUN MORE', '→ RUN 1 MORE x']
    for (const line of invalid) {
      const md = `## Early gate\n\n${line}\n`
      expect(() => parseGateResponse(md, { assumptions: [], blockers: [], gateMode: 'early' })).toThrow(/line/u)
    }
  })

  it('accepts an indented and trailing-space → RUN 1 MORE line', () => {
    const md = '## Early gate\n\n  → RUN 1 MORE  \n'
    expect(parseGateResponse(md, { assumptions: [], blockers: [], gateMode: 'early' }).extend).toBe(true)
  })

  it('a RUN-like payload after a blocker throws rather than becoming an answer', () => {
    const md = '## Final gate\n\nB1 no rollback\n→ RUN something else\n'
    expect(() => parseGateResponse(md, { assumptions: [], blockers: [blocker()], gateMode: 'final' })).toThrow(
      /RUN directive not recognized/u,
    )
  })

  it('ignores a mid-line marker like x → RUN 1 MORE instead of extending', () => {
    const md = '## Early gate\n\nx → RUN 1 MORE\n'
    const response = parseGateResponse(md, { assumptions: [], blockers: [], gateMode: 'early' })
    expect(response.extend).toBe(false)
    expect(response.approved).toBe(true)
  })
})

describe('decided-by suffix recognition (D4)', () => {
  it('strips a decided-by suffix from an answered checkbox before comparison', () => {
    const md = '## Gate response\n\n- [x] A1 guests stay read-only · decided-by: policy R1\n'
    const response = parseGateResponse(md, { assumptions: [assumption()], blockers: [], gateMode: 'final' })
    expect(response.approved).toBe(true)
  })

  it('recognizes a decision-level decided-by line without treating it as an answer channel', () => {
    const md = ['## Gate response', '', 'decided-by: policy R1', '', '- [x] A1 guests stay read-only', ''].join('\n')
    const response = parseGateResponse(md, { assumptions: [assumption()], blockers: [], gateMode: 'final' })
    expect(response.approved).toBe(true)
  })
})

describe('Auto-decision preview strip (D3 step 3)', () => {
  it('strips the preview section before processing so a hand-mangled preview cannot become gate input', () => {
    const md = [
      '## Gate response',
      '',
      '- [x] A1 guests stay read-only',
      '',
      '### Auto-decision preview',
      '',
      '> rule R1 would approve',
      'ABORT',
      '- [ ] A2 something else',
      '→ RUN 1 MORE',
      '',
      '## After preview',
      '',
      'nothing structural',
    ].join('\n')
    const response = parseGateResponse(md, {
      assumptions: [assumption()],
      blockers: [],
      gateMode: 'final',
    })
    expect(response.abort).toBe(false)
    expect(response.extend).toBe(false)
    expect(response.approved).toBe(true)
  })

  it('strips a trailing preview section that runs to EOF', () => {
    const md = [
      '## Gate response',
      '',
      '- [x] A1 guests stay read-only',
      '',
      '### Auto-decision preview',
      '',
      'ABORT',
    ].join('\n')
    const response = parseGateResponse(md, { assumptions: [assumption()], blockers: [], gateMode: 'final' })
    expect(response.abort).toBe(false)
    expect(response.approved).toBe(true)
  })

  it('leaves files without a preview section untouched', () => {
    const md = 'ABORT\n'
    expect(parseGateResponse(md, { assumptions: [], blockers: [], gateMode: 'final' }).abort).toBe(true)
  })
})

describe('parseGateResponse shape and anchor hardening', () => {
  it('ABORT is recognized only on its own line, indented or not', () => {
    expect(parseGateResponse('ABORT', { assumptions: [], blockers: [] }).abort).toBe(true)
    expect(parseGateResponse('  ABORT  ', { assumptions: [], blockers: [] }).abort).toBe(true)
    expect(parseGateResponse('we ABORT now', { assumptions: [], blockers: [] }).abort).toBe(false)
    expect(parseGateResponse('ABORTED', { assumptions: [], blockers: [] }).abort).toBe(false)
  })

  it('accepts multi-digit assumption, blocker, and finding ids', () => {
    const md = '## Gate\n\n- [x] A12\n- [ ] F34\n→ narrow it\nB56 gap\n→ OVERRIDE\n'
    const response = parseGateResponse(md, {
      assumptions: [assumption({ id: 'A12' })],
      blockers: [blocker({ id: 'B56' })],
      findings: [finding({ id: 'F34' })],
    })
    expect(response.approved).toBe(false)
    expect(response.override).toBe(true)
    expect(response.vetoes).toEqual([{ id: 'F34', redirect: 'narrow it' }])
    expect(response.answers).toEqual([])
  })

  it('accepts an uppercase X as a checked box but rejects ambiguous marks', () => {
    const upper = parseGateResponse('## Gate\n\n- [X] A1\n', { assumptions: [assumption()], blockers: [] })
    expect(upper.approved).toBe(true)
    expect(() => parseGateResponse('## Gate\n\n- [x ] A1\n', { assumptions: [assumption()], blockers: [] })).toThrow(
      /ambiguous/u,
    )
  })

  it('single-digit boxes do not capture multi-digit neighbours (F1 must not match F12)', () => {
    expect(() =>
      parseGateResponse('## Gate\n\n- [x] F1\n', {
        assumptions: [],
        blockers: [],
        findings: [finding({ id: 'F12' })],
      }),
    ).toThrow(/unknown finding F1/u)
  })

  it('a decided-by suffix with tight or wide spacing is stripped from checkbox lines', () => {
    const tight = parseGateResponse('## Gate\n\n- [x] A1·decided-by:policy R1\n', {
      assumptions: [assumption()],
      blockers: [],
    })
    expect(tight.approved).toBe(true)
    const wide = parseGateResponse('## Gate\n\n- [x] A1  ·  decided-by: policy R1\n', {
      assumptions: [assumption()],
      blockers: [],
    })
    expect(wide.approved).toBe(true)
  })

  it('a decided-by suffix is not stripped from the middle of a veto redirect payload', () => {
    const response = parseGateResponse('## Gate\n\n- [ ] A1\n→ decided-by: keep this payload\n', {
      assumptions: [assumption()],
      blockers: [],
    })
    expect(response.vetoes).toEqual([{ id: 'A1', redirect: 'decided-by: keep this payload' }])
  })

  it('an unchecked box without a following redirect records a bare veto', () => {
    const response = parseGateResponse('## Gate\n\n- [ ] A1\n', { assumptions: [assumption()], blockers: [] })
    expect(response.vetoes).toEqual([{ id: 'A1' }])
    expect(response.approved).toBe(false)
  })

  it('a redirect after a non-veto line errors: prose resets the pending redirect', () => {
    const md = '## Gate\n\n- [ ] A1\n→ first redirect\nprose line\n→ second redirect\n'
    expect(() => parseGateResponse(md, { assumptions: [assumption()], blockers: [] })).toThrow(
      /no preceding assumption or blocker/u,
    )
  })

  it('a redirect only attaches to the immediately preceding unchecked box, not an earlier one', () => {
    const md = '## Gate\n\n- [ ] A1\n- [ ] A2\n→ only for A2\n'
    const response = parseGateResponse(md, {
      assumptions: [assumption({ id: 'A1' }), assumption({ id: 'A2' })],
      blockers: [],
    })
    expect(response.vetoes).toEqual([{ id: 'A1' }, { id: 'A2', redirect: 'only for A2' }])
  })

  it('rejects a redirect line with no preceding assumption or blocker', () => {
    expect(() => parseGateResponse('## Gate\n\n→ free-floating payload\n', { assumptions: [], blockers: [] })).toThrow(
      /no preceding assumption or blocker/u,
    )
  })

  it('an indented arrow line is still an answer channel', () => {
    const response = parseGateResponse('## Gate\n\nB1 gap\n  → indented answer\n', {
      assumptions: [],
      blockers: [blocker()],
    })
    expect(response.answers).toEqual([{ id: 'B1', answer: 'indented answer' }])
  })

  it('an approved-with-veto is not approved but keeps the vetoes', () => {
    const response = parseGateResponse('## Gate\n\n- [ ] A1\n', { assumptions: [assumption()], blockers: [] })
    expect(response.approved).toBe(false)
    expect(response.abort).toBe(false)
    expect(response.override).toBe(false)
    expect(response.extend).toBe(false)
  })

  it('OVERRIDE only clears blockers, never assumptions: an unchecked assumption still vetoes', () => {
    const md = '## Gate\n\n- [ ] A1\nB1 gap\n→ OVERRIDE\n'
    const response = parseGateResponse(md, { assumptions: [assumption()], blockers: [blocker()] })
    expect(response.override).toBe(true)
    expect(response.approved).toBe(false)
    expect(response.vetoes).toEqual([{ id: 'A1' }])
  })

  it('a checked box followed by a redirect payload is not a veto: the redirect errors out', () => {
    expect(() =>
      parseGateResponse('## Gate\n\n- [x] A1\n→ stray payload\n', {
        assumptions: [assumption()],
        blockers: [],
      }),
    ).toThrow(/no preceding assumption or blocker/u)
  })
})

describe('parseGateResponse plan-mode child rows (D4)', () => {
  const planExpected = {
    assumptions: [],
    blockers: [],
    children: [
      { id: 'C1', text: 'auth-db — Add the auth database schema.' },
      { id: 'C2', text: 'auth-api — Add the auth API endpoints.' },
    ],
    gateMode: 'plan',
  } as const

  it('approves when every C-box is checked', () => {
    const md =
      '## Plan gate\n\n- [x] C1 auth-db — Add the auth database schema.\n- [x] C2 auth-api — Add the auth API endpoints.\n'
    const response = parseGateResponse(md, planExpected)
    expect(response).toMatchObject({ approved: true, abort: false, vetoes: [], answers: [] })
  })

  it('an unchecked C-box vetoes that child with an optional → redirect beneath', () => {
    const md = [
      '## Plan gate',
      '',
      '- [x] C1 auth-db — Add the auth database schema.',
      '- [ ] C2 auth-api — Add the auth API endpoints.',
      '→ split the API child into auth + sessions',
      '',
    ].join('\n')
    const response = parseGateResponse(md, planExpected)
    expect(response.approved).toBe(false)
    expect(response.vetoes).toEqual([{ id: 'C2', redirect: 'split the API child into auth + sessions' }])
  })

  it('an unchecked C-box without a redirect records a bare veto', () => {
    const md = '## Plan gate\n\n- [ ] C1 auth-db\n- [x] C2 auth-api\n'
    const response = parseGateResponse(md, planExpected)
    expect(response.vetoes).toEqual([{ id: 'C1' }])
    expect(response.approved).toBe(false)
  })

  it('absent C-rows never approve: a gate file with the Children section deleted fails closed', () => {
    const md = '## Plan gate\n\n(no checkbox rows survive a truncated write)\n'
    const response = parseGateResponse(md, planExpected)
    expect(response.approved).toBe(false)
    expect(response.vetoes).toEqual([])
  })

  it('a partially deleted Children section (one row missing) does not approve', () => {
    const md = '## Plan gate\n\n- [x] C1 auth-db — Add the auth database schema.\n'
    const response = parseGateResponse(md, planExpected)
    expect(response.approved).toBe(false)
  })

  it('ABORT aborts at plan mode', () => {
    const response = parseGateResponse('## Plan gate\n\nABORT\n', planExpected)
    expect(response.abort).toBe(true)
  })

  it('rejects → RUN 1 MORE at plan mode with the cap-hit-only message', () => {
    expect(() => parseGateResponse('## Plan gate\n\n→ RUN 1 MORE\n', planExpected)).toThrow(
      /RUN 1 MORE.*plan gate.*cap-hit/u,
    )
  })

  it('routes by declared-id membership: an undeclared C-id is rejected as an unknown child', () => {
    const md = '## Plan gate\n\n- [x] C1 auth-db\n- [x] C2 auth-api\n- [x] C3 never declared\n'
    expect(() => parseGateResponse(md, planExpected)).toThrow(/unknown child C3/u)
  })

  it('prefix alone never routes: a C-row against single-run expected content is an unknown child', () => {
    expect(() => parseGateResponse('## Gate\n\n- [x] C1 some child\n', { assumptions: [], blockers: [] })).toThrow(
      /unknown child C1/u,
    )
  })

  it('single-run gates parse byte-identically with children absent', () => {
    const md = '## Gate\n\n- [x] A1\n- [x] A2\n'
    const response = parseGateResponse(md, {
      assumptions: [assumption(), assumption({ id: 'A2' })],
      blockers: [],
    })
    expect(response.approved).toBe(true)
  })
})

describe('Auto-decision preview strip — anchor hardening', () => {
  it('a preview-like string inside a longer heading is not a preview boundary', () => {
    const md = ['### Not a preview: Auto-decision preview extra', '', '- [ ] A1', ''].join('\n')
    const response = parseGateResponse(md, { assumptions: [assumption()], blockers: [] })
    expect(response.approved).toBe(false)
  })

  it('strips a preview section that ends at a following ## header, keeping that header', () => {
    const md = [
      '- [x] A1',
      '',
      '### Auto-decision preview',
      'mangled - [ ] A1',
      '',
      '## After preview',
      '- [x] A1',
      '',
    ].join('\n')
    const response = parseGateResponse(md, { assumptions: [assumption()], blockers: [] })
    expect(response.approved).toBe(true)
    expect(md).toContain('## After preview')
  })

  it('an indented ### header terminates the preview section', () => {
    const md = ['### Auto-decision preview', 'mangled', '', '  ### Indented next', '- [x] A1', ''].join('\n')
    const response = parseGateResponse(md, { assumptions: [assumption()], blockers: [] })
    expect(response.approved).toBe(true)
  })

  it('a mid-document ### header other than the preview header also bounds it', () => {
    const md = ['### Auto-decision preview', 'mangled', '', '### Other section', '- [x] A1', ''].join('\n')
    const response = parseGateResponse(md, { assumptions: [assumption()], blockers: [] })
    expect(response.approved).toBe(true)
  })
})
