// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import type { Finding, Resolution } from '../../sdd-runner/src/agent-layer.js'
import { fingerprintOf } from '../../sdd-runner/src/concern-model.js'
import type { LedgerEntry } from '../../sdd-runner/src/concern-model.js'
import { ResolverOutputSchema } from '../../sdd-runner/src/review-loop.js'
import {
  buildReviewerPrompt,
  evaluateConvergence,
  lensesForRound,
  mergeLensFindings,
} from '../../sdd-runner/src/review-model.js'

function resolution(overrides: Partial<Resolution> = {}): Resolution {
  return { id: 'F1', class: 'NITPICK', resolution: 'edited', outcome: 'fixed', ...overrides }
}

function finding(overrides: Partial<Finding> = {}): Finding {
  return { id: 'F1', class: 'MATERIAL', gap: 'g', question: 'q', code_evidence_attempted: 'e', ...overrides }
}

describe('review-model (split smoke)', () => {
  it('evaluates convergence after the resolver assigns final classes', () => {
    expect(evaluateConvergence([resolution()]).verdict).toBe('converged')
    expect(evaluateConvergence([resolution({ class: 'BLOCKER' })]).verdict).toBe('open')
  })

  it('counts distinct finding ids so duplicate entries cannot inflate counts or flip a verdict', () => {
    const dupEntries = [
      resolution({ id: 'F1', class: 'NITPICK' }),
      resolution({ id: 'F1', class: 'NITPICK' }),
      resolution({ id: 'F1', class: 'NITPICK' }),
      resolution({ id: 'F1', class: 'NITPICK' }),
    ]
    expect(evaluateConvergence(dupEntries)).toEqual({
      verdict: 'converged',
      counts: { blocker: 0, material: 0, nitpick: 1 },
    })
  })

  it('picks lenses per profile and escalation rule', () => {
    expect(lensesForRound('S', 1, 0)).toEqual(['reviewer'])
    expect(lensesForRound('L', 1, 0)).toEqual(['reviewer', 'skeptic'])
    expect(lensesForRound('M', 3, 1)).toEqual(['reviewer', 'skeptic'])
  })

  it('dedupes lens findings by gap+question', () => {
    const merged = mergeLensFindings([finding()], [finding({ id: 'F9' })])
    expect(merged).toHaveLength(1)
  })
})

// Fixtures shaped from the opencode-agent-fix-command run's round-3 sidecars:
// reviewer F7/F8 and skeptic F7/F8 quote the same two concerns with different
// wording, punctuation, and classes — the exact shape that survived the old
// exact-text merge and produced duplicate ids downstream.
const R3_REVIEWER: readonly Finding[] = [
  finding({
    id: 'F7',
    class: 'NITPICK',
    gap: 'THEN** the round SHALL discover what failed from the check runs of the pull request',
  }),
  finding({
    id: 'F8',
    class: 'NITPICK',
    gap: 'A head with no failed check run is the spec\'s "Nothing red on the head" outcome',
  }),
]

const R3_SKEPTIC: readonly Finding[] = [
  finding({
    id: 'F7',
    class: 'MATERIAL',
    gap: 'A head with no failed check run is the spec\'s "Nothing red on the head" outcome,',
  }),
  finding({
    id: 'F8',
    class: 'NITPICK',
    gap: 'THEN the round shall discover what failed from the check runs of the pull request.',
  }),
]

describe('mergeLensFindings fingerprint dedup (corpus r3 shape)', () => {
  it('merges differently-quoted copies of the same concern to one finding with the most severe class', () => {
    const merged = mergeLensFindings(R3_REVIEWER, R3_SKEPTIC)
    expect(merged).toHaveLength(2)
    const headCopy = merged.find((f) => fingerprintOf(f.gap) === fingerprintOf(R3_REVIEWER[1]!.gap))
    expect(headCopy?.id).toBe('F8')
    expect(headCopy?.class).toBe('MATERIAL')
  })

  it('keeps findings whose fingerprints are distinct even when ids collide', () => {
    const merged = mergeLensFindings(
      [finding({ id: 'F6', gap: 'Hook/TDD interactions gate the TS edits' })],
      [finding({ id: 'F6', gap: 'Failed check runs map into the existing FailedJob shape' })],
    )
    expect(merged).toHaveLength(2)
    expect(new Set(merged.map((f) => f.id)).size).toBe(1)
  })
})

describe('ResolverOutputSchema evidence contract', () => {
  const base = {
    resolutions: [],
    assumptions: [
      {
        id: 'A1',
        text: 't',
        basis: 'default',
        confidence: 'high',
        blast_radius: 'b',
        status: 'open',
        evidence: { files: ['openspec/changes/foo/proposal.md'] },
      },
    ],
  }

  it('parses a resolver output whose assumptions carry evidence.files', () => {
    const parsed = ResolverOutputSchema.safeParse(base)
    expect(parsed.success).toBe(true)
  })

  it('rejects a resolver sidecar whose assumption lacks or empties evidence.files', () => {
    const missingEvidence = {
      resolutions: [],
      assumptions: [{ id: 'A1', text: 't', basis: 'default', confidence: 'high', blast_radius: 'b', status: 'open' }],
    }
    expect(ResolverOutputSchema.safeParse(missingEvidence).success).toBe(false)
    const emptyEvidence = {
      resolutions: [],
      assumptions: [
        {
          id: 'A1',
          text: 't',
          basis: 'default',
          confidence: 'high',
          blast_radius: 'b',
          status: 'open',
          evidence: { files: [] },
        },
      ],
    }
    expect(ResolverOutputSchema.safeParse(emptyEvidence).success).toBe(false)
  })
})

function ledgerEntry(
  round: number,
  overrides: Partial<LedgerEntry['resolution']> & { gap?: string } = {},
): LedgerEntry {
  return {
    round,
    gap: overrides.gap ?? 'the proposal never names the scope id',
    resolution: resolution({
      id: overrides.id ?? 'F2',
      class: overrides.class ?? 'MATERIAL',
      resolution: overrides.resolution ?? 'edited',
      outcome: overrides.justification === undefined ? (overrides.outcome ?? 'narrowed gap') : overrides.outcome,
      ...(overrides.justification === undefined ? {} : { justification: overrides.justification }),
    }),
  }
}

describe('reviewer prompt ledger rendering (loop-memory 2.2)', () => {
  it('an empty ledger renders no known-concerns section in the reviewer prompt', () => {
    const prompt = buildReviewerPrompt({
      lens: 'reviewer',
      artifacts: 'a',
      conventions: 'c',
      ledger: [],
      outputTarget: 'out.json',
    })
    expect(prompt).not.toContain('Known concerns')
    expect(prompt).not.toContain('Previously resolved findings')
  })

  it('the reviewer prompt embeds round-tagged digest lines, not the flat ledger', () => {
    const prompt = buildReviewerPrompt({
      lens: 'reviewer',
      artifacts: 'a',
      conventions: 'c',
      ledger: [ledgerEntry(2, {})],
      outputTarget: 'out.json',
    })
    expect(prompt).toContain('## Known concerns')
    expect(prompt).toContain('r2 [F2] MATERIAL edited — narrowed gap (seen r2..r2)')
    expect(prompt).toContain('Re-raise a known concern only with new evidence')
    expect(prompt).not.toContain('(do not re-raise without new evidence)')
  })
})
