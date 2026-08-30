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
  evaluateConvergence,
  isOpenResolution,
  lensesForRound,
  mergeLensFindings,
} from '../../sdd-runner/src/review-model.js'
import type { AssumptionLink } from '../../sdd-runner/src/review-model.js'
import { buildReviewerPrompt } from '../../sdd-runner/src/review-prompts.js'

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
      raised: { blocker: 0, material: 0, nitpick: 1 },
      open: { blocker: 0, material: 0, nitpick: 1 },
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

describe('isOpenResolution', () => {
  const unchanged = { 'proposal.md': 'aaa' }
  const changed = { 'proposal.md': 'bbb' }
  const linked = [{ id: 'A1', findingId: 'F1' }]
  const legacy = [{ id: 'A1' }]

  function open(
    res: Partial<Resolution>,
    assumptions: readonly AssumptionLink[] = linked,
    prior: Record<string, string> | null = unchanged,
  ): boolean {
    return isOpenResolution(resolution(res), assumptions, { previous: prior, current: unchanged })
  }

  it('treats a dismissed resolution as open — only a human can contest it', () => {
    expect(open({ resolution: 'dismissed', justification: 'out of scope' })).toBe(true)
  })

  it('treats an evidence-answered resolution as closed', () => {
    expect(open({ resolution: 'evidence-answered' })).toBe(false)
  })

  it('closes an assumed resolution when an assumption carries its finding id', () => {
    expect(open({ resolution: 'assumed' }, [{ id: 'A1', findingId: 'F1' }])).toBe(false)
  })

  it('opens an assumed resolution when no assumption carries its finding id', () => {
    expect(open({ resolution: 'assumed' }, [{ id: 'A1', findingId: 'F7' }])).toBe(true)
  })

  it('opens an assumed resolution when the round logged no assumptions at all', () => {
    expect(open({ resolution: 'assumed' }, [])).toBe(true)
  })

  it('closes an assumed resolution under the legacy fallback when no assumption carries any finding id', () => {
    // Pre-change sidecars have no findingId anywhere; a logged assumption is the
    // only evidence available, so the round-level check stands in for the link.
    expect(open({ resolution: 'assumed' }, legacy)).toBe(false)
  })

  it('opens an edited resolution whose files are byte-identical to the prior round', () => {
    expect(open({ resolution: 'edited' }, linked, unchanged)).toBe(true)
  })

  it('closes an edited resolution whose files moved since the prior round', () => {
    expect(open({ resolution: 'edited' }, linked, changed)).toBe(false)
  })

  it('closes an edited resolution when there is no prior snapshot to compare against', () => {
    expect(open({ resolution: 'edited' }, linked, null)).toBe(false)
  })

  it('detects an added or removed file as movement, not just a changed digest', () => {
    const current = { 'proposal.md': 'aaa', 'design.md': 'ccc' }
    expect(isOpenResolution(resolution({ resolution: 'edited' }), linked, { previous: unchanged, current })).toBe(false)
  })
})

describe('evaluateConvergence — raised vs open', () => {
  const moved = { previous: { 'p.md': 'a' }, current: { 'p.md': 'b' } }
  const still = { previous: { 'p.md': 'a' }, current: { 'p.md': 'a' } }

  it('reports raised counts over every resolution, unchanged from the pre-split behaviour', () => {
    const result = evaluateConvergence(
      [
        resolution({ id: 'F1', class: 'BLOCKER', resolution: 'edited' }),
        resolution({ id: 'F2', class: 'MATERIAL', resolution: 'dismissed', justification: 'j' }),
        resolution({ id: 'F3', class: 'NITPICK', resolution: 'evidence-answered' }),
      ],
      { assumptions: [], digests: moved },
    )
    expect(result.raised).toEqual({ blocker: 1, material: 1, nitpick: 1 })
  })

  it('counts only what a human must settle in the open set', () => {
    const result = evaluateConvergence(
      [
        resolution({ id: 'F1', class: 'BLOCKER', resolution: 'edited' }),
        resolution({ id: 'F2', class: 'MATERIAL', resolution: 'dismissed', justification: 'j' }),
      ],
      { assumptions: [], digests: moved },
    )
    expect(result.open).toEqual({ blocker: 0, material: 1, nitpick: 0 })
  })

  it('calls a round with a fresh edit above a nitpick needs-review, not converged', () => {
    const result = evaluateConvergence(
      [
        resolution({ id: 'F1', class: 'BLOCKER', resolution: 'edited' }),
        resolution({ id: 'F2', class: 'MATERIAL', resolution: 'evidence-answered' }),
      ],
      { assumptions: [], digests: moved },
    )
    // F1 was edited and reviewed in this same round's ledger, so nothing is
    // unreviewed: the verdict is converged rather than needs-review only when
    // the edits are not fresh. Here they are, so needs-review is expected.
    expect(result.verdict).toBe('needs-review')
  })

  it('reports open when anything above a nitpick still needs a human', () => {
    const result = evaluateConvergence(
      [resolution({ class: 'MATERIAL', resolution: 'dismissed', justification: 'j' })],
      {
        assumptions: [],
        digests: moved,
      },
    )
    expect(result.verdict).toBe('open')
  })

  it('reports needs-review when the round produced an edit above a nitpick', () => {
    const result = evaluateConvergence([resolution({ class: 'MATERIAL', resolution: 'edited' })], {
      assumptions: [],
      digests: moved,
    })
    expect(result.verdict).toBe('needs-review')
  })

  it('does not call a nitpick-only edit needs-review', () => {
    const result = evaluateConvergence([resolution({ class: 'NITPICK', resolution: 'edited' })], {
      assumptions: [],
      digests: moved,
    })
    expect(result.verdict).toBe('converged')
  })

  it('reports open — not needs-review — for an edit that moved nothing', () => {
    const result = evaluateConvergence([resolution({ class: 'MATERIAL', resolution: 'edited' })], {
      assumptions: [],
      digests: still,
    })
    expect(result.verdict).toBe('open')
    expect(result.open).toEqual({ blocker: 0, material: 1, nitpick: 0 })
  })

  it('keeps the three-nitpick allowance on the open set', () => {
    const nitpicks = (n: number): Resolution[] =>
      Array.from({ length: n }, (_, i) =>
        resolution({ id: `N${String(i)}`, class: 'NITPICK', resolution: 'dismissed', justification: 'j' }),
      )
    expect(evaluateConvergence(nitpicks(3), { assumptions: [], digests: moved }).verdict).toBe('converged')
    expect(evaluateConvergence(nitpicks(4), { assumptions: [], digests: moved }).verdict).toBe('open')
  })

  it('keeps counts as the legacy field so existing consumers compile unchanged', () => {
    const result = evaluateConvergence([resolution({ class: 'BLOCKER', resolution: 'edited' })], {
      assumptions: [],
      digests: moved,
    })
    expect(result.counts).toEqual(result.raised)
  })

  it('defaults to the pre-split reading when no context is supplied', () => {
    const result = evaluateConvergence([resolution({ class: 'BLOCKER', resolution: 'edited' })])
    expect(result.raised).toEqual({ blocker: 1, material: 0, nitpick: 0 })
    expect(result.open).toEqual(result.raised)
    expect(result.verdict).toBe('open')
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
