// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import type { Finding, Resolution } from '../../sdd-runner/src/agent-layer.js'
import { ResolverOutputSchema } from '../../sdd-runner/src/review-loop.js'
import { evaluateConvergence, lensesForRound, mergeLensFindings } from '../../sdd-runner/src/review-model.js'

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
