// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import {
  decisionConsequences,
  formatTrajectorySparkline,
  renderChangeDigest,
  renderDecisions,
  writeGateDigest,
} from '../../sdd-runner/src/gate-render.js'
import type { GateDigestInput } from '../../sdd-runner/src/gate-render.js'

const decisionBase: Omit<GateDigestInput, 'mode' | 'capHitFired'> = {
  version: 1,
  changeName: 'add-thing',
  runId: 'run-1',
  assumptions: [],
  blockers: [],
  openMaterial: [],
  openNitpicks: [],
  trajectory: [],
  summary: 'add a thing',
  costUsd: 0,
  costKnown: false,
  durationMs: 0,
  changeDigest: { what: null, why: null, touches: null, hasTasks: false },
}

describe('gate-render module surface', () => {
  it('renderChangeDigest returns the 5-tuple with placeholders for null fields', () => {
    const lines = renderChangeDigest({ what: null, why: null, touches: null, hasTasks: false }, 'final', false)
    expect(lines).toContain('### Change digest')
    expect(lines.some((l) => l.startsWith('- **WHAT**:'))).toBe(true)
  })

  it('writeGateDigest produces a gate MD with a version marker and resume command', () => {
    const md = writeGateDigest({
      version: 1,
      mode: 'final',
      changeName: 'add-thing',
      runId: 'run-1',
      assumptions: [],
      blockers: [],
      openMaterial: [],
      openNitpicks: [],
      trajectory: [],
      capHitFired: false,
      summary: 'add a thing',
      costUsd: 0,
      costKnown: false,
      durationMs: 0,
      changeDigest: { what: null, why: null, touches: null, hasTasks: false },
    })
    expect(md).toContain('<!-- gate-1.md -->')
    expect(md).toContain('sdd run-1')
  })

  it('early gate states that approving continues to decomposition, atomicity, and a final gate (task 4.1)', () => {
    const md = writeGateDigest({ ...decisionBase, mode: 'early', capHitFired: true })
    expect(md).toContain('### Decisions')
    expect(md).toMatch(/approve.*continues.*decompos/u)
    expect(md).toMatch(/atomicity/u)
    expect(md).toMatch(/final gate/u)
  })

  it('early gate states that extending runs one more review round (task 4.1)', () => {
    const md = writeGateDigest({ ...decisionBase, mode: 'early', capHitFired: true })
    expect(md).toContain('→ RUN 1 MORE')
    expect(md).toMatch(/runs one more review round/u)
  })

  it('final gate states that approving completes the run (task 4.1)', () => {
    const md = writeGateDigest({ ...decisionBase, mode: 'final', capHitFired: false })
    expect(md).toContain('### Decisions')
    expect(md).toMatch(/approve.*completes the run/u)
  })
})

describe('trajectory sparkline (13.5)', () => {
  it('renders one magnitude-encoding glyph per round beside the counts', () => {
    expect(formatTrajectorySparkline([3, 2, 0])).toBe('▇▅▁')
  })

  it('a single round and equal counts map to the lowest/matching glyphs deterministically', () => {
    expect(formatTrajectorySparkline([1])).toBe('▇')
    expect(formatTrajectorySparkline([5, 5])).toBe('▇▇')
    expect(formatTrajectorySparkline([])).toBe('')
  })

  it('all-zero totals render the lowest glyph, never divide by zero', () => {
    expect(formatTrajectorySparkline([0, 0, 0])).toBe('▁▁▁')
  })

  it('a middling total renders a middling glyph', () => {
    expect(formatTrajectorySparkline([4, 2, 0])).toBe('▇▄▁')
    expect(formatTrajectorySparkline([6, 3])).toBe('▇▄')
  })
})

describe('renderChangeDigest with populated fields', () => {
  it('renders the real what/why/touches and mode-aware risks target', () => {
    const lines = renderChangeDigest(
      { what: 'Adds a digest.', why: 'The slug is useless.', touches: ['src/a.ts', 'tests/a.test.ts'], hasTasks: true },
      'early',
      true,
    )
    expect(lines).toStrictEqual([
      '### Change digest',
      '',
      '- **WHAT**: Adds a digest.',
      '- **WHY**: The slug is useless.',
      '- **TOUCHES**: src/a.ts, tests/a.test.ts',
      '- **RISKS**: see "Open MATERIAL findings at cap" below',
      '- **BLAST**: see "Assumptions (blast-ranked)" below',
    ])
  })

  it('an empty touches array renders the no-impact placeholder', () => {
    const lines = renderChangeDigest({ what: 'w', why: 'y', touches: [], hasTasks: false }, 'final', false)
    expect(lines).toContain('- **TOUCHES**: _(no "Impact" section in proposal.md)_')
    expect(lines).toContain('- **RISKS**: see "Nitpicks (informational)" below')
    expect(lines).toContain('- **BLAST**: _(no assumptions logged)_')
  })
})

describe('decisionConsequences and renderDecisions (13.4)', () => {
  it('early mode names decompose-continue and offers extend; final mode names completion and no extend', () => {
    const early = renderDecisions('early')
    const final = renderDecisions('final')
    expect(early[0]).toBe('### Decisions')
    expect(early).toContain('- **approve** — continues to task decomposition, atomicity checking, and a final gate')
    expect(early.join('\n')).toContain(
      '- **extend** (`→ RUN 1 MORE`) — runs one more review round, then re-gates (early-gate only)',
    )
    expect(final).toContain('- **approve** — completes the run with the full artifact set')
    expect(final.join('\n')).not.toContain('**extend**')
    expect(early).toContain(
      '- **veto** (leave a box unchecked) — runs one resolver pass on the redirects, then re-gates',
    )
    expect(final).toContain(
      '- **abort** (`ABORT` on its own line) — ends the run without completing; the only early exit that spends nothing further',
    )
  })
})

describe('plan mode (D4)', () => {
  it('decisionConsequences(plan) pins approve/veto/extend/abort', () => {
    const c = decisionConsequences('plan')
    expect(c.approve).toBe('executes the children sequentially as nested runs in plan order')
    expect(c.veto).toBe('revises the plan once with the redirects, then re-gates')
    expect(c.extend).toBeNull()
    expect(c.abort).toBe('aborts the parent before any child runs')
  })

  it('renderDecisions(plan) renders the shared Decisions block with no extend line', () => {
    const lines = renderDecisions('plan')
    expect(lines[0]).toBe('### Decisions')
    expect(lines).toContain('- **approve** — executes the children sequentially as nested runs in plan order')
    expect(lines).toContain(
      '- **veto** (leave a box unchecked) — revises the plan once with the redirects, then re-gates',
    )
    expect(lines).toContain('- **abort** (`ABORT` on its own line) — aborts the parent before any child runs')
    expect(lines.join('\n')).not.toContain('**extend**')
  })

  it('writeGateDigest plan mode renders one checkbox row per child plus the shared Decisions block', () => {
    const md = writeGateDigest({
      ...decisionBase,
      mode: 'plan',
      capHitFired: false,
      children: [
        { id: 'C1', text: 'auth-db — Add the auth database schema. · deps: (none) · signals: drizzle schema' },
        { id: 'C2', text: 'auth-api — Add the auth API endpoints. · deps: auth-db · signals: routes' },
      ],
    })
    expect(md).toContain('<!-- gate-1.md -->')
    expect(md).toContain('## Plan gate')
    expect(md).toContain('- [ ] C1 auth-db — Add the auth database schema. · deps: (none) · signals: drizzle schema')
    expect(md).toContain('- [ ] C2 auth-api — Add the auth API endpoints. · deps: auth-db · signals: routes')
    expect(md).toContain('### Decisions')
    expect(md).toContain('sdd run-1')
    expect(md).not.toContain('### Assumptions')
    expect(md).not.toContain('### Change digest')
    expect(md).not.toContain('→ RUN 1 MORE')
  })

  it('early and final gate bytes stay pinned unchanged', () => {
    const early = writeGateDigest({ ...decisionBase, mode: 'early', capHitFired: true })
    expect(early).toContain('## Early gate (cap hit) — change add-thing')
    expect(early).toContain('### Assumptions (blast-ranked)')
    expect(early).toContain('### Change digest')
    const final = writeGateDigest({ ...decisionBase, mode: 'final', capHitFired: false })
    expect(final).toContain('## Final gate — change add-thing')
    expect(final).toContain(
      '- **abort** (`ABORT` on its own line) — ends the run without completing; the only early exit that spends nothing further',
    )
    expect(final).toContain(
      '- **veto** (leave a box unchecked) — runs one resolver pass on the redirects, then re-gates',
    )
  })
})
