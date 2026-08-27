// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { carriesDecision, looksAnswered, planGateCarriesDecision } from '../../sdd-runner/src/gate-answered.js'

/** Presented-digest shape: every C-box unchecked, `→`/`ABORT` mentioned in prose only. */
const FRESH_PLAN_GATE = [
  '## Plan gate — change composite',
  '',
  'Check every child box to approve the plan. Leave a child box unchecked to veto that child (`→ <redirect>` beneath steers the replan; vetoing every child needs at least one `→` line or `ABORT` — an all-unchecked file reads as no decision).',
  'Write `ABORT` on its own line to abort.',
  '',
  '### Decisions',
  '',
  '- **approve** — executes the children sequentially as nested runs in plan order',
  '- **veto** (leave a box unchecked) — revises the plan once with the redirects, then re-gates',
  '- **abort** (`ABORT` on its own line) — aborts the parent before any child runs',
  '',
  '### Children (topo order)',
  '',
  '- [ ] C1 db-schema — Rename the schema columns.',
  '- [ ] C2 db-api — Rename the API route helpers. · deps: db-schema',
  '',
].join('\n')

/** Fresh early-gate render: placeholder `→ <answer or OVERRIDE>` lines beneath cap-hit blockers. */
const FRESH_EARLY_GATE = [
  '## Early gate (cap hit) — change composite',
  '',
  '### Cap-hit blockers (answer or override)',
  '',
  'B1 schema drift',
  'evidence: gate-render.ts',
  '→ <answer or OVERRIDE>',
  '',
].join('\n')

describe('looksAnswered', () => {
  it('detects a checked box or an answer section', () => {
    expect(looksAnswered('- [x] A1 ok')).toBe(true)
    expect(looksAnswered('- [x] T1 reviewed')).toBe(true)
    expect(looksAnswered('- [x] C1 db-schema — Rename the schema columns.')).toBe(true)
    expect(looksAnswered('## Gate response\n')).toBe(true)
    expect(looksAnswered('- [ ] A1 unresolved')).toBe(false)
  })
})

describe('planGateCarriesDecision', () => {
  it('recognizes the blessed full-veto and ABORT forms looksAnswered misses', () => {
    expect(planGateCarriesDecision('- [ ] C1 db-schema — Rename the schema columns.\n→ split the schema child')).toBe(
      true,
    )
    expect(planGateCarriesDecision('- [ ] C1 db-schema — Rename the schema columns.\nABORT')).toBe(true)
    expect(planGateCarriesDecision('- [x] C1 db-schema — Rename the schema columns.')).toBe(true)
  })

  it('reads a freshly presented plan digest as no decision (prose mentions only)', () => {
    expect(planGateCarriesDecision(FRESH_PLAN_GATE)).toBe(false)
  })
})

describe('carriesDecision', () => {
  it('accepts the →/ABORT forms only at plan mode', () => {
    const fullVeto = '- [ ] C1 db-schema — Rename the schema columns.\n→ split the schema child'
    const loneAbort = '- [ ] C1 db-schema — Rename the schema columns.\nABORT'
    expect(carriesDecision(fullVeto, 'plan')).toBe(true)
    expect(carriesDecision(loneAbort, 'plan')).toBe(true)
    expect(carriesDecision(fullVeto, 'early')).toBe(false)
    expect(carriesDecision(fullVeto, 'final')).toBe(false)
  })

  it('reads a fresh early-gate render (placeholder → lines) as unanswered', () => {
    expect(carriesDecision(FRESH_EARLY_GATE, 'early')).toBe(false)
  })

  it('settles an early gate on a real → answer or a checked box', () => {
    expect(carriesDecision(`${FRESH_EARLY_GATE}\n→ OVERRIDE\n`, 'early')).toBe(false)
    expect(carriesDecision('- [x] A1 ok', 'early')).toBe(true)
    expect(carriesDecision('## Gate response\n', 'final')).toBe(true)
  })
})
